import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { GET } from '../route';

const mocks = vi.hoisted(() => ({
  identity: vi.fn(),
  selects: [] as Array<{ count?: string; head?: boolean } | undefined>,
  count: vi.fn(),
  abort: vi.fn(),
  filters: [] as unknown[][],
  range: vi.fn(),
}));
vi.mock('@/src/lib/server/impersonationAuth', () => ({ resolveEffectiveRequestIdentity: mocks.identity }));
vi.mock('@supabase/supabase-js', () => ({ createClient: () => ({
  from: () => {
    const chain: Record<string, any> = {};
    chain.select = (_fields: string, options?: { count?: string; head?: boolean }) => {
      mocks.selects.push(options);
      return chain;
    };
    for (const method of ['contains', 'ilike', 'eq', 'gte', 'lte', 'order']) chain[method] = (...args: unknown[]) => {
      mocks.filters.push([method, ...args]);
      return chain;
    };
    chain.range = mocks.range;
    chain.abortSignal = (signal: AbortSignal) => { mocks.abort(signal); return chain; };
    chain.then = (resolve: (result: unknown) => void, reject: (error: unknown) => void) => mocks.count().then(resolve, reject);
    return chain;
  },
}) }));

beforeEach(() => {
  vi.clearAllMocks();
  mocks.selects.length = 0;
  mocks.filters.length = 0;
  mocks.range.mockResolvedValue({ data: [{ read_id: 'synthetic' }], count: 63, error: null });
  mocks.count.mockResolvedValue({ data: null, count: 63, error: null });
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://synthetic.invalid');
  vi.stubEnv('SUPABASE_SECRET_KEY', 'synthetic');
  mocks.identity.mockResolvedValue({ identity: { effectiveRole: 'admin', isImpersonating: false } });
});
afterEach(() => vi.unstubAllEnvs());

describe('lease history exact count reuse', () => {
  it('preserves the exact count for default callers and the first page', async () => {
    const response = await GET(new NextRequest('https://synthetic.invalid/api/lease-transactions/read?offset=0'));
    expect(response.status).toBe(200);
    expect((await response.json()).count).toBe(63);
    expect(mocks.selects).toEqual([{ count: 'exact' }]);
  });

  it('allows a subsequent page to bypass exact COUNT without reporting zero', async () => {
    const response = await GET(new NextRequest('https://synthetic.invalid/api/lease-transactions/read?offset=50&include_count=0'));
    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.records).toHaveLength(1);
    expect(payload.count).toBeNull();
    expect(mocks.selects).toEqual([undefined]);
    expect(payload.access.effectiveRole).toBe('admin');
  });

  it('does not change server-side source permission for a count-free request', async () => {
    vi.stubEnv('PERF_ISOLATED_SERVER_TIMING', 'preview');
    vi.stubEnv('VERCEL_ENV', 'preview');
    mocks.identity.mockResolvedValue({ identity: { effectiveRole: 'viewer', isImpersonating: false } });
    const response = await GET(new NextRequest('https://synthetic.invalid/api/lease-transactions/read?record_source=history&include_count=0'));
    expect(response.status).toBe(403);
    expect(response.headers.get('server-timing')).toBeNull();
    expect(mocks.selects).toHaveLength(0);
  });

  it('counts the same authorized filters without sorting, fetching rows or slicing a page', async () => {
    mocks.identity.mockResolvedValue({ identity: { effectiveRole: 'viewer', isImpersonating: true } });
    const req = new NextRequest('https://synthetic.invalid/api/lease-transactions/read?count_only=1&offset=50&company=Alpha&building_id=a&year_from=2020&area_max=100');
    const response = await GET(req);
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(await response.json()).toMatchObject({ records: [], count: 63, access: { effectiveRole: 'viewer', effectiveSource: 'live', impersonating: true } });
    expect(mocks.selects).toEqual([{ count: 'exact', head: true }]);
    expect(mocks.abort).toHaveBeenCalledWith(req.signal);
    expect(mocks.count).toHaveBeenCalledOnce();
    expect(mocks.range).not.toHaveBeenCalled();
    expect(mocks.filters).toEqual([
      ['contains', 'related_building_ids', ['a']],
      ['ilike', 'company', '%Alpha%'],
      ['eq', 'record_source', 'live'],
      ['gte', 'transaction_year', 2020],
      ['lte', 'area_sqm', 100],
    ]);
  });

  it('does not expose counts for denied history or report an unavailable count as zero', async () => {
    mocks.identity.mockResolvedValueOnce({ identity: { effectiveRole: 'editor', isImpersonating: false } });
    const denied = await GET(new NextRequest('https://synthetic.invalid/api/lease-transactions/read?count_only=1&record_source=history'));
    expect(denied.status).toBe(403);
    expect(mocks.selects).toEqual([]);
    mocks.count.mockResolvedValueOnce({ data: null, count: null, error: null });
    const invalid = await GET(new NextRequest('https://synthetic.invalid/api/lease-transactions/read?count_only=1'));
    expect(invalid.status).toBe(500);
  });

  it('can time a permitted page without changing the exact count', async () => {
    vi.stubEnv('PERF_ISOLATED_SERVER_TIMING', 'preview');
    vi.stubEnv('VERCEL_ENV', 'preview');
    const response = await GET(new NextRequest('https://synthetic.invalid/api/lease-transactions/read?offset=0'));
    expect(response.status).toBe(200);
    expect((await response.json()).count).toBe(63);
    expect(response.headers.get('server-timing')).toMatch(/colliers-auth;dur=[\d.]+, colliers-database;dur=[\d.]+/);
  });
});
