import { beforeEach, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import * as XLSX from 'xlsx';
import { buildListResult } from '../result';
import { fixture } from './fixtures';
import { prepareExportResult } from '../../agent/exportTableTool';
const state = vi.hoisted(() => ({ exportAllowed: true, revoked: false, result: null as unknown, answerSelection: null as unknown, archiveReads: 0 }));
vi.mock('../serverAuthority', () => ({
  verifyQueryIdentity: async () => ({ actorId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', effectiveUserId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', sessionId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', expiresAt: Date.now() + 60000 }),
  loadDataAuthority: async () => ({ actorId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', effectiveUserId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', sessionActive: true, policyVersion: 'test', permissionRevision: 'a'.repeat(64), grants: state.exportAllowed ? ['query:catalog', 'export:internal'] : ['query:catalog'], fields: [] }),
}));
vi.mock('../recovery', () => ({
  readOwnResult: async () => ({ allowed: true, state: 'succeeded', permission_revision: 'a'.repeat(64), head_hash: 'c'.repeat(64), head_sequence: 4, events: [] }),
  recoverOwnResult: async () => { state.archiveReads++; const result = state.result as { resultId: string }; return { result, resultId: result.resultId,
    ...(state.answerSelection ? { answerSelection: state.answerSelection } : {}), redactionTypes: [], recheck: async () => { if (state.revoked) throw new Error('QUERY_DENIED'); } }; },
}));
import { handleResultRecovery } from '../recoveryHttp';
beforeEach(() => { state.result = buildListResult(fixture(), ['height']); state.answerSelection = null; state.exportAllowed = true; state.revoked = false; state.archiveReads = 0; });
async function download(rowIndexes: number[], resultId?: string, format: 'xlsx' | 'csv_zip' = 'xlsx') {
  const result = state.result as { resultId: string };
  const rpc = vi.fn(() => ({ abortSignal: () => Promise.resolve({ data: { event_id: crypto.randomUUID(), sequence: 1, event_hash: 'a'.repeat(64), replayed: false }, error: null }) }));
  const request = new Request('http://localhost/api/intelligence/query/artifact', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer synthetic' }, body: JSON.stringify({ requestId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', resultId: resultId ?? result.resultId, action: 'export', format, selection: { kind: 'selected', rowIndexes } }) });
  return handleResultRecovery(request, { client: { rpc } as unknown as SupabaseClient, enabled: true, keys: { keyId: 'test', encryptionKey: new Uint8Array(32).fill(1), digestKey: new Uint8Array(32).fill(2) } }, 'artifact');
}
it('delivers real XLSX selected rows through the authenticated recovery/artifact HTTP path', async () => {
  const response = await download([1]); expect(response.status).toBe(200);
  expect(response.headers.get('content-type')).toContain('spreadsheetml');
  const workbook = XLSX.read(new Uint8Array(await response.arrayBuffer()), { type: 'array' });
  const rows = XLSX.utils.sheet_to_json(workbook.Sheets['数据'], { header: 1 }) as unknown[][];
  expect(rows).toHaveLength(2); expect(rows[1]).toContain('B座'); expect(rows[1]).toContain(198);
});
it('denies missing export grants before reading the archive and rejects forged selections', async () => {
  state.exportAllowed = false; expect((await download([0])).status).toBe(403); expect(state.archiveReads).toBe(0);
  state.exportAllowed = true; expect((await download([99])).status).toBe(422);
});
it('rechecks permissions before delivery even when the same file bytes are warm in the renderer cache', async () => {
  expect((await download([0])).status).toBe(200);
  state.revoked = true; const response = await download([0]); expect(response.status).toBe(403);
  expect(await response.json()).not.toHaveProperty('result');
});

it('downloads each exact archived attachment and rechecks export permission on every download', async () => {
  const raw = buildListResult(fixture(), ['height']);
  const source = { ...raw, parameters: { ...raw.parameters, executedPlan: { operation: 'list', fields: ['height'], period: null, scope: { inventory: 'tracked' } } } };
  const a = prepareExportResult([source], { resultIds: [source.resultId], format: 'xlsx' });
  const b = prepareExportResult([source], { resultIds: [source.resultId], format: 'csv_zip' });
  state.result = a; state.answerSelection = { version: 'answer-selection/1', task: 'file', status: 'answered', primaryResultId: a.resultId,
    results: [{ role: 'primary', result: a }, { role: 'comparison', result: b }] };
  const excel = await download([1], a.resultId);
  expect(excel.status).toBe(200); expect(excel.headers.get('x-query-result-id')).toBe(a.resultId);
  const book = XLSX.read(new Uint8Array(await excel.arrayBuffer()), { type: 'array' });
  expect(XLSX.utils.sheet_to_json(book.Sheets['数据'], { header: 1 })).toEqual([['entity_id', '楼宇', '建筑高度 (m)'], ['B', 'B座', 198]]);
  const csv = await download([1], b.resultId, 'csv_zip');
  expect(csv.status).toBe(200); expect(csv.headers.get('x-query-result-id')).toBe(b.resultId);
  const { default: JSZip } = await import('jszip'); const zip = await JSZip.loadAsync(await csv.arrayBuffer());
  const text = await zip.file('data.csv')!.async('string');
  expect(text).toContain('B座'); expect(text).not.toContain('A座'); expect(text).toContain('198');
  state.revoked = true; expect((await download([1], b.resultId, 'csv_zip')).status).toBe(403);
  state.revoked = false; state.exportAllowed = false;
  expect((await download([1], a.resultId)).status).toBe(403);
});
