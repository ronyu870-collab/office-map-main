import { describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';
import { authorizePlan } from '../admission';
import { buildResultChart, chartBounds, renderChartSvg } from '../charts';
import { executeQueryPlan } from '../executePlan';
import { buildCsvPackage, buildXlsx } from '../exports';
import { resolveNumericFact } from '../facts';
import { assertMultiMetricResultSize } from '../multiMetric';
import { parseQueryPlan, planPeriods, type QueryPlan } from '../plan';
import { resultSummary, resultViewSchema, type QueryResultView } from '../presentation';
import { researchAnalysisSchema } from '../researchAnalysisView';
import { describePlanRead } from '../snapshotReader';
import { crossTrendPlan as plan, crossTrendSnapshots as snapshots } from './crossTrendFixture';
import { nameSource, source } from './fixtures';

const run = (p = plan()) => executeQueryPlan(p, snapshots(p));
const matching = (result: ReturnType<typeof run>, region: string, grade: string) => result.table.rows.filter(row =>
  row.cells.name.kind === 'text' && row.cells.name.value === region && row.cells.grade.kind === 'text' && row.cells.grade.value === grade);
function manyGroups(p: QueryPlan, regions: number, grades: number) {
  return snapshots(p).map(snapshot => ({ ...snapshot, expectedCount: Math.max(regions, grades),
    rows: Array.from({ length: Math.max(regions, grades) }, (_, index) => {
      const id = `synthetic-${index}`, name = `合成${index}`, identity = nameSource(id, name);
      return { id, name, nameSource: identity, facts: Object.fromEntries((['totalArea', 'netEffectiveRent', 'vacantArea'] as const).map(field =>
        [field, resolveNumericFact(field, id, [source(id, field, field === 'totalArea' ? 10000 : field === 'netEffectiveRent' ? 100 : 1000, snapshot.period, String(snapshot.period!.year))], snapshot.period)])),
      dimensions: Object.fromEntries((['submarket', 'grade'] as const).map(field => {
        const value = `${field}-${index % (field === 'submarket' ? regions : grades)}`;
        return [field, { value, source: { ...identity, id: `${field}/${id}`, field, rawValue: value } }];
      })) };
    }),
  }));
}

describe('same-snapshot submarket × grade quarterly trends', () => {
  it('authorizes the complete metric union and accepts only the fixed dimensions and bounded continuous periods', () => {
    const p = plan();
    expect(describePlanRead(p)).toEqual({ fields: ['netEffectiveRent', 'totalArea', 'vacantArea'], periods: [{ year: 2026, quarter: 2 }, { year: 2026, quarter: 3 }] });
    const authority = { actorId: 'a', effectiveUserId: 'a', sessionActive: true, policyVersion: '1', permissionRevision: '1',
      grants: ['query:catalog', 'query:quarter'] as const, fields: ['totalArea', 'netEffectiveRent'] as const };
    expect(() => authorizePlan(p, authority)).toThrow('QUERY_DENIED');
    expect(() => authorizePlan(p, { ...authority, fields: [...authority.fields, 'vacantArea'] })).not.toThrow();
    for (const extra of [{ groupBy: 'grade' }, { dimensions: ['submarket', 'owner'] }, { start: { year: 2026, quarter: 3 } },
      { end: { year: 2036, quarter: 3 } }, { metrics: ['vacancy', 'rent'] }, { metrics: ['rent'] }]) expect(() => plan(extra)).toThrow();
  });

  it('retains both independent axes, every quarter and each metric own valid sample and denominator', () => {
    const r = run();
    expect(r.operation).toBe('cross_trend');
    expect(r.parameters).toMatchObject({ tableVersion: 'cross-trend/1', rowDimension: 'submarket', columnDimension: 'grade' });
    expect(r.table.rows).toHaveLength(8);
    expect(r.table.columns.slice(0, 3).map(column => column.key)).toEqual(['name', 'grade', 'period']);
    const cbd = matching(r, 'CBD', 'A'), financial = matching(r, '金融街', 'B');
    expect(cbd.map(row => row.cells.value)).toMatchObject([{ value: { exact: { numerator: '410', denominator: '3' } } }, { value: { numeric: 100 } }]);
    expect(financial.map(row => row.cells.value)).toMatchObject([{ value: { numeric: 170 } }, { value: { numeric: 187.5 } }]);
    expect(financial[1].cells.vacancy_value).toMatchObject({ value: { numeric: .2 } });
    expect(financial[1].cells.usedCount).toMatchObject({ value: { numeric: 2 } });
    expect(financial[1].cells.vacancy_usedCount).toMatchObject({ value: { numeric: 1 } });
    expect(financial[1].cells.denominator).toMatchObject({ value: { numeric: 40000 } });
    expect(financial[1].cells.vacancy_denominator).toMatchObject({ value: { numeric: 30000 } });
    expect(matching(r, 'CBD', 'B').every(row => row.cells.value.kind === 'unknown')).toBe(true);
    expect(r.sources.filter(source => ['submarket', 'grade'].includes(source.field))).toHaveLength(8);
    expect(new Set(r.sources.map(source => source.id)).size).toBe(r.sources.length);
    expect(resultViewSchema.safeParse(r).success).toBe(true);
  });

  it('pairs all requested quarters separately inside each cell and each metric, with verifiable research evidence', () => {
    const r = run(plan({ mode: 'paired' })), research = researchAnalysisSchema.parse(r.parameters.researchAnalysis);
    const cbd = matching(r, 'CBD', 'A');
    expect(cbd.map(row => row.cells.value)).toMatchObject([{ value: { numeric: 90 } }, { value: { numeric: 100 } }]);
    expect(cbd.map(row => row.cells.availableCount)).toMatchObject([{ value: { numeric: 2 } }, { value: { numeric: 1 } }]);
    expect(cbd.every(row => row.cells.usedCount.kind === 'number' && row.cells.usedCount.value.numeric === 1)).toBe(true);
    expect(research.series).toHaveLength(8);
    const financial = research.series.filter(item => item.label.startsWith('金融街 / B'));
    expect(financial.find(item => item.metric === 'rent')?.commonEntityIds).toEqual(['B', 'D']);
    expect(financial.find(item => item.metric === 'vacancy')?.commonEntityIds).toEqual(['B']);
    expect(financial.find(item => item.metric === 'vacancy')?.overall).toMatchObject({ changeUnit: 'percentage_point', change: { numeric: 10 } });
    const ids = new Set(r.sources.map(source => source.id));
    for (const item of research.series) expect(item.classificationSourceIds?.every(id => ids.has(id))).toBe(true);
    const findings = research.findings.filter(item => item.evidence.metric === 'vacancy' && item.sourceIds.includes('grade/B'));
    expect(findings.length).toBeGreaterThan(0);
    expect(findings.every(item => item.sourceIds.includes('submarket/B'))).toBe(true);
    expect(resultSummary(resultViewSchema.parse(r)).join('')).toContain('每格');
  });

  it('keeps filtered-out cells and unknown filters visible without pooling across a dimension', () => {
    const r = run(plan({ filter: { field: 'netEffectiveRent', operator: 'gt', value: '150' } }));
    expect(r.table.rows).toHaveLength(8);
    expect(r.parameters.filterEvaluation).toMatchObject([{ matched: 2 }, { matched: 1, unknown: 1 }]);
    expect(matching(r, 'CBD', 'A')[1].cells.value.kind).toBe('unknown');
    expect(matching(r, '金融街', 'B')[1].cells.value).toMatchObject({ value: { numeric: 200 } });
    expect(matching(r, '金融街', 'B')[1].cells.vacancy_value).toMatchObject({ value: { numeric: .2 } });
    expect(r.sources.some(source => source.id === 'grade/C')).toBe(true);
  });

  it('keeps explicit empty markets, true-null classes and no-data periods without inventing values', () => {
    const p = plan({ scope: { inventory: 'tracked', submarkets: ['CBD', '金融街', '丽泽'] }, mode: 'paired' });
    const ss = snapshots(p, ['CBD', '金融街', 'CBD', '金融街'], ['null', null, 'A', '']);
    ss[1] = { ...ss[1], rows: ss[1].rows.map(row => ({ ...row, facts: { ...row.facts,
      netEffectiveRent: resolveNumericFact('netEffectiveRent', row.id, [], ss[1].period) } })) };
    const r = executeQueryPlan(p, ss);
    expect(r.parameters.columnGroups).toEqual(expect.arrayContaining([expect.objectContaining({ value: 'null' }), expect.objectContaining({ value: null })]));
    expect(r.table.rows.every(row => row.cells.value.kind === 'unknown')).toBe(true);
    expect(matching(r, '丽泽', 'A')).toHaveLength(2);
    const empty = executeQueryPlan(p, ss.map(snapshot => ({ ...snapshot, rows: [], expectedCount: 0 })));
    expect(empty.table.rows).toHaveLength(0);
    expect(resultSummary(resultViewSchema.parse(empty)).join('')).toContain('不知道');
  });

  it('rejects changed membership, forged dimension provenance and missing-quarter universes', () => {
    const p = plan(), moved = snapshots(p);
    moved[1] = { ...moved[1], rows: moved[1].rows.map((row, index) => index ? row : { ...row,
      dimensions: { ...row.dimensions, grade: { value: 'B', source: { ...row.dimensions!.grade!.source, rawValue: 'B' } } } }) };
    expect(() => executeQueryPlan(p, moved)).toThrow('GROUP_MEMBERSHIP_CHANGED');
    const forged = snapshots(p); forged[0] = { ...forged[0], rows: forged[0].rows.map((row, index) => index ? row : { ...row,
      dimensions: { ...row.dimensions, grade: { ...row.dimensions!.grade!, source: { ...row.dimensions!.grade!.source, recordId: 'B' } } } }) };
    expect(() => executeQueryPlan(p, forged)).toThrow('GROUP_SOURCE_REQUIRED');
    expect(() => executeQueryPlan(p, snapshots(p).slice(0, 1))).toThrow('QUERY_SNAPSHOT_PERIOD_MISMATCH');
  });

  it('renders each metric as source-bound cell facets and rejects reordered, relabeled or incomplete axes', () => {
    const r = resultViewSchema.parse(run()), chart = buildResultChart(r, { kind: 'grouped_time_series', metric: 'vacancy' });
    expect(chart.kind).toBe('faceted_line'); expect(chart.facets).toHaveLength(4);
    expect(chart.facets?.find(facet => facet.label === '金融街 / B')?.points.map(point => point.y)).toEqual([10, 20]);
    expect(chartBounds(chart, 'y')).toEqual([0, 100]);
    expect(chart.points.every(point => point.yCell.key === 'vacancy_value')).toBe(true);
    for (const mutate of [
      (value: QueryResultView) => value.table.rows.reverse(),
      (value: QueryResultView) => value.table.rows.pop(),
      (value: QueryResultView) => { value.table.rows[0].cells.grade = { kind: 'text', value: 'forged', sourceIds: [] }; },
      (value: QueryResultView) => { value.parameters.columnGroups = []; },
    ]) {
      const forged = structuredClone(r); mutate(forged);
      expect(() => buildResultChart(forged, { kind: 'grouped_time_series', metric: 'vacancy' })).toThrow('CHART_CROSS_AXIS_MISMATCH');
    }
    const bar = buildResultChart(r, { kind: 'bar', field: 'value', metric: 'vacancy' });
    expect(bar.points.every(point => /\/.+2026-Q/.test(point.label))).toBe(true);
    expect(bar.xLabel).toBe('子市场 × 等级 / 季度');
    const xml = new DOMParser().parseFromString(renderChartSvg(chart), 'image/svg+xml');
    expect(xml.querySelector('parsererror')).toBeNull();
    expect(xml.documentElement.textContent).toContain('金融街 / B');
  });

  it('exports the full three-metric long table with both dimensions, exact values, sources and stored unknowns', async () => {
    const r = run(plan({ metrics: ['rent', 'vacancy', 'totalArea'] }));
    expect(r.table.columns).toHaveLength(18);
    const csv = buildCsvPackage(r), manifest = JSON.parse(csv.manifest);
    expect(csv.csv).toContain('vacancy_value:精确值'); expect(csv.csv).toContain('grade:来源'); expect(csv.csv).toContain('period:来源');
    expect(manifest.analysis).toEqual(r.analysis); expect(manifest.sources).toEqual(r.sources);
    const book = XLSX.read(await buildXlsx(r), { type: 'array' });
    const rows = XLSX.utils.sheet_to_json<unknown[]>(book.Sheets['数据'], { header: 1 });
    expect(rows).toHaveLength(9); expect(rows[0].slice(1, 4)).toEqual(['子市场', '等级', '季度']);
    expect(rows.slice(1).flat()).toContain(.2); expect(rows.slice(1).flat()).toContain('未记录');
    expect(book.Sheets['口径与快照'].B2.v).toBe(r.resultId);
  });

  it('enforces 50 facets and 1000 metric points before calculating large outputs, without changing the single-quarter 400-cell limit', () => {
    const single = plan({ metrics: undefined });
    expect(() => executeQueryPlan(single, manyGroups(single, 7, 8))).toThrow('QUERY_SCOPE_REQUIRES_BACKGROUND_JOB');
    expect(executeQueryPlan(single, manyGroups(single, 10, 5)).table.rows).toHaveLength(100);
    const quarterly = parseQueryPlan({ operation: 'cross_aggregate', metric: 'rent', period: { year: 2026, quarter: 3 }, scope: { inventory: 'tracked' } });
    expect(executeQueryPlan(quarterly, manyGroups(quarterly, 7, 8)).table.rows).toHaveLength(56);
    const three = plan({ metrics: ['rent', 'vacancy', 'totalArea'], start: { year: 2025, quarter: 1 } });
    expect(() => executeQueryPlan(three, manyGroups(three, 10, 5))).toThrow('QUERY_SCOPE_REQUIRES_BACKGROUND_JOB');
    const forty = plan({ metrics: undefined, start: { year: 2017, quarter: 1 }, end: { year: 2026, quarter: 4 } });
    expect(planPeriods(forty)).toHaveLength(40);
    expect(executeQueryPlan(forty, manyGroups(forty, 5, 5)).table.rows).toHaveLength(1000);
    const oversized = { ...run(single), limitations: ['x'.repeat(16 * 1024 * 1024)] };
    expect(() => assertMultiMetricResultSize(oversized)).toThrow('QUERY_SCOPE_REQUIRES_BACKGROUND_JOB');
  });

  it('uses the full three-quarter intersection and draws true zero separately from a missing quarter', () => {
    const p = plan({ start: { year: 2026, quarter: 1 }, mode: 'paired' }), ss = snapshots(p);
    // A is valid at both ends but absent in the middle; C is valid only in Q2.
    ss[1] = { ...ss[1], rows: ss[1].rows.map(row => row.id !== 'A' ? row : { ...row, facts: { ...row.facts,
      netEffectiveRent: resolveNumericFact('netEffectiveRent', row.id, [], ss[1].period) } }) };
    const r = executeQueryPlan(p, ss);
    expect(matching(r, 'CBD', 'A').every(row => row.cells.value.kind === 'unknown')).toBe(true);
    const per = plan({ metric: 'vacancy', metrics: undefined }), zero = snapshots(per);
    zero[0] = { ...zero[0], rows: zero[0].rows.map(row => ({ ...row, facts: { ...row.facts,
      vacantArea: resolveNumericFact('vacantArea', row.id, [source(row.id, 'vacantArea', 0, zero[0].period)], zero[0].period) } })) };
    const chart = buildResultChart(resultViewSchema.parse(executeQueryPlan(per, zero)), { kind: 'grouped_time_series' });
    expect(chart.facets?.find(facet => facet.label === 'CBD / A')?.points[0]).toMatchObject({ y: 0, state: 'valid' });
    expect(chart.facets?.find(facet => facet.label === 'CBD / B')?.points[0]).toMatchObject({ y: null, state: 'unknown' });
  });
});
