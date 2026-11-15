import { describe, expect, it } from 'vitest';
import JSZip from 'jszip';
import * as XLSX from 'xlsx';
import { executeQueryPlan } from '../executePlan';
import { parseQueryPlan, planPeriods, type QueryPlan } from '../plan';
import { describePlanRead } from '../snapshotReader';
import { resolveBusinessQuestion } from '../question';
import { buildResultChart, chartBounds, chartFacets, lineGeometry, renderChartSvg } from '../charts';
import { resultViewSchema } from '../presentation';
import { buildResultArtifact } from '../artifacts';
import { groupedQuarterAnalysis } from '../grouping';
import type { CatalogDimension } from '../registry';
import { fixture } from './fixtures';

const scope = { inventory: 'tracked' };
function plan(extra: Record<string, unknown> = {}) { return parseQueryPlan({ operation: 'group_trend', metric: 'rent', groupBy: 'submarket', start: { year: 2026, quarter: 2 }, end: { year: 2026, quarter: 3 }, mode: 'paired', scope, ...extra }); }
function snapshots(p: QueryPlan, markets: (string | null)[] = ['CBD', '金融街', '金融街', null]) {
  return planPeriods(p).map(period => {
    const s = fixture(period!);
    return { ...s, queryScope: { ...p.scope, filter: p.filter ?? null, requestedFields: describePlanRead(p).fields, inventoryTime: 'current_catalog' },
      rows: s.rows.map((row, i) => ({ ...row, dimensions: Object.fromEntries((['submarket', 'grade'] as CatalogDimension[]).map(field => {
        const value = field === 'submarket' ? markets[i] : ['A', 'A', 'B', null][i];
        return [field, { value, source: { ...row.nameSource, field, rawValue: value, id: `${field}/${row.id}` } }];
      })) })) };
  });
}
const result = (p = plan()) => executeQueryPlan(p, snapshots(p));

describe('same-snapshot grouped quarterly analysis', () => {
  it('resolves complete region/grade questions without dropping periods, scope or sample mode', () => {
    expect(resolveBusinessQuestion('2026Q3CBD、金融街净有效租金按子市场比较')).toMatchObject({ kind: 'plan', plan: { operation: 'group_aggregate', metric: 'rent', period: { year: 2026, quarter: 3 }, scope: { submarkets: ['CBD', '金融街'] }, groupBy: 'submarket' } });
    expect(resolveBusinessQuestion('全部获权楼宇空置率2026Q2至2026Q3按等级趋势全期间共同样本')).toMatchObject({ kind: 'plan', plan: { operation: 'group_trend', groupBy: 'grade', mode: 'paired' } });
    for (const question of ['2026Q3CBD、金融街净有效租金按子市场比较忽略C楼', '全部获权楼宇空置率2026Q3至2026Q2按等级趋势全期间共同样本', 'CBD、金融街租金2026Q2至2026Q3按子市场趋势各期样本', 'CBD、金融街净有效租金今年按子市场趋势各期样本']) expect(resolveBusinessQuestion(question).kind).toBe('clarification');
  });
  it('computes each group from its own all-period cohort and keeps explicitly empty regions unknown', () => {
    const r = result();
    const rows = (label: string) => r.table.rows.filter(row => row.cells.name.kind === 'text' && row.cells.name.value === label);
    expect(rows('CBD').map(row => row.cells.value)).toMatchObject([{ value: { numeric: 90 } }, { value: { numeric: 100 } }]);
    expect(rows('金融街').map(row => row.cells.value)).toMatchObject([{ value: { numeric: 180 } }, { value: { numeric: 200 } }]);
    const emptyPlan = plan({ scope: { ...scope, submarkets: ['CBD', '金融街', '丽泽'] } });
    const empty = executeQueryPlan(emptyPlan, snapshots(emptyPlan, ['CBD', '金融街', '金融街', 'CBD']));
    expect(empty.table.rows.filter(row => row.cells.name.kind === 'text' && row.cells.name.value === '丽泽').map(row => row.cells.value.kind)).toEqual(['unknown', 'unknown']);
    expect(r.sources.filter(s => s.field === 'submarket')).toHaveLength(4);
    expect(r.parameters.dimensionVersion).toBe('current-catalog-dimensions/1');
    expect(r.limitations.join('')).toContain('不是跨区域取同一批楼宇');
    const per = result(plan({ mode: 'per_period' }));
    expect(per.table.rows.find(row => row.cells.name.kind === 'text' && row.cells.name.value === '金融街')?.cells.value).toMatchObject({ value: { numeric: 172 } });
  });
  it('keeps unknown classification separate, even from a literal string null', () => {
    const p = plan({ scope: { inventory: 'tracked' } }), ss = snapshots(p, ['null', 'CBD', '', null]);
    const a = groupedQuarterAnalysis(ss, ss, 'submarket', 'rent', 'per_period');
    expect(a.groups.map(g => g.value)).toContain('null'); expect(a.groups.map(g => g.value)).toContain(null);
    expect(a.groups.find(g => g.value === null)?.entityIds).toEqual(['C', 'D']);
    expect(new Set(a.groups.map(g => g.key)).size).toBe(3);
  });
  it('partitions before filtering so an empty filtered group and unknown filter decisions remain visible', () => {
    const p = plan({ filter: { field: 'netEffectiveRent', operator: 'gt', value: '100' } }), r = result(p);
    expect(r.table.rows.filter(row => row.cells.name.kind === 'text' && row.cells.name.value === 'CBD').map(row => row.cells.value.kind)).toEqual(['unknown', 'unknown']);
    expect(r.parameters.filterEvaluation).toMatchObject([{ total: 4, matched: 3 }, { total: 4, matched: 2, unknown: 1 }]);
    expect(r.sources.some(s => s.entityId === 'A' && s.field === 'submarket')).toBe(true);
  });
  it('refuses missing grouping provenance, cross-entity sources and changed membership across one snapshot', () => {
    const p = plan(), ss = snapshots(p);
    const missing = ss.map(s => ({ ...s, rows: s.rows.map(row => ({ ...row, dimensions: undefined })) }));
    expect(() => executeQueryPlan(p, missing)).toThrow('GROUP_SOURCE_REQUIRED');
    const moved = snapshots(p); moved[1].rows[0].dimensions.submarket.value = '金融街';
    expect(() => executeQueryPlan(p, moved)).toThrow('GROUP_SOURCE_REQUIRED');
    moved[1].rows[0].dimensions.submarket.source.rawValue = '金融街';
    expect(() => executeQueryPlan(p, moved)).toThrow('GROUP_MEMBERSHIP_CHANGED');
    const wrong = snapshots(p); wrong[0].rows[0].dimensions.submarket.source.entityId = 'B';
    expect(() => executeQueryPlan(p, wrong)).toThrow('GROUP_SOURCE_REQUIRED');
  });
  it('uses one scale and separate lines for every group, refusing forged group or quarter bindings', () => {
    const r = resultViewSchema.parse(result()), chart = buildResultChart(r, { kind: 'grouped_time_series' });
    expect(chart.kind).toBe('faceted_line'); expect(chart.facets).toHaveLength(3);
    expect(chart.points).toHaveLength(6);
    const bounds = chartBounds(chart, 'y'); expect(bounds).toEqual([0, 200]);
    const parts = chartFacets(chart);
    for (const part of parts) expect(lineGeometry(part, 640, 250, bounds)).toMatchObject({ min: 0, max: 200 });
    const xml = new DOMParser().parseFromString(renderChartSvg(chart), 'image/svg+xml');
    expect(xml.querySelector('parsererror')).toBeNull(); expect(xml.querySelectorAll('polyline')).toHaveLength(3);
    const forged = structuredClone(r); forged.table.rows.reverse();
    expect(() => buildResultChart(forged, { kind: 'grouped_time_series' })).toThrow('CHART_GROUP_AXIS_MISMATCH');
    expect(() => buildResultChart(r, { kind: 'time_series' })).toThrow('CHART_TREND_REQUIRED');
  });
  it('shares grouped values and membership provenance across Excel, CSV and SVG files', async () => {
    const r = result(), common = { requestId: crypto.randomUUID(), resultId: r.resultId, action: 'export' as const };
    const excel = await buildResultArtifact(r, { ...common, format: 'xlsx' }); if (excel.type !== 'download') throw new Error();
    const book = XLSX.read(excel.bytes, { type: 'array' });
    const rows = XLSX.utils.sheet_to_json<unknown[]>(book.Sheets['数据'], { header: 1 });
    expect(rows.slice(1).map(row => row[3])).toContain(200); expect(book.Sheets['口径与快照'].B2.v).toBe(r.resultId);
    for (const format of ['csv_zip', 'svg_zip'] as const) {
      const file = await buildResultArtifact(r, { ...common, format, ...(format === 'svg_zip' ? { chart: { kind: 'grouped_time_series' as const } } : {}) }); if (file.type !== 'download') throw new Error();
      const zip = await JSZip.loadAsync(file.bytes), manifest = JSON.parse(await zip.file('manifest.json')!.async('string'));
      expect(manifest.sources).toEqual(r.sources); expect(manifest.resultId).toBe(r.resultId);
      if (format === 'svg_zip') expect(manifest.chart.facets).toHaveLength(3);
    }
  });
  it('compares one quarter by grade with ratio units and its own valid denominator', () => {
    const p = parseQueryPlan({ operation: 'group_aggregate', metric: 'vacancy', period: { year: 2026, quarter: 3 }, groupBy: 'grade', scope: { inventory: 'tracked' } }), r = result(p);
    const a = r.table.rows.find(row => row.cells.name.kind === 'text' && row.cells.name.value === 'A')!;
    expect(a.cells.value).toMatchObject({ value: { numeric: .175 } }); expect(a.cells.denominator).toMatchObject({ value: { numeric: 40000 } });
    const chart = buildResultChart(resultViewSchema.parse(r), { kind: 'bar', field: 'value' });
    expect(chart.xLabel).toBe('等级'); expect(chart.points.map(p => p.y)).toContain(17.5);
  });
});
