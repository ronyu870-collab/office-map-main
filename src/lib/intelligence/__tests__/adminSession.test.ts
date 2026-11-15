import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createAdminSessionGuard } from '../adminSession';

const identity = vi.hoisted(() => vi.fn());
vi.mock('../query/serverAuthority', () => ({ verifyQueryIdentity: identity }));
afterEach(() => { vi.useRealTimers(); vi.clearAllMocks(); });

function setup() {
  const result = { actorId: 'actor', effectiveUserId: 'actor', sessionId: 'session', expiresAt: Date.now() + 60_000 };
  identity.mockResolvedValue(result);
  const resolve = vi.fn().mockResolvedValue({ data: true, error: null });
  const rpc = vi.fn(() => ({ abortSignal: resolve }));
  return { result, resolve, rpc, client: { rpc } as unknown as SupabaseClient, request: new Request('https://synthetic.invalid') };
}

describe('legacy AI admin session checkpoint', () => {
  it('uses the Auth-verified identity and checks the current DB authority on every boundary', async () => {
    const x = setup(); const guard = await createAdminSessionGuard(x.request, x.client);
    expect(identity).toHaveBeenCalledWith(x.request, x.client);
    await guard(); expect(x.rpc).toHaveBeenCalledTimes(2);
    expect(x.rpc).toHaveBeenLastCalledWith('ai_admin_session_authority', { p_actor: 'actor', p_session: 'session' });
    x.resolve.mockResolvedValue({ data: false, error: null });
    await expect(guard()).rejects.toThrow('AI_ADMIN_DENIED');
  });
  it.each([null, 'true', 1, { allowed: true }])('fails closed on a non-boolean RPC answer (%j)', async data => {
    const x = setup(); x.resolve.mockResolvedValue({ data, error: null });
    await expect(createAdminSessionGuard(x.request, x.client)).rejects.toThrow('AI_ADMIN_DENIED');
  });
  it('does not confuse a failed authority service with a permission grant', async () => {
    const x = setup(); x.resolve.mockResolvedValue({ data: true, error: { code: 'denied' } });
    await expect(createAdminSessionGuard(x.request, x.client)).rejects.toThrow('AI_ADMIN_AUTHORITY_UNAVAILABLE');
  });
  it('rejects a token expiring while the DB check is pending and before a later checkpoint', async () => {
    vi.useFakeTimers(); const x = setup();
    x.resolve.mockImplementation(async () => { vi.setSystemTime(x.result.expiresAt); return { data: true, error: null }; });
    await expect(createAdminSessionGuard(x.request, x.client)).rejects.toThrow('AI_ADMIN_DENIED');
    x.rpc.mockClear(); await expect(createAdminSessionGuard(x.request, x.client)).rejects.toThrow('AI_ADMIN_DENIED');
    expect(x.rpc).not.toHaveBeenCalled();
  });
  it('rejects a mismatched actor before any privileged RPC', async () => {
    const x = setup(); x.result.effectiveUserId = 'other';
    await expect(createAdminSessionGuard(x.request, x.client)).rejects.toThrow('AI_ADMIN_DENIED');
    expect(x.rpc).not.toHaveBeenCalled();
  });
});
