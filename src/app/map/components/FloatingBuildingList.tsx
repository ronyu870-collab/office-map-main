'use client';

import * as React from 'react';
import { BuildingBasicCard } from './BuildingBasicCard';
import { getLatestMetric } from '@/src/utils/filterBuildings';
import { isPendingFutureSupply } from '@/src/lib/future-supply-status';
import { MaskedText, useIsDemo } from '@/src/components/demo';
import { logAction } from '@/src/utils/audit';
import { sortFullList, type FullListSort } from '../model/fullBuildingList';
import type { ComparisonLayout } from './buildingComparisonExport';

interface DisplayOverride {
  display_label: string;
  display_value: string;
}

interface FloatingBuildingListProps {
  buildings: any[];
  active?: boolean;
  displayOverrides?: Map<string, Map<string, DisplayOverride>>;
  onClose: () => void;
  onBuildingClick?: (building: any) => void;
  targetBuildingId?: string | null;
  onBuildingHover?: (buildingId: string | null) => void;
  selectedComparisonBuildings?: any[];
  onComparisonSelectionChange?: (buildings: any[], selected: boolean) => void;
}

const INITIAL_LOAD_COUNT = 50;
const LOAD_MORE_COUNT = 50;

export default function FloatingBuildingList({ buildings, active = true, displayOverrides, onClose, onBuildingClick, targetBuildingId, onBuildingHover, selectedComparisonBuildings = [], onComparisonSelectionChange }: FloatingBuildingListProps) {
  const [query, setQuery] = React.useState('');
  const [sort, setSort] = React.useState<FullListSort>('default');
  const results: any[] = React.useMemo(() => sortFullList(buildings.filter(building =>
    [building.name, building.submarket, building.owner, building.property_management].some(value => String(value ?? '').toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()))), sort), [buildings, query, sort]);
  const [visibleCount, setVisibleCount] = React.useState(INITIAL_LOAD_COUNT);
  const [viewMode, setViewMode] = React.useState<'cards' | 'compact'>('compact');
  const loadMoreTriggerRef = React.useRef<HTMLDivElement>(null);
  const listContainerRef = React.useRef<HTMLDivElement>(null);
  const dialogRef = React.useRef<HTMLDivElement>(null);
  const isDemo = useIsDemo();
  const [selectionMode, setSelectionMode] = React.useState(false);
  const [exportOpen, setExportOpen] = React.useState(false);
  const [layout, setLayout] = React.useState<ComparisonLayout>('rows');
  const [exportBusy, setExportBusy] = React.useState(false);
  const [exportError, setExportError] = React.useState<string | null>(null);
  const comparisonKey = (building: any) => (building._dataType === 'future' ? 'future:' : 'existing:') + building.id;
  const selectedKeys = new Set(selectedComparisonBuildings.map(comparisonKey));

  React.useEffect(() => {
    if (exportOpen) dialogRef.current?.querySelector<HTMLButtonElement>('button')?.focus({ preventScroll: true });
  }, [exportOpen]);

  const selectionCheckbox = (building: any) => (
    <label className="flex min-h-11 w-9 shrink-0 items-center justify-center">
      <input type="checkbox" aria-label={'选择' + (building.name || '未命名项目')}
        className="h-4 w-4 accent-[#003e7e]"
        checked={selectedKeys.has(comparisonKey(building))}
        onChange={event => onComparisonSelectionChange?.([building], event.currentTarget.checked)} />
    </label>
  );

  const exportPng = async () => {
    if (exportBusy || isDemo || !selectedComparisonBuildings.length) return;
    setExportBusy(true);
    setExportError(null);
    try {
      const { downloadBuildingComparisonPng } = await import('./buildingComparisonExport');
      await downloadBuildingComparisonPng(selectedComparisonBuildings, layout, displayOverrides);
      logAction(undefined, 'EXPORT_BUILDING_COMPARISON', {
        format: 'png', layout, count: selectedComparisonBuildings.length,
        buildingIds: selectedComparisonBuildings.map(building => building.id),
      });
      setExportOpen(false);
    } catch (error) {
      setExportError(error instanceof Error ? error.message : '导出失败，请重试');
    } finally {
      setExportBusy(false);
    }
  };

  const existingCount = React.useMemo(() => results.filter(b => b._dataType !== 'future').length, [results]);
  const futureCount = React.useMemo(() => results.filter(b => b._dataType === 'future').length, [results]);

  React.useEffect(() => {
    if (!active) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || (event.target instanceof Element && event.target.closest('[role="dialog"][aria-modal="true"]'))) return;
      if (event.key === 'Escape') { event.preventDefault(); onClose(); }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [active, onClose]);

  React.useEffect(() => {
    const trigger = loadMoreTriggerRef.current;
    if (!trigger) return;
    const observer = new IntersectionObserver(entries => {
      if (entries[0]?.isIntersecting && visibleCount < results.length) {
        setVisibleCount(previous => Math.min(previous + LOAD_MORE_COUNT, results.length));
      }
    }, { root: listContainerRef.current, rootMargin: '100px', threshold: 0.1 });
    observer.observe(trigger);
    return () => observer.disconnect();
  }, [visibleCount, results.length]);

  React.useEffect(() => {
    setVisibleCount(INITIAL_LOAD_COUNT);
    if (listContainerRef.current) listContainerRef.current.scrollTop = 0;
  }, [results]);

  React.useEffect(() => {
    if (!active || !targetBuildingId) return;
    const index = results.findIndex(building => building.id === targetBuildingId);
    if (index >= visibleCount) setVisibleCount(index + 1);
    const frame = requestAnimationFrame(() => listContainerRef.current?.querySelector<HTMLElement>('[aria-current="true"]')?.scrollIntoView?.({ block: 'nearest' }));
    return () => cancelAnimationFrame(frame);
  }, [active, targetBuildingId, results, visibleCount]);
  const visibleBuildings = results.slice(0, visibleCount);
  const hasMore = visibleCount < results.length;

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
      <div key={comparisonKey(building)}>
      <div className={selectionMode ? 'flex items-stretch border-b border-[#e7ebf0]' : ''}>
        {selectionMode ? selectionCheckbox(building) : null}
      <div
        role="button"
        aria-current={isTarget || undefined}
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
        className={`grid min-w-0 flex-1 cursor-pointer ${selectionMode ? 'grid-cols-[minmax(0,1fr)_64px_54px]' : 'grid-cols-[minmax(0,1fr)_64px_54px_72px]'} items-center gap-2 border-b border-[#e7ebf0] px-3 py-2 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#003e7e]/25 ${isTarget ? 'bg-[#edf4fb]' : 'bg-white hover:bg-[#f8fafc]'}`}
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
        {!selectionMode ? <div className="text-right"><div className="text-[10px] text-[#8a94a6]">面积㎡</div><div className="mt-0.5 text-[10px] font-medium tabular-nums text-[#172033]">{area}</div></div> : null}
      </div>
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
            <span className="rounded-[3px] border border-[#d9e0e8] bg-white px-1.5 py-0.5 text-[10px] font-medium tabular-nums text-[#667085]">{results.length}</span>
          </div>
          <p className="mt-0.5 truncate text-[10px] text-[#8a94a6]">
            {existingCount > 0 && futureCount > 0 ? `现有 ${existingCount} · 未来供应 ${futureCount}` : futureCount > 0 ? `未来供应 ${futureCount}` : `现有项目 ${existingCount}`}
          </p>
        </div>
        <button onClick={onClose} className="flex h-7 w-7 items-center justify-center rounded-[4px] border border-transparent text-[#8a94a6] transition hover:border-[#d9e0e8] hover:bg-white hover:text-[#172033] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#003e7e]/20" aria-label="关闭列表" title="关闭列表 (ESC)">
          <svg aria-hidden="true" viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6 6 18M6 6l12 12" /></svg>
        </button>
      </div>

      <div className="workspace-list-query">
        <label><span className="sr-only">搜索当前项目列表</span><input type="search" value={query} onChange={event => setQuery(event.currentTarget.value)} placeholder="搜索当前项目列表" /></label>
        <select aria-label="项目列表排序" value={sort} onChange={event => setSort(event.currentTarget.value as FullListSort)}>
          <option value="default">默认顺序</option><option value="name">项目名称</option><option value="area">面积从大到小</option><option value="rent">租金从低到高</option><option value="rent-desc">租金从高到低</option><option value="vacancy">空置率从低到高</option>
        </select>
      </div>
      <div className="flex shrink-0 items-center justify-between border-b border-[#e7ebf0] px-3 py-1.5">
        <span className="text-[10px] font-medium text-[#8a94a6]">市场项目</span>
        <div className="flex items-center gap-2">
          {onComparisonSelectionChange ? <button type="button" aria-pressed={selectionMode}
            className="min-h-8 text-[12px] font-medium text-[#003e7e]"
            onClick={() => setSelectionMode(current => !current)}>
            {selectionMode ? '完成选择' : '选择项目' + (selectedComparisonBuildings.length ? '（' + selectedComparisonBuildings.length + '）' : '')}
          </button> : null}
        <div className="flex overflow-hidden rounded-[4px] border border-[#d9e0e8] bg-white" role="group" aria-label="项目列表查看方式">
          <button type="button" aria-pressed={viewMode === 'compact'} onClick={() => setViewMode('compact')} className={`px-2 py-1 text-[10px] font-medium ${viewMode === 'compact' ? 'bg-[#003e7e] text-white' : 'text-[#667085] hover:bg-[#f8fafc]'}`}>列表</button>
          <button type="button" aria-pressed={viewMode === 'cards'} onClick={() => setViewMode('cards')} className={`border-l border-[#d9e0e8] px-2 py-1 text-[10px] font-medium ${viewMode === 'cards' ? 'bg-[#003e7e] text-white' : 'text-[#667085] hover:bg-[#f8fafc]'}`}>详情</button>
        </div>
        </div>
      </div>

      {selectionMode && onComparisonSelectionChange ? (
        <div className="shrink-0 space-y-2 border-b border-[#d9e0e8] bg-[#f8fafc] px-3 py-2">
          <div className="flex items-center justify-between gap-2">
            <span className="text-[12px] font-medium text-[#172033]">已选 {selectedComparisonBuildings.length} 栋</span>
            <div className="flex items-center gap-2">
              <button type="button" className="min-h-8 text-[12px] text-[#003e7e]" disabled={!results.length}
                onClick={() => onComparisonSelectionChange(results, true)}>全选当前结果</button>
              <button type="button" className="min-h-8 text-[12px] text-[#667085]" disabled={!selectedComparisonBuildings.length}
                onClick={() => onComparisonSelectionChange(selectedComparisonBuildings, false)}>清空</button>
            </div>
          </div>
          <button type="button" className="min-h-9 w-full rounded-[6px] bg-[#003e7e] px-3 text-[13px] font-medium text-white disabled:cursor-not-allowed disabled:opacity-50"
            disabled={!selectedComparisonBuildings.length || isDemo}
            onClick={() => { setExportError(null); setExportOpen(true); }}>
            导出对比图 PNG
          </button>
          {isDemo ? <p className="text-[12px] text-[#667085]">演示账号不提供未脱敏数据导出。</p> : null}
        </div>
      ) : null}

      {viewMode === 'compact' && buildings.length > 0 ? (
        <div className={'grid shrink-0 ' + (selectionMode ? 'grid-cols-[32px_minmax(0,1fr)_64px_54px]' : 'grid-cols-[minmax(0,1fr)_64px_54px_72px]') + ' gap-2 border-b border-[#d9e0e8] bg-[#f8fafc] px-3 py-1.5 text-[10px] font-medium text-[#8a94a6]'}>
          {selectionMode ? <span /> : null}
          <span>项目</span><span className="text-right">元/㎡/月</span><span className="text-right">%</span>{!selectionMode ? <span className="text-right">总面积</span> : null}
        </div>
      ) : null}

      <div ref={listContainerRef} className="min-h-0 flex-1 overflow-y-auto" style={{ scrollbarWidth: 'thin', scrollbarColor: '#c3ccd8 transparent' }}>
        {results.length === 0 ? (
          <div className="flex h-full min-h-48 flex-col items-center justify-center px-5 text-center">
            <div className="text-[12px] font-semibold text-[#667085]">未找到符合条件的楼宇</div>
            <div className="mt-1 text-[10px] text-[#8a94a6]">调整筛选或搜索条件后重试</div>
          </div>
        ) : viewMode === 'cards' ? (
          <div className="space-y-2 p-2.5">
            {visibleBuildings.map(building => (
              <div key={comparisonKey(building)} className={targetBuildingId === building.id ? 'outline outline-2 outline-[#003e7e]/25' : ''} onMouseEnter={() => onBuildingHover?.(building.id)} onMouseLeave={() => onBuildingHover?.(null)}>
                <div className={selectionMode ? 'flex items-start gap-1' : ''}>
                  {selectionMode ? selectionCheckbox(building) : null}
                  <div className="min-w-0 flex-1">
                    <BuildingBasicCard building={building} displayOverrides={displayOverrides} onClick={() => onBuildingClick?.(building)} />
                    {materialAction(building)}
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div>{visibleBuildings.map(renderCompactRow)}</div>
        )}

        {hasMore ? (
          <div ref={loadMoreTriggerRef} className="flex items-center justify-center border-t border-[#e7ebf0] py-3 text-[10px] text-[#8a94a6]">继续加载…</div>
        ) : results.length > INITIAL_LOAD_COUNT ? (
          <div className="border-t border-[#e7ebf0] py-2.5 text-center text-[10px] text-[#8a94a6]">已加载全部 {results.length} 个项目</div>
        ) : null}
      </div>
      {exportOpen ? (
        <div className="pointer-events-auto fixed inset-0 z-[800] flex items-center justify-center bg-[#172033]/40 p-4">
          <div ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="comparison-export-title"
            className="flex max-h-[88dvh] w-full max-w-[560px] flex-col overflow-hidden rounded-[8px] bg-white shadow-xl"
            onKeyDown={event => {
              if (event.key === 'Escape') {
                event.preventDefault(); event.stopPropagation();
                if (!exportBusy) setExportOpen(false);
              }
              if (event.key === 'Tab') {
                const buttons = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('button:not([disabled])'));
                if (!buttons.length) return;
                if (event.shiftKey && document.activeElement === buttons[0]) { event.preventDefault(); buttons[buttons.length - 1].focus(); }
                else if (!event.shiftKey && document.activeElement === buttons[buttons.length - 1]) { event.preventDefault(); buttons[0].focus(); }
              }
            }}>
            <div className="flex items-center justify-between border-b border-[#d9e0e8] px-4 py-3">
              <h2 id="comparison-export-title" className="text-[16px] font-semibold text-[#172033]">导出楼宇参数对比</h2>
              <button type="button" className="min-h-11 min-w-11 text-[20px] text-[#667085]" aria-label="关闭导出设置"
                disabled={exportBusy} onClick={() => setExportOpen(false)}>×</button>
            </div>
            <div className="min-h-0 space-y-4 overflow-y-auto px-4 py-4">
              <p className="text-[13px] text-[#667085]">仅导出已勾选的 {selectedComparisonBuildings.length} 栋楼宇，按所选顺序排列。</p>
              <div role="group" aria-label="对比图片布局" className="grid grid-cols-2 gap-2">
                <button type="button" aria-pressed={layout === 'rows'} onClick={() => setLayout('rows')}
                  className={'min-h-11 rounded-[6px] border px-3 text-left text-[13px] ' + (layout === 'rows' ? 'border-[#003e7e] bg-[#edf4fb] text-[#003e7e]' : 'border-[#d9e0e8] text-[#172033]')}>
                  A · 每栋楼一行
                </button>
                <button type="button" aria-pressed={layout === 'columns'} onClick={() => setLayout('columns')}
                  className={'min-h-11 rounded-[6px] border px-3 text-left text-[13px] ' + (layout === 'columns' ? 'border-[#003e7e] bg-[#edf4fb] text-[#003e7e]' : 'border-[#d9e0e8] text-[#172033]')}>
                  B · 每栋楼一列
                </button>
              </div>
              <p className="text-[12px] text-[#667085]">{layout === 'rows' ? '适合多项目纵向列表，一张长图展示经营指标。' : '适合重点项目逐项比较，超过 5 栋自动纵向分组。'}</p>
              <details className="rounded-[6px] border border-[#d9e0e8] px-3 py-2">
                <summary className="cursor-pointer py-1 text-[13px] font-medium text-[#172033]">查看已选项目（{selectedComparisonBuildings.length}）</summary>
                <div className="mt-2 max-h-40 space-y-1 overflow-y-auto">
                  {selectedComparisonBuildings.map(building => (
                    <div key={comparisonKey(building)} className="flex min-h-9 items-center justify-between gap-3 border-t border-[#edf0f4] py-1">
                      <span className="min-w-0 flex-1 truncate text-[13px] text-[#172033]"><MaskedText>{building.name || '未命名项目'}</MaskedText></span>
                      <button type="button" className="min-h-9 shrink-0 px-2 text-[12px] text-[#003e7e]"
                        onClick={() => onComparisonSelectionChange?.([building], false)}>移除</button>
                    </div>
                  ))}
                </div>
              </details>
              {exportError ? <p role="alert" className="text-[13px] text-[#c9362b]">{exportError}</p> : null}
            </div>
            <div className="flex items-center justify-end gap-2 border-t border-[#d9e0e8] px-4 py-3">
              <button type="button" className="min-h-11 rounded-[6px] border border-[#d9e0e8] px-4 text-[13px]"
                disabled={exportBusy} onClick={() => setExportOpen(false)}>取消</button>
              <button type="button" disabled={exportBusy || !selectedComparisonBuildings.length || isDemo}
                className="min-h-11 rounded-[6px] bg-[#003e7e] px-4 text-[13px] font-semibold text-white disabled:opacity-50"
                onClick={() => { void exportPng(); }}>{exportBusy ? '生成中…' : '下载 PNG'}</button>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}
