import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';
import { submarketIntelligenceSchema } from '@/src/app/map/model/submarketIntelligence';
import edition from '@/data/submarket-research/2026-11-27/cbd.json';
import { emptySubmarketProfile } from '@/src/app/map/model/submarketProfile';
import { GET, PUT } from '../route';

const mocks = vi.hoisted(() => ({
  identity: vi.fn(),
  intentError:false,completionError:false,receipt:null as Record<string,unknown>|null,
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
  createClient: () => ({ from: mocks.from,rpc:async(_name:string,args:{p_details:Record<string,unknown>;p_state:string})=>{
    if(mocks.completionError)return {error:{code:'offline'}};
    const details=args.p_details;
    mocks.inserts.push({table:'audit_logs',values:{...mocks.receipt,...details,details:{...(mocks.receipt?.details as object),outcome:args.p_state}}});
    return {data:true,error:null};
  }}),
}));

const baseUrl = 'https://synthetic.invalid/api/map/submarket?submarket=CBD';
const user = { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', email: 'synthetic@invalid.test' };
const buildingRows = [
  { id: 'a', grade: 'A' }, { id: 'b', grade: 'B' }, { id: 'park', grade: 'BP' },
];
const quarterRows = [
  { building_id: 'a', record_year: 2023, record_quarter: 4, total_area: 100,
    net_effective_rent: 150, vacancy_rate: 0, is_draft: false, is_locked: true },
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
  mocks.intentError=false;mocks.completionError=false;mocks.receipt=null;
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
      if(table==='audit_operation_receipts'){mocks.receipt=values;return Promise.resolve({error:mocks.intentError?{code:'offline'}:null});}
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
    expect(result.scope).toBe('authorized_market');
    expect(result.publication).toBe('locked_non_draft');
    expect(mocks.calls).toContainEqual({ table: 'building_metrics', action: 'eq', args: ['is_locked', true] });
    expect(mocks.calls).toContainEqual({ table: 'building_metrics', action: 'order', args: ['id', { ascending: false }] });
    expect(result.trends.all.at(-1)).toMatchObject({
      period: '2026Q3', rent: 175, vacancyPct: 17.5,
      rentSamples: 2, vacancySamples: 2,
    });
    expect(result.trends.all[0]).toMatchObject({ period: '2023Q4', rent: 150, vacancyPct: 0 });
    expect(result.trends.all[1]).toMatchObject({ period: '2024Q1', rent: null, vacancyPct: null });
    expect(result.trends.a.at(-1).rent).toBe(100);
    expect(result.trends.b.at(-1).rent).toBe(200);
    expect(result.profileAvailable).toBe(false);
    expect(result.profile.policies).toEqual([]);
    expect(mocks.calls).toContainEqual({ table: 'buildings', action: 'eq', args: ['is_active', true] });
    expect(mocks.calls).toContainEqual({ table: 'buildings', action: 'eq', args: ['tracking_scope', 'tracked'] });
    const metricsQuery = mocks.calls.find(record => record.table === 'building_metrics' && record.action === 'in');
    expect(metricsQuery?.args).toEqual(['building_id', ['a', 'b']]);
  });

  it('projects a structured edition without legacy draft fields and blocks viewer history', async () => {
    const research = submarketIntelligenceSchema.parse(edition);
    mocks.profileAvailable = true;
    mocks.profileRow = { submarket: 'CBD', is_published: true, headline: '内部提示', research };
    const result = await (await GET(new NextRequest(baseUrl))).json();
    expect(result.profile).toMatchObject({ headline: research.positioning, insights: [], research });
    expect(result.draftProfile).toBeUndefined();
    expect((await GET(new NextRequest(baseUrl + '&researchHistory=0'))).status).toBe(403);
    mocks.identity.mockResolvedValue(getIdentity('admin', true));
    expect((await GET(new NextRequest(baseUrl + '&researchHistory=0'))).status).toBe(403);
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

  it('retains the factual snapshot while independently reporting a failed trend read', async () => {
    mocks.metricError = { message: 'disconnected' };
    const response = await GET(new NextRequest(baseUrl));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      stockCount: 0, trendError: true, trends: { all: [], a: [], b: [] },
    });
  });

  it('never exposes populated legacy draft material to a client', async () => {
    mocks.profileAvailable = true;
    mocks.profileRow = { ...emptySubmarketProfile(), headline: '待业务团队复核', is_published: false };
    const response = await GET(new NextRequest(baseUrl));
    const body = await response.json();
    expect(body.profileAvailable).toBe(true);
    expect(body.profilePublished).toBe(false);
    expect(body.profile.headline).toBe('');
    expect(body.draftProfile).toBeUndefined();
    expect(JSON.stringify(body)).not.toContain('待业务团队复核');
  });

  it('lets a real admin edit unpublished material without leaking it into the client brief', async () => {
    mocks.identity.mockResolvedValue(getIdentity('admin'));
    mocks.profileAvailable = true;
    mocks.profileRow = { ...emptySubmarketProfile(), headline: '客户沟通（研究草案）', is_published: false };
    const body = await (await GET(new NextRequest(baseUrl))).json();
    expect(body.profile.headline).toBe('');
    expect(body.draftProfile.headline).toBe('客户沟通（研究草案）');
  });

  it('shows only explicitly approved content that passes the server release gate', async () => {
    mocks.profileAvailable = true;
    mocks.profileRow = { ...emptySubmarketProfile(),
      headline: '北京商务核心区', overview: '区域有成熟商务载体。',
      industries: '金融与专业服务。', transport: '轨道交通及道路网络。',
      is_published: true,
    };
    const body = await (await GET(new NextRequest(baseUrl))).json();
    expect(body.profilePublished).toBe(true);
    expect(body.profile.headline).toBe('北京商务核心区');
    expect(body.draftProfile).toBeUndefined();
  });

  it('blocks a row marked published when its stored text still contains draft markers', async () => {
    mocks.profileAvailable = true;
    mocks.profileRow = { ...emptySubmarketProfile(),
      headline: '北京商务核心区', overview: '区域有成熟商务载体。',
      industries: '金融与专业服务。', transport: '轨道交通及道路网络。',
      insights: [{ title: '研究草案', body: '观点', author: '研究部', asOf: '2026' }],
      is_published: true,
    };
    const body = await (await GET(new NextRequest(baseUrl))).json();
    expect(body.profilePublished).toBe(false);
    expect(body.profile.insights).toEqual([]);
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


  it('rejects external publication when any field contains research-draft language', async () => {
    mocks.identity.mockResolvedValue(getIdentity('admin'));
    mocks.profileAvailable = true;
    const draft = { ...emptySubmarketProfile(), headline: 'CBD',
      overview: '客户沟通（研究草案）', industries: '金融', transport: '地铁',
      publicationIntent: 'publish' };
    const response = await PUT(request(draft));
    expect(response.status).toBe(422);
    expect(mocks.upserts).toHaveLength(0);
  });

  it('requires a complete clean brief and records explicit admin publication', async () => {
    mocks.identity.mockResolvedValue(getIdentity('admin'));
    mocks.profileAvailable = true;
    mocks.profileRow = { ...emptySubmarketProfile(), headline: '旧版本', is_published: false };
    const draft = { ...emptySubmarketProfile(), headline: '北京商务核心区',
      overview: '区域有成熟商务载体。', industries: '金融与专业服务。',
      transport: '轨道交通与道路网络。', publicationIntent: 'publish' };
    const body = await (await PUT(request(draft))).json();
    expect(body.profilePublished).toBe(true);
    expect(mocks.upserts[0]).toMatchObject({ is_published: true, published_by: user.id });
    expect(mocks.inserts[0].values.details).toMatchObject({ operation: 'publish_submarket_profile' });
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

it('does not mutate editorial data if a critical receipt cannot be persisted',async()=>{
 mocks.identity.mockResolvedValue(getIdentity('admin'));mocks.profileAvailable=true;mocks.profileRow=emptySubmarketProfile();mocks.intentError=true;
 const req=new NextRequest(baseUrl,{method:'PUT',body:JSON.stringify({...emptySubmarketProfile(),headline:'blocked'})});
 expect((await PUT(req)).status).toBe(503);expect(mocks.upserts).toHaveLength(0);
});
