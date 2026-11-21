import { describe, it, expect } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { randomUUID } from 'node:crypto';
import * as XLSX from 'xlsx';
import JSZip from 'jszip';
import { buildLeaseResult, deduplicateLeaseRows } from './research';
import { leasePlanSchema, type LeaseRow, type LeaseSnapshot } from './protocol';
import { leaseModelObservation, queryLeaseResearch } from './tool';
import { prepareExportResult } from '../agent/exportTableTool';
import { buildResultArtifact } from '../query/artifacts';
import { buildResultChart } from '../query/charts';
import { resultViewSchema, resultSummary } from '../query/presentation';
const BID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1';
function row(source: 'live' | 'history', area: string | null, extra: Partial<LeaseRow> = {}): LeaseRow {
  return { id: source + ':' + randomUUID(), source, fingerprint: 'a'.repeat(64), buildingId: BID,
    building: '合成楼宇甲', alias: '旧称甲座', match: 'exact', submarket: 'CBD', industry: 'TMT', start: '2026-01-01',
    end: '2026-03-31', precision: 'quarter', area, quality: 'SYNTHETIC', financials: {}, ...extra };
}
function fixture(): LeaseSnapshot {
  const a = row('live', '100'), dup = row('history', '100');
  return { allowed: true, version: 'lease-research/1', permission_revision: 'b'.repeat(64), sources: ['live', 'history'],
    details: true, financials: true, export: true, minGroupSize: 3,
    rows: [a, row('live', '0'), row('live', null, { start: '2026-04-01', end: '2026-06-30' }), dup,
      row('history', '250', { start: '2026-04-01', end: '2026-06-30' }),
      row('history', '500', { buildingId: null, building: '合成双楼项目', alias: '合成双楼项目', match: 'project', precision: 'year', start: '2026-01-01', end: '2026-12-31' }),
      row('history', '75', { buildingId: null, match: 'unmapped', start: null, end: null, precision: 'unknown' })],
    links: [{ live: a.id, history: dup.id, liveFingerprint: a.fingerprint, historyFingerprint: dup.fingerprint, revision: randomUUID() }] };
}
const plan = { source: 'combined', from: '2026-01-01', to: '2026-12-31' } as const;
const num = (result: ReturnType<typeof buildLeaseResult>, rowIndex: number, key: string) => {
  const cell = result.table.rows[rowIndex].cells[key]; return cell.kind === 'number' ? cell.value.numeric : null;
};
describe('controlled lease research deterministic facts and real files', () => {
  it('covers both sources without treating similar records as the same transaction', () => {
    const f = fixture();
    expect(buildLeaseResult(f, { ...plan, source: 'live' }).table.rows).toHaveLength(1);
    expect(num(buildLeaseResult(f, { ...plan, source: 'live' }), 0, 'count')).toBe(3);
    expect(num(buildLeaseResult(f, { ...plan, source: 'history' }), 0, 'count')).toBe(3);
    const combined = buildLeaseResult(f, plan);
    expect(num(combined, 0, 'count')).toBe(5); expect(num(combined, 0, 'area')).toBe(850);
    expect(num(combined, 0, 'areaValidCount')).toBe(4);
    f.rows[0].fingerprint = 'f'.repeat(64);
    expect(deduplicateLeaseRows(f, 'combined').stale).toBe(1);
    expect(num(buildLeaseResult(f, plan), 0, 'count')).toBe(6);
  });
  it('does not conflate equal UUIDs in two source tables or double a result when merging exports', () => {
    const f = fixture(); f.links = []; f.rows[3].id = 'history:' + f.rows[0].id.split(':')[1];
    expect(num(buildLeaseResult(f, plan), 0, 'count')).toBe(6);
    const a = buildLeaseResult(f, { ...plan, source: 'live' });
    const b = buildLeaseResult(f, { ...plan, source: 'history' });
    const merged = prepareExportResult([a, b], { resultIds: [a.resultId, b.resultId], format: 'xlsx' });
    expect(merged.table.rows).toHaveLength(2);
    expect(merged.parameters.leaseBindings).toHaveLength(2);
    expect(merged.table.rows[0].cells.count).toMatchObject({ kind: 'number', value: { numeric: 3 } });
  });
  it('uses aliases, preserves project uncertainty and never fans out area into member towers', () => {
    const f = fixture();
    const alias = buildLeaseResult(f, { ...plan, buildingName: '旧称甲座' });
    expect(num(alias, 0, 'area')).toBe(350);
    const ranked = buildLeaseResult(f, { ...plan, groupBy: 'building', topN: 1 });
    expect(num(ranked, 0, 'area')).toBe(500);
    expect(ranked.table.rows[0].cells.group).toMatchObject({ value: '合成双楼项目（项目，未分摊楼座）' });
    expect(num(buildLeaseResult(f, { ...plan, buildingIds: [BID] }), 0, 'area')).toBe(350);
  });
  it('asks to clarify ambiguous TMT instead of silently mapping it or claiming no transactions', async () => {
    const f = fixture(); for (const row of f.rows) row.industry = '互联网软件与服务';
    const client = { rpc: () => ({ abortSignal: async () => ({ data: f, error: null }) }) } as unknown as SupabaseClient;
    const actorId = randomUUID();
    const observed = await queryLeaseResearch(client, { actorId, effectiveUserId: actorId, sessionId: randomUUID(), expiresAt: Date.now() + 60000 },
      new AbortController().signal, { ...plan, industry: 'TMT' });
    expect(JSON.parse(observed.content).status).toBe('requires_clarification'); expect(observed.result).toBeUndefined();
  });
  it('uses explicit industry sets without automatic TMT recategorization', () => {
    const f = fixture(); f.rows[0].industry = '互联网软件与服务';
    expect(num(buildLeaseResult(f, { ...plan, industries: ['互联网软件与服务'] }), 0, 'count')).toBe(1);
    expect(leasePlanSchema.safeParse({ ...plan, industry: 'TMT', industries: ['互联网软件与服务'] }).success).toBe(false);
  });
  it('keeps year-only periods out of quarterly bins, excludes boundary/unknown dates and distinguishes missing area from zero', () => {
    const f = fixture();
    const quarters = buildLeaseResult(f, { ...plan, groupBy: 'quarter', sort: 'period', direction: 'asc' });
    const q1 = quarters.table.rows.findIndex(r => r.cells.group.kind === 'text' && r.cells.group.value === '2026-Q1');
    expect(num(quarters, q1, 'area')).toBe(100); expect(num(quarters, q1, 'count')).toBe(2);
    expect(quarters.table.rows).toHaveLength(4);
    expect(quarters.table.rows.filter(r => r.cells.count.kind === 'unknown')).toHaveLength(2);
    const chart = buildResultChart(resultViewSchema.parse(quarters), { kind: 'plot', type: 'line', x: 'group', y: ['area'] });
    expect(chart.points.map(point => point.y)).toEqual([100, 250, null, null]);
    expect(chart.connectNulls).toBe(false);
    expect(quarters.parameters.leaseCoverage).toMatchObject({ uncertainQuarter: 1 });
    const partial = buildLeaseResult(f, { ...plan, from: '2026-02-01' });
    expect(num(partial, 0, 'area')).toBe(250);
    const details = buildLeaseResult(f, { ...plan, mode: 'details' });
    expect(details.table.rows.filter(r => r.cells.area.kind === 'unknown')).toHaveLength(1);
    expect(details.table.rows.filter(r => r.cells.area.kind === 'number' && r.cells.area.value.numeric === 0)).toHaveLength(1);
    expect(resultSummary(resultViewSchema.parse(details)).join()).not.toContain('栋');
  });
  it('keeps live and historical face/effective rents distinct and rejects unauthorized/sensitive fields', () => {
    const f = fixture(); f.rows[0].financials = { faceRent: '250', effectiveRent: '200', leaseMonths: '36', freeMonths: '3' };
    f.rows[3].financials = { faceRent: '180', effectiveRent: '150', managementFee: '30' };
    const r = buildLeaseResult(f, { ...plan, mode: 'details', fields: ['period', 'liveFaceRent', 'liveEffectiveRent', 'historyFaceRent', 'historyEffectiveRent', 'historyManagementFee'], sort: 'period' });
    expect(r.table.columns.map(c => c.label).join()).not.toContain('历史净有效');
    expect(r.table.rows.some(row => row.cells.liveEffectiveRent.kind === 'number' && row.cells.liveEffectiveRent.value.numeric === 200)).toBe(true);
    f.financials = false;
    expect(() => buildLeaseResult(f, { ...plan, mode: 'details', fields: ['area', 'liveEffectiveRent'] })).toThrow('QUERY_DENIED');
    for (const field of ['company', 'agency_person', 'submitter_name', 'netEffectiveRent', 'sql']) expect(leasePlanSchema.safeParse({ ...plan, fields: [field], mode: 'details' }).success).toBe(false);
    f.sources = ['live']; expect(() => buildLeaseResult(f, plan)).toThrow('QUERY_DENIED');
  });
  it('suppresses small aggregate-only groups and never gives detail rows to the model', () => {
    const f = fixture(); f.details = false;
    const r = buildLeaseResult(f, { ...plan, groupBy: 'quarter' });
    expect(r.table.rows).toHaveLength(4);
    expect(r.table.rows.every(row => row.cells.area.kind === 'unknown')).toBe(true);
    expect(() => buildLeaseResult(f, { ...plan, mode: 'details' })).toThrow('QUERY_DENIED');
    f.rows.forEach(r => { r.area = null; }); f.rows[0].area = '100';
    expect(buildLeaseResult(f, plan).table.rows[0].cells.area).toMatchObject({ kind: 'unknown', reason: 'disclosure_threshold' });
    f.details = true;
    const d = buildLeaseResult(f, { ...plan, mode: 'details' });
    const observation = JSON.stringify(leaseModelObservation(d));
    expect(observation).not.toContain('合成楼宇甲'); expect(observation).not.toContain('旧称甲座');
    expect(JSON.stringify(leaseModelObservation(buildLeaseResult(f, { ...plan, groupBy: 'building' })))).not.toContain('合成双楼项目');
    f.details = false; const total = buildLeaseResult(f, { ...plan, groupBy: 'quarter' });
    expect(total.table.rows).toHaveLength(4);
    expect(total.table.rows.every(row => row.cells.area.kind === 'unknown')).toBe(true);
    expect(d.sources[0].rawValue).toBeNull(); expect(JSON.stringify(d.parameters)).not.toContain('旧称甲座');
  });
  it('round-trips full Chinese XLSX/CSV, numeric zeros, missing values, selective fields and safe source manifests', async () => {
    const f = fixture();
    f.rows = Array.from({ length: 25 }, (_, i) => row('live', String(i), { building: i === 0 ? '=HYPERLINK("unsafe")' : '合成楼宇' + i })); f.links = [];
    const r = buildLeaseResult(f, { ...plan, mode: 'details' });
    for (const format of ['xlsx', 'csv_zip'] as const) {
      const derived = prepareExportResult([r], { resultIds: [r.resultId], format, fields: ['building', 'area'], singleSheet: true });
      const file = await buildResultArtifact(derived, { requestId: randomUUID(), resultId: derived.resultId, action: 'export', format });
      if (file.type !== 'download') throw new Error('missing file');
      if (format === 'xlsx') {
        const book = XLSX.read(file.bytes, { type: 'array' }); expect(book.SheetNames).toHaveLength(1);
        const sheet = book.Sheets[book.SheetNames[0]], values = XLSX.utils.sheet_to_json(sheet, { header: 1, range: sheet['!autofilter']!.ref }) as unknown[][];
        expect(values).toHaveLength(26); expect(JSON.stringify(values)).toContain('合成楼宇24');
        expect(values.slice(1).reduce((sum, row) => sum + Number(row[1]), 0)).toBe(300);
        expect(Object.values(sheet).some(cell => cell && typeof cell === 'object' && 'f' in cell)).toBe(false);
      } else {
        const zip = await JSZip.loadAsync(file.bytes), csv = await zip.file('data.csv')!.async('string');
        expect(csv).toContain('合成楼宇24'); expect(csv).toContain("'=HYPERLINK");
        const manifest = JSON.parse(await zip.file('manifest.json')!.async('string'));
        expect(JSON.stringify(manifest)).not.toContain('submitter'); expect(JSON.stringify(manifest.sources)).not.toContain('300');
      }
    }
  });
  it('binds industry/building/quarter charts to the full aggregate cells with proportional geometry', () => {
    const r = buildLeaseResult(fixture(), { ...plan, groupBy: 'building' });
    const chart = buildResultChart(resultViewSchema.parse(r), { kind: 'plot', type: 'horizontal_bar', x: 'group', y: ['area'] });
    expect(chart.points.map(p => p.y).sort((a, b) => Number(a) - Number(b))).toEqual([350, 500]);
    expect(chart.points.every(p => p.yCell.sourceIds[0] === r.sources[0].id)).toBe(true);
  });
});
