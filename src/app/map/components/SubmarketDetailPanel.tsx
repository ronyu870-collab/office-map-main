'use client';

import * as React from 'react';
import dynamic from 'next/dynamic';
import {
  ArrowUpRight, Building2, ChevronRight,
  ExternalLink, MapPin, Maximize2, Minimize2, Pencil,
  Plus, RefreshCw, Save, Trash2, X,
} from 'lucide-react';

import { fetchSubmarketDetailPayload, saveSubmarketProfile, type SubmarketDetailPayload } from '@/src/services/mapDataClient';
import { normalizeMapSubmarket } from '../model/mapDomain';
import { mostRecentMarketMetric, officeGrade, type MarketBuilding, type SubmarketSummary } from '../model/submarketOverview';
import { emptySubmarketProfile, submarketProfileSchema, type SubmarketProfileDraft } from '../model/submarketProfile';

const TrendChart = dynamic(
  () => import('./SubmarketTrendChart').then(module => module.SubmarketTrendChart),
  { ssr: false, loading: () => <div className="flex h-[308px] items-center justify-center text-sm text-[#667085]">正在准备趋势图…</div> },
);

type Props = {
  name: string;
  summary: SubmarketSummary;
  buildings: MarketBuilding[];
  futureCount: number;
  canEdit: boolean;
  suspended?: boolean;
  onClose: () => void;
  onShowAll: () => void;
  onOpenBuilding: (id: string) => void;
};

const number = (value: number | null, decimals = 1) => value == null || !Number.isFinite(value)
  ? '—' : value.toLocaleString('zh-CN', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });

const sectionNames = [
  ['overview', '概况'], ['trend', '行情'], ['industry', '产业'],
  ['population', '人口交通'], ['policies', '政策'], ['insights', '观点'], ['buildings', '项目'],
] as const;

const quietButton = 'inline-flex min-h-10 items-center justify-center gap-1.5 rounded-[6px] border border-[#d9e0e8] bg-white px-3 text-[13px] text-[#334155] hover:bg-[#f8fafc] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#003e7e]';
const outlineButton = 'inline-grid min-h-10 min-w-10 place-items-center rounded-[6px] text-[#667085] hover:bg-[#f1f5f9] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#003e7e]';

function EmptyCopy({ children = '暂无经核实的资料，待维护。' }: { children?: React.ReactNode }) {
  return <p className="m-0 text-[13px] leading-6 text-[#667085]">{children}</p>;
}

function Title({ id, title, description }: { id: string; title: string; description?: string }) {
  return (
    <div id={id} className="scroll-mt-4 border-b border-[#e7ebf0] pb-2">
      <h3 className="m-0 text-[15px] font-semibold text-[#172033]">{title}</h3>
      {description ? <p className="mt-1 text-[12px] leading-5 text-[#667085]">{description}</p> : null}
    </div>
  );
}

function Field({ label, value, onChange, multi = false, placeholder }: {
  label: string; value: string; onChange: (value: string) => void; multi?: boolean; placeholder?: string;
}) {
  const common = 'mt-1 w-full rounded-[6px] border border-[#c3ccd8] bg-white px-2.5 py-2 text-[13px] text-[#172033] outline-none focus:border-[#003e7e] focus:ring-1 focus:ring-[#003e7e]';
  return (
    <label className="block min-w-0 text-[12px] font-medium text-[#475569]">
      {label}
      {multi
        ? <textarea rows={3} className={common} value={value} placeholder={placeholder} onChange={event => onChange(event.target.value)} />
        : <input className={common} value={value} placeholder={placeholder} onChange={event => onChange(event.target.value)} />}
    </label>
  );
}

function ProfileEditor({ name, value, saving, error, onCancel, onSave }: {
  name: string;
  value: SubmarketProfileDraft;
  saving: boolean;
  error: string | null;
  onCancel: () => void;
  onSave: (value: SubmarketProfileDraft) => void;
}) {
  const [draft, setDraft] = React.useState(value);
  const setText = (field: 'headline' | 'overview' | 'industries' | 'transport', text: string) =>
    setDraft(previous => ({ ...previous, [field]: text }));
  const change = (kind: 'demographics' | 'policies' | 'insights', index: number, key: string, next: string) => {
    setDraft(previous => ({
      ...previous,
      [kind]: previous[kind].map((entry, position) => position === index ? { ...entry, [key]: next } : entry),
    }));
  };
  const remove = (kind: 'demographics' | 'policies' | 'insights', index: number) =>
    setDraft(previous => ({ ...previous, [kind]: previous[kind].filter((_, position) => position !== index) }));
  const add = (kind: 'demographics' | 'policies' | 'insights') =>
    setDraft(previous => {
      if (kind === 'demographics') return { ...previous, demographics: [...previous.demographics,
        { label: '', value: '', unit: '', scope: '', asOf: '', sourceUrl: '' }] };
      if (kind === 'policies') return { ...previous, policies: [...previous.policies,
        { title: '', issuer: '', summary: '', applicability: '', asOf: '', sourceUrl: '' }] };
      return { ...previous, insights: [...previous.insights,
        { title: '', body: '', author: '', asOf: '' }] };
    });
  const addButton = (kind: 'demographics' | 'policies' | 'insights', title: string, disabled: boolean) => (
    <button type="button" disabled={disabled} className={quietButton + ' disabled:opacity-40'} onClick={() => add(kind)}>
      <Plus size={14} /> 添加{title}
    </button>
  );

  return (
    <form className="space-y-5" onSubmit={event => { event.preventDefault(); onSave(draft); }}>
      <p className="m-0 text-[13px] leading-6 text-[#667085]">
        正在维护{name}的业务介绍。人口与政策必须填写可核实的范围、日期和来源，禁止把行政区数据冒充子市场数据。
      </p>
      <div className="space-y-3">
        <Field label="一句话定位" value={draft.headline} onChange={text => setText('headline', text)} />
        <Field label="区域概况" value={draft.overview} multi onChange={text => setText('overview', text)} />
        <Field label="产业与需求" value={draft.industries} multi onChange={text => setText('industries', text)} />
        <Field label="交通与通勤" value={draft.transport} multi onChange={text => setText('transport', text)} />
      </div>

      <div className="space-y-3 border-t border-[#e7ebf0] pt-4">
        <h4 className="m-0 text-sm font-semibold">人口与就业事实</h4>
        {draft.demographics.map((row, index) => (
          <div key={index} className="space-y-2 rounded-[6px] border border-[#d9e0e8] bg-[#f8fafc] p-3">
            <div className="flex justify-between"><span className="text-xs text-[#667085]">事实 {index + 1}</span>
              <button type="button" aria-label="删除人口事实" onClick={() => remove('demographics', index)} className={outlineButton}><Trash2 size={14}/></button></div>
            <div className="grid grid-cols-2 gap-2">
              <Field label="名称" value={row.label} onChange={v => change('demographics', index, 'label', v)} />
              <Field label="数值" value={row.value} onChange={v => change('demographics', index, 'value', v)} />
              <Field label="单位" value={row.unit} onChange={v => change('demographics', index, 'unit', v)} />
              <Field label="数据截至" value={row.asOf} onChange={v => change('demographics', index, 'asOf', v)} />
            </div>
            <Field label="统计地域范围" value={row.scope} onChange={v => change('demographics', index, 'scope', v)} />
            <Field label="https 来源链接" value={row.sourceUrl} onChange={v => change('demographics', index, 'sourceUrl', v)} />
          </div>
        ))}
        {addButton('demographics', '事实', draft.demographics.length >= 12)}
      </div>

      <div className="space-y-3 border-t border-[#e7ebf0] pt-4">
        <h4 className="m-0 text-sm font-semibold">政策与规划</h4>
        {draft.policies.map((row, index) => (
          <div key={index} className="space-y-2 rounded-[6px] border border-[#d9e0e8] bg-[#f8fafc] p-3">
            <div className="flex justify-between"><span className="text-xs text-[#667085]">政策 {index + 1}</span>
              <button type="button" aria-label="删除政策" onClick={() => remove('policies', index)} className={outlineButton}><Trash2 size={14}/></button></div>
            <Field label="政策名称" value={row.title} onChange={v => change('policies', index, 'title', v)} />
            <div className="grid grid-cols-2 gap-2">
              <Field label="发布机构" value={row.issuer} onChange={v => change('policies', index, 'issuer', v)} />
              <Field label="发布时间／有效期" value={row.asOf} onChange={v => change('policies', index, 'asOf', v)} />
            </div>
            <Field label="核心内容" multi value={row.summary} onChange={v => change('policies', index, 'summary', v)} />
            <Field label="适用地区及条件" multi value={row.applicability} onChange={v => change('policies', index, 'applicability', v)} />
            <Field label="https 原文链接" value={row.sourceUrl} onChange={v => change('policies', index, 'sourceUrl', v)} />
          </div>
        ))}
        {addButton('policies', '政策', draft.policies.length >= 20)}
      </div>

      <div className="space-y-3 border-t border-[#e7ebf0] pt-4">
        <h4 className="m-0 text-sm font-semibold">团队观点</h4>
        {draft.insights.map((row, index) => (
          <div key={index} className="space-y-2 rounded-[6px] border border-[#d9e0e8] bg-[#f8fafc] p-3">
            <div className="flex justify-between"><span className="text-xs text-[#667085]">观点 {index + 1}</span>
              <button type="button" aria-label="删除观点" onClick={() => remove('insights', index)} className={outlineButton}><Trash2 size={14}/></button></div>
            <Field label="标题" value={row.title} onChange={v => change('insights', index, 'title', v)} />
            <Field label="观点内容与依据" multi value={row.body} onChange={v => change('insights', index, 'body', v)} />
            <div className="grid grid-cols-2 gap-2">
              <Field label="负责人" value={row.author} onChange={v => change('insights', index, 'author', v)} />
              <Field label="观点截至" value={row.asOf} onChange={v => change('insights', index, 'asOf', v)} />
            </div>
          </div>
        ))}
        {addButton('insights', '观点', draft.insights.length >= 12)}
      </div>

      {error ? <p role="alert" className="text-[13px] text-[#c9362b]">{error}</p> : null}
      <div className="sticky bottom-0 flex justify-end gap-2 border-t border-[#e7ebf0] bg-white py-3">
        <button type="button" className={quietButton} disabled={saving} onClick={onCancel}>取消</button>
        <button type="submit" disabled={saving} className="inline-flex min-h-10 items-center gap-2 rounded-[6px] bg-[#003e7e] px-4 text-[13px] font-medium text-white disabled:opacity-50">
          <Save size={15}/>{saving ? '保存中…' : '保存资料'}
        </button>
      </div>
    </form>
  );
}

export function SubmarketDetailPanel({
  name, summary, buildings, futureCount, canEdit, suspended = false, onClose, onShowAll, onOpenBuilding,
}: Props) {
  const [expanded, setExpanded] = React.useState(false);
  const [detail, setDetail] = React.useState<SubmarketDetailPayload | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [loadError, setLoadError] = React.useState<string | null>(null);
  const [grade, setGrade] = React.useState<'all' | 'a' | 'b'>('all');
  const [editing, setEditing] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [saveError, setSaveError] = React.useState<string | null>(null);
  const scrollRef = React.useRef<HTMLDivElement>(null);
  const headingRef = React.useRef<HTMLHeadingElement>(null);
  const [reload, setReload] = React.useState(0);

  React.useEffect(() => {
    let live = true;
    setLoading(true); setLoadError(null); setDetail(null); setEditing(false);
    void fetchSubmarketDetailPayload(name).then(result => {
      if (live) { setDetail(result); setLoading(false); }
    }).catch(error => {
      if (live) { setLoading(false); setLoadError(error instanceof Error ? error.message : '子市场资料读取失败'); }
    });
    return () => { live = false; };
  }, [name, reload]);

  React.useEffect(() => {
    headingRef.current?.focus({ preventScroll: true });
  }, [name]);

  React.useEffect(() => {
    const listener = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || editing || suspended || event.defaultPrevented) return;
      if (document.querySelector('[aria-modal="true"]')) return;
      event.preventDefault();
      onClose();
    };
    document.addEventListener('keydown', listener);
    return () => document.removeEventListener('keydown', listener);
  }, [editing, suspended, onClose]);

  const profile = detail?.profile;
  const series = detail?.trends?.[grade] ?? [];
  const latest = series[series.length - 1];
  const previous = series[series.length - 2];
  const rentChange = latest?.rent != null && previous?.rent != null ? latest.rent - previous.rent : null;
  const vacancyChange = latest?.vacancyPct != null && previous?.vacancyPct != null ? latest.vacancyPct - previous.vacancyPct : null;
  const hasTrend = series.some(row => row.rent !== null || row.vacancyPct !== null);

  const projects = React.useMemo(() => buildings
    .filter(building => normalizeMapSubmarket(building.submarket) === name
      && ['a', 'b'].includes(officeGrade(building.grade))
      && Number.isFinite(building.location_lng) && Number.isFinite(building.location_lat))
    .sort((left, right) => {
      const area = (building: MarketBuilding) => Number(mostRecentMarketMetric(building.metrics)?.total_area ?? 0);
      return area(right) - area(left) || String(left.name ?? '').localeCompare(String(right.name ?? ''), 'zh-CN');
    }).slice(0, 4), [buildings, name]);

  const scrollTo = (id: string) => {
    scrollRef.current?.querySelector(`#submarket-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };
  const closePanel = () => {
    if (editing && !window.confirm('当前编辑尚未保存，确定放弃更改并关闭子市场介绍吗？')) return;
    onClose();
  };
  const save = async (draft: SubmarketProfileDraft) => {
    const parsed = submarketProfileSchema.safeParse(draft);
    if (!parsed.success) { setSaveError('字段格式有误，请检查长度和来源链接。'); return; }
    setSaving(true); setSaveError(null);
    try {
      const next = await saveSubmarketProfile(name, parsed.data);
      setDetail(previous => previous ? { ...previous, profile: next } : previous);
      setEditing(false);
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : '保存失败');
    } finally { setSaving(false); }
  };

  const metric = (label: string, value: string, unit: string) => (
    <div className="min-w-0 border-r border-[#e0e6ec] py-1 last:border-r-0">
      <p className="m-0 text-[11px] text-[#667085]">{label}</p>
      <div className="mt-1 flex flex-wrap items-baseline justify-center gap-1 text-[#172033]">
        <strong className="text-[19px] font-semibold tabular-nums">{value}</strong><span className="text-[10px] text-[#667085]">{unit}</span>
      </div>
    </div>
  );

  return (
    <aside data-map-submarket-panel aria-label={`${name}子市场详情`}
      className={`pointer-events-auto absolute bottom-3 left-3 right-3 top-[64px] z-[405] flex flex-col overflow-hidden rounded-[8px] border border-[#d9e0e8] bg-white text-[#172033] shadow-[0_8px_28px_rgba(23,32,51,0.17)] sm:bottom-4 sm:left-4 sm:right-auto sm:top-[64px] ${expanded ? 'sm:w-[min(780px,calc(100vw-32px))]' : 'sm:w-[420px]'}`}
      style={{ fontFamily: 'Arial, "PingFang SC", "Microsoft YaHei", system-ui, sans-serif' }}>
      <header className="flex shrink-0 items-start justify-between gap-3 border-b border-[#d9e0e8] px-4 py-3.5 sm:px-5">
        <div className="min-w-0">
          <h2 tabIndex={-1} ref={headingRef} className="m-0 text-[19px] font-semibold leading-7 text-[#172033] outline-none">{name}</h2>
          <p className="mt-0.5 text-[12px] text-[#667085]">子市场概况 · 北京办公楼市场</p>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {canEdit && detail?.profileAvailable && !editing ? (
            <button type="button" className={outlineButton} aria-label="编辑子市场介绍" title="编辑子市场介绍"
              onClick={() => { setEditing(true); setSaveError(null); }}><Pencil size={16}/></button>
          ) : null}
          <button type="button" className={outlineButton + ' hidden sm:inline-grid'}
            onClick={() => setExpanded(value => !value)} title={expanded ? '收起宽版' : '展开阅读'}
            aria-label={expanded ? '收起宽版' : '展开阅读'}>
            {expanded ? <Minimize2 size={17}/> : <Maximize2 size={17}/>}
          </button>
          <button type="button" className={outlineButton} onClick={closePanel} aria-label="关闭子市场介绍"><X size={19}/></button>
        </div>
      </header>

      {!editing ? (
        <nav aria-label="子市场介绍章节" className="flex shrink-0 gap-1 overflow-x-auto border-b border-[#edf0f4] px-3 py-2 sm:px-4">
          {sectionNames.map(([id, title]) => <button key={id} type="button" onClick={() => scrollTo(id)}
            className="min-h-8 shrink-0 rounded-[5px] px-2.5 text-[12px] font-medium text-[#667085] hover:bg-[#edf4fb] hover:text-[#003e7e]">{title}</button>)}
        </nav>
      ) : null}

      <div ref={scrollRef} className="min-h-0 flex-1 space-y-6 overflow-y-auto overscroll-contain px-4 py-4 sm:px-5 sm:py-5">
        {editing ? (
          <ProfileEditor name={name} key={name} value={profile ? {
            headline: profile.headline, overview: profile.overview, industries: profile.industries,
            transport: profile.transport, demographics: profile.demographics,
            policies: profile.policies, insights: profile.insights,
          } : emptySubmarketProfile()} saving={saving} error={saveError}
            onCancel={() => { setEditing(false); setSaveError(null); }} onSave={save} />
        ) : (
          <>
            <section className="space-y-3" aria-labelledby="submarket-overview">
              <Title id="submarket-overview" title="区域概况"/>
              {profile?.headline ? <p className="text-[15px] font-medium leading-7 text-[#003e7e]">{profile.headline}</p> : null}
              {profile?.overview ? <p className="whitespace-pre-line text-[13px] leading-6">{profile.overview}</p> : <EmptyCopy>区域定位与基本情况待研究人员维护。</EmptyCopy>}
              <div className="grid grid-cols-3 rounded-[7px] border border-[#e1e7ee] bg-[#f8fafc] py-3 text-center">
                {metric('净有效租金', number(summary.rent), '元/㎡/月')}
                {metric('空置率', number(summary.vacancyPct), '%')}
                {metric('甲乙级项目', summary.officeCount.toLocaleString('zh-CN'), '个')}
              </div>
              <p className="m-0 text-[11px] leading-5 text-[#667085]">
                甲级含超甲级；不含产业园与未来供应。租金、空置率按各楼最新可用指标和有效面积加权，不同楼宇的最新季度可能不同。
              </p>
              <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-[12px] text-[#475569]">
                <span>甲级：<strong className="text-[#172033]">{summary.gradeACount} 个</strong></span>
                <span>乙级：<strong className="text-[#172033]">{summary.gradeBCount} 个</strong></span>
                <span>产业园（另计）：<strong className="text-[#172033]">{summary.parkCount} 个</strong></span>
                <span>未来供应（另计）：<strong className="text-[#172033]">{futureCount} 个</strong></span>
                <span>租金有效样本：{summary.rentSampleCount} 个</span>
                <span>空置率有效样本：{summary.vacancySampleCount} 个</span>
              </div>
              {profile?.insights.length ? (
                <div className="space-y-1.5 rounded-[6px] border-l-[3px] border-[#003e7e] bg-[#f8fafc] px-3 py-2.5">
                  <h4 className="m-0 text-[12px] font-semibold text-[#003e7e]">核心市场观点</h4>
                  {profile.insights.slice(0, 2).map((insight, index) => (
                    <p key={index} className="m-0 text-[12px] leading-5 text-[#334155]">{insight.title}{insight.body ? `：${insight.body}` : ''}</p>
                  ))}
                  {profile.insights.length > 2 ? <button type="button" className="text-[12px] text-[#003e7e]" onClick={() => scrollTo('insights')}>查看全部观点</button> : null}
                </div>
              ) : null}
            </section>

            <section className="space-y-3" aria-labelledby="submarket-trend">
              <Title id="submarket-trend" title="租金与空置率趋势" description="同一季度时间轴 · 双纵轴（左：元/㎡/月，右：%）"/>
              <div role="group" aria-label="趋势分级" className="inline-flex flex-wrap gap-1 rounded-[6px] bg-[#f1f5f9] p-1">
                {([['all', '甲乙级合计'], ['a', '甲级'], ['b', '乙级']] as const).map(([id, label]) =>
                  <button type="button" key={id} aria-pressed={grade === id} onClick={() => setGrade(id)}
                    className={`min-h-8 rounded-[5px] px-3 text-[12px] ${grade === id ? 'bg-white font-semibold text-[#003e7e] shadow-sm' : 'text-[#667085]'}`}>{label}</button>)}
              </div>
              {loading ? <div role="status" className="flex min-h-[180px] items-center justify-center text-sm text-[#667085]">正在读取季度指标…</div>
                : loadError ? <div role="alert" className="space-y-3 rounded-[6px] border border-[#f1d4d0] bg-[#fff7f6] p-3 text-[13px] text-[#a61e1e]">
                  <p>{loadError}</p>
                  <button type="button" className={quietButton} onClick={() => setReload(v => v + 1)}><RefreshCw size={15}/> 重试</button>
                </div>
                  : hasTrend ? (
                    <>
                      <TrendChart data={series}/>
                      <div className="grid grid-cols-2 gap-2 rounded-[6px] bg-[#f8fafc] p-3 text-[12px]">
                        <div><span className="text-[#667085]">最新有记录季度</span><p className="mt-1 font-semibold">{latest?.period ?? '—'}</p></div>
                        <div><span className="text-[#667085]">有效样本</span><p className="mt-1">租金 {latest?.rentSamples ?? 0} / 空置 {latest?.vacancySamples ?? 0} 个</p></div>
                        <div><span className="text-[#667085]">租金与前季比较</span><p className="mt-1 font-medium">{rentChange == null ? '—' : `${rentChange > 0 ? '+' : ''}${rentChange.toFixed(1)} 元/㎡/月`}</p></div>
                        <div><span className="text-[#667085]">空置率与前季比较</span><p className="mt-1 font-medium">{vacancyChange == null ? '—' : `${vacancyChange > 0 ? '+' : ''}${vacancyChange.toFixed(1)} 个百分点`}</p></div>
                      </div>
                      <p className="text-[11px] leading-5 text-[#667085]">来源：系统 building_metrics 季度记录。每季度独立选择有效面积样本，未核实或缺失的数据不补零；曲线不可直接解释为因果关系。</p>
                    </>
                  ) : <EmptyCopy>当前子市场尚无可用于绘图的连续季度指标。</EmptyCopy>}
            </section>

            <section className="space-y-3" aria-labelledby="submarket-industry">
              <Title id="submarket-industry" title="产业与企业需求" description="区域产业特征、需求来源与适合的办公客户"/>
              {profile?.industries ? <p className="whitespace-pre-line text-[13px] leading-6">{profile.industries}</p> : <EmptyCopy/>}
            </section>

            <section className="space-y-3" aria-labelledby="submarket-population">
              <Title id="submarket-population" title="人口、就业与交通" description="人口数据必须注明实际统计地域，不用行政区数字替代子市场"/>
              {(profile?.demographics.length ?? 0) > 0 ? (
                <div className={`grid gap-2 ${expanded ? 'sm:grid-cols-3' : 'sm:grid-cols-2'}`}>
                  {profile?.demographics.map((fact, index) => (
                    <div key={index} className="space-y-1 rounded-[6px] border border-[#e1e7ee] p-3">
                      <div className="text-[12px] text-[#667085]">{fact.label || '人口事实'}</div>
                      <div className="text-[18px] font-semibold tabular-nums">{fact.value || '—'} <span className="text-[11px] font-normal">{fact.unit}</span></div>
                      <div className="text-[11px] leading-5 text-[#667085]">{fact.scope || '范围待确认'}{fact.asOf ? ` · ${fact.asOf}` : ''}</div>
                      {fact.sourceUrl ? <a target="_blank" rel="noopener noreferrer" href={fact.sourceUrl} className="inline-flex items-center gap-1 text-[11px] text-[#003e7e]">数据来源 <ExternalLink size={12}/></a> : null}
                    </div>
                  ))}
                </div>
              ) : <EmptyCopy>暂无可确认统计范围、时间和来源的人口与就业数据。</EmptyCopy>}
              {profile?.transport ? <p className="whitespace-pre-line text-[13px] leading-6">{profile.transport}</p> : <EmptyCopy>交通与通勤说明待维护。</EmptyCopy>}
            </section>

            <section className="space-y-3" aria-labelledby="submarket-policies">
              <Title id="submarket-policies" title="政策与规划" description="保留政策适用条件、文件日期与原文依据"/>
              {profile?.policies.length ? profile.policies.map((policy, index) => (
                <article key={index} className="space-y-1.5 border-b border-[#e7ebf0] pb-3 last:border-none">
                  <h4 className="m-0 text-[13px] font-semibold">{policy.title || '未命名政策'}</h4>
                  <div className="text-[11px] text-[#667085]">{[policy.issuer, policy.asOf].filter(Boolean).join(' · ') || '发布日期待核实'}</div>
                  {policy.summary ? <p className="whitespace-pre-line text-[13px] leading-6">{policy.summary}</p> : null}
                  {policy.applicability ? <p className="text-[12px] leading-5 text-[#475569]">适用范围及条件：{policy.applicability}</p> : null}
                  {policy.sourceUrl ? <a href={policy.sourceUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-[12px] text-[#003e7e]">查看政策原文 <ExternalLink size={13}/></a> : null}
                </article>
              )) : <EmptyCopy>该子市场暂无经过来源核验的政策与规划摘要。</EmptyCopy>}
            </section>

            <section className="space-y-3" aria-labelledby="submarket-insights">
              <Title id="submarket-insights" title="团队市场观点" description="区域判断、适合的客户和需要向客户说明的限制"/>
              {profile?.insights.length ? profile.insights.map((insight, index) => (
                <article key={index} className="space-y-1.5 rounded-[6px] border-l-[3px] border-[#003e7e] bg-[#f8fafc] px-3 py-2.5">
                  <h4 className="m-0 text-[13px] font-semibold">{insight.title || '市场观点'}</h4>
                  <p className="whitespace-pre-line text-[13px] leading-6">{insight.body}</p>
                  <p className="text-[11px] text-[#667085]">{[insight.author, insight.asOf].filter(Boolean).join(' · ') || '待署名和核实日期'}</p>
                </article>
              )) : <EmptyCopy>团队优势、客户适配和风险限制观点待维护，不自动生成未经核实的判断。</EmptyCopy>}
            </section>

            <section className="space-y-3" aria-labelledby="submarket-buildings">
              <Title id="submarket-buildings" title="区域项目" description="展示部分有坐标的甲乙级写字楼；按最新可用总面积排序，不代表推荐排名"/>
              {projects.length ? (
                <div className="divide-y divide-[#edf0f4] rounded-[6px] border border-[#e1e7ee]">
                  {projects.map(project => (
                    <button type="button" key={project.id} onClick={() => project.id && onOpenBuilding(project.id)}
                      className="flex min-h-12 w-full items-center gap-3 px-3 py-2.5 text-left hover:bg-[#f8fafc] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#003e7e]">
                      <Building2 className="shrink-0 text-[#667085]" size={17}/>
                      <span className="min-w-0 flex-1"><span className="block truncate text-[13px] font-medium">{project.name || '未命名项目'}</span>
                        <span className="text-[11px] text-[#667085]">{officeGrade(project.grade) === 'a' ? '甲级写字楼' : '乙级写字楼'}</span></span>
                      <ChevronRight className="shrink-0 text-[#667085]" size={16}/>
                    </button>
                  ))}
                </div>
              ) : <EmptyCopy>没有可定位的甲乙级项目，其他项目可在完整列表中核对。</EmptyCopy>}
              <button type="button" className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-[6px] border border-[#bdcddc] bg-[#edf4fb] px-3 text-[13px] font-semibold text-[#003e7e] hover:bg-[#e2edf8]"
                onClick={onShowAll}><MapPin size={15}/> 查看本子市场全部项目 <ArrowUpRight size={15}/></button>
            </section>

            <p className="border-t border-[#e7ebf0] pt-3 text-[11px] leading-5 text-[#667085]">
              本页市场统计仅反映系统已收录且具有有效身份的存量数据，不代表整个子市场全部真实市场库存。
              {profile?.updatedAt ? `区域资料最近维护：${new Date(profile.updatedAt).toLocaleDateString('zh-CN')}` : '区域介绍尚未维护。'}
              {detail && !detail.profileAvailable ? ' 内容维护表尚未部署，需先应用本功能的数据库迁移。' : ''}
            </p>
          </>
        )}
      </div>
    </aside>
  );
}
