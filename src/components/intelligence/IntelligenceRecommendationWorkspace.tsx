'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import {
  AlertTriangle,
  ArrowRight,
  Building2,
  CheckCircle2,
  FileChartColumn,
  MapPinned,
  Search,
  Sparkles,
} from 'lucide-react';

import { createIntelligenceMapHandoff } from '@/src/app/map/model/intelligenceMapHandoff';
import { WorkspaceShell } from '@/src/components/layout';
import { useAppSession } from '@/src/components/SessionProvider';
import { AppHeader, Badge, Button, LoadingState } from '@/src/components/ui';
import { isIntelligencePreviewEnabled } from '@/src/config/intelligencePreview';
import {
  buildRecommendationPlan,
  type RecommendationPlan,
  type RecommendedBuilding,
} from '@/src/lib/intelligence/recommendationEngine';
import { beginProposalDraft, setProposalCandidates } from '@/src/lib/intelligence/proposalDraft';
import { parseIntelligenceRequirement } from '@/src/services/intelligenceApi';
import { loadIntelligenceRecommendationUniverse } from '@/src/services/intelligenceRecommendations';

function formatGrade(grade: string) {
  const normalized = grade.toUpperCase();
  if (normalized.includes('BP')) return '产业园区';
  if (normalized.includes('P')) return '超甲级';
  if (normalized.includes('A')) return '甲级';
  if (normalized.includes('B')) return '乙级';
  return grade || '—';
}

function formatVacancy(value: number | null) {
  if (value === null) return '—';
  return `${(value * 100).toFixed(1)}%`;
}

function IntelligenceLoadingShell() {
  return (
    <WorkspaceShell header={<AppHeader title="业务智能 Intelligence" homeHref="/" />}>
      <div className="flex h-full items-center justify-center px-6">
        <LoadingState rows={0} label="正在加载业务智能工作台" className="w-full max-w-sm" />
      </div>
    </WorkspaceShell>
  );
}

function PreviewUnavailable() {
  return (
    <WorkspaceShell header={<AppHeader title="业务智能 Intelligence" homeHref="/" />}>
      <div className="mx-auto flex min-h-[65vh] w-full max-w-[780px] items-center px-5 py-10">
        <div className="w-full rounded-[var(--cd-radius-lg)] border border-[var(--cd-color-border)] bg-white p-7">
          <Badge tone="brand">Pilot Preview</Badge>
          <h1 className="mt-4 text-lg font-semibold text-slate-900">业务智能正在内部验证</h1>
          <p className="mt-2 text-sm leading-6 text-slate-500">当前账号暂未开放该预览；现有地图与数据填报工作流不受影响。</p>
        </div>
      </div>
    </WorkspaceShell>
  );
}

function CriterionPill({ children, tone = 'neutral' }: { children: React.ReactNode; tone?: 'neutral' | 'brand' | 'warning' }) {
  const className = tone === 'brand'
    ? 'border-blue-100 bg-blue-50 text-blue-700'
    : tone === 'warning'
      ? 'border-amber-200 bg-amber-50 text-amber-700'
      : 'border-slate-200 bg-slate-50 text-slate-600';
  return <span className={`rounded-full border px-2.5 py-1 text-[11px] ${className}`}>{children}</span>;
}

function RecommendationCard({ building, rank }: { building: RecommendedBuilding; rank: number }) {
  return (
    <article className="rounded-[var(--cd-radius-lg)] border border-[var(--cd-color-border)] bg-white p-4 sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[var(--cd-color-brand)] text-xs font-semibold text-white">{rank}</span>
            <h3 className="truncate text-[15px] font-semibold text-slate-900">{building.name}</h3>
            <Badge tone="neutral">{formatGrade(building.grade)}</Badge>
          </div>
          <div className="mt-1.5 text-xs text-slate-500">
            {building.district || '—'} · {building.submarket || '—'}
            {building.brochure?.address ? ` · ${building.brochure.address}` : ''}
          </div>
        </div>
        <div className="text-right">
          <div className="text-[10px] text-slate-400">推荐度</div>
          <div className="mt-0.5 text-2xl font-semibold tabular-nums text-[var(--cd-color-brand)]">{building.score}<span className="text-[10px] font-normal text-slate-400"> /100</span></div>
        </div>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <div className="rounded-md bg-slate-50 p-3">
          <div className="text-[10px] text-slate-400">租金口径</div>
          <div className="mt-1 text-sm font-semibold text-slate-900">{building.rentDaily === null ? '—' : `¥${building.rentDaily.toFixed(1)}`}</div>
          <div className="text-[10px] text-slate-400">元/㎡/天 · {building.rentBasisLabel || '—'}</div>
        </div>
        <div className="rounded-md bg-slate-50 p-3">
          <div className="text-[10px] text-slate-400">空置率</div>
          <div className="mt-1 text-sm font-semibold text-slate-900">{formatVacancy(building.metrics.vacancyRate)}</div>
          <div className="text-[10px] text-slate-400">市场指标 · {building.metricPeriod || '无数据期'}</div>
        </div>
        <div className="rounded-md bg-slate-50 p-3">
          <div className="text-[10px] text-slate-400">标准层面积</div>
          <div className="mt-1 text-sm font-semibold text-slate-900">{building.brochure?.standardFloorArea == null ? '—' : `${building.brochure.standardFloorArea.toLocaleString('zh-CN')}㎡`}</div>
          <div className="text-[10px] text-slate-400">楼书字段，非实时可租面积</div>
        </div>
        <div className="rounded-md bg-slate-50 p-3">
          <div className="text-[10px] text-slate-400">数据完整度</div>
          <div className="mt-1 text-sm font-semibold text-slate-900">{building.dataCompleteness}%</div>
          <div className="text-[10px] text-slate-400">仅衡量已有字段覆盖</div>
        </div>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <div>
          <div className="text-[11px] font-semibold text-slate-600">为什么推荐</div>
          <div className="mt-2 space-y-1.5">
            {building.reasons.length > 0 ? building.reasons.map(reason => (
              <div key={reason} className="flex items-start gap-2 text-xs leading-5 text-slate-600">
                <CheckCircle2 size={13} className="mt-0.5 shrink-0 text-emerald-600" aria-hidden="true" />
                <span>{reason}</span>
              </div>
            )) : <div className="text-xs text-slate-400">当前没有足够的可验证字段生成推荐理由。</div>}
          </div>
        </div>
        <div>
          <div className="text-[11px] font-semibold text-slate-600">需要 Broker 确认</div>
          <div className="mt-2 space-y-1.5">
            {building.cautions.length > 0 ? building.cautions.map(caution => (
              <div key={caution} className="flex items-start gap-2 text-xs leading-5 text-slate-500">
                <AlertTriangle size={13} className="mt-0.5 shrink-0 text-amber-500" aria-hidden="true" />
                <span>{caution}</span>
              </div>
            )) : <div className="text-xs text-slate-400">当前没有额外待确认项。</div>}
          </div>
        </div>
      </div>
    </article>
  );
}

export function IntelligenceRecommendationWorkspace() {
  const router = useRouter();
  const { session, status } = useAppSession();
  const [requirement, setRequirement] = React.useState('');
  const [plan, setPlan] = React.useState<RecommendationPlan | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [showAll, setShowAll] = React.useState(false);

  React.useEffect(() => {
    if (status === 'unauthenticated') router.replace('/login');
  }, [router, status]);

  const previewEnabled = isIntelligencePreviewEnabled(session?.role);

  async function handleRecommend() {
    const accessToken = session?.session?.access_token;
    const input = requirement.trim();
    if (!accessToken || !input || loading) return;

    setLoading(true);
    setError(null);
    setPlan(null);
    setShowAll(false);
    try {
      const [result, universe] = await Promise.all([
        parseIntelligenceRequirement(input, accessToken),
        loadIntelligenceRecommendationUniverse(),
      ]);
      setPlan(buildRecommendationPlan(result, input, universe));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '推荐生成失败，请稍后重试。');
    } finally {
      setLoading(false);
    }
  }

  if (status === 'loading' || !session) return <IntelligenceLoadingShell />;
  if (!previewEnabled) return <PreviewUnavailable />;

  const topFive = plan?.recommendations.slice(0, 5) ?? [];
  const visible = plan?.recommendations.slice(0, showAll ? 20 : 5) ?? [];
  const mapHandoff = plan ? createIntelligenceMapHandoff(plan.effectiveResult) : null;

  function prepareDraft(seedTopFive: boolean) {
    if (!plan || !mapHandoff) return false;
    const draft = beginProposalDraft(plan.effectiveResult, mapHandoff.appliedCapabilities);
    if (!draft) {
      setError('浏览器会话存储不可用，暂时无法创建客户方案。');
      return false;
    }
    if (seedTopFive) {
      const seeded = setProposalCandidates(topFive.map(item => ({ buildingId: item.id, buildingName: item.name })));
      if (!seeded) {
        setError('无法写入推荐项目，请刷新页面后重试。');
        return false;
      }
    }
    return true;
  }

  return (
    <WorkspaceShell
      className="h-screen h-[100dvh] overflow-hidden bg-[var(--cd-color-canvas)]"
      header={<AppHeader title="业务智能 Intelligence" homeHref="/" status={<Badge tone="brand">AI Shortlist Pilot</Badge>} />}
    >
      <main className="h-full overflow-y-auto overscroll-contain">
        <div className="mx-auto w-full max-w-[1180px] px-4 py-6 sm:px-6 lg:px-8">
          <section className="mb-5">
            <div className="flex items-center gap-2">
              <Sparkles size={18} className="text-[var(--cd-color-brand)]" aria-hidden="true" />
              <h1 className="text-xl font-semibold text-slate-900">AI 选址顾问</h1>
            </div>
            <p className="mt-1.5 max-w-3xl text-sm leading-6 text-slate-500">
              直接描述客户需求。系统会用真实楼宇、季度指标与楼书数据检索并排序候选项目；无法由当前数据库验证的条件会明确标记给 Broker 二次确认。
            </p>
          </section>

          <section className="rounded-[var(--cd-radius-lg)] border border-[var(--cd-color-border-strong)] bg-white p-4 sm:p-5">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <Search size={16} className="text-[var(--cd-color-brand)]" aria-hidden="true" />
                <h2 className="text-[15px] font-semibold text-slate-900">今天要帮客户找什么样的办公室？</h2>
              </div>
              <Badge tone="brand">DeepSeek</Badge>
            </div>
            <div className="mt-3 flex flex-col gap-2 sm:flex-row">
              <textarea
                value={requirement}
                onChange={event => {
                  setRequirement(event.target.value);
                  setPlan(null);
                  setError(null);
                }}
                rows={3}
                maxLength={1200}
                placeholder="例如：望京或酒仙桥，800–1200㎡，预算7元以内，11月入住，优先甲级项目、地铁便利。"
                className="min-h-[92px] min-w-0 flex-1 resize-none rounded-[var(--cd-radius-md)] border border-slate-200 bg-white px-3 py-2.5 text-sm leading-6 text-slate-900 outline-none transition focus:border-[var(--cd-color-brand)] focus:ring-2 focus:ring-[color:rgb(0_62_126_/_0.08)]"
              />
              <Button type="button" variant="primary" disabled={!requirement.trim() || loading} onClick={() => void handleRecommend()} className="sm:self-end">
                {loading ? '正在检索与排序…' : '开始推荐'} <ArrowRight size={14} aria-hidden="true" />
              </Button>
            </div>
            {error ? <div className="mt-3 rounded-md border border-red-100 bg-red-50 px-3 py-2.5 text-sm text-red-600" role="alert">{error}</div> : null}
          </section>

          {loading ? (
            <section className="mt-5 rounded-[var(--cd-radius-lg)] border border-[var(--cd-color-border)] bg-white p-6">
              <LoadingState rows={4} label="AI 正在理解需求，并用真实数据生成候选项目" />
            </section>
          ) : null}

          {plan ? (
            <section className="mt-5" aria-live="polite">
              <div className="rounded-[var(--cd-radius-lg)] border border-[var(--cd-color-border)] bg-white p-4 sm:p-5">
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div>
                    <div className="flex items-center gap-2">
                      <Building2 size={17} className="text-[var(--cd-color-brand)]" aria-hidden="true" />
                      <h2 className="text-base font-semibold text-slate-900">AI 推荐结果</h2>
                    </div>
                    <p className="mt-1.5 text-sm text-slate-500">
                      找到 <strong className="font-semibold text-slate-800">{plan.candidateCount}</strong> 个满足当前硬条件的初步候选，优先推荐以下 {Math.min(5, plan.candidateCount)} 个项目。
                    </p>
                  </div>
                  <div className="text-right text-[11px] text-slate-400">
                    <div>模型：{plan.effectiveResult.meta.model}</div>
                    <div>{plan.effectiveResult.meta.durationMs.toLocaleString('zh-CN')} ms · 推荐排序由本地可解释规则完成</div>
                  </div>
                </div>

                <div className="mt-4 grid gap-3 lg:grid-cols-3">
                  <div className="rounded-md border border-slate-200 p-3">
                    <div className="text-[11px] font-semibold text-slate-600">硬条件 · 必须满足</div>
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {plan.hardCriteria.length ? plan.hardCriteria.map(item => <CriterionPill key={item} tone="brand">{item}</CriterionPill>) : <span className="text-xs text-slate-400">未识别到硬筛选条件</span>}
                    </div>
                  </div>
                  <div className="rounded-md border border-slate-200 p-3">
                    <div className="text-[11px] font-semibold text-slate-600">偏好 · 用于排序</div>
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {plan.preferenceCriteria.length ? plan.preferenceCriteria.map(item => <CriterionPill key={item}>{item}</CriterionPill>) : <span className="text-xs text-slate-400">未识别到额外偏好</span>}
                    </div>
                  </div>
                  <div className="rounded-md border border-amber-200 bg-amber-50/40 p-3">
                    <div className="text-[11px] font-semibold text-amber-700">待确认 · 不作事实承诺</div>
                    <div className="mt-2 space-y-1 text-[11px] leading-5 text-amber-700">
                      {plan.verificationRequired.length ? plan.verificationRequired.map(item => <div key={item}>• {item}</div>) : <div>当前没有额外待确认项</div>}
                    </div>
                  </div>
                </div>

                {plan.assumptions.length ? (
                  <div className="mt-3 rounded-md bg-blue-50 px-3 py-2 text-[11px] leading-5 text-blue-700">
                    <strong className="font-semibold">系统假设：</strong> {plan.assumptions.join(' ')}
                  </div>
                ) : null}

                {plan.candidateCount === 0 ? (
                  <div className="mt-5 rounded-md border border-dashed border-slate-200 p-8 text-center">
                    <div className="text-sm font-semibold text-slate-800">当前没有项目同时满足硬条件</div>
                    <p className="mt-1 text-xs leading-5 text-slate-500">可以放宽区域或预算后重新推荐。系统不会为了凑数把不满足硬条件的项目塞进结果。</p>
                  </div>
                ) : null}
              </div>

              {visible.length > 0 ? (
                <div className="mt-4 space-y-3">
                  {visible.map((building, index) => <RecommendationCard key={building.id} building={building} rank={index + 1} />)}
                </div>
              ) : null}

              {plan.candidateCount > 0 ? (
                <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-[var(--cd-radius-lg)] border border-[var(--cd-color-border)] bg-white p-4">
                  <div className="text-xs leading-5 text-slate-500">
                    AI 已完成检索和排序；地图用于空间核验，Proposal 用于 Broker 审核后输出客户方案。
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {plan.candidateCount > 5 ? (
                      <Button type="button" size="sm" variant="secondary" onClick={() => setShowAll(value => !value)}>
                        {showAll ? '收起候选' : `查看更多候选（共 ${plan.candidateCount}）`}
                      </Button>
                    ) : null}
                    <Button
                      type="button"
                      size="sm"
                      variant="secondary"
                      disabled={!mapHandoff || mapHandoff.appliedCapabilities.length === 0}
                      onClick={() => {
                        if (!mapHandoff || !prepareDraft(false)) return;
                        router.push(mapHandoff.href);
                      }}
                    >
                      <MapPinned size={13} aria-hidden="true" /> 在地图查看
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="primary"
                      disabled={topFive.length === 0 || !mapHandoff}
                      onClick={() => {
                        if (!prepareDraft(true)) return;
                        router.push('/intelligence/proposal');
                      }}
                    >
                      <FileChartColumn size={13} aria-hidden="true" /> 生成 Top {topFive.length} 客户方案
                    </Button>
                  </div>
                </div>
              ) : null}
            </section>
          ) : null}

          <section className="mt-5 rounded-[var(--cd-radius-lg)] border border-dashed border-slate-200 bg-white/70 p-4 text-xs leading-5 text-slate-500">
            <div className="flex items-start gap-2">
              <AlertTriangle size={14} className="mt-0.5 shrink-0 text-amber-500" aria-hidden="true" />
              <p>当前系统尚未接入正式实时销控，因此不会声称某栋楼当前一定存在指定面积、确定可在指定月份入住。推荐负责缩小搜索范围，最终对客事实仍由 Broker 核验。</p>
            </div>
          </section>
        </div>
      </main>
    </WorkspaceShell>
  );
}
