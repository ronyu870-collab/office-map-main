import { describe, expect, it } from 'vitest';
import JSZip from 'jszip';
import * as XLSX from 'xlsx';
import { createHash } from 'node:crypto';
import { artifactInputSchema, buildResultArtifact } from '../artifacts';
import { buildResultChart, renderChartSvg } from '../charts';
import { resultViewSchema } from '../presentation';
import { buildAggregateResult, buildCompareResult, buildListResult, buildRankResult, resultDigest } from '../result';
import { fixture, basePeriod, nameSource } from './fixtures';

const requestId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
describe('immutable result charts and downloadable artifacts', () => {
  it('keeps bar labels, unknowns, cell bindings and every tied rank on the archived result', () => {
    const result = buildListResult(fixture(), ['height']);
    const digest = resultDigest(result);
    const chart = buildResultChart(resultViewSchema.parse(result), { kind: 'bar', field: 'height' });
    expect(chart.points.map(p => p.y)).toEqual([210, 198, null, null]);
    expect(chart.points.map(p => p.yText)).toEqual(['210', '198', '未知：缺少数据', '未知：来源冲突']);
    expect(chart.points[0].yCell.sourceIds).toEqual(result.table.rows[0].cells.height.sourceIds);
    const doc = new DOMParser().parseFromString(renderChartSvg(chart), 'image/svg+xml');
    expect(doc.querySelector('parsererror')).toBeNull();
    expect(doc.querySelectorAll('rect[fill="#003e7e"]')).toHaveLength(2);
    expect(doc.documentElement.textContent).toContain('有效图示 2 项，未知 2 项');
    expect(resultDigest(result)).toBe(digest);
    const ranked = buildRankResult(fixture(), 'height', 1, 'desc');
    expect(buildResultChart(resultViewSchema.parse(ranked), { kind: 'bar', field: 'height' }).points).toHaveLength(ranked.table.rows.length);
  });
  it('uses joint valid samples for scatter and keeps excluded rows explicit', () => {
    const result = resultViewSchema.parse(buildListResult(fixture(), ['height', 'netEffectiveRent']));
    const chart = buildResultChart(result, { kind: 'scatter', x: 'height', y: 'netEffectiveRent' });
    expect(chart.renderedCount).toBe(2); expect(chart.unknownCount).toBe(2);
    const svg = new DOMParser().parseFromString(renderChartSvg(chart), 'image/svg+xml');
    expect(svg.querySelectorAll('circle')).toHaveLength(2);
    expect(chart.points[3]).toMatchObject({ x: null, y: 150, state: 'unknown' });
  });
  it('projects ratios consistently as percent labels and keeps original exact fractions', () => {
    const result = buildAggregateResult(fixture(), 'vacancy');
    const chart = buildResultChart(resultViewSchema.parse(result), { kind: 'bar', field: 'value' });
    expect(chart.points[0]).toMatchObject({ y: 17.5, yText: '17.5' });
    expect(result.table.rows[0].cells.value).toMatchObject({ value: { numeric: .175, exact: { numerator: '7', denominator: '40' } } });
    expect(renderChartSvg(chart)).toContain('空置率（%）');
    expect(renderChartSvg(chart)).toMatch(/>100<\/text>/);
  });
  it('compares periods without mixing percentage-point changes into the metric axis', () => {
    const result = buildCompareResult(fixture(basePeriod), fixture(), 'vacancy', 'paired');
    const chart = buildResultChart(resultViewSchema.parse(result), { kind: 'period_comparison' });
    expect(chart.yLabel).toBe('空置率');
    expect(result.table.columns.find(c => c.key === 'difference')?.unit).toBe('percentage_point');
    expect(result.table.rows[0].cells.difference).toMatchObject({ kind: 'number', value: { numeric: 5, exact: { numerator: '5', denominator: '1' } } });
    expect(chart.points.map(p => p.yCell.key)).toEqual(['base', 'current']);
    expect(chart.points.map(p => p.y)).toEqual([12.5, 17.5]);
    expect(chart.points.map(p => p.label)).toEqual(['2026-Q2', '2026-Q3']);
    expect(() => buildResultChart(resultViewSchema.parse(result), { kind: 'bar', field: 'change' })).toThrow('CHART_COMPARISON_REQUIRED');
  });
  it('exports vacancy differences in percentage points with matching numeric cells', async () => {
    const result = buildCompareResult(fixture(basePeriod), fixture(), 'vacancy', 'paired');
    const file = await buildResultArtifact(result, { requestId, resultId: result.resultId, action: 'export', format: 'xlsx' });
    if (file.type !== 'download') throw new Error();
    const book = XLSX.read(file.bytes, { type: 'array' });
    expect(book.Sheets['数据'].D1.v).toContain('percentage_point');
    expect(book.Sheets['数据'].D2).toMatchObject({ t: 'n', v: 5 });
  });
  it('does not execute source names as XML and does not clip long labels or limitations', () => {
    const snap = fixture(), label = '</text><script>alert(1)</script>' + '超长楼宇'.repeat(60);
    const result = buildListResult({ ...snap, rows: snap.rows.map((row, i) => i ? row : { ...row, name: label, nameSource: nameSource(row.id, label) }) }, ['height']);
    const svg = renderChartSvg(buildResultChart(resultViewSchema.parse(result), { kind: 'bar', field: 'height' }));
    const doc = new DOMParser().parseFromString(svg, 'image/svg+xml');
    expect(doc.querySelector('script, parsererror, foreignObject, image')).toBeNull();
    const labels = [...doc.querySelectorAll('text')].map(n => n.textContent).join('');
    expect(labels).toContain(label);
    expect(doc.querySelector('metadata')?.textContent).toContain(label);
    const ys = [...doc.querySelectorAll('text')].map(n => Number(n.getAttribute('y')));
    expect(Math.max(...ys)).toBeLessThan(Number(doc.documentElement.getAttribute('height')));
  });
  it('returns actual XLSX numeric cells and complete CSV with manifest in one ZIP', async () => {
    const result = buildAggregateResult(fixture(), 'rent'), common = { requestId, resultId: result.resultId, action: 'export' as const };
    const excel = await buildResultArtifact(result, { ...common, format: 'xlsx' });
    expect(excel.type).toBe('download'); if (excel.type !== 'download') throw new Error();
    const workbook = XLSX.read(excel.bytes, { type: 'array' });
    expect(workbook.Sheets['数据'].B2).toMatchObject({ t: 'n', v: 170 });
    expect(workbook.Sheets['口径与快照'].B2.v).toBe(result.resultId);
    expect(excel.sha256).toBe(createHash('sha256').update(excel.bytes).digest('hex'));
    const csv = await buildResultArtifact(result, { ...common, format: 'csv_zip' });
    if (csv.type !== 'download') throw new Error();
    const zip = await JSZip.loadAsync(csv.bytes);
    expect(Object.keys(zip.files).sort()).toEqual(['data.csv', 'manifest.json']);
    const manifest = JSON.parse(await zip.file('manifest.json')!.async('string'));
    expect(manifest).toMatchObject({ resultId: result.resultId, digest: resultDigest(result), use: 'internal_analysis_only' });
    expect(manifest.sources).toEqual(result.sources);
    expect(await zip.file('data.csv')!.async('string')).toContain('"170","valid","170/1"');
  });
  it('exports matching SVG, cell bindings and full source manifest; refuses arbitrary values and wrong snapshots', async () => {
    const result = buildListResult(fixture(), ['height']);
    const input = { requestId, resultId: result.resultId, action: 'export' as const, format: 'svg_zip' as const, chart: { kind: 'bar' as const, field: 'height' } };
    const artifact = await buildResultArtifact(result, input); if (artifact.type !== 'download') throw new Error();
    const zip = await JSZip.loadAsync(artifact.bytes);
    const manifest = JSON.parse(await zip.file('manifest.json')!.async('string'));
    const svg = new DOMParser().parseFromString(await zip.file('chart.svg')!.async('string'), 'image/svg+xml');
    expect(JSON.parse(svg.querySelector('metadata')!.textContent!)).toEqual(manifest.chart);
    expect(manifest.sources).toEqual(result.sources);
    await expect(buildResultArtifact(result, { ...input, resultId: crypto.randomUUID() })).rejects.toThrow('ARTIFACT_RESULT_MISMATCH');
    expect(() => artifactInputSchema.parse({ ...input, chart: { ...input.chart, data: [999] } })).toThrow();
    await expect(buildResultArtifact(result, { ...input, format: 'xlsx' })).rejects.toThrow('ARTIFACT_CHART_FORMAT_MISMATCH');
    await expect(buildResultArtifact(result, { ...input, chart: { kind: 'bar', field: 'private_phone' } })).rejects.toThrow('CHART_NUMERIC_COLUMN_REQUIRED');
  });
});
