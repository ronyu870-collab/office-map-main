import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const fixture = vi.hoisted(() => ({ list: vi.fn() }));
vi.mock('ali-oss', () => ({
  default: class {
    options = { bucket: 'synthetic', region: 'oss-cn-hongkong' };
    list = fixture.list;
  },
}));
vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({ auth: { getUser: async () => ({ data: { user: { id: 'reader', email: 'reader@example.test' } }, error: null }) } }),
}));
import { GET } from '../route';

function request(marker?: string) {
  const params = new URLSearchParams({ action: 'get-list', prefix: '研究资料/' });
  if (marker) params.set('marker', marker);
  return new Request(`http://localhost/api/oss?${params}`, { headers: { authorization: 'Bearer synthetic' } });
}

beforeEach(() => {
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://example.supabase.co');
  vi.stubEnv('SUPABASE_SECRET_KEY', 'synthetic-secret');
  vi.stubEnv('NEW_OSS_AK', 'synthetic-key');
  vi.stubEnv('NEW_OSS_SK', 'synthetic-secret');
  fixture.list.mockReset().mockResolvedValue({
    objects: [{ name: '研究资料/甲.pdf', size: 1024 }],
    prefixes: ['研究资料/子目录/'],
    isTruncated: true,
    nextMarker: '研究资料/甲.pdf',
  });
});
afterEach(() => vi.unstubAllEnvs());

describe('OSS directory cursor', () => {
  it('preserves the next marker from the real SDK list response', async () => {
    const response = await GET(request());
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      status: 'success', truncated: true, nextMarker: '研究资料/甲.pdf',
    });
    expect(fixture.list).toHaveBeenCalledWith(expect.objectContaining({
      prefix: '研究资料/', delimiter: '/', 'max-keys': 1000,
    }), {});
  });

  it('passes a scoped continuation cursor and rejects cross-directory markers', async () => {
    const response = await GET(request('研究资料/甲.pdf'));
    expect(response.status).toBe(200);
    expect(fixture.list).toHaveBeenCalledWith(expect.objectContaining({ marker: '研究资料/甲.pdf' }), {});
    fixture.list.mockClear();
    const denied = await GET(request('其他目录/乙.pdf'));
    expect(denied.status).toBe(400);
    expect(fixture.list).not.toHaveBeenCalled();
  });
});
