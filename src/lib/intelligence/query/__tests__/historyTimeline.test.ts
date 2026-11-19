import { randomUUID } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { encryptAuditContent } from '../auditCrypto';
import type { AuditKeys } from '../auditStore';
import type { DataAuthority, VerifiedQueryIdentity } from '../serverAuthority';
const stubs = vi.hoisted(() => ({ read: vi.fn(), recover: vi.fn(), restoreAgent: vi.fn() }));
vi.mock('../recovery', () => ({ readOwnResult: stubs.read, recoverOwnResult: stubs.recover }));
vi.mock('../../agent/agentConversation', async original => ({
  ...(await original<typeof import('../../agent/agentConversation')>()), restoreOwnAgentAnswer: stubs.restoreAgent,
}));
import { AGENT_CONVERSATION_PROTOCOL } from '../../agent/agentConversation';
import { HISTORY_TIMELINE_PAGE_SIZE, historyInputSchema } from '../historyProtocol';
import { openOwnHistory } from '../historyStore';
import { unsealHistoryToken } from '../historyToken';

const actorId = randomUUID();
const identity: VerifiedQueryIdentity = { actorId, effectiveUserId: actorId, sessionId: randomUUID(), expiresAt: Date.now() + 3600000 };
const keys: AuditKeys = { keyId: 'history-timeline-fixture', encryptionKey: new Uint8Array(32).fill(3), digestKey: new Uint8Array(32).fill(7) };
const authority: DataAuthority = { ...identity, sessionActive: true, policyVersion: 'fixture', permissionRevision: 'a'.repeat(64),
  grants: ['query:catalog'], fields: [], allSubmarkets: false, submarkets: [], allBuildings: false, buildingIds: [] };

function fixture(count = 8) {
  const conversationId = randomUUID(), rechecks = new Map<string, ReturnType<typeof vi.fn>>();
  const rows = Array.from({ length: count }, (_, index) => ({ request_id: randomUUID(), submitted_at: new Date(Date.UTC(2026, 10, 20, 12 - index)).toISOString(), state: 'succeeded' }));
  const receipts = new Map<string, unknown>(rows.map((row, index) => {
    const eventId = randomUUID();
    const content = { authority: { actorId, effectiveUserId: actorId }, submittedText: `第${count - index}个问题`,
      metadata: { protocol: AGENT_CONVERSATION_PROTOCOL, conversation: { id: conversationId } }, plan: { resolution: 'server_agent/1' } };
    return [row.request_id, { request_id: row.request_id, event_id: eventId, sequence: 1, kind: 'received',
      cipher: encryptAuditContent(JSON.stringify({ content, redactionTypes: [] }), { requestId: row.request_id, eventId, actorId, effectiveUserId: actorId }, keys.keyId, keys.encryptionKey) }];
  }));
  const rpc = vi.fn((name: string, params: { p_request_id?: string; p_input?: { action: string; requestId?: string; beforeTime?: string; beforeId?: string } }) => ({
    abortSignal: async () => {
      if (name === 'ai_query_context_read') return { error: null, data: { allowed: true, permission_revision: authority.permissionRevision, state: 'succeeded', events: [receipts.get(params.p_request_id!)] } };
      if (name !== 'ai_query_history' || params.p_input?.action !== 'turns') throw new Error('Unexpected RPC');
      const input = params.p_input;
      const remaining = rows.filter(row => !input.beforeTime || row.submitted_at < input.beforeTime || (row.submitted_at === input.beforeTime && row.request_id < input.beforeId!));
      const selected = rows.find(row => row.request_id === (input.requestId ?? remaining[0]?.request_id));
      return { error: null, data: { allowed: true, permissionRevision: authority.permissionRevision,
        thread: { actor_id: actorId, effective_user_id: actorId, conversation_id: conversationId, last_request_id: rows[0].request_id,
          updated_at: rows[0].submitted_at, archived: false, title_event_id: null, title_cipher: null },
        records: remaining.slice(0, 10), selected, hasMore: remaining.length > 10 } };
    },
  }));
  stubs.read.mockImplementation(async (_client, _identity, requestId) => ({ state: 'succeeded', permission_revision: authority.permissionRevision, head_hash: requestId, head_sequence: 3 }));
  stubs.restoreAgent.mockImplementation(async (_client, _identity, _keys, _authority, _conversationId, requestId: string) => {
    const recheck = vi.fn().mockResolvedValue(undefined); rechecks.set(requestId, recheck);
    return { message: `原始回答 ${requestId}`, recheck };
  });
  const context = { client: { rpc } as unknown as SupabaseClient, keys, identity, authority, signal: new AbortController().signal };
  return { context, conversationId, rows, rpc, rechecks };
}

describe('bounded history timeline from original authorized snapshots', () => {
  beforeEach(() => vi.resetAllMocks());
  it('restores chronological answers in bounded pages without skipping the remainder of an RPC page', async () => {
    const { context, conversationId, rows } = fixture();
    const first = await openOwnHistory(context, { action: 'open', conversationId, includeTimeline: true });
    expect(first.opened.timeline).toHaveLength(HISTORY_TIMELINE_PAGE_SIZE);
    expect(first.opened.timeline?.map(turn => turn.requestId)).toEqual(rows.slice(0, 5).map(row => row.request_id).reverse());
    expect(first.opened.selected.requestId).toBe(rows[0].request_id);
    for (const turn of first.opened.timeline ?? []) {
      expect(turn.reply.conversation?.parentRequestId).toBe(turn.requestId);
      expect(unsealHistoryToken(turn.reply.conversation!.resumeToken!, identity, authority.permissionRevision, 'history-resume', keys))
        .toEqual(expect.objectContaining({ conversationId, requestId: turn.requestId }));
    }
    expect(first.opened.conversation).toEqual(first.opened.selected.reply.conversation);
    expect(first.opened.hasMore).toBe(true);
    const second = await openOwnHistory(context, { action: 'open', conversationId, includeTimeline: true, cursor: first.opened.nextCursor });
    expect(second.opened.timeline?.map(turn => turn.requestId)).toEqual(rows.slice(5).map(row => row.request_id).reverse());
    expect(second.opened.hasMore).toBe(false);
    expect(stubs.restoreAgent).toHaveBeenCalledTimes(rows.length);
    expect(stubs.recover).not.toHaveBeenCalled();
  });
  it('anchors an explicitly selected older turn after its predecessors without inserting newer answers', async () => {
    const { context, conversationId, rows } = fixture(14);
    const middle = await openOwnHistory(context, { action: 'open', conversationId, requestId: rows[2].request_id, includeTimeline: true });
    expect(middle.opened.timeline?.map(turn => turn.requestId)).toEqual(rows.slice(2, 7).map(row => row.request_id).reverse());
    expect(middle.opened.timeline?.at(-1)?.requestId).toBe(rows[2].request_id);
    const earlier = await openOwnHistory(context, { action: 'open', conversationId, includeTimeline: true, cursor: middle.opened.nextCursor });
    expect(earlier.opened.timeline?.map(turn => turn.requestId)).toEqual(rows.slice(7, 12).map(row => row.request_id).reverse());
    const outside = await openOwnHistory(context, { action: 'open', conversationId, requestId: rows[10].request_id, includeTimeline: true });
    expect(outside.opened.timeline?.map(turn => turn.requestId)).toEqual(rows.slice(10).map(row => row.request_id).reverse());
    expect(outside.opened.selected.requestId).toBe(rows[10].request_id);
    expect(outside.opened.hasMore).toBe(false);
  });
  it('rechecks every delivered answer and withholds a timeline when an older turn loses source access', async () => {
    const { context, conversationId, rows, rechecks } = fixture(3);
    const opened = await openOwnHistory(context, { action: 'open', conversationId, includeTimeline: true });
    rechecks.get(rows[2].request_id)!.mockRejectedValueOnce(new Error('QUERY_DENIED'));
    await expect(opened.recheck()).rejects.toThrow('QUERY_DENIED');
    expect(rechecks.get(rows[0].request_id)).toHaveBeenCalledOnce();
    expect(rechecks.get(rows[1].request_id)).toHaveBeenCalledOnce();
    expect(rechecks.get(rows[2].request_id)).toHaveBeenCalledOnce();
  });
  it('rejects an altered older snapshot at the final response boundary', async () => {
    const { context, conversationId, rows } = fixture(3);
    const opened = await openOwnHistory(context, { action: 'open', conversationId, includeTimeline: true });
    stubs.read.mockImplementation(async (_client, _identity, requestId) => ({ state: 'succeeded', permission_revision: authority.permissionRevision,
      head_hash: requestId === rows[2].request_id ? 'changed' : requestId, head_sequence: 3 }));
    await expect(opened.recheck()).rejects.toThrow('QUERY_RESULT_CHANGED');
  });
  it('denies the complete opening if a sibling answer cannot be authorized during restoration', async () => {
    const { context, conversationId, rows } = fixture(3);
    stubs.restoreAgent.mockImplementation(async (_client, _identity, _keys, _authority, _conversationId, requestId) => {
      if (requestId === rows[1].request_id) throw new Error('QUERY_DENIED');
      return { message: '原始已授权回答', recheck: vi.fn() };
    });
    await expect(openOwnHistory(context, { action: 'open', conversationId, includeTimeline: true })).rejects.toThrow('QUERY_DENIED');
  });
  it('keeps the legacy selected-snapshot contract and supports an explicitly selected older turn', async () => {
    const { context, conversationId, rows } = fixture();
    const result = await openOwnHistory(context, { action: 'open', conversationId, requestId: rows[7].request_id });
    expect(result.opened.timeline).toBeUndefined();
    expect(result.opened.selected.requestId).toBe(rows[7].request_id);
    expect(stubs.restoreAgent).toHaveBeenCalledOnce();
    expect(historyInputSchema.safeParse({ action: 'open', conversationId, includeTimeline: 'all' }).success).toBe(false);
  });
});
