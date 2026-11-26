'use client';
import { PitchHandoffLink } from '@/src/components/pitch/PitchHandoffLink';
import { getImpersonationTargetUserId } from '@/src/services/impersonationHeaders';
import { leedDisplayValue } from '@/src/lib/leed-display';
import { coordinateNotice } from '@/src/lib/map-coordinates';
import * as React from 'react';
import Link from 'next/link';
import { ArrowUpRight, ChevronRight, FileText, LocateFixed, Rows3 } from 'lucide-react';
import { WorkspacePanelHeader, WorkspacePanelContext } from './WorkspacePanelHeader';
import { bindBuildingPhotoGallery, buildPhotoGallery, buildPhotoTrigger } from '@/src/services/map/buildingPhotoGallery';
import { displayListGrade, hasBuildingLocation, listVacancyPercent, finiteMetric } from '../model/fullBuildingList';
import { futureSupplyDate, isPendingFutureSupply } from '@/src/lib/future-supply-status';
import { futureSupplyDisplayLabel } from '../model/mapDomain';
import { animateWorkspace } from '../runtime/workspaceMotion';
import { useMapReadingScroll } from '../workspace/continuity';
import type { WorkspaceBuildingDetail as Detail } from '../workspace/buildingDetail';
import { auditBuildingReading } from '@/src/utils/buildingReadingAudit';

import type { TrendChartReading, TrendChartReadingOptions } from '@/src/services/map/trendChartReading';

type Action = 'locate' | 'nearby' | 'contact' | 'trend' | 'edit';
export type BuildingReadingState = { tab: string; scrollTop: number; scrolls?: Record<string, number>; trendOpen?: boolean; trend?: TrendChartReading; trendHeight?: number; photo?: { open: boolean; index: number } };
function Photos({ detail, reading, onChange }: { detail: Detail; reading?: BuildingReadingState['photo']; onChange: (photo: NonNullable<BuildingReadingState['photo']>) => void }) {
  const root = React.useRef<HTMLDivElement>(null);
  const id = detail.building._dataType === 'future' ? detail.building.building_id : detail.building.id;
  const galleryId = `workspace-gallery-${id}`;
  const readingRef = React.useRef(reading);
  const changeRef = React.useRef(onChange);
  React.useEffect(() => { readingRef.current = reading; changeRef.current = onChange; }, [reading, onChange]);
  const safeName = (detail.building.name ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!);
  const markup = React.useMemo(() => ({ __html: buildPhotoTrigger(galleryId, detail.photos.length) + buildPhotoGallery(galleryId, safeName, detail.photos) }), [galleryId, safeName, detail.photos]);
  React.useEffect(() => {
    if (!root.current || !id || !detail.photos.length) return;
    return bindBuildingPhotoGallery(root.current, id, detail.photos, { initial: readingRef.current, onChange: photo => changeRef.current(photo) }) ?? undefined;
  }, [id, detail.photos, detail.isDemo, markup]);
  if (detail.isDemo) return null;
  if (!id || !detail.photos.length) return <p className="workspace-note">暂无项目图片</p>;
  return <div ref={root} className="workspace-building-photos" dangerouslySetInnerHTML={markup} />;
}
const number = (value: unknown, suffix = '') => {
  const numeric = finiteMetric(value);
  return numeric === null ? '—' : numeric.toLocaleString('zh-CN', { maximumFractionDigits: 1 }) + suffix;
};
export function WorkspaceBuildingDetail({ detail, onClose, onAction, onDisposeTrend, readingState, onReadingChange, stackingBack, outsideResults = false }: {
  detail: Detail; onClose: () => void; onAction: (action: Action, trendReading?: TrendChartReadingOptions) => void; onDisposeTrend: () => void;
  readingState?: BuildingReadingState; onReadingChange?: (state: BuildingReadingState) => void;
  stackingBack?: string; outsideResults?: boolean;
}) {
  const { building, metric, isDemo, canEdit, overrides } = detail;
  const workspace = React.useContext(WorkspacePanelContext);
  const future = building._dataType === 'future';
  const sections = future ? [['overview', '概览'], ['materials', '项目资料']] : [['overview', '概览'], ['market', '行情'], ['materials', '成交与资料']];
  const validInitialTab = sections.some(([id]) => id === readingState?.tab);
  const initialTab = validInitialTab ? readingState!.tab : 'overview';
  const [tab, updateTab] = React.useState(initialTab);
  const scroll = React.useRef<HTMLDivElement>(null);
  const state = React.useRef<BuildingReadingState>({ ...readingState, tab: initialTab, scrollTop: validInitialTab ? readingState?.scrollTop ?? 0 : 0 });
  const report = (patch: Partial<BuildingReadingState>) => { state.current = { ...state.current, ...patch }; onReadingChange?.(state.current); };
  const [initialScroll] = React.useState(validInitialTab ? readingState?.scrollTop ?? 0 : 0);
  const resetScroll = useMapReadingScroll(scroll, `detail:${detail.building._dataType}:${detail.building.id}`, true, initialScroll);
  const tabPosition = React.useRef(initialScroll);
  React.useLayoutEffect(() => { resetScroll(tabPosition.current); }, [tab, resetScroll]);
  const trendHost = React.useRef<HTMLDivElement>(null);
  const panel = React.useRef<HTMLDivElement>(null);
  React.useLayoutEffect(() => { const animation = animateWorkspace(panel.current, [{ opacity: .7 }, { opacity: 1 }], 120); return () => animation?.cancel(); }, [tab, building.id]);
  const setTab = (next: string) => {
    if (next === tab) return;
    const scrolls = { ...state.current.scrolls, [tab]: scroll.current?.scrollTop ?? 0 };
    const position = scrolls[next] ?? 0;
    tabPosition.current = position;
    const trendHeight = tab === 'market' && trendHost.current ? trendHost.current.getBoundingClientRect().height : state.current.trendHeight;
    updateTab(next); report({ tab: next, scrollTop: position, scrolls, ...(trendHeight ? { trendHeight } : {}) });
    auditBuildingReading('VIEW_BUILDING_SECTION', building, { section: next }, isDemo);
  };
  const [savedTrendOpen] = React.useState(readingState?.trendOpen ?? false);
  const [trendOpen, setTrendOpen] = React.useState(savedTrendOpen);
  const [trendPending, setTrendPending] = React.useState(savedTrendOpen);
  const trendRestored = React.useRef(false);
  React.useEffect(() => {
    if (!savedTrendOpen || trendRestored.current || tab !== 'market') return;
    trendRestored.current = true; onAction('trend', { value: state.current.trend, onChange: trend => report({ trend, trendHeight: trendHost.current?.getBoundingClientRect().height || state.current.trendHeight }), onReady: () => setTrendPending(false) });
  }, [tab, savedTrendOpen, onAction]);
  React.useEffect(() => () => onDisposeTrend(), [onDisposeTrend]);
  const materialId = future ? building.building_id : building.id;
  const name = isDemo ? '***' : building.name || '未命名项目';
  const protectedValue = (value: unknown) => isDemo && value ? '***' : String(value ?? '未提供');
  const ownership: Array<[string, React.ReactNode]> = future ? [
    ['业主', protectedValue(building.owner)], ['备注', protectedValue(building.notes)],
  ] : [
    ['项目业主', protectedValue(building.owner)],
    ['物业公司', protectedValue(building.property_management)],
  ];
  const action = (label: string, id: string, local?: Action, disabled = false) => <button type="button" data-map-action={id}
    disabled={disabled} onClick={local ? () => onAction(local) : undefined} className="workspace-business-action">{label}</button>;
  return <section className="workspace-building building-popup" data-building-id={future ? materialId ?? '' : building.id}
    data-building-name={name} aria-label={`${name}楼宇详情`}>
    <WorkspacePanelHeader title={name} subtitle={future ? futureSupplyDisplayLabel(building) : [overrides.grade?.display_value ?? displayListGrade(building.grade), overrides.submarket?.display_value ?? building.submarket].filter(Boolean).join(' · ')} onClose={onClose} closeLabel="关闭楼宇详情" actions={hasBuildingLocation(building) ? <button type="button" className="workspace-icon" aria-label="定位当前项目" title="定位当前项目" onClick={() => onAction('locate')}><LocateFixed size={17} aria-hidden="true" /></button> : null} />
    <div ref={scroll} className="workspace-building-scroll workspace-scroll" onScroll={event => report({ tab, scrollTop: event.currentTarget.scrollTop })}>
      {outsideResults ? <p role="status" className="workspace-note">当前项目不在筛选结果中，已保留详情供继续查阅。</p> : null}
      {!hasBuildingLocation(building) ? <p role="status">{coordinateNotice(building)}</p> : null}
      <section className="workspace-metric-summary" aria-label={future ? '规划指标' : '核心经营指标'} data-workspace-summary>
        <p className="workspace-period">{future ? `${futureSupplyDisplayLabel(building)} · 规划数据` : metric ? `${metric.record_year}Q${metric.record_quarter} 指标` : '暂无季度指标'}</p>
        <dl className="workspace-building-metrics">
          {future ? <div className="workspace-rent-metric"><dt>预计总体量</dt><dd>{number(building.total_area)}<span>㎡</span></dd></div> : <>
            <div className="workspace-rent-metric"><dt>净有效租金</dt><dd>{number(metric?.net_effective_rent)}<span>元/㎡/月</span></dd></div>
            <div><dt>空置率</dt><dd>{number(listVacancyPercent(finiteMetric(metric?.vacancy_rate)), '%')}</dd></div>
            <div><dt>统计面积</dt><dd>{number(metric?.total_area)}<span>㎡</span></dd></div>
          </>}
        </dl>
      </section>
      <nav role="tablist" aria-label="楼宇详情分区" className="workspace-building-tabs" onKeyDown={event => {
        if (!['ArrowLeft', 'ArrowRight'].includes(event.key)) return;
        event.preventDefault();
        const tabs = sections.map(([id]) => id);
        const next = tabs[(tabs.indexOf(tab) + (event.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length];
        setTab(next); document.getElementById(`workspace-building-tab-${next}`)?.focus();
      }}>
        {sections.map(([id, label]) =>
          <button type="button" key={id} role="tab" id={`workspace-building-tab-${id}`} aria-selected={tab === id}
            aria-controls={`workspace-building-panel-${id}`} tabIndex={tab === id ? 0 : -1} onClick={() => setTab(id)}>{label}</button>)}
      </nav>
      <div ref={panel} role="tabpanel" id={`workspace-building-panel-${tab}`} aria-labelledby={`workspace-building-tab-${tab}`}>
        {tab === 'overview' ? <>
          <section className="workspace-detail-group" aria-label="项目属性"><dl className="workspace-building-facts">
            <div><dt>{future ? '预计入市' : '入市时间'}</dt><dd>{future ? futureSupplyDate(building) : String(building.completion_year ?? '').trim() || '未提供'}</dd></div>
            {!future ? <div><dt>LEED</dt><dd>{leedDisplayValue(building.leed_certification)}</dd></div> : null}
          </dl></section>
          <section className="workspace-detail-group" aria-label="业主与物业"><dl className="workspace-building-facts">{ownership.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{typeof value === 'string' && !value.trim() ? '未提供' : value}</dd></div>)}</dl></section>
          <Photos detail={detail} reading={state.current.photo} onChange={photo => report({ photo })} />
        </> : null}
        {tab === 'market' ? <>
          <dl className="workspace-building-facts workspace-market-facts"><div><dt>表面租金</dt><dd>{number(metric?.face_rent)} <span>元/㎡/月</span></dd></div><div><dt>物业费</dt><dd>{number(metric?.management_fee)} <span>元/㎡/月</span></dd></div></dl>
          {!future ? <div className="workspace-business-actions">
            {action('周边项目对比', 'nearby-compare', 'nearby', !hasBuildingLocation(building))}
            {action('楼宇对比', 'building-compare')}
            <button type="button" className="workspace-business-action" aria-expanded={trendOpen} aria-controls="info-chart-panel" onClick={() => { onAction('trend', { value: state.current.trend, onChange: trend => report({ trend, trendHeight: trendHost.current?.getBoundingClientRect().height || state.current.trendHeight }), onReady: () => setTrendPending(false) }); setTrendOpen(current => !current); report({ trendOpen: !trendOpen }); }}>季度趋势</button>
            <button type="button" data-map-action="building-ai" className="workspace-business-action" hidden>AI 分析</button>
            {!isDemo && !getImpersonationTargetUserId() && <PitchHandoffLink
              source={{ kind: 'buildings', buildingIds: [building.id] }}
              period={metric ? `${metric.record_year}-Q${metric.record_quarter}` : undefined}
              className="workspace-business-action workspace-resource-action" label="将楼宇概况加入 Pitch" />}
          </div> : null}
          {canEdit && !future ? <div className="workspace-maintenance-actions workspace-business-actions">{action('编辑指标', 'edit-metrics', 'edit')}</div> : null}
        </> : null}
        {tab === 'materials' ? <div className="workspace-material-tasks">
          {!future ? <section className="workspace-resource-group" aria-label="成交与联系">
            <h3>成交与联系</h3><div className="workspace-business-actions">{action('关联成交', 'related-leases')}{action('联系方式', 'contact', 'contact')}</div>
          </section> : null}
          {materialId && !(future && isPendingFutureSupply(building)) ? <section className="workspace-resource-group" aria-label="项目资料">
            <h3>项目资料</h3><div className="workspace-resource-list">
              <button type="button" className="workspace-business-action workspace-resource-action" data-map-action="building-sales-control" data-building-id={materialId} data-building-name={name} data-category="availability"><FileText size={16} aria-hidden="true" /><span>销控与佣金</span><ChevronRight size={16} aria-hidden="true" /></button>
              <button type="button" className="workspace-business-action workspace-resource-action" data-map-action="building-sales-control" data-building-id={materialId} data-building-name={name} data-category="brochure"><FileText size={16} aria-hidden="true" /><span>楼书与资料</span><ChevronRight size={16} aria-hidden="true" /></button>
            </div>
          </section> : future ? <p role="status" className="workspace-note">{isPendingFutureSupply(building) ? '待核实项目暂无关联原件' : '此未来供应暂无关联原件'}</p> : null}
          {canEdit && !future && building.id === '9ee3e3ff-4845-41a1-a78f-390c11b1917a' ? <section className="workspace-resource-group" aria-label="楼层与租赁">
            <h3>楼层与租赁</h3><Link href={`/stacking-plan/${building.id}${stackingBack ? `?back=${encodeURIComponent(stackingBack)}` : ''}`} prefetch={false} className="workspace-business-action workspace-resource-action"><Rows3 size={16} aria-hidden="true" /><span>Stacking Plan</span><ArrowUpRight size={16} aria-hidden="true" /></Link>
          </section> : null}
        </div> : null}
      </div>
      <div data-map-proposal-slot hidden />
      {!future ? <div ref={trendHost} className="workspace-project-trend-host" hidden={tab !== 'market'} aria-busy={trendPending || undefined} style={{ minHeight: trendPending ? state.current.trendHeight : undefined }}><section id="info-chart-panel" aria-label="项目历史趋势" style={{ display: 'none' }}>
        <div className="workspace-chart-heading"><h3>租金与空置率趋势</h3>{workspace ? <button type="button" className="workspace-business-action" onClick={() => workspace.setMode('full')}>展开图表</button> : null}</div>
        <p className="workspace-note">最新季度与此前五年年末；缺失数据不补零。</p>
        <div className="workspace-trend-switch" role="group" aria-label="趋势指标"><button type="button" id="chart-btn-rent" aria-pressed="true" data-chart="rent">净有效租金</button><button type="button" id="chart-btn-vac" aria-pressed="false" data-chart="vac">空置率</button></div>
        <div id="info-chart-container" style={{ height: 280 }} />
        <div data-building-trend-data />
        <p className="workspace-note">来源：本项目正式季度记录。各期间独立展示，不代表连续季度变化。</p>
      </section></div> : null}
    </div>
  </section>;
}
