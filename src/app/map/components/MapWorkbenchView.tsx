'use client';

import { BrokerSearchLink } from '@/src/components/BrokerSearchLink';
import * as React from 'react';
import dynamic from 'next/dynamic';
import Link from 'next/link';

import { SearchBar } from '@/src/components/SearchBar';
import { Button } from '@/src/components/ui';
import { Tooltip } from '@/src/components/ui/Tooltip';
import { MaskedText } from '@/src/components/demo';
import { futureSupplyDate, isPendingFutureSupply } from '@/src/lib/future-supply-status';
import { getImpersonationTargetUserId } from '@/src/services/impersonationHeaders';
import type { WorkspaceView } from '../workspace/workspaceState';
import { MapWorkspaceLayout } from './MapWorkspaceLayout';
import { WorkspacePanelHeader } from './WorkspacePanelHeader';
import { MapDisclosure } from './MapDisclosure';
import { futureSupplyImage } from '../runtime/mapSelectionMarker';
import { animateWorkspace, WORKSPACE_MOTION } from '../runtime/workspaceMotion';
import { MapReadingContext, useMapReadingState, useMapReadingScroll } from '../workspace/continuity';
import { contentPanelWidth, type PanelWidths, type WorkspaceKind } from '../workspace/workspaceState';
import { Maximize2, Minimize2, Info, MoreHorizontal, Home, List, ListFilter, CalendarDays } from 'lucide-react';
import { FullBuildingList } from './FullBuildingList';
import { type FullListBuilding } from '../model/fullBuildingList';
import { describeMapSearchMatch, rankMapSearchCandidates } from '../model/mapSearchCandidates';
import {
  SidebarFilter,
  type CompareGroup,
  type SidebarFilterCommand,
  type SidebarFilterState,
} from '@/src/components/SidebarFilter';
import {
  categorizeSupply,
  MAP_DISTRICTS,
  MAP_LEEDS,
  MAP_SUBMARKETS,
  MAP_SUBMARKETS_SECONDARY,
  MAP_SUBWAYS,
  SUPPLY_CALENDAR_CATEGORIES,
  SUPPLY_CALENDAR_LABELS,
  isCommercialFutureSupply,
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
  dataNotice?: string | null; onRetryNotice?: () => void | Promise<void>;
  queryPanel?: React.ReactNode;
  submarketDetailPanel?: React.ReactNode;
  buildingDetailPanel?: React.ReactNode;
  rightView?: WorkspaceView | null;
  rightKind?: string | null;
  rightWidth?: number;
  rightWidths?: PanelWidths;
  focusMode?: boolean;
  backLabel?: string | null;
  onWorkspaceBack?: () => void;
  onWorkspaceClose?: () => void;
  onWorkspaceWidth?: (width: number, kind?: WorkspaceKind) => void;
  onFocusModeChange?: () => void;
  stats: MapStatsState;
  restoredComparisonBuildings?: FullListBuilding[];
  comparisonIdentityKey?: string;
  futureSupplyCalendar: Record<SupplyCalendarCategory, SupplyCalendarBucket>;
  futureSuppliesCount: number;
  futureSupplyLoading?: 'initial' | 'updating' | null;
  futureSupplies: FullListBuilding[];
  activeFilterChips: ActiveFilterChip[];
  keyword: string;
  filterState: SidebarFilterState | null;
  renderMode: RenderMode;
  baseMapPointsVisible?: boolean;
  onBaseMapPointsChange?: (visible: boolean) => void;
  compareGroups: CompareGroup[];
  filterCompareGroups?: CompareGroup[];
  isFilterPanelOpen: boolean;
  isSupplyOpen: boolean;
  isListVisible: boolean;
  canOpenList: boolean;
  currentSubwayStations: any[];
  filterCommand: SidebarFilterCommand | null;
  mapReady: boolean;
  mapStage?: 'sdk' | 'tiles' | 'ready' | 'error';
  mapError: string | null;
  listError?: string | null;
  mapDataLoading: boolean;
  hasBuildings: boolean;
  isExporting: boolean;
  combinedBuildingList: any[];
  displayOverrides: Map<string, Map<string, DisplayOverride>>;
  targetBuildingId: string | null;
  targetBuildingType?: 'existing' | 'future';
  brokerContext?: { back?: string; unavailable: boolean; filtered?: boolean } | null;
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
  onSearchSubmit?: (value: string) => void;
  onRemoveFilterChip: (patch: Partial<SidebarFilterState>) => void;
  onResetFilters: () => void;
  onRenderModeChange: (mode: RenderMode) => void;
  onOpenList: () => void;
  onCloseList: () => void;
  onRetryMap: () => void;
  onExportMapData: () => void | Promise<void>;
  onBuildingClick: (building: any) => void;
  onSearchBuildingClick?: (building: FullListBuilding) => void;
  onBuildingHover: (buildingId: string | null, type?: 'existing' | 'future') => void;
  searchContextKey?: string;
  isFullListVisible?: boolean;
  hasVisitedFullList?: boolean;
  fullBuildingList?: FullListBuilding[];
  fullListQueryKey?: string;
  fullListBusy?: boolean;
  fullListWarning?: string | null;
  competitorContext?: boolean;
  onFullListSearch?: (value: string) => void | Promise<void>;
  onOpenFullList?: () => void;
  onCloseFullList?: () => void;
  onFullListBuildingClick?: (building: FullListBuilding) => void;
};

const MODE_OPTIONS: Array<{ mode: RenderMode; label: string }> = [
  { mode: 'default', label: '项目' },
  { mode: 'rent', label: '租金' },
  { mode: 'vacancy', label: '空置' },
  { mode: 'leed', label: 'LEED' },
];

function IconButton({
  label,
  text,
  active = false,
  onClick,
  children,
}: {
  label: string;
  text?: string;
  active?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <Tooltip content={label}><button
      type="button"
      aria-label={label}
      aria-pressed={active}
      onClick={onClick}
      className={`flex h-9 ${text ? 'w-auto gap-1.5 px-2' : 'w-9'} shrink-0 items-center justify-center rounded-[var(--cd-radius-md)] border text-sm transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--cd-color-brand)] ${
        active
          ? 'border-[var(--cd-color-brand)] bg-[var(--cd-color-brand)] text-white'
          : 'border-[var(--cd-color-border)] bg-[var(--cd-color-surface)] text-[var(--cd-color-text-secondary)] hover:border-[var(--cd-color-border-strong)] hover:text-[var(--cd-color-brand)]'
      }`}
    >
      {children}
      {text ? <span aria-hidden="true">{text}</span> : null}
    </button></Tooltip>
  );
}

type LegendItem = {
  label: string;
  className?: string;
  style?: React.CSSProperties;
};

function MapLegend({ mode, compareGroups, active, futureVisible, pointsVisible, onPointsChange, mapReady }: { mode: RenderMode; compareGroups: CompareGroup[]; active: boolean; futureVisible: boolean; pointsVisible: boolean; onPointsChange?: (visible: boolean) => void; mapReady: boolean }) {
  const [aggregate, setAggregate] = React.useState(false);
  React.useEffect(() => {
    if (!active) return;
    const container = document.getElementById('map-container');
    if (!container) return;
    const update = () => setAggregate(container.dataset.markerTier === 'submarket');
    update();
    const observer = new MutationObserver(update);
    observer.observe(container, { attributes: true, attributeFilter: ['data-marker-tier'] });
    return () => observer.disconnect();
  }, [active]);
  const metricConfig: Record<RenderMode, { title: string; items: LegendItem[] }> = {
    default: {
      title: '项目类型',
      items: [
        { label: '甲级写字楼', className: 'bg-[#245b78]' },
        { label: '乙级写字楼', className: 'bg-[#4f7968]' },
        { label: '产业园', className: 'bg-[#9b6948]' },
        { label: '其他 / 未提供', className: 'bg-[#8794a4]' },
      ],
    },
    rent: {
      title: '净有效租金（元/㎡/月）',
      items: [
        { label: '<100', className: 'bg-[#4f7968]' },
        { label: '100–<200', className: 'bg-[#967a43]' },
        { label: '200–<300', className: 'bg-[#a56142]' },
        { label: '≥300', className: 'bg-[#97515a]' },
        { label: '未提供', className: 'bg-[#8794a4]' },
      ],
    },
    vacancy: {
      title: '空置率',
      items: [
        { label: '<10%', className: 'bg-[#4f7968]' },
        { label: '10–<20%', className: 'bg-[#967a43]' },
        { label: '20–<30%', className: 'bg-[#a56142]' },
        { label: '≥30%', className: 'bg-[#97515a]' },
        { label: '未提供', className: 'bg-[#8794a4]' },
      ],
    },
    leed: {
      title: 'LEED 认证',
      items: [
        { label: '未认证（N）', className: 'border border-[#bdc6ce] bg-[#eef1f4]' },
        { label: '未提供（–）', className: 'border border-[#bdc6ce] bg-[#eef1f4]' },
        { label: '白银', className: 'border border-[#9ca8b3] bg-[#e7ebef]' },
        { label: '黄金', className: 'border border-[#b69a52] bg-[#eadfbd]' },
        { label: '铂金', className: 'border border-[#68aebf] bg-[#d9edf3]' },
      ],
    },
  };

  const config: { title: string; items: LegendItem[] } = aggregate && mode === 'leed' ? {
    title: '子市场 LEED 认证率', items: [
      { label: '0%', className: 'bg-[#8794a4]' }, { label: '>0–<20%', className: 'bg-[#88a493]' },
      { label: '20–<40%', className: 'bg-[#6f927f]' }, { label: '40–<60%', className: 'bg-[#537f6c]' },
      { label: '≥60%', className: 'bg-[#3f715f]' },
    ],
  } : aggregate && mode === 'default' ? {
    title: '子市场', items: [{ label: '租金 · 空置率 · 甲乙级数量', className: 'bg-[#245b78]' }],
  } : mode === 'default' && compareGroups.length > 0
    ? {
        title: '项目对比组',
        items: compareGroups.map(group => ({
          label: group.name,
          style: { backgroundColor: group.color },
        })),
      }
    : metricConfig[mode];

  return (
    <MapDisclosure width={320} active={active} className="map-workspace-legend" label={<><Info size={16} aria-hidden="true" /><span className="map-legend-label">图例</span></>}>
      <h2>{config.title}</h2>
      <div className="flex items-center gap-3">
        {config.items.map(item => (
          <div key={item.label} className="flex items-center gap-1.5 text-[14px] text-slate-500">
            <span className={`map-legend-swatch rounded-full ${item.className ?? ''}`} style={item.style} aria-hidden="true" />
            {item.label}
          </div>
        ))}
      </div>
      <label className="map-legend-places">
        <input type="checkbox" checked={pointsVisible} disabled={!mapReady || !onPointsChange} onChange={event => onPointsChange?.(event.target.checked)} />
        底图地点标注
      </label>
      <div className="map-legend-states">
        <span><i className="map-legend-selected" aria-hidden="true" />当前项目</span>
        {futureVisible ? <><span><img src={futureSupplyImage({}, 'default')} width="24" height="24" alt="" />未来供应</span><span><img src={futureSupplyImage({ status: 'pending' }, 'default')} width="24" height="24" alt="" />待核实项目</span></> : null}
      </div>
    </MapDisclosure>
  );
}

function MetricStrip({ stats, busy }: { stats: MapStatsState; busy: boolean }) {
  const metrics = [
    { label: '筛选存量净有效租金', value: stats.avgRent, unit: '元/㎡/月' },
    { label: '筛选存量空置率', value: stats.overallVacancyPct, unit: '%' },
    { label: '有坐标项目', value: stats.visibleProjectCount, unit: '个' },
    { label: '筛选存量面积', value: stats.totalArea, unit: '㎡', showsUpdating: true },
  ];

  const [announcement, setAnnouncement] = React.useState('');
  const description = metrics.map(metric => `${metric.label} ${metric.value} ${metric.unit}`).join('，');
  React.useEffect(() => { if (busy) return; const timer = window.setTimeout(() => setAnnouncement(description), 400); return () => window.clearTimeout(timer); }, [busy, description]);
  return (
    <section className="map-live-stats" aria-label="市场实时指标" aria-busy={busy}>
      <dl className="map-workspace-kpis" aria-live="off">{metrics.map(metric => <MetricValue key={metric.label} metric={metric} updating={busy && Boolean(metric.showsUpdating)} />)}</dl><span className="sr-only" role="status" aria-live="polite">{announcement}</span>
    </section>
  );
}
function MetricValue({ metric, updating = false }: { updating?: boolean; metric: { label: string; value: string; unit: string } }) {
  const number = React.useRef<HTMLElement>(null);
  const previous = React.useRef(metric.value);
  React.useEffect(() => {
    if (previous.current === metric.value) return;
    previous.current = metric.value;
    const animation = animateWorkspace(number.current, [{ opacity: .7 }, { opacity: 1 }], WORKSPACE_MOTION.feedback);
    return () => animation?.cancel();
  }, [metric.value]);
  return <div><dt><span>{metric.label}</span>{updating ? <span className="map-stats-updating">更新中</span> : null}</dt><dd><b ref={number} className="map-metric-number">{metric.value}</b><span>{metric.unit}</span></dd></div>;
}

function SupplyProjectList({ projects, onSelect }: { projects: FullListBuilding[]; onSelect: (project: FullListBuilding) => void }) {
  return (
    <ul className="mt-1 divide-y divide-[var(--cd-color-border)]">
      {projects.map(project => (
        <li key={project.id} className="flex flex-wrap items-center justify-between gap-x-3 text-sm">
          <button type="button" onClick={() => onSelect(project)} className="min-h-11 rounded-sm text-left font-normal text-[var(--cd-color-brand)] hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--cd-color-brand)]">
            <MaskedText>{project.name || '未命名项目'}</MaskedText>
          </button>
          <span className="text-[var(--cd-color-text-secondary)]">{futureSupplyDate(project)}</span>
        </li>
      ))}
    </ul>
  );
}

function SupplyPanel({
  calendar,
  total,
  commercialProjects,
  officeProjects,
  pendingProjects,
  onSelect,
  onClose,
  active, warning, loading,
}: {
  active: boolean; warning?: string | null; loading?: 'initial' | 'updating' | null;
  calendar: Record<SupplyCalendarCategory, SupplyCalendarBucket>;
  total: number;
  commercialProjects: FullListBuilding[];
  officeProjects: FullListBuilding[];
  pendingProjects: FullListBuilding[];
  onSelect: (project: FullListBuilding) => void;
  onClose: () => void;
}) {
  const [expanded, setExpanded] = useMapReadingState<Record<string, boolean>>('supplyExpanded', {});
  const scroll = React.useRef<HTMLDivElement>(null);
  useMapReadingScroll(scroll, 'supplyScroll', active);
  const disclosure = (key: string, initial = false) => ({ open: expanded[key] ?? initial, onToggle: (event: React.SyntheticEvent<HTMLDetailsElement>) => { const open = event.currentTarget.open; if (open !== (expanded[key] ?? initial)) setExpanded(old => ({ ...old, [key]: open })); } });
  const projects = [...officeProjects, ...commercialProjects];
  const first = SUPPLY_CALENDAR_CATEGORIES.find(category => calendar[category].total > 0);
  const empty = SUPPLY_CALENDAR_CATEGORIES.filter(category => !calendar[category].total);
  return <section className="map-workspace-supply" aria-label="未来供应" aria-busy={Boolean(loading)}>
    <WorkspacePanelHeader title="未来供应" subtitle={loading && !total ? (loading === 'initial' ? '正在读取项目' : '正在更新项目') : `已纳入统计 ${total} 个项目`} onClose={onClose} closeLabel="关闭未来供应" />
    <div ref={scroll} className="workspace-scroll workspace-supply-scroll">
      {loading ? <p role="status" className="workspace-note">{loading === 'initial' ? '正在读取未来供应…' : '正在更新未来供应…'}</p> : null}
      {warning ? <p role="alert" className="workspace-note">{warning}</p> : null}
      {SUPPLY_CALENDAR_CATEGORIES.filter(category => calendar[category].total > 0).map(category => {
        const data = calendar[category];
        const rows = projects.filter(project => categorizeSupply(project) === category);
        const office = rows.filter(project => !isCommercialFutureSupply(project));
        const commercial = rows.filter(isCommercialFutureSupply);
        return <details key={category} {...disclosure(category, category === first)} className="workspace-supply-year">
          <summary><span>{SUPPLY_CALENDAR_LABELS[category]}</span><span>{data.total} 个项目</span></summary>
          <p className="workspace-note">办公 {data.office} · 园区 {data.park} · 商业 {data.commercial}</p>
          {office.length ? <details {...disclosure(`${category}:office`, true)} className="workspace-supply-type"><summary>办公与园区 · {office.length}</summary><SupplyProjectList projects={office} onSelect={onSelect} /></details> : null}
          {commercial.length ? <details {...disclosure(`${category}:commercial`, !office.length)} className="workspace-supply-type"><summary>商业项目 · {commercial.length}</summary><SupplyProjectList projects={commercial} onSelect={onSelect} /></details> : null}
        </details>;
      })}
      {!loading && !warning && !projects.length ? <p role="status" className="workspace-empty">当前筛选范围内暂无已确认供应，可调整筛选条件。</p> : null}
      {pendingProjects.length ? <details {...disclosure('pending')} className="workspace-supply-year"><summary>待核实项目（{pendingProjects.length}）</summary><SupplyProjectList projects={pendingProjects} onSelect={onSelect} /></details> : null}
      {!loading && empty.length ? <details {...disclosure('empty')} className="workspace-supply-year"><summary>查看无项目年份（{empty.length}）</summary>{empty.map(category => <p key={category} className="workspace-note">{SUPPLY_CALENDAR_LABELS[category]} · 暂无项目</p>)}</details> : null}
    </div>
  </section>;
}

export function MapWorkbenchView({
  dataNotice, onRetryNotice,
  queryPanel,
  submarketDetailPanel,
  buildingDetailPanel,
  rightView,
  rightKind,
  rightWidth = 320,
  rightWidths,
  focusMode = false,
  backLabel,
  onWorkspaceBack,
  onWorkspaceClose,
  onWorkspaceWidth,
  onFocusModeChange,
  stats,
  futureSupplyCalendar,
  futureSuppliesCount,
  futureSupplyLoading = null,
  futureSupplies,
  activeFilterChips,
  keyword,
  filterState,
  renderMode,
  baseMapPointsVisible = false, onBaseMapPointsChange,
  compareGroups,
  filterCompareGroups,
  isFilterPanelOpen,
  isSupplyOpen,
  isListVisible,
  currentSubwayStations,
  filterCommand,
  mapReady, mapStage, canOpenList,
  mapError, listError,
  mapDataLoading,
  hasBuildings,
  isExporting,
  combinedBuildingList,
  displayOverrides,
  targetBuildingId,
  targetBuildingType,
  brokerContext,
  intelligenceContext = null,
  onFilterPanelOpenChange,
  onSupplyOpenChange,
  onFilterChange,
  onCompareGroupsChange,
  onKeywordChange,
  onSearch,
  onSearchSubmit,
  onRemoveFilterChip,
  onResetFilters,
  onRenderModeChange,
  onOpenList,
  onCloseList,
  onRetryMap,
  onExportMapData,
  onBuildingClick,
  onSearchBuildingClick,
  onBuildingHover,
  searchContextKey,
  isFullListVisible = false,
  hasVisitedFullList = false,
  fullBuildingList = [],
  fullListQueryKey = '',
  fullListBusy = false,
  fullListWarning = null,
  competitorContext = false,
  onFullListSearch,
  onOpenFullList,
  onCloseFullList,
  onFullListBuildingClick,
  restoredComparisonBuildings = [],
  comparisonIdentityKey,
}: MapWorkbenchViewProps) {

  const reading = React.useContext(MapReadingContext);
  const [filterSections, setFilterSections] = useMapReadingState<Record<string, boolean>>('filterSections', {});
  const filterScroll = React.useRef<HTMLDivElement>(null);
  useMapReadingScroll(filterScroll, 'filterScroll', !isFullListVisible && isFilterPanelOpen);
  const [listMoreContext, setListMoreContext] = React.useState<{ key: string | undefined } | null>(null);
  const [searchChoicesOpen, setSearchChoicesOpen] = React.useState(false);
  // Explicit business navigation wins over an earlier search result view.
  React.useEffect(() => setSearchChoicesOpen(false), [rightView]);
  // Keep selections through filtering and sidebar closure, not across account or impersonation changes.
  const comparisonScope = JSON.stringify([comparisonIdentityKey ?? searchContextKey, getImpersonationTargetUserId()]);
  const [comparisonSelection, setComparisonSelection] = React.useState<{
    scope: string; items: Map<string, FullListBuilding>;
  }>({ scope: comparisonScope, items: new Map() });
  const restoredComparisonScopes = React.useRef(new Set<string>());
  React.useEffect(() => {
    if (!restoredComparisonBuildings.length || restoredComparisonScopes.current.has(comparisonScope)) return;
    restoredComparisonScopes.current.add(comparisonScope);
    setComparisonSelection({ scope: comparisonScope, items: new Map(restoredComparisonBuildings.map(building => [
      `${building._dataType === 'future' ? 'future' : 'existing'}:${building.id}`, building,
    ])) });
  }, [comparisonScope, restoredComparisonBuildings]);
  const selectedComparisonBuildings = comparisonSelection.scope === comparisonScope
    ? Array.from(comparisonSelection.items.values()) : [];
  const handleComparisonSelectionChange = React.useCallback((rows: FullListBuilding[], selected: boolean) => {
    setComparisonSelection(previous => {
      const next = new Map<string, FullListBuilding>(previous.scope === comparisonScope ? previous.items : []);
      for (const building of rows) {
        if (!building?.id) continue;
        const key = (building._dataType === 'future' ? 'future:' : 'existing:') + building.id;
        if (selected) next.set(key, building);
        else next.delete(key);
      }
      if (reading) reading.comparisonIds = Array.from(next.keys());
      return { scope: comparisonScope, items: next };
    });
  }, [comparisonScope, reading]);
  const searchInputWrapRef = React.useRef<HTMLDivElement>(null);
  const searchChoicesRef = React.useRef<HTMLDivElement>(null);
  const moreFiltersTriggerId = React.useId();
  const filtersPanelId = React.useId();
  const filterCloseRef = React.useRef<HTMLButtonElement>(null);
  const listMoreOpen = isFullListVisible && listMoreContext !== null && listMoreContext.key === searchContextKey;
  const filterPanelOpen = isFullListVisible ? listMoreOpen : isFilterPanelOpen;
  const closeListMore = React.useCallback(() => {
    setListMoreContext(null);
    document.getElementById(moreFiltersTriggerId)?.focus({ preventScroll: true });
  }, [moreFiltersTriggerId]);
  React.useEffect(() => {
    if (listMoreOpen) filterCloseRef.current?.focus({ preventScroll: true });
  }, [listMoreOpen]);

  const previouslyFullList = React.useRef(false);
  const mapWorkspaceRef = React.useRef<HTMLDivElement>(null);
  const removedFilterFocus = React.useRef<HTMLElement | null>(null);
  const removeFilterChip = (patch: Partial<SidebarFilterState>) => {
    removedFilterFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    onRemoveFilterChip(patch);
  };
  const resetFilters = () => {
    removedFilterFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    onResetFilters();
  };
  React.useLayoutEffect(() => {
    const previous = removedFilterFocus.current;
    removedFilterFocus.current = null;
    if (previous && !previous.isConnected && document.activeElement === document.body) {
      mapWorkspaceRef.current?.querySelector<HTMLButtonElement>('button[aria-label="筛选"]')?.focus({ preventScroll: true });
    }
  }, [activeFilterChips, keyword, compareGroups]);

  const viewportRef = React.useRef<HTMLDivElement>(null);
  React.useEffect(() => {
    const viewport = window.visualViewport;
    const update = () => {
      const height = viewport?.height ?? window.innerHeight;
      viewportRef.current?.style.setProperty('--map-viewport-height', `${height}px`);
      viewportRef.current?.toggleAttribute('data-short-viewport', height < 520);
    };
    update(); viewport?.addEventListener('resize', update); window.addEventListener('resize', update);
    return () => { viewport?.removeEventListener('resize', update); window.removeEventListener('resize', update); };
  }, []);
  React.useEffect(() => {
    if (!isFullListVisible && previouslyFullList.current) Array.from(mapWorkspaceRef.current?.querySelectorAll<HTMLElement>('[aria-label="完整列表"], .map-header-navigation-mobile summary') ?? []).find(el => el.getClientRects().length > 0)?.focus({ preventScroll: true });
    previouslyFullList.current = isFullListVisible;
  }, [isFullListVisible]);

  const searchTerm = keyword.trim();
  const searchChoices = React.useMemo(() => rankMapSearchCandidates(
    fullBuildingList,
    searchTerm,
  ), [fullBuildingList, searchTerm]);
  const hasNarrowedSearch = activeFilterChips.length > 0 || compareGroups.length > 0;
  const searchChoicesVisible = (searchChoicesOpen || rightKind === 'search') && Boolean(searchTerm) && !isFullListVisible
    && !competitorContext && mapReady && !mapError;
  const hasActiveFilters = activeFilterChips.length > 0 || Boolean(searchTerm) || compareGroups.length > 0;
  const showFilterSummary = hasActiveFilters || Boolean(intelligenceContext);

  React.useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return;
      if (document.querySelector('dialog[open], [aria-modal="true"], [data-map-related-leases], [data-building-metrics-edit], #__colliers_contact_modal_overlay')) return;
      if (searchChoicesVisible) {
        event.preventDefault();
        setSearchChoicesOpen(false);
        if (rightKind === 'search') onWorkspaceClose?.();
        if (event.target instanceof Element && event.target.closest('[aria-label="项目搜索候选"]')) {
          searchInputWrapRef.current?.querySelector<HTMLInputElement>('input[type="search"]')?.focus({ preventScroll: true });
        }
        return;
      }
      if (listMoreOpen) closeListMore();
      else if (isFilterPanelOpen && event.target instanceof Element && event.target.closest('.map-workspace-left')) onFilterPanelOpenChange(false);
      else if (rightKind || isListVisible || isSupplyOpen) { if (onWorkspaceClose) onWorkspaceClose(); else if (isListVisible) onCloseList(); else onSupplyOpenChange(false); }
      else if (isFilterPanelOpen) onFilterPanelOpenChange(false);
      event.preventDefault();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [closeListMore, listMoreOpen, searchChoicesVisible, rightKind, onWorkspaceClose, isFilterPanelOpen, onFilterPanelOpenChange, isListVisible, isSupplyOpen, onCloseList, onSupplyOpenChange]);

  const toggleFilterPanel = () => {
    setSearchChoicesOpen(false);
    const nextOpen = !isFilterPanelOpen;
    onFilterPanelOpenChange(nextOpen);
  };

  const toggleSupplyPanel = () => {
    setSearchChoicesOpen(false);
    const nextOpen = !isSupplyOpen;
    onSupplyOpenChange(nextOpen);
  };

  const openBuildingList = () => {
    setSearchChoicesOpen(false);
    onOpenList();
  };

  const filters = (
      <div className="map-workspace-filter-shell">
        <div
          id={filtersPanelId}
          data-map-focus-left
          aria-hidden={!filterPanelOpen}
          inert={!filterPanelOpen || undefined}
          className="map-workspace-filter"
        >
          <WorkspacePanelHeader title={isFullListVisible ? '更多筛选' : '市场筛选'} onClose={isFullListVisible ? closeListMore : () => onFilterPanelOpenChange(false)} closeLabel="关闭筛选" />
          <div ref={filterScroll} className="workspace-scroll min-h-0 flex-1 overflow-y-auto p-3">
            <SidebarFilter
              embedded
              defaultExpanded
              expandedSections={filterSections} onExpandedSectionsChange={setFilterSections}
              presentation={isFullListVisible ? 'list-more' : undefined}
              title="全局筛选"
              districts={MAP_DISTRICTS}
              submarkets={MAP_SUBMARKETS}
              submarketsSecondary={MAP_SUBMARKETS_SECONDARY}
              leeds={MAP_LEEDS}
              subwayLines={MAP_SUBWAYS}
              availableStations={currentSubwayStations}
              initialState={filterState ?? undefined}
              initialCompareGroups={filterCompareGroups ?? compareGroups}
              onFilterChange={onFilterChange}
              onCompareGroupsChange={onCompareGroupsChange}
              filterCommand={filterCommand}
            />
          </div>
        </div>

      </div>
  );
  const effectiveKind = rightKind ?? (isSupplyOpen ? 'supply' : isListVisible ? 'list' : submarketDetailPanel ? 'submarket' : null);
  const panelKind = (searchChoicesVisible ? 'search' : effectiveKind ?? 'list') as WorkspaceKind;
  const preferredWidth = rightWidths ? rightWidths[panelKind] ?? contentPanelWidth(panelKind, panelKind === 'search' ? searchChoices.matchedCount : panelKind === 'supply' ? futureSupplies.length : combinedBuildingList.length, rightView?.kind === 'building' ? rightView.building.name ?? '' : '') : rightWidth;
  const rightOpen = Boolean(effectiveKind || searchChoicesVisible);
  const [listVisited, setListVisited] = React.useState(false);
  if (!listVisited && (effectiveKind === 'list' || effectiveKind === 'compare')) setListVisited(true);
  const closeRight = onWorkspaceClose ?? (() => { onSupplyOpenChange(false); onCloseList(); });
  const rightContent = <>
              {searchChoicesVisible ? (
                <div ref={searchChoicesRef} role="region" aria-label="项目搜索候选"
                  className="map-workspace-search"
                  onKeyDown={event => {
                    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
                    const choices = Array.from(searchChoicesRef.current?.querySelectorAll<HTMLButtonElement>('[data-map-search-choice]') ?? []);
                    const index = choices.indexOf(event.target as HTMLButtonElement);
                    if (index < 0) return;
                    event.preventDefault();
                    if (event.key === 'ArrowUp' && index === 0) {
                      searchInputWrapRef.current?.querySelector<HTMLInputElement>('input[type="search"]')?.focus();
                    } else {
                      choices[Math.max(0, Math.min(choices.length - 1, index + (event.key === 'ArrowDown' ? 1 : -1)))]?.focus();
                    }
                  }}>
                  <WorkspacePanelHeader title={fullListBusy ? '正在匹配项目…' : `匹配项目 · ${searchChoices.total}`} subtitle={hasNarrowedSearch ? '当前筛选范围' : '全部已授权项目'}
                    onClose={() => { setSearchChoicesOpen(false); if (rightKind === 'search') onWorkspaceClose?.(); }} closeLabel="收起" />
                  <div className="workspace-scroll">
                  {fullListBusy ? (
                    <div role="status" className="px-3 py-4 text-[14px] text-[#64748b]">正在更新匹配结果…</div>
                  ) : searchChoices.items.length > 0 ? (
                    <ul className="divide-y divide-[#edf0f4]">
                      {searchChoices.items.map(building => (
                        <li key={`${building._dataType ?? 'existing'}:${building.id}`}>
                          <button type="button" data-map-search-choice
                            className="flex min-h-11 w-full flex-col items-start gap-1 px-3 py-2 text-left hover:bg-[#f3f7fb] focus-visible:bg-[#edf4fb] focus-visible:outline focus-visible:outline-2 focus-visible:outline-inset focus-visible:outline-[#003e7e]"
                            onClick={() => { setSearchChoicesOpen(false); (onSearchBuildingClick ?? onBuildingClick)(building); }}>
                            <span className="min-w-0 break-words text-[14px] font-semibold text-[#172033]">{building.name || '未命名项目'}</span>
                            <span className="min-w-0 break-words text-sm text-[#64748b]">
                              <span className="block">{building._dataType === 'future' ? '未来供应 · ' : ''}{building.submarket || building.district || '其他'}</span>
                              <span className="block text-[#596779]">匹配：{describeMapSearchMatch(building, searchTerm)}</span>
                            </span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <div role="status" className="px-3 py-4 text-[14px] text-[#64748b]">
                      {searchChoices.matchedCount > 0
                        ? `有 ${searchChoices.matchedCount} 个匹配项目，但缺少坐标，暂时无法在地图定位。`
                        : '当前筛选范围内没有匹配项目，可修改关键词或清空筛选条件。'}
                      <button type="button" className="workspace-action mt-3" onClick={() => {
                        setSearchChoicesOpen(false); onKeywordChange(''); void onSearch('');
                        searchInputWrapRef.current?.querySelector<HTMLInputElement>('input[type="search"]')?.focus();
                      }}>清空关键词</button>
                    </div>
                  )}
                  {!fullListBusy && searchChoices.missingCoordinates > 0 ? (
                    <div role="status" className="border-t border-[#e7ebf0] px-3 py-2 text-sm text-[#64748b]">
                      {searchChoices.missingCoordinates} 个项目未提供坐标，仍可打开详情。
                    </div>
                  ) : null}
                  {!fullListBusy && (searchChoices.matchedCount > searchChoices.items.length) ? (
                    <button type="button"
                      className="min-h-11 w-full border-t border-[#e7ebf0] px-3 text-left text-[14px] font-normal text-[#003e7e] hover:bg-[#f3f7fb]"
                      onClick={() => { setSearchChoicesOpen(false); onOpenFullList?.(); }}>
                      查看全部 {searchChoices.matchedCount} 个匹配项目
                    </button>
                  ) : null}
                  </div>
                </div>
              ) : null}
<div hidden={searchChoicesVisible} data-workspace-kind={effectiveKind} className={searchChoicesVisible ? 'hidden' : 'map-workspace-view'}>
    <div hidden={effectiveKind !== 'submarket'} className={effectiveKind === 'submarket' ? 'map-workspace-view' : 'hidden'}>{submarketDetailPanel}</div>
    <div hidden={effectiveKind !== 'building'} className={effectiveKind === 'building' ? 'map-workspace-view' : 'hidden'}>{buildingDetailPanel}</div>
    <div hidden={effectiveKind !== 'supply'} className={effectiveKind === 'supply' ? 'map-workspace-view' : 'hidden'}>
      <SupplyPanel loading={futureSupplyLoading} active={effectiveKind === 'supply' && !searchChoicesVisible} warning={fullListWarning} calendar={futureSupplyCalendar} total={futureSuppliesCount}
        commercialProjects={futureSupplies.filter(supply => !isPendingFutureSupply(supply) && isCommercialFutureSupply(supply))}
        officeProjects={futureSupplies.filter(supply => !isPendingFutureSupply(supply) && !isCommercialFutureSupply(supply))}
        pendingProjects={futureSupplies.filter(isPendingFutureSupply)}
        onSelect={project => onBuildingClick({ ...project, _dataType: 'future' })} onClose={closeRight} />
    </div>
    <div hidden={effectiveKind !== 'list' && effectiveKind !== 'compare'} className={effectiveKind === 'list' || effectiveKind === 'compare' ? 'map-workspace-view' : 'hidden'}>
      {listVisited ? <FloatingBuildingList active={(effectiveKind === 'list' || effectiveKind === 'compare') && !searchChoicesVisible} buildings={combinedBuildingList} displayOverrides={displayOverrides}
        onClose={closeRight} onBuildingClick={onBuildingClick} targetBuildingId={targetBuildingId} targetBuildingType={targetBuildingType}
        onBuildingHover={onBuildingHover} selectedComparisonBuildings={selectedComparisonBuildings}
        onComparisonSelectionChange={handleComparisonSelectionChange} onAdjustFilters={() => onFilterPanelOpenChange(true)} /> : null}
    </div>
  </div></>;

  return (
    <div ref={viewportRef} data-map-focus-root className="map-workbench relative overflow-clip">
      {/* Keep SDK visibility measurable during direct list startup; opacity and inert hide the inactive map. */}
      <div ref={mapWorkspaceRef} className={isFullListVisible ? 'opacity-0 pointer-events-none absolute inset-0' : 'absolute inset-0'} inert={isFullListVisible || undefined} aria-hidden={isFullListVisible || undefined}>
    <div className="map-workbench-page flex h-full flex-col overflow-hidden bg-[var(--cd-color-workspace)] text-[var(--cd-color-text-primary)]">
      <div className="map-workbench-tools">
      <header className="relative z-[500] shrink-0 border-b border-[var(--cd-color-border)] bg-[var(--cd-color-surface)]">
        <div className="map-page-header">
          <BrokerSearchLink /><h1 title="北京办公楼市场地图">北京办公楼市场地图</h1>
          <MetricStrip stats={stats} busy={mapDataLoading || (!mapReady && !mapError)} />
          <div className="map-header-navigation">
            <Link href="/" className="workspace-header-link"><Home size={16} aria-hidden="true" />主页</Link>
            <Button variant="secondary" size="sm" onClick={() => onOpenFullList?.()} aria-label="完整列表">完整列表</Button>
            {process.env.NODE_ENV === 'development' ? <Button variant="secondary" size="sm" onClick={() => { void onExportMapData(); }} disabled={isExporting || !mapReady}>{isExporting ? '导出中…' : '导出地图数据'}</Button> : null}
          </div>
          <div className="map-header-navigation-mobile"><MapDisclosure width={208} active={!isFullListVisible} label={<><MoreHorizontal size={18} aria-hidden="true" /><span className="sr-only">页面导航</span></>}>
            <Link href="/" className="workspace-header-link"><Home size={16} aria-hidden="true" />主页</Link>
            <button type="button" className="workspace-header-link" aria-label="完整列表" onClick={() => onOpenFullList?.()}><List size={16} aria-hidden="true" />完整列表</button>
          </MapDisclosure></div>
        </div>
        {(brokerContext?.back || brokerContext?.unavailable || brokerContext?.filtered) && <div className="flex flex-wrap items-center gap-x-3 px-4 text-sm">
          {brokerContext.back && <a className="inline-flex min-h-11 items-center text-[var(--cd-color-brand)] underline" href={brokerContext.back}>返回来源</a>}
          {brokerContext.filtered && <span role="status">原项目不在当前筛选结果中，已保留筛选并单独打开详情。</span>}
          {brokerContext.unavailable && <span role="status">项目不存在或当前身份无权访问。</span>}
        </div>}
        {queryPanel}
      </header>

        <div data-map-focus-top className="map-workspace-toolbar">
          <div className="map-toolbar-primary">
            <IconButton label={focusMode ? '恢复工作区' : '地图专注'} active={focusMode} onClick={() => onFocusModeChange?.()}>
              {focusMode ? <Minimize2 size={16} strokeWidth={1.75} aria-hidden="true" /> : <Maximize2 size={16} strokeWidth={1.75} aria-hidden="true" />}
            </IconButton>
            <IconButton label="筛选" active={isFilterPanelOpen} onClick={toggleFilterPanel}>
              <ListFilter size={16} strokeWidth={1.75} aria-hidden="true" />
            </IconButton>
          </div>

          <div className="map-toolbar-search">
            <div className="relative" ref={searchInputWrapRef}>
              <div className="map-workspace-search-input">
                <SearchBar
                  searchContextKey={searchContextKey}
                  inputLabel="搜索楼宇、子市场、业主或物业"
                  placeholder="搜索楼宇、子市场、业主…"
                  debounceMs={220}
                  value={keyword}
                  onChange={value => {
                    setSearchChoicesOpen(Boolean(value.trim()));
                    if (value.trim() && !isFullListVisible) {
                      if (focusMode) onFocusModeChange?.();
                    }
                    onKeywordChange(value);
                  }}
                  onSearch={onSearch}
                  onSubmit={value => {
                    setSearchChoicesOpen(Boolean(value.trim()));
                    if (onSearchSubmit) onSearchSubmit(value);
                    else void onSearch(value);
                  }}
                  onArrowDown={searchChoicesVisible && !fullListBusy && searchChoices.items.length > 0
                    ? () => searchChoicesRef.current?.querySelector<HTMLButtonElement>('[data-map-search-choice]')?.focus()
                    : undefined}
                />
              </div>

            </div>

          </div>

          <div className="map-toolbar-mode-group"><div className="map-workspace-modes shrink-0 overflow-hidden rounded-[6px] border border-[#d9e0e8] bg-white shadow-[0_2px_8px_rgba(23,32,51,0.10)] flex" role="group" aria-label="地图显示模式">
            {MODE_OPTIONS.map(({ mode, label }, index) => (
              <button
                key={mode}
                type="button"
                aria-pressed={renderMode === mode}
                onClick={() => onRenderModeChange(mode)}
                className={`h-9 px-3 text-[14px] font-normal transition-colors focus-visible:z-10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[var(--cd-color-brand)] ${index > 0 ? 'border-l border-slate-200/80' : ''} ${renderMode === mode ? 'bg-[var(--cd-color-brand)] text-white' : 'text-slate-500 hover:bg-slate-50 hover:text-slate-800'}`}
              >
                {label}
              </button>
            ))}
          </div>

            <select className="map-mode-select" aria-label="地图显示模式" value={renderMode} onChange={event => onRenderModeChange(event.currentTarget.value as RenderMode)}>{MODE_OPTIONS.map(option => <option key={option.mode} value={option.mode}>{option.label}</option>)}</select>
            <MapLegend mode={renderMode} compareGroups={compareGroups} active={!isFullListVisible} futureVisible={filterState?.showFutureSupply ?? true} pointsVisible={baseMapPointsVisible} onPointsChange={onBaseMapPointsChange} mapReady={mapReady} />
          </div>
          <div className="map-toolbar-actions">
            <IconButton label="未来供应" text="供应" active={isSupplyOpen} onClick={toggleSupplyPanel}>
              <CalendarDays size={16} strokeWidth={1.75} aria-hidden="true" />
            </IconButton>
            <button
              type="button"
              onClick={openBuildingList}
              disabled={!canOpenList}
              className="flex h-9 shrink-0 items-center gap-1.5 rounded-[var(--cd-radius-md)] border border-[var(--cd-color-border)] bg-[var(--cd-color-surface)] px-3 text-[14px] font-normal text-[var(--cd-color-text-secondary)] shadow-[var(--cd-shadow-sm)] transition-colors hover:border-[var(--cd-color-border-strong)] hover:text-[var(--cd-color-brand)] disabled:cursor-not-allowed disabled:opacity-45"
              aria-label="项目列表" title="查看项目列表"
            >
              <List size={16} strokeWidth={1.75} aria-hidden="true" />
              <span aria-hidden="true">列表</span>
            </button>
          </div>
            {showFilterSummary ? (
              <div className="map-filter-summary flex min-h-9 items-center gap-2 overflow-x-auto rounded-[var(--cd-radius-md)] border border-[var(--cd-color-border)] bg-[var(--cd-color-surface)] px-2.5 py-1 shadow-[var(--cd-shadow-sm)]" role="group" aria-label="已生效筛选条件">
                {intelligenceContext ? (
                  <>
                    <span className="shrink-0 text-[14px] font-semibold text-[var(--cd-color-brand)]">
                      客户需求 · {intelligenceContext?.candidateCount === null ? '匹配中' : `${intelligenceContext.candidateCount} 个候选`}
                    </span>
                    <Link href="/intelligence" className="shrink-0 text-[14px] text-slate-600 transition hover:text-[var(--cd-color-brand)]">返回需求</Link>
                  </>
                ) : (
                  <span className="shrink-0 text-[14px] font-normal text-slate-600">筛选</span>
                )}
                {searchTerm ? (
                  <button
                    type="button"
                    onClick={() => { void onSearch(''); }}
                    className="group flex max-w-[220px] shrink-0 items-center gap-1 rounded-[var(--cd-radius-sm)] border border-[color:rgb(0_62_126_/_0.15)] bg-[var(--cd-color-brand-soft)] px-2 py-1 text-[14px] text-[var(--cd-color-brand)] transition-colors hover:border-[var(--cd-color-brand)]"
                    title={`清除搜索：${searchTerm}`}
                  >
                    <span className="truncate">搜索：{searchTerm}</span>
                    <span aria-hidden="true">×</span>
                  </button>
                ) : null}
                {activeFilterChips.slice(0, 2).map(chip => (
                  <button
                    key={chip.id}
                    type="button"
                    onClick={() => removeFilterChip(chip.patch)}
                    className="group flex max-w-[230px] shrink-0 items-center gap-1 rounded-[var(--cd-radius-sm)] border border-[var(--cd-color-border)] bg-[var(--cd-color-surface-alt)] px-2 py-1 text-[14px] text-[var(--cd-color-text-secondary)] transition-colors hover:border-[var(--cd-color-border-strong)] hover:bg-white hover:text-[var(--cd-color-brand)]"
                    title={`移除条件：${chip.label}`}
                  >
                    <span className="truncate">{chip.label}</span>
                    <span aria-hidden="true">×</span>
                  </button>
                ))}
                {activeFilterChips.length > 2 || activeFilterChips.some(chip => chip.label.length > 18) ? <MapDisclosure width={304} active={!isFullListVisible} label={`全部 ${activeFilterChips.length} 项条件`} heading="生效条件 · 点选移除" dismissLabel="关闭条件列表">
                  <div className="workspace-filter-overflow">{activeFilterChips.map(chip => <button type="button" key={chip.id} onClick={() => removeFilterChip(chip.patch)} aria-label={`移除条件：${chip.label}`}>{chip.label}<span aria-hidden="true"> ×</span></button>)}</div>
                </MapDisclosure> : null}
                {compareGroups.length > 0 ? (
                  <span className="flex max-w-[230px] shrink-0 items-center gap-1.5 rounded-[var(--cd-radius-sm)] border border-[var(--cd-color-border)] bg-[var(--cd-color-surface-alt)] px-2 py-1 text-[14px] text-[var(--cd-color-text-secondary)]">
                    <span className="flex -space-x-1">
                      {compareGroups.map(group => <span key={group.id} className="h-2.5 w-2.5 rounded-full border border-white" style={{ backgroundColor: group.color }} />)}
                    </span>
                    <span>项目对比组 {compareGroups.length}</span>
                  </span>
                ) : null}
                {hasActiveFilters ? (
                  <button type="button" onClick={resetFilters} className="shrink-0 px-1.5 text-[14px] font-normal text-slate-600 transition hover:text-[#003e7e]">清空</button>
                ) : null}
              </div>
            ) : null}
        </div>


      </div>
      {dataNotice ? <div role="alert" className="workspace-data-notice"><span>{dataNotice}</span><button type="button" className="workspace-business-action" onClick={() => { void onRetryNotice?.(); }}>重新读取</button></div> : null}
      <MapWorkspaceLayout contentPending={rightKind === 'submarket' && fullListBusy} left={isFullListVisible ? null : filters} right={rightContent}
        leftOpen={isFilterPanelOpen} rightOpen={rightOpen} focus={focusMode} width={preferredWidth} kind={panelKind}
        contentKey={rightView?.kind === 'building' ? `building:${rightView.building.id}` : rightView?.kind === 'submarket' ? `submarket:${rightView.name}` : panelKind}
        backLabel={!searchChoicesVisible || rightKind === 'search' ? backLabel : null} onBack={onWorkspaceBack}
        onWidthChange={value => onWorkspaceWidth?.(value, panelKind)}>
      <main className="relative min-h-0 flex-1 overflow-hidden map-workspace-canvas">
        <div id="map-container" className="absolute inset-0 bg-[#f3f6f8]" aria-label="北京办公楼地理分布" />

        {mapError ? (
          <div className="map-workspace-feedback absolute inset-0 z-[240] flex items-center justify-center bg-slate-50/80 p-4">
            <div className="w-full max-w-[460px] rounded-[var(--cd-radius-lg)] border border-[color:rgb(201_54_43_/_0.15)] bg-[var(--cd-color-surface)] p-5 shadow-[var(--cd-shadow-panel)]">
              <div className="text-sm font-semibold text-[var(--cd-color-danger)]">地图加载失败</div>
              <div className="mt-2 break-all text-sm leading-relaxed text-[var(--cd-color-text-secondary)]">{mapError}</div>
              <Button type="button" variant="danger" size="sm" onClick={onRetryMap} className="mt-4">重新加载</Button>
            </div>
          </div>
        ) : null}

        {!mapReady && !mapError ? (
          <div className="map-workspace-feedback absolute inset-0 z-[230] flex items-center justify-center bg-[#eef3f7]">
            <div className="flex items-center gap-2 text-[14px] font-normal text-slate-500">
              <div className="h-5 w-5 animate-spin rounded-full border-2 border-[var(--cd-color-brand)] border-t-transparent" />
              {mapStage === 'tiles' ? '正在加载地图底图…' : '正在加载地图组件…'}
            </div>
          </div>
        ) : null}

        {mapReady && mapDataLoading && !hasBuildings && !mapError ? (
          <div className="map-workspace-feedback absolute inset-0 z-[225] flex items-center justify-center bg-white/70">
            <div className="flex items-center gap-2 text-[14px] text-slate-500">
              <div className="h-4 w-4 animate-spin rounded-full border-2 border-[var(--cd-color-brand)] border-t-transparent" />
              正在读取楼宇数据…
            </div>
          </div>
        ) : null}

        {intelligenceContext && mapReady && !mapError && !isFilterPanelOpen && !isSupplyOpen && !isListVisible ? <div className="map-workspace-feedback absolute inset-0 pointer-events-none"><ProposalDraftBasket /></div> : null}


      </main>
      </MapWorkspaceLayout>
    </div>
      </div>
      {(isFullListVisible || hasVisitedFullList) ? (
        <div className={isFullListVisible ? 'absolute inset-0' : 'hidden'} inert={!isFullListVisible || undefined} aria-hidden={!isFullListVisible || undefined}>
          <FullBuildingList searchContextKey={searchContextKey} active={isFullListVisible} buildings={fullBuildingList} queryKey={fullListQueryKey}
            activeFilterChips={activeFilterChips} compareGroupCount={compareGroups.length} requirementContext={Boolean(intelligenceContext)} competitorContext={competitorContext} filterState={filterState} onPatchFilters={onRemoveFilterChip}
            keyword={keyword} loading={fullListBusy} error={listError === undefined ? mapError : listError} warning={[fullListWarning, dataNotice].filter(Boolean).join(' ') || null}
            filtersOpen={listMoreOpen} moreFiltersTriggerId={moreFiltersTriggerId} filtersPanelId={filtersPanelId}
            displayOverrides={displayOverrides} targetBuildingId={targetBuildingId} targetBuildingType={targetBuildingType}
            onBack={() => onCloseFullList?.()} onToggleFilters={() => {
              if (listMoreOpen) closeListMore();
              else setListMoreContext({ key: searchContextKey });
            }}
            onKeywordChange={onKeywordChange} onSearch={onFullListSearch ?? onSearch} onResetFilters={onResetFilters}
            onRetry={dataNotice ? () => { void onRetryNotice?.(); } : onRetryMap} onBuildingClick={building => onFullListBuildingClick?.(building)} />
        </div>
      ) : null}
      {isFullListVisible && listMoreOpen ? <div className="map-full-list-filters">{filters}</div> : null}

    </div>
  );
}
