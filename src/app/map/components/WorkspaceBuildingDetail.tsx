'use client';
import * as React from 'react';
import { bindBuildingPhotoGallery, buildPhotoGallery, buildPhotoTrigger } from '@/src/services/map/buildingPhotoGallery';
import { displayListGrade, hasBuildingLocation, listVacancyPercent, finiteMetric } from '../model/fullBuildingList';
import { isPendingFutureSupply } from '@/src/lib/future-supply-status';
import { futureSupplyDisplayLabel } from '../model/mapDomain';
import type { WorkspaceBuildingDetail as Detail } from '../workspace/buildingDetail';

type Action = 'nearby' | 'contact' | 'trend' | 'edit';
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
export function WorkspaceBuildingDetail({ detail, onClose, onAction, onDisposeTrend }: {
  detail: Detail; onClose: () => void; onAction: (action: Action) => void; onDisposeTrend: () => void;
}) {
  const { building, metric, isDemo, canEdit, overrides } = detail;
  const [tab, setTab] = React.useState('overview');
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
    <header className="workspace-panel-header"><div><h2>{name}</h2><p>{future ? futureSupplyDisplayLabel(building) : [displayListGrade(building.grade), building.submarket].filter(Boolean).join(' · ')}</p></div>
      <button type="button" aria-label="关闭楼宇详情" onClick={onClose}>×</button></header>
    <div className="workspace-building-scroll">
      {!hasBuildingLocation(building) ? <p role="status">此项目未提供有效坐标，可继续查看资料。</p> : null}
      <Photos detail={detail} />
      <dl className="workspace-building-metrics">
        <div><dt>净有效租金 · 元/㎡/月</dt><dd>{number(metric?.net_effective_rent)}</dd></div>
        <div><dt>空置率</dt><dd>{number(listVacancyPercent(finiteMetric(metric?.vacancy_rate)), '%')}</dd></div>
        <div><dt>{future ? '预计总体量' : '建筑面积'} · ㎡</dt><dd>{number(future ? building.total_area : metric?.total_area)}</dd></div>
      </dl>
      <p className="workspace-period">{future ? '未来供应，非当前存量指标' : metric ? `指标期间：${metric.record_year}Q${metric.record_quarter}` : '暂无季度指标'}</p>
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
      <div role="tabpanel" id={`workspace-building-panel-${tab}`} aria-labelledby={`workspace-building-tab-${tab}`}>
        {tab === 'overview' ? <dl className="workspace-building-facts">{rows.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl> : null}
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
          {canEdit && building.id === '9ee3e3ff-4845-41a1-a78f-390c11b1917a' ? <a href={`/stacking-plan/${building.id}`} className="workspace-business-action">Stacking Plan</a> : null}
        </div> : null}
      </div>
      <button type="button" data-map-action="building-ai" hidden>AI 分析</button>
      <div data-map-proposal-slot hidden />
      {!future ? <div id="info-chart-panel" style={{ display: 'none' }}><h3>近五年趋势追踪</h3><div className="workspace-business-actions"><button type="button" id="chart-btn-rent" data-chart="rent">租金</button><button type="button" id="chart-btn-vac" data-chart="vac">空置率</button></div><div id="info-chart-container" style={{ height: 280 }} /></div> : null}
    </div>
  </section>;
}
