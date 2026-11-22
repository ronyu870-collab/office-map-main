import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { buildListResult } from '../result';
import { resultViewSchema, type QueryResultView } from '../presentation';
import { fixture } from './fixtures';
import type { AnswerSelection } from '../answerSelection';

const state = vi.hoisted(() => ({ primary: null as unknown as QueryResultView, selection: undefined as AnswerSelection | undefined, sourceRevoked: false }));
vi.mock('../serverAuthority', () => ({
  verifyQueryIdentity: async () => ({ actorId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', effectiveUserId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', sessionId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', expiresAt: Date.now() + 60000 }),
  loadDataAuthority: async () => ({ actorId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', effectiveUserId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', sessionActive: true, policyVersion: 'test', permissionRevision: 'a'.repeat(64), grants: ['query:catalog'], fields: [] }),
}));
vi.mock('../recovery', () => ({
  readOwnResult: async () => ({ state: 'succeeded', permission_revision: 'a'.repeat(64), head_hash: 'c'.repeat(64), head_sequence: 3, events: [] }),
  recoverOwnResult: async () => ({ answerSelection: state.selection, result: state.primary, resultId: state.primary.resultId, redactionTypes: [], recheck: async () => { if (state.sourceRevoked) throw new Error('QUERY_DENIED'); } }),
}));
import { handleResultRecovery } from '../recoveryHttp';

const requestId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
function buildingResult(name: string) {
  const result = resultViewSchema.parse(buildListResult(fixture(), ['height']));
  const id = crypto.randomUUID(), nameSource = result.sources.find(source => source.id === result.table.rows[0].cells.name.sourceIds[0])!;
  result.sources = [{ ...nameSource, entityId: id, recordId: id, rawValue: name }];
  result.table.columns = result.table.columns.filter(column => column.key === 'name');
  result.table.rows = [{ entityId: id, cells: { name: { kind: 'text', value: name, sourceIds: [nameSource.id] } } }];
  return result;
}
async function run(resultId?: string) {
  const rpc = vi.fn(() => ({ abortSignal: () => Promise.resolve({ data: { event_id: crypto.randomUUID(), sequence: 1, event_hash: 'a'.repeat(64), replayed: false }, error: null }) }));
  const from = vi.fn((table: string) => {
    let ids: string[] = [];
    const query = { select: () => query, in: (_column: string, values: string[]) => { ids = values; return query; }, eq: () => query, is: () => query,
      or: () => query, not: () => query, order: () => query, limit: () => query,
      abortSignal: async () => ({ data: table === 'buildings' ? ids.map(id => ({ id, submarket: 'CBD', grade: 'A', location_lng: 116.4, location_lat: 39.9 })) : [], error: null }) };
    return query;
  });
  const request = new Request('http://localhost/api/intelligence/query/buildings', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer synthetic' },
    body: JSON.stringify({ requestId, action: 'buildings', mapSelection: true, limit: 500, ...(resultId ? { resultId } : {}) }) });
  const response = await handleResultRecovery(request, { client: { rpc, from } as unknown as SupabaseClient, enabled: true,
    keys: { keyId: 'test', encryptionKey: new Uint8Array(32).fill(1), digestKey: new Uint8Array(32).fill(2) } }, 'buildings');
  return { response, body: await response.json(), from };
}

describe('map links bind to the exact selected answer snapshot at the HTTP boundary', () => {
  beforeEach(() => { state.primary = buildingResult('主结果楼宇'); state.selection = undefined; state.sourceRevoked = false; });
  it('serves comparison buildings and their result identity instead of the primary selection', async () => {
    const secondary = buildingResult('比较结果楼宇');
    state.selection = { version: 'answer-selection/1', task: 'comparison', status: 'answered', primaryResultId: state.primary.resultId,
      results: [{ role: 'primary', result: state.primary }, { role: 'comparison', result: secondary }] };
    const { response, body } = await run(secondary.resultId);
    expect(response.status).toBe(200);
    expect(body.resultId).toBe(secondary.resultId);
    expect(body.buildings).toMatchObject([{ id: secondary.table.rows[0].entityId, name: '比较结果楼宇', located: true }]);
    expect(JSON.stringify(body)).not.toContain('主结果楼宇');
  });
  it('rejects a valid but unselected result UUID before reading building metadata', async () => {
    state.selection = { version: 'answer-selection/1', task: 'fact', status: 'answered', primaryResultId: state.primary.resultId,
      results: [{ role: 'primary', result: state.primary }] };
    const { response, body, from } = await run(crypto.randomUUID());
    expect(response.status).toBe(403); expect(body.buildings).toBeUndefined(); expect(from).not.toHaveBeenCalled();
  });
  it('keeps old request-only links compatible with the original primary result', async () => {
    const { response, body } = await run();
    expect(response.status).toBe(200); expect(body.resultId).toBe(state.primary.resultId);
    expect(body.buildings[0].name).toBe('主结果楼宇');
  });
  it('does not publish a map selection if current source access is revoked during delivery', async () => {
    state.sourceRevoked = true;
    const { response, body } = await run(state.primary.resultId);
    expect(response.status).toBe(403); expect(body.buildings).toBeUndefined();
  });
});
