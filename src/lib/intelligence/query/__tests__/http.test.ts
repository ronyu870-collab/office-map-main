import { describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { buildListResult } from '../result';
import { fixture } from './fixtures';

const state = vi.hoisted(() => ({ prepared: false, mode: 'changed' }));
vi.mock('../serverAuthority', () => ({
  verifyQueryIdentity: async () => ({ actorId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', effectiveUserId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', sessionId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', expiresAt: Date.now()+10000 }),
  loadDataAuthority: async () => {
    if (state.prepared && state.mode === 'unavailable') throw new Error('QUERY_AUTHORITY_UNAVAILABLE');
    return { actorId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', effectiveUserId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', sessionActive: true, policyVersion: 'test', permissionRevision: state.prepared ? 'scope-changed' : 'original', grants: ['query:catalog'], fields: [], allSubmarkets: true, submarkets: [], allBuildings: true, buildingIds: [] };
  },
}));
vi.mock('../snapshotReader', () => ({ readQuerySnapshots: async () => [] }));
vi.mock('../executePlan', () => ({ executeQueryPlan: vi.fn() }));
import { handleQuerySubmission } from '../http';
import { executeQueryPlan } from '../executePlan';

describe('final HTTP delivery boundary', () => {
  it.each([{ mode: 'changed', status: 403 }, { mode: 'unavailable', status: 503 }])('suppresses prepared output with honest status when authority is $mode', async ({ mode, status }) => {
    state.prepared = false; state.mode = mode;
    vi.mocked(executeQueryPlan).mockReturnValue(buildListResult({ ...fixture(), period: null }, []));
    const rpc = vi.fn((_name: string, args: Record<string, unknown>) => {
      if (args.p_kind === 'delivery_receipt') state.prepared = true;
      return { abortSignal: () => Promise.resolve({ data: { event_id: crypto.randomUUID(), sequence: 1, event_hash: 'a'.repeat(64), replayed: false }, error: null }) };
    });
    const request = new Request('http://localhost/api/intelligence/query', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer synthetic' },
      body: JSON.stringify({ idempotencyKey: crypto.randomUUID(), question: 'CBD有哪些楼', plan: { operation: 'list', fields: [], period: null, scope: { inventory: 'tracked' } } }) });
    const response = await handleQuerySubmission(request, { client: { rpc } as unknown as SupabaseClient, enabled: true,
      keys: { keyId: 'test', encryptionKey: new Uint8Array(32).fill(1), digestKey: new Uint8Array(32).fill(2) } });
    expect(response.status).toBe(status);
    expect(await response.json()).not.toHaveProperty('result');
    expect(rpc).toHaveBeenCalledWith('ai_query_audit_append', expect.objectContaining({ p_kind: 'correction' }));
  });
  it.each([
    { error: 'QUERY_SCOPE_REQUIRES_BACKGROUND_JOB', status: 413, reason: 'scope_limit' },
    { error: 'QUERY_SCOPE_REQUIRES_BACKGROUND_JOB:private-detail', status: 503, reason: undefined },
  ])('provides only a whitelisted scope explanation for $error', async ({ error, status, reason }) => {
    state.prepared = false; state.mode = 'normal';
    vi.mocked(executeQueryPlan).mockImplementation(() => { throw new Error(error); });
    const rpc = vi.fn(() => ({ abortSignal: () => Promise.resolve({ data: { event_id: crypto.randomUUID(), sequence: 1, event_hash: 'a'.repeat(64), replayed: false }, error: null }) }));
    const request = new Request('http://localhost/api/intelligence/query', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer synthetic' },
      body: JSON.stringify({ idempotencyKey: crypto.randomUUID(), question: '大范围查询', plan: { operation: 'list', fields: [], period: null, scope: { inventory: 'tracked' } } }) });
    const response = await handleQuerySubmission(request, { client: { rpc } as unknown as SupabaseClient, enabled: true,
      keys: { keyId: 'test', encryptionKey: new Uint8Array(32).fill(1), digestKey: new Uint8Array(32).fill(2) } });
    const body = await response.json();
    expect(response.status).toBe(status); expect(body.status).toBe('failed'); expect(body.reason).toBe(reason);
    expect(body).not.toHaveProperty('result'); expect(JSON.stringify(body)).not.toContain('private-detail');
    if (reason) { expect(body.error).toMatch(/缩小.*子市场.*季度.*指标/); expect(body.error).not.toMatch(/后台|稍后重试/); }
  });
});
