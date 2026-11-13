import { describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';
import { executeQueryPlan } from '../executePlan';
import { parseQueryPlan, type QueryPlan } from '../plan';
import { describePlanRead } from '../snapshotReader';
import { buildXlsx } from '../exports';
import { basePeriod, currentPeriod, fixture } from './fixtures';

function snapshots(plan: QueryPlan) {
  const read = describePlanRead(plan);
  return (read.periods.length ? read.periods : [null]).map(period => ({
    ...fixture(period ?? currentPeriod), period,
    queryScope: { ...plan.scope, filter: plan.filter ?? null, requestedFields: read.fields, inventoryTime: 'current_catalog', brochureSelection: 'all_unresolved_record_candidates' },
  }));
}
const scope = { inventory: 'tracked', submarkets: ['CBD'] };

describe('structured plan execution against one database snapshot', () => {
  it('applies filters, preserves unknown candidates and cites filter-only fields', () => {
    const plan = parseQueryPlan({ operation: 'list', fields: [], period: null, scope, filter: { field: 'height', operator: 'gt', value: '200' } });
    const result = executeQueryPlan(plan, snapshots(plan));
    expect(result.table.rows.map(row => row.entityId)).toEqual(['A']);
    expect(result.parameters.filterEvaluation).toMatchObject([{ total: 4, matched: 1, notMatched: 1, unknown: 2 }]);
    expect(result.sources.some(source => source.entityId === 'D' && source.field === 'building_height')).toBe(true);
    expect(result.table.columns.map(column => column.key)).toEqual(['name']);
    expect(result.limitations.some(text => text.includes('有效版本优先级'))).toBe(true);
  });

  it('aggregates only known matches and does not turn an unknown filter into false', () => {
    const plan = parseQueryPlan({ operation: 'aggregate', metric: 'rent', period: currentPeriod, scope, filter: { field: 'height', operator: 'gt', value: '200' } });
    const result = executeQueryPlan(plan, snapshots(plan));
    expect(result.table.rows[0].cells.value).toMatchObject({ kind: 'number', value: { numeric: 100 } });
    expect(result.analysis).toMatchObject({ coverage: { total: 1, valid: 1 }, denominator: { numeric: 10000 } });
    expect(result.parameters.filterEvaluation).toMatchObject([{ unknown: 2 }]);
  });

  it('compares each-period and paired samples with the correct percentage-point unit', async () => {
    const plan = parseQueryPlan({ operation: 'compare', metric: 'vacancy', base: basePeriod, current: currentPeriod, mode: 'paired', scope });
    const result = executeQueryPlan(plan, snapshots(plan));
    expect(result.table.rows[0].cells.change).toMatchObject({ kind: 'number', value: { numeric: 5 } });
    expect(result.table.columns.find(column => column.key === 'change')?.unit).toBe('percentage_point');
    expect(result.sources.some(source => source.period?.quarter === 2)).toBe(true);
    expect(result.sources.some(source => source.period?.quarter === 3)).toBe(true);
    const workbook = XLSX.read(await buildXlsx(result), { type: 'array' });
    const data = XLSX.utils.sheet_to_json<Record<string, unknown>>(workbook.Sheets['数据']);
    expect(Object.values(data[0])).toContain(5);
    const per = executeQueryPlan({ ...plan, mode: 'per_period' }, snapshots(plan));
    expect(per.analysis).toMatchObject({ change: { numeric: 3.2142857142857144 } });
  });

  it('filters each period first and then intersects valid samples for paired comparison', () => {
    const plan = parseQueryPlan({ operation: 'compare', metric: 'rent', base: basePeriod, current: currentPeriod, mode: 'paired', scope,
      filter: { field: 'netEffectiveRent', operator: 'gte', value: '100' } });
    const result = executeQueryPlan(plan, snapshots(plan));
    expect(result.analysis).toMatchObject({ pairedIds: ['B', 'D'], base: { usedEntityIds: ['B', 'D'] }, current: { usedEntityIds: ['B', 'D'] } });
    expect(result.parameters.filterEvaluation).toMatchObject([{ matched: 3, notMatched: 1, unknown: 0 }, { matched: 3, notMatched: 0, unknown: 1 }]);
  });

  it('refuses wrong period, mixed data versions, missing rows and different plan metadata', () => {
    const plan = parseQueryPlan({ operation: 'compare', metric: 'rent', base: basePeriod, current: currentPeriod, mode: 'paired', scope });
    const original = snapshots(plan);
    expect(() => executeQueryPlan(plan, [original[0]])).toThrow('QUERY_SNAPSHOT_PERIOD_MISMATCH');
    expect(() => executeQueryPlan(plan, [original[0], { ...original[1], dataVersion: 'different' }])).toThrow('QUERY_SNAPSHOT_VERSION_MISMATCH');
    expect(() => executeQueryPlan(plan, [original[0], { ...original[1], rows: original[1].rows.slice(1), expectedCount: 3 }])).toThrow('QUERY_SNAPSHOT_UNIVERSE_MISMATCH');
    expect(() => executeQueryPlan({ ...plan, scope: { inventory: 'all_authorized' } }, original)).toThrow('QUERY_SNAPSHOT_PLAN_MISMATCH');
    expect(() => executeQueryPlan({ ...plan, metric: 'vacancy' }, original)).toThrow('QUERY_SNAPSHOT_PLAN_MISMATCH');
  });
});
