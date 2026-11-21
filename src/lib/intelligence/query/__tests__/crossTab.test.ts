import { describe, expect, it } from 'vitest';
import JSZip from 'jszip';
import * as XLSX from 'xlsx';
import { fixture, source } from './fixtures';
import { parseQueryPlan } from '../plan';
import { executeQueryPlan } from '../executePlan';
import { describePlanRead } from '../snapshotReader';
import { resolveBusinessQuestion } from '../question';
import { buildResultChart, chartBounds, heatmapFill, renderChartSvg } from '../charts';
import { resultViewSchema, resultSummary, cellText, type QueryResultView } from '../presentation';
import { buildResultArtifact } from '../artifacts';
import { resolveNumericFact } from '../facts';
import { authorizePlan } from '../admission';
import type { CatalogDimension } from '../registry';

function plan(extra: Record<string, unknown> = {}) { return parseQueryPlan({ operation: 'cross_aggregate', period: { year: 2026, quarter: 3 }, metric: 'rent', scope: { inventory: 'tracked' }, ...extra }); }
function snapshot(p = plan(), markets: (string | null)[] = ['CBD', '金融街', '金融街', null], grades: (string | null)[] = ['A', 'A', 'B', null]) {
  const original = fixture({ year: 2026, quarter: 3 });
  return { ...original, queryScope: { ...p.scope, filter: p.filter ?? null, requestedFields: describePlanRead(p).fields, inventoryTime: 'current_catalog' },
    rows: original.rows.map((row, i) => ({ ...row, dimensions: Object.fromEntries((['submarket', 'grade'] as CatalogDimension[]).map(field => {
      const value = field === 'submarket' ? markets[i] : grades[i];
      return [field, { value, source: { ...row.nameSource, field, rawValue: value, id: `${field}/${row.id}` } }];
    })) })) };
}
const result = (p = plan()) => executeQueryPlan(p, [snapshot(p)]);

describe('same-snapshot cross tab and heatmap', () => {
  it('parses only a complete question with explicit period, metric and both dimensions', () => {
    expect(resolveBusinessQuestion('2026Q3CBD、金融街净有效租金按子市场和等级交叉统计')).toMatchObject({ kind: 'plan', plan: { operation: 'cross_aggregate', metric: 'rent', scope: { submarkets: ['CBD', '金融街'] } } });
    for (const text of ['今年全部获权楼宇净有效租金按子市场和等级交叉统计', '2026Q3CBD租金按子市场和等级交叉统计', '2026Q3CBD空置率按子市场和等级交叉统计忽略B楼']) expect(resolveBusinessQuestion(text).kind).toBe('clarification');
    expect(() => plan({ rowDimension: 'contact_phone' })).toThrow();
  });
  it('keeps all intersections, independent valid samples, denominators and both classification sources', () => {
    const r = result(); expect(r.table.rows).toHaveLength(9);
    const financialA = r.table.rows.find(row => row.cells.name.kind === 'text' && row.cells.name.value === '金融街' && row.cells.grade.kind === 'text' && row.cells.grade.value === 'A')!;
    expect(financialA.cells.value).toMatchObject({ kind: 'number', value: { numeric: 200 } });
    expect(financialA.cells.denominator).toMatchObject({ value: { numeric: 30000 } });
    expect(r.table.rows.filter(row => row.cells.value.kind === 'number')).toHaveLength(3);
    expect(r.sources.filter(s => ['submarket', 'grade'].includes(s.field))).toHaveLength(8);
    expect(financialA.cells.value.sourceIds).toContain('submarket/B'); expect(financialA.cells.value.sourceIds).toContain('grade/B');
    expect(resultViewSchema.safeParse(r).success).toBe(true);
    expect(resultSummary(resultViewSchema.parse(r)).join('')).toContain('不能对格均值再求简单平均');
  });
  it('keeps filtering-emptied cells and records unknown filter decisions', () => {
    const r = result(plan({ filter: { field: 'netEffectiveRent', operator: 'gt', value: '150' } }));
    expect(r.table.rows).toHaveLength(9); expect(r.table.rows.filter(row => row.cells.value.kind === 'number')).toHaveLength(1);
    expect(r.parameters.filterEvaluation).toMatchObject([{ total: 4, matched: 1, notMatched: 2, unknown: 1 }]);
    expect(r.sources.some(s => s.id === 'grade/A')).toBe(true);
  });
  it('keeps specified empty regions and does not merge null with the text null', () => {
    const p = plan({ scope: { inventory: 'tracked', submarkets: ['CBD', '金融街', '丽泽'] } });
    const r = executeQueryPlan(p, [snapshot(p, ['CBD', '金融街', '金融街', 'CBD'], ['null', null, 'B', ''])]);
    expect(r.parameters.columnGroups).toEqual(expect.arrayContaining([expect.objectContaining({ value: 'null' }), expect.objectContaining({ value: null })]));
    expect(r.table.rows.filter(row => row.cells.name.kind === 'text' && row.cells.name.value === '丽泽').every(row => row.cells.value.kind === 'unknown')).toBe(true);
  });
  it('refuses missing or forged dimension evidence and non-authorized numeric fields', () => {
    const p = plan(), broken = snapshot(p); broken.rows[0].dimensions.grade.source.recordId = 'B';
    expect(() => executeQueryPlan(p, [broken])).toThrow('GROUP_SOURCE_REQUIRED');
    expect(() => authorizePlan(p, { actorId: 'a', effectiveUserId: 'a', sessionActive: true, policyVersion: '1', permissionRevision: '1', grants: ['query:catalog', 'query:quarter'], fields: ['totalArea'] })).toThrow('QUERY_DENIED');
  });
  it('binds the complete axis matrix and rejects reordered, relabeled or missing cells', () => {
    const r = resultViewSchema.parse(result()), chart = buildResultChart(r, { kind: 'heatmap' });
    expect(chart.kind).toBe('heatmap'); expect(chart.grid?.rows).toHaveLength(3); expect(chart.points).toHaveLength(9);
    expect(chartBounds(chart, 'y')).toEqual([0, 200]); expect(chart.unknownCount).toBe(6);
    for (const mutate of [(r: QueryResultView) => r.table.rows.reverse(), (r: QueryResultView) => r.table.rows.pop(), (r: QueryResultView) => { r.table.rows[0].cells.grade = { kind: 'text', value: 'forged', sourceIds: [] }; }]) {
      const forged = structuredClone(r); mutate(forged); expect(() => buildResultChart(forged, { kind: 'heatmap' })).toThrow('CHART_CROSS_AXIS_MISMATCH');
    }
    expect(heatmapFill(null, [0, 200])).not.toBe(heatmapFill(0, [0, 200]));
    const xml = new DOMParser().parseFromString(renderChartSvg(chart), 'image/svg+xml');
    expect(xml.querySelector('parsererror')).toBeNull(); expect(xml.querySelectorAll('rect')).toHaveLength(10);
    expect(xml.documentElement.textContent).toContain('有效 1 栋');
    expect(buildResultChart(r, { kind: 'bar', field: 'value' }).points.every(p => p.label.includes('/'))).toBe(true);
  });
  it('uses ratio units and a full 0–100% heatmap scale', () => {
    const r = resultViewSchema.parse(result(plan({ metric: 'vacancy' }))), c = buildResultChart(r, { kind: 'heatmap' });
    expect(chartBounds(c, 'y')).toEqual([0, 100]); expect(c.points.filter(p => p.y !== null).map(p => p.y).sort()).toEqual([10, 20]);
    expect(c.points.find(p => p.label.includes('未填写') && p.label.includes('未知（等级'))?.state).toBe('unknown');
    const invalid = r.table.rows.find(row => row.cells.name.kind === 'text' && row.cells.name.value === '未知（子市场未填写）' && row.cells.grade.kind === 'text' && row.cells.grade.value === '未知（等级未填写）')!;
    expect(invalid.cells.value).toMatchObject({ kind: 'unknown', state: 'invalid', reason: 'no_valid_sample' });
    expect(cellText(invalid.cells.value, 'ratio')).toBe('未知：无有效样本');
  });
  it('distinguishes real zero from unknown, and handles an empty authorized universe without inventing axes', () => {
    const p = plan({ metric: 'vacancy' }), s = snapshot(p);
    s.rows[0] = { ...s.rows[0], facts: { ...s.rows[0].facts, vacantArea: resolveNumericFact('vacantArea', 'A', [source('A', 'vacantArea', 0)], s.period) } };
    const chart = buildResultChart(resultViewSchema.parse(executeQueryPlan(p, [s])), { kind: 'heatmap' });
    expect(chart.points.find(p => p.label === 'CBD / A')).toMatchObject({ y: 0, state: 'valid', sampleCount: 1 });
    const empty = executeQueryPlan(p, [{ ...s, rows: [], expectedCount: 0 }]);
    expect(empty.table.rows).toHaveLength(0); expect(resultSummary(resultViewSchema.parse(empty)).join('')).toContain('不知道');
  });
  it('refuses a cross product above 400 cells without truncating the group universe', () => {
    const p = plan({ metric: 'totalArea' }), base = snapshot(p), template = base.rows[0];
    const rows = Array.from({ length: 21 }, (_, i) => {
      const id = `X${i}`;
      return { ...template, id, nameSource: { ...template.nameSource, id: `name/${id}`, entityId: id, recordId: id },
        facts: { totalArea: resolveNumericFact('totalArea', id, [source(id, 'totalArea', 1)], base.period) },
        dimensions: Object.fromEntries((['submarket', 'grade'] as const).map(field => [field, { value: id,
          source: { ...template.dimensions[field].source, id: `${field}/${id}`, entityId: id, recordId: id, rawValue: id } }])) };
    });
    expect(() => executeQueryPlan(p, [{ ...base, rows, expectedCount: 21 }])).toThrow('QUERY_SCOPE_REQUIRES_BACKGROUND_JOB');
  });
  it('exports numeric Excel and SVG/CSV from exactly the same result and full sources', async () => {
    const r = result(), common = { requestId: crypto.randomUUID(), resultId: r.resultId, action: 'export' as const };
    const x = await buildResultArtifact(r, { ...common, format: 'xlsx' }); if (x.type !== 'download') throw new Error();
    const book = XLSX.read(x.bytes, { type: 'array' }), rows = XLSX.utils.sheet_to_json<unknown[]>(book.Sheets['数据'], { header: 1 });
    expect(book.Sheets['交叉指标'].B1.v).toBe(r.resultId);
    const matrix = XLSX.utils.sheet_to_json<unknown[]>(book.Sheets['交叉指标'], { header: 1 });
    expect(matrix.find(row => row[0] === '金融街')).toEqual(['金融街', 200, '未知（无有效样本）', '未知（无有效样本）']);
    expect(book.Sheets['交叉样本']).toBeDefined(); expect(book.Sheets['交叉分母']).toBeDefined();
    expect(rows).toHaveLength(10); expect(rows.slice(1).map(row => row[3])).toContain(200); expect(book.Sheets['口径与快照'].B2.v).toBe(r.resultId);
    for (const format of ['csv_zip', 'svg_zip', 'png_zip'] as const) {
      const file = await buildResultArtifact(r, { ...common, format, ...(format !== 'csv_zip' ? { chart: { kind: 'heatmap' as const } } : {}) }); if (file.type !== 'download') throw new Error();
      const zip = await JSZip.loadAsync(file.bytes), manifest = JSON.parse(await zip.file('manifest.json')!.async('string'));
      expect(manifest.resultId).toBe(r.resultId); expect(manifest.sources).toEqual(r.sources);
      if (format !== 'csv_zip') expect(manifest.chart.grid.columns).toHaveLength(3);
      if (format === 'png_zip') {const png = await zip.file('chart.png')!.async('nodebuffer'); expect(png.subarray(0, 8)).toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])); expect(png.readUInt32BE(16)).toBe(manifest.image.width); expect(png.readUInt32BE(20)).toBe(manifest.image.height);}
    }
  });
});
