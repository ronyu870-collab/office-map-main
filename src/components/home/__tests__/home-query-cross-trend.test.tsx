import * as React from 'react';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { executeQueryPlan } from '@/src/lib/intelligence/query/executePlan';
import { buildResultChart, type ResultChart } from '@/src/lib/intelligence/query/charts';
import { resultViewSchema } from '@/src/lib/intelligence/query/presentation';
import { crossTrendPlan, crossTrendSnapshots } from '@/src/lib/intelligence/query/__tests__/crossTrendFixture';
import { resolveNumericFact } from '@/src/lib/intelligence/query/facts';

const client = vi.hoisted(() => ({ chart: vi.fn(), download: vi.fn(), reportDelivery: vi.fn() }));
vi.mock('@/src/services/trustedQueryClient', () => ({ trustedQueryClient: client }));
import { HomeQueryResult } from '../HomeQueryResult';

const scope = { actorId: 'synthetic-cross', effectiveId: 'synthetic-cross', sessionId: 'synthetic-session', targetId: null };
const requestId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

function result(multiple = true, missingVacancy = false) {
  const plan = crossTrendPlan({ metrics: multiple ? ['rent', 'vacancy', 'totalArea'] : undefined });
  const snapshots = crossTrendSnapshots(plan).map(snapshot => ({ ...snapshot, rows: snapshot.rows.map(row => ({ ...row,
    facts: missingVacancy ? { ...row.facts, vacantArea: resolveNumericFact('vacantArea', row.id, [], snapshot.period) } : row.facts,
  })) }));
  return resultViewSchema.parse(executeQueryPlan(plan, snapshots));
}

describe('P1 current-catalog cross-dimensional trend presentation', () => {
  beforeEach(() => {
    vi.resetAllMocks(); client.reportDelivery.mockResolvedValue(true);
    client.chart.mockImplementation(async (_scope, _id, value, request) => buildResultChart(value, request));
  });
  afterEach(cleanup);

  it('exposes both executed dimensions and the operation for legacy results without an executed plan', () => {
    const value = result(); delete value.parameters.executedPlan;
    render(<HomeQueryResult result={value} />);
    fireEvent.click(screen.getByText('来源、口径与结果版本'));
    fireEvent.click(screen.getByText('实际执行条件'));
    const conditions = screen.getByText(/"operation": "cross_trend"/);
    expect(conditions).toBeVisible();
    expect(conditions).toHaveTextContent('"rowDimension": "submarket"');
    expect(conditions).toHaveTextContent('"columnDimension": "grade"');
    expect(conditions).toHaveTextContent('"mode": "per_period"');
    expect(conditions).toHaveTextContent('"start"'); expect(conditions).toHaveTextContent('"end"');
    expect(conditions).toHaveTextContent('"totalArea"');
  });

  it('shows fixed cross dimensions alongside the complete saved plan and its real filter', () => {
    const plan = crossTrendPlan({ filter: { field: 'netEffectiveRent', operator: 'gt', value: '150' } });
    const value = resultViewSchema.parse(executeQueryPlan(plan, crossTrendSnapshots(plan)));
    value.parameters.executedPlan = plan;
    render(<HomeQueryResult result={value} />);
    fireEvent.click(screen.getByText('来源、口径与结果版本'));
    fireEvent.click(screen.getByText('实际执行条件'));
    const conditions = screen.getByText(/"operation": "cross_trend"/);
    const displayed = JSON.parse(conditions.textContent!);
    expect(displayed).toMatchObject(plan);
    expect(displayed.rowDimension).toBe('submarket'); expect(displayed.columnDimension).toBe('grade');
    expect(displayed.filter).toEqual({ field: 'netEffectiveRent', operator: 'gt', value: '150' });
  });

  it.each([false, true])('automatically shows independent cell trends without pooling a dimension (multi=%s)', async multiple => {
    render(<HomeQueryResult result={result(multiple)} requestId={requestId} scope={scope} />);
    const plot = await screen.findByRole('figure', { name: '同源查询图表' });
    expect(within(plot).getAllByRole('img')).toHaveLength(4);
    for (const name of ['CBD / A', 'CBD / B', '金融街 / A', '金融街 / B']) expect(plot).toHaveTextContent(name);
    expect(plot).toHaveTextContent('缺期断线');
    expect(screen.getByRole('button', { name: '查看折线图' })).toBeEnabled();
    expect(client.chart).toHaveBeenCalledTimes(1);
    expect(client.chart.mock.calls[0][3]).toEqual({ kind: 'grouped_time_series', ...(multiple ? { metric: 'rent' } : {}) });
    expect(screen.queryByRole('button', { name: '查看热力表' })).not.toBeInTheDocument();
    if (!multiple) expect(screen.queryByRole('combobox', { name: '图表指标' })).not.toBeInTheDocument();
  });

  it('switches all three metrics on the same saved result and exposes only the selected value sources', async () => {
    const value = result();
    render(<HomeQueryResult result={value} requestId={requestId} scope={scope} />);
    await screen.findByRole('figure', { name: '同源查询图表' });
    const select = screen.getByRole('combobox', { name: '图表指标' });
    expect(within(select).getAllByRole('option')).toHaveLength(3);
    for (const [metric, label, key] of [['vacancy', '空置率', 'vacancy_value'], ['totalArea', '总面积', 'totalArea_value']]) {
      fireEvent.change(select, { target: { value: metric } });
      await waitFor(() => expect(select).toBeEnabled());
      const plot = await screen.findByRole('figure', { name: '同源查询图表' });
      expect(plot).toHaveTextContent(label);
      const last = client.chart.mock.calls.at(-1)!;
      expect(last[2]).toBe(value); expect(last[3]).toEqual({ kind: 'grouped_time_series', metric });
      const chart = await client.chart.mock.results.at(-1)!.value as ResultChart;
      expect(chart.facets).toHaveLength(4);
      for (const point of chart.points) {
        expect(point.yCell.key).toBe(key);
        expect(point.yCell.sourceIds).toEqual(value.table.rows.find(row => row.entityId === point.yCell.entityId)!.cells[key].sourceIds);
      }
    }
    const table = screen.getByRole('table', { name: '本次结果的完整表格，分页不改变统计范围' });
    const validRow = value.table.rows.findIndex(row => row.cells.vacancy_value.kind === 'number');
    expect(validRow).toBeGreaterThanOrEqual(0);
    fireEvent.click(within(table).getAllByRole('button', { name: /^查看来源：空置率 · 空置率 / })[validRow]);
    const sources = screen.getByRole('region', { name: '来源详情' });
    expect(sources).toHaveTextContent('vacant_area');
    expect(sources).not.toHaveTextContent('net_effective_rent');
    expect(client.download).not.toHaveBeenCalled();
  });

  it('retains both dimensions and periods when changing to bars and back to the full trend', async () => {
    render(<HomeQueryResult result={result()} requestId={requestId} scope={scope} />);
    await screen.findByRole('figure', { name: '同源查询图表' });
    fireEvent.click(screen.getByRole('button', { name: '查看柱状图' }));
    await waitFor(() => expect(client.chart).toHaveBeenCalledTimes(2));
    const chart = await client.chart.mock.results[1].value as ResultChart;
    expect(chart.kind).toBe('bar'); expect(chart.points).toHaveLength(8);
    expect(new Set(chart.points.map(point => point.label)).size).toBe(8);
    expect(chart.points.every(point => /\/.+2026-Q[23]/.test(point.label))).toBe(true);
    await waitFor(() => expect(screen.getByRole('button', { name: '查看折线图' })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: '查看折线图' }));
    await waitFor(() => expect(client.chart).toHaveBeenCalledTimes(3));
    expect(within(await screen.findByRole('figure', { name: '同源查询图表' })).getAllByRole('img')).toHaveLength(4);
  });

  it('keeps missing-metric cells selectable and unknown across all quarters', async () => {
    render(<HomeQueryResult result={result(true, true)} requestId={requestId} scope={scope} />);
    await screen.findByRole('figure', { name: '同源查询图表' });
    fireEvent.change(screen.getByRole('combobox', { name: '图表指标' }), { target: { value: 'vacancy' } });
    const plot = await screen.findByRole('figure', { name: '同源查询图表' });
    expect(plot).toHaveTextContent('有效图示 0 项，未知 8 项');
    expect(plot.querySelectorAll('circle')).toHaveLength(0);
    expect(within(plot).getAllByRole('img')).toHaveLength(4);
  });

  it('retries the chosen cross-trend metric after failure without showing the previous metric chart', async () => {
    render(<HomeQueryResult result={result()} requestId={requestId} scope={scope} />);
    await screen.findByRole('figure', { name: '同源查询图表' });
    client.chart.mockRejectedValueOnce(new Error('synthetic chart interruption'));
    fireEvent.change(screen.getByRole('combobox', { name: '图表指标' }), { target: { value: 'vacancy' } });
    await screen.findByText('synthetic chart interruption');
    expect(screen.queryByRole('figure', { name: '同源查询图表' })).not.toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: '图表指标' })).toHaveValue('vacancy');
    fireEvent.click(screen.getByRole('button', { name: '查看折线图' }));
    const plot = await screen.findByRole('figure', { name: '同源查询图表' });
    expect(within(plot).getAllByRole('img')).toHaveLength(4);
    expect(plot).toHaveTextContent('空置率');
    expect(client.chart.mock.calls.at(-1)![3]).toEqual({ kind: 'grouped_time_series', metric: 'vacancy' });
  });
});
