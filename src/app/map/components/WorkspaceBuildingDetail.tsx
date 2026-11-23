'use client';
import * as React from 'react';
import Link from 'next/link';
import { LocateFixed } from 'lucide-react';
import { WorkspacePanelHeader, WorkspacePanelContext } from './WorkspacePanelHeader';
import { bindBuildingPhotoGallery, buildPhotoGallery, buildPhotoTrigger } from '@/src/services/map/buildingPhotoGallery';
import { displayListGrade, hasBuildingLocation, listVacancyPercent, finiteMetric } from '../model/fullBuildingList';
import { futureSupplyDate, isPendingFutureSupply } from '@/src/lib/future-supply-status';
import { futureSupplyDisplayLabel } from '../model/mapDomain';
import { animateWorkspace } from '../runtime/workspaceMotion';
import { useMapReadingScroll } from '../workspace/continuity';
import type { WorkspaceBuildingDetail as Detail } from '../workspace/buildingDetail';
import { auditBuildingReading } from '@/src/utils/buildingReadingAudit';

type Action = 'locate' | 'nearby' | 'contact' | 'trend' | 'edit';
export type BuildingReadingState = { tab: string; scrollTop: number; scrolls?: Record<string, number>; trendOpen?: boolean; photo?: { open: boolean; index: number } };
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
  detail: Detail; onClose: () => void; onAction: (action: Action) => void; onDisposeTrend: () => void;
  readingState?: BuildingReadingState; onReadingChange?: (state: BuildingReadingState) => void;
  stackingBack?: string; outsideResults?: boolean;
}) {
  const { building, metric, isDemo, canEdit, overrides } = detail;
  const workspace = React.useContext(WorkspacePanelContext);
  const [tab, updateTab] = React.useState(readingState?.tab ?? 'overview');
  const scroll = React.useRef<HTMLDivElement>(null);
  const state = React.useRef<BuildingReadingState>(readingState ?? { tab: 'overview', scrollTop: 0 });
  const report = (patch: Partial<BuildingReadingState>) => { state.current = { ...state.current, ...patch }; onReadingChange?.(state.current); };
  const [initialScroll] = React.useState(readingState?.scrollTop ?? 0);
  const resetScroll = useMapReadingScroll(scroll, `detail:${detail.building._dataType}:${detail.building.id}`, true, initialScroll);
  const panel = React.useRef<HTMLDivElement>(null);
  React.useLayoutEffect(() => { const animation = animateWorkspace(panel.current, [{ opacity: .7 }, { opacity: 1 }], 120); return () => animation?.cancel(); }, [tab, building.id]);
  const setTab = (next: string) => {
    if (next === tab) return;
    const scrolls = { ...state.current.scrolls, [tab]: scroll.current?.scrollTop ?? 0 };
    const position = scrolls[next] ?? 0;
    updateTab(next); resetScroll(position); report({ tab: next, scrollTop: position, scrolls });
    auditBuildingReading('VIEW_BUILDING_SECTION', building, { section: next }, isDemo);
  };
  const [savedTrendOpen] = React.useState(readingState?.trendOpen ?? false);
  const [trendOpen, setTrendOpen] = React.useState(savedTrendOpen);
  const trendRestored = React.useRef(false);
  React.useEffect(() => {
    if (!savedTrendOpen || trendRestored.current || tab !== 'market') return;
    trendRestored.current = true; onAction('trend');
  }, [tab, savedTrendOpen, onAction]);
  React.useEffect(() => () => onDisposeTrend(), [onDisposeTrend]);
  const future = building._dataType === 'future';
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
      {!hasBuildingLocation(building) ? <p role="status">此项目未提供有效坐标，可继续查看资料。</p> : null}
      <section className="workspace-metric-summary" aria-label="核心经营指标" data-workspace-summary>
        <p className="workspace-period">{future ? '未来供应 · 非当前存量指标' : metric ? `${metric.record_year}Q${metric.record_quarter} 指标` : '暂无季度指标'}</p>
        <dl className="workspace-building-metrics">
          <div className="workspace-rent-metric"><dt>净有效租金</dt><dd>{number(metric?.net_effective_rent)}<span>元/㎡/月</span></dd></div>
          <div><dt>空置率</dt><dd>{number(listVacancyPercent(finiteMetric(metric?.vacancy_rate)), '%')}</dd></div>
          <div><dt>{future ? '预计总体量' : '建筑面积'}</dt><dd>{number(future ? building.total_area : metric?.total_area)}<span>㎡</span></dd></div>
        </dl>
      </section>
      <nav role="tablist" aria-label="楼宇详情分区" className="workspace-building-tabs" onKeyDown={event => {
        if (!['ArrowLeft', 'ArrowRight'].includes(event.key)) return;
        event.preventDefault();
        const tabs = ['overview', 'market', 'materials'];
        const next = tabs[(tabs.indexOf(tab) + (event.key === 'ArrowRight' ? 1 : 2)) % 3];
        setTab(next); document.getElementById(`workspace-building-tab-${next}`)?.focus();
      }}>
        {[['overview', '概览'], ['market', '行情'], ['materials', '成交与资料']].map(([id, label]) =>
          <button type="button" key={id} role="tab" id={`workspace-building-tab-${id}`} aria-selected={tab === id}
            aria-controls={`workspace-building-panel-${id}`} tabIndex={tab === id ? 0 : -1} onClick={() => setTab(id)}>{label}</button>)}
      </nav>
      <div ref={panel} role="tabpanel" id={`workspace-building-panel-${tab}`} aria-labelledby={`workspace-building-tab-${tab}`}>
        {tab === 'overview' ? <>
          <section className="workspace-detail-group" aria-label="项目属性"><dl className="workspace-building-facts">
            <div><dt>{future ? '预计入市' : '入市时间'}</dt><dd>{future ? futureSupplyDate(building) : String(building.completion_year ?? '').trim() || '未提供'}</dd></div>
            {!future ? <div><dt>LEED</dt><dd>{String(building.leed_certification ?? '').trim() || '未提供'}</dd></div> : null}
          </dl></section>
          <section className="workspace-detail-group" aria-label="业主与物业"><dl className="workspace-building-facts">{ownership.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{typeof value === 'string' && !value.trim() ? '未提供' : value}</dd></div>)}</dl></section>
          <Photos detail={detail} reading={state.current.photo} onChange={photo => report({ photo })} />
        </> : null}
        {tab === 'market' ? <>
          <dl className="workspace-building-facts workspace-market-facts"><div><dt>表面租金</dt><dd>{number(metric?.face_rent)} <span>元/㎡/月</span></dd></div><div><dt>物业费</dt><dd>{number(metric?.management_fee)} <span>元/㎡/月</span></dd></div></dl>
          {!future ? <div className="workspace-business-actions">
            {action('周边项目对比', 'nearby-compare', 'nearby', !hasBuildingLocation(building))}
            {action('楼宇对比', 'building-compare')}
            <button type="button" className="workspace-business-action" aria-expanded={trendOpen} aria-controls="info-chart-panel" onClick={() => { onAction('trend'); setTrendOpen(current => !current); report({ trendOpen: !trendOpen }); }}>季度趋势</button>
            <button type="button" data-map-action="building-ai" className="workspace-business-action" hidden>AI 分析</button>
          </div> : null}
          {canEdit ? <div className="workspace-maintenance-actions workspace-business-actions">{action('编辑指标', 'edit-metrics', 'edit')}</div> : null}
        </> : null}
        {tab === 'materials' ? <div className="workspace-business-actions">
          {!future ? <>{action('关联成交', 'related-leases')}{action('联系方式', 'contact', 'contact')}</> : null}
          {materialId && !(future && isPendingFutureSupply(building)) ? <>
            <button type="button" className="workspace-business-action" data-map-action="building-sales-control" data-building-id={materialId} data-building-name={name} data-category="availability">销控与佣金</button>
            <button type="button" className="workspace-business-action" data-map-action="building-sales-control" data-building-id={materialId} data-building-name={name} data-category="brochure">楼书与资料</button>
          </> : null}
          {canEdit && building.id === '9ee3e3ff-4845-41a1-a78f-390c11b1917a' ? <Link href={`/stacking-plan/${building.id}${stackingBack ? `?back=${encodeURIComponent(stackingBack)}` : ''}`} prefetch={false} className="workspace-business-action">Stacking Plan</Link> : null}
        </div> : null}
      </div>
      <div data-map-proposal-slot hidden />
      {!future ? <div hidden={tab !== 'market'}><div id="info-chart-panel" style={{ display: 'none' }}><div className="workspace-chart-heading"><h3>近五年趋势追踪</h3>{workspace ? <button type="button" className="workspace-business-action" onClick={() => workspace.setMode('full')}>展开图表</button> : null}</div><div className="workspace-business-actions"><button type="button" id="chart-btn-rent" data-chart="rent">租金</button><button type="button" id="chart-btn-vac" data-chart="vac">空置率</button></div><div id="info-chart-container" style={{ height: 280 }} /></div></div> : null}
    </div>
  </section>;
}
