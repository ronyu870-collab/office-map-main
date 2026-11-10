import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';
import { GET } from '../route';

const calls = vi.hoisted(() => ({ identity: vi.fn(), from: vi.fn(), queries: [] as { table: string; fields?: string; ids?: string[]; scope?: string[]; range?: number[] }[] }));
vi.mock('@/src/lib/server/impersonationAuth', () => ({ resolveEffectiveRequestIdentity: calls.identity }));
vi.mock('@supabase/supabase-js', () => ({ createClient: () => ({ from: calls.from }) }));
const target = '11111111-1111-4111-8111-111111111111';
const untracked = '22222222-2222-4222-8222-222222222222';
const other = '33333333-3333-4333-8333-333333333333';
const request = (query: string) => new NextRequest(`https://example.test/api/map/data?mode=compare${query}`);

beforeEach(() => {
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://synthetic.invalid');
  vi.stubEnv('SUPABASE_SECRET_KEY', 'synthetic');
  calls.queries.length = 0;
  calls.identity.mockReset().mockResolvedValue({ identity: { effectiveRole: 'viewer' } });
  calls.from.mockReset().mockImplementation((table: string) => {
    const query: typeof calls.queries[number] = { table, scope: [] };
    calls.queries.push(query);
    const builder = {
      select(fields: string) { query.fields = fields; return builder; },
      eq(key: string, value: unknown) { query.scope!.push(`${key}:${value}`); return builder; },
      or(value: string) { query.scope!.push(value); return builder; },
      order() { return builder; },
      limit() { return builder; },
      in(_column: string, ids: string[]) { query.ids = ids; return builder; },
      range(from: number, to: number) { query.range = [from, to]; return builder; },
      then(resolve: (result: { data: unknown[]; error: null }) => unknown) {
        const withMetrics = query.fields?.includes('building_metrics');
        const rows = table === 'buildings' ? [target, other].filter(id => !query.ids || query.ids.includes(id)).map(id => ({
          id, name: '候选楼宇', grade: 'A', submarket: 'CBD', district: '朝阳区',
          ...(withMetrics ? { building_metrics: [{ record_year: 2026, record_quarter: 2, vacancy_rate: 0.1 }] } : {}),
        })) : [target, other, untracked].filter(id => !query.ids || query.ids.includes(id)).map(id => ({ building_id: id, developer: '合成开发商' }));
        return Promise.resolve({ data: rows, error: null }).then(resolve);
      },
    };
    return builder;
  });
});
afterEach(() => vi.unstubAllEnvs());

describe('authorized comparison data split', () => {
  it('returns all authorized candidate labels without reading any metrics or brochures', async () => {
    const result = await GET(request('&scope=catalog'));
    expect(result.status).toBe(200);
    expect(result.headers.get('cache-control')).toContain('private, no-store');
    const body = await result.json();
    expect(body.buildings.map((row: { id: string }) => row.id)).toEqual([target, other]);
    expect(body.brochures).toEqual([]);
    expect(calls.queries).toHaveLength(1);
    expect(calls.queries[0]?.fields).not.toContain('building_metrics');
    expect(calls.queries[0]?.scope).toContain('tracking_scope:tracked');
  });

  it('reads selected metrics and only authorized brochure IDs, preserving the original values', async () => {
    const result = await GET(request(`&scope=selected&id=${target}&id=${untracked}&id=${target}`));
    expect(result.status).toBe(200);
    expect(await result.json()).toEqual({ buildings: [{ id: target, name: '候选楼宇', grade: 'A', submarket: 'CBD', district: '朝阳区', building_metrics: [{ record_year: 2026, record_quarter: 2, vacancy_rate: 0.1 }] }], brochures: [{ building_id: target, developer: '合成开发商' }] });
    expect(calls.queries.map(query => [query.table, query.ids])).toEqual([['buildings', [target, untracked]], ['building_brochure_data', [target]]]);
  });

  it('rejects malformed and oversized selections before querying, and keeps anonymous requests protected', async () => {
    expect((await GET(request('&scope=selected&id=invalid'))).status).toBe(400);
    expect((await GET(request('&scope=selected' + `&id=${target}`.repeat(7)))).status).toBe(400);
    expect(calls.queries).toHaveLength(0);
    calls.identity.mockResolvedValueOnce({ response: NextResponse.json({}, { status: 401 }) });
    expect((await GET(request('&scope=catalog'))).status).toBe(401);
    expect(calls.queries).toHaveLength(0);
  });

  it('adds only isolated timing metadata and preserves the response body and access boundary', async () => {
    vi.stubEnv('VERCEL_ENV', 'preview');
    vi.stubEnv('PERF_ISOLATED_SERVER_TIMING', '0');
    const normal = await GET(request(`&scope=selected&id=${target}`));
    expect(normal.headers.get('server-timing')).toBeNull();
    vi.stubEnv('PERF_ISOLATED_SERVER_TIMING', 'preview');
    const measured = await GET(request(`&scope=selected&id=${target}`));
    expect(measured.status).toBe(200);
    expect(await measured.json()).toEqual(await normal.json());
    expect(measured.headers.get('cache-control')).toBe(normal.headers.get('cache-control'));
    expect(measured.headers.get('server-timing')).toMatch(/^colliers-auth;dur=[\d.]+, colliers-database;dur=[\d.]+, colliers-brochures;dur=[\d.]+, colliers-json;dur=[\d.]+, colliers-handler;dur=[\d.]+$/);
    calls.identity.mockResolvedValueOnce({ response: NextResponse.json({}, { status: 401 }) });
    const denied = await GET(request('&scope=catalog'));
    expect(denied.status).toBe(401);
    expect(denied.headers.get('server-timing')).toBeNull();
    vi.stubEnv('VERCEL_ENV', 'production');
    const production = await GET(request('&scope=catalog'));
    expect(production.status).toBe(200);
    expect(production.headers.get('server-timing')).toBeNull();
  });
});
