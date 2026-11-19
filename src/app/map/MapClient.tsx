'use client';

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
import { panMapFocusIntoAvailableArea } from './runtime/mapFocusViewport';
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

export default function MapWorkbenchPage({ initialIntelligenceHandoff, buildingFocus, queryContext = null }: { initialIntelligenceHandoff: IntelligenceMapRouteState | null; buildingFocus?: BuildingFocus | null; queryContext?: QueryMapContext | null }) {
  const { session: appSession, status: appSessionStatus } = useAppSession();
  const [querySelection, setQuerySelection] = React.useState<BuildingContext | null>(null);
  const queryIds = React.useMemo(() => new Set(querySelection?.buildings.filter(row => row.located).map(row => row.id) ?? []), [querySelection]);
  const queryFit = React.useRef('');
  const allowed = appSessionStatus === 'authenticated' && Boolean(appSession);
  const userRole = appSession?.role || 'viewer';
  const currentUserId = appSession?.user?.id || null;
  const userRoleRef = React.useRef(userRole);
  userRoleRef.current = userRole;

  const preferenceKey = currentUserId ? `broker-map:v1:${JSON.stringify([currentUserId, userRole, getImpersonationTargetUserId()])}` : '';
  const [savedPreferences] = React.useState(() => !initialIntelligenceHandoff && !queryContext && preferenceKey ? readMapFilterPreference(preferenceKey) : null);
  const initialFilters = queryContext ? { ...createDefaultFilterState(), showFutureSupply: false } : initialIntelligenceHandoff?.filterState ?? savedPreferences?.filters ?? null;

  const [allBuildings, setAllBuildings] = React.useState<any[]>([]);
  const [futureSupplies, setFutureSupplies] = React.useState<any[]>([]);
  const [displayOverrides, setDisplayOverrides] = React.useState<Map<string, Map<string, { display_label: string; display_value: string }>>>(new Map());
  const [filterState, setFilterState] = React.useState<SidebarFilterState | null>(() => initialFilters);
  const [filterCommand, setFilterCommand] = React.useState<SidebarFilterCommand | null>(() => initialFilters
    ? { id: 1, type: 'patch', patch: initialFilters }
    : null);
  const [compareGroups, setCompareGroups] = React.useState<CompareGroup[]>([]);
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
    const existingWithType = filteredBuildings.filter(b => Number.isFinite(b.location_lng) && Number.isFinite(b.location_lat)).map(b => ({ ...b, _dataType: 'existing' }));
    const futureWithType = filteredFutureSupplies.map(f => ({ ...f, _dataType: 'future' }));
    return [...existingWithType, ...futureWithType];
  }, [filteredBuildings, filteredFutureSupplies, competitorBuildings]);
  // Keep the synchronous event ref aligned with the committed React state.
  React.useEffect(() => {
    competitorModeRef.current = competitorBuildings !== null;
  }, [competitorBuildings]);

  // 🌟 Phase 1: 悬浮列表可见性控制
  const [isListVisible, setIsListVisible] = React.useState(false);
  const [userHasInteracted, setUserHasInteracted] = React.useState(Boolean(initialIntelligenceHandoff));
  const [isSupplyOpen, setIsSupplyOpen] = React.useState(false);
  const [isFilterPanelOpen, setIsFilterPanelOpen] = React.useState(false);
  const [selectedSubmarket, setSelectedSubmarket] = React.useState<string | null>(null);
  const [areaProjectOpen, setAreaProjectOpen] = React.useState(false);
  React.useEffect(() => {
    const open = (event: Event) => {
      const name = normalizeMapSubmarket((event as CustomEvent<{ name?: string }>).detail?.name);
      if (!name || name === '其他') return;
      setSelectedSubmarket(name);
      setAreaProjectOpen(false);
      setIsFilterPanelOpen(false);
      setIsSupplyOpen(false);
      setIsListVisible(false);
    };
    window.addEventListener('map-submarket-open', open);
    return () => window.removeEventListener('map-submarket-open', open);
  }, []);

  const selectedSummary = React.useMemo(() => selectedSubmarket
    ? submarketSummary(allBuildings, selectedSubmarket) : null, [allBuildings, selectedSubmarket]);
  const selectedFutureCount = React.useMemo(() => selectedSubmarket
    ? futureSupplies.filter(supply => !isPendingFutureSupply(supply)
      && normalizeMapSubmarket(supply.submarket) === selectedSubmarket).length : 0,
    [futureSupplies, selectedSubmarket]);

  const activeFilterChips = React.useMemo(() => buildActiveFilterChips(filterState), [filterState]);

  const issueFilterCommand = React.useCallback((type: SidebarFilterCommand['type'], patch?: Partial<SidebarFilterState>) => {
    setFilterCommand(previous => ({ id: (previous?.id ?? 0) + 1, type, patch }));
  }, []);
  
  const [searchInput, setSearchInput] = React.useState(savedPreferences?.input ?? '');
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
      // Both reads are independent; future supply must not delay stock startup.
      const [_, future] = await Promise.allSettled([
        loadMapData(controller, isCancelled),
        queryContext ? Promise.resolve([]) : controller.fetchFutureSupplies(),
      ]);
      if (!isCancelled() && future.status === 'fulfilled') {
        setFutureSupplies(future.value);
      }
    },
    onError: setMapError,
  });

  React.useEffect(() => {
    return () => filterFrameSchedulerRef.current?.cancel();
  }, []);

  const [stats, setStats] = React.useState<MapStatsState>({ totalArea: '-', avgRent: '-', overallVacancyPct: '-', projectCount: '-', visibleProjectCount: '-' });
  
  const districtLeedStats = React.useMemo(() => buildDistrictLeedStats(allBuildings), [allBuildings]);
  
  const futureSupplyCalendar = React.useMemo(() => buildFutureSupplyCalendar(futureSupplies), [futureSupplies]);
  
  // 新增：地图标记渲染模式状态
  const [renderMode, setRenderMode] = React.useState<RenderMode>('default');
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
    })).filter(building => !queryContext || queryIds.has(building.id)
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
          );

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
    if (!hasActiveFilters && hadActiveFiltersRef.current && !keyword) {
      ctrl.resetToDefaultView?.();
    }
    hadActiveFiltersRef.current = hasActiveFilters;

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
    const lng = building.location_lng;
    const lat = building.location_lat;
    
    if (!Number.isFinite(lng) || !Number.isFinite(lat)) {
      console.warn('[MapClient] Invalid building coordinates:', building.name);
      return false;
    }
    
    // 地图平滑移动到楼宇位置并放大。连续点击时只允许最后一次导航打开弹窗。
    const navigationToken = ++listNavigationTokenRef.current;
    ctrl.map.setZoomAndCenter(16, [lng, lat], false, 500);
    
    pendingNavigationTimerRef.current = setTimeout(() => {
      pendingNavigationTimerRef.current = null;
      if (navigationToken !== listNavigationTokenRef.current || controllerRef.current !== ctrl || workspaceViewRef.current !== 'map') return;
      // Correct for currently visible workbench overlays before opening the InfoWindow.
      panMapFocusIntoAvailableArea(ctrl.map);
      if (building._dataType === 'future') ctrl.openFutureSupplyInfoWindow(building);
      else ctrl.openBuildingInfoWindow(building.id);
    }, 600);

    logAction(appSession?.user?.email || '未知用户', 'VIEW_BUILDING', {
      buildingId: building.id,
      buildingName: building.name,
      dataType: building._dataType || 'existing',
    });
    return true;
  }, [appSession?.user?.email, mapReady, cancelPendingBuildingNavigation, workspaceViewRef]);

  const fullListBusy = mapDataLoading || !mapReady || settledFullListFilterKey !== fullListFilterKey;
  const handleFullListBuildingClick = React.useCallback((building: FullListBuilding) => {
    if (workspaceViewRef.current !== 'list' || fullListBusy || !hasBuildingLocation(building)) return;
    cancelPendingBuildingNavigation();
    changeWorkspaceView('map');
    const controller = controllerRef.current;
    const token = ++listNavigationTokenRef.current;
    pendingNavigationFrameRef.current = window.requestAnimationFrame(() => {
      pendingNavigationFrameRef.current = null;
      if (token !== listNavigationTokenRef.current || workspaceViewRef.current !== 'map' || controllerRef.current !== controller) return;
      handleBuildingClick(building);
    });
  }, [fullListBusy, cancelPendingBuildingNavigation, changeWorkspaceView, controllerRef, workspaceViewRef, handleBuildingClick]);

  const [focusStatus, setFocusStatus] = React.useState<{ key: string; found: boolean }>();
  const openedFocus = React.useRef('');
  const focusKey = buildingFocus ? JSON.stringify(buildingFocus) : '';
  React.useEffect(() => {
    const ctrl = controllerRef.current;
    if (!buildingFocus || !mapReady || !ctrl || openedFocus.current === focusKey) return;
    let cancelled = false;
    const open = async () => {
      if (!buildingFocus.future && mapDataLoading) return;
      const items: typeof allBuildings = buildingFocus.future ? await ctrl.fetchFutureSupplies() : allBuildings;
      if (cancelled || controllerRef.current !== ctrl) return;
      const item = items.find(entry => entry.id === buildingFocus.id);
      if (!item) { setFocusStatus({ key: focusKey, found: false }); return; }
      openedFocus.current = focusKey;
      changeWorkspaceView('map');
      const located = hasBuildingLocation(item);
      if (located) {
        ctrl.map.setZoomAndCenter(16, [item.location_lng, item.location_lat], true);
        panMapFocusIntoAvailableArea(ctrl.map);
        if (buildingFocus.future) ctrl.openFutureSupplyInfoWindow(item);
        else ctrl.openBuildingInfoWindow(item.id);
      }
      if (!buildingFocus.future && buildingFocus.section) {
        window.dispatchEvent(new CustomEvent('broker:building-section', {
          detail: { id: item.id, name: item.name, section: buildingFocus.section },
        }));
      }
      setFocusStatus({ key: focusKey, found: located });
    };
    void open().catch(() => { if (!cancelled) setFocusStatus({ key: focusKey, found: false }); });
    return () => { cancelled = true; };
  }, [buildingFocus, focusKey, allBuildings, changeWorkspaceView, controllerRef, mapDataLoading, mapReady]);

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
    if (!trimmed && !hasGlobalFilters && !hasCompareGroups) setIsListVisible(false);
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
    const name = selectedSubmarket;
    cancelPendingBuildingNavigation();
    setSelectedSubmarket(null);
    setAreaProjectOpen(false);
    setSearchInput('');
    issueFilterCommand('patch', {
      ...createDefaultFilterState(),
      submarkets: [name],
      projectTypes: ['甲级写字楼', '乙级写字楼'],
      showFutureSupply: false,
    });
    setUserHasInteracted(true);
    setIsListVisible(true);
    const matches = allBuildings.filter(building => normalizeMapSubmarket(building.submarket) === name
      && (/A|P|B/i.test(String(building.grade ?? '')) && !String(building.grade ?? '').toUpperCase().includes('BP')));
    if (matches.some(building => Number.isFinite(building.location_lng) && Number.isFinite(building.location_lat))) {
      controllerRef.current?.fitToBuildings(matches);
    }
  };

  if (!allowed) return <MapLoadingShell />;

  return (
    <>
      <MapWorkbenchView
        submarketDetailPanel={selectedSubmarket && selectedSummary && workspaceView === 'map' ? (
          <>
            {/* Keep the same panel mounted while presenting a representative building.
                On mobile the panel covers the map; hiding, rather than unmounting,
                preserves the narrative scroll and permits an explicit return. */}
            <div className={areaProjectOpen ? 'hidden' : 'contents'}>
              <SubmarketDetailPanel key={selectedSubmarket} name={selectedSubmarket} summary={selectedSummary}
                buildings={allBuildings} futureCount={selectedFutureCount} canEdit={userRole === 'admin'} suspended={areaProjectOpen}
                onClose={() => { setSelectedSubmarket(null); setAreaProjectOpen(false); }}
                onShowAll={showSubmarketBuildings}
                onOpenBuilding={id => {
                  const building = allBuildings.find(item => item.id === id);
                  // Suspend the research modal only if navigation was actually accepted.
                  // Otherwise keep the modal visible instead of stranding the user.
                  if (building && handleBuildingClick(building)) setAreaProjectOpen(true);
                }} />
            </div>
            {areaProjectOpen ? (
              <button type="button" onClick={() => {
                  // The building popup opens after a 600ms map movement. Cancel
                  // that timer before returning, or it reappears over the modal.
                  cancelPendingBuildingNavigation();
                  controllerRef.current?.closeInfoWindow?.();
                  setAreaProjectOpen(false);
                }}
                className="pointer-events-auto absolute left-3 top-[64px] z-[435] inline-flex min-h-11 max-w-[calc(100vw-24px)] items-center gap-2 rounded-[6px] border border-[#d9e0e8] bg-white px-3 text-[13px] font-semibold text-[#003e7e] shadow-[0_4px_14px_rgba(23,32,51,0.14)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#003e7e] sm:left-4">
                返回{selectedSubmarket}子市场介绍
              </button>
            ) : null}
          </>
        ) : null}
        queryPanel={<MapQuerySelection context={queryContext} onChange={setQuerySelection} />}
        stats={stats}
        futureSupplyCalendar={futureSupplyCalendar}
        futureSuppliesCount={futureSupplies.filter(supply => !isPendingFutureSupply(supply)).length}
        futureSupplies={futureSupplies}
        activeFilterChips={activeFilterChips}
        keyword={searchInput}
        filterState={filterState}
        renderMode={renderMode}
        compareGroups={activeCompareGroups}
        isFilterPanelOpen={isFilterPanelOpen}
        isSupplyOpen={isSupplyOpen}
        isListVisible={isListVisible}
        canOpenList={Boolean(queryContext) || userHasInteracted || Boolean(keyword) || activeCompareGroups.length > 0}
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
        brokerContext={buildingFocus ? {
          back: buildingFocus.back,
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
        onKeywordChange={value => { cancelPendingBuildingNavigation(); setSearchInput(value); }}
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
        onBuildingHover={handleBuildingHover}
        searchContextKey={JSON.stringify([workspaceRevision, currentUserId, userRole])}
        isFullListVisible={workspaceView === 'list'}
        hasVisitedFullList={hasVisitedFullList}
        fullBuildingList={fullBuildingList}
        fullListQueryKey={fullListQueryKey}
        fullListBusy={fullListBusy}
        fullListWarning={fullListWarning}
        competitorContext={competitorBuildings !== null}
        onOpenFullList={() => changeWorkspaceView('list')}
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
    </>
  );
}
