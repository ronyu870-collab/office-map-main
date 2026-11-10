import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ getSession: vi.fn(), profile: vi.fn() }));
vi.mock('../supabaseClient', () => ({ supabase: {
  auth: { getSession: mocks.getSession },
  from: () => ({ select: () => ({ eq: () => ({ maybeSingle: mocks.profile }) }) }),
} }));
import { clearSessionCache, getSessionFast, prewarmSessionCache } from '../Auth';
import type { Session } from '@supabase/supabase-js';
import type { AuthSessionResult } from '../Auth';

function session(id = 'user-a') {
  return { user: { id, email: `${id}@example.invalid` }, access_token: `token-${id}` };
}
function response(id = 'user-a') { return { data: { session: session(id) }, error: null }; }
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}
beforeEach(() => {
  sessionStorage.clear(); clearSessionCache();
  mocks.getSession.mockReset().mockResolvedValue(response());
  mocks.profile.mockReset().mockResolvedValue({ data: { role: 'editor', full_name: 'Synthetic', session_id: 'device-a' }, error: null });
});
afterEach(() => { clearSessionCache(); sessionStorage.clear(); vi.unstubAllGlobals(); });

describe('browser session request coalescing', () => {
  it('shares one cold session/profile lookup and serves later reads from cache', async () => {
    const reads = await Promise.all([getSessionFast(), getSessionFast(), getSessionFast()]);
    expect(reads.map((read) => read?.user.id)).toEqual(['user-a', 'user-a', 'user-a']);
    await getSessionFast();
    expect(mocks.getSession).toHaveBeenCalledTimes(1);
    expect(mocks.profile).toHaveBeenCalledTimes(1);
  });

  it('shares the delayed profile during same-credential SDK recovery without sharing it across accounts', async () => {
    const first = deferred<{ data: { role: string }; error: null }>();
    mocks.profile.mockReturnValueOnce(first.promise);
    const startup = getSessionFast();
    await vi.waitFor(() => expect(mocks.profile).toHaveBeenCalledTimes(1));

    clearSessionCache({ reuseInFlightProfileFor: session() as Session });
    const recovery = getSessionFast();
    await vi.waitFor(() => expect(mocks.getSession).toHaveBeenCalledTimes(2));
    expect(mocks.profile).toHaveBeenCalledTimes(1);

    const second = deferred<{ data: { role: string }; error: null }>();
    mocks.getSession.mockResolvedValue(response('user-b'));
    mocks.profile.mockReturnValueOnce(second.promise);
    clearSessionCache({ reuseInFlightProfileFor: session('user-b') as Session });
    const accountSwitch = getSessionFast();
    await vi.waitFor(() => expect(mocks.profile).toHaveBeenCalledTimes(2));

    second.resolve({ data: { role: 'viewer' }, error: null });
    first.resolve({ data: { role: 'admin' }, error: null });
    const results = await Promise.all([startup, recovery, accountSwitch]);
    expect(results.map(result => [result?.user.id, result?.role])).toEqual([
      ['user-b', 'viewer'], ['user-b', 'viewer'], ['user-b', 'viewer'],
    ]);
  });

  it('retries after a rejected shared lookup', async () => {
    mocks.getSession.mockRejectedValueOnce(new Error('offline'));
    const failed = await Promise.allSettled([getSessionFast(), getSessionFast()]);
    expect(failed.every((read) => read.status === 'rejected')).toBe(true);
    expect((await getSessionFast())?.user.id).toBe('user-a');
    expect(mocks.getSession).toHaveBeenCalledTimes(2);
  });

  it('does not resurrect a signed-out user when an earlier lookup completes late', async () => {
    const old = deferred<ReturnType<typeof response>>();
    mocks.getSession.mockReturnValueOnce(old.promise).mockResolvedValue({ data: { session: null }, error: null });
    const pending = getSessionFast();
    clearSessionCache();
    old.resolve(response());
    expect(await pending).toBeNull();
    expect(sessionStorage.getItem('__auth_session_cache')).toBeNull();
  });

  it('keeps a newly signed-in identity when an older profile response arrives late', async () => {
    const old = deferred<{ data: { role: string }; error: null }>();
    mocks.profile.mockReturnValueOnce(old.promise);
    const pending = getSessionFast();
    await vi.waitFor(() => expect(mocks.profile).toHaveBeenCalledTimes(1));
    const next = { user: session('user-b').user, session: session('user-b'), role: 'admin', displayName: 'Next', sessionId: 'device-b' } as AuthSessionResult;
    prewarmSessionCache(next);
    old.resolve({ data: { role: 'viewer' }, error: null });
    expect((await pending)?.user.id).toBe('user-b');
    expect((await getSessionFast())?.role).toBe('admin');
  });

  it('shares the real lookup while keeping effective impersonation identity and the real JWT', async () => {
    sessionStorage.setItem('__impersonation_state', JSON.stringify({ targetUserId: 'target', targetEmail: 'target@example.invalid', targetRole: 'viewer' }));
    const reads = await Promise.all([getSessionFast(), getSessionFast()]);
    expect(reads.every((read) => read?.user.id === 'target' && read.session.access_token === 'token-user-a')).toBe(true);
    expect(mocks.profile).toHaveBeenCalledTimes(1);
  });

  it('does not share pending state or cached identities during server execution', async () => {
    vi.stubGlobal('window', undefined);
    await Promise.all([getSessionFast(), getSessionFast()]);
    expect(mocks.getSession).toHaveBeenCalledTimes(2);
    expect(mocks.profile).toHaveBeenCalledTimes(2);
  });
});
