import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
const state = vi.hoisted(() => ({ calls: 0, revoked: false, authenticated: true,
  receive: vi.fn(), append: vi.fn(), intake: vi.fn(), list: vi.fn(), open: vi.fn(), change: vi.fn(), recheck: vi.fn() }));
const identity = { actorId: '11111111-1111-4111-8111-111111111111', effectiveUserId: '11111111-1111-4111-8111-111111111111',
  sessionId: '22222222-2222-4222-8222-222222222222', expiresAt: Date.now() + 600000 };
vi.mock('../serverAuthority', () => ({
  verifyQueryIdentity: async () => { if (!state.authenticated) throw new Error('QUERY_UNAUTHENTICATED'); return identity; },
  loadDataAuthority: async () => ({ ...identity, sessionActive: true, grants: ['query:catalog'], fields: [], policyVersion: 'fixture',
    permissionRevision: state.revoked && ++state.calls > 1 ? 'b'.repeat(64) : 'a'.repeat(64) }),
}));
vi.mock('../auditStore', () => ({ createRpcAuditPort: () => ({ receive: state.receive, append: state.append }) }));
vi.mock('../intake', () => ({ recordQueryIntake: (...args: unknown[]) => state.intake(...args) }));
vi.mock('../historyStore', () => ({ listOwnHistory: (...args: unknown[]) => state.list(...args),
  openOwnHistory: (...args: unknown[]) => state.open(...args), changeOwnHistory: (...args: unknown[]) => state.change(...args) }));
import { handleOwnHistory } from '../historyHttp';
import { IMPERSONATION_REQUEST_HEADER } from '@/src/lib/server/impersonationAuth';

const keys = { keyId: 'synthetic-history', encryptionKey: new Uint8Array(32).fill(1), digestKey: new Uint8Array(32).fill(2) };
const run = async (input: unknown = { action: 'list', search: '', archived: false }, headers: Record<string, string> = {}, enabled = true) => {
  const response = await handleOwnHistory(new Request('http://localhost/api/intelligence/query/history', { method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer synthetic', ...headers }, body: JSON.stringify(input) }),
  { client: {} as SupabaseClient, keys, enabled });
  return { response, body: await response.json() };
};
describe('owned history HTTP security and durable control envelope', () => {
  beforeEach(() => {
    state.calls = 0; state.revoked = false; state.authenticated = true;
    state.receive.mockReset().mockResolvedValue({ replayed: false }); state.append.mockReset().mockResolvedValue(undefined);
    state.intake.mockReset().mockResolvedValue(undefined); state.recheck.mockReset().mockResolvedValue(undefined);
    state.list.mockReset().mockResolvedValue({ entries: [], hasMore: false, indexing: false, unavailable: 0 });
    state.change.mockReset().mockResolvedValue(undefined);
    state.open.mockReset().mockResolvedValue({ opened: { title: '本人工作', conversation: { id: identity.actorId }, turns: [], hasMore: false,
      selected: { requestId: identity.actorId, reply: { status: 'ready', result: { resultId: identity.sessionId, table: { rows: [] } } } } }, recheck: state.recheck });
  });
  it('reads owner history with fresh authority and private no-store delivery, retaining only references in response audit', async () => {
    const { response, body } = await run({ action: 'open', requestId: identity.actorId });
    expect(response.status).toBe(200); expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(body.opened.title).toBe('本人工作'); expect(state.recheck).toHaveBeenCalledOnce(); expect(state.intake).toHaveBeenCalledOnce();
    const generated = state.append.mock.calls.find(call => call[1] === 'response_generated')?.[2];
    expect(generated.result.kind).toBe('history_reference'); expect(generated).not.toHaveProperty('opened');
    expect(JSON.stringify(generated)).not.toContain('本人工作');
  });
  it('refuses anonymous, disabled, impersonated and cross-origin requests before reading history', async () => {
    state.authenticated = false; expect((await run()).response.status).toBe(401);
    state.authenticated = true; expect((await run(undefined, {}, false)).response.status).toBe(403);
    expect((await run(undefined, { [IMPERSONATION_REQUEST_HEADER]: identity.actorId })).response.status).toBe(403);
    expect((await run(undefined, { Origin: 'https://untrusted.example' })).response.status).toBe(403);
    expect(state.list).not.toHaveBeenCalled(); expect(state.open).not.toHaveBeenCalled();
  });
  it('withholds the full response if permission changes after history has been read', async () => {
    state.revoked = true; const { response, body } = await run({ action: 'open', requestId: identity.actorId });
    expect(response.status).toBe(403); expect(body).not.toHaveProperty('opened');
    expect(state.append.mock.calls.some(call => call[1] === 'correction' && call[2].delivery === 'not_sent')).toBe(true);
  });
  it('withholds a restored snapshot when final source reauthorization fails', async () => {
    state.recheck.mockRejectedValue(new Error('QUERY_DENIED'));
    const { response, body } = await run({ action: 'open', requestId: identity.actorId });
    expect(response.status).toBe(403); expect(body).not.toHaveProperty('opened');
  });
  it('reports a missing history migration as unavailable without pretending zero records or removing audit originals', async () => {
    state.list.mockRejectedValue(new Error('QUERY_HISTORY_UNAVAILABLE'));
    const { response, body } = await run(); expect(response.status).toBe(503); expect(body.status).toBe('unavailable');
    expect(body).not.toHaveProperty('page'); expect(body.error).toContain('不会因此被删除');
  });
  it('requests a fresh page when a valid owned cursor expires while retaining strict denial for invalid references', async () => {
    state.list.mockRejectedValueOnce(new Error('QUERY_HISTORY_REOPEN'));
    const expired = await run(); expect(expired.response.status).toBe(409); expect(expired.body.error).toContain('重新读取历史');
    expect(expired.body.page).toBeUndefined();
    state.list.mockRejectedValueOnce(new Error('QUERY_DENIED'));
    expect((await run()).response.status).toBe(403);
  });
  it('requires durable audit and validates exact owner-operation inputs before mutation', async () => {
    expect((await run({ action: 'rename', conversationId: identity.actorId, title: '私有标题', actorId: identity.actorId })).response.status).toBe(503);
    expect(state.change).not.toHaveBeenCalled(); state.receive.mockRejectedValue(new Error('synthetic audit failure'));
    expect((await run({ action: 'archive', conversationId: identity.actorId, archived: true })).response.status).toBe(503);
    expect(state.change).not.toHaveBeenCalled();
  });
});
