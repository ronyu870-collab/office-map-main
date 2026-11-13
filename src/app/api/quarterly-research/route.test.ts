import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { GET, HEAD } from './route';

const mock = vi.hoisted(() => ({ getUser: vi.fn(), role: vi.fn(), read: vi.fn() }));
vi.mock('node:fs/promises', () => ({ readFile: mock.read, default: { readFile: mock.read } }));
vi.mock('@supabase/supabase-js', () => ({ createClient: () => ({
  auth: { getUser: mock.getUser },
  from: (table: string) => ({ select: () => ({ eq: (_: string, id: string) => ({ maybeSingle: () => mock.role(table, id) }) }) }),
}) }));
const content = '<!doctype html><title>Synthetic private research</title><p>Fixture only</p>';
function request(token: string | null = 'admin', edition = '2026Q3', target?: string) {
  const headers = new Headers();
  if (token) headers.set('Authorization', `Bearer ${token}`);
  if (target) headers.set('x-colliers-impersonate-user', target);
  return new NextRequest(`https://synthetic.invalid/api/quarterly-research?edition=${encodeURIComponent(edition)}`, { headers });
}
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://synthetic.invalid');
  vi.stubEnv('SUPABASE_SECRET_KEY', 'synthetic-service-key');
  mock.getUser.mockImplementation(async (token: string) => token === 'invalid'
    ? { data: { user: null }, error: { message: 'expired' } }
    : { data: { user: { id: token, app_metadata: { must_change_password: token === 'reset' } } }, error: null });
  mock.role.mockImplementation(async (_: string, id: string) => ({ data: { user_id: id, role: ['admin', 'reset'].includes(id) ? 'admin' : id }, error: null }));
  mock.read.mockResolvedValue(content);
});
afterEach(() => vi.unstubAllEnvs());

describe('private research endpoint: real identity resolver + server-only file read', () => {
  it.each([GET, HEAD])('rejects missing or expired authentication before reading content', async handler => {
    for (const token of [null, 'invalid']) {
      const res = await handler(request(token));
      expect(res.status).toBe(401);
      expect(res.headers.get('cache-control')).toContain('no-store');
      expect(await res.text()).not.toContain(content);
    }
    expect(mock.read).not.toHaveBeenCalled();
  });
  it.each(['viewer', 'editor', 'broker', 'unknown', 'reset'])('denies %s even on a direct report URL', async role => {
    expect((await GET(request(role))).status).toBe(403);
    expect((await HEAD(request(role))).status).toBe(403);
    expect(mock.read).not.toHaveBeenCalled();
  });
  it.each(['viewer', 'admin'])('denies admin impersonating %s', async target => {
    expect((await GET(request('admin', '2026Q3', target))).status).toBe(403);
    expect(mock.read).not.toHaveBeenCalled();
  });
  it('denies forged impersonation and fails closed on role lookup errors', async () => {
    expect((await GET(request('editor', '2026Q3', 'admin'))).status).toBe(403);
    mock.role.mockResolvedValue({ data: null, error: new Error('offline') });
    expect((await GET(request())).status).toBe(500);
    expect(mock.read).not.toHaveBeenCalled();
  });
  it.each(['2026Q3', '2026Q2'])('reads %s only after verified admin access', async edition => {
    const res = await GET(request('admin', edition));
    expect(res.status).toBe(200);
    expect(await res.text()).toBe(content);
    expect(mock.read).toHaveBeenCalledWith(expect.stringContaining(`/private/quarterly-research/${edition}.html`), 'utf8');
    expect(mock.getUser).toHaveBeenCalledWith('admin');
    expect(mock.role).toHaveBeenCalledWith('user_roles', 'admin');
    expect(res.headers.get('content-type')).toBe('text/plain; charset=utf-8');
    expect(res.headers.get('cache-control')).toContain('no-store');
    expect(res.headers.get('vary')).toContain('Authorization');
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
  });
  it('rechecks role on HEAD and never reads or returns report data', async () => {
    const res = await HEAD(request());
    expect(res.status).toBe(204); expect(await res.text()).toBe('');
    mock.role.mockResolvedValue({ data: { role: 'viewer' }, error: null });
    expect((await HEAD(request())).status).toBe(403);
    expect(mock.read).not.toHaveBeenCalled();
  });
  it.each(['../../secret', '2026Q4'])('rejects unsupported edition paths: %s', async edition => {
    expect((await GET(request('admin', edition))).status).toBe(404);
    expect(mock.read).not.toHaveBeenCalled();
  });
  it('returns a generic failure without leaking file paths or report data', async () => {
    mock.read.mockRejectedValue(new Error('/private/internal-file.html is unavailable'));
    const res = await GET(request());
    expect(res.status).toBe(503);
    expect(await res.text()).not.toMatch(/internal-file|Fixture only/);
    expect(res.headers.get('cache-control')).toContain('no-store');
  });
});
