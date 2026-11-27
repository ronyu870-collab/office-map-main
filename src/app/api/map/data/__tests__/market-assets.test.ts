import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';
import { GET } from '../route';

const calls = vi.hoisted(() => ({ identity: vi.fn(), from: vi.fn(), queries: [] as { table: string; fields?: string; filters: string[] }[] }));
vi.mock('@/src/lib/server/impersonationAuth', () => ({ resolveEffectiveRequestIdentity: calls.identity }));
vi.mock('@supabase/supabase-js', () => ({ createClient: () => ({ from: calls.from }) }));

const id = '11111111-1111-4111-8111-111111111111';
const metric = { id: 1, record_year: 2026, record_quarter: 2, is_locked: true, is_draft: false, total_area: 1000, net_effective_rent: 100, vacant_area: 100 };
const lease = { record_source: 'live', quality_status: 'OPERATIONAL', building_match_scope: 'exact', building_id: id,
  transaction_year: 2026, transaction_quarter: 'Q2', area_sqm: 100, industry: '金融', demand_type: '新租', company: 'private-tenant' };
const research = {
  version: 1, market: 'CBD', positioning: '成熟商务区', updatedOn: '2026-11-27', focus: 'stock',
  sources: [{ id: 'example', title: '公开报告', publisher: '示例顾问', url: 'https://example.org/report', publishedOn: '2026-01-01',
    observedAt: '2026Q2', verifiedOn: '2026-11-27', scope: 'CBD', scopeType: 'external_market', basis: '公开案例' }],
  facts: [{ title: '公开市场事实', body: '核心区商务活动', kind: 'place', status: 'observed', sourceIds: ['example'] }],
  observations: [{ title: '商务区位', body: '办公区位成熟', kind: 'inference', asOf: '2026Q2', scope: 'CBD', limitation: '公开案例', sourceIds: ['example'] }],
  projects: [{ buildingId: id, role: '商务项目', reason: '示例顾问报告列举项目案例', sourceIds: ['example'] }],
};
const req = (query = '&submarket=CBD&year=2026&quarter=2') => new NextRequest('https://synthetic.invalid/api/map/data?mode=research-assets' + query);

beforeEach(() => {
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://synthetic.invalid');
  vi.stubEnv('SUPABASE_SECRET_KEY', 'synthetic');
  calls.queries.length = 0;
  calls.identity.mockReset().mockResolvedValue({ identity: { effectiveRole: 'viewer' } });
  calls.from.mockReset().mockImplementation((table: string) => {
    const q: typeof calls.queries[number] = { table, filters: [] };
    calls.queries.push(q);
    const builder = {
      select(fields: string) { q.fields = fields; return builder; },
      eq(key: string, value: unknown) { q.filters.push(key + ':' + String(value)); return builder; },
      or(value: string) { q.filters.push(value); return builder; },
      in(key: string, values: unknown[]) { q.filters.push(key + ':' + values.join(',')); return builder; },
      order() { return builder; }, limit() { return builder; }, range() { return builder; }, abortSignal() { return builder; },
      then(resolve: (result: { data: unknown[]; error: null }) => unknown) {
        const rows = table === 'buildings' ? [{ id, name: '测试楼宇', submarket: 'CBD', grade: 'A',
          building_metrics: [metric, { ...metric, record_quarter: 3, net_effective_rent: 999 }, { ...metric, id: 2, is_draft: true, net_effective_rent: 888 }] }]
          : table === 'lease_transactions_read_v1' ? [1,2,3].map(n => ({ ...lease, source_record_id: String(n) }))
            .concat([{ ...lease, source_record_id: '1' }, { ...lease, source_record_id: '4', record_source: 'history' }])
          : table === 'map_submarket_profiles' ? [{ submarket: 'CBD', is_published: true, research }]
          : [];
        return Promise.resolve({ data: rows, error: null }).then(resolve);
      },
    };
    return builder;
  });
});
afterEach(() => vi.unstubAllEnvs());

describe('authorized market asset research', () => {
  it('uses one real formal period, exact live leases and published research IDs, without returning private transaction details', async () => {
    const response = await GET(req());
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toContain('private, no-store');
    const body = await response.json();
    expect(body.period).toBe(2026 * 4 + 1);
    expect(body.assets).toHaveLength(1);
    expect(body.assets[0].metrics).toEqual([metric]);
    expect(body.demand.CBD).toMatchObject({ count: 3, area: 300, projects: [{ buildingId: id, count: 3, area: 300 }] });
    expect(body.contexts.CBD.projects[0]).toMatchObject({ buildingId: id, role: '商务项目' });
    expect(body.contexts.CBD.projects[0].reason).not.toContain('示例顾问');
    expect(JSON.stringify(body)).not.toMatch(/private-tenant|source_record_id|example\.org/);
    expect(calls.queries.find(q => q.table === 'buildings')?.filters).toEqual(expect.arrayContaining(['is_active:true','tracking_scope:tracked','building_metrics.record_year:2026','building_metrics.record_quarter:2','building_metrics.is_locked:true']));
    const read = calls.queries.find(q => q.table === 'lease_transactions_read_v1');
    expect(read?.filters).toEqual(expect.arrayContaining(['record_source:live','quality_status:OPERATIONAL','building_match_scope:exact','building_id:' + id]));
    expect(read?.fields).not.toMatch(/company|face_rent|remarks|agency_person/);
  });

  it('rejects invalid or oversized requests and denies anonymous and unknown roles before database reads', async () => {
    expect((await GET(req('&submarket=CBD&year=2026&quarter=5'))).status).toBe(400);
    expect((await GET(req('&submarket=CBD&submarket=CBD&submarket=上地&submarket=金融街&year=2026&quarter=2'))).status).toBe(400);
    calls.identity.mockResolvedValueOnce({ response: NextResponse.json({}, { status: 401 }) });
    expect((await GET(req())).status).toBe(401);
    calls.identity.mockResolvedValueOnce({ identity: { effectiveRole: 'unknown' } });
    expect((await GET(req())).status).toBe(403);
    expect(calls.queries).toHaveLength(0);
  });
});
