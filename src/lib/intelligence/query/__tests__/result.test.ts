import { describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';
import { parseQueryPlan } from '../plan';
import { bindChart, buildAggregateResult, buildListResult, buildRankResult, resultDigest, type ChartBinding } from '../result';
import { buildCsvPackage, buildXlsx, spreadsheetSafeText } from '../exports';
import { fixture, nameSource } from './fixtures';

describe('same-result tables, charts and exports', () => {
  it('binds chart marks to table cells; chart changes never change the snapshot (T38/T42)', () => {
    const result = buildListResult(fixture(), ['height', 'netEffectiveRent']);
    const digest = resultDigest(result);
    const bars = bindChart(result, { resultId: result.resultId, tableId: result.table.id, kind: 'bar', x: 'name', y: 'height' });
    expect(bars.points.map(point => point.y)).toEqual([210, 198, null, null]);
    const scatter = bindChart(result, { resultId: result.resultId, tableId: result.table.id, kind: 'scatter', x: 'height', y: 'netEffectiveRent' });
    expect(scatter.points.map(point => [point.x, point.y])).toEqual([[210, 100], [198, 200], [null, null], [null, 150]]);
    expect(resultDigest(result)).toBe(digest);
    expect(Object.isFrozen(result.table.rows[0].cells.height)).toBe(true);
    expect(() => bindChart(result, { resultId: crypto.randomUUID(), tableId: result.table.id, kind: 'bar', x: 'name', y: 'height' })).toThrow('RESULT_BINDING_MISMATCH');
    expect(() => bindChart(result, { resultId: result.resultId, tableId: result.table.id, kind: 'line', x: 'name', y: 'height' })).toThrow('TIME_AXIS_REQUIRED');
    expect(() => bindChart(result, { resultId: result.resultId, tableId: result.table.id, kind: 'bar', x: 'name', y: 'height', data: [999] } as ChartBinding)).toThrow();
  });

  it('captures provenance without source mutation and rejects value/source divergence', () => {
    const snapshot = fixture();
    const result = buildRankResult(snapshot, 'height', 1, 'desc');
    const used = result.table.rows[0].cells.height.sourceIds[0];
    expect(result.sources.find(source => source.id === used)?.rawValue).toBe(210);
    expect(result.sources.find(source => source.id === result.table.rows[0].cells.name.sourceIds[0])?.rawValue).toBe('A座');
    const name = snapshot.rows[0].nameSource;
    (name as { rawValue: unknown }).rawValue = 'changed';
    expect(result.sources.find(source => source.id === name.id)?.rawValue).toBe('A座');
    expect(() => buildListResult(snapshot, ['height'])).toThrow('ENTITY_SOURCE_REQUIRED');
  });

  it('exports and reads an actual XLSX with numeric values, exact fractions and source records (T38/T43)', async () => {
    const result = buildAggregateResult(fixture(), 'vacancy');
    const bytes = await buildXlsx(result);
    const workbook = XLSX.read(bytes, { type: 'array' });
    expect(workbook.SheetNames).toEqual(['数据', '精确值与来源', '来源', '口径与快照']);
    expect(workbook.Sheets['数据'].B2.t).toBe('n');
    expect(workbook.Sheets['数据'].B2.v).toBe(0.175);
    expect(workbook.Sheets['精确值与来源'].D2.v).toBe('7');
    expect(workbook.Sheets['精确值与来源'].E2.v).toBe('40');
    expect(workbook.Sheets['口径与快照'].B2.v).toBe(result.resultId);
    const definitions = XLSX.utils.sheet_to_json<string[]>(workbook.Sheets['口径与快照'], { header: 1 });
    const analysis = JSON.parse(definitions.find(row => row[0] === 'analysis')![1]);
    expect(analysis.denominator.numeric).toBe(40000);
    expect(analysis.coverage.valid).toBe(2);
    const csv = buildCsvPackage(result);
    expect(csv.csv).toContain('"0.175","valid","7/40"');
    const manifest = JSON.parse(csv.manifest);
    expect(manifest.resultId).toBe(result.resultId);
    expect(manifest.digest).toBe(resultDigest(result));
    expect(manifest.analysis).toEqual(result.analysis);
  });

  it('keeps malicious source text inert in CSV and XLSX without changing numeric types', async () => {
    const snapshot = fixture();
    const malicious = '=HYPERLINK("https://example.invalid","click")';
    const changed = { ...snapshot, rows: snapshot.rows.map((row, index) => index === 0 ? { ...row, name: malicious, nameSource: nameSource(row.id, malicious) } : row) };
    const result = buildListResult(changed, ['height']);
    expect(buildCsvPackage(result).csv).toContain("'=HYPERLINK");
    const workbook = XLSX.read(await buildXlsx(result), { type: 'array' });
    expect(workbook.Sheets['数据'].B2).toMatchObject({ t: 's', v: malicious });
    expect(workbook.Sheets['数据'].B2.f).toBeUndefined();
    expect(workbook.Sheets['数据'].C2.t).toBe('n');
    for (const value of ['=1+1', '\t=1', '\r@SUM(1)', '\u200b+SUM(1)', '-2+3', '@x']) expect(spreadsheetSafeText(value)).toBe(`'${value}`);
  });
  it('splits long snapshot metadata without truncating Excel provenance', async () => {
    const result = { ...buildAggregateResult(fixture(), 'rent'), parameters: { longMetadata: '来源'.repeat(40000) } };
    const workbook = XLSX.read(await buildXlsx(result), { type: 'array' });
    const rows = XLSX.utils.sheet_to_json<string[]>(workbook.Sheets['口径与快照'], { header: 1 });
    const chunks = rows.filter(row => row[0].startsWith('parameters:part:')).map(row => row[1]).join('');
    expect(JSON.parse(chunks)).toEqual(result.parameters);
    expect(rows.find(row => row[0] === 'parameters:parts')?.[1]).toBe('3');
  });
});

describe('untrusted query plan boundary (T36/AUTH09)', () => {
  const valid = { operation: 'rank', scope: { inventory: 'tracked', submarkets: ['CBD'] }, field: 'height', period: null, direction: 'desc', limit: 10 };
  it('accepts typed intent and rejects SQL, fields, roles, URLs and malformed periods', () => {
    expect(parseQueryPlan(valid)).toEqual(valid);
    for (const extra of [{ sql: 'select * from user_roles' }, { role: 'admin' }, { url: 'http://127.0.0.1' }, { field: 'contact_phone' }, { period: { year: 2026, quarter: 5 } }]) expect(() => parseQueryPlan({ ...valid, ...extra })).toThrow();
    expect(() => parseQueryPlan({ ...valid, filter: { field: 'height', operator: 'raw_sql', value: '1' } })).toThrow();
  });
  it('bounds recursion and rejects prototype keys before schema recursion', () => {
    let filter: unknown = { field: 'height', operator: 'gt', value: '200' };
    for (let index = 0; index < 100; index++) filter = { operator: 'and', terms: [filter] };
    expect(() => parseQueryPlan({ ...valid, filter })).toThrow('QUERY_PLAN_TOO_COMPLEX');
    expect(() => parseQueryPlan(JSON.parse('{"__proto__":{"role":"admin"}}'))).toThrow('UNSAFE_QUERY_PLAN_KEY');
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    expect(() => parseQueryPlan(cyclic)).toThrow('CYCLIC_QUERY_PLAN');
  });
});
