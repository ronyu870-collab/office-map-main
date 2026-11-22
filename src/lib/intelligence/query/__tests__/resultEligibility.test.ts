import { expect, it } from 'vitest';
import { buildResultChart } from '../charts';
import { buildListResult } from '../result';
import { resultAvailability } from '../resultAvailability';
import { resultViewSchema, type QueryResultView } from '../presentation';
import { defaultResultChartRequest, resultChartEligibility, resultNumericColumns, resultMapEligible } from '../resultEligibility';
import { fixture } from './fixtures';

const unknown = { kind: 'unknown' as const, state: 'missing' as const, reason: 'no_valid_sample', sourceIds: [] };
const result = () => resultViewSchema.parse(buildListResult(fixture(), ['height', 'netEffectiveRent']));
export function leaseUnknown(): QueryResultView {
  const value = result();
  value.parameters = { dataDomain: 'lease-research/1', scope: { mode: 'aggregate', from: '2026-10-01', to: '2026-12-31', groupBy: 'quarter' } };
  value.table.columns = [{ key: 'group', label: '季度', unit: null }, { key: 'count', label: '成交记录数', unit: 'transaction_count' }, { key: 'area', label: '成交面积', unit: 'm2' }];
  value.table.rows = [{ entityId: 'quarter', cells: { group: { kind: 'text', value: '2026-Q4', sourceIds: [] }, count: unknown, area: unknown } }];
  return value;
}
it('does not turn an all-unknown lease aggregate wrapped as list into a usable list', () => {
  const availability = resultAvailability(leaseUnknown());
  expect(availability?.kind).toBe('missing');
  expect(availability?.title).toBe('该期间暂无可交付统计');
  expect(availability?.description).not.toMatch(/样本太少|没有成交|无权限/);
});
it('labels empty domains without inventing building records or zero transactions', () => {
  const value = leaseUnknown(); value.table.rows = [];
  expect(resultAvailability(value)?.title).not.toContain('楼宇');
  value.parameters = { dataDomain: 'legacy-research/1' };
  expect(resultAvailability(value)?.title).toBe('当前范围没有可交付记录');
});
it('rejects a numeric-unit column whose values are all unknown', () => {
  const value = result();
  for (const row of value.table.rows) row.cells.height = unknown;
  expect(() => buildResultChart(value, { kind: 'bar', field: 'height' })).toThrow(/CHART_/);
});
it('rejects scatter when both columns have values but no same-row valid pair', () => {
  const value = result();
  value.table.rows.forEach((row, index) => { row.cells[index % 2 ? 'height' : 'netEffectiveRent'] = unknown; });
  expect(() => buildResultChart(value, { kind: 'scatter', x: 'height', y: 'netEffectiveRent' })).toThrow(/CHART_/);
});

it('keeps legitimate zero statistics available without inferring a missing-data cause', () => {
  const value = leaseUnknown();
  value.table.rows[0].cells.count = { kind: 'number', value: { numeric: 0, exact: { numerator: '0', denominator: '1' } }, sourceIds: [] };
  expect(resultAvailability(value)).toBeNull();
});

it('does not offer unknown numeric columns or scatter and map actions for period aggregates', () => {
  const value = leaseUnknown();
  expect(resultNumericColumns(value)).toHaveLength(0);
  expect(defaultResultChartRequest(value)).toBeNull();
  expect(resultMapEligible(value)).toBe(false);
});
it('requires a source-bound building result row rather than scoped aggregate provenance', () => {
  const value = result();
  const id = crypto.randomUUID();
  const name = { ...value.sources[0], id: 'building-name', table: 'buildings', field: 'name', entityId: id, recordId: id, rawValue: '真实楼宇' };
  value.sources = [name];
  value.parameters = { dataDomain: 'business-research/1', executedPlan: { scope: { buildingIds: [id] } } };
  value.table.rows = [{ entityId: 'quarter', cells: { group: { kind: 'text', value: '2026Q3', sourceIds: [] } } }];
  expect(resultMapEligible(value)).toBe(false);
  value.table.rows = [{ entityId: id, cells: { name: { kind: 'text', value: '真实楼宇', sourceIds: ['building-name'] } } }];
  expect(resultMapEligible(value)).toBe(true);
  value.table.rows[0].cells.name.sourceIds = [];
  expect(resultMapEligible(value)).toBe(false);
});
it('requires comparable valid periods within the same series and keeps missing periods missing', () => {
  const value = result(); value.operation = 'trend';
  value.table.columns = [{ key: 'period', label: '季度', unit: null }, { key: 'value', label: '净有效租金', unit: 'CNY/m2/month' }];
  const number = { kind: 'number' as const, value: { numeric: 12, exact: { numerator: '12', denominator: '1' } }, sourceIds: [] };
  value.table.rows = ['2026Q1', '2026Q2', '2026Q3'].map((period, index) => ({ entityId: period, cells: { period: { kind: 'text', value: period, sourceIds: [] }, value: index === 0 ? number : unknown } }));
  expect(defaultResultChartRequest(value)).toBeNull();
  value.table.rows[2].cells.value = number;
  expect(defaultResultChartRequest(value)).toEqual({ kind: 'time_series' });
  expect(resultChartEligibility(value, { kind: 'plot', type: 'line', x: 'period', y: ['value'] }).eligible).toBe(true);
  expect(value.table.rows[1].cells.value).toEqual(unknown);
});
it('uses the ranked field and degrades a single ranked value to a fact', () => {
  const value = result(); value.operation = 'rank'; value.parameters.field = 'height';
  expect(defaultResultChartRequest(value)).toEqual({ kind: 'bar', field: 'height' });
  value.table.rows = value.table.rows.slice(0, 1);
  expect(defaultResultChartRequest(value)).toBeNull();
});
