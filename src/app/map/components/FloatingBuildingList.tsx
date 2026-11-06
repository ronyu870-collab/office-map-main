'use client';

import * as React from 'react';
import { BuildingBasicCard } from './BuildingBasicCard';
import { getLatestMetric } from '@/src/utils/filterBuildings';
import { isPendingFutureSupply } from '@/src/lib/future-supply-status';

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
  const [viewMode, setViewMode] = React.useState<'cards' | 'compact'>('compact');
  const loadMoreTriggerRef = React.useRef<HTMLDivElement>(null);
  const listContainerRef = React.useRef<HTMLDivElement>(null);

  const existingCount = React.useMemo(() => buildings.filter(b => b._dataType !== 'future').length, [buildings]);
  const futureCount = React.useMemo(() => buildings.filter(b => b._dataType === 'future').length, [buildings]);

  React.useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || (event.target instanceof Element && event.target.closest('[role="dialog"][aria-modal="true"]'))) return;
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  React.useEffect(() => {
    const trigger = loadMoreTriggerRef.current;
    if (!trigger) return;
    const observer = new IntersectionObserver(entries => {
      if (entries[0]?.isIntersecting && visibleCount < buildings.length) {
        setVisibleCount(previous => Math.min(previous + LOAD_MORE_COUNT, buildings.length));
      }
    }, { root: listContainerRef.current, rootMargin: '100px', threshold: 0.1 });
    observer.observe(trigger);
    return () => observer.disconnect();
  }, [visibleCount, buildings.length]);

  React.useEffect(() => {
    setVisibleCount(INITIAL_LOAD_COUNT);
    if (listContainerRef.current) listContainerRef.current.scrollTop = 0;
  }, [buildings]);

  const visibleBuildings = buildings.slice(0, visibleCount);
  const hasMore = visibleCount < buildings.length;

  const materialAction = (building: any) => {
    if (building._dataType === 'future' && isPendingFutureSupply(building)) return null;
    const id=building._dataType === 'future' ? building.building_id : building.id;
    if (!id) return null;
    return <button type="button" data-map-action="building-sales-control" data-building-id={id}
      data-building-name={building.name || '当前楼宇'} aria-label={`查看${building.name || '当前楼宇'}资料与佣金`}
      className="min-h-11 w-full border-t border-[#e7ebf0] px-3 py-2 text-left text-sm font-semibold text-[#003e7e] hover:bg-[#edf4fb] focus-visible:outline-2 focus-visible:outline-offset-[-2px]">
      查看资料与佣金
    </button>;
  };

  const renderCompactRow = (building: any) => {
    const metric = getLatestMetric(building.metrics ?? []);
    const rent = metric?.net_effective_rent !== undefined && metric?.net_effective_rent !== null
      ? Number(metric.net_effective_rent).toLocaleString('zh-CN', { maximumFractionDigits: 1 })
      : '—';
    const vacancy = metric?.vacancy_rate !== undefined && metric?.vacancy_rate !== null
      ? `${(Number(metric.vacancy_rate) <= 1 ? Number(metric.vacancy_rate) * 100 : Number(metric.vacancy_rate)).toFixed(1)}%`
      : '—';
    const area = metric?.total_area ? Number(metric.total_area).toLocaleString('zh-CN', { maximumFractionDigits: 0 }) : '—';
    const isFuture = building._dataType === 'future';
    const isTarget = targetBuildingId === building.id;

    return (
      <div key={building.id}>
      <div
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
        className={`grid cursor-pointer grid-cols-[minmax(0,1fr)_64px_54px_72px] items-center gap-2 border-b border-[#e7ebf0] px-3 py-2 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#003e7e]/25 ${isTarget ? 'bg-[#edf4fb]' : 'bg-white hover:bg-[#f8fafc]'}`}
      >
        <div className="min-w-0">
          <div className="flex min-w-0 items-center gap-1.5">
            <span className="truncate text-[11px] font-semibold text-[#172033]">{building.name || '未命名项目'}</span>
            {isFuture ? <span className="shrink-0 rounded-[3px] border border-emerald-200 bg-emerald-50 px-1 py-0.5 text-[10px] font-medium text-emerald-700">{isPendingFutureSupply(building) ? '待核实' : '未来'}</span> : null}
          </div>
          <div className="mt-0.5 truncate text-[10px] text-[#8a94a6]">{[building.submarket, building.grade].filter(Boolean).join(' · ') || '—'}</div>
        </div>
        <div className="text-right"><div className="text-[10px] text-[#8a94a6]">净租金</div><div className="mt-0.5 text-[10px] font-semibold tabular-nums text-[#003e7e]">{rent}</div></div>
        <div className="text-right"><div className="text-[10px] text-[#8a94a6]">空置率</div><div className="mt-0.5 text-[10px] font-medium tabular-nums text-[#172033]">{vacancy}</div></div>
        <div className="text-right"><div className="text-[10px] text-[#8a94a6]">面积㎡</div><div className="mt-0.5 text-[10px] font-medium tabular-nums text-[#172033]">{area}</div></div>
      </div>
      {materialAction(building)}
      </div>
    );
  };

  return (
    <section className="relative flex h-full w-full flex-col overflow-hidden rounded-[8px] border border-[#d9e0e8] bg-white shadow-[0_10px_28px_rgba(23,32,51,0.12)]" aria-label="项目列表">
      <div className="flex shrink-0 items-center justify-between border-b border-[#d9e0e8] bg-[#f8fafc] px-3 py-2.5">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h2 className="text-[12px] font-semibold text-[#172033]">项目列表</h2>
            <span className="rounded-[3px] border border-[#d9e0e8] bg-white px-1.5 py-0.5 text-[10px] font-medium tabular-nums text-[#667085]">{buildings.length}</span>
          </div>
          <p className="mt-0.5 truncate text-[10px] text-[#8a94a6]">
            {existingCount > 0 && futureCount > 0 ? `现有 ${existingCount} · 未来供应 ${futureCount}` : futureCount > 0 ? `未来供应 ${futureCount}` : `现有项目 ${existingCount}`}
          </p>
        </div>
        <button onClick={onClose} className="flex h-7 w-7 items-center justify-center rounded-[4px] border border-transparent text-[#8a94a6] transition hover:border-[#d9e0e8] hover:bg-white hover:text-[#172033] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#003e7e]/20" aria-label="关闭列表" title="关闭列表 (ESC)">
          <svg aria-hidden="true" viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6 6 18M6 6l12 12" /></svg>
        </button>
      </div>

      <div className="flex shrink-0 items-center justify-between border-b border-[#e7ebf0] px-3 py-1.5">
        <span className="text-[10px] font-medium text-[#8a94a6]">市场项目</span>
        <div className="flex overflow-hidden rounded-[4px] border border-[#d9e0e8] bg-white" role="group" aria-label="项目列表查看方式">
          <button type="button" aria-pressed={viewMode === 'compact'} onClick={() => setViewMode('compact')} className={`px-2 py-1 text-[10px] font-medium ${viewMode === 'compact' ? 'bg-[#003e7e] text-white' : 'text-[#667085] hover:bg-[#f8fafc]'}`}>列表</button>
          <button type="button" aria-pressed={viewMode === 'cards'} onClick={() => setViewMode('cards')} className={`border-l border-[#d9e0e8] px-2 py-1 text-[10px] font-medium ${viewMode === 'cards' ? 'bg-[#003e7e] text-white' : 'text-[#667085] hover:bg-[#f8fafc]'}`}>详情</button>
        </div>
      </div>

      {viewMode === 'compact' && buildings.length > 0 ? (
        <div className="grid shrink-0 grid-cols-[minmax(0,1fr)_64px_54px_72px] gap-2 border-b border-[#d9e0e8] bg-[#f8fafc] px-3 py-1.5 text-[10px] font-medium text-[#8a94a6]">
          <span>项目</span><span className="text-right">元/㎡/月</span><span className="text-right">%</span><span className="text-right">总面积</span>
        </div>
      ) : null}

      <div ref={listContainerRef} className="min-h-0 flex-1 overflow-y-auto" style={{ scrollbarWidth: 'thin', scrollbarColor: '#c3ccd8 transparent' }}>
        {buildings.length === 0 ? (
          <div className="flex h-full min-h-48 flex-col items-center justify-center px-5 text-center">
            <div className="text-[12px] font-semibold text-[#667085]">未找到符合条件的楼宇</div>
            <div className="mt-1 text-[10px] text-[#8a94a6]">调整筛选或搜索条件后重试</div>
          </div>
        ) : viewMode === 'cards' ? (
          <div className="space-y-2 p-2.5">
            {visibleBuildings.map(building => (
              <div key={building.id} className={targetBuildingId === building.id ? 'outline outline-2 outline-[#003e7e]/25' : ''} onMouseEnter={() => onBuildingHover?.(building.id)} onMouseLeave={() => onBuildingHover?.(null)}>
                <BuildingBasicCard building={building} displayOverrides={displayOverrides} onClick={() => onBuildingClick?.(building)} />
                {materialAction(building)}
              </div>
            ))}
          </div>
        ) : (
          <div>{visibleBuildings.map(renderCompactRow)}</div>
        )}

        {hasMore ? (
          <div ref={loadMoreTriggerRef} className="flex items-center justify-center border-t border-[#e7ebf0] py-3 text-[10px] text-[#8a94a6]">继续加载…</div>
        ) : buildings.length > INITIAL_LOAD_COUNT ? (
          <div className="border-t border-[#e7ebf0] py-2.5 text-center text-[10px] text-[#8a94a6]">已加载全部 {buildings.length} 个项目</div>
        ) : null}
      </div>
    </section>
  );
}
