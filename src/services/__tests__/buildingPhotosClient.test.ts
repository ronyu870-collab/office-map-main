import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadStoredBuildingPhoto } from '../buildingPhotosClient';

const mocks = vi.hoisted(() => ({ session: vi.fn() }));
vi.mock('@/src/services/Auth', () => ({ getSessionFast: mocks.session }));
beforeEach(() => {
  mocks.session.mockResolvedValue({ session: { access_token: 'synthetic-token' } });
  sessionStorage.clear();
});
afterEach(() => { vi.unstubAllGlobals(); sessionStorage.clear(); });

describe('lazy building photo client', () => {
  it('forwards effective identity, credentials and cancellation to the protected endpoint', async () => {
    sessionStorage.setItem('__impersonation_state', JSON.stringify({ targetUserId: 'effective-viewer' }));
    const access = { url: 'https://images.example.com/photo.jpg', source_url: 'https://www.example.com/project', source_name: '官网' };
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify(access)));
    vi.stubGlobal('fetch', fetcher);
    const controller = new AbortController();
    expect(await loadStoredBuildingPhoto('building-id', 'photo-id', controller.signal)).toEqual(access);
    const [url, init] = fetcher.mock.calls[0];
    expect(url).toBe('/api/map/building-photos?building_id=building-id&photo_id=photo-id');
    expect(init.headers.get('Authorization')).toBe('Bearer synthetic-token');
    expect(init.headers.get('X-Colliers-Impersonate-User')).toBe('effective-viewer');
    expect(init.signal).toBe(controller.signal);
    expect(init.cache).toBe('no-store');
  });
  it('rejects an expired login before requesting an asset', async () => {
    mocks.session.mockResolvedValue(null);
    const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher);
    await expect(loadStoredBuildingPhoto('building', 'photo', new AbortController().signal)).rejects.toThrow('登录状态已失效');
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('surfaces a revoked photo error for the gallery retry state', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: '图片已撤回' }), { status: 404 })));
    await expect(loadStoredBuildingPhoto('building', 'photo', new AbortController().signal)).rejects.toThrow('图片已撤回');
  });
});
