import { describe, expect, it } from 'vitest';
import { PDFDocument, PDFName, PDFDict } from 'pdf-lib';
import { writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { prepareReportResult } from '../../agent/reportTool';
import { reportRequestSchema, reportPeriodRange } from '../reportProtocol';
import { buildResultArtifact } from '../artifacts';
import { buildTrendResult, buildListResult, resultDigest, type QueryResult } from '../result';
import { parseQueryPlan } from '../plan';
import { fixture } from './fixtures';
import { attachResearchAnalysis } from '../researchAnalysis';

export function trend(metric: 'rent' | 'vacancy' | 'totalArea' = 'rent') {
  const start = { year: 2026, quarter: 1 }, end = { year: 2026, quarter: 4 };
  const result = buildTrendResult([1, 2, 3, 4].map(quarter => fixture({ year: 2026, quarter })), metric, 'per_period');
  return { ...result, parameters: { ...result.parameters, scope: { inventory: 'tracked', submarkets: ['CBD'] }, executedPlan: parseQueryPlan({ operation: 'trend', metric, start, end, mode: 'per_period', scope: { inventory: 'tracked', submarkets: ['CBD'] } }) } };
}
export async function readPdf(bytes: Uint8Array) {
  const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const task = getDocument({ data: new Uint8Array(bytes), useSystemFonts: false, useWorkerFetch: false });
  const pdf = await task.promise;
  const pages = [];
  try {
    for (let i = 1; i <= pdf.numPages; i++) { const page = await pdf.getPage(i), content = await page.getTextContent(); pages.push({ text: content.items.map(item => 'str' in item ? item.str : '').join(''), items: content.items, page }); }
    return { pdf, task, pages, attachments: await pdf.getAttachments() };
  } catch (error) { await task.destroy(); throw error; }
}
async function artifact(results: QueryResult[] = [trend()]) {
  const report = prepareReportResult(results, { resultIds: results.map(r => r.resultId) });
  const file = await buildResultArtifact(report, { requestId: crypto.randomUUID(), resultId: report.resultId, action: 'export', format: 'pdf' });
  if (file.type !== 'download') throw new Error();
  return { report, file };
}
describe('real research PDFs from authorized formal results', () => {
  it('resolves the natural recent-four-quarter report window on the server without guessing available data', () => {
    expect(reportPeriodRange(4, new Date('2026-11-21T10:00:00Z'))).toEqual({ start: { year: 2025, quarter: 4 }, end: { year: 2026, quarter: 3 } });
    expect(reportPeriodRange(4, new Date('2026-03-31T16:00:00Z'))).toEqual({ start: { year: 2025, quarter: 2 }, end: { year: 2026, quarter: 1 } });
  });
  it('opens a real Chinese multi-page quarterly report with text, tables, charts, footers and embedded exact provenance', async () => {
    const results = [trend('rent'), trend('vacancy'), trend('totalArea')], before = results.map(resultDigest);
    const { report, file } = await artifact(results);
    expect(file.contentType).toBe('application/pdf'); expect(file.filename).toMatch(/\.pdf$/);
    expect(Buffer.from(file.bytes.subarray(0, 5)).toString()).toBe('%PDF-');
    const opened = await readPdf(file.bytes);
    try {
      expect(opened.pages.length).toBeGreaterThan(6);
      const all = opened.pages.map(p => p.text).join('');
      for (const text of ['高力国际', '北京写字楼市场研究报告', 'CBD', '2026Q1', '2026Q4', '净有效租金', '空置率', '季度总面积', '17.5', '155.71', '关键指标', '研究分析', '来源与限制', '未知', '内部研究']) expect(all).toContain(text);
      expect(all).not.toContain(report.resultId); expect(all).not.toContain('tool_failed');
      for (const [i, p] of opened.pages.entries()) {
        expect(p.text).toContain(`${i + 1} / ${opened.pages.length}`);
        const [w, h] = p.page.getViewport({ scale: 1 }).viewBox.slice(2);
        for (const item of p.items) if ('str' in item && item.str.trim()) {
          expect(item.transform[4]).toBeGreaterThanOrEqual(42); expect(item.transform[4] + item.width).toBeLessThanOrEqual(w - 36);
          expect(item.transform[5]).toBeGreaterThan(20); expect(item.transform[5]).toBeLessThan(h - 20);
        }
        expect(await p.page.getAnnotations()).toHaveLength(0);
      }
      expect(await opened.pdf.getJSActions()).toBeNull();
      const manifest = JSON.parse(new TextDecoder().decode((await opened.pdf.getAttachmentContent('manifest.json'))!));
      expect(manifest.digest).toBe(resultDigest(report)); expect(manifest.sections.map((s: { digest: string }) => s.digest)).toEqual(before);
      expect(manifest.sections.map((s: { table: unknown }) => s.table)).toEqual(results.map(r => r.table));
      expect(results.map(resultDigest)).toEqual(before);
      const parsed = await PDFDocument.load(file.bytes);
      const embedded = parsed.context.enumerateIndirectObjects().map(([, v]) => v).filter(v => v instanceof PDFDict && v.get(PDFName.of('FontDescriptor')));
      expect(embedded.length).toBeGreaterThan(0);
      expect((await opened.pages[2].page.getOperatorList()).fnArray.length).toBeGreaterThan(10);
      await writeFile(join(tmpdir(), 'ai5-pdf-research-fixture.pdf'), file.bytes);
      const again = await buildResultArtifact(report, { requestId: crypto.randomUUID(), resultId: report.resultId, action: 'export', format: 'pdf' });
      if (again.type !== 'download') throw new Error();
      expect(again.sha256).toBe(file.sha256);
    } finally { await opened.task.destroy(); }
  }, 30000);
  it('retains deterministic year-on-year, quarter-on-quarter and percentage-point changes without treating zero as missing', async () => {
    const snapshots = [{ year: 2025, quarter: 3 }, { year: 2025, quarter: 4 }, ...[1, 2, 3].map(quarter => ({ year: 2026, quarter }))].map(period => {
      const snapshot = fixture(period);
      return { ...snapshot, rows: snapshot.rows.map(row => ({ ...row, facts: Object.fromEntries(Object.entries(row.facts).map(([key, fact]) => [key, { ...fact!, sources: fact!.sources.map(source => ({ ...source, id: source.period ? `${source.id}/${period.year}` : source.id })) }])) })) };
    });
    const results: QueryResult[] = (['rent', 'vacancy'] as const).map(metric => {
      const result = attachResearchAnalysis(buildTrendResult(snapshots, metric, 'per_period'), snapshots);
      return { ...result, parameters: { ...result.parameters, executedPlan: parseQueryPlan({ operation: 'trend', metric, start: snapshots[0].period, end: snapshots.at(-1)!.period, mode: 'per_period', scope: { inventory: 'tracked', submarkets: ['CBD'] } }) } };
    });
    const { file } = await artifact(results), opened = await readPdf(file.bytes);
    try {
      const all = opened.pages.map(p => p.text).join('');
      expect(all).toContain('2026Q3 同比：0 %');
      expect(all).toContain('2026Q3 同比：0 百分点');
      expect(all).toContain('2026Q3 环比：3.21 百分点');
      const manifest = JSON.parse(new TextDecoder().decode((await opened.pdf.getAttachmentContent('manifest.json'))!));
      expect(manifest.sections.map((s: { parameters: { researchAnalysis: unknown } }) => s.parameters.researchAnalysis)).toEqual(results.map(r => r.parameters.researchAnalysis));
    } finally { await opened.task.destroy(); }
  }, 30000);
  it('prints every long-table record, repeats headers, and preserves literal malicious strings without active content', async () => {
    const raw = structuredClone(buildListResult(fixture(), ['height']));
    const r = { ...raw, parameters: { ...raw.parameters, executedPlan: parseQueryPlan({ operation: 'list', fields: ['height'], scope: { inventory: 'tracked', submarkets: ['CBD'] }, period: null }) } };
    r.table.rows = Array.from({ length: 125 }, (_, i) => ({ ...r.table.rows[0], entityId: String(i), cells: { ...r.table.rows[0].cells,
      name: { kind: 'text', value: i === 124 ? '<script>alert(1)</script> https://evil.invalid/ 中文末条' : `合成楼宇${String(i).padStart(3, '0')}${i === 0 ? '中文研究'.repeat(300) : ''}`, sourceIds: [] } } }));
    const { file } = await artifact([r]); const opened = await readPdf(file.bytes);
    try {
      const all = opened.pages.map(p => p.text).join('');
      for (let i = 0; i < 124; i++) expect(all).toContain(`合成楼宇${String(i).padStart(3, '0')}`);
      expect(all).toContain('长记录续页'); expect(all).toContain('中文末条'); expect(all).toContain('<script>');
      expect(opened.pages.filter(p => p.text.includes('数据明细')).length).toBeGreaterThan(2);
      expect(await opened.pdf.getJSActions()).toBeNull();
      for (const p of opened.pages) expect(await p.page.getAnnotations()).toHaveLength(0);
    } finally { await opened.task.destroy(); }
  }, 30000);
  it('renders missing data explicitly and refuses model prose, public publication and silent truncation', async () => {
    const r = structuredClone(trend()); r.table.rows = r.table.rows.map(row => ({ ...row, cells: { ...row.cells, value: { kind: 'unknown', state: 'missing', reason: 'no_valid_sample', sourceIds: [] } } }));
    const { file } = await artifact([r]); const opened = await readPdf(file.bytes);
    try { expect(opened.pages.map(p => p.text).join('')).toContain('没有可用的趋势数值'); } finally { await opened.task.destroy(); }
    expect(() => reportRequestSchema.parse({ resultIds: [r.resultId], html: '<img src="https://evil">', conclusions: '租金1000' })).toThrow();
    expect(() => prepareReportResult([r], { resultIds: [r.resultId], purpose: 'client' })).toThrow('REPORT_CLIENT_PUBLICATION');
    const huge = structuredClone(r); huge.table.rows = Array.from({ length: 4001 }, () => r.table.rows[0]);
    expect(() => prepareReportResult([huge], { resultIds: [huge.resultId] })).toThrow('REPORT_ROW_LIMIT');
    expect(() => prepareReportResult([r], { resultIds: [r.resultId], charts: [{ resultId: r.resultId, chart: { kind: 'plot', type: 'bar', x: 'name', y: ['private_phone'] } }] })).toThrow();
  }, 30000);
});
