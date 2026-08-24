'use client';

import * as React from 'react';
import type { SidebarFilterState, CompareGroup, SidebarFilterCommand } from '@/src/components/SidebarFilter';
import { getSession } from '@/src/services/Auth';
import { useAppSession } from '@/src/components/SessionProvider';
import type { MapController } from '@/src/services/MapController';
// 🌟 1. 引入日志工具
import { logAction } from '@/src/utils/audit';
import { createLatestFrameScheduler, type LatestFrameScheduler } from '@/src/utils/frameCoalescer';
import { retryAsync } from '@/src/utils/retryAsync';
// 管理员编辑楼宇指标数据弹窗
import { BuildingMetricsEditModal } from '@/src/components/map/BuildingMetricsEditModal';
import {
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
import { useMapRuntime } from './runtime/useMapRuntime';
import { MapWorkbenchView } from './components/MapWorkbenchView';

function MapAuthLoading() { 
  return ( 
    <div className="h-screen h-[100dvh] overflow-hidden bg-gray-50 text-zinc-900 flex flex-col">
      <header className="sticky top-0 z-10 border-b border-zinc-200 bg-white/90 backdrop-blur supports-[backdrop-filter]:bg-white/75 shrink-0">
        <div className="relative mx-auto flex max-w-[1600px] items-center justify-between px-4 py-3 sm:px-6">
          <div className="flex items-center gap-6 xl:gap-8 min-w-0">
            <div className="shrink-0">
              <h1 className="text-sm font-semibold tracking-wide text-blue-950 sm:text-base">COLLIERS DATA</h1>
              <p className="text-[11px] text-zinc-500 sm:text-xs">办公楼市场监测 · 核心地图工作台</p>
            </div>
          </div>
        </div>
      </header>
      <div className="flex flex-1 items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-[#003e7e] border-t-transparent" />
      </div>
    </div>
  ); 
}

export default function MapWorkbenchPage() {
  const { session: appSession, status: appSessionStatus } = useAppSession();
  const allowed = appSessionStatus === 'authenticated' && Boolean(appSession);
  const userRole = appSession?.role || 'viewer';
  const currentUserId = appSession?.user?.id || null;
  const userRoleRef = React.useRef(userRole);
  userRoleRef.current = userRole;

  const [allBuildings, setAllBuildings] = React.useState<any[]>([]);
  const [futureSupplies, setFutureSupplies] = React.useState<any[]>([]);
  const [displayOverrides, setDisplayOverrides] = React.useState<Map<string, Map<string, { display_label: string; display_value: string }>>>(new Map());
  const [filterState, setFilterState] = React.useState<SidebarFilterState | null>(null);
  const [filterCommand, setFilterCommand] = React.useState<SidebarFilterCommand | null>(null);
  const [compareGroups, setCompareGroups] = React.useState<CompareGroup[]>([]);
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
  const [userHasInteracted, setUserHasInteracted] = React.useState(false);
  const [isSupplyOpen, setIsSupplyOpen] = React.useState(false);
  const [isFilterPanelOpen, setIsFilterPanelOpen] = React.useState(false);

  const activeFilterChips = React.useMemo(() => buildActiveFilterChips(filterState), [filterState]);

  const issueFilterCommand = React.useCallback((type: SidebarFilterCommand['type'], patch?: Partial<SidebarFilterState>) => {
    setFilterCommand(previous => ({ id: (previous?.id ?? 0) + 1, type, patch }));
  }, []);
  
  const [keyword, setKeyword] = React.useState('');
  const prevKeywordRef = React.useRef(keyword);
  const hadActiveFiltersRef = React.useRef(false);
  
  const [currentSubwayStations, setCurrentSubwayStations] = React.useState<any[]>([]);
  const lastFetchedLine = React.useRef<string | null>(null);
  const initialRenderDone = React.useRef(false);

  const [mapError, setMapError] = React.useState<string | null>(null);
  const [mapDataLoading, setMapDataLoading] = React.useState(false);
  const filterFrameSchedulerRef = React.useRef<LatestFrameScheduler | null>(null);

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

      // admin/editor 可见所有等级，viewer 只看 A/P。索引在数据进入工作区时只构建一次。
      const role = userRoleRef.current;
      mapDataStoreRef.current.replaceBuildings(buildings);
      const visible = mapDataStoreRef.current.getRoleVisible(role);

      console.log(`[MapClient] 角色=${role}, 总建筑=${buildings.length}, 可见=${visible.length}`);
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

  // 🌟 CL-011: 退出周边项目对比时，恢复之前的地图标记
  const prevCompetitorRef = React.useRef(competitorBuildings);
  React.useEffect(() => {
    if (prevCompetitorRef.current !== null && competitorBuildings === null && controllerRef.current && mapReady) {
      const ctrl = controllerRef.current;
      ctrl.renderMarkers(filteredBuildings, renderMode, districtLeedStats, compareGroups.length > 0 ? compareGroups : undefined);
      if (filteredFutureSupplies.length > 0) {
        ctrl.renderFutureMarkers(filteredFutureSupplies, renderMode);
      }
    }
    prevCompetitorRef.current = competitorBuildings;
  }, [competitorBuildings, filteredBuildings, filteredFutureSupplies, renderMode, districtLeedStats, mapReady]);

  // 新增：开发者工具状态
  const [isExporting, setIsExporting] = React.useState(false);

  // 初始渲染：只执行一次，确保首次加载必定渲染
  React.useEffect(() => {
    if (!mapReady || !controllerRef.current || allBuildings.length === 0) return;
    if (initialRenderDone.current) return;
    initialRenderDone.current = true;
    const ctrl = controllerRef.current;
    ctrl.clearCompetitorElements();
    ctrl.clearDistrictBoundaries();
    ctrl.clearSubwayElements();
    ctrl.renderMarkers(allBuildings, 'default', districtLeedStats);
    setFilteredBuildings(allBuildings);
    setStats(computeStatsFromBuildings(allBuildings));
  }, [mapReady, allBuildings, filterState, districtLeedStats]);

  // 用户交互筛选后的过滤逻辑
  React.useEffect(() => {
    const scheduler = getFilterFrameScheduler();
    if (!mapReady || !controllerRef.current || allBuildings.length === 0 || !filterState) {
      scheduler.cancel();
      return;
    }

    scheduler.schedule(() => {
      const ctrl = controllerRef.current;
      if (!ctrl) return;

    // 清除竞品分析元素（重置时淡黄色圆圈消失）
    ctrl.clearCompetitorElements();

    if (filterState.showBoundaries) {
      const distToDraw = filterState.districts?.length > 0 ? filterState.districts : MOCK_DISTRICTS;
      ctrl.drawDistrictBoundaries(distToDraw);
    } else {
      ctrl.clearDistrictBoundaries();
    }

    if (filterState.subwayLine) {
      if (lastFetchedLine.current !== filterState.subwayLine) {
         const lineToFetch = filterState.subwayLine;
         lastFetchedLine.current = lineToFetch;
         setCurrentSubwayStations(prev => prev.length > 0 ? [] : prev);
         ctrl.fetchAndDrawSubwayLine(lineToFetch).then((stations: any[]) => {
           // 竞态保护：如果用户已切换到其他线路，跳过
           if (lastFetchedLine.current === lineToFetch) {
             setCurrentSubwayStations(stations);
           }
         });
      }
      if (filterState.subwayStation && filterState.subwayDistance) {
         ctrl.drawSubwayRadius(filterState.subwayStation, filterState.subwayDistance);
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
      filterState,
      compareGroups,
      keyword,
      role: userRoleRef.current,
      calculateDistance: (buildingPoint, stationPoint) => ctrl.calculateDistance(buildingPoint, stationPoint),
    });

    // 🌟 Phase 1: 将过滤结果同步到组件状态，供悬浮列表使用
    setFilteredBuildings(filtered);

    // 调试日志：过滤结果统计
    const filteredGradeCount: Record<string, number> = {};
    for (const b of filtered) { const g = b.grade || '?'; filteredGradeCount[g] = (filteredGradeCount[g] || 0) + 1; }
    console.log(`[MapClient] 过滤结果: ${filtered.length}/${allBuildings.length}, 等级分布:`, filteredGradeCount);

    // 竞品分析模式下跳过地图标记渲染，避免覆盖竞品标记
    if (!competitorModeRef.current) {
      ctrl.renderMarkers(filtered, renderMode, districtLeedStats, compareGroups.length > 0 ? compareGroups : undefined);
    }
    setStats(computeStatsFromBuildings(filtered));

    // ================= 🌟 未来新增供应分支逻辑 (修复后) =================
    if (filterState.showFutureSupply) {
      void (async () => {
        try {
          const supplies = await ctrl.fetchFutureSupplies();
          let filteredSupplies = supplies;

          // 给未来供应加上搜索词(keyword)的过滤
          if (keyword) {
            filteredSupplies = filteredSupplies.filter((s: any) => 
              s.name?.includes(keyword) || s.submarket?.includes(keyword)
            );
          }
          
          // 使用 futureSupplyGrades 细分选项过滤未来供应
          if (filterState.futureSupplyGrades) {
            if (filterState.futureSupplyGrades.length === 0) {
              filteredSupplies = []; 
            } else {
              filteredSupplies = filteredSupplies.filter((s: any) => {
                const sGrade = (s.grade || '').toUpperCase();
                if (!sGrade) return false; 
                if (filterState.futureSupplyGrades.includes('BP') && sGrade.includes('BP')) return true;
                if (filterState.futureSupplyGrades.includes('A') && (sGrade.includes('A') || sGrade.includes('P')) && !sGrade.includes('BP')) return true;
                if (filterState.futureSupplyGrades.includes('B') && sGrade.includes('B') && !sGrade.includes('BP')) return true;
                return false;
              });
            }
          }
          
          // CL-015: 年份筛选
          if (filterState.futureSupplyYears && filterState.futureSupplyYears.length > 0) {
            filteredSupplies = filteredSupplies.filter((s: any) => {
              const category = categorizeSupply(s);
              return filterState.futureSupplyYears.includes(category);
            });
          } else if (filterState.futureSupplyYears) {
            filteredSupplies = [];
          }

          // 🌟 新增：保存过滤后的未来供应数据到状态
          setFilteredFutureSupplies(filteredSupplies);
          if (!competitorModeRef.current) {
            ctrl.renderFutureMarkers(filteredSupplies, renderMode);
          }
        } catch (e) {
          console.error('[MapClient] future supply fetch/render failed', e);
          setFilteredFutureSupplies([]);
        }
      })();
    } else {
      setFilteredFutureSupplies([]);
      ctrl.clearFutureMarkers?.();
    }

    // 筛选只改变显示内容，不应移动用户正在查看的地图视野。
    // 当用户从任意筛选状态恢复为默认条件时，才回到初始大气泡总览。
    const hasActiveFilters = !isDefaultFilterState(filterState);
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
  }, [filterState, keyword, allBuildings, mapReady, renderMode, districtLeedStats, compareGroups, getFilterFrameScheduler]);

  const handleFilterChange = React.useCallback((state: SidebarFilterState) => {
    setUserHasInteracted(true);
    setFilterState(prev => {
      if (prev?.subwayLine !== state.subwayLine) setCurrentSubwayStations([]);
      return state;
    });
    // 筛选全部清除时自动隐藏列表并重置交互状态
    const hasAny =
      state.districts.length > 0 ||
      state.submarkets.length > 0 ||
      state.leeds.length > 0 ||
      state.projectTypes.length > 0 ||
      state.subwayLine !== null ||
      state.numericFilters.length > 0;
    if (!hasAny) {
      setIsListVisible(false);
      setUserHasInteracted(false);
      setFilterState(null);
    }
    logAction(undefined, 'MAP_FILTER', { filter: JSON.stringify(state) });
  }, []);

  const handleCompareGroupsChange = React.useCallback((groups: CompareGroup[]) => {
    setCompareGroups(groups);
  }, []);

  // 🌟 CL-013: 悬停联动 — 卡片悬停时地图 marker 弹跳
  const handleBuildingHover = React.useCallback((buildingId: string | null) => {
    if (!controllerRef.current) return;
    const ctrl = controllerRef.current;
    if (buildingId) {
      ctrl.bounceMarker(buildingId);
    }
  }, []);

  // 🌟 地图联动：点击列表卡片时，地图自动定位到对应楼宇并打开信息窗口
  const handleBuildingClick = React.useCallback((building: any) => {
    if (!controllerRef.current || !mapReady) return;
    
    const ctrl = controllerRef.current;
    const lng = building.location_lng;
    const lat = building.location_lat;
    
    if (!Number.isFinite(lng) || !Number.isFinite(lat)) {
      console.warn('[MapClient] Invalid building coordinates:', building.name);
      return;
    }
    
    // 地图平滑移动到楼宇位置并放大
    ctrl.map.setZoomAndCenter(16, [lng, lat], false, 500);
    
    // 延迟打开信息窗口，等待地图移动完成
    setTimeout(() => {
      ctrl.openBuildingInfoWindow(building.id);
    }, 600);

    getSession().then(s => logAction(s?.user?.email || '未知用户', 'VIEW_BUILDING', { buildingId: building.id, buildingName: building.name })).catch(() => {});
    console.log('[MapClient] Map navigated to building and opened info window:', building.name);
  }, [mapReady]);

  // 🌟 2. 抽离出的地图搜索处理函数及埋点逻辑
  const handleSearch = async (val: string) => {
    const trimmed = val.trim();
    setKeyword(trimmed);
    if (trimmed) setUserHasInteracted(true);
    
    if (trimmed !== '') {
      try {
        const session = await getSession();
        const userEmail = session?.user?.email || '未知用户';
        // 记录搜索行为到数据库
        logAction(userEmail, 'SEARCH', { keyword: trimmed, module: 'map' });
      } catch (e) {
        // 静默处理错误，不影响用户正常使用
      }
    }
  };

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
      getSession().then(s => logAction(s?.user?.email || '未知用户', 'EXPORT_MAP_DATA', {})).catch(() => {});
      alert('✅ 数据导出成功！请将下载的 beijing_map_data.json 文件放到 public/data/ 目录下');
    } catch (error) {
      console.error('导出失败:', error);
      alert('❌ 数据导出失败: ' + (error instanceof Error ? error.message : '未知错误'));
    } finally {
      setIsExporting(false);
    }
  };

  if (!allowed) return <MapAuthLoading />;

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
}