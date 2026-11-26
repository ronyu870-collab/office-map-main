import { describe, expect, it } from 'vitest';
import JSZip from 'jszip';
import * as XLSX from 'xlsx';
import { trendQuarters } from '../analytics';
import { buildResultArtifact } from '../artifacts';
import { buildResultChart, lineGeometry, renderChartSvg } from '../charts';
import { executeQueryPlan } from '../executePlan';
import { resolveNumericFact } from '../facts';
import { parseQueryPlan, quarterRange } from '../plan';
import { resultViewSchema, resultSummary } from '../presentation';
import { resolveBusinessQuestion } from '../question';
import { buildListResult, buildTrendResult, resultDigest } from '../result';
import { describePlanRead } from '../snapshotReader';
import type { FactSnapshot } from '../contracts';
import { fixture, source } from './fixtures';

const q = (quarter: number) => ({ year: 2026, quarter });
const plan = () => parseQueryPlan({ operation: 'trend', metric: 'rent', start: q(1), end: q(4), mode: 'per_period', scope: { inventory: 'tracked', submarkets: ['CBD'] } });
function empty(s: FactSnapshot): FactSnapshot {
  return { ...s, rows: s.rows.map(row => ({ ...row, facts: { ...row.facts,
    netEffectiveRent: resolveNumericFact('netEffectiveRent', row.id, [], s.period),
  } })) };
}
const series = () => [fixture(q(1)), fixture(q(2)), empty(fixture(q(3))), fixture(q(4))];
const view = () => resultViewSchema.parse(buildTrendResult(series(), 'rent', 'per_period'));

describe('continuous quarterly trends and immutable line artifacts', () => {
  it('expands the inclusive cross-year interval and enforces the 2–40 quarter budget', () => {
    expect(quarterRange({ year: 2025, quarter: 4 }, q(2))).toEqual([{ year: 2025, quarter: 4 }, q(1), q(2)]);
    expect(quarterRange({ year: 2017, quarter: 1 }, q(4))).toHaveLength(40);
    for (const end of [q(1), { year: 2025, quarter: 4 }, { year: 2036, quarter: 1 }, q(5)]) {
      expect(() => quarterRange(q(1), end)).toThrow();
    }
    expect(describePlanRead(plan()).periods).toEqual([q(1), q(2), q(3), q(4)]);
  });
  it('requires a complete explicit question including sample mode and preserves all conditions', () => {
    expect(resolveBusinessQuestion('CBD净有效租金2026Q1至2026年第三季度趋势各期样本')).toMatchObject({ kind: 'plan', plan: { operation: 'trend', start: q(1), end: q(3), mode: 'per_period' } });
    expect(resolveBusinessQuestion('CBD空置率2026Q1到2026Q4趋势全期间共同样本')).toMatchObject({ kind: 'plan', plan: { metric: 'vacancy', mode: 'paired' } });
    for (const question of ['CBD净有效租金今年趋势各期样本', 'CBD净有效租金2026Q1至2026Q3趋势', 'CBD净有效租金2026Q3至2026Q1趋势各期样本', 'CBD净有效租金2026Q1至2036Q1趋势各期样本', 'CBD净有效租金2026Q1至2026Q3趋势各期样本排除A楼']) {
      expect(resolveBusinessQuestion(question).kind).toBe('clarification');
    }
  });
  it('uses exact weighted totals and retains each quarter’s coverage and denominator', () => {
    const trend = trendQuarters([fixture(q(2)), fixture(q(3))], 'rent', 'per_period');
    expect(trend.periods[0].value).toMatchObject({ exact: { numerator: '1090', denominator: '7' } });
    expect(trend.periods[1]).toMatchObject({ value: { numeric: 170 }, denominator: { numeric: 50000 }, availableCoverage: { total: 4, valid: 3, missing: 1 } });
    const paired = trendQuarters([fixture(q(2)), fixture(q(3))], 'vacancy', 'paired');
    expect(paired.periods.map(p => p.value?.numeric)).toEqual([.125, .175]);
    expect(paired.periods[1].availableCoverage).toMatchObject({ missing: 1, invalid: 1 });
  });
  it('intersects all quarters, rather than using changing adjacent pairs', () => {
    const snapshots = [fixture(q(1)), fixture(q(2)), fixture(q(3))].map((s, i) => ({ ...s, rows: s.rows.map(row => row.id === ['A', 'B', 'C'][i] ? { ...row, facts: { ...row.facts, netEffectiveRent: resolveNumericFact('netEffectiveRent', row.id, [], s.period) } } : row) }));
    const trend = trendQuarters(snapshots, 'rent', 'paired');
    expect(trend.pairedIds).toEqual(['D']);
    expect(trend.periods.map(p => p.usedEntityIds)).toEqual([['D'], ['D'], ['D']]);
    expect(trend.periods.map(p => p.value?.numeric)).toEqual([150, 140, 150]);
    expect(trend.periods.map(p => p.denominator.numeric)).toEqual([10000, 10000, 10000]);
  });
  it('retains an unknown quarter and makes an empty all-period intersection explicit', () => {
    const result = view();
    expect(result.table.rows.map(r => r.cells.value.kind)).toEqual(['number', 'number', 'unknown', 'number']);
    const paired = buildTrendResult(series(), 'rent', 'paired');
    expect(paired.table.rows.every(r => r.cells.value.kind === 'unknown')).toBe(true);
    expect(resultSummary(resultViewSchema.parse(paired)).join('')).toContain('不知道');
    expect(paired.analysis).toMatchObject({ pairedIds: [] });
  });
  it('orders snapshots by requested time and rejects missing, duplicate or mixed-authority inputs', () => {
    const p = plan(), read = describePlanRead(p);
    const snapshots = series().map(s => ({ ...s, queryScope: { ...p.scope, filter: null, requestedFields: read.fields, inventoryTime: 'current_catalog' as const, brochureSelection: 'all_unresolved_record_candidates' as const } }));
    expect(executeQueryPlan(p, [...snapshots].reverse()).table.rows.map(r => r.entityId)).toEqual(['2026-Q1', '2026-Q2', '2026-Q3', '2026-Q4']);
    expect(() => executeQueryPlan(p, snapshots.slice(1))).toThrow('QUERY_SNAPSHOT_PERIOD_MISMATCH');
    expect(() => executeQueryPlan(p, [snapshots[0], snapshots[0], ...snapshots.slice(2)])).toThrow('QUERY_SNAPSHOT_PERIOD_MISMATCH');
    expect(() => executeQueryPlan(p, [{ ...snapshots[0], dataVersion: 'other' }, ...snapshots.slice(1)])).toThrow('QUERY_SNAPSHOT_VERSION_MISMATCH');
    expect(() => executeQueryPlan(p, [{ ...snapshots[0], rows: snapshots[0].rows.slice(1), expectedCount: 3 }, ...snapshots.slice(1)])).toThrow('QUERY_SNAPSHOT_UNIVERSE_MISMATCH');
    expect(() => trendQuarters([fixture(q(1)), fixture(q(3))], 'rent', 'per_period')).toThrow('TREND_CONSECUTIVE_QUARTERS_REQUIRED');
  });
  it('breaks line segments at missing quarters, while genuine zero still produces a point', () => {
    const chart = buildResultChart(view(), { kind: 'time_series' }), geometry = lineGeometry(chart);
    expect(chart.points.map(p => p.y)).toEqual([170, 1090 / 7, null, 170]);
    expect(geometry.segments).toHaveLength(1);
    expect(geometry.points[2].y).toBeNull();
    expect(geometry.points[3].y).not.toBeNull();
    const original = fixture(q(2));
    const zero = { ...original, rows: original.rows.map(row => ({ ...row, facts: { ...row.facts, vacantArea: resolveNumericFact('vacantArea', row.id, [source(row.id, 'vacantArea', 0, original.period)], original.period) } })) };
    const vacancy = buildResultChart(resultViewSchema.parse(buildTrendResult([zero, fixture(q(3))], 'vacancy', 'per_period')), { kind: 'time_series' });
    expect(vacancy.points[0]).toMatchObject({ y: 0, state: 'valid' });
    expect(lineGeometry(vacancy)).toMatchObject({ min: 0, max: 100 });
    const svg = new DOMParser().parseFromString(renderChartSvg(chart), 'image/svg+xml');
    expect(svg.querySelector('parsererror')).toBeNull();
    expect(svg.querySelectorAll('polyline')).toHaveLength(1);
    expect(svg.querySelectorAll('circle')).toHaveLength(3);
  });
  it('applies each quarter’s filter before the fixed all-period sample and preserves unknown decisions', () => {
    const p = parseQueryPlan({ ...plan(), start: q(2), end: q(3), mode: 'paired', filter: { field: 'netEffectiveRent', operator: 'gte', value: '100' } });
    const read = describePlanRead(p);
    const snapshots = [fixture(q(2)), fixture(q(3))].map(s => ({ ...s, queryScope: { ...p.scope, filter: p.filter, requestedFields: read.fields } }));
    const result = executeQueryPlan(p, snapshots);
    expect(result.analysis).toMatchObject({ pairedIds: ['B', 'D'], periods: [{ usedEntityIds: ['B', 'D'] }, { usedEntityIds: ['B', 'D'] }] });
    expect(result.parameters.filterEvaluation).toMatchObject([{ matched: 3, notMatched: 1, unknown: 0 }, { matched: 3, notMatched: 0, unknown: 1 }]);
    expect(result.sources.some(s => s.entityId === 'C' && s.period?.quarter === 3)).toBe(true);
  });
  it('refuses categorical lines and forged quarter ordering', () => {
    expect(() => buildResultChart(resultViewSchema.parse(buildListResult(fixture(), ['height'])), { kind: 'time_series' })).toThrow('CHART_TREND_REQUIRED');
    const result = structuredClone(view()); result.table.rows.reverse();
    expect(() => buildResultChart(result, { kind: 'time_series' })).toThrow('CHART_TIME_AXIS_MISMATCH');
  });
  it('reads XLSX, CSV and SVG back with the same exact values, unknowns and source snapshot', async () => {
    const result = buildTrendResult(series(), 'rent', 'per_period'), digest = resultDigest(result);
    const common = { requestId: crypto.randomUUID(), resultId: result.resultId, action: 'export' as const };
    const excel = await buildResultArtifact(result, { ...common, format: 'xlsx' });
    if (excel.type !== 'download') throw new Error();
    const book = XLSX.read(excel.bytes, { type: 'array' });
    expect(book.Sheets['数据'].C2).toMatchObject({ t: 'n', v: 170 });
    expect(book.Sheets['数据'].C4.t).toBe('s');
    expect(book.Sheets['口径与快照'].B2.v).toBe(result.resultId);
    for (const format of ['csv_zip', 'svg_zip'] as const) {
      const artifact = await buildResultArtifact(result, { ...common, format, ...(format === 'svg_zip' ? { chart: { kind: 'time_series' as const } } : {}) });
      if (artifact.type !== 'download') throw new Error();
      const zip = await JSZip.loadAsync(artifact.bytes), manifest = JSON.parse(await zip.file('manifest.json')!.async('string'));
      expect(manifest.sources).toEqual(result.sources); expect(manifest.digest).toBe(digest);
      if (format === 'csv_zip') expect(await zip.file('data.csv')!.async('string')).toContain('1090/7');
      else expect(manifest.chart.points.map((p: { y: number | null }) => p.y)).toEqual([170, 1090 / 7, null, 170]);
    }
    expect(resultDigest(result)).toBe(digest);
  });
});

it('formats every trend axis tick and matches the exported SVG, including long fractional values', () => {
  const result = resultViewSchema.parse(buildTrendResult([fixture(q(1)), fixture(q(2))], 'rent', 'per_period'));
  const chart = buildResultChart(result, { kind: 'time_series' });
  const plot = lineGeometry(chart);
  expect(plot.ticks).toHaveLength(5);
  expect(new Set(plot.ticks.map(tick => tick.label)).size).toBe(5);
  expect(plot.min).toBeLessThanOrEqual(Math.min(...chart.points.flatMap(point => point.y === null ? [] : [point.y])));
  expect(plot.max).toBeGreaterThanOrEqual(Math.max(...chart.points.flatMap(point => point.y === null ? [] : [point.y])));
  const svg = new DOMParser().parseFromString(renderChartSvg(chart), 'image/svg+xml');
  const labels = [...svg.querySelectorAll('text')].map(node => node.textContent);
  for (const tick of plot.ticks) expect(labels).toContain(tick.label);
  for (const point of chart.points) expect(labels).toContain(point.yText);
});
