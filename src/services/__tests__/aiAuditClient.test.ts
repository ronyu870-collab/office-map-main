import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { aiAuditClient } from '../aiAuditClient';

const fixture = vi.hoisted(() => ({ getSession: vi.fn(), target: null as string | null }));
vi.mock('@/src/services/Auth', () => ({ getSessionFast: fixture.getSession }));
vi.mock('@/src/services/impersonationHeaders', () => ({ getImpersonationTargetUserId: () => fixture.target }));
const actorId = '11111111-1111-4111-8111-111111111111', sessionId = '22222222-2222-4222-8222-222222222222';
const scope = { actorId, sessionId }, session = { session: { user: { id: actorId }, access_token: 'synthetic-only' }, user: { id: actorId }, sessionId };
const filter = { action: 'list' as const, from: '2026-11-12T00:00:00Z', to: '2026-11-13T00:00:00Z' };
const response = () => Response.json({ status: 'ready', accessId: actorId, items: [], scanned: 0, unreadable: 0, nextCursor: null,
  directoryAsOf: '2026-11-13T00:00:00Z', identitySemantics: 'current_directory_not_historical', searchComplete: true, totalUnreadable: 0, totalMatches: null, semantics: 'attempts_and_legacy_streams' });
beforeEach(() => { fixture.target = null; fixture.getSession.mockReset().mockResolvedValue(session); vi.stubGlobal('fetch', vi.fn().mockImplementation(async () => response())); });
afterEach(() => { vi.unstubAllGlobals(); });
test('uses the existing session, no-store HTTP and validates a real-shaped response', async () => {
  expect((await aiAuditClient.list(scope, filter, new AbortController().signal)).items).toEqual([]);
  expect(fetch).toHaveBeenCalledWith('/api/intelligence/audit', expect.objectContaining({ cache: 'no-store', method: 'POST', body: JSON.stringify(filter) }));
  expect(fixture.getSession).toHaveBeenCalledTimes(2);
});
test('rejects simulation before fetching and a changed identity after the response arrives', async () => {
  fixture.target = actorId;
  await expect(aiAuditClient.list(scope, filter, new AbortController().signal)).rejects.toMatchObject({ reason: 'identity' });
  expect(fetch).not.toHaveBeenCalled(); fixture.target = null;
  fixture.getSession.mockResolvedValueOnce(session).mockResolvedValueOnce({ ...session, sessionId: actorId });
  await expect(aiAuditClient.list(scope, filter, new AbortController().signal)).rejects.toMatchObject({ reason: 'identity' });
});
test('rejects denied, malformed and cross-record detail responses', async () => {
  vi.mocked(fetch).mockResolvedValueOnce(Response.json({ status: 'denied' }, { status: 403 }));
  await expect(aiAuditClient.list(scope, filter, new AbortController().signal)).rejects.toMatchObject({ reason: 'denied' });
  vi.mocked(fetch).mockResolvedValueOnce(Response.json({ status: 'ready', items: [{ excerpt: 'unbound' }] }));
  await expect(aiAuditClient.list(scope, filter, new AbortController().signal)).rejects.toThrow();
  vi.mocked(fetch).mockResolvedValueOnce(Response.json({ status: 'ready', accessId: actorId, record: { id: sessionId, requestId: actorId, actorId, effectiveUserId: actorId,
    at: filter.to, entry: 'query_submission', contentState: 'available', document: {}, meaning: 'submitted_attempt_not_proof_of_execution' } }));
  await expect(aiAuditClient.intake(scope, actorId, new AbortController().signal)).rejects.toMatchObject({ reason: 'unavailable' });
});
test('suppresses a late response after cancellation', async () => {
  const control = new AbortController();
  vi.mocked(fetch).mockImplementationOnce(async () => { control.abort(); return response(); });
  await expect(aiAuditClient.list(scope, filter, control.signal)).rejects.toThrow();
});
