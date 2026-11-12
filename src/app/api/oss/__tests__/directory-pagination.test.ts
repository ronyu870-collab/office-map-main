import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const fixture = vi.hoisted(() => ({ list: vi.fn(), getUser: vi.fn(), sign: vi.fn(), audit: vi.fn() }));
vi.mock('ali-oss', () => ({ default: class { list = fixture.list; signatureUrl = fixture.sign; } }));
vi.mock('@supabase/supabase-js', () => ({ createClient: () => ({ auth: { getUser: fixture.getUser } }) }));
vi.mock('@/src/lib/serverAudit', () => ({ writeAuditBestEffort: fixture.audit }));
import { GET, POST } from '../route';

function request(marker?: string, authorized = true) {
  const params = new URLSearchParams({ action: 'get-list', prefix: '研究资料/' });
  if (marker) params.set('marker', marker);
  return new Request(`http://localhost/api/oss?${params}`, { headers: authorized ? { authorization: 'Bearer synthetic' } : {} });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://example.supabase.co');
  vi.stubEnv('SUPABASE_SECRET_KEY', 'synthetic-secret');
  vi.stubEnv('NEW_OSS_AK', 'synthetic-key');
  vi.stubEnv('NEW_OSS_SK', 'synthetic-secret');
  fixture.getUser.mockResolvedValue({ data: { user: { id: 'reader' } }, error: null });
  fixture.sign.mockReturnValue('https://fixture.invalid/signed?signature=synthetic-private');
  fixture.audit.mockResolvedValue(undefined);
  fixture.list.mockReset().mockResolvedValue({
    objects: [{ name: '研究资料/下一份.pdf', size: 1024, url: 'https://fixture.invalid/never-exposed' }],
    prefixes: ['研究资料/子目录/'],
    isTruncated: true,
    nextMarker: '研究资料/下一份.pdf',
  });
});
afterEach(() => vi.unstubAllEnvs());

it('continues a private directory from the requested marker without including signed or original URLs', async () => {
  const response = await GET(request('研究资料/上一份.pdf'));
  expect(response.status).toBe(200);
  expect(response.headers.get('cache-control')).toContain('private, no-store');
  const result = await response.json();
  expect(result).toMatchObject({ truncated: true, nextMarker: '研究资料/下一份.pdf' });
  expect(result.data.map((item: { name: string }) => item.name)).toEqual(['研究资料/子目录/', '研究资料/下一份.pdf']);
  expect(JSON.stringify(result)).not.toContain('never-exposed');
  expect(fixture.list).toHaveBeenCalledWith({ prefix: '研究资料/', marker: '研究资料/上一份.pdf', delimiter: '/', 'max-keys': 1000 }, {});
});

it('rejects a different prefix or absent credentials before listing OSS objects', async () => {
  expect((await GET(request('其他目录/对象.pdf'))).status).toBe(400);
  expect((await GET(request(undefined, false))).status).toBe(401);
  expect(fixture.list).not.toHaveBeenCalled();
});

it('distinguishes directory I/O from signing and audit without exposing objects in the timing header', async () => {
  vi.stubEnv('PERF_ISOLATED_SERVER_TIMING', 'preview');
  vi.stubEnv('VERCEL_ENV', 'preview');
  const directory = await GET(request());
  expect(directory.headers.get('server-timing')).toMatch(/colliers-auth;dur=[\d.]+, colliers-object-list;dur=[\d.]+/);
  const open = (authorized: boolean) => POST(new Request('https://fixture.invalid/api/oss?action=access', {
    method: 'POST', headers: authorized ? { authorization: 'Bearer synthetic' } : {},
    body: JSON.stringify({ file_name: '研究资料/下一份.pdf', access_method: 'download' }),
  }));
  const denied = await open(false);
  expect(denied.status).toBe(401);
  expect(denied.headers.get('server-timing')).toBeNull();
  expect(fixture.sign).not.toHaveBeenCalled();
  expect(fixture.audit).not.toHaveBeenCalled();
  const result = await open(true);
  expect(await result.json()).toEqual({ status: 'success', url: 'https://fixture.invalid/signed?signature=synthetic-private' });
  expect(result.headers.get('server-timing')).toMatch(/^colliers-auth;dur=[\d.]+, colliers-sign;dur=[\d.]+, colliers-audit;dur=[\d.]+, colliers-json;dur=[\d.]+, colliers-handler;dur=[\d.]+$/);
  expect(fixture.audit).toHaveBeenCalledOnce();
  expect(fixture.audit.mock.calls[0]?.[1]).toMatchObject({ action_type: 'OSS_FILE_ACCESS', details: { access_method: 'download' } });
});
