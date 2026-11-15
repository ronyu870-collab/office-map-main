import { describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';
import { authorizePlan } from '../admission';
import { buildResultChart } from '../charts';
import { executeQueryPlan } from '../executePlan';
import { buildCsvPackage, buildXlsx } from '../exports';
import { parseQueryPlan, planPeriods, type QueryPlan } from '../plan';
import { resultSummary, resultViewSchema } from '../presentation';
import { researchAnalysisSchema } from '../researchAnalysisView';
import { describePlanRead } from '../snapshotReader';
import { assertMultiMetricResultSize, combineMetricResults, MULTI_METRIC_LIMITS } from '../multiMetric';
import { resolveNumericFact } from '../facts';
import { fixture, nameSource, source } from './fixtures';

const scope = { inventory: 'tracked' };
function plan(extra: Record<string, unknown> = {}) {
  return parseQueryPlan({ operation: 'group_trend', metric: 'rent', metrics: ['rent', 'vacancy'], groupBy: 'submarket',
    start: { year: 2026, quarter: 2 }, end: { year: 2026, quarter: 3 }, mode: 'per_period', scope, ...extra });
}
function snapshots(p: QueryPlan) {
  return planPeriods(p).map(period => {
    const original = fixture(period!);
    return { ...original, queryScope: { ...p.scope, filter: p.filter ?? null, requestedFields: describePlanRead(p).fields, inventoryTime: 'current_catalog' },
      rows: original.rows.map((row, i) => ({ ...row, dimensions: Object.fromEntries((['submarket', 'grade'] as const).map(field => {
        const value = field === 'submarket' ? ['CBD', 'CBD', '金融街', '金融街'][i] : ['A', 'A', 'B', 'B'][i];
        return [field, { value, source: { ...row.nameSource, field, rawValue: value, id: `${field}/${row.id}` } }];
      })) })) };
  });
}
const run = (p = plan()) => executeQueryPlan(p, snapshots(p));

describe('bounded multi-metric same-snapshot queries', () => {
  it('reads and authorizes the union of required fields, refusing a missing secondary field', () => {
    const p = plan();
    expect(describePlanRead(p).fields).toEqual(['netEffectiveRent', 'totalArea', 'vacantArea']);
    const authority = { actorId: 'a', effectiveUserId: 'a', sessionActive: true, policyVersion: '1', permissionRevision: '1',
      grants: ['query:catalog', 'query:quarter'] as const, fields: ['totalArea', 'netEffectiveRent'] as const };
    expect(() => authorizePlan(p, authority)).toThrow('QUERY_DENIED');
    expect(() => authorizePlan(p, { ...authority, fields: [...authority.fields, 'vacantArea'] })).not.toThrow();
  });

  it('preserves every grouped metric, independent samples and one canonical source registry', () => {
    const r = run();
    expect(r.parameters.metrics).toEqual(['rent', 'vacancy']);
    const cbd = r.table.rows.filter(row => row.cells.name.kind === 'text' && row.cells.name.value === 'CBD');
    expect(cbd.map(row => row.cells.value)).toMatchObject([{ value: { numeric: 157.5 } }, { value: { numeric: 175 } }]);
    expect(cbd.map(row => row.cells.vacancy_value)).toMatchObject([{ value: { numeric: .125 } }, { value: { numeric: .175 } }]);
    const financial = r.table.rows.filter(row => row.cells.name.kind === 'text' && row.cells.name.value === '金融街');
    expect(financial[1].cells.usedCount).toMatchObject({ value: { numeric: 1 } });
    expect(financial[1].cells.vacancy_usedCount).toMatchObject({ value: { numeric: 0 } });
    expect(financial[1].cells.vacancy_value.kind).toBe('unknown');
    expect(new Set(r.sources.map(source => source.id)).size).toBe(r.sources.length);
    expect(resultViewSchema.safeParse(r).success).toBe(true);
    expect(resultSummary(resultViewSchema.parse(r)).join('')).toMatch(/净有效租金.*空置率/);
    expect(r.limitations.join('')).toContain('不代表跨指标共同有效样本');
  });

  it('retains both deterministic research series and separate metric-specific paired samples', () => {
    const r = run(plan({ mode: 'paired' })), research = researchAnalysisSchema.parse(r.parameters.researchAnalysis);
    expect(research.series).toHaveLength(4);
    expect(new Set(research.series.map(series => series.key)).size).toBe(4);
    expect(new Set(research.findings.map(finding => finding.id)).size).toBe(research.findings.length);
    const financialRent = research.series.find(series => series.metric === 'rent' && series.label.includes('金融街'))!;
    const financialVacancy = research.series.find(series => series.metric === 'vacancy' && series.label.includes('金融街'))!;
    expect(financialRent.commonEntityIds).toEqual(['D']);
    expect(financialVacancy.commonEntityIds).toEqual([]);
    const cbdVacancy = research.series.find(series => series.metric === 'vacancy' && series.label.includes('CBD'))!;
    expect(cbdVacancy.overall?.changeUnit).toBe('percentage_point');
    expect(cbdVacancy.overall?.change?.numeric).toBe(5);
    const sourceIds = new Set(r.sources.map(source => source.id));
    expect(research.findings.every(finding => finding.sourceIds.every(id => sourceIds.has(id)))).toBe(true);
  });

  it('renders each trend metric from the wide table with the correct unit and source binding', () => {
    const r = resultViewSchema.parse(run());
    const c = buildResultChart(r, { kind: 'grouped_time_series', metric: 'vacancy' });
    expect(c.yUnit).toBe('ratio');
    expect(c.facets?.find(facet => facet.label === 'CBD')?.points.map(point => point.y)).toEqual([12.5, 17.5]);
    expect(c.points.every(point => point.yCell.key === 'vacancy_value')).toBe(true);
    expect(() => buildResultChart(r, { kind: 'grouped_time_series', metric: 'totalArea' })).toThrow();
  });

  it.each([
    { metrics: ['vacancy', 'rent'] }, { metrics: ['rent', 'rent'] }, { metrics: ['rent'] },
    { metrics: ['rent', 'vacancy', 'totalArea', 'rent'] }, { metrics: ['rent', 'askingRent'] },
  ])('rejects illegal, duplicate or ambiguous metric bundles %j', extra => {
    expect(() => plan(extra)).toThrow();
  });

  it('rejects a snapshot that only contains the primary metric authorization metadata', () => {
    const p = plan(), ss = snapshots(p).map(snapshot => ({ ...snapshot, queryScope: { ...snapshot.queryScope, requestedFields: ['netEffectiveRent', 'totalArea'] } }));
    expect(() => executeQueryPlan(p, ss)).toThrow('QUERY_SNAPSHOT_PLAN_MISMATCH');
  });

  it('retains filtered-out and unknown evidence for every metric without a second filter universe', () => {
    const p = plan({ filter: { field: 'netEffectiveRent', operator: 'gt', value: '150' } }), r = run(p);
    expect(r.parameters.filterEvaluation).toMatchObject([{ matched: 2 }, { matched: 1, unknown: 1 }]);
    const cbdCurrent = r.table.rows.find(row => row.cells.name.kind === 'text' && row.cells.name.value === 'CBD' && row.cells.period.kind === 'text' && row.cells.period.value === '2026-Q3')!;
    expect(cbdCurrent.cells.value).toMatchObject({ value: { numeric: 200 } });
    expect(cbdCurrent.cells.vacancy_value).toMatchObject({ value: { numeric: .2 } });
    expect(r.sources.some(source => source.entityId === 'C' && source.field === 'net_effective_rent')).toBe(true);
  });

  it('exports both metrics and their exact evidence in CSV and XLSX without recomputation', async () => {
    const r = run(), csv = buildCsvPackage(r), manifest = JSON.parse(csv.manifest);
    expect(csv.csv).toContain('vacancy_value:精确值');
    expect(manifest.analysis).toEqual(r.analysis);
    expect(manifest.parameters.metrics).toEqual(['rent', 'vacancy']);
    const book = XLSX.read(await buildXlsx(r), { type: 'array' });
    const rows = XLSX.utils.sheet_to_json<unknown[]>(book.Sheets['数据'], { header: 1 });
    expect(rows[0].some(value => typeof value === 'string' && value.includes('空置率'))).toBe(true);
    expect(rows.slice(1).flat()).toContain(.175);
  });

  it('uses each metric own denominator in the scalar and two-period wide tables', () => {
    const p = parseQueryPlan({ operation: 'aggregate', metric: 'rent', metrics: ['rent', 'vacancy', 'totalArea'], period: { year: 2026, quarter: 3 }, scope });
    const r = run(p), row = r.table.rows[0];
    expect(row.cells.value).toMatchObject({ value: { numeric: 170 } });
    expect(row.cells.usedCount).toMatchObject({ value: { numeric: 3 } });
    expect(row.cells.denominator).toMatchObject({ value: { numeric: 50000 } });
    expect(row.cells.vacancy_value).toMatchObject({ value: { numeric: .175 } });
    expect(row.cells.vacancy_usedCount).toMatchObject({ value: { numeric: 2 } });
    expect(row.cells.vacancy_denominator).toMatchObject({ value: { numeric: 40000 } });
    expect(row.cells.totalArea_value).toMatchObject({ value: { numeric: 70000 } });
    expect(row.cells.totalArea_denominator).toMatchObject({ value: { numeric: 4 } });
    const c = run(parseQueryPlan({ operation: 'compare', metric: 'rent', metrics: ['rent', 'vacancy'], base: { year: 2026, quarter: 2 }, current: { year: 2026, quarter: 3 }, mode: 'paired', scope }));
    expect(c.table.rows[0].cells.baseUsedCount).toMatchObject({ value: { numeric: 3 } });
    expect(c.table.rows[0].cells.vacancy_baseUsedCount).toMatchObject({ value: { numeric: 2 } });
    expect(c.table.rows[0].cells.vacancy_change).toMatchObject({ value: { numeric: 5 } });
    const chart = buildResultChart(resultViewSchema.parse(c), { kind: 'period_comparison', metric: 'vacancy' });
    expect(chart.points.map(point => point.y)).toEqual([12.5, 17.5]);
    expect(chart.points.map(point => point.yCell.key)).toEqual(['vacancy_base', 'vacancy_current']);
  });

  it('keeps three metric cross tables, empty intersections and Excel matrices', async () => {
    const p = parseQueryPlan({ operation: 'cross_aggregate', metric: 'rent', metrics: ['rent', 'vacancy', 'totalArea'], period: { year: 2026, quarter: 3 }, scope });
    const r = run(p), v = resultViewSchema.parse(r);
    expect(r.table.rows).toHaveLength(4);
    expect(r.table.columns.length).toBeLessThanOrEqual(30);
    const chart = buildResultChart(v, { kind: 'heatmap', metric: 'vacancy' });
    expect(chart.points.find(point => point.label === 'CBD / A')).toMatchObject({ y: 17.5, sampleCount: 2, yCell: { key: 'vacancy_value' } });
    expect(chart.points.find(point => point.label === '金融街 / A')).toMatchObject({ y: null, sampleCount: 0 });
    const book = XLSX.read(await buildXlsx(r), { type: 'array' });
    expect(book.Sheets['交叉指标']).toBeDefined();
    expect(book.Sheets['空置率交叉指标']).toBeDefined();
    expect(book.Sheets['季度总面积交叉分母']).toBeDefined();
  });

  it('rejects forged metric-to-column mappings and bounds the complete archived result', () => {
    const result = run(), forged = structuredClone(resultViewSchema.parse(result));
    (forged.parameters.metricColumns as Record<string, Record<string, string>>).vacancy.value = 'value';
    expect(() => buildResultChart(forged, { kind: 'grouped_time_series', metric: 'vacancy' })).toThrow('MULTI_METRIC_COLUMNS_INVALID');
    const omitted = structuredClone(resultViewSchema.parse(result));
    delete (omitted.parameters.metricColumns as Record<string, Record<string, string>>).vacancy.usedCount;
    expect(() => buildResultChart(omitted, { kind: 'grouped_time_series', metric: 'vacancy' })).toThrow('MULTI_METRIC_COLUMNS_INVALID');
    expect(() => assertMultiMetricResultSize({ ...result, limitations: ['x'.repeat(MULTI_METRIC_LIMITS.resultBytes)] })).toThrow('QUERY_SCOPE_REQUIRES_BACKGROUND_JOB');
  });

  it('shares one global anomaly budget across metrics and reports all omitted alerts accurately', () => {
    const p = parseQueryPlan({ operation: 'trend', metric: 'rent', metrics: ['rent', 'vacancy'], start: { year: 2026, quarter: 2 },
      end: { year: 2026, quarter: 3 }, mode: 'per_period', scope });
    const ss = snapshots(p).map(snapshot => ({ ...snapshot, expectedCount: 80,
      rows: Array.from({ length: 80 }, (_, index) => {
        const id = `M${index}`, period = snapshot.period!, second = period.quarter === 3;
        return { id, name: id, nameSource: nameSource(id, id), facts: {
          totalArea: resolveNumericFact('totalArea', id, [source(id, 'totalArea', 10000, period)], period),
          netEffectiveRent: resolveNumericFact('netEffectiveRent', id, [source(id, 'netEffectiveRent', second ? 200 : 100, period)], period),
          vacantArea: resolveNumericFact('vacantArea', id, [source(id, 'vacantArea', second ? 3000 : 1000, period)], period),
        } };
      }) }));
    const research = researchAnalysisSchema.parse(executeQueryPlan(p, ss).parameters.researchAnalysis);
    expect(research.resourceUsage?.status).toBe('limited');
    expect(research.series.reduce((sum, series) => sum + series.anomalies.length, 0)).toBe(100);
    expect(research.series.reduce((sum, series) => sum + series.anomalyCoverage!.detected, 0)).toBe(160);
    expect(research.series.reduce((sum, series) => sum + series.anomalyCoverage!.omitted, 0)).toBe(60);
    expect(research.series.every(series => series.periods.every(period => period.usedCount === 80))).toBe(true);
    expect(research.findings.some(finding => finding.text.includes('60 条未列举'))).toBe(true);
  });

  it('refuses combining different snapshot identities or conflicting source bodies', () => {
    const p = parseQueryPlan({ operation: 'aggregate', metric: 'rent', period: { year: 2026, quarter: 3 }, scope });
    const rent = run(p), vacancy = run(parseQueryPlan({ ...p, metric: 'vacancy' }));
    expect(() => combineMetricResults([{ metric: 'rent', result: rent }, { metric: 'vacancy', result: { ...vacancy, dataVersion: 'other-version' } }])).toThrow('MULTI_METRIC_SNAPSHOT_MISMATCH');
    const sharedScope = { ...vacancy, parameters: { ...vacancy.parameters, scope: rent.parameters.scope },
      sources: vacancy.sources.map(item => item.id === 'name/A' ? { ...item, rawValue: 'forged' } : item) };
    expect(() => combineMetricResults([{ metric: 'rent', result: rent }, { metric: 'vacancy', result: sharedScope }])).toThrow('SOURCE_ID_COLLISION');
  });
});
