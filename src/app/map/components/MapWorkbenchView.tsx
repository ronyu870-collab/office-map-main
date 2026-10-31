'use client';

import * as React from 'react';
import dynamic from 'next/dynamic';
import Link from 'next/link';

import { SearchBar } from '@/src/components/SearchBar';
import { AppHeader, Button } from '@/src/components/ui';
import {
  SidebarFilter,
  type CompareGroup,
  type SidebarFilterCommand,
  type SidebarFilterState,
} from '@/src/components/SidebarFilter';
import {
  MAP_DISTRICTS,
  MAP_LEEDS,
  MAP_SUBMARKETS,
  MAP_SUBMARKETS_SECONDARY,
  MAP_SUBWAYS,
  SUPPLY_CALENDAR_CATEGORIES,
  SUPPLY_CALENDAR_LABELS,
  type ActiveFilterChip,
  type MapStatsState,
  type RenderMode,
  type SupplyCalendarBucket,
  type SupplyCalendarCategory,
} from '../model/mapDomain';

const ProposalDraftBasket = dynamic(() => import('@/src/components/intelligence/ProposalDraftBasket'), { ssr: false });

const FloatingBuildingList = dynamic(() => import('./FloatingBuildingList'), {
  ssr: false,
  loading: () => (
    <div className="absolute bottom-5 right-5 z-[360] flex h-9 w-9 items-center justify-center rounded-[var(--cd-radius-md)] border border-[var(--cd-color-border)] bg-[var(--cd-color-surface)] shadow-[var(--cd-shadow-sm)]">
      <div className="h-4 w-4 animate-spin rounded-full border-2 border-[var(--cd-color-brand)] border-t-transparent" />
    </div>
  ),
});

type DisplayOverride = {
  display_label: string;
  display_value: string;
};

type MapWorkbenchViewProps = {
  stats: MapStatsState;
  futureSupplyCalendar: Record<SupplyCalendarCategory, SupplyCalendarBucket>;
  futureSuppliesCount: number;
  activeFilterChips: ActiveFilterChip[];
  keyword: string;
  filterState: SidebarFilterState | null;
  renderMode: RenderMode;
  compareGroups: CompareGroup[];
  isFilterPanelOpen: boolean;
  isSupplyOpen: boolean;
  isListVisible: boolean;
  canOpenList: boolean;
  currentSubwayStations: any[];
  filterCommand: SidebarFilterCommand | null;
  mapReady: boolean;
  mapError: string | null;
  mapDataLoading: boolean;
  hasBuildings: boolean;
  isExporting: boolean;
  combinedBuildingList: any[];
  displayOverrides: Map<string, Map<string, DisplayOverride>>;
  targetBuildingId: string | null;
  intelligenceContext?: {
    candidateCount: number | null;
    appliedCapabilities: string[];
  } | null;
  onFilterPanelOpenChange: (open: boolean) => void;
  onSupplyOpenChange: (open: boolean) => void;
  onFilterChange: (state: SidebarFilterState) => void;
  onCompareGroupsChange: (groups: CompareGroup[]) => void;
  onKeywordChange: (value: string) => void;
  onSearch: (value: string) => void | Promise<void>;
  onRemoveFilterChip: (patch: Partial<SidebarFilterState>) => void;
  onResetFilters: () => void;
  onRenderModeChange: (mode: RenderMode) => void;
  onOpenList: () => void;
  onCloseList: () => void;
  onRetryMap: () => void;
  onExportMapData: () => void | Promise<void>;
  onBuildingClick: (building: any) => void;
  onBuildingHover: (buildingId: string | null) => void;
};

const MODE_OPTIONS: Array<{ mode: RenderMode; label: string }> = [
  { mode: 'default', label: '项目' },
  { mode: 'rent', label: '租金' },
  { mode: 'vacancy', label: '空置' },
  { mode: 'leed', label: 'LEED' },
];

function IconButton({
  label,
  active = false,
  onClick,
  children,
}: {
  label: string;
  active?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={active}
      onClick={onClick}
      className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-[var(--cd-radius-md)] border text-sm transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--cd-color-brand)] ${
        active
          ? 'border-[var(--cd-color-brand)] bg-[var(--cd-color-brand)] text-white'
          : 'border-[var(--cd-color-border)] bg-[var(--cd-color-surface)] text-[var(--cd-color-text-secondary)] hover:border-[var(--cd-color-border-strong)] hover:text-[var(--cd-color-brand)]'
      }`}
    >
      {children}
    </button>
  );
}

type LegendItem = {
  label: string;
  className?: string;
  style?: React.CSSProperties;
};

function MapLegend({ mode, compareGroups }: { mode: RenderMode; compareGroups: CompareGroup[] }) {
  const metricConfig: Record<RenderMode, { title: string; items: LegendItem[] }> = {
    default: {
      title: '项目类型',
      items: [
        { label: '甲级写字楼', className: 'bg-[#245b78]' },
        { label: '乙级写字楼', className: 'bg-[#4f7968]' },
        { label: '产业园', className: 'bg-[#9b6948]' },
        { label: '未来供应', className: 'border border-slate-500 bg-white' },
      ],
    },
    rent: {
      title: '净有效租金（元/㎡/月）',
      items: [
        { label: '<100', className: 'bg-[#4f7968]' },
        { label: '100–199', className: 'bg-[#967a43]' },
        { label: '200–299', className: 'bg-[#a56142]' },
        { label: '≥300', className: 'bg-[#97515a]' },
      ],
    },
    vacancy: {
      title: '空置率',
      items: [
        { label: '<10%', className: 'bg-[#4f7968]' },
        { label: '10–19%', className: 'bg-[#967a43]' },
        { label: '20–29%', className: 'bg-[#a56142]' },
        { label: '≥30%', className: 'bg-[#97515a]' },
      ],
    },
    leed: {
      title: 'LEED 认证',
      items: [
        { label: '未认证', className: 'border border-[#bdc6ce] bg-[#eef1f4]' },
        { label: '白银', className: 'border border-[#9ca8b3] bg-[#e7ebef]' },
        { label: '黄金', className: 'border border-[#b69a52] bg-[#eadfbd]' },
        { label: '铂金', className: 'border border-[#68aebf] bg-[#d9edf3]' },
      ],
    },
  };

  const config: { title: string; items: LegendItem[] } = mode === 'default' && compareGroups.length > 0
    ? {
        title: '项目对比组',
        items: compareGroups.map(group => ({
          label: group.name,
          style: { backgroundColor: group.color },
        })),
      }
    : metricConfig[mode];

  return (
    <div className="pointer-events-none absolute bottom-[76px] left-4 z-[250] hidden rounded-[var(--cd-radius-md)] border border-[var(--cd-color-border)] bg-[var(--cd-color-surface)] px-3 py-2.5 shadow-[var(--cd-shadow-sm)] sm:block">
      <div className="mb-2 text-[10px] font-medium text-[var(--cd-color-text-muted)]">{config.title}</div>
      <div className="flex items-center gap-3">
        {config.items.map(item => (
          <div key={item.label} className="flex items-center gap-1.5 text-[10px] text-slate-500">
            <span className={`h-2.5 w-2.5 rounded-full ${item.className ?? ''}`} style={item.style} aria-hidden="true" />
            {item.label}
          </div>
        ))}
      </div>
    </div>
  );
}

function MetricStrip({ stats }: { stats: MapStatsState }) {
  const metrics = [
    { label: '净有效租金', value: stats.avgRent, unit: '元/㎡/月' },
    { label: '空置率', value: stats.overallVacancyPct, unit: '%' },
    { label: '视野项目', value: stats.visibleProjectCount, unit: '个' },
    { label: '总体量', value: stats.totalArea, unit: '㎡' },
  ];

  return (
    <div className="absolute bottom-3 left-3 right-3 z-[260] flex max-w-[calc(100vw-24px)] items-stretch overflow-x-auto rounded-[6px] border border-[#d9e0e8] bg-white shadow-[0_2px_8px_rgba(23,32,51,0.10)] sm:bottom-4 sm:left-4 sm:right-auto sm:max-w-max">
      {metrics.map((metric, index) => (
        <div key={metric.label} className={`min-w-[112px] px-3 py-2 sm:min-w-[128px] sm:px-4 sm:py-2.5 ${index > 0 ? 'border-l border-slate-200/80' : ''}`}>
          <div className="text-[10px] font-medium text-slate-400">{metric.label}</div>
          <div className="mt-0.5 flex items-baseline gap-1 whitespace-nowrap">
            <span className="text-[15px] font-semibold tabular-nums text-slate-900">{metric.value}</span>
            <span className="text-[10px] text-slate-400">{metric.unit}</span>
          </div>
        </div>
      ))}
    </div>
  );
}

function SupplyPanel({
  calendar,
  total,
  onClose,
}: {
  calendar: Record<SupplyCalendarCategory, SupplyCalendarBucket>;
  total: number;
  onClose: () => void;
}) {
  return (
    <div className="absolute bottom-3 left-3 right-3 top-[64px] z-[380] flex flex-col overflow-hidden rounded-[8px] border border-[#d9e0e8] bg-white shadow-[0_4px_14px_rgba(23,32,51,0.10)] sm:bottom-4 sm:left-auto sm:right-4 sm:top-[64px] sm:w-[430px]">
      <div className="flex items-center justify-between border-b border-slate-200/80 px-4 py-3.5">
        <div>
          <div className="text-sm font-semibold text-slate-900">未来供应</div>
          <div className="mt-0.5 text-[10px] text-slate-400">共 {total} 个项目</div>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 transition hover:bg-slate-100 hover:text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#003e7e]/20"
          aria-label="关闭未来供应"
        >
          <svg aria-hidden="true" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6 6 18M6 6l12 12" /></svg>
        </button>
      </div>
      <div className="grid min-h-0 flex-1 grid-cols-1 content-start gap-2 overflow-y-auto p-3 sm:grid-cols-2">
        {SUPPLY_CALENDAR_CATEGORIES.map(category => {
          const data = calendar[category];
          return (
            <div key={category} className="rounded-[var(--cd-radius-md)] border border-slate-200/80 bg-slate-50/80 p-3">
              <div className="flex items-center justify-between gap-3">
                <div className="text-[11px] font-medium text-slate-500">{SUPPLY_CALENDAR_LABELS[category]}</div>
                <div className="text-lg font-semibold tabular-nums text-[#003e7e]">{data.total}</div>
              </div>
              <div className="mt-2 flex items-center gap-3 border-t border-slate-200/70 pt-2 text-[10px] text-slate-400">
                <span>办公 {data.office}</span>
                <span>园区 {data.park}</span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function MapWorkbenchView({
  stats,
  futureSupplyCalendar,
  futureSuppliesCount,
  activeFilterChips,
  keyword,
  filterState,
  renderMode,
  compareGroups,
  isFilterPanelOpen,
  isSupplyOpen,
  isListVisible,
  canOpenList,
  currentSubwayStations,
  filterCommand,
  mapReady,
  mapError,
  mapDataLoading,
  hasBuildings,
  isExporting,
  combinedBuildingList,
  displayOverrides,
  targetBuildingId,
  intelligenceContext = null,
  onFilterPanelOpenChange,
  onSupplyOpenChange,
  onFilterChange,
  onCompareGroupsChange,
  onKeywordChange,
  onSearch,
  onRemoveFilterChip,
  onResetFilters,
  onRenderModeChange,
  onOpenList,
  onCloseList,
  onRetryMap,
  onExportMapData,
  onBuildingClick,
  onBuildingHover,
}: MapWorkbenchViewProps) {
  const hasActiveFilters = activeFilterChips.length > 0 || Boolean(keyword) || compareGroups.length > 0;
  const showFilterSummary = hasActiveFilters || Boolean(intelligenceContext);

  const closeOpenWorkspaces = React.useCallback(() => {
    if (isFilterPanelOpen) onFilterPanelOpenChange(false);
    if (isSupplyOpen) onSupplyOpenChange(false);
    if (isListVisible) onCloseList();
  }, [isFilterPanelOpen, isSupplyOpen, isListVisible, onFilterPanelOpenChange, onSupplyOpenChange, onCloseList]);

  React.useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return;
      if (event.target instanceof Element && event.target.closest('[role="dialog"][aria-modal="true"]')) return;
      closeOpenWorkspaces();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [closeOpenWorkspaces]);

  const toggleFilterPanel = () => {
    const nextOpen = !isFilterPanelOpen;
    if (nextOpen && isSupplyOpen) onSupplyOpenChange(false);
    if (nextOpen && isListVisible) onCloseList();
    onFilterPanelOpenChange(nextOpen);
  };

  const toggleSupplyPanel = () => {
    const nextOpen = !isSupplyOpen;
    if (nextOpen && isFilterPanelOpen) onFilterPanelOpenChange(false);
    if (nextOpen && isListVisible) onCloseList();
    onSupplyOpenChange(nextOpen);
  };

  const openBuildingList = () => {
    if (isFilterPanelOpen) onFilterPanelOpenChange(false);
    if (isSupplyOpen) onSupplyOpenChange(false);
    onOpenList();
  };

  return (
    <div className="flex h-screen h-[100dvh] flex-col overflow-hidden bg-[var(--cd-color-workspace)] text-[var(--cd-color-text-primary)]">
      <header className="relative z-[500] shrink-0 border-b border-[var(--cd-color-border)] bg-[var(--cd-color-surface)]">
        <AppHeader
          title="北京办公楼市场地图"
          homeHref="/"
          actions={process.env.NODE_ENV === 'development' ? (
            <Button
              variant="secondary"
              size="sm"
              onClick={() => { void onExportMapData(); }}
              disabled={isExporting || !mapReady}
              className="hidden md:inline-flex"
            >
              {isExporting ? '导出中…' : '导出地图数据'}
            </Button>
          ) : null}
        />
      </header>

      <main className="relative min-h-0 flex-1 overflow-hidden">
        <div id="map-container" className="absolute inset-0 bg-[#f3f6f8]" onPointerDownCapture={closeOpenWorkspaces} />

        <div className="pointer-events-none absolute inset-x-3 top-3 z-[330] flex items-start gap-2 sm:inset-x-4">
          <div className="pointer-events-auto flex shrink-0 gap-2">
            <IconButton label="筛选" active={isFilterPanelOpen} onClick={toggleFilterPanel}>
              <svg aria-hidden="true" viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="1.9"><path d="M4 6h16M7 12h10M10 18h4" /></svg>
            </IconButton>
          </div>

          <div className="pointer-events-auto min-w-0 flex-1 sm:max-w-[760px]">
            {showFilterSummary ? (
              <div className="flex min-h-9 items-center gap-2 overflow-x-auto rounded-[var(--cd-radius-md)] border border-[var(--cd-color-border)] bg-[var(--cd-color-surface)] px-2.5 py-1 shadow-[var(--cd-shadow-sm)]" aria-label="已生效筛选条件">
                {intelligenceContext ? (
                  <>
                    <span className="shrink-0 text-[10px] font-semibold text-[var(--cd-color-brand)]">
                      客户需求 · {intelligenceContext?.candidateCount === null ? '匹配中' : `${intelligenceContext.candidateCount} 个候选`}
                    </span>
                    <Link href="/intelligence" className="shrink-0 text-[10px] text-slate-400 transition hover:text-[var(--cd-color-brand)]">返回需求</Link>
                  </>
                ) : (
                  <span className="shrink-0 text-[10px] font-medium text-slate-400">筛选</span>
                )}
                {keyword ? (
                  <button
                    type="button"
                    onClick={() => { void onSearch(''); }}
                    className="group flex max-w-[220px] shrink-0 items-center gap-1 rounded-[var(--cd-radius-sm)] border border-[color:rgb(0_62_126_/_0.15)] bg-[var(--cd-color-brand-soft)] px-2 py-1 text-[10px] text-[var(--cd-color-brand)] transition-colors hover:border-[var(--cd-color-brand)]"
                    title={`清除搜索：${keyword}`}
                  >
                    <span className="truncate">搜索：{keyword}</span>
                    <span aria-hidden="true">×</span>
                  </button>
                ) : null}
                {activeFilterChips.map(chip => (
                  <button
                    key={chip.id}
                    type="button"
                    onClick={() => onRemoveFilterChip(chip.patch)}
                    className="group flex max-w-[230px] shrink-0 items-center gap-1 rounded-[var(--cd-radius-sm)] border border-[var(--cd-color-border)] bg-[var(--cd-color-surface-alt)] px-2 py-1 text-[10px] text-[var(--cd-color-text-secondary)] transition-colors hover:border-[var(--cd-color-border-strong)] hover:bg-white hover:text-[var(--cd-color-brand)]"
                    title={`移除条件：${chip.label}`}
                  >
                    <span className="truncate">{chip.label}</span>
                    <span aria-hidden="true">×</span>
                  </button>
                ))}
                {compareGroups.length > 0 ? (
                  <span className="flex max-w-[230px] shrink-0 items-center gap-1.5 rounded-[var(--cd-radius-sm)] border border-[var(--cd-color-border)] bg-[var(--cd-color-surface-alt)] px-2 py-1 text-[10px] text-[var(--cd-color-text-secondary)]">
                    <span className="flex -space-x-1">
                      {compareGroups.map(group => <span key={group.id} className="h-2.5 w-2.5 rounded-full border border-white" style={{ backgroundColor: group.color }} />)}
                    </span>
                    <span>项目对比组 {compareGroups.length}</span>
                  </span>
                ) : null}
                {hasActiveFilters ? (
                  <button type="button" onClick={onResetFilters} className="shrink-0 px-1.5 text-[10px] font-medium text-slate-400 transition hover:text-[#003e7e]">清空</button>
                ) : null}
              </div>
            ) : (
              <div className="rounded-[6px] border border-[#d9e0e8] bg-white shadow-[0_2px_8px_rgba(23,32,51,0.10)]">
                <SearchBar placeholder="搜索楼宇、子市场、业主…" debounceMs={220} value={keyword} onChange={onKeywordChange} onSearch={onSearch} />
              </div>
            )}
          </div>

          <div className="pointer-events-auto hidden shrink-0 overflow-hidden rounded-[6px] border border-[#d9e0e8] bg-white shadow-[0_2px_8px_rgba(23,32,51,0.10)] sm:flex" role="group" aria-label="地图显示模式">
            {MODE_OPTIONS.map(({ mode, label }, index) => (
              <button
                key={mode}
                type="button"
                aria-pressed={renderMode === mode}
                onClick={() => onRenderModeChange(mode)}
                className={`h-9 px-3 text-[10px] font-medium transition-colors focus-visible:z-10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[var(--cd-color-brand)] ${index > 0 ? 'border-l border-slate-200/80' : ''} ${renderMode === mode ? 'bg-[var(--cd-color-brand)] text-white' : 'text-slate-500 hover:bg-slate-50 hover:text-slate-800'}`}
              >
                {label}
              </button>
            ))}
          </div>

          <div className="pointer-events-auto flex shrink-0 gap-2">
            <IconButton label="未来供应" active={isSupplyOpen} onClick={toggleSupplyPanel}>
              <svg aria-hidden="true" viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="1.9"><rect x="3" y="4" width="18" height="17" rx="2" /><path d="M16 2v4M8 2v4M3 10h18" /></svg>
            </IconButton>
            <button
              type="button"
              onClick={openBuildingList}
              disabled={!canOpenList}
              className="flex h-9 shrink-0 items-center gap-1.5 rounded-[var(--cd-radius-md)] border border-[var(--cd-color-border)] bg-[var(--cd-color-surface)] px-3 text-[10px] font-medium text-[var(--cd-color-text-secondary)] shadow-[var(--cd-shadow-sm)] transition-colors hover:border-[var(--cd-color-border-strong)] hover:text-[var(--cd-color-brand)] disabled:cursor-not-allowed disabled:opacity-45"
              title={!canOpenList ? '完成筛选或搜索后查看项目列表' : '查看项目列表'}
            >
              <svg aria-hidden="true" viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.9"><path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01" /></svg>
              <span className="hidden lg:inline">项目列表</span>
            </button>
          </div>
        </div>

        <div className="pointer-events-auto absolute bottom-[80px] right-3 z-[265] flex overflow-hidden rounded-[6px] border border-[#d9e0e8] bg-white shadow-[0_2px_8px_rgba(23,32,51,0.10)] sm:hidden" role="group" aria-label="移动端地图显示模式">
          {MODE_OPTIONS.map(({ mode, label }, index) => (
            <button
              key={mode}
              type="button"
              aria-pressed={renderMode === mode}
              onClick={() => onRenderModeChange(mode)}
              className={`h-9 px-2.5 text-[10px] font-medium transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[var(--cd-color-brand)] ${index > 0 ? 'border-l border-slate-200/80' : ''} ${renderMode === mode ? 'bg-[var(--cd-color-brand)] text-white' : 'text-slate-500 hover:bg-slate-50'}`}
            >
              {label}
            </button>
          ))}
        </div>

        <div
          aria-hidden={!isFilterPanelOpen}
          className={isFilterPanelOpen
            ? 'absolute bottom-3 left-3 right-3 top-[64px] z-[380] flex flex-col overflow-hidden rounded-[8px] border border-[#d9e0e8] bg-white shadow-[0_4px_14px_rgba(23,32,51,0.10)] sm:bottom-4 sm:left-4 sm:right-auto sm:top-[64px] sm:w-[336px]'
            : 'hidden'}
        >
          <div className="flex items-center justify-between border-b border-slate-200/80 px-4 py-3">
            <div className="text-sm font-semibold text-slate-900">市场筛选</div>
            <button
              type="button"
              onClick={() => onFilterPanelOpenChange(false)}
              className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 transition hover:bg-slate-100 hover:text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#003e7e]/20"
              aria-label="关闭筛选"
            >
              <svg aria-hidden="true" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6 6 18M6 6l12 12" /></svg>
            </button>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto p-3">
            <SidebarFilter
              embedded
              defaultExpanded
              title="全局筛选"
              districts={MAP_DISTRICTS}
              submarkets={MAP_SUBMARKETS}
              submarketsSecondary={MAP_SUBMARKETS_SECONDARY}
              leeds={MAP_LEEDS}
              subwayLines={MAP_SUBWAYS}
              availableStations={currentSubwayStations}
              initialState={filterState ?? undefined}
              onFilterChange={onFilterChange}
              onCompareGroupsChange={onCompareGroupsChange}
              filterCommand={filterCommand}
            />
          </div>
        </div>

        {isSupplyOpen ? (
          <SupplyPanel
            calendar={futureSupplyCalendar}
            total={futureSuppliesCount}
            onClose={() => onSupplyOpenChange(false)}
          />
        ) : null}

        {mapError ? (
          <div className="absolute inset-0 z-[240] flex items-center justify-center bg-slate-50/80 p-4">
            <div className="w-full max-w-[460px] rounded-[var(--cd-radius-lg)] border border-[color:rgb(201_54_43_/_0.15)] bg-[var(--cd-color-surface)] p-5 shadow-[var(--cd-shadow-panel)]">
              <div className="text-sm font-semibold text-[var(--cd-color-danger)]">地图加载失败</div>
              <div className="mt-2 break-all text-xs leading-relaxed text-[var(--cd-color-text-secondary)]">{mapError}</div>
              <Button type="button" variant="danger" size="sm" onClick={onRetryMap} className="mt-4">重新加载</Button>
            </div>
          </div>
        ) : null}

        {!mapReady && !mapError ? (
          <div className="absolute inset-0 z-[230] flex items-center justify-center bg-[#eef3f7]">
            <div className="flex items-center gap-2 text-[11px] font-medium text-slate-500">
              <div className="h-5 w-5 animate-spin rounded-full border-2 border-[var(--cd-color-brand)] border-t-transparent" />
              正在启动地图工作台…
            </div>
          </div>
        ) : null}

        {mapReady && mapDataLoading && !hasBuildings && !mapError ? (
          <div className="absolute inset-0 z-[225] flex items-center justify-center bg-white/70">
            <div className="flex items-center gap-2 text-[10px] text-slate-500">
              <div className="h-4 w-4 animate-spin rounded-full border-2 border-[var(--cd-color-brand)] border-t-transparent" />
              正在读取楼宇数据…
            </div>
          </div>
        ) : null}

        {mapReady && !mapError ? <MapLegend mode={renderMode} compareGroups={compareGroups} /> : null}
        {mapReady && !mapError ? <MetricStrip stats={stats} /> : null}

        {intelligenceContext && mapReady && !mapError && !isFilterPanelOpen && !isSupplyOpen && !isListVisible ? <ProposalDraftBasket /> : null}

        {isListVisible ? (
          <div className="pointer-events-none absolute inset-0 z-[355]">
            <div className="pointer-events-auto absolute bottom-0 right-3 top-[52px] w-[340px] max-w-[90vw] sm:right-4">
              <FloatingBuildingList
                buildings={combinedBuildingList}
                displayOverrides={displayOverrides}
                onClose={onCloseList}
                onBuildingClick={onBuildingClick}
                targetBuildingId={targetBuildingId}
                onBuildingHover={onBuildingHover}
              />
            </div>
          </div>
        ) : null}
      </main>
    </div>
  );
}
