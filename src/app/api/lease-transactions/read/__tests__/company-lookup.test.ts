import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';
import { GET, POST } from '../route';

const identity = vi.hoisted(() => vi.fn());
const defer = vi.hoisted(() => vi.fn());
vi.mock('next/server', async (importOriginal) => ({ ...(await importOriginal<typeof import('next/server')>()), after: defer }));
vi.mock('@/src/lib/server/impersonationAuth', () => ({ resolveEffectiveRequestIdentity: identity }));

const name = 'A.B_(测试)*%';
const rows = [
  ...Array.from({ length: 7 }, (_, i) => ({
    company: name, suspected_company_fullname: null, record_source: 'live',
    read_id: `live:${i + 1}`, transaction_period_start: `2026-10-0${i + 1}`,
    new_building: '演示楼宇', effective_rent: 123.45,
  })),
  { company: ` ${name.toLowerCase()} `, record_source: 'history', read_id: 'history:1', transaction_period_start: '2026-10-10' },
  { company: `${name} 分公司`, record_source: 'live', read_id: 'live:branch', transaction_period_start: '2026-10-20' },
  { company: '演示企业', suspected_company_fullname: '演示实业有限公司', record_source: 'live', read_id: 'live:demo', transaction_period_start: '2026-07-01' },
  { company: '归档专属', record_source: 'history', read_id: 'history:private', transaction_period_start: '2025-01-01' },
  { company: '日期未填', record_source: 'live', read_id: 'live:unknown', transaction_period_start: null },
  { company: '样本证券股份有限公司', record_source: 'live', read_id: 'live:securities', transaction_period_start: '2026-06-01' },
  { company: '样本银行股份有限公司', record_source: 'live', read_id: 'live:bank', transaction_period_start: '2026-08-01' },
  { company: '样本投资有限公司', record_source: 'history', read_id: 'history:investment', transaction_period_start: '2026-07-01' },
];

const postgrest = vi.fn(async (input: RequestInfo | URL) => {
  const url = new URL(String(input));
  expect(url.pathname).toBe('/rest/v1/lease_transactions_read_v1');
  const params = url.searchParams;
  const fields = params.get('select')!.split(',');
  const source = params.get('record_source')?.slice(3);
  const matches = (column: 'company' | 'suspected_company_fullname') => {
    const filter = params.get(column);
    if (!filter) return () => true;
    expect(filter).toMatch(/^imatch\./);
    const regex = new RegExp(filter.slice(7).replaceAll('[[:space:]]', '\\s'), 'i');
    return (row: typeof rows[number]) => regex.test(row[column] ?? '');
  };
  const data = rows
    .filter((row) => !source || row.record_source === source)
    .filter(matches('company')).filter(matches('suspected_company_fullname'))
    .filter((row) => !params.has('transaction_period_start') || row.transaction_period_start != null)
    .sort((a, b) => params.get('order')?.startsWith('transaction_period_start.desc')
      ? String(b.transaction_period_start).localeCompare(String(a.transaction_period_start))
      : a.company.localeCompare(b.company))
    .slice(0, Number(params.get('limit')))
    .map((row) => Object.fromEntries(Object.entries(row).filter(([field]) => fields.includes(field))));
  return Response.json(data);
});

function setRole(effectiveRole: string, isImpersonating = false) {
  identity.mockResolvedValue({ identity: { effectiveRole, isImpersonating } });
}
function get(mode: string, company: string, extra: Record<string, string> = {}) {
  const params = new URLSearchParams({ company_lookup: mode, company, ...extra });
  return GET(new NextRequest(`https://synthetic.invalid/api/lease-transactions/read?${params}`));
}
async function read(mode: string, company: string) {
  const response = await get(mode, company);
  expect(response.status).toBe(200);
  expect(response.headers.get('Cache-Control')).toBe('private, no-store');
  return response.json();
}
function assess(company: string, extra: Record<string, string> = {}) {
  const params = new URLSearchParams({ company_lookup: 'assess', ...extra });
  return POST(new NextRequest(`https://synthetic.invalid/api/lease-transactions/read?${params}`, {
    method: 'POST', body: JSON.stringify({ company }),
  }));
}

function startAi(mode: 'shadow' | 'hints') {
  vi.stubEnv('LEASE_COMPANY_AI_MODE', mode);
  vi.stubEnv('DEEPSEEK_API_KEY', 'synthetic-provider');
  vi.stubEnv('DEEPSEEK_API_BASE_URL', 'https://deepseek.synthetic.invalid');
}

beforeEach(() => {
  postgrest.mockClear();
  defer.mockReset();
  vi.stubGlobal('fetch', postgrest);
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://synthetic.invalid');
  vi.stubEnv('SUPABASE_SECRET_KEY', 'synthetic');
  vi.stubEnv('LEASE_COMPANY_AI_MODE', 'off');
  setRole('admin');
});

describe('optional background company assessments on the same authorized route', () => {
  it('does no AI work when off and accepts only valid non-impersonated editor/admin requests', async () => {
    expect((await assess('样本')).status).toBe(204);
    startAi('shadow');
    identity.mockResolvedValueOnce({ response: NextResponse.json({}, { status: 401 }) });
    expect((await assess('样本')).status).toBe(401);
    setRole('viewer');
    expect((await assess('样本')).status).toBe(403);
    setRole('editor', true);
    expect((await assess('样本')).status).toBe(403);
    setRole('editor');
    expect((await assess('样本', { record_source: 'history' })).status).toBe(403);
    expect((await assess('https://private.invalid')).status).toBe(400);
    expect(defer).not.toHaveBeenCalled();
    expect(postgrest).not.toHaveBeenCalled();
  });

  it('answers before DeepSeek, sends only claimed visible pairs, and fails closed on malformed model output', async () => {
    startAi('shadow');
    setRole('editor');
    const fakeFetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith('/lease_company_ai_claim_v1')) {
        const payload = JSON.parse(String(init?.body));
        expect(payload.p_query_key).toBe('样夲证券');
        expect(payload.p_candidates).toEqual([{ name: '样本证券股份有限公司', key: '样本证券股份有限公司' }]);
        return Response.json(fakeFetch.mock.calls.filter(([called]) => String(called).includes('lease_company_ai_claim_v1')).length === 1
          ? [{ assessment_id: 1, name_a: '样夲证券', name_b: '样本证券股份有限公司' }] : []);
      }
      if (url.pathname.endsWith('/lease_company_ai_complete_v1')) {
        expect(JSON.parse(String(init?.body)).p_results).toEqual([{ assessment_id: 1, relation: null, strength: null }]);
        return new Response(null, { status: 204 });
      }
      if (url.hostname === 'deepseek.synthetic.invalid') {
        const payload = JSON.parse(String(init?.body));
        expect(JSON.parse(payload.input)).toEqual([{ pair: 1, name_a: '样夲证券', name_b: '样本证券股份有限公司' }]);
        expect(payload.input).not.toMatch(/rent|history|read_id|assessment_id/);
        return Response.json({ status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: '{"results":[]}' }] }] });
      }
      return postgrest(input);
    });
    vi.stubGlobal('fetch', fakeFetch);
    expect(await read('suggestions', '样夲证券')).toEqual({ suggestions: [], hasRecentDeals: false, canAssessSimilar: true });
    expect(await read('suggestions', '样本证券股份有限公司')).toEqual({ suggestions: [{ company: '样本证券股份有限公司' }], hasRecentDeals: true });
    expect(defer).not.toHaveBeenCalled();
    fakeFetch.mockClear();
    expect((await assess('样夲证券')).status).toBe(202);
    expect(fakeFetch).not.toHaveBeenCalled();
    await defer.mock.calls[0][0]();
    expect((await assess('样夲证券')).status).toBe(202);
    await defer.mock.calls[1][0]();
    expect(fakeFetch.mock.calls.filter(([url]) => String(url).startsWith('https://deepseek.synthetic.invalid/'))).toHaveLength(1);
  });

  it('labels vetted candidates only in hints mode and keeps history exact for the selected company', async () => {
    setRole('editor');
    const fakeFetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith('/lease_company_ai_hints_v1')) {
        expect(url.searchParams.get('p_source')).toBe('live');
        return Response.json([
          { company: '样本证券股份有限公司', relation: 'same_company' },
          { company: '样本银行股份有限公司', relation: 'related_company' },
        ]);
      }
      return postgrest(input);
    });
    vi.stubGlobal('fetch', fakeFetch);
    startAi('shadow');
    const shadow = await read('suggestions', '样本');
    expect(shadow.suggestions).toHaveLength(2);
    expect(shadow.suggestions.every((option: { relation?: string }) => option.relation === undefined)).toBe(true);
    expect(fakeFetch.mock.calls.every(([url]) => !String(url).includes('lease_company_ai_hints_v1'))).toBe(true);
    startAi('hints');
    expect(await read('suggestions', '样本')).toEqual({
      suggestions: [
        { company: '样本证券股份有限公司', relation: 'same_company' },
        { company: '样本银行股份有限公司', relation: 'related_company' },
      ], hasRecentDeals: false, canAssessSimilar: true,
    });
    expect((await read('recent', '样本证券股份有限公司')).records.map((row: { read_id: string }) => row.read_id)).toEqual(['live:securities']);
    expect(defer).not.toHaveBeenCalled();
  });
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe('company lookup on the authorized lease read route', () => {
  it('ranks and deduplicates company suggestions, but does not assert identity from a suspected full name', async () => {
    expect(await read('suggestions', `  ${name}  `)).toEqual({
      suggestions: [{ company: name }, { company: `${name} 分公司` }],
      hasRecentDeals: true,
    });
    expect(await read('suggestions', '实业有限')).toEqual({
      suggestions: [{ company: '演示企业', matchedFullName: '演示实业有限公司' }],
      hasRecentDeals: false,
    });
    expect(await read('recent', '演示实业有限公司')).toEqual({ records: [] });
    expect(await read('suggestions', '日期未填')).toEqual({ suggestions: [{ company: '日期未填' }], hasRecentDeals: false });
  });

  it('returns up to five dated exact matches, newest first, with literal punctuation and minimal fields', async () => {
    setRole('editor');
    const { records } = await read('recent', name);
    expect(records.map((row: { read_id: string }) => row.read_id)).toEqual(['live:7', 'live:6', 'live:5', 'live:4', 'live:3']);
    expect(records[0]).toEqual({ read_id: 'live:7', record_source: 'live', new_building: '演示楼宇', effective_rent: 123.45 });
  });

  it.each(['editor', 'viewer'])('never exposes archive names or existence for effective role %s', async (role) => {
    setRole(role, true);
    expect(await read('suggestions', '归档专属')).toEqual({ suggestions: [], hasRecentDeals: false });
    expect(await read('recent', '归档专属')).toEqual({ records: [] });
    postgrest.mockClear();
    expect((await get('suggestions', '归档专属', { record_source: 'history' })).status).toBe(403);
    expect(postgrest).not.toHaveBeenCalled();
    setRole('admin');
    expect((await read('suggestions', '归档专属')).hasRecentDeals).toBe(true);
    expect((await read('recent', '归档专属')).records[0].record_source).toBe('history');
  });

  it('rejects anonymous, unknown roles and malformed queries before any data read', async () => {
    identity.mockResolvedValueOnce({ response: NextResponse.json({}, { status: 401 }) });
    expect((await get('suggestions', name)).status).toBe(401);
    setRole('unknown');
    expect((await get('recent', name)).status).toBe(403);
    setRole('admin');
    expect((await get('recent', 'x'.repeat(201))).status).toBe(400);
    expect((await get('suggestions', '  ')).status).toBe(400);
    expect((await get('invalid', name)).status).toBe(400);
    expect(postgrest).not.toHaveBeenCalled();
  });
});
