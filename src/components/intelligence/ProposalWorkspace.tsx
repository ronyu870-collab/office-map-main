'use client';

import * as React from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, FileDown, Trash2 } from 'lucide-react';

import { WorkspaceShell } from '@/src/components/layout';
import { useAppSession } from '@/src/components/SessionProvider';
import { AppHeader, Badge, Button, LoadingState } from '@/src/components/ui';
import { COLLIERS_LOGO_DATA_URI } from '@/src/constants/brandAssets';
import { isIntelligencePreviewEnabled } from '@/src/config/intelligencePreview';
import {
  getProposalDraftScope,
  moveProposalCandidate,
  PROPOSAL_DRAFT_EVENT,
  readProposalDraft,
  removeProposalCandidate,
  setProposalClientName,
  type ProposalDraft,
  type ProposalDraftScope,
} from '@/src/lib/intelligence/proposalDraft';
import {
  scoreProposalCandidate,
  type ProposalCandidateData,
} from '@/src/lib/intelligence/proposalScoring';
import { supabase } from '@/src/services/supabaseClient';
import type { AuthSessionResult } from '@/src/services/Auth';
import { logAction } from '@/src/utils/audit';

type LoadedCandidate = ProposalCandidateData & {
  address: string | null;
  developer: string | null;
  metroAccess: string | null;
  standardFloorArea: number | null;
  propertyManagement: string | null;
  completionDate: string | null;
  leedCertification: string | null;
  wellCertification: string | null;
  greenBuildingStandard: string | null;
};
type CandidateRead = { key: string; values: ReadonlyMap<string, LoadedCandidate>; error: string | null };

function finite(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function formatNumber(value: number | null, digits = 0) {
  return value === null ? '—' : value.toLocaleString('zh-CN', { maximumFractionDigits: digits, minimumFractionDigits: digits });
}

function formatGrade(grade: string) {
  const normalized = grade.toUpperCase();
  if (normalized.includes('BP')) return '产业园区';
  if (normalized.includes('P')) return '超甲级';
  if (normalized.includes('A')) return '甲级';
  if (normalized.includes('B')) return '乙级';
  return grade || '—';
}

function EmptyProposal() {
  return (
    <div className="mx-auto flex min-h-[60vh] w-full max-w-[780px] items-center px-5 py-10">
      <div className="w-full rounded-[var(--cd-radius-lg)] border border-dashed border-[var(--cd-color-border-strong)] bg-white p-8 text-center">
        <div className="text-base font-semibold text-slate-900">还没有客户方案草稿</div>
        <p className="mx-auto mt-2 max-w-xl text-sm leading-6 text-slate-500">
          请先从业务智能输入客户需求，让系统生成真实候选项目，再选择 1–5 个项目生成方案。
        </p>
        <Link href="/intelligence" className="mt-5 inline-flex h-9 items-center gap-1.5 rounded-[var(--cd-radius-md)] bg-[var(--cd-color-brand)] px-4 text-sm font-medium text-white">
          返回业务智能 <ArrowRight size={14} aria-hidden="true" />
        </Link>
      </div>
    </div>
  );
}

export function ProposalWorkspace() {
  const router = useRouter();
  const { session, status } = useAppSession();
  React.useEffect(() => {
    if (status === 'unauthenticated') router.replace('/login');
  }, [router, status]);

  if (status !== 'authenticated' || !session) return <ProposalLoadingShell />;
  if (!isIntelligencePreviewEnabled(session.role)) {
    return (
      <WorkspaceShell header={<AppHeader title="客户方案" homeHref="/intelligence" />}>
        <div className="mx-auto max-w-3xl px-6 py-12 text-sm text-slate-500">当前账号未开放业务智能试用功能。</div>
      </WorkspaceShell>
    );
  }
  const scope = getProposalDraftScope(session);
  if (!scope) return <EmptyProposalShell />;
  return <ScopedProposalWorkspace key={scope} scope={scope} session={session} />;
}

function ProposalLoadingShell() {
  return (
    <WorkspaceShell header={<AppHeader title="客户方案" homeHref="/intelligence" />}>
      <div className="flex h-full items-center justify-center"><LoadingState rows={0} label="正在读取客户方案" /></div>
    </WorkspaceShell>
  );
}

function EmptyProposalShell() {
  return <WorkspaceShell header={<AppHeader title="客户方案" homeHref="/intelligence" />}><EmptyProposal /></WorkspaceShell>;
}

function ScopedProposalWorkspace({ scope, session }: { scope: ProposalDraftScope; session: AuthSessionResult }) {
  const router = useRouter();
  const [draft, setDraft] = React.useState<ProposalDraft | null>(null);
  const [draftReady, setDraftReady] = React.useState(false);
  const [clientName, setClientName] = React.useState('');
  const [read, setRead] = React.useState<CandidateRead | null>(null);

  React.useEffect(() => {
    const sync = () => {
      const next = readProposalDraft(scope);
      setDraft(next);
      setClientName(next?.clientName || '');
      setDraftReady(true);
    };
    sync();
    window.addEventListener(PROPOSAL_DRAFT_EVENT, sync);
    return () => window.removeEventListener(PROPOSAL_DRAFT_EVENT, sync);
  }, [scope]);

  const idsKey = draft?.items.length ? JSON.stringify([...new Set(draft.items.map(item => item.buildingId))].sort()) : '';
  // Presentation-only draft changes do not invalidate facts. Account, role,
  // token and simulated scope changes must never reuse a previous response.
  const readKey = idsKey && session.session.access_token
    ? JSON.stringify([session.session.access_token, idsKey]) : '';
  const currentRead = read?.key === readKey ? read : null;
  const loading = Boolean(readKey && !currentRead);
  const error = currentRead?.error ?? null;
  const candidates = draft?.items.flatMap(item => {
    const candidate = currentRead?.values.get(item.buildingId);
    return candidate ? [{ ...candidate, name: candidate.name || item.buildingName }] : [];
  }) ?? [];

  React.useEffect(() => {
    if (!readKey) return;
    const controller = new AbortController();
    void (async () => {
      const ids = JSON.parse(idsKey) as string[];
      const [buildingResult, metricResult, brochureResult] = await Promise.all([
        supabase.from('buildings')
          .select('id,name,grade,submarket,district')
          .eq('tracking_scope', 'tracked')
          .in('id', ids).abortSignal(controller.signal),
        supabase.from('building_metrics')
          .select('building_id,record_year,record_quarter,created_at,net_effective_rent,asking_rent,vacancy_rate,management_fee,total_area')
          .in('building_id', ids)
          .order('record_year', { ascending: false })
          .order('record_quarter', { ascending: false })
          .order('created_at', { ascending: false }).abortSignal(controller.signal),
        supabase.from('building_brochure_data')
          .select('building_id,address,developer,metro_access,standard_floor_area,property_management,completion_date,leed_certification,well_certification,green_building_standard,created_at')
          .in('building_id', ids)
          .order('created_at', { ascending: false }).abortSignal(controller.signal),
      ]);
      if (controller.signal.aborted) return;

      const firstError = buildingResult.error || metricResult.error || brochureResult.error;
      if (firstError) {
        setRead({ key: readKey, values: new Map(), error: firstError.message || '候选方案数据读取失败' });
        return;
      }

      const metrics = new Map<string, Record<string, unknown>>();
      for (const raw of metricResult.data || []) {
        if (raw.building_id && !metrics.has(raw.building_id)) metrics.set(raw.building_id, raw as Record<string, unknown>);
      }
      const brochures = new Map<string, Record<string, unknown>>();
      for (const raw of brochureResult.data || []) {
        if (raw.building_id && !brochures.has(raw.building_id)) brochures.set(raw.building_id, raw as Record<string, unknown>);
      }
      const loaded = new Map<string, LoadedCandidate>();
      for (const building of buildingResult.data || []) {
        const metric = metrics.get(building.id) || null;
        const brochure = brochures.get(building.id) || null;
        const year = finite(metric?.record_year);
        const quarter = finite(metric?.record_quarter);
        loaded.set(building.id, {
          id: building.id,
          name: building.name || '',
          grade: building.grade || '',
          submarket: building.submarket || '',
          district: building.district || '',
          metricPeriod: year !== null && quarter !== null ? `${year} Q${quarter}` : null,
          metrics: {
            net_effective_rent: finite(metric?.net_effective_rent),
            asking_rent: finite(metric?.asking_rent),
            vacancy_rate: finite(metric?.vacancy_rate),
            management_fee: finite(metric?.management_fee),
            total_area: finite(metric?.total_area),
          },
          brochure,
          address: brochure?.address ? String(brochure.address) : null,
          developer: brochure?.developer ? String(brochure.developer) : null,
          metroAccess: brochure?.metro_access ? String(brochure.metro_access) : null,
          standardFloorArea: finite(brochure?.standard_floor_area),
          propertyManagement: brochure?.property_management ? String(brochure.property_management) : null,
          completionDate: brochure?.completion_date ? String(brochure.completion_date).slice(0, 10) : null,
          leedCertification: brochure?.leed_certification ? String(brochure.leed_certification) : null,
          wellCertification: brochure?.well_certification ? String(brochure.well_certification) : null,
          greenBuildingStandard: brochure?.green_building_standard ? String(brochure.green_building_standard) : null,
        });
      }
      setRead({ key: readKey, values: loaded, error: null });
    })().catch(() => {
      if (!controller.signal.aborted) setRead({ key: readKey, values: new Map(), error: '候选方案数据读取失败' });
    });

    return () => controller.abort();
  }, [idsKey, readKey]);

  if (!draftReady) return <ProposalLoadingShell />;
  if (!draft) return <EmptyProposalShell />;

  const appliedCapabilitySet = new Set(draft.requirement.appliedCapabilities);
  const evaluationCapabilitySet = new Set(draft.requirement.evaluationCapabilities);
  const scoringCapabilities = draft.requirement.capabilities.filter(item => evaluationCapabilitySet.has(item.key));
  const scored = candidates.map(candidate => ({
    candidate,
    score: scoreProposalCandidate(draft.requirement.parsed, scoringCapabilities, candidate),
  }));

  const excludedCapabilities = draft.requirement.capabilities.filter(item => !evaluationCapabilitySet.has(item.key));
  const selectedCount = draft.items.length;
  const useAskingRent = draft.requirement.parsed.rent.basis === 'asking';

  return (
    <WorkspaceShell
      className="min-h-screen bg-[var(--cd-color-canvas)] print:bg-white"
      header={<div className="print:hidden"><AppHeader title="客户方案" homeHref="/intelligence" status={<Badge tone="brand">候选方案</Badge>} /></div>}
    >
      <main className="mx-auto w-full max-w-[1120px] px-4 py-6 sm:px-6 lg:px-8 print:max-w-none print:px-0 print:py-0">
        <div className="mb-5 flex flex-wrap items-start justify-between gap-3 print:hidden">
          <div>
            <button type="button" onClick={() => { if (window.history.length > 1) router.back(); else router.push('/intelligence'); }} className="inline-flex items-center gap-1 text-xs font-medium text-slate-500 transition hover:text-[var(--cd-color-brand)]">
              <ArrowLeft size={13} aria-hidden="true" /> 返回业务智能
            </button>
            <h1 className="mt-2 text-xl font-semibold text-slate-900">客户候选方案</h1>
            <p className="mt-1 text-sm text-slate-500">系统先生成候选项目，业务人员审核候选和顺序后输出。匹配评分只使用现有可验证字段；未接入的实时销控信息不会参与自动判断。</p>
          </div>
          <Button type="button" variant="secondary" onClick={() => {
            logAction(session.user?.email, 'EXPORT_REPORT', {
              report_name: clientName ? `客户候选方案 · ${clientName}` : '客户候选方案',
              report_type: 'intelligence_proposal',
              candidate_count: selectedCount,
              export_method: 'browser_print_pdf',
              target_name: clientName ? `客户候选方案 · ${clientName}` : '客户候选方案',
            });
            window.print();
          }} disabled={loading || scored.length === 0 || Boolean(error)}>
            <FileDown size={14} aria-hidden="true" /> 打印 / 导出 PDF
          </Button>
        </div>

        <section className="rounded-[var(--cd-radius-lg)] border border-[var(--cd-color-border)] bg-white p-5 print:border-0 print:p-0">
          <div className="flex items-start justify-between gap-4 border-b border-slate-200 pb-5">
            <div className="flex items-center gap-3">
              <div className="relative h-9 w-[66px] overflow-hidden rounded-[var(--cd-radius-sm)] bg-[var(--cd-color-brand)]">
                <Image src={COLLIERS_LOGO_DATA_URI} alt="Colliers 高力国际" width={592} height={337} className="absolute left-1/2 top-1/2 h-[39px] w-auto max-w-none -translate-x-1/2 -translate-y-1/2" />
              </div>
              <div>
                <div className="text-sm font-semibold text-slate-900">北京办公室选址建议</div>
                <div className="mt-0.5 text-[11px] text-slate-400">业务智能试用版 · 数据来自当前内部平台</div>
              </div>
            </div>
            <div suppressHydrationWarning className="text-right text-[11px] text-slate-400">{new Date().toLocaleDateString('zh-CN')}</div>
          </div>

          <div className="grid gap-5 border-b border-slate-200 py-5 md:grid-cols-[220px_minmax(0,1fr)]">
            <div className="print:hidden">
              <label className="text-[11px] font-medium text-slate-500">客户 / 项目名称</label>
              <input
                value={clientName}
                onChange={event => setClientName(event.target.value)}
                onBlur={() => { const next = setProposalClientName(scope, clientName); if (next) setDraft(next); }}
                maxLength={80}
                placeholder="例如：XX科技有限公司"
                className="mt-1.5 h-9 w-full rounded-[var(--cd-radius-md)] border border-slate-200 px-3 text-sm outline-none focus:border-[var(--cd-color-brand)]"
              />
            </div>
            <div className="hidden print:block">
              <div className="text-[10px] text-slate-400">客户</div>
              <div className="mt-1 text-base font-semibold text-slate-900">{clientName || '客户项目'}</div>
            </div>

            <div>
              <div className="text-[11px] font-medium uppercase tracking-wide text-slate-400">客户需求</div>
              <div className="mt-2 flex flex-wrap gap-2">
                {draft.requirement.capabilities.map(item => {
                  const evaluated = evaluationCapabilitySet.has(item.key);
                  const applied = appliedCapabilitySet.has(item.key);
                  const tone = evaluated
                    ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                    : item.status === 'partial'
                      ? 'border-amber-200 bg-amber-50 text-amber-700'
                      : 'border-slate-200 bg-slate-50 text-slate-500';
                  return (
                    <span key={item.key} className={`rounded-full border px-2.5 py-1 text-[11px] ${tone}`}>
                      {item.label}：{item.value}{applied ? ' · 地图已执行' : ''}
                    </span>
                  );
                })}
              </div>
              {excludedCapabilities.length > 0 ? (
                <p className="mt-2 text-[11px] leading-5 text-slate-400">绿色条件参与规则评估；黄色或灰色条件只保留为人工核验事项。面积、入住时间等缺少实时事实的数据不会进入匹配分。</p>
              ) : null}
            </div>
          </div>

          {error ? <div className="my-5 rounded-md border border-red-100 bg-red-50 px-3 py-2 text-sm text-red-600">{error}</div> : null}
          {loading ? <div className="py-12"><LoadingState rows={3} label="正在读取真实楼宇数据" /></div> : null}

          {!loading && selectedCount === 0 ? (
            <div className="py-12 text-center text-sm text-slate-500">当前方案没有候选项目，请返回业务智能从推荐结果中选择楼宇。</div>
          ) : null}

          {!loading && scored.length > 0 ? (
            <div className="divide-y divide-slate-200">
              {scored.map(({ candidate, score }, index) => {
                const displayRent = useAskingRent ? candidate.metrics.asking_rent : candidate.metrics.net_effective_rent;
                return (
                  <article key={candidate.id} className="py-5 first:pt-5 print:break-inside-avoid">
                    <div className="flex flex-wrap items-start justify-between gap-4">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[var(--cd-color-brand)] text-[10px] font-semibold text-white">{index + 1}</span>
                          <h2 className="truncate text-base font-semibold text-slate-900">{candidate.name}</h2>
                          <Badge tone="neutral">{formatGrade(candidate.grade)}</Badge>
                        </div>
                        <div className="mt-1.5 text-xs text-slate-500">{candidate.district || '—'} · {candidate.submarket || '—'}{candidate.address ? ` · ${candidate.address}` : ''}</div>
                      </div>
                      <div className="flex items-start gap-5">
                        <div className="text-right">
                          <div className="text-[10px] text-slate-400">需求匹配</div>
                          <div className="mt-0.5 text-lg font-semibold tabular-nums text-[var(--cd-color-brand)]">{score.score === null ? '—' : `${score.score}`}{score.score === null ? '' : <span className="text-[10px] font-normal text-slate-400"> /100</span>}</div>
                        </div>
                        <div className="text-right">
                          <div className="text-[10px] text-slate-400">数据完整度</div>
                          <div className="mt-0.5 text-lg font-semibold tabular-nums text-slate-700">{score.dataConfidence}<span className="text-[10px] font-normal text-slate-400">%</span></div>
                        </div>
                      </div>
                    </div>

                    <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
                      <div className="rounded-md bg-slate-50 p-3">
                        <div className="text-[10px] text-slate-400">{useAskingRent ? '报价租金' : '净有效租金'}</div>
                        <div className="mt-1 text-sm font-semibold text-slate-900">¥{formatNumber(displayRent)}</div>
                        <div className="text-[10px] text-slate-400">元/㎡/月 · {candidate.metricPeriod || '无数据期'}</div>
                      </div>
                      <div className="rounded-md bg-slate-50 p-3">
                        <div className="text-[10px] text-slate-400">空置率</div>
                        <div className="mt-1 text-sm font-semibold text-slate-900">{candidate.metrics.vacancy_rate === null ? '—' : `${(candidate.metrics.vacancy_rate * 100).toFixed(1)}%`}</div>
                        <div className="text-[10px] text-slate-400">市场指标，不等于实时销控</div>
                      </div>
                      <div className="rounded-md bg-slate-50 p-3">
                        <div className="text-[10px] text-slate-400">标准层面积</div>
                        <div className="mt-1 text-sm font-semibold text-slate-900">{formatNumber(candidate.standardFloorArea)}㎡</div>
                        <div className="text-[10px] text-slate-400">楼书字段，不代表当前可租单元</div>
                      </div>
                      <div className="rounded-md bg-slate-50 p-3">
                        <div className="text-[10px] text-slate-400">物业费</div>
                        <div className="mt-1 text-sm font-semibold text-slate-900">¥{formatNumber(candidate.metrics.management_fee, 1)}</div>
                        <div className="text-[10px] text-slate-400">元/㎡/月</div>
                      </div>
                    </div>

                    <div className="mt-4 grid gap-4 md:grid-cols-2">
                      <div>
                        <div className="text-[11px] font-medium text-slate-500">可验证匹配条件</div>
                        <div className="mt-2 space-y-1.5">
                          {score.checks.length ? score.checks.map(check => (
                            <div key={check.key} className="flex items-start gap-2 text-[11px] leading-5 text-slate-600">
                              <span className={check.passed ? 'text-emerald-600' : 'text-red-500'}>{check.passed ? '✓' : '×'}</span>
                              <span><strong className="font-medium text-slate-700">{check.label}</strong> · {check.detail}</span>
                            </div>
                          )) : <div className="text-[11px] text-slate-400">当前需求没有可用于规则评分的正式字段。</div>}
                        </div>
                      </div>
                      <div>
                        <div className="text-[11px] font-medium text-slate-500">项目事实摘要</div>
                        <div className="mt-2 space-y-1.5 text-[11px] leading-5 text-slate-600">
                          {score.notes.length ? score.notes.map(note => <div key={note}>• {note}</div>) : <div className="text-slate-400">暂无足够字段生成摘要。</div>}
                        </div>
                      </div>
                    </div>

                    <div className="mt-4 flex flex-wrap gap-x-5 gap-y-1 text-[10px] text-slate-400">
                      <span>开发商：{candidate.developer || '暂无楼书数据'}</span>
                      <span>物业：{candidate.propertyManagement || '暂无楼书数据'}</span>
                      <span>地铁：{candidate.metroAccess || '暂无楼书数据'}</span>
                      <span>LEED：{candidate.leedCertification || '暂无楼书数据'}</span>
                      <span>WELL：{candidate.wellCertification || '暂无楼书数据'}</span>
                    </div>

                    <div className="mt-4 flex items-center justify-end gap-1.5 print:hidden">
                      <button type="button" disabled={index === 0} onClick={() => setDraft(moveProposalCandidate(scope, candidate.id, -1))} className="flex h-8 items-center gap-1 rounded-md border border-slate-200 px-2.5 text-[11px] text-slate-500 disabled:opacity-30"><ArrowUp size={12} />上移</button>
                      <button type="button" disabled={index === scored.length - 1} onClick={() => setDraft(moveProposalCandidate(scope, candidate.id, 1))} className="flex h-8 items-center gap-1 rounded-md border border-slate-200 px-2.5 text-[11px] text-slate-500 disabled:opacity-30"><ArrowDown size={12} />下移</button>
                      <button type="button" onClick={() => setDraft(removeProposalCandidate(scope, candidate.id))} className="flex h-8 items-center gap-1 rounded-md border border-red-100 px-2.5 text-[11px] text-red-500"><Trash2 size={12} />移除</button>
                    </div>
                  </article>
                );
              })}
            </div>
          ) : null}

          <footer className="border-t border-slate-200 pt-4 text-[10px] leading-5 text-slate-400 print:mt-6">
            本方案由业务智能试用版生成。租金、空置率等市场指标以系统最新季度数据为准；当前尚未接入正式实时销控与可入住日期，因此不对具体可租单元、面积或入住时间作事实承诺。最终对客版本应由业务人员人工确认。
          </footer>
        </section>
      </main>
    </WorkspaceShell>
  );
}
