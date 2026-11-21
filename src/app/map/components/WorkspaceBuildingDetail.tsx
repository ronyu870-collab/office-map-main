'use client';
import * as React from 'react';
import Link from 'next/link';
import { WorkspacePanelHeader, WorkspacePanelContext } from './WorkspacePanelHeader';
import { bindBuildingPhotoGallery, buildPhotoGallery, buildPhotoTrigger } from '@/src/services/map/buildingPhotoGallery';
import { displayListGrade, hasBuildingLocation, listVacancyPercent, finiteMetric } from '../model/fullBuildingList';
import { isPendingFutureSupply } from '@/src/lib/future-supply-status';
import { futureSupplyDisplayLabel } from '../model/mapDomain';
import { animateWorkspace } from '../runtime/workspaceMotion';
import { useMapReadingScroll } from '../workspace/continuity';
import type { WorkspaceBuildingDetail as Detail } from '../workspace/buildingDetail';
import { auditBuildingReading } from '@/src/utils/buildingReadingAudit';

type Action = 'nearby' | 'contact' | 'trend' | 'edit';
export type BuildingReadingState = { tab: string; scrollTop: number };
function Photos({ detail }: { detail: Detail }) {
  const root = React.useRef<HTMLDivElement>(null);
  const id = detail.building._dataType === 'future' ? detail.building.building_id : detail.building.id;
  const galleryId = `workspace-gallery-${id}`;
  const safeName = (detail.building.name ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!);
  React.useEffect(() => {
    if (!root.current || !id || !detail.photos.length) return;
    return bindBuildingPhotoGallery(root.current, id, detail.photos) ?? undefined;
  }, [id, detail.photos]);
  if (!id || !detail.photos.length || detail.isDemo) return null;
  return <div ref={root} className="workspace-building-photos" dangerouslySetInnerHTML={{ __html:
    buildPhotoTrigger(galleryId) + buildPhotoGallery(galleryId, safeName, detail.photos) }} />;
}
const number = (value: unknown, suffix = '') => {
  const numeric = finiteMetric(value);
  return numeric === null ? '未提供' : numeric.toLocaleString('zh-CN', { maximumFractionDigits: 1 }) + suffix;
};
export function WorkspaceBuildingDetail({ detail, onClose, onAction, onDisposeTrend, readingState, onReadingChange, stackingBack }: {
  detail: Detail; onClose: () => void; onAction: (action: Action) => void; onDisposeTrend: () => void;
  readingState?: BuildingReadingState; onReadingChange?: (state: BuildingReadingState) => void;
  stackingBack?: string;
}) {
  const { building, metric, isDemo, canEdit, overrides } = detail;
  const workspace = React.useContext(WorkspacePanelContext);
  const [tab, updateTab] = React.useState(readingState?.tab ?? 'overview');
  const scroll = React.useRef<HTMLDivElement>(null);
  const [initialScroll] = React.useState(readingState?.scrollTop ?? 0);
  const resetScroll = useMapReadingScroll(scroll, `detail:${detail.building._dataType}:${detail.building.id}`, true, initialScroll);
  const panel = React.useRef<HTMLDivElement>(null);
  React.useLayoutEffect(() => { const animation = animateWorkspace(panel.current, [{ opacity: .7 }, { opacity: 1 }], 120); return () => animation?.cancel(); }, [tab, building.id]);
  const setTab = (next: string) => {
    if (next === tab) return;
    updateTab(next); resetScroll(); onReadingChange?.({ tab: next, scrollTop: 0 });
    auditBuildingReading('VIEW_BUILDING_SECTION', building, { section: next }, isDemo);
  };
  const [trendOpen, setTrendOpen] = React.useState(false);
  React.useEffect(() => () => onDisposeTrend(), [onDisposeTrend]);
  const future = building._dataType === 'future';
  const materialId = future ? building.building_id : building.id;
  const name = isDemo ? '***' : building.name || '未命名项目';
  const protectedValue = (value: unknown) => isDemo && value ? '***' : String(value ?? '未提供');
  const rows: Array<[string, React.ReactNode]> = future ? [
    ['预计入市', building.launch_year ? `${building.launch_year}${building.launch_quarter ?? '年'}` : '待定'],
    ['业主', protectedValue(building.owner)], ['备注', protectedValue(building.notes)],
  ] : [
    [overrides.grade?.display_label ?? '楼宇等级', overrides.grade?.display_value ?? displayListGrade(building.grade)],
    [overrides.submarket?.display_label ?? '子市场', overrides.submarket?.display_value ?? building.submarket ?? '未提供'],
    ['入市时间', String(building.completion_year ?? '未提供')], ['项目业主', protectedValue(building.owner)],
    ['物业公司', protectedValue(building.property_management)], ['LEED', building.leed_certification ?? '未提供'],
  ];
  const action = (label: string, id: string, local?: Action, disabled = false) => <button type="button" data-map-action={id}
    disabled={disabled} onClick={local ? () => onAction(local) : undefined} className="workspace-business-action">{label}</button>;
  return <section className="workspace-building building-popup" data-building-id={future ? materialId ?? '' : building.id}
    data-building-name={name} aria-label={`${name}楼宇详情`}>
    <WorkspacePanelHeader title={name} subtitle={future ? futureSupplyDisplayLabel(building) : [displayListGrade(building.grade), building.submarket].filter(Boolean).join(' · ')} onClose={onClose} closeLabel="关闭楼宇详情" />
    <div ref={scroll} className="workspace-building-scroll workspace-scroll" onScroll={event => onReadingChange?.({ tab, scrollTop: event.currentTarget.scrollTop })}>
      {!hasBuildingLocation(building) ? <p role="status">此项目未提供有效坐标，可继续查看资料。</p> : null}
      <dl className="workspace-building-metrics">
        <div><dt>净有效租金 · 元/㎡/月</dt><dd>{number(metric?.net_effective_rent)}</dd></div>
        <div><dt>空置率</dt><dd>{number(listVacancyPercent(finiteMetric(metric?.vacancy_rate)), '%')}</dd></div>
        <div><dt>{future ? '预计总体量' : '建筑面积'} · ㎡</dt><dd>{number(future ? building.total_area : metric?.total_area)}</dd></div>
      </dl>
      <p className="workspace-period" data-workspace-summary>{future ? '未来供应，非当前存量指标' : metric ? `指标期间：${metric.record_year}Q${metric.record_quarter}` : '暂无季度指标'}</p>
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
        {tab === 'overview' ? <><dl className="workspace-building-facts">{rows.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl><Photos detail={detail} /></> : null}
        {tab === 'market' ? <>
          <dl className="workspace-building-facts"><div><dt>表面租金 · 元/㎡/月</dt><dd>{number(metric?.face_rent)}</dd></div><div><dt>物业费 · 元/㎡/月</dt><dd>{number(metric?.management_fee)}</dd></div></dl>
          {!future ? <div className="workspace-business-actions">
            {action('周边项目对比', 'nearby-compare', 'nearby', !hasBuildingLocation(building))}
            {action('楼宇对比', 'building-compare')}
            <button type="button" className="workspace-business-action" aria-expanded={trendOpen} aria-controls="info-chart-panel" onClick={() => { onAction('trend'); setTrendOpen(current => !current); }}>季度趋势</button>
            {canEdit ? action('编辑指标', 'edit-metrics', 'edit') : null}
          </div> : null}
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
      <button type="button" data-map-action="building-ai" hidden>AI 分析</button>
      <div data-map-proposal-slot hidden />
      {!future ? <div hidden={tab !== 'market'}><div id="info-chart-panel" style={{ display: 'none' }}><div className="workspace-chart-heading"><h3>近五年趋势追踪</h3>{workspace ? <button type="button" className="workspace-business-action" onClick={() => workspace.setMode('full')}>展开图表</button> : null}</div><div className="workspace-business-actions"><button type="button" id="chart-btn-rent" data-chart="rent">租金</button><button type="button" id="chart-btn-vac" data-chart="vac">空置率</button></div><div id="info-chart-container" style={{ height: 280 }} /></div></div> : null}
    </div>
  </section>;
}
