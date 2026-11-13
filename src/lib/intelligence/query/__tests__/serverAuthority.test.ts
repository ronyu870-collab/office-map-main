import { describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { loadDataAuthority, verifyQueryIdentity } from '../serverAuthority';

const identity = {
  actorId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  effectiveUserId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  sessionId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  expiresAt: Date.now() + 3600000,
};
const allowed = {
  allowed: true, access_policy: 'admin-only/1', actor_id: identity.actorId,
  effective_user_id: identity.effectiveUserId, session_id: identity.sessionId,
  policy_version: 'test', permission_revision: 'a'.repeat(64),
  capabilities: ['query:catalog'], fields: ['height'], all_submarkets: true,
  submarkets: [], all_buildings: true, building_ids: [],
};
const clientWith = (data: unknown) => ({ rpc: vi.fn(() => ({ abortSignal: async () => ({ data, error: null }) })) }) as unknown as SupabaseClient;

describe('admin-only authority protocol', () => {
  it('accepts the current policy while preserving the independent capability subset', async () => {
    const result = await loadDataAuthority(clientWith(allowed), identity, new AbortController().signal);
    expect(result.grants).toEqual(['query:catalog']);
    expect(result.fields).toEqual(['height']);
  });
  it.each([undefined, 'older-policy'])('refuses an allowed response from an unmigrated or incompatible database (%s)', async access_policy => {
    await expect(loadDataAuthority(clientWith({ ...allowed, access_policy }), identity, new AbortController().signal))
      .rejects.toThrow('QUERY_AUTHORITY_UNAVAILABLE');
  });
  it('refuses even self-targeted simulation before consulting Auth', async () => {
    const client = clientWith(allowed);
    await expect(verifyQueryIdentity(new Request('http://localhost/api/intelligence/query', {
      headers: { 'x-colliers-impersonate-user': identity.actorId },
    }), client)).rejects.toThrow('QUERY_UNAUTHENTICATED');
    expect(client.rpc).not.toHaveBeenCalled();
  });
});
