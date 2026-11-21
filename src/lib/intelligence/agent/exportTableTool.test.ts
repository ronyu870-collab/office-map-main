import { describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import * as XLSX from 'xlsx';
import JSZip from 'jszip';
import { buildListResult } from '../query/result';
import { fixture, nameSource, source } from '../query/__tests__/fixtures';
import { resolveNumericFact } from '../query/facts';
import { parseAgentToolArguments } from './toolRegistry';
import { AuthorizedResultWorkset, type WorksetOwner } from './resultWorkset';
import { exportAuthorizedTable, prepareExportResult } from './exportTableTool';
import { buildResultArtifact } from '../query/artifacts';

const owner: WorksetOwner = { requestId: randomUUID(), actorId: randomUUID(),
  effectiveUserId: randomUUID(), sessionId: randomUUID(), policyVersion: 'test', permissionRevision: 'r1' };
const plan = { operation: 'list', fields: ['height', 'netEffectiveRent', 'totalArea'],
  scope: { inventory: 'tracked', submarkets: ['CBD'] }, period: { year: 2026, quarter: 3 } };
function fullResult(quarter = 3) {
  const snap = fixture({ year: 2026, quarter });
  const rows = Array.from({ length: 137 }, (_, i) => {
    const id = randomUUID(), name = i === 0 ? '=恶意公式("中文")' : `北京合成楼宇${i}`;
    return { id, name, nameSource: nameSource(id, name),
      dimensions: { submarket: { value: 'CBD', source: { ...nameSource(id, 'CBD'), id: 'market/' + id, field: 'submarket' } } },
      facts: Object.fromEntries(['height', 'netEffectiveRent', 'totalArea'].map(field => {
        const f = field as 'height' | 'netEffectiveRent' | 'totalArea';
        return [f, resolveNumericFact(f, id, [source(id, f, 1000 + i, f === 'height' ? null : snap.period)], f === 'height' ? null : snap.period)];
      })) };
  });
  const result = buildListResult({ ...snap, rows, expectedCount: rows.length }, ['height', 'netEffectiveRent', 'totalArea']);
  return { ...result, parameters: { ...result.parameters, executedPlan: { ...plan, period: snap.period } } };
}
async function fileFor(result: ReturnType<typeof prepareExportResult>, format: 'xlsx' | 'csv_zip' = 'xlsx') {
  const file = await buildResultArtifact(result, { requestId: owner.requestId, resultId: result.resultId, action: 'export', format });
  if (file.type !== 'download') throw Error();
  return file;
}

describe('authorized Agent table exports read real final XLSX/CSV bytes', () => {
  it('exports all 137 Chinese rows, numeric types, source dates, widths and filter rather than a preview/page', async () => {
    const base = fullResult(), workset = new AuthorizedResultWorkset(owner);
    workset.register(base, owner);
    const out = await exportAuthorizedTable(workset, owner, { resultIds: [base.resultId], format: 'xlsx' }, ['export:internal']);
    expect(JSON.parse(out.content)).toMatchObject({ state: 'server_generated', exportedRows: 137, bytes: expect.any(Number) });
    const book = XLSX.read((await fileFor(out.result)).bytes, { type: 'array', cellStyles: true });
    const rows = XLSX.utils.sheet_to_json(book.Sheets['数据'], { header: 1 });
    expect(rows).toHaveLength(138);
    expect(book.Sheets['数据'].A2).toMatchObject({ t: 's', v: '=恶意公式("中文")' });
    expect(book.Sheets['数据'].A2.f).toBeUndefined();
    expect(book.Sheets['数据'].D2).toMatchObject({ t: 'n', v: 1000 });
    expect(book.Sheets['数据']['!autofilter']?.ref).toBe('A1:F138');
    expect(book.Sheets['数据']['!cols']?.[0].wch).toBeGreaterThan(14);
    expect(JSON.stringify(XLSX.utils.sheet_to_json(book.Sheets['来源'], { header: 1 }))).toContain('2026-10-01T00:00:00Z');
    expect(JSON.stringify(XLSX.utils.sheet_to_json(book.Sheets['口径与快照'], { header: 1 }))).toContain('exportPlans');
  });

  it('sorts Top 10 rent / Top 20 height and applies combined filters before selecting four requested columns', async () => {
    const base = fullResult();
    for (const [field, topN] of [['netEffectiveRent', 10], ['height', 20]] as const) {
      const result = prepareExportResult([base], { resultIds: [base.resultId], format: 'xlsx',
        sort: { field, direction: 'desc' }, topN });
      const book = XLSX.read((await fileFor(result)).bytes, { type: 'array' });
      const rows = XLSX.utils.sheet_to_json<(string | number)[]>(book.Sheets['数据'], { header: 1 });
      expect(rows).toHaveLength(topN + 1);
      expect(result.table.rows[0].cells[field]).toMatchObject({ value: { numeric: 1136 } });
      expect(result.table.rows.at(-1)?.cells[field]).toMatchObject({ value: { numeric: 1137 - topN } });
    }
    const result = prepareExportResult([base], { resultIds: [base.resultId], format: 'xlsx',
      fields: ['name', 'submarket', 'netEffectiveRent', 'totalArea'], singleSheet: true,
      filters: [{ field: 'submarket', operator: 'eq', value: 'CBD' }, { field: 'height', operator: 'gte', value: '1100' }] });
    const book = XLSX.read((await fileFor(result)).bytes, { type: 'array' });
    expect(book.SheetNames).toEqual(['数据']);
    const rows = XLSX.utils.sheet_to_json<(string | number)[]>(book.Sheets['数据'], { header: 1 });
    expect(rows[0]).toEqual(['楼宇', '子市场', '净有效租金 (CNY/m2/month)', '季度总面积 (m2)']);
    expect(result.table.rows).toHaveLength(37);
    expect(book.Sheets['数据']['!autofilter']?.ref).toBe('A1:D38');
    expect(rows.flat()).toContain('来源');
    expect(rows.flat()).toContain('口径与快照');
  });

  it('round-trips UTF-8 CSV and manifest, neutralizing formulas while keeping legitimate negative numbers numeric', async () => {
    const base = fullResult(), first = base.table.rows[0];
    const modified = { ...base, table: { ...base.table, rows: [{ ...first, cells: { ...first.cells,
      height: { kind: 'number' as const, value: { numeric: -12.5, exact: { numerator: '-25', denominator: '2' } }, sourceIds: first.cells.height.sourceIds } } }, ...base.table.rows.slice(1)] } };
    const result = prepareExportResult([modified], { resultIds: [base.resultId], format: 'csv_zip' });
    const zip = await JSZip.loadAsync((await fileFor(result, 'csv_zip')).bytes);
    const bytes = await zip.file('data.csv')!.async('uint8array');
    expect([...bytes.slice(0, 3)]).toEqual([239, 187, 191]);
    const text = new TextDecoder().decode(bytes);
    expect(text).toContain("'=恶意公式");
    const book = XLSX.read(text, { type: 'string', raw: true });
    const rows = XLSX.utils.sheet_to_json<(string | number)[]>(book.Sheets[book.SheetNames[0]], { header: 1 });
    expect(rows).toHaveLength(138);
    expect(rows[1].slice(14, 17)).toEqual(['-12.5', 'valid', "'-25/2"]);
    const manifest = JSON.parse(await zip.file('manifest.json')!.async('string'));
    expect(manifest.sources).toEqual(result.sources);
    expect(manifest.parameters.agentExport.exportedRows).toBe(137);
  });

  it('merges multi-quarter compatible results with original lineage without inventing values', async () => {
    const a = fullResult(2), b = fullResult(3);
    const out = prepareExportResult([a, b], { resultIds: [a.resultId, b.resultId], format: 'xlsx' });
    expect(out.table.rows).toHaveLength(274);
    const book = XLSX.read((await fileFor(out)).bytes, { type: 'array' });
    const rows = XLSX.utils.sheet_to_json<(string | number)[]>(book.Sheets['数据'], { header: 1 });
    expect(rows[1][0]).toBe(a.resultId); expect(rows[138][0]).toBe(b.resultId);
    expect(rows[1][1]).toContain('"quarter":2'); expect(rows[138][1]).toContain('"quarter":3');
    expect(out.parameters.exportPlans).toHaveLength(2);
    expect(rows).toHaveLength(275);
  });

  it('refuses missing export qualification, foreign owner, invented columns/data/paths and oversized exports', async () => {
    const base = fullResult(), workset = new AuthorizedResultWorkset(owner);
    workset.register(base, owner);
    const args = { resultIds: [base.resultId], format: 'xlsx' };
    await expect(exportAuthorizedTable(workset, owner, args, ['query:catalog'])).rejects.toThrow('AGENT_EXPORT_DENIED');
    for (const foreign of [{ actorId: randomUUID() }, { permissionRevision: 'revoked' }, { sessionId: randomUUID() }])
      await expect(exportAuthorizedTable(workset, { ...owner, ...foreign }, args, ['export:internal'])).rejects.toThrow('QUERY_DENIED');
    await expect(exportAuthorizedTable(workset, owner, { ...args, resultIds: [randomUUID()] }, ['export:internal'])).rejects.toThrow('AGENT_RESULT_NOT_FOUND');
    for (const input of [{ ...args, path: '/tmp/x' }, { ...args, values: [9] }, { ...args, sql: 'select *' }, { ...args, source: 'https://x' }])
      expect(() => parseAgentToolArguments('export_table', input)).toThrow();
    expect(() => prepareExportResult([base], { ...args, fields: ['private_phone'] })).toThrow('AGENT_FIELD_NOT_AVAILABLE');
    const huge = { ...base, table: { ...base.table, rows: Array.from({ length: 50001 }, () => base.table.rows[0]) } };
    expect(() => prepareExportResult([huge], args)).toThrow('AGENT_WORKSET_LIMIT');
    expect(() => prepareExportResult([base, base], { ...args, resultIds: [base.resultId, base.resultId] })).toThrow();
  });
});
