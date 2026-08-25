'use client';

import * as React from 'react';
import Link from 'next/link';
import dynamic from 'next/dynamic';

import { SearchBar } from '@/src/components/SearchBar';
import { SidebarFilter, type SidebarFilterState, type CompareGroup, type SidebarFilterCommand } from '@/src/components/SidebarFilter';
import { StatCard } from '@/src/components/StatCard';
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
import { useMapRuntime } from './runtime/useMapRuntime';

// 🌟 Phase 2: 动态按需加载悬浮楼宇列表组件
const FloatingBuildingList = dynamic(() => import('./components/FloatingBuildingList'), { 
  ssr: false,
  loading: () => (
    <div className="absolute bottom-6 right-6 z-[200] flex items-center justify-center w-12 h-12">
      <div className="h-6 w-6 animate-spin rounded-full border-2 border-blue-600 border-t-transparent" />
    </div>
  )
});

function MapLegend({ mode }: { mode: RenderMode }) {
  const config = {
    default: {
      title: '项目类型',
      items: [
        { label: '存量写字楼', className: 'bg-[#003e7e]' },
        { label: '产业园区', className: 'bg-[#64748b]' },
        { label: '未来供应', className: 'border border-[#64748b] bg-white' },
      ],
    },
    rent: { title: '净有效租金（元/㎡/月）', items: [{ label: '低', className: 'bg-[#dbeafe]' }, { label: '中', className: 'bg-[#60a5fa]' }, { label: '高', className: 'bg-[#1d4ed8]' }] },
    vacancy: { title: '空置率', items: [{ label: '低', className: 'bg-[#fef3c7]' }, { label: '中', className: 'bg-[#f59e0b]' }, { label: '高', className: 'bg-[#b45309]' }] },
    leed: { title: 'LEED 认证', items: [{ label: '未认证', className: 'bg-zinc-300' }, { label: 'Silver / Gold', className: 'bg-[#60a5fa]' }, { label: 'Platinum', className: 'bg-[#1d4ed8]' }] },
  }[mode];

  return (
    <div className="pointer-events-none absolute bottom-0 left-0 z-[9999] rounded-tr-md border border-zinc-200/80 bg-white/95 px-3 py-2.5 shadow-lg shadow-zinc-900/5 backdrop-blur-sm" aria-label={`${config.title}图例`}>
      <div className="mb-2 text-[10px] font-semibold tracking-wide text-zinc-600">{config.title}</div>
      <div className="flex flex-wrap gap-x-3 gap-y-1.5">
        {config.items.map(item => (
          <div key={item.label} className="flex items-center gap-1.5 text-[10px] text-zinc-500">
            <span aria-hidden="true" className={`h-2.5 w-2.5 rounded-full ${item.className}`} />
            {item.label}
          </div>
        ))}
      </div>
    </div>
  );
}

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
    <div className="h-screen h-[100dvh] overflow-hidden bg-gray-50 text-zinc-900 flex flex-col">
      <header className="sticky top-0 z-10 border-b border-zinc-200 bg-white/90 backdrop-blur supports-[backdrop-filter]:bg-white/75 shrink-0">
        <div className="relative mx-auto flex max-w-[1600px] items-center justify-between px-4 py-3 sm:px-6">
          <div className="flex items-center gap-6 xl:gap-8 min-w-0">
            <div className="shrink-0">
              <h1 className="text-sm font-semibold tracking-wide text-blue-950 sm:text-base">COLLIERS DATA</h1>
              <p className="text-[11px] text-zinc-500 sm:text-xs">办公楼市场监测 · 核心地图工作台</p>
            </div>
            <div className="hidden lg:flex items-center gap-3 border-l border-zinc-200 pl-6 xl:pl-8">
              <StatCard title="净有效租金" value={stats.avgRent} unit="元/㎡/月" />
              <StatCard title="空置率" value={stats.overallVacancyPct} unit="%" />
              <StatCard title="视野项目" value={stats.visibleProjectCount} unit="个" />
              <StatCard title="总体量" value={stats.totalArea} unit="㎡" />
            </div>
            <div className="relative hidden shrink-0 lg:block">
              <button
                type="button"
                aria-expanded={isSupplyOpen}
                aria-controls="future-supply-panel"
                onClick={() => setIsSupplyOpen(open => !open)}
                className="flex items-center gap-2 rounded-md border border-zinc-200 bg-white px-3 py-2 text-sm font-medium text-zinc-600 transition-colors hover:border-[#003e7e]/40 hover:text-[#003e7e] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#003e7e]/30"
              >
                <svg aria-hidden="true" xmlns="http://www.w3.org/2000/svg" width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="17" rx="2" /><path d="M16 2v4M8 2v4M3 10h18" /></svg>
                供应日历
                <span className="tabular-nums text-zinc-400">{futureSupplies.length}</span>
              </button>
              {isSupplyOpen && (
                <div id="future-supply-panel" className="absolute left-0 top-[calc(100%+10px)] z-[400] w-[390px] max-w-[calc(100vw-32px)] rounded-lg border border-zinc-200 bg-white p-3 shadow-lg shadow-zinc-900/10">
                  <div className="mb-2.5 flex items-center justify-between border-b border-zinc-100 pb-2">
                    <div className="text-xs font-semibold text-zinc-800">供应日历</div>
                    <div className="text-[10px] text-zinc-400">未来项目按预计入市年份</div>
                  </div>
                  <div className="grid grid-cols-5 gap-1.5">
                    {SUPPLY_CALENDAR_CATEGORIES.map(category => {
                      const data = futureSupplyCalendar[category];
                      return (
                        <div key={category} className="min-w-0 rounded-md bg-zinc-50 px-1.5 py-2 text-center">
                          <div className="truncate text-[10px] text-zinc-500">{SUPPLY_CALENDAR_LABELS[category]}</div>
                          <div className="mt-1 text-base font-semibold tabular-nums text-[#003e7e]">{data.total}</div>
                          <div className="mt-1 whitespace-nowrap text-[9px] text-zinc-400">办公 {data.office}</div>
                          <div className="text-[9px] text-zinc-400">园区 {data.park}</div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          </div>
          
          {/* 右侧工具栏：搜索提示 & 返回主页按钮 */}
          <div className="flex items-center gap-4 shrink-0">
            {/* 开发者工具：导出地图数据按钮 */}
            {process.env.NODE_ENV === 'development' && (
              <button
                onClick={handleExportMapData}
                disabled={isExporting || !mapReady}
                className="group flex items-center gap-1.5 rounded-md border border-amber-200 bg-amber-50 px-3 py-1.5 text-xs font-medium text-amber-700 transition-colors hover:bg-amber-100 disabled:opacity-50 disabled:cursor-not-allowed"
                title="开发者工具：导出地图数据到本地 JSON"
              >
                {isExporting ? (
                  <>
                    <svg className="animate-spin h-3 w-3" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                    </svg>
                    导出中...
                  </>
                ) : (
                  <>
                    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
                      <polyline points="7 10 12 15 17 10"></polyline>
                      <line x1="12" y1="15" x2="12" y2="3"></line>
                    </svg>
                    导出数据
                  </>
                )}
              </button>
            )}
            
            <Link href="/" className="group flex items-center gap-1.5 rounded-md border border-zinc-200 bg-white px-3 py-1.5 text-xs font-medium text-zinc-600 transition-colors hover:bg-zinc-50 hover:text-blue-600">
              <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="transition-transform group-hover:-translate-x-0.5">
                <line x1="19" y1="12" x2="5" y2="12"></line>
                <polyline points="12 19 5 12 12 5"></polyline>
              </svg>
              返回主页
            </Link>
          </div>
        </div>
      </header>

      <main className="mx-auto flex min-h-0 max-w-[1600px] flex-1 flex-col gap-0 overflow-hidden px-4 py-4 sm:px-6 lg:flex-row lg:items-stretch w-full">
        <aside className="w-full shrink-0 lg:w-64 lg:pt-1 lg:pr-6 lg:border-r lg:border-zinc-200 lg:overflow-y-auto lg:max-h-full">
          <SidebarFilter
            title="全局筛选"
            districts={MOCK_DISTRICTS}
            submarkets={MOCK_SUBMARKETS}
            submarketsSecondary={MOCK_SUBMARKETS_SECONDARY}
            leeds={MOCK_LEEDS}
            subwayLines={MOCK_SUBWAYS}
            availableStations={currentSubwayStations}
            onFilterChange={handleFilterChange}
            onCompareGroupsChange={handleCompareGroupsChange}
            filterCommand={filterCommand}
          />
        </aside>

        <section className="flex min-h-0 min-w-0 flex-1 flex-col gap-4 lg:pl-6">
          {/* 地图工具栏：检索、显示模式与项目列表保持在同一操作层级 */}
          <div className="relative flex items-center gap-3 flex-wrap">
            <div className="min-w-[220px] flex-1">
              {activeFilterChips.length > 0 ? (
                <div className="flex min-w-0 w-full items-center gap-2 overflow-x-auto rounded-md border border-zinc-200 bg-white px-2.5 py-2" aria-label="已生效筛选条件">
                  <span className="shrink-0 text-[11px] font-medium text-zinc-400">已选</span>
                  {keyword && (
                    <button
                      type="button"
                      onClick={() => { void handleSearch(''); }}
                      className="group flex max-w-[220px] shrink-0 items-center gap-1 rounded-md border border-zinc-200 bg-zinc-50 px-2 py-1 text-[11px] text-zinc-600 transition-colors hover:border-[#003e7e]/40 hover:bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#003e7e]/30"
                      title={`清除搜索：${keyword}`}
                    >
                      <span className="truncate">搜索：{keyword}</span>
                      <span aria-hidden="true" className="text-zinc-400 group-hover:text-[#003e7e]">×</span>
                    </button>
                  )}
                  {activeFilterChips.map(chip => (
                    <button
                      key={chip.id}
                      type="button"
                      onClick={() => issueFilterCommand('patch', chip.patch)}
                      className="group flex max-w-[220px] shrink-0 items-center gap-1 rounded-md border border-zinc-200 bg-zinc-50 px-2 py-1 text-[11px] text-zinc-600 transition-colors hover:border-[#003e7e]/40 hover:bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#003e7e]/30"
                      title={`移除条件：${chip.label}`}
                    >
                      <span className="truncate">{chip.label}</span>
                      <span aria-hidden="true" className="text-zinc-400 group-hover:text-[#003e7e]">×</span>
                    </button>
                  ))}
                  <button
                    type="button"
                    onClick={() => issueFilterCommand('reset')}
                    className="shrink-0 px-1 text-[11px] font-medium text-zinc-500 transition-colors hover:text-[#003e7e] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#003e7e]/30"
                  >
                    清空
                  </button>
                </div>
              ) : (
                <SearchBar placeholder="搜索项目名称、商圈或关键词…" debounceMs={280} value={keyword} onChange={setKeyword} onSearch={handleSearch} />
              )}
            </div>
            <div className="flex shrink-0 items-center overflow-hidden rounded-md border border-zinc-200 bg-white" role="group" aria-label="地图显示模式">
              {([
                ['default', '项目类型'],
                ['rent', '租金热力'],
                ['vacancy', '空置率'],
                ['leed', 'LEED 认证'],
              ] as const).map(([mode, label], index) => (
                <button
                  key={mode}
                  type="button"
                  aria-pressed={renderMode === mode}
                  onClick={() => setRenderMode(mode)}
                  className={`shrink-0 px-3 py-1.5 text-xs font-medium transition-colors focus-visible:z-10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#003e7e]/30 ${index > 0 ? 'border-l border-zinc-200' : ''} ${renderMode === mode ? 'bg-[#003e7e] text-white' : 'text-zinc-600 hover:bg-zinc-50'}`}
                >
                  {label}
                </button>
              ))}
            </div>
            <button
              type="button"
              onClick={() => setIsListVisible(true)}
              disabled={!userHasInteracted && !keyword}
              className="flex shrink-0 items-center gap-1.5 rounded-md border border-[#003e7e] bg-white px-3 py-1.5 text-xs font-medium text-[#003e7e] transition-colors hover:bg-[#003e7e] hover:text-white disabled:cursor-not-allowed disabled:border-zinc-200 disabled:text-zinc-400 disabled:hover:bg-white"
              title={!userHasInteracted && !keyword ? '完成筛选或搜索后查看项目列表' : '查看项目列表'}
            >
              <svg aria-hidden="true" xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="8" y1="6" x2="21" y2="6" /><line x1="8" y1="12" x2="21" y2="12" /><line x1="8" y1="18" x2="21" y2="18" /><line x1="3" y1="6" x2="3.01" y2="6" /><line x1="3" y1="12" x2="3.01" y2="12" /><line x1="3" y1="18" x2="3.01" y2="18" /></svg>
              项目列表
            </button>
          </div>

          <div className="grid shrink-0 grid-cols-2 gap-3 sm:grid-cols-4 lg:hidden">
            <StatCard title="净有效租金" value={stats.avgRent} unit="元/㎡/月" />
            <StatCard title="空置率" value={stats.overallVacancyPct} unit="%" />
            <StatCard title="视野项目" value={stats.visibleProjectCount} unit="个" />
            <StatCard title="总体量" value={stats.totalArea} unit="㎡" />
          </div>
          <div className="flex min-h-0 flex-1 flex-col gap-0 overflow-hidden rounded-lg border border-zinc-200 bg-white shadow-sm">
            <div id="map-container" className="relative min-h-0 w-full flex-1 bg-[#f8f9fa]">
              {mapError ? (
                <div className="absolute inset-0 flex items-center justify-center p-4">
                  <div className="max-w-[520px] rounded-lg border border-rose-200 bg-rose-50 p-4 text-left">
                    <div className="text-sm font-semibold text-rose-700">地图加载失败</div>
                    <div className="mt-2 text-xs leading-relaxed text-rose-700/90 break-all">{mapError}</div>
                    <button
                      type="button"
                      onClick={() => {
                        const controller = controllerRef.current;
                        if (controller && mapReady) void loadMapData(controller);
                        else window.location.reload();
                      }}
                      className="mt-3 rounded-md bg-rose-700 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-rose-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-400"
                    >
                      重新加载
                    </button>
                  </div>
                </div>
              ) : null}
              {!mapReady && !mapError ? (
                <div className="absolute inset-0 flex items-center justify-center p-4">
                  <div className="rounded-lg border border-zinc-200 bg-white/90 px-4 py-3 text-center shadow-sm">
                    <div className="mx-auto h-8 w-8 animate-spin rounded-full border-2 border-[#003e7e] border-t-transparent" />
                    <div className="mt-2 text-xs text-zinc-600">地图正在加载…</div>
                  </div>
                </div>
              ) : null}

              {mapReady && mapDataLoading && allBuildings.length === 0 && !mapError ? (
                <div className="absolute inset-0 z-10 flex items-center justify-center bg-white/70 p-4">
                  <div className="rounded-lg border border-zinc-200 bg-white px-4 py-3 text-center shadow-sm">
                    <div className="mx-auto h-7 w-7 animate-spin rounded-full border-2 border-[#003e7e] border-t-transparent" />
                    <div className="mt-2 text-xs text-zinc-600">正在读取楼宇数据…</div>
                  </div>
                </div>
              ) : null}

              {mapReady && !mapError && <MapLegend mode={renderMode} />}
              
              {/* 🌟 Phase 2: 按需加载悬浮楼宇列表 - 仅在 isListVisible 为 true 时挂载 */}
              {isListVisible && (
                <FloatingBuildingList
                  buildings={combinedBuildingList}
                  displayOverrides={displayOverrides}
                  onClose={() => setIsListVisible(false)}
                  onBuildingClick={handleBuildingClick}
                  targetBuildingId={targetBuildingId}
                  onBuildingHover={handleBuildingHover}
                />
              )}
            </div>
          </div>
        </section>
      </main>

      {/* 管理员编辑楼宇指标数据弹窗 */}
      {editingBuilding && (
        <BuildingMetricsEditModal
          buildingId={editingBuilding.id}
          buildingName={editingBuilding.name}
          isOpen={true}
          onClose={() => setEditingBuilding(null)}
          onSave={async () => {
            // 刷新地图数据
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
    </div>
  );
}
