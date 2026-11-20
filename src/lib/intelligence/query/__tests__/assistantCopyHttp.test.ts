import { randomUUID } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { auditPayloadDigest, encryptAuditContent } from '../auditCrypto';
import type { AuditKeys } from '../auditStore';

const state = vi.hoisted(() => ({ exportGranted: true, owner: true, revokeAtDelivery: false, changed: false,
  statusReads: 0, authReads: 0, legacy: false, deniedParent: false }));
const ids = { actor: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', session: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  request: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', conversation: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd' };
const message = '**你好**，可以继续研究北京办公楼市场。';
const keys: AuditKeys = { keyId: 'test', encryptionKey: new Uint8Array(32).fill(3), digestKey: new Uint8Array(32).fill(4) };
vi.mock('../serverAuthority', () => ({
  verifyQueryIdentity: async () => ({ actorId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', effectiveUserId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    sessionId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', expiresAt: Date.now() + 60000 }),
  loadDataAuthority: async () => {
    state.authReads++;
    return { actorId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', effectiveUserId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      sessionActive: true, policyVersion: 'test', permissionRevision: 'a'.repeat(64),
      grants: ['query:catalog', ...(state.exportGranted && !(state.revokeAtDelivery && state.statusReads >= 2) ? ['export:internal'] : [])],
      fields: [], allSubmarkets: false, submarkets: ['CBD'], allBuildings: true, buildingIds: [] };
  },
}));
import { handleAssistantCopy } from '../assistantCopyHttp';

function event(sequence: number, kind: string, payload: unknown) {
  const eventId = randomUUID(), content = JSON.stringify({ content: payload, redactionTypes: [] });
  return { request_id: ids.request, event_id: eventId, sequence, kind, payload_digest: auditPayloadDigest(content, keys.digestKey),
    cipher: encryptAuditContent(content, { requestId: ids.request, eventId, actorId: ids.actor, effectiveUserId: ids.actor }, keys.keyId, keys.encryptionKey) };
}

async function run(extra: Record<string, unknown> = {}, headers: Record<string, string> = {}) {
  const protocol = state.legacy ? 'research-conversation/1' : 'colliers-agent-conversation/1';
  const receipt = event(1, 'received', { submittedText: '你好', sessionId: ids.session,
    authority: { actorId: ids.actor, effectiveUserId: ids.actor }, plan: { resolution: state.legacy ? 'server_semantic/1' : 'server_agent/1' },
    metadata: { protocol, conversation: { id: ids.conversation } } });
  const answer = state.legacy ? event(2, 'denied', { response: { code: 'conditions_required', reason: 'assistant_help', message, options: [] },
    resolution: { protocol, semanticContext: { version: 'colliers-semantic-context/1', comparisonSubmarkets: [],
      ...(state.deniedParent ? { lastPlan: { operation: 'list', fields: [], period: null, scope: { inventory: 'all_authorized', submarkets: ['WANGJING'] } } } : {}) } } })
    : event(2, 'tool_finished', { protocol: 'agent-answer/1', permissionRevision: 'a'.repeat(64), history: [{ user: '你好', assistant: message }] });
  const events = state.legacy ? [receipt, answer] : [receipt, answer,
    event(3, 'response_generated', { result: { version: 'agent-message/1', text: message } }),
    event(4, 'succeeded', { delivery: 'not_yet_sent' })];
  const rpc = vi.fn((name: string, input: Record<string, unknown>) => ({ abortSignal: async () => {
    if (name === 'ai_query_result_read') {
      if (input.p_action === 'status') state.statusReads++;
      return { error: null, data: state.owner ? { allowed: true, state: state.legacy ? 'denied' : 'succeeded', permission_revision: 'a'.repeat(64),
        head_sequence: events.length, head_hash: (state.changed && state.statusReads >= 2 ? 'd' : 'c').repeat(64), events: input.p_action === 'archive' ? events : [] }
        : { allowed: false } };
    }
    if (name === 'ai_query_context_read') return { error: null, data: { allowed: true, permission_revision: 'a'.repeat(64),
      state: state.legacy ? 'denied' : 'succeeded', events: [receipt, answer] } };
    return { error: null, data: { event_id: randomUUID(), sequence: 1, event_hash: 'a'.repeat(64), replayed: false } };
  } }));
  const request = new Request('http://localhost/api/intelligence/query/copy', { method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer synthetic', ...headers },
    body: JSON.stringify({ action: 'copy', requestId: ids.request, conversationId: ids.conversation, ...extra }) });
  const response = await handleAssistantCopy(request, { enabled: true, keys, client: { rpc } as unknown as SupabaseClient });
  return { response, body: await response.json(), rpc };
}

describe('ordinary assistant copy authorization and immutable archive', () => {
  beforeEach(() => { Object.assign(state, { exportGranted: true, owner: true, revokeAtDelivery: false, changed: false,
    statusReads: 0, authReads: 0, legacy: false, deniedParent: false }); });
  it('decrypts the original native response and returns a signed no-store copy', async () => {
    const { response, body } = await run();
    expect(response.status).toBe(200); expect(body).toMatchObject({ requestId: ids.request, conversationId: ids.conversation, status: 'ready', text: message });
    expect(response.headers.get('cache-control')).toContain('no-store');
    expect(response.headers.get('x-query-delivery-token')).toBeTruthy();
    expect(state.statusReads).toBe(2);
  });
  it('can copy legacy assistant help without requiring an indexed history thread', async () => {
    state.legacy = true;
    const { response, body, rpc } = await run();
    expect(response.status).toBe(200); expect(body.text).toBe(message);
    expect(rpc.mock.calls.some(([name]) => name === 'ai_query_history')).toBe(false);
  });
  it('checks independent export access before reading the original answer', async () => {
    state.exportGranted = false;
    const { response, body } = await run();
    expect(response.status).toBe(403); expect(body.text).toBeUndefined(); expect(state.statusReads).toBe(0);
  });
  it('rejects another owner, mismatched conversation, and client-supplied replacement text', async () => {
    state.owner = false;
    expect((await run()).response.status).toBe(403);
    state.owner = true;
    expect((await run({ conversationId: randomUUID() })).response.status).toBe(403);
    expect((await run({ text: 'invented' })).response.status).toBe(403);
  });
  it('still rejects inherited legacy scope when it is no longer authorized', async () => {
    state.legacy = true; state.deniedParent = true;
    const { response, body } = await run();
    expect(response.status).toBe(403); expect(body.text).toBeUndefined();
  });
  it('refuses changed archives or export revocation before delivery', async () => {
    state.changed = true;
    const changed = await run(); expect(changed.response.status).toBe(409); expect(changed.body.text).toBeUndefined();
    state.changed = false; state.statusReads = 0; state.revokeAtDelivery = true;
    const revoked = await run(); expect(revoked.response.status).toBe(403); expect(revoked.body.text).toBeUndefined();
  });
  it('rejects a cross-site request before recovering a response', async () => {
    const { response, body } = await run({}, { Origin: 'https://other.example.com' });
    expect(response.status).toBe(403); expect(body.text).toBeUndefined(); expect(state.statusReads).toBe(0);
  });
});
