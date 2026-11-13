import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ actor: 'one', effective: 'one', session: 'session', target: null as string | null }));
vi.mock('@/src/services/Auth', () => ({ getSessionFast: async () => ({ user: { id: state.effective }, sessionId: state.session, session: { user: { id: state.actor }, access_token: 'synthetic-token' } }) }));
vi.mock('@/src/services/impersonationHeaders', () => ({ getImpersonationTargetUserId: () => state.target, withImpersonationHeaders: (headers: HeadersInit) => new Headers(headers) }));
import { trustedQueryClient } from '../trustedQueryClient';
const scope = { actorId: 'one', effectiveId: 'one', sessionId: 'session', targetId: null };
describe('trusted query client current identity guard', () => {
  beforeEach(() => { state.actor = 'one'; state.effective = 'one'; state.session = 'session'; state.target = null; });
  afterEach(() => vi.unstubAllGlobals());
  it('does not submit if the effective identity changed before sending', async () => {
    const fetch = vi.fn(); vi.stubGlobal('fetch', fetch); state.target = 'other';
    await expect(trustedQueryClient.capabilities(scope, new AbortController().signal)).rejects.toThrow('身份已变化'); expect(fetch).not.toHaveBeenCalled();
  });
  it('suppresses a response if account changes during the actual fetch', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { state.actor = 'two'; return Response.json({ enabled: true, examples: [] }); }));
    await expect(trustedQueryClient.capabilities(scope, new AbortController().signal)).rejects.toThrow('身份已变化');
  });
  it('keeps one submitted question/nonce and no-store on the authenticated route', async () => {
    const fetch = vi.fn(async () => Response.json({ status: 'already_received', requestId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' }, { status: 202 })); vi.stubGlobal('fetch', fetch);
    const input = { idempotencyKey: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', question: 'CBD有哪些楼' };
    expect((await trustedQueryClient.submit(scope, input, new AbortController().signal)).status).toBe('already_received');
    expect(fetch).toHaveBeenCalledWith('/api/intelligence/query', expect.objectContaining({ cache: 'no-store', body: JSON.stringify(input), method: 'POST' }));
  });
  it('distinguishes eligibility service failure from an explicitly closed capability', async () => {
    const fetch = vi.fn().mockResolvedValueOnce(Response.json({ enabled: false, examples: [] }, { status: 503 }))
      .mockResolvedValueOnce(Response.json({ enabled: false, examples: [] }, { status: 403 }));
    vi.stubGlobal('fetch', fetch);
    await expect(trustedQueryClient.capabilities(scope, new AbortController().signal)).rejects.toThrow('暂时无法');
    expect(await trustedQueryClient.capabilities(scope, new AbortController().signal)).toEqual({ enabled: false, examples: [] });
  });
});
