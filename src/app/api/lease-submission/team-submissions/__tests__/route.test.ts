import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';
import { GET } from '../route';
import { leaseFilterOptions } from '@/src/app/lease-submission/leaseTableQuery';

const mocks = vi.hoisted(() => ({ identity: vi.fn(), read: vi.fn(), listUsers: vi.fn() }));
vi.mock('@/src/lib/server/impersonationAuth', () => ({ resolveEffectiveRequestIdentity: mocks.identity }));
vi.mock('../readTeamTransactions', () => ({ readTeamTransactions: mocks.read }));
vi.mock('@supabase/supabase-js', () => ({ createClient: () => ({ auth: { admin: { listUsers: mocks.listUsers } } }) }));

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://synthetic.invalid');
  vi.stubEnv('SUPABASE_SECRET_KEY', 'synthetic-key');
  mocks.identity.mockResolvedValue({ identity: { effectiveRole: 'viewer' } });
  mocks.listUsers.mockResolvedValue({ data: { users: [{ id: 'active', banned_until: null }, { id: 'left', banned_until: '2099-01-01T00:00:00Z' }] }, error: null });
  mocks.read.mockResolvedValue([{ id: '1', submitter_id: 'active', submitter_name: '在职顾问' }, { id: '2', submitter_id: 'left', submitter_name: '离职顾问', original_submitter_name: '原提交人' }]);
});
afterEach(() => vi.unstubAllEnvs());
const request = (query = '') => new NextRequest('https://synthetic.invalid/api/lease-submission/team-submissions' + query);

describe('团队成交完整读取授权边界', () => {
  it.each(['admin', 'editor', 'viewer'])('preserves %s team access and departed attribution', async (role) => {
    mocks.identity.mockResolvedValue({ identity: { effectiveRole: role } });
    const response = await GET(request());
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.submissions).toHaveLength(2);
    expect(body.submissions[0].submitter_active).toBe(true);
    expect(body.submissions[1]).toMatchObject({ submitter_name: '离职顾问', original_submitter_name: '原提交人', submitter_active: false });
    expect(mocks.read).toHaveBeenCalledTimes(1);
  });
  it('denies unauthorized effective roles before querying team data or account identities', async () => {
    mocks.identity.mockResolvedValue({ identity: { actualRole: 'admin', effectiveRole: 'unknown' } });
    expect((await GET(request())).status).toBe(403);
    expect(mocks.read).not.toHaveBeenCalled();
    expect(mocks.listUsers).not.toHaveBeenCalled();
  });
  it('returns identity failure before querying records', async () => {
    mocks.identity.mockResolvedValue({ response: NextResponse.json({ error: 'unauthenticated' }, { status: 401 }) });
    expect((await GET(request())).status).toBe(401);
    expect(mocks.read).not.toHaveBeenCalled();
  });
  it('keeps access-only probes free of team and account reads', async () => {
    expect(await (await GET(request('?access=1'))).json()).toEqual({ canViewTeamSubmissions: true });
    expect(mocks.read).not.toHaveBeenCalled();
    expect(mocks.listUsers).not.toHaveBeenCalled();
  });
  it('returns an error for failed pagination without exposing a partial list', async () => {
    mocks.read.mockRejectedValue(new Error('synthetic page 2 failure'));
    const response = await GET(request());
    expect(response.status).toBe(500);
    expect((await response.json()).submissions).toBeUndefined();
  });
  it.each(['error', 'throw'])('preserves all submitter options when account status lookup fails via %s', async (failure) => {
    if (failure === 'error') mocks.listUsers.mockResolvedValue({ data: null, error: { message: 'synthetic account status failure' } });
    else mocks.listUsers.mockRejectedValue(new Error('synthetic account status failure'));
    const response = await GET(request());
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.submitterIdentityStatus).toBe('unverified');
    expect(body.submissions.map((record: { submitter_active: boolean }) => record.submitter_active)).toEqual([false, false]);
    expect(leaseFilterOptions(body.submissions, 'submitter').map((option) => option.value).sort()).toEqual(['active', 'left']);
  });
});
