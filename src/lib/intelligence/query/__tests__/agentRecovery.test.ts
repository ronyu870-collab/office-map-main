import { describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { auditPayloadDigest, encryptAuditContent } from '../auditCrypto';
import type { AuditKeys } from '../auditStore';
import { FIELD_REGISTRY_VERSION } from '../registry';
import { recoverOwnResult } from '../recovery';

const ids = { actor: randomUUID(), effective: randomUUID(), session: randomUUID() };
const grant = { actorId: ids.actor, effectiveUserId: ids.effective, sessionId: ids.session, sessionActive: true,
  policyVersion: 'test', permissionRevision: 'a'.repeat(64),
  grants: ['query:catalog'], fields: [], allSubmarkets: false, submarkets: ['CBD'],
  allBuildings: false, buildingIds: [] };
vi.mock('../serverAuthority', () => ({
  loadDataAuthority: vi.fn(async () => grant),
}));
const keys: AuditKeys = { keyId: 'test', encryptionKey: new Uint8Array(32).fill(3),
  digestKey: new Uint8Array(32).fill(4) };
const plan = (segment: string) => ({ operation: 'list', fields: [], period: null,
  scope: { inventory: 'all_authorized', submarkets: [segment] } });

function auditEvent(requestId: string, sequence: number, kind: string, payload: unknown) {
  const eventId = randomUUID();
  const content = JSON.stringify({ content: payload, redactionTypes: [] });
  return { request_id: requestId, event_id: eventId, sequence, kind,
    payload_digest: auditPayloadDigest(content, keys.digestKey),
    cipher: encryptAuditContent(content, { requestId, eventId, actorId: ids.actor,
      effectiveUserId: ids.effective }, keys.keyId, keys.encryptionKey) };
}

async function recover(finalSegment: string, exportPlans?: unknown[]) {
  const requestId = randomUUID(), resultId = randomUUID();
  const events = [
    auditEvent(requestId, 1, 'received', { sessionId: ids.session,
      plan: { resolution: 'server_agent/1' } }),
    auditEvent(requestId, 2, 'running', { phase: 'agent_planning' }),
    auditEvent(requestId, 3, 'tool_finished', {
      protocol: 'agent-answer/1', plan: plan('UNAUTHORIZED_SEGMENT'),
      resolution: { protocol: 'research-conversation/1' } }),
    auditEvent(requestId, 4, 'tool_finished', {
      protocol: 'agent-answer/1', plan: plan(finalSegment),
      resolution: { protocol: 'research-conversation/1' } }),
    auditEvent(requestId, 5, 'response_generated', { result: {
      resultId, dataVersion: 'b'.repeat(64), registryVersion: FIELD_REGISTRY_VERSION,
      sources: [], parameters: exportPlans ? { exportPlans } : {}, operation: 'list', table: { id: 'x', columns: [], rows: [] },
    } }),
    auditEvent(requestId, 6, 'succeeded', { delivery: 'not_yet_sent' }),
  ];
  const read = { state: 'succeeded', permission_revision: grant.permissionRevision, head_sequence: events.length,
    head_hash: 'f'.repeat(64), events };
  const rpc = vi.fn().mockReturnValue({ abortSignal: vi.fn().mockResolvedValue({ data: {
    allowed: true, permission_revision: grant.permissionRevision,
  }, error: null }) });
  const client = { rpc } as unknown as SupabaseClient;
  return recoverOwnResult(client, { actorId: ids.actor, effectiveUserId: ids.effective,
    sessionId: ids.session, expiresAt: Date.now() + 30000 },
  keys, requestId, read as never, new AbortController().signal);
}

describe('immutable source-rechecked Agent result recovery', () => {
  it('recovers the last model tool plan, not the earlier disallowed tool result', async () => {
    const recovered = await recover('CBD');
    expect(recovered.resultId).toMatch(/^[a-f0-9-]{36}$/);
    await expect(recovered.recheck()).resolves.toBeUndefined();
  });
  it('rechecks every original plan in merged exports rather than only the final scope', async () => {
    await expect(recover('CBD', [plan('CBD'), plan('UNAUTHORIZED_SEGMENT')])).rejects.toThrow('QUERY_DENIED');
    await expect(recover('CBD', [plan('CBD')])).resolves.toBeDefined();
  });
  it('rejects recovery when the model final result scope is no longer authorized', async () => {
    await expect(recover('UNAUTHORIZED_SEGMENT')).rejects.toThrow('QUERY_DENIED');
  });
});

