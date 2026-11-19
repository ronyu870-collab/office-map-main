'use client';

import * as React from 'react';
import dynamic from 'next/dynamic';
import { createPortal } from 'react-dom';
import {
  ArrowUpRight, BarChart3, BriefcaseBusiness, Building2, ChevronRight,
  ExternalLink, FileText, Info, Landmark, Lightbulb, MapPin, Pencil,
  Plus, RefreshCw, Save, TrainFront, Trash2, UsersRound, X,
} from 'lucide-react';

import { fetchSubmarketDetailPayload, saveSubmarketProfile, type SubmarketDetailPayload } from '@/src/services/mapDataClient';
import { normalizeMapSubmarket } from '../model/mapDomain';
import { mostRecentMarketMetric, officeGrade, type MarketBuilding, type SubmarketSummary } from '../model/submarketOverview';
import { emptySubmarketProfile, submarketProfileSchema, type SubmarketProfileDraft } from '../model/submarketProfile';

const TrendChart = dynamic(
  () => import('./SubmarketTrendChart').then(module => module.SubmarketTrendChart),
  { ssr: false, loading: () => <div className="flex h-[304px] sm:h-[352px] xl:h-[380px] items-center justify-center text-sm text-[#667085]">正在准备趋势图…</div> },
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
  ['overview', '总览'], ['trend', '趋势'], ['profile-overview', '概况'], ['industry', '产业'],
  ['transport', '交通'], ['population', '人口'], ['policies', '政策'],
  ['insights', '观点'], ['buildings', '项目'],
] as const;

const quietButton = 'inline-flex min-h-10 items-center justify-center gap-1.5 rounded-[6px] border border-[#d9e0e8] bg-white px-3 text-[13px] text-[#334155] hover:bg-[#f8fafc] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#003e7e]';
const outlineButton = 'inline-grid min-h-10 min-w-10 place-items-center rounded-[6px] text-[#667085] hover:bg-[#f1f5f9] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#003e7e]';

function EmptyCopy({ children = '暂无经核实的资料，待维护。' }: { children?: React.ReactNode }) {
  return <p className="m-0 text-[13px] leading-6 text-[#667085]">{children}</p>;
}

function Title({ id, title, description }: { id: string; title: string; description?: string }) {
  return (
    <div className="mb-5 flex items-start gap-3">
      <span aria-hidden="true" className="mt-1 h-6 w-1 shrink-0 rounded-sm bg-[#003e7e]" />
      <div className="min-w-0">
        <h3 id={id} className="m-0 scroll-mt-6 text-[16px] font-semibold leading-6 text-[#172033] sm:text-[18px]">{title}</h3>
        {description ? <p className="mt-1 text-[12px] leading-5 text-[#667085]">{description}</p> : null}
      </div>
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
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
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
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
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
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
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
  const [detail, setDetail] = React.useState<SubmarketDetailPayload | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [loadError, setLoadError] = React.useState<string | null>(null);
  const [grade, setGrade] = React.useState<'all' | 'a' | 'b'>('all');
  const [editing, setEditing] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [saveError, setSaveError] = React.useState<string | null>(null);
  const [reload, setReload] = React.useState(0);
  const dialogRef = React.useRef<HTMLElement>(null);
  const scrollRef = React.useRef<HTMLDivElement>(null);
  const headingRef = React.useRef<HTMLHeadingElement>(null);

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

  const closePanel = React.useCallback(() => {
    if (saving) return;
    if (editing && !window.confirm('当前编辑尚未保存，确定放弃更改并关闭子市场介绍吗？')) return;
    onClose();
  }, [editing, saving, onClose]);

  // A representative building suspends this overlay without unmounting its
  // content: returning to the submarket restores the previous scroll position.
  React.useEffect(() => {
    if (suspended) return;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    headingRef.current?.focus({ preventScroll: true });
    return () => {
      document.body.style.overflow = previousOverflow;
      if (previousFocus?.isConnected) previousFocus.focus({ preventScroll: true });
    };
  }, [name, suspended]);

  React.useEffect(() => {
    if (suspended) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      if (event.key === 'Escape') {
        event.preventDefault();
        closePanel();
        return;
      }
      if (event.key !== 'Tab') return;
      const focusables = Array.from(dialogRef.current?.querySelectorAll<HTMLElement>(
        'a[href], button:not(:disabled), input:not(:disabled), textarea:not(:disabled), select:not(:disabled), [tabindex]:not([tabindex="-1"])',
      ) ?? []).filter(element => element.getAttribute('aria-hidden') !== 'true');
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (!first || !last) {
        event.preventDefault();
        headingRef.current?.focus();
      } else if (event.shiftKey && (document.activeElement === first || document.activeElement === headingRef.current)) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      } else if (!dialogRef.current?.contains(document.activeElement)) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [suspended, closePanel]);

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
    const element = scrollRef.current?.querySelector('#submarket-' + id);
    const reduceMotion = typeof window.matchMedia === 'function'
      && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    element?.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'start' });
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

  const metric = (label: string, value: string, unit: string, note: string) => (
    <div className="min-w-0 rounded-[8px] border border-[#d9e5f0] bg-white px-4 py-4 sm:px-5">
      <p className="m-0 text-[12px] font-medium text-[#475569]">{label}</p>
      <div className="mt-2 flex flex-wrap items-baseline gap-2">
        <strong className="text-[24px] font-semibold leading-tight tabular-nums text-[#003e7e]">{value}</strong>
        <span className="text-[12px] text-[#667085]">{unit}</span>
      </div>
      <p className="mb-0 mt-2 text-[12px] text-[#667085]">{note}</p>
    </div>
  );

  // Map is still mounted beneath the overlay; render above its header and SDK
  // stacking contexts rather than inside the old left-side panel container.
  if (typeof document === 'undefined') return null;
  return createPortal(
    <div
      data-map-submarket-backdrop
      aria-hidden={suspended ? true : undefined}
      className={suspended
        ? 'hidden'
        : 'fixed inset-0 z-[950] flex items-center justify-center bg-[rgb(15_23_42_/_0.48)] sm:p-6'}
      onMouseDown={event => {
        if (event.target === event.currentTarget) closePanel();
      }}
    >
      <section
        ref={dialogRef}
        data-map-submarket-panel
        role="dialog"
        aria-modal={!suspended}
        aria-labelledby="submarket-dialog-heading"
        className="flex h-[100dvh] w-full min-w-0 flex-col overflow-hidden rounded-none border border-[#d9e0e8] bg-[#f5f7fa] text-[#172033] shadow-[0_16px_56px_rgba(15,23,42,0.22)] sm:h-[calc(100dvh-48px)] sm:max-w-[1400px] sm:rounded-[10px]"
        style={{ fontFamily: 'Arial, "PingFang SC", "Microsoft YaHei", system-ui, sans-serif' }}
      >
        <header className="flex shrink-0 items-center justify-between gap-3 border-b border-[#d9e0e8] bg-white px-4 py-3 sm:px-7 sm:py-4">
          <div className="min-w-0">
            <p className="m-0 text-[12px] font-medium text-[#667085]">北京办公楼市场 / 子市场研究</p>
            <h2 id="submarket-dialog-heading" tabIndex={-1} ref={headingRef}
              className="m-0 mt-1 text-[20px] font-semibold leading-7 text-[#172033] outline-none sm:text-[24px]">
              {name}
            </h2>
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            {canEdit && detail?.profileAvailable && !editing ? (
              <button type="button" className={quietButton} onClick={() => { setEditing(true); setSaveError(null); }}>
                <Pencil size={15} aria-hidden="true" /> <span className="hidden sm:inline">维护资料</span><span className="sm:hidden">编辑</span>
              </button>
            ) : null}
            <button type="button" className={outlineButton + ' border border-[#e2e8f0]'}
              onClick={closePanel} aria-label="关闭子市场介绍" title="关闭子市场介绍">
              <X size={19} aria-hidden="true" />
            </button>
          </div>
        </header>

        {!editing ? (
          <nav aria-label="子市场介绍章节" className="flex shrink-0 items-center gap-1 overflow-x-auto border-b border-[#d9e0e8] bg-white px-3 py-2 sm:px-6">
            {sectionNames.map(([id, title]) => (
              <button type="button" key={id} aria-controls={'submarket-' + id} onClick={() => scrollTo(id)}
                className="min-h-9 shrink-0 rounded-[6px] px-3 text-[13px] font-medium text-[#475569] transition-colors hover:bg-[#edf4fb] hover:text-[#003e7e] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#003e7e]">
                {title}
              </button>
            ))}
          </nav>
        ) : null}

        <div ref={scrollRef} tabIndex={0} aria-label="子市场介绍内容"
          className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#003e7e] sm:px-7 sm:py-6 lg:px-10">
          {editing ? (
            <div className="mx-auto max-w-[880px] rounded-[10px] border border-[#d9e0e8] bg-white p-4 sm:p-7">
              <div className="mb-5 border-b border-[#e7ebf0] pb-4">
                <h3 className="m-0 text-[18px] font-semibold">维护子市场介绍</h3>
                <p className="mt-1 text-[13px] text-[#667085]">保留现有字段及来源校验，保存后返回研究展示页。</p>
              </div>
              <ProfileEditor name={name} key={name} value={profile ? {
                headline: profile.headline, overview: profile.overview, industries: profile.industries,
                transport: profile.transport, demographics: profile.demographics,
                policies: profile.policies, insights: profile.insights,
              } : emptySubmarketProfile()} saving={saving} error={saveError}
                onCancel={() => { setEditing(false); setSaveError(null); }} onSave={save} />
            </div>
          ) : (
            <div className="mx-auto max-w-[1280px] space-y-6 sm:space-y-7">
              <section id="submarket-overview" aria-label="子市场市场总览"
                className="scroll-mt-5 rounded-[10px] border border-[#cddfee] bg-[#edf4fb] p-4 sm:p-6 lg:p-7">
                <div className="grid gap-4 lg:grid-cols-[minmax(0,1.6fr)_minmax(250px,0.8fr)] lg:gap-7">
                  <div className="min-w-0">
                    <p className="m-0 text-[12px] font-semibold text-[#003e7e]">子市场画像 / MARKET BRIEF</p>
                    <h3 className="mt-3 text-[20px] font-semibold leading-[1.4] text-[#172033] sm:text-[24px]">
                      {loading ? '正在读取区域介绍…' : profile?.headline || name + ' · 区域市场概览'}
                    </h3>
                    <p className="mb-0 mt-3 line-clamp-3 max-w-[760px] whitespace-pre-line text-[14px] leading-7 text-[#475569]">
                      {loading ? '楼宇存量指标已就绪，区域文字和历史行情正在加载。'
                        : profile?.overview || '区域定位与概况尚待研究人员补充。可先查阅下方已收录楼宇的客观统计。'}
                    </p>
                    {profile?.overview ? (
                      <button type="button" onClick={() => scrollTo('profile-overview')} className="mt-2 text-left text-[12px] font-medium text-[#003e7e] hover:underline">
                        继续阅读区域解读 <ChevronRight size={13} aria-hidden="true" className="inline" />
                      </button>
                    ) : null}
                  </div>
                  <div className="rounded-[8px] border border-[#d7e4f0] bg-white px-4 py-4 sm:px-5">
                    <div className="flex items-center gap-2 text-[12px] font-semibold text-[#003e7e]">
                      <Lightbulb size={16} aria-hidden="true"/> 研究提示
                    </div>
                    <p className="mb-0 mt-3 line-clamp-4 text-[14px] font-medium leading-6 text-[#334155]">
                      {profile?.insights[0]?.title || '目前没有可供引用的区域研究观点'}
                    </p>
                    <p className="mb-0 mt-2 line-clamp-3 whitespace-pre-line text-[12px] leading-5 text-[#667085]">
                      {profile?.insights[0]?.body || '核心判断、客户适配及风险限制需结合项目和实际成交进一步核验。'}
                    </p>
                    <p className="mb-0 mt-3 border-t border-[#e7ebf0] pt-3 text-[12px] text-[#855100]">
                      AI公开资料研究（待业务团队复核）
                    </p>
                  </div>
                </div>

                <div className="mt-6 grid grid-cols-1 gap-3 min-[520px]:grid-cols-3">
                  {metric('平均净有效租金', number(summary.rent), '元/㎡/月', '有效楼宇 ' + summary.rentSampleCount + ' 个')}
                  {metric('平均空置率', number(summary.vacancyPct), '%', '有效楼宇 ' + summary.vacancySampleCount + ' 个')}
                  {metric('甲级＋乙级项目', summary.officeCount.toLocaleString('zh-CN'), '个', '甲级 ' + summary.gradeACount + ' · 乙级 ' + summary.gradeBCount)}
                </div>
                <div className="mt-4 flex flex-wrap gap-x-5 gap-y-2 border-t border-[#cadbe9] pt-4 text-[12px] text-[#475569]">
                  <span>产业园另计：<strong className="text-[#172033]">{summary.parkCount} 个</strong></span>
                  <span>未来供应另计：<strong className="text-[#172033]">{futureCount} 个</strong></span>
                  <span>统计口径：已收录甲乙级存量项目；甲级含超甲级</span>
                </div>
                <p className="mb-0 mt-2 text-[12px] leading-5 text-[#667085]">
                  汇总租金、空置率沿用地图现有最新有效楼宇指标和面积加权口径，各楼宇的最新季度可能不同；不包括产业园及未来供应。
                </p>
              </section>

              <section aria-labelledby="submarket-trend" className="rounded-[10px] border border-[#d9e0e8] bg-white p-4 sm:p-6 lg:p-7">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <Title id="submarket-trend" title="租金与空置率趋势"
                      description="同季度样本 · 过去八季度 · 左轴：净有效租金（元/㎡/月） / 右轴：空置率（%）"/>
                  </div>
                  <div role="group" aria-label="趋势楼宇等级" className="inline-flex flex-wrap gap-1 rounded-[6px] bg-[#f1f5f9] p-1">
                    {([['all', '甲乙级合计'], ['a', '甲级'], ['b', '乙级']] as const).map(([id, label]) => (
                      <button type="button" key={id} aria-pressed={grade === id} onClick={() => setGrade(id)}
                        className={'min-h-9 rounded-[5px] px-3 text-[12px] font-medium focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#003e7e] '
                          + (grade === id ? 'bg-white text-[#003e7e] shadow-sm' : 'text-[#475569] hover:text-[#003e7e]')}>
                        {label}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="grid min-w-0 gap-5 xl:grid-cols-[minmax(0,1fr)_270px] xl:gap-7">
                  <div className="min-w-0">
                    {loading ? (
                      <div role="status" className="flex h-[304px] items-center justify-center rounded-[8px] bg-[#f8fafc] text-[13px] text-[#667085] sm:h-[352px]">
                        正在读取季度指标…
                      </div>
                    ) : loadError ? (
                      <div role="alert" className="space-y-3 rounded-[8px] border border-[#f1d4d0] bg-[#fff7f6] p-5 text-[13px] text-[#a61e1e]">
                        <p className="m-0">季度数据读取失败：{loadError}</p>
                        <button type="button" className={quietButton} onClick={() => setReload(v => v + 1)}>
                          <RefreshCw size={15} aria-hidden="true"/> 重新加载
                        </button>
                      </div>
                    ) : hasTrend ? (
                      <TrendChart data={series} />
                    ) : (
                      <div role="status" className="flex min-h-[260px] flex-col items-center justify-center rounded-[8px] border border-dashed border-[#c3ccd8] bg-[#f8fafc] px-5 text-center">
                        <BarChart3 size={28} aria-hidden="true" className="text-[#8a94a6]" />
                        <p className="mb-0 mt-3 text-[14px] font-semibold text-[#334155]">暂无足够的季度行情数据</p>
                        <p className="mt-2 max-w-[420px] text-[12px] leading-6 text-[#667085]">
                          当前等级暂无可绘制的租金或空置率记录。不会用其他区域或推算值补齐曲线；可切换等级核对。
                        </p>
                      </div>
                    )}
                  </div>
                  <aside aria-label="季度行情解读" className="rounded-[8px] border border-[#e1e7ee] bg-[#f8fafc] p-4 sm:p-5">
                    <div className="flex items-center gap-2 text-[13px] font-semibold text-[#003e7e]">
                      <BarChart3 size={16} aria-hidden="true" /> 行情速读
                    </div>
                    <p className="mb-0 mt-4 text-[12px] text-[#667085]">最新季度</p>
                    <p className="mb-0 mt-1 text-[18px] font-semibold tabular-nums">{hasTrend ? latest?.period || '—' : '—'}</p>
                    <div className="mt-4 space-y-4 border-t border-[#d9e0e8] pt-4">
                      <div>
                        <p className="m-0 text-[12px] text-[#667085]">净有效租金变化</p>
                        <p className="mb-0 mt-1 text-[16px] font-semibold tabular-nums">
                          {rentChange == null ? '暂无可比值' : (rentChange > 0 ? '+' : '') + number(rentChange) + ' 元/㎡/月'}
                        </p>
                      </div>
                      <div>
                        <p className="m-0 text-[12px] text-[#667085]">空置率变化</p>
                        <p className="mb-0 mt-1 text-[16px] font-semibold tabular-nums">
                          {vacancyChange == null ? '暂无可比值' : (vacancyChange > 0 ? '+' : '') + number(vacancyChange) + ' 个百分点'}
                        </p>
                      </div>
                      <div>
                        <p className="m-0 text-[12px] text-[#667085]">最新季度有效样本</p>
                        <p className="mb-0 mt-1 text-[13px] font-medium">
                          租金 {latest?.rentSamples ?? 0} / 空置 {latest?.vacancySamples ?? 0} 个
                        </p>
                      </div>
                    </div>
                    <p className="mb-0 mt-4 border-t border-[#d9e0e8] pt-4 text-[12px] leading-6 text-[#667085]">
                      {previous ? '以上变化对比 ' + previous.period + '，各季样本可能不同，不代表同楼宇租金变化。'
                        : '暂无可供对比的上一季度记录；仅展示已核实的历史数据。'}
                    </p>
                  </aside>
                </div>
                <p className="mb-0 mt-4 flex items-start gap-2 border-t border-[#edf0f4] pt-4 text-[12px] leading-6 text-[#667085]">
                  <Info size={15} aria-hidden="true" className="mt-0.5 shrink-0" />
                  来源：系统 building_metrics 季度正式记录。各季度独立按有效面积样本计算；缺失不补零、草稿不计入，曲线不构成因果或预测结论。
                </p>
              </section>

              <section aria-labelledby="submarket-profile-overview" className="rounded-[10px] border border-[#d9e0e8] bg-white p-4 sm:p-6">
                <Title id="submarket-profile-overview" title="区域概况与基本定位" description="完整区域介绍，保留经维护的原始业务叙述"/>
                {profile?.overview ? (
                  <p className="m-0 whitespace-pre-line text-[14px] leading-7 text-[#334155]">{profile.overview}</p>
                ) : <EmptyCopy>当前子市场暂无可核实的区域概况资料。</EmptyCopy>}
              </section>

              <div className="grid gap-5 lg:grid-cols-2">
                <section aria-labelledby="submarket-industry"
                  className="rounded-[10px] border border-[#d9e0e8] bg-white p-4 sm:p-6">
                  <div className="mb-3 flex items-center gap-2 text-[#003e7e]"><BriefcaseBusiness size={18} aria-hidden="true" /><span className="text-[12px] font-medium">产业结构</span></div>
                  <Title id="submarket-industry" title="产业与客户特征" description="区域产业定位、主要需求及适配办公客户"/>
                  {profile?.industries ? (
                    <p className="m-0 whitespace-pre-line text-[14px] leading-7 text-[#334155]">{profile.industries}</p>
                  ) : <EmptyCopy>尚无经核实的产业及客户结构资料。</EmptyCopy>}
                </section>
                <section aria-labelledby="submarket-transport"
                  className="rounded-[10px] border border-[#d9e0e8] bg-white p-4 sm:p-6">
                  <div className="mb-3 flex items-center gap-2 text-[#003e7e]"><TrainFront size={18} aria-hidden="true" /><span className="text-[12px] font-medium">基础设施</span></div>
                  <Title id="submarket-transport" title="交通与通达性" description="轨道交通、道路联系及通勤说明"/>
                  {profile?.transport ? (
                    <p className="m-0 whitespace-pre-line text-[14px] leading-7 text-[#334155]">{profile.transport}</p>
                  ) : <EmptyCopy>交通及通勤研究资料待维护。</EmptyCopy>}
                </section>
              </div>

              <section aria-labelledby="submarket-population" className="rounded-[10px] border border-[#d9e0e8] bg-white p-4 sm:p-6">
                <div className="mb-3 flex items-center gap-2 text-[#003e7e]"><UsersRound size={18} aria-hidden="true" /><span className="text-[12px] font-medium">背景统计</span></div>
                <Title id="submarket-population" title="人口与就业背景" description="逐条展示事实对应的行政区／统计地域、截至时间和可追溯来源"/>
                <p className="mb-4 rounded-[6px] bg-[#fff7e8] px-3 py-2 text-[12px] leading-5 text-[#855100]">
                  行政区统计人口不等于子市场实际人口，各项数据请以卡片标注的统计范围为准。
                </p>
                {profile?.demographics.length ? (
                  <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                    {profile.demographics.map((fact, index) => (
                      <article key={index} className="min-w-0 rounded-[8px] border border-[#e1e7ee] bg-[#f8fafc] p-4">
                        <h4 className="m-0 text-[13px] font-medium text-[#475569]">{fact.label}</h4>
                        <p className="mb-0 mt-2 text-[22px] font-semibold tabular-nums text-[#172033]">
                          {fact.value} <span className="text-[12px] font-normal text-[#667085]">{fact.unit}</span>
                        </p>
                        <p className="mb-0 mt-3 text-[12px] leading-5 text-[#667085]">范围：{fact.scope}</p>
                        <p className="mb-0 mt-1 text-[12px] leading-5 text-[#667085]">截至：{fact.asOf}</p>
                        {fact.sourceUrl ? (
                          <a href={fact.sourceUrl} target="_blank" rel="noopener noreferrer"
                            className="mt-3 inline-flex min-h-9 items-center gap-1 text-[12px] font-medium text-[#003e7e] hover:underline">
                            查看统计来源 <ExternalLink size={13} aria-hidden="true" />
                          </a>
                        ) : null}
                      </article>
                    ))}
                  </div>
                ) : <EmptyCopy>暂无统计范围、日期和来源齐全的人口或就业事实。</EmptyCopy>}
              </section>

              <section aria-labelledby="submarket-policies" className="rounded-[10px] border border-[#d9e0e8] bg-white p-4 sm:p-6">
                <div className="mb-3 flex items-center gap-2 text-[#003e7e]"><Landmark size={18} aria-hidden="true" /><span className="text-[12px] font-medium">政策环境</span></div>
                <Title id="submarket-policies" title="政策与规划" description="展示发布主体、时间、适用条件与政策原文，不推定仍然有效"/>
                {profile?.policies.length ? (
                  <div className="grid gap-3 lg:grid-cols-2">
                    {profile.policies.map((policy, index) => (
                      <article key={index} className="min-w-0 rounded-[8px] border border-[#e1e7ee] bg-[#f8fafc] p-4 sm:p-5">
                        <div className="flex items-start gap-3">
                          <FileText size={17} aria-hidden="true" className="mt-1 shrink-0 text-[#003e7e]" />
                          <div className="min-w-0">
                            <h4 className="m-0 text-[14px] font-semibold leading-6 text-[#172033]">{policy.title}</h4>
                            <p className="mb-0 mt-1 text-[12px] text-[#667085]">{policy.issuer} · {policy.asOf}</p>
                          </div>
                        </div>
                        <p className="mb-0 mt-3 whitespace-pre-line text-[13px] leading-6 text-[#334155]">{policy.summary}</p>
                        <p className="mb-0 mt-3 rounded-[6px] bg-white px-3 py-2 text-[12px] leading-5 text-[#475569]">
                          <strong className="font-medium">适用范围与条件：</strong>{policy.applicability}
                        </p>
                        {policy.sourceUrl ? (
                          <a href={policy.sourceUrl} target="_blank" rel="noopener noreferrer"
                            className="mt-3 inline-flex min-h-9 items-center gap-1 text-[12px] font-medium text-[#003e7e] hover:underline">
                            查看政策原文 <ExternalLink size={13} aria-hidden="true" />
                          </a>
                        ) : null}
                      </article>
                    ))}
                  </div>
                ) : <EmptyCopy>尚无已核实来源与适用条件的政策资料。</EmptyCopy>}
              </section>

              <section aria-labelledby="submarket-insights" className="rounded-[10px] border border-[#cddfee] bg-[#edf4fb] p-4 sm:p-6">
                <div className="mb-3 flex items-center gap-2 text-[#003e7e]"><Lightbulb size={18} aria-hidden="true" /><span className="text-[12px] font-medium">研究观察</span></div>
                <Title id="submarket-insights" title="核心观点与业务提示" description="区域特征、客户适配与风险限制均需业务人员结合实际项目复核"/>
                <p className="mb-4 rounded-[6px] border border-[#e8d9ba] bg-[#fff7e8] px-3 py-2 text-[12px] font-medium leading-5 text-[#855100]">
                  AI公开资料研究（待业务团队复核） · 不作为高力国际正式研究报告结论
                </p>
                {profile?.insights.length ? (
                  <div className="grid gap-3 lg:grid-cols-2">
                    {profile.insights.map((insight, index) => (
                      <article key={index} className="rounded-[8px] border border-[#d9e0e8] border-l-[3px] border-l-[#003e7e] bg-white p-4 sm:p-5">
                        <h4 className="m-0 text-[14px] font-semibold text-[#172033]">{insight.title}</h4>
                        <p className="mb-0 mt-3 whitespace-pre-line text-[13px] leading-6 text-[#334155]">{insight.body}</p>
                        <p className="mb-0 mt-3 border-t border-[#edf0f4] pt-3 text-[12px] text-[#667085]">{insight.author} · {insight.asOf}</p>
                      </article>
                    ))}
                  </div>
                ) : <EmptyCopy>尚无可展示的研究观点。请由业务团队补充并复核。</EmptyCopy>}
              </section>

              <section aria-labelledby="submarket-buildings" className="rounded-[10px] border border-[#d9e0e8] bg-white p-4 sm:p-6">
                <div className="mb-3 flex items-center gap-2 text-[#003e7e]"><Building2 size={18} aria-hidden="true" /><span className="text-[12px] font-medium">项目目录</span></div>
                <Title id="submarket-buildings" title="区域代表性项目"
                  description="按系统最新可用总面积展示部分可定位的甲乙级项目，仅供查看，不代表推荐排名"/>
                {projects.length ? (
                  <div className="grid gap-3 md:grid-cols-2">
                    {projects.map(project => (
                      <button type="button" key={project.id} onClick={() => project.id && onOpenBuilding(project.id)}
                        className="group flex min-h-16 min-w-0 items-center gap-3 rounded-[8px] border border-[#e1e7ee] bg-[#f8fafc] p-4 text-left transition-colors hover:border-[#b8cddd] hover:bg-[#edf4fb] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#003e7e]">
                        <Building2 size={19} aria-hidden="true" className="shrink-0 text-[#003e7e]" />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[14px] font-semibold">{project.name || '未命名项目'}</span>
                          <span className="mt-1 block text-[12px] text-[#667085]">{officeGrade(project.grade) === 'a' ? '甲级写字楼' : '乙级写字楼'}</span>
                        </span>
                        <ChevronRight size={17} aria-hidden="true" className="shrink-0 text-[#667085] group-hover:text-[#003e7e]" />
                      </button>
                    ))}
                  </div>
                ) : <EmptyCopy>当前暂无可定位的甲乙级项目，其他项目可在完整列表中核对。</EmptyCopy>}
                <button type="button" onClick={onShowAll}
                  className="mt-4 inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-[6px] bg-[#003e7e] px-4 text-[13px] font-semibold text-white hover:bg-[#002f61] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#003e7e] sm:w-auto">
                  <MapPin size={16} aria-hidden="true" /> 在地图查看本区域全部项目 <ArrowUpRight size={15} aria-hidden="true" />
                </button>
              </section>

              <footer className="flex flex-wrap items-start gap-2 border-t border-[#d9e0e8] px-1 py-3 text-[12px] leading-6 text-[#667085]">
                <Info size={15} aria-hidden="true" className="mt-1 shrink-0" />
                <p className="m-0 flex-1">
                  本页统计只反映系统已收录且有有效身份的甲乙级存量项目，不代表子市场全部市场库存。
                  {profile?.updatedAt ? ' 区域资料最近维护：' + new Date(profile.updatedAt).toLocaleDateString('zh-CN') + '。' : ' 区域介绍尚未完成维护。'}
                  {detail && !detail.profileAvailable ? ' 区域资料表尚未部署，需先完成数据库迁移。' : ''}
                </p>
              </footer>
            </div>
          )}
        </div>
      </section>
    </div>,
    document.body,
  );
}
