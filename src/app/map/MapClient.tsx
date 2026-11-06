'use client';

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
  SUPPLY_CALENDAR_CATEGORIES,
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
import { useMapRuntime } from './runtime/useMapRuntime';
import { useMapWorkspaceView } from './runtime/useMapWorkspaceView';
import { hasBuildingLocation, type FullListBuilding } from './model/fullBuildingList';
import { MapWorkbenchView } from './components/MapWorkbenchView';
import { MapLoadingShell } from './components/MapLoadingShell';
import type { IntelligenceMapRouteState } from './model/intelligenceMapHandoff';

// Admin-only editing is never part of the normal Map path. Keep its Supabase,
// audit and form runtime out of the MapClient chunk until an admin opens it.
const BuildingMetricsEditModal = dynamic(
  () => import('@/src/components/map/BuildingMetricsEditModal').then(module => module.BuildingMetricsEditModal),
  { ssr: false },
);

export default function MapWorkbenchPage({ initialIntelligenceHandoff }: { initialIntelligenceHandoff: IntelligenceMapRouteState | null }) {
  const { session: appSession, status: appSessionStatus } = useAppSession();
  const allowed = appSessionStatus === 'authenticated' && Boolean(appSession);
  const userRole = appSession?.role || 'viewer';
  const currentUserId = appSession?.user?.id || null;
  const userRoleRef = React.useRef(userRole);
  userRoleRef.current = userRole;

  const [allBuildings, setAllBuildings] = React.useState<any[]>([]);
  const [futureSupplies, setFutureSupplies] = React.useState<any[]>([]);
  const [displayOverrides, setDisplayOverrides] = React.useState<Map<string, Map<string, { display_label: string; display_value: string }>>>(new Map());
  const [filterState, setFilterState] = React.useState<SidebarFilterState | null>(() => initialIntelligenceHandoff?.filterState ?? null);
  const [filterCommand, setFilterCommand] = React.useState<SidebarFilterCommand | null>(() => initialIntelligenceHandoff
    ? { id: 1, type: 'patch', patch: initialIntelligenceHandoff.filterState }
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

  // 监听竞品分析事件（联动地图与列表）
  React.useEffect(() => {
    const onFound = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      // CL-013: 新格式 { buildings, targetBuildingId }，兼容旧格式
      if (Array.isArray(detail)) {
        setCompetitorBuildings(detail);
        setTargetBuildingId(null);
      } else if (detail && Array.isArray(detail.buildings)) {
        setCompetitorBuildings(detail.buildings);
        setTargetBuildingId(detail.targetBuildingId || null);
      }
    };
    const onCleared = () => { setCompetitorBuildings(null); setTargetBuildingId(null); };
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
  // 竞品分析模式标记（ref，避免影响 useEffect 依赖）
  const competitorModeRef = React.useRef(false);
  React.useEffect(() => {
    competitorModeRef.current = competitorBuildings !== null;
  }, [competitorBuildings]);

  // 🌟 Phase 1: 悬浮列表可见性控制
  const [isListVisible, setIsListVisible] = React.useState(false);
  const [userHasInteracted, setUserHasInteracted] = React.useState(Boolean(initialIntelligenceHandoff));
  const [isSupplyOpen, setIsSupplyOpen] = React.useState(false);
  const [isFilterPanelOpen, setIsFilterPanelOpen] = React.useState(false);

  const activeFilterChips = React.useMemo(() => buildActiveFilterChips(filterState), [filterState]);

  const issueFilterCommand = React.useCallback((type: SidebarFilterCommand['type'], patch?: Partial<SidebarFilterState>) => {
    setFilterCommand(previous => ({ id: (previous?.id ?? 0) + 1, type, patch }));
  }, []);
  
  const [searchInput, setSearchInput] = React.useState('');
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
  const prevKeywordRef = React.useRef(keyword);
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

  const [stats, setStats] = React.useState<MapStatsState>({ totalArea: '-', avgRent: '-', overallVacancyPct: '-', projectCount: '-', visibleProjectCount: '-' });
  
  const districtLeedStats = React.useMemo(() => buildDistrictLeedStats(allBuildings), [allBuildings]);
  
  const futureSupplyCalendar = React.useMemo(() => buildFutureSupplyCalendar(futureSupplies), [futureSupplies]);
  
  // 新增：地图标记渲染模式状态
  const [renderMode, setRenderMode] = React.useState<RenderMode>('default');
  const showAreaPlaceholders = !keyword && activeCompareGroups.length === 0
    && !initialIntelligenceHandoff && (filterState === null || isDefaultStockFilterState(filterState));

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
  }, [competitorBuildings, filteredBuildings, filteredFutureSupplies, renderMode, districtLeedStats, activeCompareGroups, mapReady, showAreaPlaceholders, filterState]);

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

    if (competitorModeRef.current) ctrl.clearCompetitorElements();
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
    const filtered = mapDataStoreRef.current.filter({
      filterState: activeFilterState,
      compareGroups,
      keyword,
      role: userRoleRef.current,
      calculateDistance: (buildingPoint, stationPoint) => ctrl.calculateDistance(buildingPoint, stationPoint),
    });

    // 🌟 Phase 1: 将过滤结果同步到组件状态，供悬浮列表使用
    setFilteredBuildings(filtered);
    setFullListWarning(null);
    const searchAdditionalSupply = Boolean(keyword) && !activeFilterState.showFutureSupply;
    const loadFuture = activeFilterState.showFutureSupply || searchAdditionalSupply;
    const shouldFitSearch = Boolean(keyword) && keyword !== prevKeywordRef.current;
    if (!loadFuture) setSettledFullListFilterKey(fullListFilterKey);
    if (initialIntelligenceHandoff && !intelligenceCandidatesResolved) {
      setIntelligenceCandidatesResolved(true);
    }

    // 竞品分析模式下跳过地图标记渲染，避免覆盖竞品标记
    if (!competitorModeRef.current) {
      ctrl.renderMarkers(filtered, renderMode, districtLeedStats, activeCompareGroups.length > 0 ? activeCompareGroups : undefined, showAreaPlaceholders);
    }
    setStats(computeStatsFromBuildings(filtered));

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
            searchAdditionalSupply
              ? { ...activeFilterState, futureSupplyGrades: ['commercial', 'pending'], futureSupplyYears: [...SUPPLY_CALENDAR_CATEGORIES] }
              : activeFilterState,
            keyword,
            (buildingPoint, stationPoint) => ctrl.calculateDistance(buildingPoint, stationPoint),
          );

          if (futureSupplyRequestToken !== futureSupplyRequestTokenRef.current) return;
          setFilteredFutureSupplies(filteredSupplies);
          setSettledFullListFilterKey(fullListFilterKey);
          if (!competitorModeRef.current) {
            if (activeFilterState.showFutureSupply) ctrl.renderFutureMarkers(filteredSupplies, renderMode);
            if (shouldFitSearch && filtered.length === 0 && filteredSupplies.length > 0) ctrl.fitToBuildings(filteredSupplies as typeof filtered);
          }
        } catch (e) {
          if (futureSupplyRequestToken !== futureSupplyRequestTokenRef.current) return;
          console.error('[MapClient] future supply fetch/render failed', e);
          setFilteredFutureSupplies([]);
          setFullListWarning('未来供应暂时无法读取，当前仅显示存量楼宇。');
          setSettledFullListFilterKey(fullListFilterKey);
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

    if (keyword && keyword !== prevKeywordRef.current && filtered.length > 0) {
      ctrl.fitToBuildings(filtered);
    }
    prevKeywordRef.current = keyword;
    });

  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterState, keyword, allBuildings, mapReady, renderMode, districtLeedStats, compareGroups, getFilterFrameScheduler, fullListFilterKey, showAreaPlaceholders]);

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
  const handleBuildingClick = React.useCallback((building: any) => {
    if (workspaceViewRef.current !== 'map') return;
    cancelPendingBuildingNavigation();
    if (!controllerRef.current || !mapReady) return;
    
    const ctrl = controllerRef.current;
    const lng = building.location_lng;
    const lat = building.location_lat;
    
    if (!Number.isFinite(lng) || !Number.isFinite(lat)) {
      console.warn('[MapClient] Invalid building coordinates:', building.name);
      return;
    }
    
    // 地图平滑移动到楼宇位置并放大。连续点击时只允许最后一次导航打开弹窗。
    const navigationToken = ++listNavigationTokenRef.current;
    ctrl.map.setZoomAndCenter(16, [lng, lat], false, 500);
    
    pendingNavigationTimerRef.current = setTimeout(() => {
      pendingNavigationTimerRef.current = null;
      if (navigationToken !== listNavigationTokenRef.current || controllerRef.current !== ctrl || workspaceViewRef.current !== 'map') return;
      if (building._dataType === 'future') ctrl.openFutureSupplyInfoWindow(building);
      else ctrl.openBuildingInfoWindow(building.id);
    }, 600);

    logAction(appSession?.user?.email || '未知用户', 'VIEW_BUILDING', {
      buildingId: building.id,
      buildingName: building.name,
      dataType: building._dataType || 'existing',
    });
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

  // 🌟 2. 抽离出的地图搜索处理函数及埋点逻辑
  const handleSearch = (val: string) => {
    cancelPendingBuildingNavigation();
    const trimmed = val.trim();
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

  if (!allowed) return <MapLoadingShell />;

  return (
    <>
      <MapWorkbenchView
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
        canOpenList={userHasInteracted || Boolean(keyword) || activeCompareGroups.length > 0}
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
