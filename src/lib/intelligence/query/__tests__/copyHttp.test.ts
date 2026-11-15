import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { buildAggregateResult } from '../result';
import { fixture } from './fixtures';

const state = vi.hoisted(() => ({ exportGranted: true, reads: 0, revoked: false, sourceRevoked: false, result: null as unknown }));
vi.mock('../serverAuthority', () => ({
  verifyQueryIdentity: async () => ({ actorId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', effectiveUserId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    sessionId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', expiresAt: Date.now() + 60000 }),
  loadDataAuthority: async () => ({ actorId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', effectiveUserId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    sessionActive: true, policyVersion: 'test', permissionRevision: 'a'.repeat(64), grants: ['query:catalog', ...(state.exportGranted ? ['export:internal'] : [])], fields: [] }),
}));
vi.mock('../recovery', () => ({
  readOwnResult: async () => { state.reads++; return { allowed: true, state: 'succeeded', permission_revision: state.revoked && state.reads > 1 ? 'b'.repeat(64) : 'a'.repeat(64),
    head_hash: 'c'.repeat(64), head_sequence: 3, events: [] }; },
  recoverOwnResult: async () => ({ result: state.result, resultId: (state.result as { resultId: string }).resultId, redactionTypes: [],
    recheck: async () => { if (state.sourceRevoked) throw new Error('QUERY_DENIED'); } }),
}));
import { handleResultRecovery } from '../recoveryHttp';
const requestId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
describe('P2 copying requires independent export access at the server', () => {
  beforeEach(() => { state.exportGranted = true; state.reads = 0; state.revoked = false; state.sourceRevoked = false; state.result = buildAggregateResult(fixture(), 'rent'); });
  async function run(extra: Record<string, unknown> = {}) {
    const rpc = vi.fn(() => ({ abortSignal: () => Promise.resolve({ data: { event_id: crypto.randomUUID(), sequence: 1, event_hash: 'a'.repeat(64), replayed: false }, error: null }) }));
    const request = new Request('http://localhost/api/intelligence/query/artifact', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer synthetic' },
      body: JSON.stringify({ requestId, resultId: (state.result as { resultId: string }).resultId, action: 'copy', format: 'conclusion', ...extra }) });
    const response = await handleResultRecovery(request, { client: { rpc } as unknown as SupabaseClient, enabled: true,
      keys: { keyId: 'test', encryptionKey: new Uint8Array(32).fill(1), digestKey: new Uint8Array(32).fill(2) } }, 'artifact');
    return { response, body: await response.json() };
  }
  it('T18 rejects before reading a result if export:internal is absent', async () => {
    state.exportGranted = false; const { response, body } = await run();
    expect(response.status).toBe(403); expect(body.text).toBeUndefined(); expect(state.reads).toBe(0);
  });
  it('T08 returns only approved source-bound text and a no-store receipt', async () => {
    const { response, body } = await run();
    expect(response.status).toBe(200); expect(body).toMatchObject({ status: 'ready', format: 'conclusion', requestId });
    expect(body.text).toContain('170 元/㎡/月'); expect(body.text).toContain('2026Q3');
    expect(body.result).toBeUndefined(); expect(response.headers.get('cache-control')).toContain('no-store');
    expect(response.headers.get('x-query-delivery-token')).toBeTruthy(); expect(state.reads).toBe(2);
  });
  it.each(['revoked', 'sourceRevoked'] as const)('T12 refuses copy after %s before final response', async mode => {
    state[mode] = true; const { response, body } = await run();
    expect(response.status).toBe(403); expect(body.text).toBeUndefined();
  });
  it('refuses supplied text rather than accepting a client-generated artifact', async () => {
    const { response, body } = await run({ text: 'invented' });
    expect(response.status).toBe(403); expect(body.text).toBeUndefined(); expect(state.reads).toBe(0);
  });
});
