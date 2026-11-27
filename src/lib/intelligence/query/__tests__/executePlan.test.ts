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
  it('requires the quarter vacancy numerator and denominator and retains only strictly matching listed buildings', () => {
    const plan = parseQueryPlan({ operation: 'list', fields: ['netEffectiveRent', 'totalArea', 'vacantArea'],
      period: currentPeriod, scope, filter: { operator: 'and', terms: [
        { field: 'netEffectiveRent', operator: 'lt', value: '250' },
        { field: 'vacancyRate', operator: 'gt', value: '0.15' },
      ] } });
    const result = executeQueryPlan(plan, snapshots(plan));
    expect(result.table.rows.map(row => row.entityId)).toEqual(['B']);
    expect(result.table.rows[0].cells.vacancy).toMatchObject({ value: { numeric: .2 } });
    expect(result.table.rows[0].cells.vacancy.sourceIds).toHaveLength(2);
  });
  it('ranks the entire strict-grade subset before applying Top N and keeps catalog sources', () => {
    const plan = parseQueryPlan({ operation: 'rank', field: 'netEffectiveRent', period: currentPeriod,
      scope, limit: 2, direction: 'desc', filter: { field: 'grade', operator: 'eq', value: 'A' } });
    const snapshot = snapshots(plan)[0];
    const rows = snapshot.rows.map(row => {
      const grade = row.id === 'B' ? 'P' : 'A';
      return { ...row, dimensions: { grade: { value: grade, source: {
        ...row.nameSource, id: `grade/${row.id}`, field: 'grade', rawValue: grade,
      } } } };
    });
    const result = executeQueryPlan(plan, [{ ...snapshot, rows }]);
    expect(result.table.rows.map(row => row.entityId)).toEqual(['D', 'A']);
    expect(result.sources.some(source => source.entityId === 'B' && source.field === 'grade' && source.rawValue === 'P')).toBe(true);
  });
  it('keeps original rank ordering when projecting formal per-building vacancy and unknowns', () => {
    const plan = parseQueryPlan({ operation: 'rank', field: 'netEffectiveRent', period: currentPeriod,
      scope, limit: 3, direction: 'desc', projection: ['vacancyRate'] });
    const result = executeQueryPlan(plan, snapshots(plan));
    expect(result.table.rows.map(row => row.entityId)).toEqual(['B', 'D', 'A']);
    expect(result.table.rows.map(row => row.cells.vacancy.kind)).toEqual(['number', 'unknown', 'number']);
    expect(result.table.rows[0].cells.vacancy).toMatchObject({ value: { numeric: .2 } });
    expect(result.table.rows[0].cells.vacancy.sourceIds).toHaveLength(2);
  });
  it('archives the complete executed plan for structured requests and isolates it from caller mutations', () => {
    const input = { operation: 'aggregate', metric: 'rent', metrics: ['rent', 'vacancy'], period: { ...currentPeriod },
      scope: { inventory: 'tracked', submarkets: ['CBD'] }, filter: { operator: 'and', terms: [
        { field: 'height', operator: 'gt', value: '200' }, { field: 'totalArea', operator: 'gte', value: '10000' },
      ] } };
    const checked = parseQueryPlan(input), result = executeQueryPlan(input, snapshots(checked));
    expect(result.parameters.executedPlan).toEqual(checked);
    input.filter.terms[0].value = '999'; input.scope.submarkets[0] = '金融街';
    input.metrics.reverse(); input.period.quarter = 1;
    expect(result.parameters.executedPlan).toEqual(checked);
    const executed = result.parameters.executedPlan as Extract<QueryPlan, { operation: 'aggregate' }>;
    expect(Object.isFrozen(executed)).toBe(true);
    expect(Object.isFrozen(executed.filter)).toBe(true);
    expect(Reflect.set(executed.period, 'quarter', 1)).toBe(false);
    expect(() => executed.scope.submarkets!.push('金融街')).toThrow();
    expect(() => executed.metrics!.reverse()).toThrow();
    expect(result.parameters.executedPlan).toEqual(checked);
  });

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
