from __future__ import annotations

import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
MAP_CLIENT = ROOT / "src/app/map/MapClient.tsx"
SIDEBAR = ROOT / "src/components/SidebarFilter.tsx"


def sub_once(text: str, pattern: str, replacement: str, label: str) -> str:
    updated, count = re.subn(pattern, replacement, text, count=1, flags=re.S)
    if count != 1:
        raise RuntimeError(f"expected one replacement for {label}, got {count}")
    return updated


text = MAP_CLIENT.read_text(encoding="utf-8")

text = sub_once(
    text,
    r"import Link from 'next/link';\nimport dynamic from 'next/dynamic';\n\nimport \{ SearchBar \} from '@/src/components/SearchBar';\nimport \{ SidebarFilter, type SidebarFilterState, type CompareGroup, type SidebarFilterCommand \} from '@/src/components/SidebarFilter';\nimport \{ StatCard \} from '@/src/components/StatCard';",
    "import type { SidebarFilterState, CompareGroup, SidebarFilterCommand } from '@/src/components/SidebarFilter';",
    "MapClient view imports",
)

text = sub_once(
    text,
    r"import \{\n  MAP_DISTRICTS as MOCK_DISTRICTS,.*?\n\} from './model/mapDomain';",
    """import {
  buildActiveFilterChips,
  buildDistrictLeedStats,
  buildFutureSupplyCalendar,
  categorizeSupply,
  computeStatsFromBuildings,
  isDefaultFilterState,
  type MapStatsState,
  type RenderMode,
} from './model/mapDomain';""",
    "MapClient domain imports",
)

text = text.replace(
    "import { useMapRuntime } from './runtime/useMapRuntime';\n",
    "import { useMapRuntime } from './runtime/useMapRuntime';\nimport { MapWorkbenchView } from './components/MapWorkbenchView';\n",
    1,
)

text = sub_once(
    text,
    r"// 🌟 Phase 2: 动态按需加载悬浮楼宇列表组件.*?\nfunction MapAuthLoading\(\)",
    "function MapAuthLoading()",
    "legacy Map chrome",
)

needle = "  const [isSupplyOpen, setIsSupplyOpen] = React.useState(false);\n"
if needle not in text:
    raise RuntimeError("missing supply panel state")
text = text.replace(
    needle,
    needle + "  const [isFilterPanelOpen, setIsFilterPanelOpen] = React.useState(false);\n",
    1,
)

new_tail = r'''if (!allowed) return <MapAuthLoading />;

  return (
    <>
      <MapWorkbenchView
        stats={stats}
        futureSupplyCalendar={futureSupplyCalendar}
        futureSuppliesCount={futureSupplies.length}
        activeFilterChips={activeFilterChips}
        keyword={keyword}
        renderMode={renderMode}
        isFilterPanelOpen={isFilterPanelOpen}
        isSupplyOpen={isSupplyOpen}
        isListVisible={isListVisible}
        canOpenList={userHasInteracted || Boolean(keyword)}
        currentSubwayStations={currentSubwayStations}
        filterCommand={filterCommand}
        mapReady={mapReady}
        mapError={mapError}
        mapDataLoading={mapDataLoading}
        hasBuildings={allBuildings.length > 0}
        isExporting={isExporting}
        combinedBuildingList={combinedBuildingList}
        displayOverrides={displayOverrides}
        targetBuildingId={targetBuildingId}
        onFilterPanelOpenChange={setIsFilterPanelOpen}
        onSupplyOpenChange={setIsSupplyOpen}
        onFilterChange={handleFilterChange}
        onCompareGroupsChange={handleCompareGroupsChange}
        onKeywordChange={setKeyword}
        onSearch={handleSearch}
        onRemoveFilterChip={patch => issueFilterCommand('patch', patch)}
        onResetFilters={() => issueFilterCommand('reset')}
        onRenderModeChange={setRenderMode}
        onOpenList={() => setIsListVisible(true)}
        onCloseList={() => setIsListVisible(false)}
        onRetryMap={() => {
          const controller = controllerRef.current;
          if (controller && mapReady) void loadMapData(controller);
          else window.location.reload();
        }}
        onExportMapData={handleExportMapData}
        onBuildingClick={handleBuildingClick}
        onBuildingHover={handleBuildingHover}
      />

      {editingBuilding && (
        <BuildingMetricsEditModal
          buildingId={editingBuilding.id}
          buildingName={editingBuilding.name}
          isOpen={true}
          onClose={() => setEditingBuilding(null)}
          onSave={async () => {
            if (controllerRef.current) {
              try {
                await controllerRef.current.refreshBuildingData(editingBuilding.id);
              } catch (err) {
                console.error('刷新地图数据失败:', err);
              }
            }
          }}
        />
      )}
    </>
  );
}'''

text = sub_once(
    text,
    r"if \(!allowed\) return <MapAuthLoading />;\n\n  return \(\n.*\n  \);\n\}\s*$",
    new_tail,
    "MapClient render tree",
)

MAP_CLIENT.write_text(text, encoding="utf-8")

sidebar = SIDEBAR.read_text(encoding="utf-8")

sidebar = sidebar.replace(
    "  filterCommand?: SidebarFilterCommand | null;\n}",
    "  filterCommand?: SidebarFilterCommand | null;\n  embedded?: boolean;\n  defaultExpanded?: boolean;\n}",
    1,
)

sidebar = sidebar.replace(
    "  const [globalFilterOpen, setGlobalFilterOpen] = React.useState(false);",
    "  const [globalFilterOpen, setGlobalFilterOpen] = React.useState(props.defaultExpanded ?? false);",
    1,
)

sidebar = sidebar.replace(
    '      <div className="flex items-center justify-between gap-3 rounded-md border border-zinc-200/60 bg-white px-3 py-2 sm:hidden">',
    "      <div className={`${props.embedded ? 'hidden' : 'flex'} items-center justify-between gap-3 rounded-md border border-zinc-200/60 bg-white px-3 py-2 sm:hidden`}>",
    1,
)

sidebar = sidebar.replace(
    "      <div className={`${isMobileOpen ? 'block' : 'hidden'} sm:block`}>",
    "      <div className={`${props.embedded ? 'block' : isMobileOpen ? 'block' : 'hidden'} sm:block`}>",
    1,
)

sidebar = sidebar.replace(
    '        <div className="mt-2 rounded-md border border-zinc-200/60 bg-white p-3 sm:mt-0">',
    "        <div className={props.embedded ? 'bg-transparent p-0' : 'mt-2 rounded-md border border-zinc-200/60 bg-white p-3 sm:mt-0'}>",
    1,
)

sidebar = sidebar.replace(
    '            className="hidden items-center justify-between sm:flex mb-2 pb-2 border-b border-zinc-100 cursor-pointer hover:bg-zinc-50 -mx-1 px-1 py-1 rounded-md transition-colors"',
    "            className={`${props.embedded ? 'flex' : 'hidden sm:flex'} items-center justify-between mb-2 pb-2 border-b border-zinc-100 cursor-pointer hover:bg-zinc-50 -mx-1 px-1 py-1 rounded-md transition-colors`}",
    1,
)

SIDEBAR.write_text(sidebar, encoding="utf-8")
