'use client';

import * as React from 'react';
import { BuildingBasicCard } from './BuildingBasicCard';
import { getLatestMetric } from '@/src/utils/filterBuildings';

// 🌟 Phase 4: 悬浮楼宇列表组件
// 实现原生极简性能优化：切片加载 + IntersectionObserver

interface DisplayOverride {
  display_label: string;
  display_value: string;
}

interface FloatingBuildingListProps {
  buildings: any[];
  displayOverrides?: Map<string, Map<string, DisplayOverride>>;
  onClose: () => void;
  onBuildingClick?: (building: any) => void;
  targetBuildingId?: string | null;
  onBuildingHover?: (buildingId: string | null) => void;
}

const INITIAL_LOAD_COUNT = 50;
const LOAD_MORE_COUNT = 50;

export default function FloatingBuildingList({ buildings, displayOverrides, onClose, onBuildingClick, targetBuildingId, onBuildingHover }: FloatingBuildingListProps) {
  const [visibleCount, setVisibleCount] = React.useState(INITIAL_LOAD_COUNT);
  const [viewMode, setViewMode] = React.useState<'cards' | 'compact'>('cards');
  const loadMoreTriggerRef = React.useRef<HTMLDivElement>(null);
  const listContainerRef = React.useRef<HTMLDivElement>(null);

  const existingCount = React.useMemo(() => buildings.filter(b => b._dataType !== 'future').length, [buildings]);
  const futureCount = React.useMemo(() => buildings.filter(b => b._dataType === 'future').length, [buildings]);

  React.useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);
  
  // 🌟 Phase 4: 使用原生 IntersectionObserver 实现无限滚动
  React.useEffect(() => {
    const trigger = loadMoreTriggerRef.current;
    if (!trigger) return;
    
    const observer = new IntersectionObserver(
      (entries) => {
        const [entry] = entries;
        if (entry.isIntersecting && visibleCount < buildings.length) {
          setVisibleCount(prev => Math.min(prev + LOAD_MORE_COUNT, buildings.length));
        }
      },
      {
        root: listContainerRef.current,
        rootMargin: '100px', // 提前 100px 触发加载
        threshold: 0.1,
      }
    );
    
    observer.observe(trigger);
    
    return () => {
      observer.disconnect();
    };
  }, [visibleCount, buildings.length]);
  
  React.useEffect(() => {
    setVisibleCount(INITIAL_LOAD_COUNT);
    if (listContainerRef.current) {
      listContainerRef.current.scrollTop = 0;
    }
  }, [buildings]);

  const visibleBuildings = buildings.slice(0, visibleCount);
  const hasMore = visibleCount < buildings.length;

  const renderCompactRow = (building: any) => {
    const metric = getLatestMetric(building.metrics ?? []);
    const rent = metric?.net_effective_rent !== undefined && metric?.net_effective_rent !== null
      ? `¥${Number(metric.net_effective_rent).toLocaleString('zh-CN', { maximumFractionDigits: 1 })}`
      : '—';
    const vacancy = metric?.vacancy_rate !== undefined && metric?.vacancy_rate !== null
      ? `${(Number(metric.vacancy_rate) <= 1 ? Number(metric.vacancy_rate) * 100 : Number(metric.vacancy_rate)).toFixed(1)}%`
      : '—';
    const area = metric?.total_area ? `${Number(metric.total_area).toLocaleString('zh-CN', { maximumFractionDigits: 0 })}㎡` : '—';
    const isFuture = building._dataType === 'future';
    return (
      <div
        key={building.id}
        role="button"
        tabIndex={0}
        onClick={() => onBuildingClick?.(building)}
        onKeyDown={event => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            onBuildingClick?.(building);
          }
        }}
        onMouseEnter={() => onBuildingHover?.(building.id)}
        onMouseLeave={() => onBuildingHover?.(null)}
        className={`cursor-pointer border-b border-zinc-100 px-3 py-2.5 transition-colors hover:bg-zinc-50 focus-visible:bg-zinc-50 focus-visible:outline-none ${targetBuildingId === building.id ? 'bg-blue-50/70' : ''}`}
      >
        <div className="flex min-w-0 items-center gap-2">
          <h3 className="min-w-0 flex-1 truncate text-xs font-semibold text-zinc-800">{building.name || '未命名项目'}</h3>
          {isFuture && <span className="shrink-0 text-[9px] font-medium text-zinc-500">未来供应</span>}
        </div>
        <div className="mt-1.5 grid grid-cols-3 gap-2 text-[10px] tabular-nums">
          <div><div className="text-zinc-400">净有效租金</div><div className="mt-0.5 font-semibold text-[#003e7e]">{rent}</div></div>
          <div><div className="text-zinc-400">空置率</div><div className="mt-0.5 font-semibold text-zinc-700">{vacancy}</div></div>
          <div><div className="text-zinc-400">总面积</div><div className="mt-0.5 font-semibold text-zinc-700">{area}</div></div>
        </div>
      </div>
    );
  };

  return (
    <div 
      className="absolute right-0 z-[200] w-[340px] max-w-[90vw] rounded-md border border-zinc-200/50 bg-white/90 backdrop-blur-md shadow-xl shadow-black/5 animate-in slide-in-from-bottom-4 fade-in duration-300" 
      style={{ 
        top: '12px',
        bottom: '12px',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden'
      }}
    >
      {/* 🌟 Header：统计信息 + 关闭按钮 */}
      <div 
        className="flex items-center justify-between border-b border-zinc-200/50 bg-white/50 px-5 py-4"
        style={{ flexShrink: 0 }}
      >
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-zinc-50">
            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-zinc-600">
              <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"></path>
              <polyline points="9 22 9 12 15 12 15 22"></polyline>
            </svg>
          </div>
          <div>
            <h2 className="text-base font-bold text-zinc-800">楼宇列表</h2>
            <p className="text-xs font-medium text-zinc-500">
              {existingCount > 0 && futureCount > 0 
                ? `现有 ${existingCount} 栋 · 未来供应 ${futureCount} 栋`
                : futureCount > 0 
                  ? `未来供应 ${futureCount} 栋`
                  : `共 ${buildings.length} 栋楼宇`
              }
            </p>
          </div>
        </div>
        
        <button
          onClick={onClose}
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-zinc-400 transition-all hover:bg-zinc-100 hover:text-zinc-700 focus:outline-none focus:ring-2 focus:ring-zinc-200"
          aria-label="关闭列表"
          title="关闭列表 (ESC)"
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="18" y1="6" x2="6" y2="18"></line>
            <line x1="6" y1="6" x2="18" y2="18"></line>
          </svg>
        </button>
      </div>

      <div className="flex shrink-0 items-center justify-between border-b border-zinc-100 px-5 py-2.5">
        <span className="text-[10px] font-medium text-zinc-400">查看方式</span>
        <div className="flex overflow-hidden rounded-md border border-zinc-200 bg-white" role="group" aria-label="项目列表查看方式">
          <button type="button" aria-pressed={viewMode === 'cards'} onClick={() => setViewMode('cards')} className={`px-2.5 py-1 text-[10px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#003e7e]/30 ${viewMode === 'cards' ? 'bg-[#003e7e] text-white' : 'text-zinc-600 hover:bg-zinc-50'}`}>卡片</button>
          <button type="button" aria-pressed={viewMode === 'compact'} onClick={() => setViewMode('compact')} className={`border-l border-zinc-200 px-2.5 py-1 text-[10px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#003e7e]/30 ${viewMode === 'compact' ? 'bg-[#003e7e] text-white' : 'text-zinc-600 hover:bg-zinc-50'}`}>紧凑列表</button>
        </div>
      </div>

      {/* 🌟 列表滚动区域 */}
      <div
        ref={listContainerRef}
        className="scrollbar-thin scrollbar-thumb-zinc-200 scrollbar-track-transparent hover:scrollbar-thumb-zinc-300"
        style={{
          flex: 1,
          overflowY: 'auto',
          scrollbarWidth: 'thin',
          scrollbarColor: '#e4e4e7 transparent',
          minHeight: 0
        }}
      >
        {buildings.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 px-4">
            <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-xl bg-zinc-50">
              <svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-zinc-300">
                <circle cx="11" cy="11" r="8"></circle>
                <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
              </svg>
            </div>
            <p className="text-sm font-semibold text-zinc-700">未找到符合条件的楼宇</p>
            <p className="mt-1.5 text-xs text-zinc-400">请调整左侧筛选条件</p>
          </div>
        ) : (
          <div className={viewMode === 'cards' ? 'p-5' : 'p-0'}>
            <div className={viewMode === 'cards' ? 'flex flex-col gap-3' : 'flex flex-col'}>
              {viewMode === 'cards' ? visibleBuildings.map((building) => {
                const isTarget = targetBuildingId && building.id === targetBuildingId;
                return (
                  <div key={building.id} className={isTarget ? 'rounded-xl bg-blue-50/60 ring-2 ring-blue-500 shadow-md shadow-blue-500/10' : ''} onMouseEnter={() => onBuildingHover?.(building.id)} onMouseLeave={() => onBuildingHover?.(null)}>
                    <BuildingBasicCard building={building} displayOverrides={displayOverrides} onClick={() => onBuildingClick?.(building)} />
                  </div>
                );
              }) : visibleBuildings.map(renderCompactRow)}
              
              {hasMore && (
                <div 
                  ref={loadMoreTriggerRef}
                  className="flex items-center justify-center py-4"
                >
                  <div className="flex items-center gap-2 text-xs text-zinc-400">
                    <div className="h-4 w-4 animate-spin rounded-full border-2 border-zinc-300 border-t-blue-600"></div>
                    <span>加载中...</span>
                  </div>
                </div>
              )}
              
              {!hasMore && buildings.length > INITIAL_LOAD_COUNT && (
                <div className="py-4 text-center text-xs text-zinc-400">
                  已加载全部 {buildings.length} 栋楼宇
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
