from __future__ import annotations

import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
MAP_CLIENT = ROOT / "src/app/map/MapClient.tsx"
MAP_STORE = ROOT / "src/app/map/model/MapDataStore.ts"


def replace_once(text: str, old: str, new: str, label: str) -> str:
    if old not in text:
        raise RuntimeError(f"missing exact replacement target: {label}")
    return text.replace(old, new, 1)


def sub_once(text: str, pattern: str, replacement: str, label: str) -> str:
    updated, count = re.subn(pattern, replacement, text, count=1, flags=re.S)
    if count != 1:
        raise RuntimeError(f"expected one regex replacement for {label}, got {count}")
    return updated


def patch_store() -> None:
    text = MAP_STORE.read_text(encoding="utf-8")
    old = """    const candidates = candidateIds
      ? Array.from(candidateIds, id => this.indexes.buildingIdIndex.get(id)).filter((building): building is BuildingWithMetrics => Boolean(building))
      : this.getRoleVisible(request.role);
"""
    new = """    const roleVisibleBuildings = this.getRoleVisible(request.role);
    const candidates = candidateIds
      ? roleVisibleBuildings.filter(building => candidateIds?.has(building.id))
      : roleVisibleBuildings;
"""
    text = replace_once(text, old, new, "stable candidate ordering")
    MAP_STORE.write_text(text, encoding="utf-8")


def patch_map_client() -> None:
    text = MAP_CLIENT.read_text(encoding="utf-8")

    text = replace_once(
        text,
        "import { getLatestMetric } from '@/src/utils/filterBuildings';\n",
        "",
        "remove local metric helper import",
    )

    insert_after = "import { BuildingMetricsEditModal } from '@/src/components/map/BuildingMetricsEditModal';\n"
    domain_import = """import {
  MAP_DISTRICTS as MOCK_DISTRICTS,
  MAP_LEEDS as MOCK_LEEDS,
  MAP_SUBMARKETS as MOCK_SUBMARKETS,
  MAP_SUBMARKETS_SECONDARY as MOCK_SUBMARKETS_SECONDARY,
  MAP_SUBWAYS as MOCK_SUBWAYS,
  SUPPLY_CALENDAR_CATEGORIES,
  SUPPLY_CALENDAR_LABELS,
  buildActiveFilterChips,
  buildDistrictLeedStats,
  buildFutureSupplyCalendar,
  categorizeSupply,
  computeStatsFromBuildings,
  isDefaultFilterState,
  type MapStatsState,
  type RenderMode,
} from './model/mapDomain';
import { MapDataStore } from './model/MapDataStore';
"""
    text = replace_once(text, insert_after, insert_after + domain_import, "add map domain imports")

    text = sub_once(
        text,
        r"const MOCK_SUBMARKETS = .*?export type RenderMode = 'default' \| 'rent' \| 'vacancy' \| 'leed';\n\n",
        "",
        "remove duplicated map constants and render type",
    )

    text = sub_once(
        text,
        r"type MapStatsState = .*?(?=function MapAuthLoading\(\))",
        "",
        "remove duplicated map domain helpers",
    )

    compare_state = "  const [compareGroups, setCompareGroups] = React.useState<CompareGroup[]>([]);\n"
    text = replace_once(
        text,
        compare_state,
        compare_state + "  const mapDataStoreRef = React.useRef(new MapDataStore());\n",
        "add map data store ref",
    )

    text = sub_once(
        text,
        r"  const activeFilterChips = React\.useMemo<ActiveFilterChip\[\]>\(\(\) => \{.*?\n  \}, \[filterState\]\);",
        "  const activeFilterChips = React.useMemo(() => buildActiveFilterChips(filterState), [filterState]);",
        "replace active filter chip derivation",
    )

    old_role_block = """      // admin/editor 可见所有等级，viewer 只看 A/P。
      const role = await getSessionFast().then(s => s?.role || 'viewer').catch(() => 'viewer');
      if (isCancelled()) return;
      const canSeeAll = role === 'admin' || role === 'editor';
      const visible = canSeeAll ? buildings : buildings.filter(building => {
        const grade = String(building.grade || '').toUpperCase();
        return grade === 'A' || grade === 'P';
      });

      console.log(`[MapClient] 角色=${role}, 总建筑=${buildings.length}, 可见=${visible.length}`);
      setAllBuildings(visible);
      setAllBuildingsUnfiltered(buildings);
      setDisplayOverrides(controller.getDisplayOverridesCache());
"""
    new_role_block = """      // admin/editor 可见所有等级，viewer 只看 A/P。索引在数据进入工作区时只构建一次。
      const role = await getSessionFast().then(s => s?.role || 'viewer').catch(() => 'viewer');
      if (isCancelled()) return;
      mapDataStoreRef.current.replaceBuildings(buildings);
      const visible = mapDataStoreRef.current.getRoleVisible(role);

      console.log(`[MapClient] 角色=${role}, 总建筑=${buildings.length}, 可见=${visible.length}`);
      setAllBuildings(visible);
      setAllBuildingsUnfiltered(buildings);
      setDisplayOverrides(controller.getDisplayOverridesCache());
"""
    text = replace_once(text, old_role_block, new_role_block, "wire store into map data load")

    text = sub_once(
        text,
        r"  // 🌟 优化：使用 useMemo 缓存区域 LEED 认证率计算，避免重复计算\n  const districtLeedStats = React\.useMemo\(\(\) => \{.*?\n  \}, \[allBuildings\]\);",
        "  const districtLeedStats = React.useMemo(() => buildDistrictLeedStats(allBuildings), [allBuildings]);",
        "replace district LEED aggregation",
    )

    text = sub_once(
        text,
        r"  // 辅助函数：安全解析供应年份.*?\n  \}, \[futureSupplies, categorizeSupply\]\);",
        "  const futureSupplyCalendar = React.useMemo(() => buildFutureSupplyCalendar(futureSupplies), [futureSupplies]);",
        "replace future supply calendar derivation",
    )

    text = sub_once(
        text,
        r"    // ================ 核心过滤引擎 ================.*?(?=    // 🌟 Phase 1: 将过滤结果同步到组件状态，供悬浮列表使用)",
        """    // ================ 核心过滤引擎 ================
    const filtered = mapDataStoreRef.current.filter({
      filterState,
      compareGroups,
      keyword,
      role: userRoleRef.current,
      calculateDistance: (buildingPoint, stationPoint) => ctrl.calculateDistance(buildingPoint, stationPoint),
    });

""",
        "replace inline building filter engine",
    )

    MAP_CLIENT.write_text(text, encoding="utf-8")


if __name__ == "__main__":
    patch_store()
    patch_map_client()
