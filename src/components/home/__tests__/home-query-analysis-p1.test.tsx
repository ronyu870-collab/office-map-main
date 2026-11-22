import * as React from 'react';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { buildAggregateResult, buildTrendResult } from '@/src/lib/intelligence/query/result';
import { attachResearchAnalysis } from '@/src/lib/intelligence/query/researchAnalysis';
import { resultViewSchema } from '@/src/lib/intelligence/query/presentation';
import { resolveNumericFact } from '@/src/lib/intelligence/query/facts';
import { fixture, source } from '@/src/lib/intelligence/query/__tests__/fixtures';
import { HomeQueryResult } from '../HomeQueryResult';

afterEach(cleanup);
describe('P1 source-backed research result presentation', () => {
  it('T03/T06 presents deterministic conclusions and both sample methods with exact source links', async () => {
    const snapshots = [fixture({ year: 2026, quarter: 2 }), fixture()];
    const result = resultViewSchema.parse(attachResearchAnalysis(buildTrendResult(snapshots, 'rent', 'per_period'), snapshots));
    render(<HomeQueryResult result={result} />);
    fireEvent.click(screen.getByText('分析与样本核查'));
    expect(screen.getByText(/2026-Q2 为.*2026-Q3 为.*绝对变化/)).toBeInTheDocument();
    expect(screen.getByText(/两期共同有效 3 栋/)).toBeInTheDocument();
    expect(screen.getByText(/样本构成不同，均值变化不能直接解释为市场真实变化/)).toBeInTheDocument();
    fireEvent.click(screen.getByText('计算明细、共同样本与异常规则'));
    const table = await screen.findByRole('table', { name: /各期有效样本与全期间共同有效样本/ });
    expect(table.querySelectorAll('tbody tr')).toHaveLength(2);
    expect(within(table).getByRole('columnheader', { name: '逐楼简单平均' })).toBeInTheDocument();
    fireEvent.click(within(table).getByRole('button', { name: '查看来源：2026 Q3 全期间共同样本' }));
    expect(screen.getByRole('region', { name: '来源详情' })).toHaveTextContent('net_effective_rent');
    expect(screen.getByRole('region', { name: '来源详情' })).toHaveTextContent('total_area');
  });

  it('T07 shows a 180 to 80 rent alert with its rule and actual evidence', async () => {
    const snapshots = [fixture({ year: 2026, quarter: 2 }), fixture()].map((snapshot, index) => ({ ...snapshot,
      rows: snapshot.rows.map((row, i) => i === 0 ? { ...row, facts: { ...row.facts,
        netEffectiveRent: resolveNumericFact('netEffectiveRent', row.id, [source(row.id, 'netEffectiveRent', index === 0 ? 180 : 80, snapshot.period)], snapshot.period),
      } } : row),
    }));
    const result = resultViewSchema.parse(attachResearchAnalysis(buildTrendResult(snapshots, 'rent', 'per_period'), snapshots));
    render(<HomeQueryResult result={result} />);
    fireEvent.click(screen.getByText('分析与样本核查'));
    expect(screen.getByText(/A座 从 2026-Q2 的 180 变为 2026-Q3 的 80/)).toBeInTheDocument();
    expect(screen.getByText(/提醒不代表数据错误/)).toBeInTheDocument();
    fireEvent.click(screen.getByText('计算明细、共同样本与异常规则'));
    expect(await screen.findByText(/绝对环比变化≥30%/)).toBeInTheDocument();
    fireEvent.click(screen.getByText(/查看 \d+ 条异常提醒/));
    fireEvent.click(screen.getByRole('button', { name: '查看依据：A座' }));
    const details = screen.getByRole('region', { name: '来源详情' });
    expect(details).toHaveTextContent('180'); expect(details).toHaveTextContent('80');
  });

  it('T09 exposes the actual executed plan, table fields and version without displaying internal context', () => {
    const raw = buildAggregateResult(fixture(), 'rent');
    const plan = { operation: 'aggregate', metric: 'rent', period: { year: 2026, quarter: 3 }, scope: { inventory: 'tracked', submarkets: ['CBD'] } };
    const result = resultViewSchema.parse({ ...raw, parameters: { ...raw.parameters, scope: plan.scope, executedPlan: plan, semanticContext: { hidden: 'internal-context-marker' } } });
    render(<HomeQueryResult result={result} />);
    expect(screen.getByRole('region', { name: '数据依据摘要' })).toHaveTextContent('2026 Q3，季度跟踪样本');
    expect(screen.getByLabelText('重要数据限制')).toHaveTextContent('有效样本 3/4 栋');
    fireEvent.click(screen.getByRole('button', { name: '数据依据' })); fireEvent.click(screen.getByText('高级技术信息')); fireEvent.click(screen.getByText('实际执行条件'));
    expect(JSON.parse(screen.getByText(/"operation": "aggregate"/).textContent!)).toEqual(plan);
    expect(screen.getByText(/使用的数据表与字段/)).toHaveTextContent('building_metrics.net_effective_rent');
    expect(screen.queryByText(/internal-context-marker/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /查看来源：面积加权净有效租金/ }));
    expect(screen.getByRole('region', { name: '来源详情' })).toHaveTextContent('尚未关联原件');
  });

  it('T10 keeps missing data unknown and never presents a fictitious trend number', () => {
    const base = fixture();
    const snapshot = { ...base, rows: base.rows.map(row => ({ ...row, facts: { ...row.facts,
      netEffectiveRent: resolveNumericFact('netEffectiveRent', row.id, [], base.period),
    } })) };
    const result = resultViewSchema.parse(attachResearchAnalysis(buildAggregateResult(snapshot, 'rent'), [snapshot]));
    render(<HomeQueryResult result={result} />);
    expect(screen.getByRole('region', { name: '查询数据状态' })).toHaveTextContent('没有可用的指标数值');
    expect(screen.queryByRole('region', { name: '核心指标' })).not.toBeInTheDocument();
    expect(screen.queryByText('加权与简单平均')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '数据依据' }));
    fireEvent.click(screen.getByText('统计口径与限制'));
    expect(screen.getByRole('region', { name: '统计口径与限制' })).toHaveTextContent('有效 0 栋');
  });

  it('discloses server-side anomaly truncation even when no individual records fit the response', async () => {
    const snapshot = fixture();
    const raw = structuredClone(attachResearchAnalysis(buildAggregateResult(snapshot, 'rent'), [snapshot]));
    const supplement = raw.parameters.researchAnalysis as { series: { anomalyCoverage?: unknown }[] };
    supplement.series[0].anomalyCoverage = { complete: false, detected: 12, returned: 0, omitted: 12, iqrDetected: 12, quarterOnQuarterDetected: 0 };
    render(<HomeQueryResult result={resultViewSchema.parse(raw)} />);
    fireEvent.click(screen.getByText('分析与样本核查'));
    fireEvent.click(screen.getByText('计算明细、共同样本与异常规则'));
    expect(await screen.findByText(/检测到 12 条异常提醒，已列举 0 条，另有 12 条因单次结果容量限制未列举/)).toBeInTheDocument();
  });
});
