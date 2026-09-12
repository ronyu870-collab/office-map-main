'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  AlertTriangle,
  ArrowRight,
  Building2,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
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
import type {
  RecommendationResponse,
  RecommendedBuilding,
} from '@/src/lib/intelligence/recommendationEngine';
import { beginProposalDraft, setProposalCandidates } from '@/src/lib/intelligence/proposalDraft';
import { recommendIntelligenceBuildings } from '@/src/services/intelligenceApi';

const EXAMPLES = [
  '望京或酒仙桥，800–1200㎡，预算7元以内，11月入住，优先甲级项目、地铁便利',
  'CBD，预算9元以内，只考虑甲级写字楼，地铁方便，优先LEED认证',
  '中关村，500–800㎡，控制成本，优先交通便利和成熟物业管理',
];

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

function RecommendationCard({
  building,
  rank,
  selected,
  aiPreselected,
  expanded,
  onToggleSelected,
  onToggleExpanded,
}: {
  building: RecommendedBuilding;
  rank: number;
  selected: boolean;
  aiPreselected: boolean;
  expanded: boolean;
  onToggleSelected: () => void;
  onToggleExpanded: () => void;
}) {
  const visibleReasons = expanded ? building.reasons : building.reasons.slice(0, 2);
  return (
    <article className={`rounded-[var(--cd-radius-lg)] border bg-white transition ${selected ? 'border-[color:rgb(0_62_126_/_0.35)] shadow-[0_4px_18px_rgb(15_23_42_/_0.05)]' : 'border-[var(--cd-color-border)]'}`}>
      <div className="p-4 sm:p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold ${rank <= 3 ? 'bg-[var(--cd-color-brand)] text-white' : 'bg-slate-100 text-slate-600'}`}>{rank}</span>
              <h3 className="max-w-[520px] truncate text-[15px] font-semibold text-slate-900">{building.name}</h3>
              <Badge tone="neutral">{formatGrade(building.grade)}</Badge>
              {rank <= 5 ? <Badge tone="brand">AI 推荐 #{rank}</Badge> : null}
            </div>
            <div className="mt-1.5 text-xs text-slate-500">
              {building.district || '—'} · {building.submarket || '—'}
              {building.brochure?.address ? ` · ${building.brochure.address}` : ''}
            </div>
          </div>
          <div className="flex items-start gap-3">
            <div className="text-right">
              <div className="text-[10px] text-slate-400">综合匹配</div>
              {building.score === null ? (
                <div className="mt-1 text-sm font-semibold text-slate-600">符合硬条件</div>
              ) : (
                <div className="mt-0.5 text-2xl font-semibold tabular-nums text-[var(--cd-color-brand)]">{building.score}<span className="text-[10px] font-normal text-slate-400"> /100</span></div>
              )}
              <div className="mt-0.5 text-[10px] text-slate-400">数据完整度 {building.dataCompleteness}%</div>
            </div>
            <button
              type="button"
              onClick={onToggleSelected}
              aria-pressed={selected}
              className={`inline-flex h-8 items-center gap-1 rounded-[var(--cd-radius-md)] border px-2.5 text-xs font-medium transition ${selected ? 'border-[var(--cd-color-brand)] bg-[var(--cd-color-brand)] text-white' : 'border-slate-200 bg-white text-slate-600 hover:border-[var(--cd-color-brand)] hover:text-[var(--cd-color-brand)]'}`}
            >
              {selected ? <Check size={13} aria-hidden="true" /> : null}
              {selected ? (aiPreselected ? 'AI 预选' : '已确认') : '加入方案'}
            </button>
          </div>
        </div>

        <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
          <div className="rounded-md bg-slate-50 p-3">
            <div className="text-[10px] text-slate-400">租金</div>
            <div className="mt-1 text-sm font-semibold text-slate-900">{building.rentDaily === null ? '—' : `¥${building.rentDaily.toFixed(1)}`}</div>
            <div className="text-[10px] text-slate-400">元/㎡/天 · {building.rentBasisLabel || '—'}</div>
          </div>
          <div className="rounded-md bg-slate-50 p-3">
            <div className="text-[10px] text-slate-400">地铁</div>
            <div className="mt-1 line-clamp-1 text-sm font-semibold text-slate-900">{building.brochure?.metroAccess || '—'}</div>
            <div className="text-[10px] text-slate-400">楼书通达信息</div>
          </div>
          <div className="rounded-md bg-slate-50 p-3">
            <div className="text-[10px] text-slate-400">标准层面积</div>
            <div className="mt-1 text-sm font-semibold text-slate-900">{building.brochure?.standardFloorArea == null ? '—' : `${building.brochure.standardFloorArea.toLocaleString('zh-CN')}㎡`}</div>
            <div className="text-[10px] text-slate-400">非实时可租面积</div>
          </div>
          <div className="rounded-md bg-slate-50 p-3">
            <div className="text-[10px] text-slate-400">空置率</div>
            <div className="mt-1 text-sm font-semibold text-slate-900">{formatVacancy(building.metrics.vacancyRate)}</div>
            <div className="text-[10px] text-slate-400">市场指标 · {building.metricPeriod || '—'}</div>
          </div>
        </div>

        <div className="mt-4">
          <div className="text-[11px] font-semibold text-slate-600">核心推荐理由</div>
          <div className="mt-2 grid gap-1.5 lg:grid-cols-2">
            {visibleReasons.length > 0 ? visibleReasons.map(reason => (
              <div key={reason} className="flex items-start gap-2 text-xs leading-5 text-slate-600">
                <CheckCircle2 size={13} className="mt-0.5 shrink-0 text-emerald-600" aria-hidden="true" />
                <span>{reason}</span>
              </div>
            )) : <div className="text-xs text-slate-400">当前没有额外排序偏好，项目主要因满足硬条件进入候选。</div>}
          </div>
        </div>

        {expanded ? (
          <div className="mt-4 grid gap-4 border-t border-slate-100 pt-4 lg:grid-cols-2">
            <div>
              <div className="text-[11px] font-semibold text-slate-600">评分构成</div>
              <div className="mt-2 space-y-2">
                {building.scoreBreakdown.length > 0 ? building.scoreBreakdown.map(factor => (
                  <div key={factor.key} className="rounded-md bg-slate-50 px-3 py-2">
                    <div className="flex items-center justify-between gap-3 text-xs">
                      <span className="font-medium text-slate-700">{factor.label}</span>
                      <span className="tabular-nums text-slate-500">{Math.round(factor.score)} / {factor.max}</span>
                    </div>
                    <div className="mt-1 text-[11px] leading-4 text-slate-400">{factor.detail}</div>
                  </div>
                )) : <div className="text-xs text-slate-400">没有额外排序因子；仅按硬条件筛选和数据覆盖排序。</div>}
              </div>
            </div>
            <div>
              <div className="text-[11px] font-semibold text-slate-600">需业务人员确认 / 权衡</div>
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
        ) : null}

        <div className="mt-4 flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 pt-3">
          <button type="button" onClick={onToggleExpanded} className="inline-flex items-center gap-1 text-xs font-medium text-slate-500 transition hover:text-[var(--cd-color-brand)]">
            {expanded ? <ChevronUp size={13} aria-hidden="true" /> : <ChevronDown size={13} aria-hidden="true" />}
            {expanded ? '收起分析' : '展开分析'}
          </button>
          <Link
            href={`/compare?buildingId=${encodeURIComponent(building.id)}&name=${encodeURIComponent(building.name)}`}
            className="text-xs font-medium text-[var(--cd-color-brand)] hover:underline"
          >
            查看详细参数 →
          </Link>
        </div>
      </div>
    </article>
  );
}

export function IntelligenceRecommendationWorkspace() {
  const router = useRouter();
  const { session, status } = useAppSession();
  const [requirement, setRequirement] = React.useState('');
  const [submittedRequirement, setSubmittedRequirement] = React.useState('');
  const [response, setResponse] = React.useState<RecommendationResponse | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [showAll, setShowAll] = React.useState(false);
  const [selectedIds, setSelectedIds] = React.useState<string[]>([]);
  const [aiPreselectedIds, setAiPreselectedIds] = React.useState<Set<string>>(new Set());
  const [expandedIds, setExpandedIds] = React.useState<Set<string>>(new Set());
  const [selectionMessage, setSelectionMessage] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (status === 'unauthenticated') router.replace('/login');
  }, [router, status]);

  const previewEnabled = isIntelligencePreviewEnabled(session?.role);
  const plan = response?.plan ?? null;
  const isDirty = Boolean(plan && requirement.trim() !== submittedRequirement);

  async function handleRecommend() {
    const accessToken = session?.session?.access_token;
    const input = requirement.trim();
    if (!accessToken || !input || loading) return;

    setLoading(true);
    setError(null);
    setSelectionMessage(null);
    try {
      const next = await recommendIntelligenceBuildings(input, accessToken);
      setResponse(next);
      setSubmittedRequirement(input);
      setShowAll(false);
      setExpandedIds(new Set());
      const initialSelection = next.plan.recommendations.slice(0, 5).map(item => item.id);
      setSelectedIds(initialSelection);
      setAiPreselectedIds(new Set(initialSelection));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '推荐生成失败，请稍后重试。');
    } finally {
      setLoading(false);
    }
  }

  if (status === 'loading' || !session) return <IntelligenceLoadingShell />;
  if (!previewEnabled) return <PreviewUnavailable />;

  const visible = plan?.recommendations.slice(0, showAll ? response?.meta.returnedCount ?? 5 : 5) ?? [];
  const mapHandoff = plan ? createIntelligenceMapHandoff(plan.effectiveResult) : null;
  const selectedBuildings = plan?.recommendations.filter(item => selectedIds.includes(item.id)) ?? [];

  function toggleSelected(buildingId: string) {
    setSelectionMessage(null);
    setAiPreselectedIds(previous => {
      const next = new Set(previous);
      next.delete(buildingId);
      return next;
    });
    setSelectedIds(previous => {
      if (previous.includes(buildingId)) return previous.filter(id => id !== buildingId);
      if (previous.length >= 5) {
        setSelectionMessage('客户方案最多保留 5 个项目；请先取消一个已选项目。');
        return previous;
      }
      return [...previous, buildingId];
    });
  }

  function toggleExpanded(buildingId: string) {
    setExpandedIds(previous => {
      const next = new Set(previous);
      if (next.has(buildingId)) next.delete(buildingId);
      else next.add(buildingId);
      return next;
    });
  }

  function prepareDraft() {
    if (!plan || !mapHandoff) return false;
    const draft = beginProposalDraft(plan.effectiveResult, mapHandoff.appliedCapabilities);
    if (!draft) {
      setError('浏览器会话存储不可用，暂时无法创建客户方案。');
      return false;
    }
    const seeded = setProposalCandidates(selectedBuildings.map(item => ({ buildingId: item.id, buildingName: item.name })));
    if (!seeded) {
      setError('无法写入推荐项目，请刷新页面后重试。');
      return false;
    }
    return true;
  }

  return (
    <WorkspaceShell
      className="h-screen h-[100dvh] overflow-hidden bg-[var(--cd-color-canvas)]"
      header={<AppHeader title="业务智能 Intelligence" homeHref="/" status={<Badge tone="brand">Pilot Preview</Badge>} />}
    >
      <main className="h-full overflow-y-auto overscroll-contain pb-8">
        <div className="mx-auto w-full max-w-[1180px] px-4 py-6 sm:px-6 lg:px-8">
          <section className="mb-5">
            <div className="flex items-center gap-2">
              <Sparkles size={18} className="text-[var(--cd-color-brand)]" aria-hidden="true" />
              <h1 className="text-xl font-semibold text-slate-900">AI 选址顾问</h1>
            </div>
            <p className="mt-1.5 max-w-3xl text-sm leading-6 text-slate-500">
              输入客户需求后，系统直接从内部真实数据中生成候选项目。AI 负责理解需求，内部数据负责事实，确定性规则负责筛选与排序，最终由业务人员判断。
            </p>
          </section>

          <section className="rounded-[var(--cd-radius-lg)] border border-[var(--cd-color-border-strong)] bg-white p-4 sm:p-5">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <Search size={16} className="text-[var(--cd-color-brand)]" aria-hidden="true" />
                <h2 className="text-[15px] font-semibold text-slate-900">客户需求</h2>
              </div>
              <Badge tone="brand">DeepSeek</Badge>
            </div>
            <textarea
              value={requirement}
              onChange={event => {
                setRequirement(event.target.value);
                setError(null);
              }}
              onKeyDown={event => {
                if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
                  event.preventDefault();
                  void handleRecommend();
                }
              }}
              rows={3}
              maxLength={1200}
              placeholder="例如：望京或酒仙桥，800–1200㎡，预算7元以内，11月入住，优先甲级项目、地铁便利。"
              className="mt-3 min-h-[92px] w-full resize-none rounded-[var(--cd-radius-md)] border border-slate-200 bg-white px-3 py-2.5 text-sm leading-6 text-slate-900 outline-none transition focus:border-[var(--cd-color-brand)] focus:ring-2 focus:ring-[color:rgb(0_62_126_/_0.08)]"
            />
            <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
              <div className="flex flex-wrap gap-1.5">
                {EXAMPLES.map((example, index) => (
                  <button
                    key={example}
                    type="button"
                    onClick={() => setRequirement(example)}
                    className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-[11px] text-slate-500 transition hover:border-blue-200 hover:text-blue-700"
                  >
                    示例 {index + 1}
                  </button>
                ))}
                <span className="self-center text-[10px] text-slate-400">⌘/Ctrl + Enter 快速推荐</span>
              </div>
              <Button type="button" variant="primary" disabled={!requirement.trim() || loading} onClick={() => void handleRecommend()}>
                {loading ? '正在理解、检索与排序…' : plan ? '重新推荐' : '开始推荐'} <ArrowRight size={14} aria-hidden="true" />
              </Button>
            </div>
            {isDirty ? (
              <div className="mt-3 rounded-md border border-blue-100 bg-blue-50 px-3 py-2 text-xs text-blue-700">
                需求已修改。下方结果仍基于上一轮需求，点击“重新推荐”后才会更新，不会因为编辑文字而丢失当前候选结果。
              </div>
            ) : null}
            {error ? <div className="mt-3 rounded-md border border-red-100 bg-red-50 px-3 py-2.5 text-sm text-red-600" role="alert">{error}</div> : null}
          </section>

          {loading ? (
            <section className="mt-5 rounded-[var(--cd-radius-lg)] border border-[var(--cd-color-border)] bg-white p-6">
              <LoadingState rows={4} label="AI 正在理解需求，并从真实楼宇数据中生成候选项目" />
            </section>
          ) : null}

          {plan && response ? (
            <section className="mt-5" aria-live="polite">
              <div className="rounded-[var(--cd-radius-lg)] border border-[var(--cd-color-border)] bg-white p-4 sm:p-5">
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div>
                    <div className="flex items-center gap-2">
                      <Building2 size={17} className="text-[var(--cd-color-brand)]" aria-hidden="true" />
                      <h2 className="text-base font-semibold text-slate-900">AI 推荐候选</h2>
                    </div>
                    <p className="mt-1.5 text-sm text-slate-500">
                      找到 <strong className="font-semibold text-slate-800">{plan.candidateCount}</strong> 个满足硬条件的项目。系统已预选排名前 {Math.min(5, plan.candidateCount)} 个，你可以逐项保留、取消或替换后生成客户方案。
                    </p>
                  </div>
                  <div className="text-right text-[11px] leading-5 text-slate-500">
                    <div>数据截至 {response.meta.latestMetricPeriod || '—'} · 覆盖 {response.meta.universeCount} 个真实项目</div>
                    <details className="mt-1 text-[10px] text-slate-400">
                      <summary className="cursor-pointer select-none hover:text-slate-600">查看技术信息</summary>
                      <div className="mt-1">规则 {response.meta.rankingVersion} · 模型 {plan.effectiveResult.meta.model}</div>
                    </details>
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
                    <div className="text-[11px] font-semibold text-slate-600">偏好条件 · 用于排序</div>
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {plan.preferenceCriteria.length ? plan.preferenceCriteria.map(item => <CriterionPill key={item}>{item}</CriterionPill>) : <span className="text-xs text-slate-400">未识别到额外偏好</span>}
                    </div>
                  </div>
                  <div className="rounded-md border border-amber-200 bg-amber-50/40 p-3">
                    <div className="text-[11px] font-semibold text-amber-700">待核验 · 不作为自动判断依据</div>
                    <div className="mt-2 space-y-1 text-[11px] leading-5 text-amber-700">
                      {plan.verificationRequired.length ? plan.verificationRequired.slice(0, 4).map(item => <div key={item}>• {item}</div>) : <div>当前没有额外待确认项</div>}
                    </div>
                  </div>
                </div>

                {plan.assumptions.length ? (
                  <div className="mt-3 rounded-md bg-blue-50 px-3 py-2 text-[11px] leading-5 text-blue-700">
                    <strong className="font-semibold">系统采用的默认口径：</strong> {plan.assumptions.join(' ')}
                  </div>
                ) : null}

                {plan.candidateCount === 0 ? (
                  <div className="mt-5 rounded-md border border-dashed border-slate-200 p-8 text-center">
                    <div className="text-sm font-semibold text-slate-800">当前没有项目同时满足硬条件</div>
                    <p className="mt-1 text-xs leading-5 text-slate-500">系统不会为了凑数把不满足条件的项目塞进结果。</p>
                    {plan.relaxationHints.length ? (
                      <div className="mx-auto mt-4 max-w-2xl space-y-1.5 text-left text-xs leading-5 text-amber-700">
                        {plan.relaxationHints.map(item => <div key={item} className="rounded-md bg-amber-50 px-3 py-2">建议：{item}</div>)}
                      </div>
                    ) : null}
                  </div>
                ) : null}
              </div>

              {selectionMessage ? <div className="mt-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700">{selectionMessage}</div> : null}

              {visible.length > 0 ? (
                <div className="mt-4 space-y-3">
                  {visible.map((building, index) => (
                    <RecommendationCard
                      key={building.id}
                      building={building}
                      rank={index + 1}
                      selected={selectedIds.includes(building.id)}
                      aiPreselected={selectedIds.includes(building.id) && aiPreselectedIds.has(building.id)}
                      expanded={expandedIds.has(building.id)}
                      onToggleSelected={() => toggleSelected(building.id)}
                      onToggleExpanded={() => toggleExpanded(building.id)}
                    />
                  ))}
                </div>
              ) : null}

              {plan.candidateCount > 5 && response.meta.returnedCount > 5 ? (
                <div className="mt-4 text-center">
                  <Button type="button" size="sm" variant="secondary" onClick={() => setShowAll(value => !value)}>
                    {showAll ? '收起候选' : `查看更多候选（已返回 ${response.meta.returnedCount} / 共 ${plan.candidateCount}）`}
                  </Button>
                </div>
              ) : null}
            </section>
          ) : null}

          {!plan ? (
            <section className="mt-5 rounded-[var(--cd-radius-lg)] border border-dashed border-slate-200 bg-white/70 p-5 text-sm leading-6 text-slate-500">
              <div className="flex items-start gap-2">
                <AlertTriangle size={15} className="mt-1 shrink-0 text-amber-500" aria-hidden="true" />
                <p>当前尚未接入正式实时销控，因此面积和明确入住月份会保留为业务核验项；系统不会把标准层面积、季度空置率等字段冒充实时可租房源。</p>
              </div>
            </section>
          ) : null}
        </div>

        {plan && plan.candidateCount > 0 ? (
          <div className="mx-auto mt-5 w-full max-w-[1180px] px-4 pb-6 sm:px-6 lg:px-8">
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-[var(--cd-radius-lg)] border border-slate-200 bg-white px-4 py-3 sm:px-5">
              <div>
                <div className="text-sm font-semibold text-slate-900">方案候选 {selectedIds.length} / 5</div>
                <div className="mt-0.5 text-[11px] text-slate-400">系统默认预选前 5 名；你可以取消或替换，确认后再核验地图或生成方案。</div>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  disabled={!mapHandoff || mapHandoff.appliedCapabilities.length === 0}
                  onClick={() => {
                    if (!mapHandoff || !prepareDraft()) return;
                    router.push(mapHandoff.href);
                  }}
                >
                  <MapPinned size={13} aria-hidden="true" /> 在地图核验
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="primary"
                  disabled={selectedIds.length === 0 || !mapHandoff}
                  onClick={() => {
                    if (!prepareDraft()) return;
                    router.push('/intelligence/proposal');
                  }}
                >
                  <FileChartColumn size={13} aria-hidden="true" /> 生成方案（{selectedIds.length}个）
                </Button>
              </div>
            </div>
          </div>
        ) : null}
      </main>
    </WorkspaceShell>
  );
}
