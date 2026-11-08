import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { GET } from '../route';

const mocks = vi.hoisted(() => ({
  identity: vi.fn(),
  selects: [] as Array<{ count?: string } | undefined>,
}));
vi.mock('@/src/lib/server/impersonationAuth', () => ({ resolveEffectiveRequestIdentity: mocks.identity }));
vi.mock('@supabase/supabase-js', () => ({ createClient: () => ({
  from: () => {
    const chain: Record<string, any> = {};
    chain.select = (_fields: string, options?: { count?: string }) => {
      mocks.selects.push(options);
      return chain;
    };
    for (const method of ['contains', 'ilike', 'eq', 'gte', 'lte', 'order']) chain[method] = () => chain;
    chain.range = () => Promise.resolve({ data: [{ read_id: 'synthetic' }], count: 63, error: null });
    return chain;
  },
}) }));

beforeEach(() => {
  vi.clearAllMocks();
  mocks.selects.length = 0;
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://synthetic.invalid');
  vi.stubEnv('SUPABASE_SECRET_KEY', 'synthetic');
  mocks.identity.mockResolvedValue({ identity: { effectiveRole: 'admin', isImpersonating: false } });
});

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
    mocks.identity.mockResolvedValue({ identity: { effectiveRole: 'viewer', isImpersonating: false } });
    const response = await GET(new NextRequest('https://synthetic.invalid/api/lease-transactions/read?record_source=history&include_count=0'));
    expect(response.status).toBe(403);
    expect(mocks.selects).toHaveLength(0);
  });
});
