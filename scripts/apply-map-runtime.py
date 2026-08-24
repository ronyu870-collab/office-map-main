from __future__ import annotations

import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
TARGET = ROOT / "src/app/map/MapClient.tsx"


def replace_once(text: str, old: str, new: str, label: str) -> str:
    if old not in text:
        raise RuntimeError(f"missing exact replacement target: {label}")
    return text.replace(old, new, 1)


def sub_once(text: str, pattern: str, replacement: str, label: str) -> str:
    updated, count = re.subn(pattern, replacement, text, count=1, flags=re.S)
    if count != 1:
        raise RuntimeError(f"expected one regex replacement for {label}, got {count}")
    return updated


text = TARGET.read_text(encoding="utf-8")

text = replace_once(text, "import { useRouter } from 'next/navigation';\n", "", "remove router import")
text = replace_once(
    text,
    "import { getSession, getSessionFast } from '@/src/services/Auth';\n",
    "import { getSession } from '@/src/services/Auth';\nimport { useAppSession } from '@/src/components/SessionProvider';\n",
    "reuse root application session",
)
text = replace_once(
    text,
    "import { MapDataStore } from './model/MapDataStore';\n",
    "import { MapDataStore } from './model/MapDataStore';\nimport { useMapRuntime } from './runtime/useMapRuntime';\n",
    "add map runtime hook",
)

old_component_start = """export default function MapWorkbenchPage() {
  const router = useRouter();
  const [allowed, setAllowed] = React.useState(false);
  const [userRole, setUserRole] = React.useState<string>('viewer');
  const [currentUserId, setCurrentUserId] = React.useState<string | null>(null);

  const [allBuildings, setAllBuildings] = React.useState<any[]>([]);
  const [allBuildingsUnfiltered, setAllBuildingsUnfiltered] = React.useState<any[]>([]); // 完整数据（含所有等级）
"""
new_component_start = """export default function MapWorkbenchPage() {
  const { session: appSession, status: appSessionStatus } = useAppSession();
  const allowed = appSessionStatus === 'authenticated' && Boolean(appSession);
  const userRole = appSession?.role || 'viewer';
  const currentUserId = appSession?.user?.id || null;
  const userRoleRef = React.useRef(userRole);
  userRoleRef.current = userRole;

  const [allBuildings, setAllBuildings] = React.useState<any[]>([]);
"""
text = replace_once(text, old_component_start, new_component_start, "derive map identity from root session")

text = replace_once(
    text,
    "  const [mapError, setMapError] = React.useState<string | null>(null);\n  const [mapReady, setMapReady] = React.useState(false);\n  const [mapDataLoading, setMapDataLoading] = React.useState(false);\n  const controllerRef = React.useRef<any>(null);\n",
    "  const [mapError, setMapError] = React.useState<string | null>(null);\n  const [mapDataLoading, setMapDataLoading] = React.useState(false);\n",
    "move controller readiness into runtime hook",
)

old_role = """      // admin/editor 可见所有等级，viewer 只看 A/P。索引在数据进入工作区时只构建一次。
      const role = await getSessionFast().then(s => s?.role || 'viewer').catch(() => 'viewer');
      if (isCancelled()) return;
      mapDataStoreRef.current.replaceBuildings(buildings);
      const visible = mapDataStoreRef.current.getRoleVisible(role);

      console.log(`[MapClient] 角色=${role}, 总建筑=${buildings.length}, 可见=${visible.length}`);
      setAllBuildings(visible);
      setAllBuildingsUnfiltered(buildings);
      setDisplayOverrides(controller.getDisplayOverridesCache());
"""
new_role = """      // admin/editor 可见所有等级，viewer 只看 A/P。索引在数据进入工作区时只构建一次。
      const role = userRoleRef.current;
      mapDataStoreRef.current.replaceBuildings(buildings);
      const visible = mapDataStoreRef.current.getRoleVisible(role);

      console.log(`[MapClient] 角色=${role}, 总建筑=${buildings.length}, 可见=${visible.length}`);
      setAllBuildings(visible);
      setDisplayOverrides(controller.getDisplayOverridesCache());
"""
text = replace_once(text, old_role, new_role, "remove duplicate auth read from data load")

load_tail = """  }, []);

  React.useEffect(() => {
    return () => filterFrameSchedulerRef.current?.cancel();
  }, []);
"""
runtime_block = """  }, []);

  const { controllerRef, mapReady } = useMapRuntime({
    enabled: allowed,
    containerId: 'map-container',
    userRole,
    currentUserId,
    onEditBuildingMetrics: (buildingId, buildingName) => {
      setEditingBuilding({ id: buildingId, name: buildingName });
    },
    onReady: async (controller, isCancelled) => {
      await loadMapData(controller, isCancelled);
      if (isCancelled()) return;
      try {
        const supplies = await controller.fetchFutureSupplies();
        if (!isCancelled()) setFutureSupplies(supplies);
      } catch {
        // Future supply is a secondary layer; preserve current fail-open behavior.
      }
    },
    onError: setMapError,
  });

  React.useEffect(() => {
    return () => filterFrameSchedulerRef.current?.cancel();
  }, []);
"""
text = replace_once(text, load_tail, runtime_block, "wire map runtime hook")

text = sub_once(
    text,
    r"  // ref 缓存 userRole / currentUserId，避免 effect deps 变化触发 map 重建\n.*?currentUserIdRef\.current = currentUserId;\n\n",
    "",
    "remove local role runtime refs",
)

text = sub_once(
    text,
    r"  React\.useEffect\(\(\) => \{\n    // 渐进式渲染：先显示 UI，异步验证.*?\n  \}, \[router\]\);\n\n",
    "",
    "remove duplicate map auth effect",
)

text = sub_once(
    text,
    r"  React\.useEffect\(\(\) => \{\n    if \(!allowed\) return;.*?\n  \}, \[mapReady, userRole, currentUserId\]\);\n\n",
    "",
    "remove inline controller lifecycle and admin sync",
)

TARGET.write_text(text, encoding="utf-8")
