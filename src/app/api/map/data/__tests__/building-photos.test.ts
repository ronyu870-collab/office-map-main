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
    for (const op of ['select', 'eq', 'or', 'order', 'limit', 'in']) chain[op] = () => chain;
    const data = table === 'building_display_overrides' ? [] : table === 'future_supplies'
      ? [
        { id: 'future-row', building_id: building },
        { id: 'unlinked-future-row', building_id: null },
        { id: 'pending-future-row', building_id: building, status: 'pending' },
        { id: 'entered-future-row', building_id: building, status: 'pending', is_entered_market: true },
      ]
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
    expect(body.future_supplies).toEqual([
      expect.objectContaining({ id: 'future-row', photos: [photo] }),
      expect.objectContaining({ id: 'unlinked-future-row', photos: [] }),
    ]);
  });
  it('restricts future photo reads to visible canonical building IDs', async () => {
    await GET(new NextRequest('https://synthetic.invalid/api/map/data?mode=future'));
    expect(mocks.catalog).toHaveBeenCalledWith(expect.anything(), [building]);
  });
  it('includes pending supplies with their photos only when the map opts in', async () => {
    const response = await GET(new NextRequest('https://synthetic.invalid/api/map/data?mode=future&include_pending=1'));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.future_supplies).toEqual([
      expect.objectContaining({ id: 'future-row', photos: [photo] }),
      expect.objectContaining({ id: 'unlinked-future-row', photos: [] }),
      expect.objectContaining({ id: 'pending-future-row', status: 'pending', photos: [photo] }),
    ]);
  });
  it('never returns supplies that already entered the market, even when pending rows are requested', async () => {
    const body = await (await GET(new NextRequest('https://synthetic.invalid/api/map/data?mode=future&include_pending=1'))).json();
    expect(body.future_supplies.map((row: { id: string }) => row.id)).not.toContain('entered-future-row');
  });
  it('does not query photo summaries for an anonymous caller or an unknown role', async () => {
    mocks.identity.mockResolvedValueOnce({ response: NextResponse.json({}, { status: 401 }) });
    expect((await GET(new NextRequest('https://synthetic.invalid/api/map/data'))).status).toBe(401);
    mocks.identity.mockResolvedValue({ identity: { effectiveRole: 'unknown' } });
    expect((await GET(new NextRequest('https://synthetic.invalid/api/map/data'))).status).toBe(403);
    expect(mocks.catalog).not.toHaveBeenCalled();
  });
});
