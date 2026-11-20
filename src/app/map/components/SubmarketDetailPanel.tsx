'use client';

import * as React from 'react';
import dynamic from 'next/dynamic';
import { createPortal } from 'react-dom';
import {
  ArrowUpRight, BarChart3, Building2, ChevronRight, ExternalLink,
  MapPin, Pencil, Plus, RefreshCw, Save, Trash2, X,
} from 'lucide-react';

import { fetchSubmarketDetailPayload, saveSubmarketProfile, type SubmarketDetailPayload } from '@/src/services/mapDataClient';
import { normalizeMapSubmarket } from '../model/mapDomain';
import { mostRecentMarketMetric, officeGrade, type MarketBuilding, type SubmarketSummary } from '../model/submarketOverview';
import { emptySubmarketProfile, readSubmarketProfileRow, submarketProfileSchema, type SubmarketProfileDraft } from '../model/submarketProfile';
import { summarizeSubmarketTrend } from '../model/submarketTrendDigest';

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
  ['overview', '市场概览'], ['trend', '行情趋势'],
  ['profile', '区域画像'], ['buildings', '代表项目'],
] as const;

const quietButton = 'inline-flex min-h-10 items-center justify-center gap-1.5 rounded-[6px] border border-[#d9e0e8] bg-white px-3 text-[13px] text-[#334155] hover:bg-[#f8fafc] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#003e7e]';
const outlineButton = 'inline-grid min-h-10 min-w-10 place-items-center rounded-[6px] text-[#667085] hover:bg-[#f1f5f9] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#003e7e]';

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
  onSave: (value: SubmarketProfileDraft, publish: boolean) => void;
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
    <form className="space-y-5" onSubmit={event => { event.preventDefault(); onSave(draft, false); }}>
      <p className="m-0 text-[13px] leading-6 text-[#667085]">
        正在维护{name}的研究资料。只有在逐条核实事实、日期、来源及对外措辞后，才能发布到客户展示页；保存修改默认撤回此前的发布状态。
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
        <button type="button" className={quietButton} disabled={saving} onClick={() => {
          if (JSON.stringify(draft) === JSON.stringify(value) || window.confirm('有未保存的修改，确定放弃吗？')) onCancel();
        }}>取消</button>
        <button type="submit" disabled={saving} className={quietButton + ' disabled:opacity-50'}>
          <Save size={15}/>{saving ? '保存中…' : '保存草稿'}
        </button>
        <button type="button" disabled={saving} className="inline-flex min-h-10 items-center gap-2 rounded-[6px] bg-[#003e7e] px-4 text-[13px] font-medium text-white disabled:opacity-50"
          onClick={() => {
            if (window.confirm('确认已逐项核实来源、时效、事实与对外表述，并作为正式客户展示资料发布？')) onSave(draft, true);
          }}>
          核验并发布
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
  const [section, setSection] = React.useState<(typeof sectionNames)[number][0]>('overview');
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

  const profile = detail?.profilePublished ? detail.profile : null;
  const draftProfile = detail?.draftProfile ?? detail?.profile;
  const series = detail?.trends?.[grade] ?? [];
  const { latest, previous, rentChange, vacancyChange, hasTrend } = summarizeSubmarketTrend(series);

  const projects = React.useMemo(() => buildings
    .filter(building => normalizeMapSubmarket(building.submarket) === name
      && ['a', 'b'].includes(officeGrade(building.grade))
      && Number.isFinite(building.location_lng) && Number.isFinite(building.location_lat))
    .sort((left, right) => {
      const area = (building: MarketBuilding) => Number(mostRecentMarketMetric(building.metrics)?.total_area ?? 0);
      return area(right) - area(left) || String(left.name ?? '').localeCompare(String(right.name ?? ''), 'zh-CN');
    }).slice(0, 4), [buildings, name]);

  const save = async (draft: SubmarketProfileDraft, publish: boolean) => {
    const parsed = submarketProfileSchema.safeParse(draft);
    if (!parsed.success) { setSaveError('字段格式有误，请检查长度和来源链接。'); return; }
    setSaving(true); setSaveError(null);
    try {
      const next = await saveSubmarketProfile(name, parsed.data, publish);
      setDetail(previous => previous ? {
        ...previous,
        draftProfile: next.profile,
        profile: next.profilePublished ? next.profile : readSubmarketProfileRow(null, name),
        profilePublished: next.profilePublished,
      } : previous);
      setEditing(false);
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : '保存失败');
    } finally { setSaving(false); }
  };

  const metric = (label: string, value: string, unit: string, note: string) => (
    <div className="min-w-0 rounded-[8px] border border-[#e3e9f0] bg-white px-3 py-3 sm:px-5 sm:py-4">
      <p className="m-0 text-[11px] font-medium text-[#667085] sm:text-[12px]">{label}</p>
      <div className="mt-2 flex flex-wrap items-baseline gap-x-1.5">
        <strong className="text-[21px] font-semibold leading-tight tabular-nums tracking-tight text-[#003e7e] sm:text-[27px]">{value}</strong>
        <span className="text-[10px] text-[#667085] sm:text-[12px]">{unit}</span>
      </div>
      <p className="mb-0 mt-2 text-[10px] leading-4 text-[#667085] sm:text-[11px]">{note}</p>
    </div>
  );

  const profileReady = Boolean(profile && (profile.headline || profile.overview || profile.industries || profile.transport));
  const visibleTabs = sectionNames.filter(([id]) => id !== 'profile' || profileReady);
  const currentSection = visibleTabs.some(([id]) => id === section) ? section : 'overview';
  const trendReady = !detail?.trendError && hasTrend;
  const gradeNames = [['all', '甲乙级'], ['a', '甲级'], ['b', '乙级']] as const;

  // Keep the map mounted, but let the client brief own its interaction layer.
  if (typeof document === 'undefined') return null;
  return createPortal(
    <div data-map-submarket-backdrop aria-hidden={suspended ? true : undefined}
      className={suspended ? 'hidden' : 'fixed inset-0 z-[950] flex items-center justify-center bg-[rgb(15_23_42_/_0.46)] sm:p-5'}
      onPointerDown={event => { if (event.target === event.currentTarget) closePanel(); }}>
      <section ref={dialogRef} data-map-submarket-panel role="dialog"
        aria-modal={!suspended} aria-labelledby="submarket-dialog-heading"
        className="flex h-[100dvh] w-full min-w-0 flex-col overflow-hidden rounded-none border border-[#e0e6ed] bg-white text-[#172033] shadow-[0_20px_70px_rgba(15,23,42,0.20)] sm:h-[86dvh] sm:max-h-[780px] sm:max-w-[1140px] sm:rounded-[12px]">
        <header className="flex shrink-0 items-center justify-between gap-3 border-b border-[#e9edf2] px-4 py-3 sm:px-7 sm:py-4">
          <div className="min-w-0">
            <p className="m-0 text-[11px] font-medium tracking-wide text-[#64748b]">北京办公楼市场 · 子市场研究</p>
            <h2 id="submarket-dialog-heading" ref={headingRef} tabIndex={-1}
              className="m-0 mt-0.5 truncate text-[21px] font-semibold leading-7 text-[#172033] outline-none sm:text-[25px]">{name}</h2>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            {canEdit && detail?.profileAvailable && !editing ? (
              <button type="button" aria-label="维护资料" title="维护资料" className={outlineButton}
                onClick={() => { setEditing(true); setSaveError(null); }}>
                <Pencil size={16} aria-hidden="true" />
              </button>
            ) : null}
            <button type="button" className={outlineButton} onClick={closePanel}
              aria-label="关闭子市场介绍" title="关闭"><X size={19} aria-hidden="true" /></button>
          </div>
        </header>

        {!editing ? (
          <nav role="tablist" aria-label="子市场研究内容"
            onKeyDown={event => {
              if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
              event.preventDefault();
              const index = visibleTabs.findIndex(([id]) => id === currentSection);
              const next = (index + (event.key === 'ArrowRight' ? 1 : -1) + visibleTabs.length) % visibleTabs.length;
              const target = visibleTabs[next]?.[0];
              if (target) {
                setSection(target);
                document.getElementById('submarket-tab-' + target)?.focus();
                if (scrollRef.current) scrollRef.current.scrollTop = 0;
              }
            }}
            className="flex shrink-0 items-center gap-1 overflow-x-auto border-b border-[#e9edf2] bg-white px-3 sm:px-6">
            {visibleTabs.map(([id, label]) => (
              <button type="button" role="tab" key={id} id={'submarket-tab-' + id}
                tabIndex={currentSection === id ? 0 : -1}
                aria-selected={currentSection === id} aria-controls="submarket-active-panel"
                onClick={() => { setSection(id); if (scrollRef.current) scrollRef.current.scrollTop = 0; }}
                className={'relative min-h-11 shrink-0 px-3 text-[13px] font-medium transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#003e7e] '
                  + (currentSection === id
                    ? 'text-[#003e7e] after:absolute after:inset-x-3 after:bottom-0 after:h-[2px] after:bg-[#003e7e]'
                    : 'text-[#64748b] hover:text-[#003e7e]')}>
                {label}
              </button>
            ))}
          </nav>
        ) : null}

        <div ref={scrollRef} tabIndex={0} aria-label={editing ? '编辑子市场资料' : '子市场研究内容'}
          role={editing ? undefined : 'tabpanel'}
          id={editing ? undefined : 'submarket-active-panel'}
          aria-labelledby={editing ? undefined : 'submarket-tab-' + currentSection}
          className="min-h-0 flex-1 overflow-y-auto overscroll-contain bg-[#f8fafc] px-4 py-4 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#003e7e] sm:px-7 sm:py-5 lg:px-9">
          {editing ? (
            <div className="mx-auto max-w-[880px] rounded-[9px] border border-[#e0e6ed] bg-white p-4 sm:p-7">
              <div className="mb-5 border-b border-[#e7ebf0] pb-4">
                <h3 className="m-0 text-[18px] font-semibold">维护区域资料</h3>
                <p className="mt-1 text-[12px] text-[#64748b]">
                  现有资料默认仅供维护；核实后主动发布，才会进入客户展示页面。
                </p>
              </div>
              <ProfileEditor name={name} key={name} value={draftProfile ? {
                headline: draftProfile.headline, overview: draftProfile.overview,
                industries: draftProfile.industries, transport: draftProfile.transport,
                demographics: draftProfile.demographics, policies: draftProfile.policies,
                insights: draftProfile.insights,
              } : emptySubmarketProfile()}
                saving={saving} error={saveError}
                onCancel={() => { setEditing(false); setSaveError(null); }} onSave={save} />
            </div>
          ) : (
            <div className="mx-auto max-w-[1050px]">
              {currentSection === 'overview' ? (
                <div className="space-y-4 sm:space-y-5">
                  <section aria-label="区域定位" className="rounded-[9px] border border-[#e0e6ed] bg-white px-4 py-4 sm:px-6 sm:py-5">
                    <h3 className="m-0 text-[18px] font-semibold leading-7 text-[#172033] sm:text-[21px]">
                      {profile?.headline || name + '办公市场概览'}
                    </h3>
                    {profile?.overview ? (
                      <p className="mb-0 mt-2 line-clamp-2 text-[13px] leading-6 text-[#475569]">
                        {profile.overview}
                      </p>
                    ) : (
                      <p className="mb-0 mt-1.5 text-[12px] leading-5 text-[#64748b]">
                        聚焦已收录甲乙级写字楼的租金、空置率与楼宇构成。
                      </p>
                    )}
                  </section>

                  <section aria-label="市场核心指标" className="grid grid-cols-3 gap-2 sm:gap-3">
                    {metric('平均净有效租金', number(summary.rent), '元/㎡/月', '有效样本 ' + summary.rentSampleCount + ' 个')}
                    {metric('平均空置率', number(summary.vacancyPct), '%', '有效样本 ' + summary.vacancySampleCount + ' 个')}
                    {metric('甲乙级项目', summary.officeCount.toLocaleString('zh-CN'), '个', '甲级 ' + summary.gradeACount + ' · 乙级 ' + summary.gradeBCount)}
                  </section>

                  <div className="grid gap-3 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,0.85fr)]">
                    <section aria-label="市场走势速览" className="min-w-0 rounded-[9px] border border-[#e0e6ed] bg-white px-4 py-3 sm:px-5">
                      <div className="flex items-center justify-between gap-3">
                        <h3 className="m-0 text-[14px] font-semibold">租金与空置率走势</h3>
                        <button type="button" className="inline-flex min-h-9 shrink-0 items-center gap-1 text-[12px] font-medium text-[#003e7e] hover:underline"
                          onClick={() => setSection('trend')}>查看趋势 <ChevronRight size={14} aria-hidden="true" /></button>
                      </div>
                      {loading ? (
                        <div className="flex h-[188px] items-center justify-center text-[12px] text-[#64748b]">正在读取行情…</div>
                      ) : trendReady ? (
                        <TrendChart data={detail?.trends.all ?? []} compact />
                      ) : (
                        <div className="flex h-[188px] flex-col items-center justify-center gap-2 text-[12px] text-[#64748b]">
                          <BarChart3 size={23} aria-hidden="true" />
                          <span>近期暂无足够的同季度可比数据</span>
                        </div>
                      )}
                    </section>
                    <section aria-label={profileReady ? '区域特点' : '楼宇结构'} className="min-w-0 rounded-[9px] border border-[#e0e6ed] bg-white px-4 py-4 sm:px-5">
                      <h3 className="m-0 text-[14px] font-semibold">{profileReady ? '区域特点' : '楼宇构成'}</h3>
                      {profileReady ? (
                        <div className="mt-4 space-y-3">
                          {profile?.industries ? <div>
                            <p className="m-0 text-[11px] text-[#64748b]">产业及办公需求</p>
                            <p className="mb-0 mt-1 line-clamp-3 text-[13px] leading-6 text-[#334155]">{profile.industries}</p>
                          </div> : null}
                          {profile?.transport ? <div>
                            <p className="m-0 text-[11px] text-[#64748b]">交通及配套</p>
                            <p className="mb-0 mt-1 line-clamp-3 text-[13px] leading-6 text-[#334155]">{profile.transport}</p>
                          </div> : null}
                          <button type="button" className="inline-flex min-h-9 items-center gap-1 text-[12px] font-medium text-[#003e7e] hover:underline"
                            onClick={() => setSection('profile')}>完整区域画像 <ChevronRight size={14} aria-hidden="true" /></button>
                        </div>
                      ) : (
                        <div className="mt-4 space-y-3">
                          <div className="flex items-center justify-between text-[13px]"><span className="text-[#475569]">甲级写字楼</span><strong className="tabular-nums">{summary.gradeACount} 个</strong></div>
                          <div className="h-1.5 overflow-hidden rounded-full bg-[#edf1f5]">
                            <div className="h-full rounded-full bg-[#003e7e]" style={{ width: (summary.officeCount ? summary.gradeACount / summary.officeCount * 100 : 0) + '%' }} />
                          </div>
                          <div className="flex items-center justify-between text-[13px]"><span className="text-[#475569]">乙级写字楼</span><strong className="tabular-nums">{summary.gradeBCount} 个</strong></div>
                          <div className="h-1.5 overflow-hidden rounded-full bg-[#edf1f5]">
                            <div className="h-full rounded-full bg-[#8fa9c3]" style={{ width: (summary.officeCount ? summary.gradeBCount / summary.officeCount * 100 : 0) + '%' }} />
                          </div>
                          <p className="mb-0 border-t border-[#edf1f5] pt-3 text-[11px] leading-5 text-[#64748b]">
                            另收录产业园 {summary.parkCount} 个、未来供应 {futureCount} 个，均不计入上述甲乙级统计。
                          </p>
                        </div>
                      )}
                    </section>
                  </div>
                  {projects.length ? (
                    <section aria-label="代表性项目速览" className="rounded-[9px] border border-[#e0e6ed] bg-white px-4 py-3 sm:px-5">
                      <div className="mb-2 flex items-center justify-between gap-2">
                        <h3 className="m-0 text-[14px] font-semibold">代表性项目</h3>
                        <button type="button" className="inline-flex min-h-9 items-center gap-1 text-[12px] font-medium text-[#003e7e] hover:underline"
                          onClick={() => setSection('buildings')}>查看项目 <ChevronRight size={14} aria-hidden="true" /></button>
                      </div>
                      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                        {projects.map(project => (
                          <button type="button" key={project.id} onClick={() => project.id && onOpenBuilding(project.id)}
                            className="group flex min-h-12 min-w-0 items-center justify-between gap-2 rounded-[6px] bg-[#f8fafc] px-3 py-2 text-left transition-colors hover:bg-[#edf4fb] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#003e7e]">
                            <span className="min-w-0 truncate text-[12px] font-medium text-[#334155]">{project.name || '项目'}</span>
                            <ChevronRight size={13} aria-hidden="true" className="shrink-0 text-[#94a3b8] group-hover:text-[#003e7e]" />
                          </button>
                        ))}
                      </div>
                    </section>
                  ) : null}
                  <p className="m-0 px-1 text-[11px] leading-5 text-[#64748b]">
                    核心指标按各楼宇最新有效季度面积加权，趋势图按同季度样本计算；产业园另计 {summary.parkCount} 个，未来供应另计 {futureCount} 个，均不包含在甲乙级样本内。
                  </p>
                </div>
              ) : currentSection === 'trend' ? (
                <div className="space-y-4">
                  <section className="rounded-[9px] border border-[#e0e6ed] bg-white px-4 py-4 sm:px-6 sm:py-5" aria-label="季度行情">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <h3 className="m-0 text-[17px] font-semibold">租金与空置率趋势</h3>
                        <p className="mb-0 mt-1 text-[12px] text-[#64748b]">最近八个季度 · 净有效租金（元/㎡/月）与空置率（%）</p>
                      </div>
                      <div role="group" aria-label="楼宇等级" className="inline-flex rounded-[6px] bg-[#f1f5f9] p-1">
                        {gradeNames.map(([id, label]) => (
                          <button type="button" key={id} aria-pressed={grade === id} onClick={() => setGrade(id)}
                            className={'min-h-9 rounded-[5px] px-3 text-[12px] font-medium focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#003e7e] '
                              + (grade === id ? 'bg-white text-[#003e7e] shadow-sm' : 'text-[#64748b] hover:text-[#003e7e]')}>{label}</button>
                        ))}
                      </div>
                    </div>
                    {loading ? (
                      <div className="flex h-[260px] items-center justify-center text-[12px] text-[#64748b]">正在读取季度数据…</div>
                    ) : detail?.trendError || loadError ? (
                      <div className="flex min-h-[220px] flex-col items-center justify-center gap-3 text-[13px] text-[#64748b]">
                        <span>历史行情暂不可用</span>
                        <button type="button" className={quietButton} onClick={() => setReload(x => x + 1)}>
                          <RefreshCw size={14} aria-hidden="true" /> 重新加载
                        </button>
                      </div>
                    ) : trendReady ? <TrendChart data={series} /> : (
                      <div className="flex min-h-[220px] items-center justify-center text-[13px] text-[#64748b]">
                        当前等级暂无有效季度走势
                      </div>
                    )}
                  </section>
                  <section aria-label="行情摘要" className="grid grid-cols-2 gap-2 sm:grid-cols-4 sm:gap-3">
                    {metric('最新有效季度', latest?.period ?? '—', '', '非连续季度不补齐')}
                    {metric('租金季度变化', rentChange == null ? '—' : (rentChange > 0 ? '+' : '') + number(rentChange), '元/㎡/月', rentChange == null ? '暂无相邻可比季度' : '与相邻季度比较')}
                    {metric('空置率季度变化', vacancyChange == null ? '—' : (vacancyChange > 0 ? '+' : '') + number(vacancyChange), '百分点', vacancyChange == null ? '暂无相邻可比季度' : '与相邻季度比较')}
                    {metric('最新有效样本', String(latest?.rentSamples ?? 0), '个（租金）', '空置样本 ' + (latest?.vacancySamples ?? 0) + ' 个')}
                  </section>
                  <p className="m-0 px-1 text-[11px] leading-5 text-[#64748b]">
                    数据来自正式季度记录，按同季度有效面积加权；缺失不补零。各期样本可能不同，变化不代表同一楼宇的租金变动。
                  </p>
                </div>
              ) : currentSection === 'profile' && profile ? (
                <div className="space-y-4">
                  <section className="rounded-[9px] border border-[#e0e6ed] bg-white p-4 sm:p-6">
                    <h3 className="m-0 text-[17px] font-semibold">区域定位</h3>
                    <p className="mb-0 mt-3 whitespace-pre-line text-[13px] leading-6 text-[#334155]">{profile.overview}</p>
                  </section>
                  <div className="grid gap-3 md:grid-cols-2">
                    {profile.industries ? (
                      <section className="rounded-[9px] border border-[#e0e6ed] bg-white p-4 sm:p-5">
                        <h3 className="m-0 text-[15px] font-semibold">产业及办公需求</h3>
                        <p className="mb-0 mt-3 whitespace-pre-line text-[13px] leading-6 text-[#475569]">{profile.industries}</p>
                      </section>
                    ) : null}
                    {profile.transport ? (
                      <section className="rounded-[9px] border border-[#e0e6ed] bg-white p-4 sm:p-5">
                        <h3 className="m-0 text-[15px] font-semibold">交通与配套</h3>
                        <p className="mb-0 mt-3 whitespace-pre-line text-[13px] leading-6 text-[#475569]">{profile.transport}</p>
                      </section>
                    ) : null}
                  </div>
                  {profile.demographics.length ? (
                    <section className="rounded-[9px] border border-[#e0e6ed] bg-white p-4 sm:p-5">
                      <h3 className="m-0 text-[15px] font-semibold">人口与就业参考</h3>
                      <div className="mt-3 grid gap-2 md:grid-cols-3">
                        {profile.demographics.map((fact, index) => (
                          <article key={index} className="rounded-[6px] bg-[#f8fafc] p-3">
                            <p className="m-0 text-[11px] text-[#64748b]">{fact.label}</p>
                            <p className="mb-0 mt-1 text-[20px] font-semibold">{fact.value} <span className="text-[12px] font-normal">{fact.unit}</span></p>
                            <p className="mb-0 mt-1 text-[11px] text-[#64748b]">{fact.scope} · {fact.asOf}</p>
                            <a className="mt-2 inline-flex items-center gap-1 text-[11px] text-[#003e7e] hover:underline"
                              target="_blank" rel="noopener noreferrer" href={fact.sourceUrl}>数据来源 <ExternalLink size={12} aria-hidden="true" /></a>
                          </article>
                        ))}
                      </div>
                    </section>
                  ) : null}
                  {profile.policies.length ? (
                    <section className="rounded-[9px] border border-[#e0e6ed] bg-white p-4 sm:p-5">
                      <h3 className="m-0 text-[15px] font-semibold">政策与规划</h3>
                      <div className="mt-3 grid gap-3 md:grid-cols-2">
                        {profile.policies.map((item, index) => (
                          <article key={index} className="rounded-[6px] bg-[#f8fafc] p-3">
                            <h4 className="m-0 text-[13px] font-semibold">{item.title}</h4>
                            <p className="mb-0 mt-1 text-[11px] text-[#64748b]">{item.issuer} · {item.asOf}</p>
                            <p className="mb-0 mt-2 text-[12px] leading-5 text-[#475569]">{item.summary}</p>
                            <p className="mb-0 mt-1 text-[11px] leading-5 text-[#64748b]">适用范围：{item.applicability}</p>
                            <a className="mt-2 inline-flex items-center gap-1 text-[11px] text-[#003e7e] hover:underline"
                              target="_blank" rel="noopener noreferrer" href={item.sourceUrl}>政策原文 <ExternalLink size={12} aria-hidden="true" /></a>
                          </article>
                        ))}
                      </div>
                    </section>
                  ) : null}
                  {profile.insights.length ? (
                    <section className="rounded-[9px] border border-[#e0e6ed] bg-white p-4 sm:p-5">
                      <h3 className="m-0 text-[15px] font-semibold">市场观察</h3>
                      <div className="mt-3 grid gap-3 md:grid-cols-2">
                        {profile.insights.map((item, index) => (
                          <article key={index} className="rounded-[6px] border-l-[2px] border-[#003e7e] bg-[#f8fafc] p-3">
                            <h4 className="m-0 text-[13px] font-semibold">{item.title}</h4>
                            <p className="mb-0 mt-2 text-[12px] leading-5 text-[#475569]">{item.body}</p>
                            <p className="mb-0 mt-2 text-[11px] text-[#64748b]">{item.author} · {item.asOf}</p>
                          </article>
                        ))}
                      </div>
                    </section>
                  ) : null}
                </div>
              ) : currentSection === 'buildings' ? (
                <section className="rounded-[9px] border border-[#e0e6ed] bg-white p-4 sm:p-6" aria-label="代表性楼宇">
                  <h3 className="m-0 text-[17px] font-semibold">代表性项目</h3>
                  <p className="mb-0 mt-1 text-[12px] text-[#64748b]">按最新可用总面积选取部分可定位的甲乙级项目，不代表项目推荐排名。</p>
                  {projects.length ? (
                    <div className="mt-4 grid gap-2 sm:grid-cols-2">
                      {projects.map(project => (
                        <button type="button" key={project.id} onClick={() => project.id && onOpenBuilding(project.id)}
                          className="group flex min-h-16 min-w-0 items-center gap-3 rounded-[7px] border border-[#e3e9f0] bg-[#f8fafc] p-3 text-left hover:border-[#b8cddd] hover:bg-[#edf4fb] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#003e7e]">
                          <Building2 size={17} aria-hidden="true" className="shrink-0 text-[#003e7e]" />
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-[13px] font-medium">{project.name || '项目'}</span>
                            <span className="mt-1 block text-[11px] text-[#64748b]">{officeGrade(project.grade) === 'a' ? '甲级写字楼' : '乙级写字楼'}</span>
                          </span>
                          <ChevronRight size={16} aria-hidden="true" className="text-[#94a3b8] group-hover:text-[#003e7e]" />
                        </button>
                      ))}
                    </div>
                  ) : (
                    <p className="mt-4 text-[13px] text-[#64748b]">当前区域暂无可定位项目。</p>
                  )}
                  <button type="button" onClick={onShowAll}
                    className="mt-4 inline-flex min-h-10 items-center justify-center gap-2 rounded-[6px] bg-[#003e7e] px-4 text-[12px] font-semibold text-white hover:bg-[#002f61] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#003e7e]">
                    <MapPin size={15} aria-hidden="true" /> 地图查看全部项目 <ArrowUpRight size={14} aria-hidden="true" />
                  </button>
                </section>
              ) : null}
            </div>
          )}
        </div>

        {!editing ? (
          <footer className="flex shrink-0 items-center justify-between gap-3 border-t border-[#e9edf2] bg-white px-4 py-2 text-[10px] text-[#64748b] sm:px-7 sm:text-[11px]">
            <span>统计基于平台收录的甲乙级存量项目，不代表市场全部库存。</span>
            <span className="shrink-0">Colliers Intelligence</span>
          </footer>
        ) : null}
      </section>
    </div>,
    document.body,
  );
}
