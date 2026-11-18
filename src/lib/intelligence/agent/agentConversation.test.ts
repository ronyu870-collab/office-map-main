import { describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { encryptAuditContent } from '../query/auditCrypto';
import type { AuditKeys } from '../query/auditStore';
import type { DataAuthority, VerifiedQueryIdentity } from '../query/serverAuthority';
import { readAgentHistory, AGENT_CONVERSATION_PROTOCOL } from './agentConversation';

const identity: VerifiedQueryIdentity = {
  actorId: randomUUID(), effectiveUserId: randomUUID(), sessionId: randomUUID(),
  expiresAt: Date.now() + 3600000,
};
const keys: AuditKeys = { keyId: 'test-key', encryptionKey: new Uint8Array(32).fill(7),
  digestKey: new Uint8Array(32).fill(8) };
const authority: DataAuthority = {
  actorId: identity.actorId, effectiveUserId: identity.effectiveUserId, sessionId: identity.sessionId,
  sessionActive: true, policyVersion: 'test', permissionRevision: 'a'.repeat(64),
  grants: ['query:catalog'], fields: [], allSubmarkets: false, submarkets: [],
  allBuildings: false, buildingIds: [],
};

function event(requestId: string, kind: string, content: unknown, sequence: number) {
  const eventId = randomUUID();
  return { request_id: requestId, event_id: eventId, sequence, kind,
    cipher: encryptAuditContent(JSON.stringify({ content, redactionTypes: [] }), { requestId, eventId,
      actorId: identity.actorId, effectiveUserId: identity.effectiveUserId },
    keys.keyId, keys.encryptionKey) };
}

describe('owner-bound Agent multi-turn context from existing encrypted audit RPC', () => {
  it('recovers only authenticated agent answer events visible through the production RPC contract', async () => {
    const requestId = randomUUID(), conversationId = randomUUID();
    const history = [{ user: 'CBD最近净有效租金多少？', assistant: '已查询CBD最新有效季度。' }];
    const events = [
      event(requestId, 'received', { sessionId: identity.sessionId,
        authority: { actorId: identity.actorId, effectiveUserId: identity.effectiveUserId },
        metadata: { protocol: AGENT_CONVERSATION_PROTOCOL, conversation: { id: conversationId } } }, 1),
      event(requestId, 'running', { phase: 'agent_planning' }, 2),
      event(requestId, 'tool_finished', { protocol: 'agent-answer/1',
        permissionRevision: authority.permissionRevision, history }, 3),
    ];
    const rpc = vi.fn().mockReturnValue({
      abortSignal: vi.fn().mockResolvedValue({ data: { allowed: true,
        permission_revision: authority.permissionRevision, state: 'succeeded', events }, error: null }),
    });
    const client = { rpc } as unknown as SupabaseClient;
    const recovered = await readAgentHistory(client, identity, keys, authority,
      { id: conversationId, parentRequestId: requestId }, new AbortController().signal);
    expect(recovered).toEqual(history);
    expect(rpc).toHaveBeenCalledWith('ai_query_context_read', expect.objectContaining({
      p_actor: identity.actorId, p_effective: identity.effectiveUserId, p_session: identity.sessionId,
      p_request_id: requestId,
    }));
  });

  it('rejects a revoked permission revision, never trusting browser-supplied history', async () => {
    const rpc = vi.fn().mockReturnValue({ abortSignal: vi.fn().mockResolvedValue({
      data: { allowed: true, permission_revision: 'b'.repeat(64) }, error: null,
    }) });
    await expect(readAgentHistory({ rpc } as unknown as SupabaseClient, identity, keys, authority,
      { id: randomUUID(), parentRequestId: randomUUID() }, new AbortController().signal))
      .rejects.toThrow('AGENT_CONTEXT_UNAVAILABLE');
  });

  it('rejects unsafe history restore tokens rather than leaking an old session', async () => {
    const rpc = vi.fn();
    await expect(readAgentHistory({ rpc } as unknown as SupabaseClient, identity, keys, authority,
      { id: randomUUID(), parentRequestId: randomUUID(), resumeToken: 'unverified' },
      new AbortController().signal)).rejects.toThrow('AGENT_RESUME_NOT_SUPPORTED');
    expect(rpc).not.toHaveBeenCalled();
  });
});

