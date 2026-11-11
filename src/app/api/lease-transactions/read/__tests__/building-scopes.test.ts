import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { GET } from '../route';

const identity = vi.hoisted(() => vi.fn());
vi.mock('@/src/lib/server/impersonationAuth', () => ({ resolveEffectiveRequestIdentity: identity }));

const A = '06bc31a7-c21f-47a3-929a-280ef38e61cd';
const B = '769fb962-0709-4384-8a50-6cd9fb378c09';
const liveId = '9c525983-f217-4331-8dc4-580c8411c02e';
const records = [
  { read_id: 'a-live', record_source: 'live', source_record_id: liveId, building_id: A, building_match_scope: 'exact', related_building_ids: [A] },
  { read_id: 'a-history', record_source: 'history', source_record_id: liveId, building_id: A, building_match_scope: 'reference', related_building_ids: [A] },
  { read_id: 'b-live', record_source: 'live', source_record_id: B, building_id: B, building_match_scope: 'exact', related_building_ids: [B] },
  { read_id: 'both-history', record_source: 'history', source_record_id: A, building_id: null, building_match_scope: 'project', related_building_ids: [A, B] },
];
const fetchPostgrest = vi.fn(async (input: RequestInfo | URL) => {
  const params = new URL(String(input)).searchParams;
  // Apply the filters serialized by the real SDK to an isolated dataset.
  const filtered = records.filter((row) => Object.entries(row).every(([key, value]) => {
    const filter = params.get(key);
    if (!filter) return true;
    if (filter.startsWith('eq.')) return String(value) === filter.slice(3);
    if (filter.startsWith('in.(')) return filter.slice(4, -1).split(',').includes(String(value));
    if (filter.startsWith('cs.{')) return Array.isArray(value) && value.includes(filter.slice(4, -1));
    throw new Error(`Unexpected PostgREST filter: ${filter}`);
  }));
  const offset = Number(params.get('offset') ?? 0);
  const limit = Number(params.get('limit') ?? 100);
  return new Response(JSON.stringify(filtered.slice(offset, offset + limit)), {
    headers: { 'Content-Type': 'application/json', 'Content-Range': `0-0/${filtered.length}` },
  });
});

beforeEach(() => {
  fetchPostgrest.mockClear();
  vi.stubGlobal('fetch', fetchPostgrest);
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://synthetic.invalid');
  vi.stubEnv('SUPABASE_SECRET_KEY', 'synthetic');
  setRole('admin');
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

function setRole(effectiveRole: string, isImpersonating = false) {
  identity.mockResolvedValue({ identity: { effectiveRole, isImpersonating } });
}
const get = (search: string) => GET(new NextRequest(`https://synthetic.invalid/api/lease-transactions/read?${search}`));
async function read(search: string) {
  const response = await get(search);
  expect(response.status).toBe(200);
  return response.json();
}
const ids = (payload: { records: Array<{ read_id: string }> }) => payload.records.map((row) => row.read_id);

describe('楼宇成交读取范围', () => {
  it('resolves only the live source record, keeps sibling towers separate and preserves the map result', async () => {
    expect(ids(await read(`live_record_id=${liveId}`))).toEqual(['a-live']);
    expect(ids(await read(`building_id=${A}&building_scope=tower`))).toEqual(['a-live', 'a-history']);
    expect(ids(await read(`building_id=${B}&building_scope=tower`))).toEqual(['b-live']);
    expect(ids(await read(`building_id=${B}&building_scope=project`))).toEqual(['both-history']);
    expect(ids(await read(`building_id=${A}`))).toEqual(['a-live', 'a-history', 'both-history']);
    const secondPage = await read(`building_id=${A}&building_scope=tower&limit=1&offset=1&include_count=0`);
    expect(ids(secondPage)).toEqual(['a-history']);
    expect(secondPage.count).toBeNull();
  });

  it.each(['editor', 'viewer'])('does not disclose history or counts for effective role %s', async (role) => {
    setRole(role, true);
    const tower = await read(`building_id=${A}&building_scope=tower`);
    expect(tower.access).toMatchObject({ effectiveRole: role, canReadHistory: false, impersonating: true });
    expect(ids(tower)).toEqual(['a-live']);
    expect(tower.count).toBe(1);
    const project = await read(`building_id=${A}&building_scope=project`);
    expect(project.records).toEqual([]);
    expect(project.count).toBe(0);
    fetchPostgrest.mockClear();
    expect((await get(`building_id=${A}&building_scope=project&record_source=history`)).status).toBe(403);
    expect(fetchPostgrest).not.toHaveBeenCalled();
  });

  it('rejects invalid scopes and unauthorized roles before contacting PostgREST', async () => {
    expect((await get('live_record_id=untrusted')).status).toBe(400);
    expect((await get('building_scope=project')).status).toBe(400);
    expect((await get(`building_id=${A}&building_scope=unknown`)).status).toBe(400);
    setRole('unknown');
    expect((await get(`live_record_id=${liveId}`)).status).toBe(403);
    expect(fetchPostgrest).not.toHaveBeenCalled();
  });
});
