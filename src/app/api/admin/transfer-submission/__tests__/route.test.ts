import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { POST } from '../route';

const OWNER = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';
const RECORD = '55555555-5555-4555-8555-000000000001';
const REQUEST = '77777777-7777-4777-8777-777777777777';
const stamp = '2026-10-27T01:02:03.123456+00:00';
const mocks = vi.hoisted(() => ({ getUser: vi.fn(), rpc: vi.fn(), from: vi.fn(), role: 'editor', targetRole: 'editor' }));
vi.mock('@supabase/supabase-js', () => ({ createClient: () => ({ auth: { getUser: mocks.getUser }, from: mocks.from, rpc: mocks.rpc }) }));
const body = () => ({ requestId: REQUEST, submissionId: RECORD, targetUserId: OTHER, expectedSubmitterId: OWNER, expectedUpdatedAt: stamp });
const receipt = () => ({ requestId: REQUEST, submissionId: RECORD, targetUserId: OTHER, targetUserName: 'Verified recipient', updatedAt: stamp, transferredAt: stamp, replayed: false });
const request = (payload: unknown = body(), headers: Record<string, string> = { authorization: 'Bearer synthetic' }) => new NextRequest('https://synthetic.invalid/api/admin/transfer-submission', { method: 'POST', headers: { ...headers, 'content-type': 'application/json' }, body: JSON.stringify(payload) });
function query(result: () => unknown) {
  const q: any = { then: (resolve: (v: unknown) => void) => Promise.resolve(result()).then(resolve) };
  for (const method of ['select', 'eq', 'single', 'maybeSingle', 'update', 'insert']) q[method] = vi.fn(() => q);
  return q;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://synthetic.invalid');
  vi.stubEnv('SUPABASE_SECRET_KEY', 'synthetic-only');
  mocks.role = 'editor'; mocks.targetRole = 'editor';
  mocks.getUser.mockResolvedValue({ data: { user: { id: OWNER } }, error: null });
  mocks.from.mockImplementation((table: string) => query(() => ({ data: table === 'user_roles' ? { user_id: OTHER, role: mocks.role } : { id: RECORD, submitter_id: OWNER, submitter_name: 'Previous owner' }, error: null })));
  mocks.rpc.mockResolvedValue({ data: receipt(), error: null });
});
afterEach(() => vi.unstubAllEnvs());

describe('lease transfer trusted HTTP boundary', () => {
  it('regression F09 rejects nonexistent recipients even when an old caller supplies a name', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { code: '22023', message: 'TRANSFER_TARGET_INVALID' } });
    const response = await POST(request({ ...body(), targetUserName: 'Unverified recipient' }));
    expect(response.status).toBe(400);
  });
  it('regression F10 refuses a stale ownership/version precondition instead of overwriting it', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { code: '40001', message: 'STALE_RECORD' } });
    const response = await POST(request({ ...body(), targetUserName: 'Unverified recipient' }));
    expect(response.status).toBe(409);
  });
  it('uses verified actor and forwards exact preconditions, ignoring forged names/actor', async () => {
    const response = await POST(request({ ...body(), actorId: OTHER, targetUserName: 'Forged' }));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ success: true, ...receipt() });
    expect(mocks.getUser).toHaveBeenCalledWith('synthetic');
    expect(mocks.rpc).toHaveBeenCalledWith('transfer_lease_submission_v1', {
      p_request_id: REQUEST, p_actor_id: OWNER, p_submission_id: RECORD, p_target_user_id: OTHER,
      p_expected_submitter_id: OWNER, p_expected_updated_at: stamp,
    });
    expect(mocks.from.mock.calls.every(([table]) => table === 'user_roles')).toBe(true);
  });
  it.each([null, 'legacy:owner'])('accepts explicit legacy/null owner %s and null timestamp', async (expectedSubmitterId) => {
    expect((await POST(request({ ...body(), expectedSubmitterId, expectedUpdatedAt: null }))).status).toBe(200);
    expect(mocks.rpc.mock.calls[0][1]).toMatchObject({ p_expected_submitter_id: expectedSubmitterId, p_expected_updated_at: null });
  });
  it('requires refresh from old pages before touching any business write', async () => {
    const response = await POST(request({ submissionId: RECORD, targetUserId: OTHER, targetUserName: 'Forged' }));
    expect(response.status).toBe(409);
    expect((await response.json()).code).toBe('REFRESH_REQUIRED');
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it.each(['requestId', 'expectedSubmitterId', 'expectedUpdatedAt'])('rejects missing %s rather than guessing a version', async (key) => {
    const payload: any = body(); delete payload[key];
    expect((await POST(request(payload))).status).toBe(409);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it.each([
    { requestId: 'not-a-uuid' }, { submissionId: '' }, { targetUserId: 1 },
    { expectedSubmitterId: {} }, { expectedUpdatedAt: 'yesterday' }, { expectedUpdatedAt: '2026-10-27T01:02:03' },
  ])('rejects malformed input %j', async (patch) => {
    expect((await POST(request({ ...body(), ...patch }))).status).toBe(400);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it('rejects invalid JSON as client input error', async () => {
    const req = new NextRequest('https://synthetic.invalid/api/admin/transfer-submission', { method: 'POST', headers: { authorization: 'Bearer synthetic' }, body: '{' });
    expect((await POST(req)).status).toBe(400);
  });
  it('denies missing or invalid credentials before RPC', async () => {
    expect((await POST(request(body(), {}))).status).toBe(401);
    mocks.getUser.mockResolvedValue({ data: { user: null }, error: { message: 'invalid' } });
    expect((await POST(request())).status).toBe(401);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it.each(['viewer', 'unknown'])('denies %s even with a valid auth identity', async (role) => {
    mocks.role = role;
    expect((await POST(request())).status).toBe(403);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it('denies impersonated mutations', async () => {
    mocks.role = 'admin';
    expect((await POST(request(body(), { authorization: 'Bearer synthetic', 'x-colliers-impersonate-user': OTHER }))).status).toBe(403);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it.each([
    ['TRANSFER_TARGET_INVALID', '22023', 400], ['TRANSFER_OWNER_FORBIDDEN', '42501', 403],
    ['TRANSFER_ACTOR_FORBIDDEN', '42501', 403], ['STALE_RECORD', '40001', 409],
    ['REQUEST_PAYLOAD_MISMATCH', '22023', 409], ['TRANSFER_RECORD_NOT_FOUND', 'P0002', 404],
  ])('returns definite %s without a fallback UPDATE', async (message, code, status) => {
    mocks.rpc.mockResolvedValue({ data: null, error: { code, message } });
    expect((await POST(request())).status).toBe(status);
    expect(mocks.from.mock.calls.every(([table]) => table === 'user_roles')).toBe(true);
  });
  it.each(['PGRST202', '42883', 'XX000'])('fails safely when RPC is unavailable or fails (%s)', async (code) => {
    mocks.rpc.mockResolvedValue({ data: null, error: { code, message: 'internal details must not reach the user' } });
    const response = await POST(request());
    expect(response.status).toBe(503);
    const result = await response.json();
    expect(result.code).toBe('TRANSFER_UNCONFIRMED');
    expect(result.error).not.toContain('internal');
    expect(mocks.from.mock.calls.every(([table]) => table === 'user_roles')).toBe(true);
  });
  it.each([null, {}, { ...receipt(), requestId: OTHER }, { ...receipt(), targetUserId: OWNER }])('never reports success without a matching receipt %j', async (data) => {
    mocks.rpc.mockResolvedValue({ data, error: null });
    expect((await POST(request())).status).toBe(503);
  });
  it('returns replay evidence without doing another HTTP business write', async () => {
    mocks.rpc.mockResolvedValue({ data: { ...receipt(), replayed: true }, error: null });
    const response = await POST(request());
    expect(response.status).toBe(200);
    expect((await response.json()).replayed).toBe(true);
    expect(mocks.rpc).toHaveBeenCalledTimes(1);
  });
});
