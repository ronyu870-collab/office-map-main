import * as React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { executeQueryPlan } from '@/src/lib/intelligence/query/executePlan';
import { parseQueryPlan } from '@/src/lib/intelligence/query/plan';
import { describePlanRead } from '@/src/lib/intelligence/query/snapshotReader';
import { buildResultChart } from '@/src/lib/intelligence/query/charts';
import { resultViewSchema, type QueryResultView } from '@/src/lib/intelligence/query/presentation';
import { fixture } from '@/src/lib/intelligence/query/__tests__/fixtures';
import { resolveNumericFact } from '@/src/lib/intelligence/query/facts';
const client = vi.hoisted(() => ({ chart: vi.fn(), download: vi.fn(), reportDelivery: vi.fn() }));
vi.mock('@/src/services/trustedQueryClient', () => ({ trustedQueryClient: client }));
import { HomeQueryResult } from '../HomeQueryResult';

const scope = { actorId: 'synthetic-multi', effectiveId: 'synthetic-multi', sessionId: 'synthetic-session', targetId: null };
const requestId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
/** The real deterministic executor produces every displayed value and source.
 * This in-memory fixture is synthetic, not a production business query. */
function multiResult(operation: 'aggregate' | 'trend' | 'compare' | 'group_aggregate' | 'group_trend' | 'cross_aggregate', noVacancy = false): QueryResultView {
  const range = operation === 'trend' || operation === 'group_trend'
    ? { start: { year: 2026, quarter: 2 }, end: { year: 2026, quarter: 3 }, mode: 'per_period' }
    : operation === 'compare' ? { base: { year: 2026, quarter: 2 }, current: { year: 2026, quarter: 3 }, mode: 'per_period' }
      : { period: { year: 2026, quarter: 3 } };
  const plan = parseQueryPlan({ operation, metric: 'rent', metrics: ['rent', 'vacancy'], scope: { inventory: 'tracked' }, ...range,
    ...(operation === 'group_aggregate' || operation === 'group_trend' ? { groupBy: 'submarket' } : {}),
  });
  const read = describePlanRead(plan);
  const snapshots = read.periods.map(period => {
    const snapshot = fixture(period);
    return { ...snapshot, queryScope: { ...plan.scope, filter: null, requestedFields: read.fields }, rows: snapshot.rows.map((row, index) => {
      const submarket = index < 2 ? 'CBD' : '金融街', grade = index % 2 ? 'A' : 'P';
      return { ...row, dimensions: {
        submarket: { value: submarket, source: { ...row.nameSource, id: `catalog/${row.id}/submarket`, field: 'submarket', rawValue: submarket } },
        grade: { value: grade, source: { ...row.nameSource, id: `catalog/${row.id}/grade`, field: 'grade', rawValue: grade } },
      }, ...(noVacancy ? { facts: { ...row.facts, vacantArea: resolveNumericFact('vacantArea', row.id, [], period) } } : {}) };
    }) };
  });
  return resultViewSchema.parse(executeQueryPlan(plan, snapshots));
}

describe('P1 follow-up multi-metric result presentation', () => {
  beforeEach(() => { vi.resetAllMocks(); client.reportDelivery.mockResolvedValue(true);
    client.chart.mockImplementation(async (_scope, _request, result, request) => buildResultChart(result, request)); });
  afterEach(cleanup);

  it('shows both metric values and distinct valid samples without opening details', () => {
    render(<HomeQueryResult result={multiResult('aggregate')} />);
    const rent = screen.getByRole('region', { name: '净有效租金依据' });
    const vacancy = screen.getByRole('region', { name: '空置率依据' });
    expect(rent).toHaveTextContent('有效样本：3 栋');
    expect(vacancy).toHaveTextContent('有效样本：2 栋');
    expect(rent).toHaveTextContent('按有效总面积加权');
    expect(vacancy).toHaveTextContent('有效空置面积合计 ÷ 有效总面积合计');
    expect(screen.getByRole('region', { name: '净有效租金指标' })).toHaveTextContent('170');
    expect(screen.getByRole('region', { name: '空置率指标' })).toHaveTextContent('17.5');
    fireEvent.click(within(screen.getByRole('region', { name: '空置率指标' })).getByRole('button'));
    expect(screen.getByRole('region', { name: '来源详情' })).toHaveTextContent('vacant_area');
    expect(screen.getByRole('region', { name: '来源详情' })).not.toHaveTextContent('net_effective_rent');
  });

  it('keeps the first trend and sample finding for every metric visible by default', () => {
    render(<HomeQueryResult result={multiResult('trend')} />);
    const rent = screen.getByRole('region', { name: '净有效租金分析' });
    const vacancy = screen.getByRole('region', { name: '空置率分析' });
    expect(rent).toHaveTextContent('2026-Q2'); expect(rent).toHaveTextContent('2026-Q3');
    expect(vacancy).toHaveTextContent('2026-Q2'); expect(vacancy).toHaveTextContent('2026-Q3');
    expect(vacancy).toHaveTextContent('个百分点');
    expect(within(vacancy).getByText(/两期共同有效/)).toBeVisible();
    expect(within(rent).getByText(/两期共同有效/)).toBeVisible();
  });

  it('switches trend charts by a selected metric while keeping the original result and source cells', async () => {
    const result = multiResult('trend');
    render(<HomeQueryResult result={result} requestId={requestId} scope={scope} />);
    await screen.findByRole('figure', { name: '同源查询图表' });
    const select = screen.getByRole('combobox', { name: '图表指标' });
    expect(select).toHaveValue('rent');
    fireEvent.change(select, { target: { value: 'vacancy' } });
    await waitFor(() => expect(client.chart).toHaveBeenCalledTimes(2));
    expect(client.chart.mock.calls[1][2]).toBe(result);
    expect(client.chart.mock.calls[1][3]).toEqual({ kind: 'time_series', metric: 'vacancy' });
    const plot = await screen.findByRole('figure', { name: '同源查询图表' });
    expect(plot).toHaveTextContent('空置率'); expect(plot).toHaveTextContent('%');
    const chart = await client.chart.mock.results[1].value;
    expect(chart.points.every((point: { yCell: { key: string } }) => point.yCell.key === 'vacancy_value')).toBe(true);
    expect(client.download).not.toHaveBeenCalled();
  });

  it('selects both-period comparison charts without presenting a rent axis for vacancy', async () => {
    render(<HomeQueryResult result={multiResult('compare')} requestId={requestId} scope={scope} />);
    await screen.findByRole('figure', { name: '同源查询图表' });
    fireEvent.change(screen.getByRole('combobox', { name: '图表指标' }), { target: { value: 'vacancy' } });
    await waitFor(() => expect(client.chart).toHaveBeenCalledTimes(2));
    expect(client.chart.mock.calls[1][3]).toEqual({ kind: 'period_comparison', metric: 'vacancy' });
    expect(await screen.findByRole('figure', { name: '同源查询图表' })).toHaveTextContent('空置率（%）');
  });

  it('shows an entirely missing second metric as unknown, retaining its selection and zero valid sample', async () => {
    render(<HomeQueryResult result={multiResult('aggregate', true)} />);
    expect(screen.getByRole('region', { name: '空置率指标' })).toHaveTextContent('未知：无有效样本');
    expect(screen.getByRole('region', { name: '空置率依据' })).toHaveTextContent('有效样本：0 栋');
  });

  it('keeps a missing metric available in the chart selector and draws no substitute zero', async () => {
    render(<HomeQueryResult result={multiResult('trend', true)} requestId={requestId} scope={scope} />);
    await screen.findByRole('figure', { name: '同源查询图表' });
    fireEvent.change(screen.getByRole('combobox', { name: '图表指标' }), { target: { value: 'vacancy' } });
    await waitFor(() => expect(client.chart).toHaveBeenCalledTimes(2));
    const plot = await screen.findByRole('figure', { name: '同源查询图表' });
    expect(plot).toHaveTextContent('有效图示 0 项，未知 2 项');
    expect(plot.querySelectorAll('circle')).toHaveLength(0);
    const chart = await client.chart.mock.results[1].value;
    expect(chart.points.every((point: { y: unknown }) => point.y === null)).toBe(true);
  });

  it('switches grouped trends without losing the independent group sample summaries', async () => {
    render(<HomeQueryResult result={multiResult('group_trend')} requestId={requestId} scope={scope} />);
    expect(screen.getByRole('region', { name: '净有效租金依据' })).toHaveTextContent('CBD');
    expect(screen.getByRole('region', { name: '空置率依据' })).toHaveTextContent('金融街');
    await screen.findByRole('figure', { name: '同源查询图表' });
    fireEvent.change(screen.getByRole('combobox', { name: '图表指标' }), { target: { value: 'vacancy' } });
    await waitFor(() => expect(client.chart).toHaveBeenCalledTimes(2));
    expect(client.chart.mock.calls[1][3]).toEqual({ kind: 'grouped_time_series', metric: 'vacancy' });
    const chart = await client.chart.mock.results[1].value;
    expect(chart.facets).toHaveLength(2);
    expect(chart.points.every((point: { yCell: { key: string } }) => point.yCell.key === 'vacancy_value')).toBe(true);
  });

  it('switches cross-tab heatmaps and opens the selected metric evidence', async () => {
    render(<HomeQueryResult result={multiResult('cross_aggregate')} requestId={requestId} scope={scope} />);
    await screen.findByRole('figure', { name: '同源查询图表' });
    fireEvent.change(screen.getByRole('combobox', { name: '图表指标' }), { target: { value: 'vacancy' } });
    await waitFor(() => expect(client.chart).toHaveBeenCalledTimes(2));
    expect(client.chart.mock.calls[1][3]).toEqual({ kind: 'heatmap', metric: 'vacancy' });
    const plot = await screen.findByRole('figure', { name: '同源查询图表' });
    fireEvent.click(within(plot).getAllByRole('button', { name: /查看来源：CBD/ })[0]);
    expect(screen.getByRole('region', { name: '来源详情' })).toHaveTextContent('vacant_area');
    expect(screen.getByRole('region', { name: '来源详情' })).not.toHaveTextContent('net_effective_rent');
  });

  it('retries only the selected metric chart after a network failure without restoring a stale chart', async () => {
    render(<HomeQueryResult result={multiResult('trend')} requestId={requestId} scope={scope} />);
    await screen.findByRole('figure', { name: '同源查询图表' });
    client.chart.mockRejectedValueOnce(new Error('synthetic network interruption'));
    fireEvent.change(screen.getByRole('combobox', { name: '图表指标' }), { target: { value: 'vacancy' } });
    await screen.findByText('synthetic network interruption');
    expect(screen.queryByRole('figure', { name: '同源查询图表' })).not.toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: '图表指标' })).toHaveValue('vacancy');
    fireEvent.click(screen.getByRole('button', { name: '查看折线图' }));
    await waitFor(() => expect(client.chart).toHaveBeenCalledTimes(3));
    expect(client.chart.mock.calls[2][3]).toEqual({ kind: 'time_series', metric: 'vacancy' });
    expect(await screen.findByRole('figure', { name: '同源查询图表' })).toHaveTextContent('空置率');
  });

  it('clears a previous metric chart while the selected chart is pending and keeps the selection disabled', async () => {
    render(<HomeQueryResult result={multiResult('trend')} requestId={requestId} scope={scope} />);
    await screen.findByRole('figure', { name: '同源查询图表' });
    let resolve!: (chart: unknown) => void;
    client.chart.mockImplementationOnce((_scope, _id, result, request) => new Promise(done => { resolve = () => done(buildResultChart(result, request)); }));
    const select = screen.getByRole('combobox', { name: '图表指标' });
    fireEvent.change(select, { target: { value: 'vacancy' } });
    await waitFor(() => expect(select).toBeDisabled());
    expect(screen.queryByRole('figure', { name: '同源查询图表' })).not.toBeInTheDocument();
    await act(async () => resolve(null));
    await waitFor(() => expect(select).toBeEnabled());
    expect(await screen.findByRole('figure', { name: '同源查询图表' })).toHaveTextContent('空置率');
  });
});
