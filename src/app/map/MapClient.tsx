'use client';

import { MapReadingContext, mapReturnToken, readMapReturn, saveMapReturn, rememberMapEntry, compactView, restoreWorkspace, type Camera, type MapReturnSnapshot } from './workspace/continuity';
import { workspaceReducer, initialWorkspaceState } from './workspace/workspaceState';
import type { WorkspaceBuildingDetail } from './workspace/buildingDetail';
import { observeMapCanvas } from './runtime/observeMapCanvas';
import { WorkspaceBuildingDetail as BuildingDetailView, type BuildingReadingState } from './components/WorkspaceBuildingDetail';
import { MapQuerySelection } from './MapQuerySelection';
import type { QueryMapContext } from '@/src/lib/intelligence/query/buildingNavigation';
import type { BuildingContext } from '@/src/lib/intelligence/query/buildingCards';
import { readMapFilterPreference } from './model/mapFilterPreference';
import { getImpersonationTargetUserId } from '@/src/services/impersonationHeaders';
import type { BuildingFocus } from './MapRouteGate';
import * as React from 'react';
import dynamic from 'next/dynamic';
import type { SidebarFilterState, CompareGroup, SidebarFilterCommand } from '@/src/components/SidebarFilter';
import { useAppSession } from '@/src/components/SessionProvider';
import type { MapController } from '@/src/services/MapController';
// 🌟 1. 引入日志工具
import { logAction } from '@/src/utils/audit';
import { createLatestFrameScheduler, type LatestFrameScheduler } from '@/src/utils/frameCoalescer';
import { retryAsync } from '@/src/utils/retryAsync';
import { isPendingFutureSupply } from '@/src/lib/future-supply-status';
import {
  MAP_DISTRICTS as MOCK_DISTRICTS,
  buildActiveFilterChips,
  buildDistrictLeedStats,
  buildFutureSupplyCalendar,
  computeStatsFromBuildings,
  createDefaultFilterState,
  filterFutureSupplies,
  getConfiguredCompareGroups,
  isDefaultFilterState,
  isDefaultStockFilterState,
  type MapStatsState,
  type RenderMode,
} from './model/mapDomain';
import { MapDataStore } from './model/MapDataStore';
import { normalizeMapSubmarket } from './model/mapDomain';
import { submarketSummary } from './model/submarketOverview';
import { useMapRuntime } from './runtime/useMapRuntime';
import { recordMapStartup } from '@/src/utils/mapStartupProbe';
import { useMapWorkspaceView } from './runtime/useMapWorkspaceView';
import { hasBuildingLocation, type FullListBuilding } from './model/fullBuildingList';
import { searchViewportTargets } from './model/mapSearchCandidates';
import { MapWorkbenchView } from './components/MapWorkbenchView';
import { MapLoadingShell } from './components/MapLoadingShell';
import type { IntelligenceMapRouteState } from './model/intelligenceMapHandoff';

// Admin-only editing is never part of the normal Map path. Keep its Supabase,
// audit and form runtime out of the MapClient chunk until an admin opens it.
const SubmarketDetailPanel = dynamic(
  () => import('./components/SubmarketDetailPanel').then(module => module.SubmarketDetailPanel),
  { ssr: false },
);

const BuildingMetricsEditModal = dynamic(
  () => import('@/src/components/map/BuildingMetricsEditModal').then(module => module.BuildingMetricsEditModal),
  { ssr: false },
);

export default function MapWorkbenchPage({ initialIntelligenceHandoff, buildingFocus, resume, queryContext = null }: { initialIntelligenceHandoff: IntelligenceMapRouteState | null; buildingFocus?: BuildingFocus | null; resume?: string | null; queryContext?: QueryMapContext | null }) {
  const { session: appSession, status: appSessionStatus } = useAppSession();
  const [querySelection, setQuerySelection] = React.useState<BuildingContext | null>(null);
  const queryIds = React.useMemo(() => new Set(querySelection?.buildings.filter(row => row.located).map(row => row.id) ?? []), [querySelection]);
  const queryFit = React.useRef('');
  const allowed = appSessionStatus === 'authenticated' && Boolean(appSession);
  const userRole = appSession?.role || 'viewer';
  const currentUserId = appSession?.user?.id || null;
  const userRoleRef = React.useRef(userRole);
  const readingScope = JSON.stringify([currentUserId, userRole, appSession?.sessionId, getImpersonationTargetUserId()]);
  const [returnToken] = React.useState(() => mapReturnToken(resume));
  const [returnState] = React.useState(() => {
    if (initialIntelligenceHandoff || queryContext) return null;
    const state = readMapReturn(readingScope, returnToken);
    return state && (!buildingFocus || state.selected === buildingFocus.id) ? state : null;
  });
  const [readingStore] = React.useState(() => returnState?.reading ?? {});
  const restoreCamera = React.useRef<Camera | null>(returnState?.camera ?? null);
  const restoredReturn = React.useRef(false);
  const canvasCoordinator = React.useRef<ReturnType<typeof observeMapCanvas> | null>(null);
  const buildingReadingStates = React.useMemo(() => new Map<string, BuildingReadingState>(Object.entries((readingStore.buildings ?? {}) as Record<string, BuildingReadingState>)), [readingScope, readingStore]);
  userRoleRef.current = userRole;

  const preferenceKey = currentUserId ? `broker-map:v1:${JSON.stringify([currentUserId, userRole, getImpersonationTargetUserId()])}` : '';
  const [savedPreferences] = React.useState(() => !initialIntelligenceHandoff && !queryContext && preferenceKey ? readMapFilterPreference(preferenceKey) : null);
  const initialFilters = queryContext ? { ...createDefaultFilterState(), showFutureSupply: false } : initialIntelligenceHandoff?.filterState ?? returnState?.filters ?? savedPreferences?.filters ?? null;

  const [allBuildings, setAllBuildings] = React.useState<any[]>([]);
  const [futureLoaded, setFutureLoaded] = React.useState(false);
  const [futureSupplies, setFutureSupplies] = React.useState<any[]>([]);
  const [displayOverrides, setDisplayOverrides] = React.useState<Map<string, Map<string, { display_label: string; display_value: string }>>>(new Map());
  const [filterState, setFilterState] = React.useState<SidebarFilterState | null>(() => initialFilters);
  const [filterCommand, setFilterCommand] = React.useState<SidebarFilterCommand | null>(() => initialFilters
    ? { id: 1, type: 'patch', patch: initialFilters }
    : null);
  const [compareGroups, setCompareGroups] = React.useState<CompareGroup[]>(returnState?.groups ?? []);
  const activeCompareGroups = React.useMemo(() => getConfiguredCompareGroups(compareGroups), [compareGroups]);
  const mapDataStoreRef = React.useRef(new MapDataStore());

  // 管理员编辑楼宇指标数据弹窗状态
  const [editingBuilding, setEditingBuilding] = React.useState<{ id: string; name: string } | null>(null);
  
  // 🌟 Phase 1: 状态提升 - 将过滤后的楼宇数据提升为组件状态
  const [filteredBuildings, setFilteredBuildings] = React.useState<any[]>([]);
  // 🌟 新增：过滤后的未来供应数据
  const [filteredFutureSupplies, setFilteredFutureSupplies] = React.useState<any[]>([]);
  // 🌟 竞品分析模式：当有值时，列表显示竞品楼宇而非过滤结果
  const [competitorBuildings, setCompetitorBuildings] = React.useState<any[] | null>(null);
  const [targetBuildingId, setTargetBuildingId] = React.useState<string | null>(null);
  // Update synchronously on native map events so delayed supply reads cannot redraw F while comparing.
  const competitorModeRef = React.useRef(false);

  // 监听竞品分析事件（联动地图与列表）
  React.useEffect(() => {
    const onFound = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      // CL-013: 新格式 { buildings, targetBuildingId }，兼容旧格式
      if (Array.isArray(detail)) {
        competitorModeRef.current = true;
        setCompetitorBuildings(detail);
        setTargetBuildingId(null);
      } else if (detail && Array.isArray(detail.buildings)) {
        competitorModeRef.current = true;
        setCompetitorBuildings(detail.buildings);
        setTargetBuildingId(detail.targetBuildingId || null);
      }
    };
    const onCleared = () => { competitorModeRef.current = false; setCompetitorBuildings(null); setTargetBuildingId(null); };
    window.addEventListener('competitors-found', onFound);
    window.addEventListener('competitors-cleared', onCleared);
    return () => {
      window.removeEventListener('competitors-found', onFound);
      window.removeEventListener('competitors-cleared', onCleared);
    };
  }, []);

  // 监听管理员编辑楼宇指标数据事件
  React.useEffect(() => {
    const handleEditBuildingMetrics = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail?.buildingId && detail?.buildingName) {
        setEditingBuilding({
          id: detail.buildingId,
          name: detail.buildingName,
        });
      }
    };

    window.addEventListener('editBuildingMetrics', handleEditBuildingMetrics);
    return () => {
      window.removeEventListener('editBuildingMetrics', handleEditBuildingMetrics);
    };
  }, []);

  // 🌟 合并现有楼宇和未来供应数据到一个列表中
  const combinedBuildingList = React.useMemo(() => {
    // 竞品分析模式：只显示竞品楼宇
    if (competitorBuildings) {
      return competitorBuildings.map(b => ({ ...b, _dataType: 'existing' }));
    }
    const existingWithType = filteredBuildings.map(b => ({ ...b, _dataType: 'existing' }));
    const futureWithType = filteredFutureSupplies.map(f => ({ ...f, _dataType: 'future' }));
    return [...existingWithType, ...futureWithType];
  }, [filteredBuildings, filteredFutureSupplies, competitorBuildings]);
  // Keep the synchronous event ref aligned with the committed React state.
  React.useEffect(() => {
    competitorModeRef.current = competitorBuildings !== null;
  }, [competitorBuildings]);

  // 🌟 Phase 1: 悬浮列表可见性控制
  const [workspace, dispatchWorkspace] = React.useReducer(workspaceReducer, initialWorkspaceState);
  const [buildingDetail, setBuildingDetail] = React.useState<WorkspaceBuildingDetail | null>(null);
  const restoringResearchRef = React.useRef(false);
  const workspaceRef = React.useRef(workspace);
  workspaceRef.current = workspace;
  const isListVisible = workspace.right?.kind === 'list' || workspace.right?.kind === 'compare';
  const [, setUserHasInteracted] = React.useState(Boolean(initialIntelligenceHandoff));
  const isSupplyOpen = workspace.right?.kind === 'supply';
  const isFilterPanelOpen = workspace.leftOpen;
  const setIsFilterPanelOpen = React.useCallback((open: boolean) => dispatchWorkspace({ type: 'left', open }), []);
  const researchView = [workspace.right, ...workspace.history.slice().reverse()].find(view => view?.kind === 'submarket');
  const selectedSubmarket = researchView?.kind === 'submarket' ? researchView.name : null;

  const selectedSummary = React.useMemo(() => selectedSubmarket
    ? submarketSummary(allBuildings, selectedSubmarket) : null, [allBuildings, selectedSubmarket]);
  const selectedFutureCount = React.useMemo(() => selectedSubmarket
    ? futureSupplies.filter(supply => !isPendingFutureSupply(supply)
      && normalizeMapSubmarket(supply.submarket) === selectedSubmarket).length : 0,
    [futureSupplies, selectedSubmarket]);

  const activeFilterChips = React.useMemo(() => buildActiveFilterChips(filterState), [filterState]);

  const issueFilterCommand = React.useCallback((type: SidebarFilterCommand['type'], patch?: Partial<SidebarFilterState>) => {
    setFilterState(previous => type === 'reset' ? createDefaultFilterState() : { ...(previous ?? createDefaultFilterState()), ...patch });
    if (type === 'reset') setCompareGroups([]);
    setFilterCommand(previous => ({ id: (previous?.id ?? 0) + 1, type, patch }));
  }, []);
  
  const [searchInput, setSearchInput] = React.useState(returnState?.input ?? savedPreferences?.input ?? '');
  React.useEffect(() => {
    if (!preferenceKey || initialIntelligenceHandoff || buildingFocus || queryContext) return;
    try {
      // Station objects belong to the live SDK; persist user-entered criteria only.
      const filters = filterState ? { ...filterState, subwayLine: filterState.subwayStation ? null : filterState.subwayLine, subwayStation: null } : null;
      window.sessionStorage.setItem(preferenceKey, JSON.stringify({ input: searchInput.slice(0, 200), filters }));
    } catch { /* Map filtering remains available when storage is blocked. */ }
  }, [preferenceKey, buildingFocus, initialIntelligenceHandoff, queryContext, filterState, searchInput]);
  const keyword = searchInput.trim();
  const fullListFilterKey = React.useMemo(() => JSON.stringify([keyword, filterState, compareGroups]), [keyword, filterState, compareGroups]);
  const [settledFullListFilterKey, setSettledFullListFilterKey] = React.useState<string | null>(null);
  const [fullListWarning, setFullListWarning] = React.useState<string | null>(null);
  const fullBuildingList = React.useMemo<FullListBuilding[]>(() => {
    if (competitorBuildings) return competitorBuildings.map(building => ({ ...building, _dataType: 'existing' }));
    return [
      ...filteredBuildings.map(building => ({ ...building, _dataType: 'existing' as const })),
      ...filteredFutureSupplies.map(building => ({ ...building, _dataType: 'future' as const })),
    ];
  }, [competitorBuildings, filteredBuildings, filteredFutureSupplies]);
  const fullListQueryKey = React.useMemo(() => JSON.stringify([fullListFilterKey, competitorBuildings?.map(building => building.id) ?? null]), [fullListFilterKey, competitorBuildings]);
  const [searchSubmitRevision, setSearchSubmitRevision] = React.useState(0);
  const previousSearchSubmitRef = React.useRef(0);
  const hadActiveFiltersRef = React.useRef(false);
  
  const [currentSubwayStations, setCurrentSubwayStations] = React.useState<any[]>([]);
  const lastFetchedLine = React.useRef<string | null>(null);
  const intelligenceAutoFitDoneRef = React.useRef(false);
  const intelligenceAuditDoneRef = React.useRef(false);
  const filterAuditTimerRef = React.useRef<number | null>(null);
  const pendingFilterAuditRef = React.useRef<SidebarFilterState | null>(null);
  const [intelligenceCandidatesResolved, setIntelligenceCandidatesResolved] = React.useState(false);

  const queueSettledFilterAudit = React.useCallback((state: SidebarFilterState) => {
    pendingFilterAuditRef.current = state;
    if (filterAuditTimerRef.current) window.clearTimeout(filterAuditTimerRef.current);
    filterAuditTimerRef.current = window.setTimeout(() => {
      const settled = pendingFilterAuditRef.current;
      pendingFilterAuditRef.current = null;
      filterAuditTimerRef.current = null;
      if (!settled) return;
      logAction(undefined, 'MAP_FILTER', {
        filter: JSON.stringify(settled),
        settled: true,
        target_name: '地图筛选',
      });
    }, 900);
  }, []);

  React.useEffect(() => () => {
    if (filterAuditTimerRef.current) window.clearTimeout(filterAuditTimerRef.current);
    const settled = pendingFilterAuditRef.current;
    pendingFilterAuditRef.current = null;
    if (settled) {
      logAction(undefined, 'MAP_FILTER', {
        filter: JSON.stringify(settled),
        settled: true,
        source: 'unmount_flush',
        target_name: '地图筛选',
      });
    }
  }, []);

  React.useEffect(() => {
    if (!initialIntelligenceHandoff || intelligenceAuditDoneRef.current) return;
    intelligenceAuditDoneRef.current = true;
    logAction(undefined, 'MAP_FILTER', {
      source: 'intelligence',
      applied_capabilities: initialIntelligenceHandoff.appliedCapabilities,
      filter: JSON.stringify(initialIntelligenceHandoff.filterState),
    });
  }, [initialIntelligenceHandoff]);

  const [mapError, setMapError] = React.useState<string | null>(null);
  const [mapDataLoading, setMapDataLoading] = React.useState(false);
  const filterFrameSchedulerRef = React.useRef<LatestFrameScheduler | null>(null);
  const futureSupplyRequestTokenRef = React.useRef(0);
  const hoveredBuildingIdRef = React.useRef<string | null>(null);
  const listNavigationTokenRef = React.useRef(0);
  const pendingNavigationTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingNavigationFrameRef = React.useRef<number | null>(null);
  const cancelPendingBuildingNavigation = React.useCallback(() => {
    listNavigationTokenRef.current += 1;
    if (pendingNavigationTimerRef.current !== null) clearTimeout(pendingNavigationTimerRef.current);
    if (pendingNavigationFrameRef.current !== null) window.cancelAnimationFrame(pendingNavigationFrameRef.current);
    pendingNavigationTimerRef.current = null;
    pendingNavigationFrameRef.current = null;
  }, []);
  const { view: workspaceView, revision: workspaceRevision, listVisited: hasVisitedFullList, viewRef: workspaceViewRef, changeView: changeWorkspaceView } = useMapWorkspaceView(cancelPendingBuildingNavigation);
  React.useEffect(() => cancelPendingBuildingNavigation, [cancelPendingBuildingNavigation]);
  React.useEffect(() => { cancelPendingBuildingNavigation(); }, [fullListFilterKey, competitorBuildings, cancelPendingBuildingNavigation]);


  const getFilterFrameScheduler = React.useCallback(() => {
    if (!filterFrameSchedulerRef.current) {
      filterFrameSchedulerRef.current = createLatestFrameScheduler(
        callback => window.requestAnimationFrame(callback),
        frameId => window.cancelAnimationFrame(frameId),
      );
    }
    return filterFrameSchedulerRef.current;
  }, []);

  const loadMapData = React.useCallback(async (
    controller: MapController,
    isCancelled: () => boolean = () => false,
  ) => {
    setMapDataLoading(true);
    setSettledFullListFilterKey(null);
    futureSupplyRequestTokenRef.current += 1;
    setMapError(null);

    try {
      recordMapStartup('stock_read_start');
      const buildings = await retryAsync(
        () => controller.fetchMapData(),
        { attempts: 3, baseDelayMs: 300, maxDelayMs: 800 },
      );
      if (isCancelled()) return;
      if (!Array.isArray(buildings) || buildings.length === 0) {
        throw new Error('服务器没有返回楼宇数据');
      }

      // viewer/editor/admin 读取同一楼宇范围；角色差异只体现在业务写权限。索引只构建一次。
      const role = userRoleRef.current;
      mapDataStoreRef.current.replaceBuildings(buildings);
      const visible = mapDataStoreRef.current.getRoleVisible(role);
      recordMapStartup('stock_data_ready');
      setAllBuildings(visible);
      setDisplayOverrides(controller.getDisplayOverridesCache());
    } catch (error) {
      if (isCancelled()) return;
      console.error('[MapClient] 楼宇数据重试后仍加载失败:', error);
      const message = error instanceof Error ? error.message : '未知错误';
      setMapError(`楼宇数据加载失败：${message}`);
    } finally {
      if (!isCancelled()) setMapDataLoading(false);
    }
  }, []);

  const { controllerRef, mapReady } = useMapRuntime({
    enabled: allowed,
    containerId: 'map-container',
    userRole,
    currentUserId,
    onEditBuildingMetrics: (buildingId, buildingName) => {
      setEditingBuilding({ id: buildingId, name: buildingName });
    },
    onReady: async (controller, isCancelled) => {
      controller.setWorkspaceDetailHandler(detail => {
        if (isCancelled()) return;
        cancelPendingBuildingNavigation();
        if (window.innerWidth < 1000) dispatchWorkspace({ type: 'left', open: false });
        setBuildingDetail(detail);
        dispatchWorkspace({ type: 'open', view: { kind: 'building', building: detail.building } });
        window.dispatchEvent(new CustomEvent('map-workspace-selection', { detail: detail.building }));
      });
      // Both reads are independent; future supply must not delay stock startup.
      const [_, future] = await Promise.allSettled([
        loadMapData(controller, isCancelled),
        queryContext ? Promise.resolve([]) : controller.fetchFutureSupplies(),
      ]);
      if (!isCancelled()) setFutureLoaded(true);
      if (!isCancelled() && future.status === 'fulfilled') {
        setFutureSupplies(future.value);
      }
    },
    onError: setMapError,
  });

  React.useEffect(() => {
    const controller = controllerRef.current;
    const container = document.getElementById('map-container');
    if (!mapReady || !controller || !container) return;
    const coordinator = observeMapCanvas(container, controller.map);
    canvasCoordinator.current = coordinator;
    return () => { coordinator(); canvasCoordinator.current = null; };
  }, [controllerRef, mapReady]);

  const lastCameraTarget = React.useRef('');
  React.useEffect(() => {
    const view = workspace.right;
    const controller = controllerRef.current;
    if (!view || workspace.focus) { lastCameraTarget.current = ''; canvasCoordinator.current?.cancel(); return; }
    if (!mapReady || !controller || !canvasCoordinator.current) return;
    const key = view.kind === 'building' ? `building:${view.building.id}` : view.kind === 'submarket' ? `submarket:${view.name}` : '';
    if (!key || key === lastCameraTarget.current) return;
    lastCameraTarget.current = key;
    if (view.kind === 'building' && hasBuildingLocation(view.building)) {
      canvasCoordinator.current.focus({ center: [view.building.location_lng!, view.building.location_lat!], camera: restoreCamera.current });
      restoreCamera.current = null;
    } else if (view.kind === 'submarket') {
      const matches = allBuildings.filter(building => normalizeMapSubmarket(building.submarket) === view.name && hasBuildingLocation(building));
      if (matches.length) canvasCoordinator.current.focus({ fit: () => controller.fitToBuildings(matches) });
    }
  }, [workspace.right, workspace.focus, allBuildings, controllerRef, mapReady]);

  const researchExitGuard = React.useRef<(() => boolean) | null>(null);
  const registerResearchExitGuard = React.useCallback((guard: (() => boolean) | null) => { researchExitGuard.current = guard; }, []);
  const closeWorkspace = React.useCallback(() => {
    if (researchExitGuard.current && !researchExitGuard.current()) return;
    const snapshot = workspaceRef.current.research;
    if (snapshot && !snapshot.retained) {
      restoringResearchRef.current = true;
      setSearchInput(snapshot.input);
      setFilterState(snapshot.filters);
      issueFilterCommand('patch', snapshot.filters);
      const map = controllerRef.current?.map;
      if (snapshot.center && snapshot.zoom !== undefined) map?.setZoomAndCenter?.(snapshot.zoom, snapshot.center, true);
    }
    controllerRef.current?.closeWorkspaceBuilding?.();
    dispatchWorkspace({ type: 'close' });
    dispatchWorkspace({ type: 'end-research' });
    window.dispatchEvent(new CustomEvent('map-workspace-selection', { detail: null }));
    controllerRef.current?.disposeWorkspaceTrend?.();
  }, [controllerRef, issueFilterCommand]);
  const setIsListVisible = React.useCallback((open: boolean) => {
    if (open) { if (window.innerWidth < 1000) dispatchWorkspace({ type: 'left', open: false }); dispatchWorkspace({ type: 'open', view: { kind: 'list' } }); }
    else if (workspaceRef.current.right?.kind === 'list' || workspaceRef.current.right?.kind === 'compare') closeWorkspace();
  }, [closeWorkspace]);
  const setIsSupplyOpen = React.useCallback((open: boolean) => {
    if (open) { if (window.innerWidth < 1000) dispatchWorkspace({ type: 'left', open: false }); dispatchWorkspace({ type: 'open', view: { kind: 'supply' } }); }
    else if (workspaceRef.current.right?.kind === 'supply') closeWorkspace();
  }, [closeWorkspace]);
  React.useEffect(() => {
    if (workspace.right?.kind !== 'building') controllerRef.current?.closeWorkspaceBuilding?.();
  }, [workspace.right?.kind, controllerRef]);
  const disposeDetailTrend = React.useCallback(() => controllerRef.current?.disposeWorkspaceTrend?.(), [controllerRef]);

  React.useEffect(() => {
    const open = (event: Event) => {
      const name = normalizeMapSubmarket((event as CustomEvent<{ name?: string }>).detail?.name);
      if (!name || name === '其他') return;
      if (researchExitGuard.current && !researchExitGuard.current()) return;
      cancelPendingBuildingNavigation();
      const map = controllerRef.current?.map;
      const center = map?.getCenter?.();
      if (window.innerWidth < 1000) dispatchWorkspace({ type: 'left', open: false });
      dispatchWorkspace({ type: 'research', name, snapshot: {
        filters: filterState ?? createDefaultFilterState(), input: searchInput,
        center: center ? [center.getLng?.() ?? center.lng, center.getLat?.() ?? center.lat] : undefined,
        zoom: map?.getZoom?.(), retained: false,
      } });
      controllerRef.current?.closeWorkspaceBuilding?.();
      const next = { ...(filterState ?? createDefaultFilterState()), submarkets: [name] };
      setFilterState(next);
      issueFilterCommand('patch', next);
      setUserHasInteracted(true);
      controllerRef.current?.clearCompetitorElements?.();
      window.dispatchEvent(new CustomEvent('map-workspace-selection', { detail: null }));
    };
    window.addEventListener('map-submarket-open', open);
    return () => window.removeEventListener('map-submarket-open', open);
  }, [controllerRef, filterState, searchInput, issueFilterCommand, cancelPendingBuildingNavigation]);

  React.useEffect(() => {
    return () => filterFrameSchedulerRef.current?.cancel();
  }, []);

  const [stats, setStats] = React.useState<MapStatsState>({ totalArea: '-', avgRent: '-', overallVacancyPct: '-', projectCount: '-', visibleProjectCount: '-' });
  
  const districtLeedStats = React.useMemo(() => buildDistrictLeedStats(allBuildings), [allBuildings]);
  
  const scopedFutureSupplies = React.useMemo(() => filterState?.submarkets.length === 1
    ? futureSupplies.filter(supply => normalizeMapSubmarket(supply.submarket) === filterState.submarkets[0]) : futureSupplies, [filterState, futureSupplies]);
  const futureSupplyCalendar = React.useMemo(() => buildFutureSupplyCalendar(scopedFutureSupplies), [scopedFutureSupplies]);
  React.useEffect(() => {
    if (mapReady) controllerRef.current?.setWorkspaceSubmarket?.(filterState?.submarkets.length === 1 ? filterState.submarkets[0] : null);
  }, [controllerRef, mapReady, filterState]);
  
  // 新增：地图标记渲染模式状态
  const [renderMode, setRenderMode] = React.useState<RenderMode>(returnState?.mode ?? 'default');
  const showAreaPlaceholders = !keyword && activeCompareGroups.length === 0
    && !initialIntelligenceHandoff && !queryContext && (filterState === null || isDefaultStockFilterState(filterState));

  // 🌟 CL-011: 退出周边项目对比时，恢复之前的地图标记
  const prevCompetitorRef = React.useRef(competitorBuildings);
  React.useEffect(() => {
    if (prevCompetitorRef.current !== null && competitorBuildings === null && controllerRef.current && mapReady) {
      const ctrl = controllerRef.current;
      ctrl.renderMarkers(filteredBuildings, renderMode, districtLeedStats, activeCompareGroups.length > 0 ? activeCompareGroups : undefined, showAreaPlaceholders);
      if ((filterState?.showFutureSupply ?? true) && filteredFutureSupplies.length > 0) {
        ctrl.renderFutureMarkers(filteredFutureSupplies, renderMode);
      }
    }
    prevCompetitorRef.current = competitorBuildings;
  }, [competitorBuildings, filteredBuildings, filteredFutureSupplies, renderMode, districtLeedStats, activeCompareGroups, mapReady, showAreaPlaceholders, filterState, allBuildings]);

  // 新增：开发者工具状态
  const [isExporting, setIsExporting] = React.useState(false);

  // 用户交互筛选后的过滤逻辑
  React.useEffect(() => {
    const scheduler = getFilterFrameScheduler();
    const futureSupplyRequestToken = ++futureSupplyRequestTokenRef.current;
    if (!mapReady || !controllerRef.current || allBuildings.length === 0) {
      scheduler.cancel();
      return;
    }

    scheduler.schedule(() => {
      const ctrl = controllerRef.current;
      if (!ctrl) return;
      const activeFilterState = filterState ?? createDefaultFilterState();

    // Keyword edits must not implicitly end an active competitor session.
    if (!activeFilterState.showFutureSupply) ctrl.clearFutureMarkers?.();

    if (activeFilterState.showBoundaries) {
      const distToDraw = activeFilterState.districts?.length > 0 ? activeFilterState.districts : MOCK_DISTRICTS;
      ctrl.drawDistrictBoundaries(distToDraw);
    } else {
      ctrl.clearDistrictBoundaries();
    }

    if (activeFilterState.subwayLine) {
      if (lastFetchedLine.current !== activeFilterState.subwayLine) {
         const lineToFetch = activeFilterState.subwayLine;
         lastFetchedLine.current = lineToFetch;
         setCurrentSubwayStations(prev => prev.length > 0 ? [] : prev);
         ctrl.fetchAndDrawSubwayLine(lineToFetch).then((stations: any[]) => {
           // 竞态保护：如果用户已切换到其他线路，跳过
           if (lastFetchedLine.current === lineToFetch) {
             setCurrentSubwayStations(stations);
           }
         });
      }
      if (activeFilterState.subwayStation && activeFilterState.subwayDistance) {
         ctrl.drawSubwayRadius(activeFilterState.subwayStation, activeFilterState.subwayDistance);
      } else {
         if (ctrl.radiusCircle) { ctrl.map.remove(ctrl.radiusCircle); ctrl.radiusCircle = null; }
         if (ctrl.stationMarker) { ctrl.map.remove(ctrl.stationMarker); ctrl.stationMarker = null; }
      }
    } else {
      lastFetchedLine.current = null;
      ctrl.clearSubwayElements();
      setCurrentSubwayStations(prev => prev.length > 0 ? [] : prev);
    }

    // ================ 核心过滤引擎 ================
    // An explicit authorized identity remains visible when its grade/district is
    // unknown; the default category checkboxes must not silently drop it. Any
    // deliberate narrowing/search continues through the existing filter engine.
    const exactQueryGroup = queryContext && !keyword && activeCompareGroups.length === 0 && isDefaultStockFilterState(activeFilterState);
    const filtered = (exactQueryGroup ? mapDataStoreRef.current.getRoleVisible(userRoleRef.current) : mapDataStoreRef.current.filter({
      filterState: activeFilterState,
      compareGroups,
      keyword,
      role: userRoleRef.current,
      calculateDistance: (buildingPoint, stationPoint) => ctrl.calculateDistance(buildingPoint, stationPoint),
    })).filter(building => activeFilterState.submarkets.length !== 1 || activeFilterState.submarkets.includes(normalizeMapSubmarket(building.submarket)))
      .filter(building => !queryContext || queryIds.has(building.id)
      && Number.isFinite(building.location_lng) && Number.isFinite(building.location_lat)
      && Math.abs(building.location_lng) <= 180 && Math.abs(building.location_lat) <= 90);

    // 🌟 Phase 1: 将过滤结果同步到组件状态，供悬浮列表使用
    setFilteredBuildings(filtered);
    setFullListWarning(null);
    // A hidden future-supply layer must not return invisible search matches.
    const loadFuture = activeFilterState.showFutureSupply && !queryContext;
    // Changing the draft filters results only; a deliberate Enter/button search relocates the map.
    const shouldFitSearch = Boolean(keyword) && searchSubmitRevision !== previousSearchSubmitRef.current;
    const fitSubmittedSearch = (matches: FullListBuilding[]) => {
      if (!shouldFitSearch || competitorModeRef.current || workspaceViewRef.current !== 'map') return;
      const targets = searchViewportTargets(matches, keyword);
      if (targets.length > 0) ctrl.fitToBuildings(targets as Parameters<typeof ctrl.fitToBuildings>[0]);
    };
    if (!loadFuture) setSettledFullListFilterKey(fullListFilterKey);
    if (initialIntelligenceHandoff && !intelligenceCandidatesResolved) {
      setIntelligenceCandidatesResolved(true);
    }

    // 竞品分析模式下跳过地图标记渲染，避免覆盖竞品标记
    if (!competitorModeRef.current) {
      if (filtered.length > 0) recordMapStartup('stock_render_start');
      ctrl.renderMarkers(filtered, renderMode, districtLeedStats, activeCompareGroups.length > 0 ? activeCompareGroups : undefined, showAreaPlaceholders);
      if (filtered.length > 0) recordMapStartup('stock_render_returned');
    }
    setStats(computeStatsFromBuildings(filtered));
    if (queryContext && querySelection && !mapDataLoading && queryFit.current !== JSON.stringify(queryContext)) {
      queryFit.current = JSON.stringify(queryContext);
      const located = filtered.filter(building => querySelection.buildings.some(row => row.id === building.id && row.located));
      if (located.length) {
        ctrl.fitToBuildings(located);
        if (queryContext.details && located.length === 1) ctrl.openBuildingInfoWindow(located[0].id);
      }
    }

    if (initialIntelligenceHandoff && !intelligenceAutoFitDoneRef.current && filtered.length > 0) {
      intelligenceAutoFitDoneRef.current = true;
      ctrl.fitToBuildings(filtered);
    }

    // ================= 🌟 未来新增供应分支逻辑 (修复后) =================
    if (loadFuture) {
      setSettledFullListFilterKey(null);
      void (async () => {
        try {
          const supplies = await ctrl.fetchFutureSupplies();
          if (futureSupplyRequestToken !== futureSupplyRequestTokenRef.current) return;
          const filteredSupplies = filterFutureSupplies(
            supplies,
            activeFilterState,
            keyword,
            (buildingPoint, stationPoint) => ctrl.calculateDistance(buildingPoint, stationPoint),
          ).filter(supply => activeFilterState.submarkets.length !== 1 || activeFilterState.submarkets.includes(normalizeMapSubmarket(supply.submarket)));

          if (futureSupplyRequestToken !== futureSupplyRequestTokenRef.current) return;
          setFilteredFutureSupplies(filteredSupplies);
          setSettledFullListFilterKey(fullListFilterKey);
          if (!competitorModeRef.current) {
            ctrl.renderFutureMarkers(filteredSupplies, renderMode);
            fitSubmittedSearch([
              ...filtered.map(building => ({ ...building, _dataType: 'existing' as const })),
              ...filteredSupplies
                .filter(supply => typeof supply.id === 'string' && supply.id.length > 0)
                .map(supply => ({ ...supply, id: supply.id as string, _dataType: 'future' as const })),
            ]);
          }
        } catch (e) {
          if (futureSupplyRequestToken !== futureSupplyRequestTokenRef.current) return;
          console.error('[MapClient] future supply fetch/render failed', e);
          setFilteredFutureSupplies([]);
          setFullListWarning('未来供应暂时无法读取，当前仅显示存量楼宇。');
          setSettledFullListFilterKey(fullListFilterKey);
          fitSubmittedSearch(filtered);
        }
      })();
    } else {
      setFilteredFutureSupplies([]);
    }

    // 筛选只改变显示内容，不应移动用户正在查看的地图视野。
    // 当用户从任意筛选状态恢复为默认条件时，才回到初始大气泡总览。
    const hasActiveFilters = !isDefaultStockFilterState(activeFilterState);
    if (!restoringResearchRef.current && !hasActiveFilters && hadActiveFiltersRef.current && !keyword) {
      ctrl.resetToDefaultView?.();
    }
    hadActiveFiltersRef.current = hasActiveFilters;
    restoringResearchRef.current = false;

    if (!loadFuture) fitSubmittedSearch(filtered);
    previousSearchSubmitRef.current = searchSubmitRevision;
    });

  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterState, keyword, searchSubmitRevision, allBuildings, mapReady, renderMode, districtLeedStats, compareGroups, getFilterFrameScheduler, fullListFilterKey, showAreaPlaceholders, queryContext, querySelection, queryIds, mapDataLoading]);

  const handleFilterChange = React.useCallback((state: SidebarFilterState) => {
    cancelPendingBuildingNavigation();
    const isDefault = isDefaultFilterState(state);
    const hasOtherWorkspaceState = activeCompareGroups.length > 0 || Boolean(keyword);
    setUserHasInteracted(!isDefault || hasOtherWorkspaceState);
    setFilterState(prev => {
      if (prev?.subwayLine !== state.subwayLine) setCurrentSubwayStations([]);
      return state;
    });
    if (isDefault && !hasOtherWorkspaceState) setIsListVisible(false);
    queueSettledFilterAudit(state);
  }, [activeCompareGroups.length, keyword, queueSettledFilterAudit, cancelPendingBuildingNavigation]);

  const handleCompareGroupsChange = React.useCallback((groups: CompareGroup[]) => {
    cancelPendingBuildingNavigation();
    setCompareGroups(groups);
    const hasCompareGroups = getConfiguredCompareGroups(groups).length > 0;
    const hasGlobalFilters = Boolean(filterState && !isDefaultFilterState(filterState));
    const hasSearch = Boolean(keyword);
    setUserHasInteracted(hasCompareGroups || hasGlobalFilters || hasSearch);
    if (!hasCompareGroups && !hasGlobalFilters && !hasSearch) setIsListVisible(false);
  }, [filterState, keyword, cancelPendingBuildingNavigation]);

  // 🌟 CL-013: 悬停联动 — 卡片悬停时地图 marker 弹跳
  const handleBuildingHover = React.useCallback((buildingId: string | null) => {
    if (!controllerRef.current) return;
    const ctrl = controllerRef.current;
    const previousId = hoveredBuildingIdRef.current;
    if (previousId && previousId !== buildingId) ctrl.stopBounceMarker(previousId);
    if (buildingId) {
      ctrl.bounceMarker(buildingId);
      hoveredBuildingIdRef.current = buildingId;
    } else {
      if (previousId) ctrl.stopBounceMarker(previousId);
      hoveredBuildingIdRef.current = null;
    }
  }, []);

  // 🌟 地图联动：点击列表卡片时，地图自动定位到对应楼宇并打开信息窗口
  const handleBuildingClick = React.useCallback((building: any): boolean => {
    if (workspaceViewRef.current !== 'map') return false;
    cancelPendingBuildingNavigation();
    if (!controllerRef.current || !mapReady) return false;
    
    const ctrl = controllerRef.current;
    if (building._dataType === 'future') ctrl.openFutureSupplyInfoWindow(building);
    else ctrl.openBuildingInfoWindow(building.id);

    logAction(appSession?.user?.email || '未知用户', 'VIEW_BUILDING', {
      buildingId: building.id,
      buildingName: building.name,
      dataType: building._dataType || 'existing',
    });
    return true;
  }, [appSession?.user?.email, mapReady, cancelPendingBuildingNavigation, workspaceViewRef]);

  const fullListBusy = mapDataLoading || !mapReady || settledFullListFilterKey !== fullListFilterKey;
  const handleFullListBuildingClick = React.useCallback((building: FullListBuilding) => {
    if (workspaceViewRef.current !== 'list' || fullListBusy) return;
    cancelPendingBuildingNavigation();
    changeWorkspaceView('map');
    dispatchWorkspace({ type: 'open', view: { kind: 'full-list' } });
    handleBuildingClick(building);
  }, [fullListBusy, cancelPendingBuildingNavigation, changeWorkspaceView, controllerRef, workspaceViewRef, handleBuildingClick]);

  React.useEffect(() => {
    if (!returnState || restoredReturn.current || !mapReady || mapDataLoading || !allBuildings.length) return;
    if (returnState.right?.future && !futureLoaded) return;
    restoredReturn.current = true;
    const state = restoreWorkspace(returnState, allBuildings, futureSupplies);
    if (state.right?.kind === 'building') {
      const ctrl = controllerRef.current;
      if (state.right.building._dataType === 'future') ctrl.openFutureSupplyInfoWindow(state.right.building);
      else ctrl.openBuildingInfoWindow(state.right.building.id);
    }
    dispatchWorkspace({ type: 'restore', state });
    if (state.right?.kind !== 'building' && returnState.camera) {
      canvasCoordinator.current?.focus({ center: returnState.camera.center, camera: returnState.camera, exact: true });
      restoreCamera.current = null;
    }
    if (returnState.competitors) {
      setCompetitorBuildings(allBuildings.filter(building => returnState.competitors!.includes(building.id)));
      setTargetBuildingId(returnState.target);
    }
    window.dispatchEvent(new CustomEvent('map-workspace-selection', { detail: state.right?.kind === 'building' ? state.right.building : null }));
  }, [returnState, mapReady, mapDataLoading, allBuildings, futureSupplies, futureLoaded, controllerRef]);

  const [focusStatus, setFocusStatus] = React.useState<{ key: string; found: boolean }>();
  const openedFocus = React.useRef('');
  const focusKey = buildingFocus ? JSON.stringify(buildingFocus) : '';
  React.useEffect(() => {
    const ctrl = controllerRef.current;
    if (!buildingFocus || !mapReady || !ctrl || openedFocus.current === focusKey) return;
    if (returnState && !restoredReturn.current) return;
    if (returnState?.right?.kind === 'building' && returnState.selected === buildingFocus.id && (buildingFocus.future ? futureSupplies : allBuildings).some(item => item.id === buildingFocus.id)) { openedFocus.current = focusKey; return; }
    let cancelled = false;
    const open = async () => {
      if (!buildingFocus.future && mapDataLoading) return;
      const items: typeof allBuildings = buildingFocus.future ? await ctrl.fetchFutureSupplies() : allBuildings;
      if (cancelled || controllerRef.current !== ctrl) return;
      const item = items.find(entry => entry.id === buildingFocus.id);
      if (!item) { setFocusStatus({ key: focusKey, found: false }); return; }
      openedFocus.current = focusKey;
      changeWorkspaceView('map');
      if (buildingFocus.future) ctrl.openFutureSupplyInfoWindow(item);
      else ctrl.openBuildingInfoWindow(item.id);
      if (!buildingFocus.future && buildingFocus.section) {
        window.dispatchEvent(new CustomEvent('broker:building-section', {
          detail: { id: item.id, name: item.name, section: buildingFocus.section },
        }));
      }
      setFocusStatus({ key: focusKey, found: true });
    };
    void open().catch(() => { if (!cancelled) setFocusStatus({ key: focusKey, found: false }); });
    return () => { cancelled = true; };
  }, [buildingFocus, focusKey, allBuildings, changeWorkspaceView, controllerRef, mapDataLoading, mapReady, returnState, workspace.right, futureSupplies]);

  // 🌟 2. 抽离出的地图搜索处理函数及埋点逻辑
  const handleSearch = (val: string) => {
    const trimmed = val.trim();
    // The input already applied this keyword. A late debounce must not cancel
    // a project detail selected from the search results in the meantime.
    if (trimmed !== keyword) cancelPendingBuildingNavigation();
    // Submitting the current query must not rewrite the draft or move its caret.
    setSearchInput(current => current.trim() === trimmed ? current : val);
    const hasGlobalFilters = Boolean(filterState && !isDefaultFilterState(filterState));
    const hasCompareGroups = activeCompareGroups.length > 0;
    setUserHasInteracted(Boolean(trimmed) || hasGlobalFilters || hasCompareGroups);
    // Clearing search is handled synchronously by onKeywordChange. A late
    // debounce cannot close a list the user explicitly opened afterwards.
    if (trimmed) {
      logAction(appSession?.user?.email || '未知用户', 'SEARCH', { keyword: trimmed, module: 'map' });
    }
  };

  const handleSearchSubmit = (val: string) => {
    cancelPendingBuildingNavigation();
    handleSearch(val);
    if (val.trim()) setSearchSubmitRevision(previous => previous + 1);
  };

  const handleRenderModeChange = React.useCallback((mode: RenderMode) => {
    if (competitorBuildings !== null) controllerRef.current?.clearCompetitorElements?.();
    setRenderMode(mode);
  }, [competitorBuildings]);

  const handleResetAllFilters = React.useCallback(() => {
    setSearchInput('');
    issueFilterCommand('reset');
  }, [issueFilterCommand]);

  // 新增：一键导出地图数据
  const handleExportMapData = async () => {
    if (!controllerRef.current || !mapReady) {
      alert('地图尚未初始化完成，请稍后再试');
      return;
    }

    setIsExporting(true);
    try {
      const { downloadAmapData } = await import('@/src/utils/exportMapData');
      const AMap = (window as any).AMap;
      await downloadAmapData(controllerRef.current.getMapInstance(), AMap);
      logAction(appSession?.user?.email || '未知用户', 'EXPORT_MAP_DATA', {});
      alert('✅ 数据导出成功！请将下载的 beijing_map_data.json 文件放到 public/data/ 目录下');
    } catch (error) {
      console.error('导出失败:', error);
      alert('❌ 数据导出失败: ' + (error instanceof Error ? error.message : '未知错误'));
    } finally {
      setIsExporting(false);
    }
  };

  const showSubmarketBuildings = () => {
    if (!selectedSubmarket) return;
    dispatchWorkspace({ type: 'open', view: { kind: 'list' } });
  };

  const saveReturnRef = React.useRef(() => {});
  saveReturnRef.current = () => {
    if (!allowed || queryContext || initialIntelligenceHandoff) return;
    const map = controllerRef.current?.map;
    const center = map?.getCenter?.();
    const point: [number, number] | null = center ? [center.getLng?.() ?? center.lng ?? center[0], center.getLat?.() ?? center.lat ?? center[1]] : null;
    readingStore.buildings = Object.fromEntries(buildingReadingStates);
    const snapshot: MapReturnSnapshot = {
      savedAt: Date.now(), selected: workspace.right?.kind === 'building' ? workspace.right.building.id : null,
      camera: point && point.every(Number.isFinite) ? { center: point, zoom: map?.getZoom?.() ?? 14 } : null,
      mode: renderMode, input: searchInput.slice(0, 200),
      filters: filterState ? { ...filterState, subwayLine: filterState.subwayStation ? null : filterState.subwayLine, subwayStation: null } : null,
      right: compactView(workspace.right), history: workspace.history.map(compactView).filter((item): item is NonNullable<typeof item> => Boolean(item)),
      leftOpen: workspace.leftOpen, widths: workspace.widths, reading: readingStore,
      comparison: [], competitors: competitorBuildings?.map(building => building.id) ?? null, target: targetBuildingId,
      groups: compareGroups,
      research: workspace.research ? { ...workspace.research, filters: { ...workspace.research.filters, subwayStation: null } } : null,
    };
    saveMapReturn(readingScope, returnToken, snapshot);
    rememberMapEntry(returnToken);
  };
  React.useEffect(() => {
    const save = () => saveReturnRef.current();
    // Capture before client navigation, middle-click or a new-tab context menu.
    const leave = (event: Event) => { if ((event.target as Element)?.closest?.('a[href]')) save(); };
    window.addEventListener('map-workspace-save-return', save); window.addEventListener('pagehide', save); document.addEventListener('click', leave, true);
    document.addEventListener('auxclick', leave, true); document.addEventListener('contextmenu', leave, true);
    return () => { window.removeEventListener('map-workspace-save-return', save); window.removeEventListener('pagehide', save); document.removeEventListener('click', leave, true);
      document.removeEventListener('auxclick', leave, true); document.removeEventListener('contextmenu', leave, true); };
  }, []);
  const restoredComparisonBuildings = React.useMemo(() => {
    if (!futureLoaded || !returnState?.reading.comparisonIds) return [];
    const selected = new Set(returnState.reading.comparisonIds);
    return [...allBuildings, ...futureSupplies.map(building => ({ ...building, _dataType: 'future' as const }))]
      .filter(building => selected.has(`${building._dataType === 'future' ? 'future' : 'existing'}:${building.id}`));
  }, [futureLoaded, returnState, allBuildings, futureSupplies]);
  const stackingBack = buildingDetail ? `/map?building=${encodeURIComponent(buildingDetail.building.id)}&resume=${returnToken}` : undefined;

  if (!allowed) return <MapLoadingShell />;

  return (
    <MapReadingContext.Provider value={readingStore}>
      <MapWorkbenchView
        restoredComparisonBuildings={restoredComparisonBuildings}
        comparisonIdentityKey={readingScope}
        rightView={workspace.right}
        rightKind={workspace.right?.kind}
        rightWidth={workspace.width}
        rightWidths={workspace.widths}
        focusMode={workspace.focus}
        onWorkspaceWidth={(width, kind) => dispatchWorkspace({ type: 'width', width, kind })}
        onFocusModeChange={() => dispatchWorkspace({ type: 'focus' })}
        onWorkspaceClose={closeWorkspace}
        backLabel={workspace.history.length ? ({ submarket: '子市场研究', list: '项目列表', supply: '未来供应', search: '搜索结果', compare: '楼宇比较', building: '楼宇详情', 'full-list': '完整列表' })[workspace.history.at(-1)!.kind] : null}
        onWorkspaceBack={() => {
          disposeDetailTrend();
          if (workspace.history.at(-1)?.kind === 'full-list') { changeWorkspaceView('list'); dispatchWorkspace({ type: 'close' }); }
          else {
            const previous = workspace.history.at(-1);
            dispatchWorkspace({ type: 'back' });
            if (previous?.kind === 'building') handleBuildingClick(previous.building);
            else controllerRef.current?.closeWorkspaceBuilding?.();
          }
          window.dispatchEvent(new CustomEvent('map-workspace-selection', { detail: workspace.history.at(-1)?.kind === 'building' ? (workspace.history.at(-1) as { kind: 'building'; building: FullListBuilding }).building : null }));
        }}
        buildingDetailPanel={buildingDetail && workspace.right?.kind === 'building' ? <BuildingDetailView
          key={`${buildingDetail.building._dataType}:${buildingDetail.building.id}`} detail={{ ...buildingDetail, canEdit: buildingDetail.canEdit && !getImpersonationTargetUserId() }}
          readingState={buildingReadingStates.get(`${buildingDetail.building._dataType}:${buildingDetail.building.id}`)}
          onReadingChange={state => buildingReadingStates.set(`${buildingDetail.building._dataType}:${buildingDetail.building.id}`, state)}
          stackingBack={stackingBack}
          onClose={closeWorkspace} onDisposeTrend={disposeDetailTrend}
          onAction={action => controllerRef.current?.runWorkspaceBuildingAction(action, buildingDetail.building)} /> : null}
        submarketDetailPanel={selectedSubmarket && selectedSummary ? <SubmarketDetailPanel key={selectedSubmarket}
          name={selectedSubmarket} summary={selectedSummary} buildings={allBuildings} futureCount={selectedFutureCount}
          canEdit={userRole === 'admin' && !getImpersonationTargetUserId()} suspended={workspace.right?.kind !== 'submarket' || workspace.focus}
          onExitGuardChange={registerResearchExitGuard}
          onClose={closeWorkspace} onShowAll={showSubmarketBuildings}
          retained={workspace.research?.retained ?? false} onRetain={() => dispatchWorkspace({ type: 'retain' })}
          onOpenBuilding={id => { const building = allBuildings.find(item => item.id === id); if (building) handleBuildingClick(building); }} /> : null}
        queryPanel={<MapQuerySelection context={queryContext} onChange={setQuerySelection} />}
        stats={stats}
        futureSupplyCalendar={futureSupplyCalendar}
        futureSuppliesCount={scopedFutureSupplies.filter(supply => !isPendingFutureSupply(supply)).length}
        futureSupplies={scopedFutureSupplies}
        activeFilterChips={activeFilterChips}
        keyword={searchInput}
        filterState={filterState}
        renderMode={renderMode}
        compareGroups={activeCompareGroups}
        isFilterPanelOpen={isFilterPanelOpen}
        isSupplyOpen={isSupplyOpen}
        isListVisible={isListVisible}
        canOpenList={mapReady}
        currentSubwayStations={currentSubwayStations}
        filterCommand={filterCommand}
        mapReady={mapReady}
        mapError={mapError}
        mapDataLoading={mapDataLoading}
        hasBuildings={allBuildings.length > 0}
        isExporting={isExporting}
        combinedBuildingList={combinedBuildingList}
        displayOverrides={displayOverrides}
        targetBuildingId={workspace.right?.kind === 'building' ? workspace.right.building.id : competitorBuildings ? targetBuildingId : buildingDetail?.building.id ?? null}
        brokerContext={buildingFocus ? {
          back: buildingFocus.back,
          filtered: workspace.right?.kind === 'building' && workspace.right.building.id === buildingFocus.id && !combinedBuildingList.some(item => item.id === buildingFocus.id),
          unavailable: focusStatus?.key === focusKey && !focusStatus.found,
        } : null}
        intelligenceContext={initialIntelligenceHandoff ? {
          candidateCount: intelligenceCandidatesResolved ? filteredBuildings.length : null,
          appliedCapabilities: initialIntelligenceHandoff.appliedCapabilities,
        } : null}
        onFilterPanelOpenChange={setIsFilterPanelOpen}
        onSupplyOpenChange={setIsSupplyOpen}
        onFilterChange={handleFilterChange}
        onCompareGroupsChange={handleCompareGroupsChange}
        onKeywordChange={value => {
          cancelPendingBuildingNavigation(); setSearchInput(value);
          if (!value.trim() && workspaceRef.current.right?.kind === 'search') {
            if (workspaceRef.current.history.length) dispatchWorkspace({ type: 'back' });
            else closeWorkspace();
          }
        }}
        onSearch={value => { if (workspaceViewRef.current === 'map') handleSearch(value); }}
        onSearchSubmit={value => { if (workspaceViewRef.current === 'map') handleSearchSubmit(value); }}
        onRemoveFilterChip={patch => issueFilterCommand('patch', patch)}
        onResetFilters={handleResetAllFilters}
        onRenderModeChange={handleRenderModeChange}
        onOpenList={() => setIsListVisible(true)}
        onCloseList={() => setIsListVisible(false)}
        onRetryMap={() => {
          const controller = controllerRef.current;
          if (controller && mapReady) void loadMapData(controller);
          else window.location.reload();
        }}
        onExportMapData={handleExportMapData}
        onBuildingClick={handleBuildingClick}
        onSearchBuildingClick={building => { dispatchWorkspace({ type: 'open', view: { kind: 'search' } }); handleBuildingClick(building); }}
        onBuildingHover={handleBuildingHover}
        searchContextKey={JSON.stringify([workspaceRevision, currentUserId, userRole])}
        isFullListVisible={workspaceView === 'list'}
        hasVisitedFullList={hasVisitedFullList}
        fullBuildingList={fullBuildingList}
        fullListQueryKey={fullListQueryKey}
        fullListBusy={fullListBusy}
        fullListWarning={fullListWarning}
        competitorContext={competitorBuildings !== null}
        onOpenFullList={() => { if (!researchExitGuard.current || researchExitGuard.current()) changeWorkspaceView('list'); }}
        onCloseFullList={() => changeWorkspaceView('map')}
        onFullListBuildingClick={handleFullListBuildingClick}
        onFullListSearch={value => { if (workspaceViewRef.current === 'list') handleSearch(value); }}
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
                const controller = controllerRef.current;
                await controller.refreshBuildingData(editingBuilding.id);
                await loadMapData(controller);
              } catch (err) {
                console.error('刷新地图数据失败:', err);
              }
            }
          }}
        />
      )}
    </MapReadingContext.Provider>
  );
}
