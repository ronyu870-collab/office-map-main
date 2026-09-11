'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  ArrowRight,
  BriefcaseBusiness,
  Building2,
  Database,
  FileChartColumn,
  FileText,
  Radar,
  Search,
  Sparkles,
} from 'lucide-react';

import { WorkspaceShell } from '@/src/components/layout';
import { createIntelligenceMapHandoff } from '@/src/app/map/model/intelligenceMapHandoff';
import { useAppSession } from '@/src/components/SessionProvider';
import { AppHeader, Badge, Button, LoadingState } from '@/src/components/ui';
import { isIntelligencePreviewEnabled } from '@/src/config/intelligencePreview';
import type { RequirementParseResult, RequirementSupportStatus } from '@/src/lib/intelligence/requirementSchema';
import { parseIntelligenceRequirement } from '@/src/services/intelligenceApi';
import { supabase } from '@/src/services/supabaseClient';

type IntelligenceSnapshot = {
  buildingCount: number | null;
  metricCount: number | null;
  leaseCount: number | null;
  leaseWithTermCount: number | null;
  brochureCount: number | null;
  futureSupplyCount: number | null;
  currentDataCount: number | null;
  latestMetricPeriod: string | null;
};

const EMPTY_SNAPSHOT: IntelligenceSnapshot = {
  buildingCount: null,
  metricCount: null,
  leaseCount: null,
  leaseWithTermCount: null,
  brochureCount: null,
  futureSupplyCount: null,
  currentDataCount: null,
  latestMetricPeriod: null,
};

const SUPPORT_PRESENTATION: Record<RequirementSupportStatus, { label: string; tone: 'success' | 'warning' | 'neutral' }> = {
  supported: { label: '可执行', tone: 'success' },
  partial: { label: '需确认', tone: 'warning' },
  unsupported: { label: '暂不参与筛选', tone: 'neutral' },
};

function formatCount(value: number | null): string {
  return value === null ? '—' : value.toLocaleString('zh-CN');
}

function IntelligenceLoadingShell() {
  return (
    <WorkspaceShell
      className="h-screen h-[100dvh] overflow-hidden"
      header={<AppHeader title="业务智能 Intelligence" homeHref="/" />}
    >
      <div className="flex h-full items-center justify-center px-6">
        <LoadingState rows={0} label="正在加载业务智能工作台" className="w-full max-w-sm" />
      </div>
    </WorkspaceShell>
  );
}

function PreviewUnavailable() {
  return (
    <WorkspaceShell
      className="h-screen h-[100dvh] overflow-hidden"
      header={<AppHeader title="业务智能 Intelligence" homeHref="/" />}
    >
      <div className="h-full overflow-y-auto">
        <div className="mx-auto flex min-h-full w-full max-w-[960px] items-center px-5 py-10 sm:px-8">
          <div className="w-full rounded-[var(--cd-radius-lg)] border border-[var(--cd-color-border)] bg-[var(--cd-color-surface)] p-6">
            <Badge tone="brand">Pilot Preview</Badge>
            <h1 className="mt-4 text-lg font-semibold text-[var(--cd-color-text-primary)]">业务智能正在内部验证</h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-[var(--cd-color-text-secondary)]">
              当前账号暂未开放该预览。现有地图、季度填报、租赁成交与研究资料库不受影响。
            </p>
            <Link
              href="/"
              className="mt-5 inline-flex h-9 items-center gap-1.5 rounded-[var(--cd-radius-md)] bg-[var(--cd-color-brand)] px-3 text-sm font-medium text-white"
            >
              返回主页 <ArrowRight size={14} aria-hidden="true" />
            </Link>
          </div>
        </div>
      </div>
    </WorkspaceShell>
  );
}

function DataStatusItem({
  label,
  value,
  detail,
  pilot = false,
}: {
  label: string;
  value: string;
  detail?: string;
  pilot?: boolean;
}) {
  return (
    <div className="flex min-w-0 items-center gap-3 py-2.5">
      <span
        className={`h-2 w-2 shrink-0 rounded-full ${pilot ? 'bg-[var(--cd-color-warning)]' : 'bg-[var(--cd-color-success)]'}`}
        aria-hidden="true"
      />
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-baseline justify-between gap-3">
          <span className="truncate text-[13px] text-[var(--cd-color-text-secondary)]">{label}</span>
          <span className="shrink-0 text-[13px] font-semibold tabular-nums text-[var(--cd-color-text-primary)]">{value}</span>
        </div>
        {detail ? <div className="mt-0.5 text-[11px] text-[var(--cd-color-text-muted)]">{detail}</div> : null}
      </div>
    </div>
  );
}

export function IntelligenceWorkspace() {
  const router = useRouter();
  const { session, status } = useAppSession();
  const [snapshot, setSnapshot] = React.useState<IntelligenceSnapshot>(EMPTY_SNAPSHOT);
  const [snapshotLoading, setSnapshotLoading] = React.useState(true);
  const [snapshotError, setSnapshotError] = React.useState<string | null>(null);
  const [requirement, setRequirement] = React.useState('');
  const [parseResult, setParseResult] = React.useState<RequirementParseResult | null>(null);
  const [parseLoading, setParseLoading] = React.useState(false);
  const [parseError, setParseError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (status === 'unauthenticated') router.replace('/login');
  }, [router, status]);

  const previewEnabled = isIntelligencePreviewEnabled(session?.role);

  React.useEffect(() => {
    if (status !== 'authenticated' || !session || !previewEnabled) return;

    let active = true;
    void (async () => {
      setSnapshotLoading(true);
      setSnapshotError(null);

      const [
        buildingsResult,
        metricsResult,
        leasesResult,
        leasesWithTermResult,
        brochuresResult,
        futureSuppliesResult,
        currentDataResult,
        latestMetricResult,
      ] = await Promise.all([
        supabase.from('buildings').select('id', { count: 'exact', head: true }),
        supabase.from('building_metrics').select('id', { count: 'exact', head: true }),
        supabase.from('lease_transactions').select('id', { count: 'exact', head: true }),
        supabase.from('lease_transactions').select('id', { count: 'exact', head: true }).not('lease_term_months', 'is', null),
        supabase.from('building_brochure_data').select('id', { count: 'exact', head: true }),
        supabase.from('future_supplies').select('id', { count: 'exact', head: true }),
        supabase.from('building_current_data').select('building_id', { count: 'exact', head: true }),
        supabase
          .from('building_metrics')
          .select('record_year, record_quarter')
          .order('record_year', { ascending: false })
          .order('record_quarter', { ascending: false })
          .limit(1)
          .maybeSingle(),
      ]);

      if (!active) return;

      const errors = [
        buildingsResult.error,
        metricsResult.error,
        leasesResult.error,
        leasesWithTermResult.error,
        brochuresResult.error,
        futureSuppliesResult.error,
        currentDataResult.error,
        latestMetricResult.error,
      ].filter(Boolean);

      const latestMetric = latestMetricResult.data;
      const latestMetricPeriod = latestMetric?.record_year && latestMetric?.record_quarter
        ? `${latestMetric.record_year} Q${latestMetric.record_quarter}`
        : null;

      setSnapshot({
        buildingCount: buildingsResult.count ?? null,
        metricCount: metricsResult.count ?? null,
        leaseCount: leasesResult.count ?? null,
        leaseWithTermCount: leasesWithTermResult.count ?? null,
        brochureCount: brochuresResult.count ?? null,
        futureSupplyCount: futureSuppliesResult.count ?? null,
        currentDataCount: currentDataResult.count ?? null,
        latestMetricPeriod,
      });
      setSnapshotError(errors.length > 0 ? '部分数据状态暂时无法读取，已保留可用结果。' : null);
      setSnapshotLoading(false);
    })();

    return () => {
      active = false;
    };
  }, [previewEnabled, session, status]);

  async function handleParseRequirement() {
    const accessToken = session?.session?.access_token;
    const input = requirement.trim();
    if (!accessToken || !input || parseLoading) return;

    setParseLoading(true);
    setParseError(null);
    try {
      const result = await parseIntelligenceRequirement(input, accessToken);
      setParseResult(result);
    } catch (error) {
      setParseResult(null);
      setParseError(error instanceof Error ? error.message : '客户需求解析失败，请稍后重试');
    } finally {
      setParseLoading(false);
    }
  }

  if (status === 'loading' || !session) return <IntelligenceLoadingShell />;
  if (!previewEnabled) return <PreviewUnavailable />;

  const hasCurrentData = (snapshot.currentDataCount ?? 0) > 0;
  const mapHandoff = parseResult ? createIntelligenceMapHandoff(parseResult) : null;
  const appliedCapabilityLabels = mapHandoff?.appliedCapabilities.map(key =>
    parseResult?.capabilities.find(item => item.key === key)?.label ?? key,
  ) ?? [];

  return (
    <WorkspaceShell
      className="h-screen h-[100dvh] overflow-hidden bg-[var(--cd-color-canvas)]"
      header={(
        <AppHeader
          title="业务智能 Intelligence"
          homeHref="/"
          status={<Badge tone="brand">Pilot Preview</Badge>}
        />
      )}
    >
      <main className="h-full overflow-y-auto overscroll-contain">
        <div className="mx-auto w-full max-w-[1240px] px-4 py-6 sm:px-6 sm:py-7 lg:px-8 2xl:max-w-[1360px]">
          <section className="mb-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="flex items-center gap-2">
                  <Sparkles size={17} className="text-[var(--cd-color-brand)]" aria-hidden="true" />
                  <h1 className="text-lg font-semibold text-[var(--cd-color-text-primary)]">Intelligence</h1>
                </div>
                <p className="mt-1.5 max-w-3xl text-sm leading-6 text-[var(--cd-color-text-secondary)]">
                  将市场、楼宇、成交与资料数据转化为可执行的 Broker 工作。当前阶段优先验证客户需求、项目推荐与业务机会工作流。
                </p>
              </div>
            </div>
          </section>

          <section className="rounded-[var(--cd-radius-lg)] border border-[var(--cd-color-border-strong)] bg-[var(--cd-color-surface)] p-4 sm:p-5" aria-labelledby="client-requirement-heading">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <Search size={16} className="text-[var(--cd-color-brand)]" aria-hidden="true" />
                <h2 id="client-requirement-heading" className="text-[15px] font-semibold text-[var(--cd-color-text-primary)]">客户需求</h2>
              </div>
              <Badge tone="brand">DeepSeek</Badge>
            </div>
            <p className="mt-2 text-sm text-[var(--cd-color-text-secondary)]">今天要帮客户找什么样的办公室？</p>
            <div className="mt-3 flex flex-col gap-2 sm:flex-row">
              <textarea
                value={requirement}
                onChange={(event) => {
                  setRequirement(event.target.value);
                  setParseResult(null);
                  setParseError(null);
                }}
                rows={3}
                maxLength={1200}
                placeholder="例如：望京或酒仙桥，800–1200㎡，预算7元以内，11月入住，优先甲级项目、地铁便利。"
                className="min-h-[92px] min-w-0 flex-1 resize-none rounded-[var(--cd-radius-md)] border border-[var(--cd-color-border)] bg-white px-3 py-2.5 text-sm leading-6 text-[var(--cd-color-text-primary)] outline-none transition focus:border-[var(--cd-color-brand)] focus:ring-2 focus:ring-[color:rgb(0_62_126_/_0.08)]"
              />
              <Button
                type="button"
                variant="primary"
                disabled={!requirement.trim() || parseLoading}
                onClick={() => void handleParseRequirement()}
                className="sm:self-end"
              >
                {parseLoading ? '正在理解…' : '理解客户需求'} <ArrowRight size={14} aria-hidden="true" />
              </Button>
            </div>

            {parseError ? (
              <div className="mt-3 rounded-[var(--cd-radius-md)] border border-[color:rgb(201_54_43_/_0.18)] bg-[var(--cd-color-danger-soft)] px-3 py-2.5 text-sm text-[var(--cd-color-danger)]" role="alert">
                {parseError}
              </div>
            ) : null}

            {parseResult ? (
              <div className="mt-4 border-t border-[var(--cd-color-border)] pt-4" aria-live="polite">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <div className="text-[13px] font-semibold text-[var(--cd-color-text-primary)]">AI 已理解客户需求</div>
                    <div className="mt-0.5 text-[11px] text-[var(--cd-color-text-muted)]">
                      仅结构化用户输入；业务可执行性由系统数据能力二次校验
                    </div>
                  </div>
                  <span className="text-[11px] tabular-nums text-[var(--cd-color-text-muted)]">
                    {parseResult.meta.durationMs.toLocaleString('zh-CN')} ms
                  </span>
                </div>

                <div className="mt-3 divide-y divide-[var(--cd-color-border)] rounded-[var(--cd-radius-md)] border border-[var(--cd-color-border)]">
                  {parseResult.capabilities.length > 0 ? parseResult.capabilities.map(item => {
                    const presentation = SUPPORT_PRESENTATION[item.status];
                    return (
                      <div key={item.key} className="grid gap-2 px-3 py-3 sm:grid-cols-[96px_minmax(0,1fr)_auto] sm:items-start">
                        <div className="text-xs font-medium text-[var(--cd-color-text-secondary)]">{item.label}</div>
                        <div className="min-w-0">
                          <div className="text-[13px] font-medium text-[var(--cd-color-text-primary)]">{item.value}</div>
                          <div className="mt-1 text-xs leading-5 text-[var(--cd-color-text-muted)]">{item.explanation}</div>
                          {item.dataBasis ? <div className="mt-1 text-[10px] text-[var(--cd-color-text-muted)]">数据依据：{item.dataBasis}</div> : null}
                        </div>
                        <Badge tone={presentation.tone}>{presentation.label}</Badge>
                      </div>
                    );
                  }) : (
                    <div className="px-3 py-4 text-sm text-[var(--cd-color-text-secondary)]">暂未提取到可执行条件，请补充区域、预算或项目偏好。</div>
                  )}
                </div>

                <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
                  <div className="min-w-0 text-[11px] text-[var(--cd-color-text-muted)]">
                    <div>模型：{parseResult.meta.model} · 原始需求不会写入 AI 审计日志</div>
                    {mapHandoff ? (
                      <div className="mt-1">
                        {mapHandoff.appliedCapabilities.length > 0
                          ? `进入地图后自动应用：${appliedCapabilityLabels.join('、')}；其余 ${mapHandoff.skippedCapabilities.length} 项仅保留为客户偏好。`
                          : '当前没有可安全自动映射到地图的条件；请补充可执行的区域、项目等级或净有效租金口径。'}
                      </div>
                    ) : null}
                  </div>
                  <Button
                    type="button"
                    variant="primary"
                    size="sm"
                    disabled={!mapHandoff || mapHandoff.appliedCapabilities.length === 0}
                    title={mapHandoff?.appliedCapabilities.length ? '在现有地图筛选引擎中查看真实候选项目' : '当前没有可安全映射到地图的条件'}
                    onClick={() => { if (mapHandoff) router.push(mapHandoff.href); }}
                  >
                    确认条件并查看地图 <ArrowRight size={13} aria-hidden="true" />
                  </Button>
                </div>
              </div>
            ) : null}

            <div className="mt-3 flex flex-wrap gap-1.5 text-[11px] text-[var(--cd-color-text-muted)]">
              <span className="rounded-[var(--cd-radius-sm)] bg-[var(--cd-color-surface-alt)] px-2 py-1">自然语言 → 严格结构化条件</span>
              <span className="rounded-[var(--cd-radius-sm)] bg-[var(--cd-color-surface-alt)] px-2 py-1">数据库词表二次校验</span>
              <span className="rounded-[var(--cd-radius-sm)] bg-[var(--cd-color-surface-alt)] px-2 py-1">缺失字段不参与筛选</span>
            </div>
          </section>

          <div className="mt-5 grid grid-cols-1 gap-5 lg:grid-cols-2">
            <section className="rounded-[var(--cd-radius-lg)] border border-[var(--cd-color-border)] bg-[var(--cd-color-surface)] p-4 sm:p-5" aria-labelledby="opportunity-heading">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <Radar size={16} className="text-[var(--cd-color-brand)]" aria-hidden="true" />
                  <h2 id="opportunity-heading" className="text-[15px] font-semibold text-[var(--cd-color-text-primary)]">业务机会</h2>
                </div>
                <Badge tone="warning">Pilot</Badge>
              </div>

              <div className="mt-4 divide-y divide-[var(--cd-color-border)]">
                <div className="flex items-center justify-between gap-4 py-2.5">
                  <span className="text-sm text-[var(--cd-color-text-secondary)]">租赁成交</span>
                  <span className="text-lg font-semibold tabular-nums text-[var(--cd-color-text-primary)]">{snapshotLoading ? '…' : formatCount(snapshot.leaseCount)}</span>
                </div>
                <div className="flex items-center justify-between gap-4 py-2.5">
                  <span className="text-sm text-[var(--cd-color-text-secondary)]">具备租期信息</span>
                  <span className="text-lg font-semibold tabular-nums text-[var(--cd-color-text-primary)]">{snapshotLoading ? '…' : formatCount(snapshot.leaseWithTermCount)}</span>
                </div>
              </div>

              <div className="mt-4 rounded-[var(--cd-radius-md)] bg-[var(--cd-color-surface-alt)] p-3">
                <div className="text-[13px] font-medium text-[var(--cd-color-text-primary)]">租约到期测算</div>
                <p className="mt-1 text-xs leading-5 text-[var(--cd-color-text-secondary)]">
                  下一阶段基于成交季度与租期生成估算到期窗口；历史成交导入后，机会池将自动扩展。
                </p>
              </div>

              <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
                <div className="rounded-[var(--cd-radius-md)] border border-dashed border-[var(--cd-color-border)] p-3 text-[var(--cd-color-text-muted)]">企业变化 · 待接入</div>
                <div className="rounded-[var(--cd-radius-md)] border border-dashed border-[var(--cd-color-border)] p-3 text-[var(--cd-color-text-muted)]">资本事件 · 待接入</div>
              </div>

              <Button type="button" variant="secondary" size="sm" disabled className="mt-4">
                查看机会雷达 <ArrowRight size={13} aria-hidden="true" />
              </Button>
            </section>

            <section className="rounded-[var(--cd-radius-lg)] border border-[var(--cd-color-border)] bg-[var(--cd-color-surface)] p-4 sm:p-5" aria-labelledby="proposal-heading">
              <div className="flex items-center gap-2">
                <FileChartColumn size={16} className="text-[var(--cd-color-brand)]" aria-hidden="true" />
                <h2 id="proposal-heading" className="text-[15px] font-semibold text-[var(--cd-color-text-primary)]">推荐方案</h2>
              </div>

              <div className="mt-4 rounded-[var(--cd-radius-md)] border border-dashed border-[var(--cd-color-border)] p-4">
                <div className="text-sm font-medium text-[var(--cd-color-text-primary)]">暂无已保存的客户方案</div>
                <p className="mt-1 text-xs leading-5 text-[var(--cd-color-text-secondary)]">
                  后续将从客户需求开始，选择真实候选项目后生成可预览、可导出的推荐方案。
                </p>
              </div>

              <div className="mt-4 border-t border-[var(--cd-color-border)] pt-4">
                <div className="mb-2 flex items-center justify-between gap-3">
                  <span className="text-xs font-medium text-[var(--cd-color-text-secondary)]">示例方案</span>
                  <Badge tone="neutral">Pilot Example</Badge>
                </div>
                <div className="rounded-[var(--cd-radius-md)] bg-[var(--cd-color-surface-alt)] p-3.5">
                  <div className="flex items-start gap-3">
                    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[var(--cd-radius-md)] bg-[var(--cd-color-brand-soft)] text-[var(--cd-color-brand)]">
                      <BriefcaseBusiness size={15} aria-hidden="true" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="text-[13px] font-medium text-[var(--cd-color-text-primary)]">示例企业 · 望京办公选址</div>
                      <div className="mt-0.5 text-xs text-[var(--cd-color-text-muted)]">示例结构；真实楼宇数据将在方案生成阶段读取</div>
                    </div>
                  </div>
                </div>
              </div>

              <Button type="button" variant="secondary" size="sm" disabled className="mt-4">
                创建客户方案 <ArrowRight size={13} aria-hidden="true" />
              </Button>
            </section>
          </div>

          <section className="mt-5 rounded-[var(--cd-radius-lg)] border border-[var(--cd-color-border)] bg-[var(--cd-color-surface)] p-4 sm:p-5" aria-labelledby="data-status-heading">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="flex items-center gap-2">
                <Database size={16} className="text-[var(--cd-color-brand)]" aria-hidden="true" />
                <div>
                  <h2 id="data-status-heading" className="text-[15px] font-semibold text-[var(--cd-color-text-primary)]">数据状态</h2>
                  <p className="mt-0.5 text-xs text-[var(--cd-color-text-muted)]">数量直接读取当前数据库，不使用演示 KPI。</p>
                </div>
              </div>
              {snapshotError ? <Badge tone="warning">部分读取失败</Badge> : null}
            </div>

            <div className="mt-3 grid grid-cols-1 gap-x-8 md:grid-cols-2 xl:grid-cols-4">
              <DataStatusItem label="楼宇" value={snapshotLoading ? '…' : formatCount(snapshot.buildingCount)} detail="已接入" />
              <DataStatusItem label="季度指标" value={snapshotLoading ? '…' : formatCount(snapshot.metricCount)} detail={snapshot.latestMetricPeriod ? `最新 ${snapshot.latestMetricPeriod}` : '数据期读取中'} />
              <DataStatusItem label="租赁成交" value={snapshotLoading ? '…' : formatCount(snapshot.leaseCount)} detail="已接入" />
              <DataStatusItem label="楼书数据" value={snapshotLoading ? '…' : formatCount(snapshot.brochureCount)} detail="持续补充" />
              <DataStatusItem label="未来供应" value={snapshotLoading ? '…' : formatCount(snapshot.futureSupplyCount)} detail="已接入" />
              <DataStatusItem
                label="实时销控"
                value={snapshotLoading ? '…' : formatCount(snapshot.currentDataCount)}
                detail={hasCurrentData ? '已接入' : 'Pilot · 当前无正式记录'}
                pilot={!hasCurrentData}
              />
              <DataStatusItem label="企业动态" value="—" detail="待接入" pilot />
              <DataStatusItem label="方案历史" value="—" detail="待接入" pilot />
            </div>

            {snapshotError ? <p className="mt-3 text-xs text-[var(--cd-color-warning)]">{snapshotError}</p> : null}
          </section>

          <section className="mt-5 flex flex-wrap gap-2 text-xs text-[var(--cd-color-text-muted)]" aria-label="数据边界说明">
            <span className="inline-flex items-center gap-1.5"><Building2 size={13} aria-hidden="true" />楼宇与市场指标来自现有数据库</span>
            <span className="inline-flex items-center gap-1.5"><FileText size={13} aria-hidden="true" />缺失数据不以 Demo 值补齐</span>
          </section>
        </div>
      </main>
    </WorkspaceShell>
  );
}
