import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';
import { emptySubmarketProfile } from '@/src/app/map/model/submarketProfile';
import { GET, PUT } from '../route';

const mocks = vi.hoisted(() => ({
  identity: vi.fn(),
  from: vi.fn(),
  profileAvailable: false,
  profileRow: null as null | Record<string, unknown>,
  inserts: [] as Array<{ table: string; values: Record<string, unknown> }>,
  upserts: [] as Array<Record<string, unknown>>,
  metricError: null as null | { message: string },
  calls: [] as Array<{ table: string; action: string; args: unknown[] }>,
}));
vi.mock('@/src/lib/server/impersonationAuth', () => ({
  resolveEffectiveRequestIdentity: mocks.identity,
  denyImpersonatedMutation: (identity: { isImpersonating: boolean }) =>
    identity.isImpersonating ? NextResponse.json({ error: '模拟用户只读' }, { status: 403 }) : null,
}));
vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({ from: mocks.from }),
}));

const baseUrl = 'https://synthetic.invalid/api/map/submarket?submarket=CBD';
const user = { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', email: 'synthetic@invalid.test' };
const buildingRows = [
  { id: 'a', grade: 'A' }, { id: 'b', grade: 'B' }, { id: 'park', grade: 'BP' },
];
const quarterRows = [
  { building_id: 'a', record_year: 2026, record_quarter: 3, total_area: 100,
    net_effective_rent: 100, vacancy_rate: .1, is_draft: false, is_locked: true },
  { building_id: 'b', record_year: 2026, record_quarter: 3, total_area: 300,
    net_effective_rent: 200, vacant_area: 60, is_draft: false, is_locked: true },
  { building_id: 'a', record_year: 2026, record_quarter: 4, total_area: 100,
    net_effective_rent: 500, vacant_area: 99, is_draft: true },
];

const getIdentity = (role = 'viewer', isImpersonating = false) => ({
  identity: { caller: user, callerRole: role, effectiveRole: role,
    isImpersonating, effectiveUserId: user.id },
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.calls.length = 0;
  mocks.inserts.length = 0;
  mocks.upserts.length = 0;
  mocks.profileAvailable = false;
  mocks.profileRow = null;
  mocks.metricError = null;
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://synthetic.invalid');
  vi.stubEnv('SUPABASE_SECRET_KEY', 'test-secret');
  mocks.identity.mockResolvedValue(getIdentity());

  mocks.from.mockImplementation((table: string) => {
    const chain: Record<string, any> = {};
    for (const op of ['select', 'eq', 'or', 'in', 'gte', 'order', 'range']) {
      chain[op] = (...args: unknown[]) => {
        mocks.calls.push({ table, action: op, args });
        return chain;
      };
    }
    chain.abortSignal = () => Promise.resolve(table === 'buildings'
      ? { data: buildingRows, error: null }
      : { data: quarterRows, error: mocks.metricError });
    chain.maybeSingle = () => Promise.resolve(mocks.profileAvailable
      ? { data: mocks.profileRow, error: null }
      : { data: null, error: { code: 'PGRST205', message: 'table not found in schema cache' } });
    chain.upsert = (values: Record<string, unknown>) => {
      mocks.upserts.push(values);
      return chain;
    };
    chain.single = () => Promise.resolve({ data: mocks.upserts.at(-1), error: null });
    chain.insert = (values: Record<string, unknown>) => {
      mocks.inserts.push({ table, values });
      return Promise.resolve({ error: null });
    };
    return chain;
  });
});
afterEach(() => vi.unstubAllEnvs());

describe('authorized submarket GET', () => {
  it.each(['viewer', 'editor', 'admin'])('reads same-quarter A/B statistics for %s', async role => {
    mocks.identity.mockResolvedValue(getIdentity(role));
    const response = await GET(new NextRequest(baseUrl));
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toContain('no-store');
    const result = await response.json();
    expect(result.stockCount).toBe(2);
    expect(result.source).toBe('building_metrics');
    expect(result.trends.all.at(-1)).toMatchObject({
      period: '2026Q3', rent: 175, vacancyPct: 17.5,
      rentSamples: 2, vacancySamples: 2,
    });
    expect(result.trends.a.at(-1).rent).toBe(100);
    expect(result.trends.b.at(-1).rent).toBe(200);
    expect(result.profileAvailable).toBe(false);
    expect(result.profile.policies).toEqual([]);
    expect(mocks.calls).toContainEqual({ table: 'buildings', action: 'eq', args: ['is_active', true] });
    expect(mocks.calls).toContainEqual({ table: 'buildings', action: 'eq', args: ['tracking_scope', 'tracked'] });
    const metricsQuery = mocks.calls.find(record => record.table === 'building_metrics' && record.action === 'in');
    expect(metricsQuery?.args).toEqual(['building_id', ['a', 'b']]);
  });

  it('does not disclose any data when anonymous or role invalid', async () => {
    mocks.identity.mockResolvedValueOnce({ response: NextResponse.json({ error: 'not logged in' }, { status: 401 }) });
    expect((await GET(new NextRequest(baseUrl))).status).toBe(401);
    mocks.identity.mockResolvedValueOnce(getIdentity('unknown'));
    expect((await GET(new NextRequest(baseUrl))).status).toBe(403);
    expect(mocks.from).not.toHaveBeenCalledWith('building_metrics');
  });

  it('rejects unknown submarkets without touching database', async () => {
    expect((await GET(new NextRequest(baseUrl.replace('CBD', 'Other')))).status).toBe(400);
    expect(mocks.identity).not.toHaveBeenCalled();
  });

  it('never shows a deceptively empty chart on metric read failure', async () => {
    mocks.metricError = { message: 'disconnected' };
    const response = await GET(new NextRequest(baseUrl));
    expect(response.status).toBe(500);
    expect(await response.json()).toMatchObject({ error: expect.any(String) });
  });

  it('reads a validated editorial profile when migration exists', async () => {
    mocks.profileAvailable = true;
    mocks.profileRow = { ...emptySubmarketProfile(), headline: '已核实的定位', submarket: 'CBD', updated_at: '2026-11-01T00:00:00Z' };
    const response = await GET(new NextRequest(baseUrl));
    const body = await response.json();
    expect(body.profileAvailable).toBe(true);
    expect(body.profile.headline).toBe('已核实的定位');
  });
});

describe('admin submarket editorial write', () => {
  const request = (payload: unknown) => new NextRequest(baseUrl, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
  });

  it('rejects non-admin and impersonated admin before any write', async () => {
    mocks.identity.mockResolvedValueOnce(getIdentity('viewer'));
    expect((await PUT(request(emptySubmarketProfile()))).status).toBe(403);
    mocks.identity.mockResolvedValueOnce(getIdentity('admin', true));
    expect((await PUT(request(emptySubmarketProfile()))).status).toBe(403);
    expect(mocks.upserts).toHaveLength(0);
  });

  it('validates source attribution for population and policy before saving', async () => {
    mocks.identity.mockResolvedValue(getIdentity('admin'));
    const invalid = { ...emptySubmarketProfile(), demographics: [
      { label: '人口', value: '1', unit: '万人', scope: '', asOf: '2025', sourceUrl: '' },
    ] };
    expect((await PUT(request(invalid))).status).toBe(400);
    expect(mocks.upserts).toHaveLength(0);
  });

  it('requires migration before editing anything', async () => {
    mocks.identity.mockResolvedValue(getIdentity('admin'));
    expect((await PUT(request(emptySubmarketProfile()))).status).toBe(503);
    expect(mocks.upserts).toHaveLength(0);
  });

  it('saves for actual administrator and audits before/after editorial records', async () => {
    mocks.identity.mockResolvedValue(getIdentity('admin'));
    mocks.profileAvailable = true;
    mocks.profileRow = { ...emptySubmarketProfile(), headline: '旧版' };
    const draft = { ...emptySubmarketProfile(), headline: '新版介绍', insights: [
      { title: '区位特点', body: '观点和证据待团队复核', author: '研究团队', asOf: '2026年11月' },
    ] };
    const response = await PUT(request(draft));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ saved: true, profile: { headline: '新版介绍' } });
    expect(mocks.upserts).toHaveLength(1);
    expect(mocks.upserts[0]).toMatchObject({ submarket: 'CBD', headline: '新版介绍', updated_by: user.id });
    expect(mocks.inserts).toHaveLength(1);
    expect(mocks.inserts[0].table).toBe('audit_logs');
    expect(mocks.inserts[0].values).toMatchObject({
      action_type: 'ADMIN_DATA_OPERATION', target_table: 'map_submarket_profiles',
      old_values: { headline: '旧版' }, new_values: { headline: '新版介绍' },
    });
  });
});
