import { describe, expect, it } from 'vitest';
import JSZip from 'jszip';
import { Resvg } from '@resvg/resvg-js';
import path from 'node:path';
import { inflateSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { chartRequestSchema, buildResultChart, renderChartSvg } from '../charts';
import { axisDomain, cartesianGeometry } from '../chartWorkspace';
import { buildResultArtifact } from '../artifacts';
import { buildAggregateResult, buildCompareResult, buildListResult, buildRankResult, buildRelationshipResult, buildTrendResult, resultDigest } from '../result';
import { executeQueryPlan } from '../executePlan';
import { parseQueryPlan } from '../plan';
import { describePlanRead } from '../snapshotReader';
import { resolveNumericFact } from '../facts';
import { resultViewSchema } from '../presentation';
import { fixture, nameSource, source } from './fixtures';

const view = (r: ReturnType<typeof buildListResult>) => resultViewSchema.parse(r);
const doc = (s: string) => new DOMParser().parseFromString(s, 'image/svg+xml');
const plot = { kind: 'plot' as const, type: 'horizontal_bar' as const, x: 'name', y: ['netEffectiveRent'] };
function topTen() {
  const s = fixture();
  return buildRankResult({ ...s, expectedCount: 14, rows: Array.from({ length: 14 }, (_, i) => {
    const id = `中文楼宇${i}`, name = `国贸中文楼宇 ${i}`;
    return { ...s.rows[0], id, name, nameSource: nameSource(id, name), facts: { ...s.rows[0].facts,
      netEffectiveRent: resolveNumericFact('netEffectiveRent', id, [source(id, 'netEffectiveRent', 100 + i * 10, s.period)], s.period) } };
  }) }, 'netEffectiveRent', 10, 'desc');
}

describe('AI5 chart bindings and coordinate geometry', () => {
  it('draws the complete CBD rent Top 10 as horizontal bars with exact source bindings', () => {
    const result = topTen(), digest = resultDigest(result), chart = buildResultChart(view(result), plot);
    expect(chart.points.map(p => p.y)).toEqual([230, 220, 210, 200, 190, 180, 170, 160, 150, 140]);
    const g = cartesianGeometry(chart), svg = doc(renderChartSvg(chart));
    expect(svg.querySelector('parsererror')).toBeNull();
    const bars = [...svg.querySelectorAll('rect[data-entity]')];
    expect(bars).toHaveLength(10);
    expect(Number(bars[0].getAttribute('width')) / Number(bars[1].getAttribute('width'))).toBeCloseTo(230 / 220);
    expect(Number(bars[0].getAttribute('x'))).toBe(g.left);
    expect(chart.points[0].yCell).toEqual({ entityId: result.table.rows[0].entityId, key: 'netEffectiveRent', sourceIds: result.table.rows[0].cells.netEffectiveRent.sourceIds });
    expect(resultDigest(result)).toBe(digest);
  });
  it('supports four chronological quarters and breaks a line at missing values and skipped quarters', () => {
    const snapshots = [1, 2, 3, 4].map(q => fixture({ year: 2026, quarter: q }));
    snapshots[2] = { ...snapshots[2], rows: snapshots[2].rows.map(r => ({ ...r, facts: { ...r.facts,
      netEffectiveRent: resolveNumericFact('netEffectiveRent', r.id, [], snapshots[2].period) } })) };
    const result = view(buildTrendResult(snapshots, 'rent', 'per_period'));
    const chart = buildResultChart(result, { kind: 'plot', type: 'line', x: 'period', y: ['value'] });
    expect(chart.points.map(p => p.y)).toEqual([170, 1090 / 7, null, 170]);
    const g = cartesianGeometry(chart), svg = doc(renderChartSvg(chart));
    expect(svg.querySelectorAll('polyline')).toHaveLength(1);
    expect(svg.querySelectorAll('circle')).toHaveLength(3);
    const circles = [...svg.querySelectorAll('circle')];
    expect(Number(circles[1].getAttribute('cx')) - Number(circles[0].getAttribute('cx'))).toBeCloseTo((g.right - g.left) / 4);
    const filtered = buildResultChart(result, { kind: 'plot', type: 'line', x: 'period', y: ['value'], periods: ['2026Q1', '2026Q4'] });
    expect(doc(renderChartSvg(filtered)).querySelectorAll('polyline')).toHaveLength(0);
    expect(() => buildResultChart(result, { kind: 'plot', type: 'line', x: 'period', y: ['value'], periods: ['2025Q1'] })).toThrow('CHART_PERIOD_NOT_AVAILABLE');
  });
  it('compares CBD and Financial Street vacancy from the same formal grouped denominator and overlays same-unit trends', () => {
    const p = parseQueryPlan({ operation: 'group_aggregate', metric: 'vacancy', groupBy: 'submarket', period: { year: 2026, quarter: 3 }, scope: { inventory: 'tracked', submarkets: ['CBD', '金融街'] } });
    const snap = (q: number) => {
      const base = fixture({ year: 2026, quarter: q });
      return { ...base, queryScope: { ...p.scope, filter: null, requestedFields: describePlanRead(p).fields, inventoryTime: 'current_catalog' },
        rows: base.rows.map((row, i) => ({ ...row, dimensions: { submarket: { value: i === 0 ? 'CBD' : '金融街',
          source: { ...row.nameSource, id: `submarket/${row.id}`, field: 'submarket', rawValue: i === 0 ? 'CBD' : '金融街' } } } })) };
    };
    const formal = executeQueryPlan(p, [snap(3)]), chart = buildResultChart(view(formal), { kind: 'plot', type: 'bar', x: 'name', y: ['value'] });
    expect(Object.fromEntries(chart.points.map(p => [p.label, p.y]))).toEqual({ CBD: 10, '金融街': 20 });
    expect(axisDomain(chart, 'y')).toEqual([0, 100]);
    const trendPlan = parseQueryPlan({ operation: 'group_trend', metric: 'rent', groupBy: 'submarket', start: { year: 2026, quarter: 2 }, end: { year: 2026, quarter: 3 }, mode: 'per_period', scope: p.scope });
    const snapshots = [snap(2), snap(3)].map(s => ({ ...s, queryScope: { ...s.queryScope, requestedFields: describePlanRead(trendPlan).fields } }));
    const trend = executeQueryPlan(trendPlan, snapshots);
    const lines = buildResultChart(view(trend), { kind: 'plot', type: 'line', x: 'period', y: ['value'], groupBy: 'name' });
    expect(lines.series).toHaveLength(2);
    expect(lines.series!.find(s => s.label.startsWith('CBD'))!.points.map(p => p.y)).toEqual([90, 100]);
    expect(doc(renderChartSvg(lines)).querySelectorAll('polyline')).toHaveLength(2);
    expect(lines.series![0].points[0].yCell.sourceIds.length).toBeGreaterThan(0);
  });
  it('binds rent X and vacancy Y independently and keeps percent levels, decimal units and pp distinct', () => {
    const result = view(buildRelationshipResult(fixture()));
    const chart = buildResultChart(result, { kind: 'plot', type: 'scatter', x: 'rent', y: ['vacancy'] });
    expect(chart.points.map(p => p.y)).toEqual([10, 20, null, null]);
    expect(axisDomain(chart, 'y')).toEqual([0, 100]);
    const g = cartesianGeometry(chart), circles = [...doc(renderChartSvg(chart)).querySelectorAll('circle')];
    expect(circles).toHaveLength(2);
    expect(Number(circles[0].getAttribute('cy'))).toBeCloseTo(g.bottom - .1 * (g.bottom - g.top));
    expect(Number(circles[1].getAttribute('cx'))).toBeCloseTo(g.right);
    const c = structuredClone(result);
    c.table.columns.find(col => col.key === 'vacancy')!.unit = 'percentage_point';
    c.table.rows[0].cells.vacancy = { kind: 'number', value: { numeric: .05, exact: { numerator: '1', denominator: '20' } }, sourceIds: [] };
    const pp = buildResultChart(c, { kind: 'plot', type: 'scatter', x: 'rent', y: ['vacancy'] });
    expect(pp.points[0].y).toBe(.05); expect(pp.points[0].yText).toBe('0.05');
    expect(renderChartSvg(pp)).toContain(' pp');
    c.table.columns.find(col => col.key === 'vacancy')!.unit = 'percent';
    expect(buildResultChart(c, { kind: 'plot', type: 'scatter', x: 'rent', y: ['vacancy'] }).points[0].y).toBe(.05);
  });
  it('keeps 17.5% at 17.5% of the default range and does not re-scale it to 100%', () => {
    const chart = buildResultChart(view(buildAggregateResult(fixture(), 'vacancy')), { kind: 'bar', field: 'value' });
    expect(chart.points[0].y).toBe(17.5);
    const bar = doc(renderChartSvg(chart)).querySelector('rect[fill="#003e7e"]')!;
    expect(Number(bar.getAttribute('width'))).toBeCloseTo(480 * .175);
    const difference = view(buildCompareResult(fixture({ year: 2026, quarter: 2 }), fixture(), 'vacancy', 'paired'));
    expect(difference.table.rows[0].cells.difference).toMatchObject({ value: { numeric: 5 } });
  });
  it('modifies axes and ordering without changing formal numbers, exact values or sources', () => {
    const result = topTen(), digest = resultDigest(result);
    const a = buildResultChart(view(result), plot);
    const b = buildResultChart(view(result), { ...plot, type: 'bar', yAxis: { min: 0, max: 300, ticks: 7, unit: 'CNY/m2/month' }, sort: { field: 'netEffectiveRent', direction: 'asc' }, title: 'CBD 净有效租金' });
    expect(b.points.map(p => p.y)).toEqual([...a.points.map(p => p.y)].reverse());
    expect(b.points[0].yCell).toEqual(a.points.at(-1)!.yCell);
    expect(axisDomain(b, 'y')).toEqual([0, 300]);
    expect(doc(renderChartSvg(b)).querySelectorAll('line')).toHaveLength(7);
    expect(resultDigest(result)).toBe(digest);
    for (const yAxis of [{ min: 150, max: 300 }, { max: 200 }, { min: 20, max: 10 }, { unit: 'ratio' }])
      expect(() => buildResultChart(view(result), { ...plot, yAxis })).toThrow();
  });
  it('retains actual zero as a point and negative values on the correct side of the zero baseline', () => {
    const result = structuredClone(view(buildListResult(fixture(), ['height'])));
    for (const [i, n] of [0, -5].entries()) result.table.rows[i].cells.height = { kind: 'number', value: { numeric: n, exact: { numerator: String(n), denominator: '1' } }, sourceIds: [] };
    const chart = buildResultChart(result, { ...plot, y: ['height'] });
    expect(chart.points.map(p => p.y)).toEqual([0, -5, null, null]);
    expect(chart.renderedCount).toBe(2); expect(chart.unknownCount).toBe(2);
    const g = cartesianGeometry(chart), bars = [...doc(renderChartSvg(chart)).querySelectorAll('rect[data-entity]')];
    expect(bars).toHaveLength(2);
    expect(Number(bars[0].getAttribute('width'))).toBe(0);
    expect(Number(bars[1].getAttribute('x'))).toBeLessThan(g.numericY(0));
    result.table.rows[1].cells.height = structuredClone(result.table.rows[0].cells.height);
    expect(axisDomain(buildResultChart(result, { ...plot, y: ['height'], yAxis: { ticks: 5 } }), 'y')).toEqual([0, 1]);
  });
  it('draws comparable same-unit series and rejects mixed units, unknown fields, duplicate points and supplied data', () => {
    const result = structuredClone(view(buildRelationshipResult(fixture())));
    result.table.columns.push({ key: 'rent2', label: '第二租金系列', unit: 'CNY/m2/month' });
    result.table.rows.forEach(r => { r.cells.rent2 = structuredClone(r.cells.rent); });
    const chart = buildResultChart(result, { kind: 'plot', type: 'bar', x: 'name', y: ['rent', 'rent2'] });
    expect(chart.series).toHaveLength(2); expect(chart.series![0].points.map(p => p.y)).toEqual(chart.series![1].points.map(p => p.y));
    expect(doc(renderChartSvg(chart)).querySelectorAll('rect[data-entity]')).toHaveLength(6);
    expect(() => buildResultChart(result, { kind: 'plot', type: 'bar', x: 'name', y: ['rent', 'vacancy'] })).toThrow('CHART_SHARED_AXIS_UNIT_MISMATCH');
    expect(() => buildResultChart(result, { ...plot, y: ['private_phone'] })).toThrow('CHART_FIELD_NOT_AVAILABLE');
    expect(() => chartRequestSchema.parse({ ...plot, data: [999], sources: [] })).toThrow();
    expect(() => chartRequestSchema.parse({ ...plot, xAxis: { min: Infinity } })).toThrow();
    result.table.rows[1].cells.name = result.table.rows[0].cells.name;
    expect(() => buildResultChart(result, { ...plot, y: ['rent'] })).toThrow('CHART_DUPLICATE_AXIS_POINT');
  });
  it('safely escapes malicious labels and explicitly fails oversized exports rather than truncating', () => {
    const r = structuredClone(view(topTen()));
    r.table.rows[0].cells.name = { kind: 'text', value: '</text><script>恶意()</script>', sourceIds: [] };
    const chart = buildResultChart(r, plot), svg = doc(renderChartSvg(chart));
    expect(svg.querySelector('parsererror, script, image, foreignObject')).toBeNull();
    expect(svg.documentElement.textContent).toContain('</text><script>恶意()</script>');
    const titled = buildResultChart(r, { ...plot, title: '高力研究'.repeat(40) });
    expect(cartesianGeometry(titled).titleLines.length).toBeGreaterThan(1);
    expect(doc(renderChartSvg(titled)).querySelector('parsererror')).toBeNull();
    r.table.rows = Array.from({ length: 1001 }, (_, i) => ({ ...r.table.rows[0], entityId: String(i), cells: { ...r.table.rows[0].cells, name: { kind: 'text', value: `楼宇${i}`, sourceIds: [] } } }));
    expect(() => buildResultChart(r, plot)).toThrow('CHART_SIZE_LIMIT');
  });
  it('generates real deterministic PNG bytes, Chinese glyphs, correct dimensions and matching source manifests', async () => {
    const result = topTen(), common = { requestId: crypto.randomUUID(), resultId: result.resultId, action: 'export' as const, chart: plot };
    const file = await buildResultArtifact(result, { ...common, format: 'png_zip' });
    if (file.type !== 'download') throw new Error();
    const zip = await JSZip.loadAsync(file.bytes), png = await zip.file('chart.png')!.async('nodebuffer');
    expect(png.subarray(0, 8)).toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
    expect(png.readUInt32BE(16)).toBe(2200); expect(png.readUInt32BE(20)).toBe(1440);
    const manifest = JSON.parse(await zip.file('manifest.json')!.async('string'));
    expect(manifest.sources).toEqual(result.sources); expect(manifest.digest).toBe(resultDigest(result));
    expect(manifest.image).toMatchObject({ width: 2200, height: 1440, font: 'Noto Sans SC', sha256: createHash('sha256').update(png).digest('hex') });
    // PNG IDAT is an actual zlib-compressed raster, not renamed SVG/HTML.
    const idat: Buffer[] = []; let offset = 8;
    while (offset < png.length) { const size = png.readUInt32BE(offset), kind = png.toString('ascii', offset + 4, offset + 8); if (kind === 'IDAT') idat.push(png.subarray(offset + 8, offset + 8 + size)); offset += size + 12; }
    expect(inflateSync(Buffer.concat(idat)).byteLength).toBeGreaterThan(2200 * 1440);
    const font = { loadSystemFonts: false, defaultFontFamily: 'Noto Sans SC', fontFiles: [path.join(process.cwd(), 'private/chart-fonts/NotoSansSC-Regular.otf')] };
    const glyph = (label: string) => new Resvg(`<svg xmlns="http://www.w3.org/2000/svg" width="100" height="60"><text y="40" font-size="32">${label}</text></svg>`, { font }).render().pixels;
    expect(glyph('高力')).not.toEqual(glyph('楼宇'));
    expect(glyph('高力').some(n => n !== 0)).toBe(true);
    const second = await buildResultArtifact(result, { ...common, format: 'png_zip' });
    if (second.type !== 'download') throw new Error();
    expect(second.sha256).toBe(file.sha256);
    const vector = await buildResultArtifact(result, { ...common, format: 'svg_zip' });
    if (vector.type !== 'download') throw new Error();
    const vz = await JSZip.loadAsync(vector.bytes);
    expect(JSON.parse(doc(await vz.file('chart.svg')!.async('string')).querySelector('metadata')!.textContent!)).toEqual(manifest.chart);
  });
});
