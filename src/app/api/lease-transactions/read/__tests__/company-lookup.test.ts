import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';
import { GET } from '../route';

const identity = vi.hoisted(() => vi.fn());
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

beforeEach(() => {
  postgrest.mockClear();
  vi.stubGlobal('fetch', postgrest);
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://synthetic.invalid');
  vi.stubEnv('SUPABASE_SECRET_KEY', 'synthetic');
  setRole('admin');
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
