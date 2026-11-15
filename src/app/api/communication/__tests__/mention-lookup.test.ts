import { NextRequest, NextResponse } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const fixture = vi.hoisted(() => ({
  identity: vi.fn(), from: vi.fn(), listUsers: vi.fn(), rows: [] as unknown[], pattern: vi.fn(),
}));
vi.mock('@/src/lib/server/impersonationAuth', () => ({
  resolveEffectiveRequestIdentity: fixture.identity,
  denyImpersonatedMutation: vi.fn(),
}));
vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({ from: fixture.from, auth: { admin: { listUsers: fixture.listUsers } } }),
}));

import { GET } from '../route';

const request = (name?: string) => new NextRequest(
  'https://synthetic.invalid/api/communication' + (name === undefined ? '' : '?name=' + encodeURIComponent(name)),
  { headers: { Authorization: 'Bearer synthetic-access-token' } },
);
const baseRows = [
  { user_id: '11111111-1111-4111-8111-111111111111', full_name: 'Alice Wang', role: 'editor', chinese_name: '王某', email: 'private1@example.test' },
  { user_id: '22222222-2222-4222-8222-222222222222', full_name: 'ALICE Chen', role: 'viewer', chinese_name: '陈某', email: 'private2@example.test' },
  { user_id: '33333333-3333-4333-8333-333333333333', full_name: 'Alicia Wu', role: 'admin', chinese_name: '吴某', email: 'private3@example.test' },
  { user_id: '44444444-4444-4444-8444-444444444444', full_name: 'Alice Banned', role: 'editor', chinese_name: '保密', email: 'private4@example.test' },
  { user_id: '55555555-5555-4555-8555-555555555555', full_name: 'Li Wei', role: 'editor', chinese_name: '李某', email: 'private5@example.test' },
];

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://synthetic.invalid');
  vi.stubEnv('SUPABASE_SECRET_KEY', 'synthetic');
  fixture.identity.mockResolvedValue({ identity: { effectiveRole: 'viewer', caller: { id: 'synthetic-user' } } });
  fixture.rows = baseRows;
  fixture.from.mockImplementation(() => {
    const query = {
      select: vi.fn(), in: vi.fn(), ilike: vi.fn(), order: vi.fn(),
      limit: vi.fn(async () => ({ data: fixture.rows, error: null })),
    };
    query.select.mockReturnValue(query);
    query.in.mockReturnValue(query);
    query.ilike.mockImplementation((column: string, value: string) => {
      fixture.pattern(column, value);
      return query;
    });
    query.order.mockReturnValue(query);
    return query;
  });
  fixture.listUsers.mockResolvedValue({ data: { users: baseRows.map(row => ({
    id: row.user_id, banned_until: row.full_name === 'Alice Banned' ? '2099-01-01T00:00:00Z' : null,
  })) }, error: null });
});

afterEach(() => vi.unstubAllEnvs());

describe('market mention lookup privacy', () => {
  it.each([undefined, '', '@', 'A', '所', '所有', 'ali%', 'alice wang', 'a'.repeat(41)])(
    'returns no directory for an incomplete/malformed name: %s', async name => {
      const response = await GET(request(name));
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ members: [] });
      expect(fixture.from).not.toHaveBeenCalled();
      expect(fixture.listUsers).not.toHaveBeenCalled();
    },
  );

  it('requires a complete English first-name match, case-insensitively', async () => {
    const partial = await GET(request('Ali'));
    expect(await partial.json()).toEqual({ members: [] });
    expect(fixture.pattern).toHaveBeenCalledWith('full_name', 'ali%');

    for (const name of ['Alice', 'alice', 'ALICE']) {
      const response = await GET(request(name));
      expect(response.status).toBe(200);
      expect(response.headers.get('cache-control')).toContain('no-store');
      const body = await response.json();
      expect(body).toEqual({ members: [
        { id: baseRows[0].user_id, name: 'Alice Wang' },
        { id: baseRows[1].user_id, name: 'ALICE Chen' },
      ] });
      expect(JSON.stringify(body)).not.toMatch(/@example\.test|王某|陈某|Alicia|Banned|role|chinese_name|email|canMentionEveryone/);
    }
  });

  it('never exposes a disabled account in an exact-name lookup, even when its role remains active', async () => {
    fixture.listUsers.mockResolvedValueOnce({ data: { users: [
      { id: baseRows[0].user_id, banned_until: '2099-01-01T00:00:00Z' },
      { id: baseRows[1].user_id, banned_until: null },
      { id: baseRows[3].user_id, banned_until: '2099-01-01T00:00:00Z' },
    ] }, error: null });
    const result = await GET(request('Alice'));
    expect(result.status).toBe(200);
    expect(await result.json()).toEqual({
      members: [{ id: baseRows[1].user_id, name: 'ALICE Chen' }],
    });
  });

  it('reflects disable and re-enable changes from Auth immediately on successive searches', async () => {
    fixture.listUsers.mockResolvedValueOnce({ data: { users: [
      { id: baseRows[0].user_id, banned_until: '2099-01-01T00:00:00Z' },
    ] }, error: null });
    expect(await (await GET(request('alice'))).json()).toEqual({ members: [] });

    fixture.listUsers.mockResolvedValueOnce({ data: { users: [
      { id: baseRows[0].user_id, banned_until: null },
    ] }, error: null });
    expect(await (await GET(request('alice'))).json()).toEqual({
      members: [{ id: baseRows[0].user_id, name: 'Alice Wang' }],
    });
  });

  it('omits soft-deleted identities, invalid ban metadata and missing Auth accounts', async () => {
    fixture.listUsers.mockResolvedValueOnce({ data: { users: [
      { id: baseRows[0].user_id, banned_until: null, deleted_at: '2026-11-01T00:00:00Z' },
      { id: baseRows[1].user_id, banned_until: 'invalid-date', deleted_at: null },
    ] }, error: null });
    expect(await (await GET(request('alice'))).json()).toEqual({ members: [] });
  });

  it('returns only a single scoped first-name result even for a two-letter name', async () => {
    const body = await (await GET(request('li'))).json();
    expect(body).toEqual({ members: [{ id: baseRows[4].user_id, name: 'Li Wei' }] });
  });

  it('supports only the exact admin-only broadcast token, without listing members', async () => {
    const denied = await GET(request('所有人'));
    expect(await denied.json()).toEqual({ members: [] });
    fixture.identity.mockResolvedValue({ identity: { effectiveRole: 'admin', caller: { id: 'synthetic-admin' } } });
    const allowed = await GET(request('所有人'));
    expect(await allowed.json()).toEqual({ members: [{ id: '__everyone__', name: '所有人' }] });
    expect(fixture.from).not.toHaveBeenCalled();
  });

  it('rejects unauthenticated and unknown-role callers before querying profiles', async () => {
    fixture.identity.mockResolvedValueOnce({ response: NextResponse.json({ error: '未认证' }, { status: 401 }) });
    expect((await GET(request('Alice'))).status).toBe(401);
    fixture.identity.mockResolvedValue({ identity: { effectiveRole: 'unknown' } });
    expect((await GET(request('Alice'))).status).toBe(403);
    expect(fixture.from).not.toHaveBeenCalled();
  });
});
