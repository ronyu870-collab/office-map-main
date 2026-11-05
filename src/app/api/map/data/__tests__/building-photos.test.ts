import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';
import { GET } from '../route';

const mocks = vi.hoisted(() => ({ identity: vi.fn(), catalog: vi.fn(), from: vi.fn() }));
vi.mock('@/src/lib/server/impersonationAuth', () => ({ resolveEffectiveRequestIdentity: mocks.identity }));
vi.mock('@/src/lib/building-photos/catalog', () => ({ readBuildingPhotoCatalog: mocks.catalog }));
vi.mock('@supabase/supabase-js', () => ({ createClient: () => ({ from: mocks.from }) }));
const building = '11111111-1111-4111-8111-111111111111';
const photo = { id: '22222222-2222-4222-8222-222222222222', caption: '楼宇外观' };

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://synthetic.invalid');
  vi.stubEnv('SUPABASE_SECRET_KEY', 'synthetic');
  mocks.identity.mockResolvedValue({ identity: { effectiveRole: 'viewer' } });
  mocks.catalog.mockResolvedValue(new Map([[building, [photo]], ['invisible-building', [photo]]]));
  mocks.from.mockImplementation((table: string) => {
    const chain: Record<string, unknown> = {};
    for (const op of ['select', 'eq', 'or', 'order', 'limit']) chain[op] = () => chain;
    const data = table === 'building_display_overrides' ? [] : table === 'future_supplies'
      ? [{ id: 'future-row', building_id: building }, { id: 'unlinked-future-row', building_id: null }]
      : [{ id: building, name: '楼宇' }, { id: 'without-photos', name: '暂无图片' }];
    chain.then = (resolve: (value: unknown) => void) => Promise.resolve({ data, error: null }).then(resolve);
    return chain;
  });
});
afterEach(() => vi.unstubAllEnvs());

describe('photo summaries in authenticated map data', () => {
  it.each(['viewer', 'editor', 'admin'])('returns %s map summaries without URLs or leaking unreturned buildings', async role => {
    mocks.identity.mockResolvedValue({ identity: { effectiveRole: role } });
    const response = await GET(new NextRequest('https://synthetic.invalid/api/map/data?mode=map'));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.buildings.map((row: { photos: unknown }) => row.photos)).toEqual([[photo], []]);
    expect(JSON.stringify(body)).not.toMatch(/invisible-building|storage_path|image_url|source_url/);
  });
  it('attaches future supply photos through the canonical building_id', async () => {
    const body = await (await GET(new NextRequest('https://synthetic.invalid/api/map/data?mode=future'))).json();
    expect(body.future_supplies.map((row: { photos: unknown }) => row.photos)).toEqual([[photo], []]);
  });
  it('does not query photo summaries for an anonymous caller or an unknown role', async () => {
    mocks.identity.mockResolvedValueOnce({ response: NextResponse.json({}, { status: 401 }) });
    expect((await GET(new NextRequest('https://synthetic.invalid/api/map/data'))).status).toBe(401);
    mocks.identity.mockResolvedValue({ identity: { effectiveRole: 'unknown' } });
    expect((await GET(new NextRequest('https://synthetic.invalid/api/map/data'))).status).toBe(403);
    expect(mocks.catalog).not.toHaveBeenCalled();
  });
});
