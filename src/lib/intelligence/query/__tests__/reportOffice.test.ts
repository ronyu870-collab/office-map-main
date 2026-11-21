import { describe, expect, it, vi } from 'vitest';
import JSZip from 'jszip';
import * as XLSX from 'xlsx';
import { writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { completedResearch } from '../../research/testFixtures';
import { generateResearchDeliverable } from '../../research/deliverable';
import { buildResultArtifact } from '../artifacts';
import { resultDigest, buildListResult } from '../result';
import { fixture } from './fixtures';
import { parseQueryPlan } from '../plan';
import { prepareReportResult } from '../../agent/reportTool';

const parse = (text: string) => { const doc = new DOMParser().parseFromString(text, 'application/xml'); expect(doc.querySelector('parsererror')).toBeNull(); return doc; };
const nodes = (doc: Document, name: string) => Array.from(doc.getElementsByTagName(name));
const allText = (doc: Document, name: string) => nodes(doc, name).map(n => n.textContent ?? '').join('');
async function openOffice(bytes: Uint8Array, kind: 'docx' | 'pptx') {
  const zip = await JSZip.loadAsync(bytes), parts = new Map<string, Document>();
  for (const name of Object.keys(zip.files).filter(n => /\.(xml|rels)$/.test(n))) parts.set(name, parse(await zip.file(name)!.async('string')));
  expect(parts.has('[Content_Types].xml')).toBe(true);
  for (const [path, doc] of parts) if (path.endsWith('.rels')) {
    for (const rel of nodes(doc, 'Relationship')) expect(rel.getAttribute('TargetMode')).not.toBe('External');
  }
  expect(Object.keys(zip.files).some(n => !zip.files[n].dir && /vbaProject|embeddings\/|altChunk/i.test(n))).toBe(false);
  expect(parts.has(kind === 'docx' ? 'word/document.xml' : 'ppt/presentation.xml')).toBe(true);
  const manifest = JSON.parse(parts.get('customXml/colliers-research.xml')!.documentElement.textContent!);
  return { zip, parts, manifest };
}
describe('native Office research files and shared evidence model', () => {
  it('round-trips Chinese Word/PPT with identical source tables, original deterministic facts, embedded chart PNGs and page fields', async () => {
    const run = await completedResearch(['rent', 'vacancy', 'totalArea']), before = run.results.map(resultDigest);
    const generated = await generateResearchDeliverable(run.checkpoint()!, { taskId: run.task!.id, formats: ['docx', 'pptx', 'xlsx'] }, crypto.randomUUID());
    expect(JSON.parse(generated.content).state).toBe('server_generated');
    const generatedFiles = JSON.parse(generated.content).files as Array<{ format: string; sha256: string }>;
    for (const kind of ['docx', 'pptx'] as const) {
      const file = await buildResultArtifact(generated.result, { requestId: crypto.randomUUID(), resultId: generated.result.resultId, action: 'export', format: kind });
      if (file.type !== 'download') throw Error('expected file');
      expect(file.sha256).toBe(generatedFiles.find(f => f.format === kind)!.sha256);
      vi.useFakeTimers({ toFake: ['Date'] });
      try {
        vi.setSystemTime(new Date('2030-01-01T00:00:00Z'));
        const later = await buildResultArtifact(generated.result, { requestId: crypto.randomUUID(), resultId: generated.result.resultId, action: 'export', format: kind });
        if (later.type !== 'download') throw Error('expected file');
        expect(later.sha256).toBe(file.sha256);
      } finally { vi.useRealTimers(); }
      expect(file.filename.endsWith('.' + kind)).toBe(true); expect(file.bytes.slice(0, 2)).toEqual(new Uint8Array([80, 75]));
      const opened = await openOffice(file.bytes, kind), text = [...opened.parts].filter(([name]) => kind === 'docx' ? name === 'word/document.xml' : /^ppt\/slides\/slide\d+\.xml$/.test(name)).map(([, doc]) => allText(doc, kind === 'docx' ? 'w:t' : 'a:t')).join('');
      for (const label of ['高力国际', 'CBD', '净有效租金', '空置率', '季度总面积', '155.71', '17.5', '2026Q1', '2026Q4', '未知', '来源与限制', '内部研究']) expect(text).toContain(label);
      expect(text).not.toContain(generated.result.resultId);
      expect(opened.manifest.sections.map((s: { digest: string }) => s.digest)).toEqual(before);
      expect(opened.manifest.sections.map((s: { table: unknown }) => s.table)).toEqual(run.results.map(r => r.table));
      const images = Object.keys(opened.zip.files).filter(n => /\/media\/.*\.png$/.test(n)); expect(images.length).toBeGreaterThanOrEqual(3);
      for (const path of images) expect(Buffer.from(await opened.zip.file(path)!.async('uint8array')).subarray(0, 8)).toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
      if (kind === 'docx') {
        const doc = opened.parts.get('word/document.xml')!;
        expect(nodes(doc, 'w:tblHeader').length).toBeGreaterThanOrEqual(3);
        const footer = [...opened.parts].filter(([n]) => /word\/footer\d+\.xml$/.test(n)).map(([, d]) => d.documentElement.outerHTML).join('');
        expect(footer).toContain('PAGE'); expect(footer).toContain('NUMPAGES'); expect(nodes(doc, 'w:pageBreakBefore').length).toBe(3);
        expect(nodes(doc, 'w:tblW').every(n => n.getAttribute('w:w') === '10400')).toBe(true);
      } else {
        const slides = [...opened.parts].filter(([n]) => /^ppt\/slides\/slide\d+\.xml$/.test(n)); expect(slides.length).toBeGreaterThan(10);
        const size = nodes(opened.parts.get('ppt/presentation.xml')!, 'p:sldSz')[0];
        const width = Number(size.getAttribute('cx')), height = Number(size.getAttribute('cy'));
        for (const [, doc] of slides) for (const tag of ['p:xfrm', 'a:xfrm']) for (const transform of nodes(doc, tag)) {
          const offset = transform.getElementsByTagName('a:off')[0], extent = transform.getElementsByTagName('a:ext')[0]; if (!offset || !extent) continue;
          expect(Number(offset.getAttribute('x'))).toBeGreaterThanOrEqual(0); expect(Number(offset.getAttribute('y'))).toBeGreaterThanOrEqual(0);
          expect(Number(offset.getAttribute('x')) + Number(extent.getAttribute('cx'))).toBeLessThanOrEqual(width);
          expect(Number(offset.getAttribute('y')) + Number(extent.getAttribute('cy'))).toBeLessThanOrEqual(height);
        }
      }
      await writeFile(join(tmpdir(), 'ai5-deep-fixture.' + kind), file.bytes);
    }
    const xlsx = await buildResultArtifact(generated.result, { requestId: crypto.randomUUID(), resultId: generated.result.resultId, action: 'export', format: 'xlsx' });
    if (xlsx.type !== 'download') throw Error();
    const book = XLSX.read(xlsx.bytes, { type: 'array' }); expect(book.SheetNames).toContain('研究说明');
    expect(book.SheetNames.filter(n => n.endsWith('数据'))).toHaveLength(3);
    for (const i of [1, 2, 3]) expect(XLSX.utils.sheet_to_json(book.Sheets[`${i}_数据`], { header: 1 })).toHaveLength(5);
    expect(run.results.map(resultDigest)).toEqual(before);
  }, 30000);
  it('preserves every long-table row including literal malicious text and zero/missing in both Office files without links or scripts', async () => {
    const raw = structuredClone(buildListResult(fixture(), ['height']));
    const list = { ...raw, parameters: { ...raw.parameters, executedPlan: parseQueryPlan({ operation: 'list', fields: ['height'], period: null, scope: { inventory: 'tracked', submarkets: ['CBD'] } }) } };
    list.table.rows = Array.from({ length: 61 }, (_, i) => ({ ...raw.table.rows[0], entityId: String(i), cells: { ...raw.table.rows[0].cells,
      name: { kind: 'text', value: `合成楼宇${String(i).padStart(3, '0')}` + (i === 60 ? '<script>https://evil.invalid</script>\u202e\uffff' : ''), sourceIds: [] } } }));
    const report = prepareReportResult([list], { resultIds: [list.resultId] });
    for (const kind of ['docx', 'pptx'] as const) {
      const file = await buildResultArtifact(report, { requestId: crypto.randomUUID(), resultId: report.resultId, action: 'export', format: kind }); if (file.type !== 'download') throw Error();
      const opened = await openOffice(file.bytes, kind);
      const text = [...opened.parts].filter(([n]) => kind === 'docx' ? n === 'word/document.xml' : /^ppt\/slides\/slide\d+\.xml$/.test(n)).map(([, d]) => allText(d, kind === 'docx' ? 'w:t' : 'a:t')).join('');
      for (let i = 0; i < 61; i++) expect(text).toContain(`合成楼宇${String(i).padStart(3, '0')}`);
      expect(text).toContain('<script>'); expect(opened.manifest.sections[0].table.rows.length).toBe(61);
      expect(opened.manifest.sections[0].table).toEqual(list.table);
    }
    const run = await completedResearch();
    const workspace = run.checkpoint()!;
    await expect(buildResultArtifact(workspace, { requestId: crypto.randomUUID(), resultId: workspace.resultId, action: 'export', format: 'docx' })).rejects.toThrow('RESEARCH_DELIVERABLE_NOT_GENERATED');
  }, 30000);
});
