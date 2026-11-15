import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextResponse } from 'next/server';
import { getLogBadgeStyle, parseAuditLog } from '@/src/utils/auditTranslator';
import * as route from '../route';

const mocks = vi.hoisted(() => ({
  identity: vi.fn(), audit: vi.fn(), from: vi.fn(), query: vi.fn(), sign: vi.fn(), bucket: vi.fn(),
  calls: [] as { table: string; op: string; args: unknown[] }[],
}));
vi.mock('@/src/lib/server/impersonationAuth', () => ({ resolveEffectiveRequestIdentity: mocks.identity }));
vi.mock('@/src/lib/serverAudit', () => ({ writeAuditBestEffort: mocks.audit }));
vi.mock('@supabase/supabase-js', () => ({ createClient: () => ({ from: mocks.from, storage: { from: mocks.bucket } }) }));
const buildingId = '11111111-1111-4111-8111-111111111111';
const photoId = '22222222-2222-4222-8222-222222222222';
const path = `building-photos/v1/${buildingId}/${photoId}/exterior.webp`;
const photo = { id: photoId, caption: '双塔外观', file_size: 2 * 1024 * 1024, storage_path: path, image_url: 'https://images.archdaily.com/photo.jpg', source_url: 'https://www.archdaily.com/project', source_name: 'ArchDaily' };
const identity = (role = 'viewer', impersonating = false) => ({
  caller: { id: 'caller', email: 'synthetic@invalid.test' }, callerRole: 'admin',
  effectiveRole: role, effectiveUserId: 'effective-viewer', isImpersonating: impersonating,
});
const request = (suffix = '', inline = false) => new Request(`https://synthetic.invalid/api/map/building-photos?building_id=${buildingId}&photo_id=${photoId}${suffix}`, {
  headers: inline ? { Accept: 'image/webp' } : undefined,
});
const webpHeader = new TextEncoder().encode('RIFF0000WEBP');

beforeEach(() => {
  vi.clearAllMocks(); mocks.calls.length = 0;
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://synthetic.invalid');
  vi.stubEnv('SUPABASE_SECRET_KEY', 'synthetic');
  vi.stubEnv('BUILDING_PHOTO_PREVIEWS_ENABLED', '1');
  vi.stubEnv('BUILDING_PHOTO_INLINE_PREVIEWS_ENABLED', '1');
  mocks.identity.mockResolvedValue({ identity: identity() });
  mocks.audit.mockResolvedValue(true);
  mocks.query.mockImplementation((table: string) => ({ data: table === 'buildings' ? { id: buildingId, name: '测试楼宇' } : photo, error: null }));
  mocks.from.mockImplementation((table: string) => {
    const chain: Record<string, unknown> = {};
    for (const op of ['select', 'eq']) chain[op] = (...args: unknown[]) => { mocks.calls.push({ table, op, args }); return chain; };
    chain.maybeSingle = () => mocks.query(table);
    return chain;
  });
  mocks.bucket.mockReturnValue({ createSignedUrl: mocks.sign });
  mocks.sign.mockResolvedValue({ data: { signedUrl: 'https://synthetic.invalid/signed' }, error: null });
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

describe('楼宇图片授权访问', () => {
  it.each(['viewer', 'editor', 'admin'])('allows %s to read only a ready photo of a visible building', async role => {
    mocks.identity.mockResolvedValue({ identity: identity(role) });
    const response = await route.GET(request('&path=other.jpg&url=https://evil.test/'));
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toContain('no-store');
    expect(await response.json()).toEqual({ url: 'https://synthetic.invalid/signed', source_url: photo.source_url, source_name: photo.source_name, can_download: true, is_preview: false, attribution_text: null, license_url: null });
    for (const [table, field, value] of [
      ['buildings', 'id', buildingId], ['buildings', 'is_active', true], ['buildings', 'tracking_scope', 'tracked'],
      ['building_photos', 'building_id', buildingId], ['building_photos', 'id', photoId], ['building_photos', 'status', 'ready'],
    ]) expect(mocks.calls).toContainEqual({ table, op: 'eq', args: [field, value] });
    expect(mocks.bucket).toHaveBeenCalledWith('building-sales-materials');
    expect(mocks.sign).toHaveBeenCalledExactlyOnceWith(path, 300);
  });
  it('starts both scoped lookups after auth without waiting for the building lookup, but signs only after both pass', async () => {
    let finishBuilding!: (row: unknown) => void;
    const buildingLookup = new Promise(resolve => { finishBuilding = resolve; });
    mocks.query.mockImplementation((table: string) => table === 'buildings' ? buildingLookup : { data: photo });
    const result = route.GET(request('&preview=1'));
    try {
      await vi.waitFor(() => expect(mocks.query).toHaveBeenCalledWith('building_photos'));
      expect(mocks.sign).not.toHaveBeenCalled();
    } finally {
      finishBuilding({ data: { id: buildingId, name: '测试楼宇' } });
    }
    expect((await result).status).toBe(200);
  });
  it('signs a bounded private preview for a large photo without issuing an original link', async () => {
    const response = await route.GET(request('&preview=1&width=5000'));
    expect(await response.json()).toMatchObject({ is_preview: true, can_download: true });
    expect(mocks.sign).toHaveBeenCalledExactlyOnceWith(path, 300, {
      transform: { width: 1120, height: 1120, resize: 'contain', quality: 74 },
    });
  });
  it('serves verified WebP and provenance in one private response without signing a view URL', async () => {
    const fetcher = vi.fn(async () => {
      expect(mocks.calls).toContainEqual({ table: 'building_photos', op: 'eq', args: ['status', 'ready'] });
      return new Response(webpHeader, { headers: { 'Content-Type': 'image/webp' } });
    });
    vi.stubGlobal('fetch', fetcher);
    const response = await route.GET(request('&preview=1', true));
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('image/webp');
    expect(response.headers.get('cache-control')).toContain('no-store');
    expect(response.headers.get('vary')).toBe('Accept');
    expect(JSON.parse(Buffer.from(response.headers.get('x-building-photo-metadata')!, 'base64url').toString()))
      .toMatchObject({ can_download: true, source_url: photo.source_url });
    expect(Array.from(new Uint8Array(await response.arrayBuffer()))).toEqual(Array.from(webpHeader));
    const [url, opts] = (fetcher.mock.calls as unknown as [URL, RequestInit][])[0];
    expect(url.pathname).toBe('/storage/v1/render/image/authenticated/building-sales-materials/' + path);
    expect(url.searchParams.get('width')).toBe('1120');
    expect(opts.redirect).toBe('error');
    expect(mocks.audit).toHaveBeenCalledOnce();
    expect(mocks.sign).not.toHaveBeenCalled();
  });
  it('falls back to the original without an extra transform when the private rendering path is unavailable or oversized', async () => {
    const size = 512 * 1024 + 1;
    const oversized = new ReadableStream({ start(stream) { stream.enqueue(new Uint8Array(size)); stream.close(); } });
    const fetcher = vi.fn()
      .mockResolvedValueOnce(new Response(oversized, { headers: { 'Content-Type': 'image/webp' } }))
      .mockResolvedValueOnce(new Response('not WebP', { status: 503 }));
    vi.stubGlobal('fetch', fetcher);
    for (let i = 0; i < 2; i++) {
      const response = await route.GET(request('&preview=1', true));
      expect(await response.json()).toMatchObject({ is_preview: false, url: 'https://synthetic.invalid/signed' });
    }
    expect(mocks.sign.mock.calls).toEqual([[path, 300], [path, 300]]);
  });
  it('reuses bytes for the same content hash while rechecking identity, scope, metadata and audit', async () => {
    let row = { ...photo, sha256: 'a'.repeat(64) };
    mocks.query.mockImplementation((table: string) => ({ data: table === 'buildings' ? { id: buildingId, name: '测试楼宇' } : row }));
    const fetcher = vi.fn(async () => new Response(webpHeader, { headers: { 'Content-Type': 'image/webp' } }));
    vi.stubGlobal('fetch', fetcher);
    expect((await route.GET(request('&preview=1', true))).status).toBe(200);
    row = { ...row, source_name: '更新来源' };
    const hit = await route.GET(request('&preview=1', true));
    expect(JSON.parse(Buffer.from(hit.headers.get('x-building-photo-metadata')!, 'base64url').toString()).source_name).toBe('更新来源');
    expect(fetcher).toHaveBeenCalledOnce();
    expect(mocks.identity).toHaveBeenCalledTimes(2);
    expect(mocks.query).toHaveBeenCalledTimes(4);
    expect(mocks.audit).toHaveBeenCalledTimes(2);
    mocks.query.mockImplementationOnce(() => ({ data: { id: buildingId } })).mockImplementationOnce(() => ({ data: null }));
    expect((await route.GET(request('&preview=1', true))).status).toBe(404);
    expect(fetcher).toHaveBeenCalledOnce();
    expect(mocks.audit).toHaveBeenCalledTimes(2);
    row = { ...row, sha256: 'b'.repeat(64) };
    expect((await route.GET(request('&preview=1', true))).status).toBe(200);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it('does not fetch private image bytes for an archived photo, wrong scope or a download', async () => {
    const fetcher = vi.fn();
    vi.stubGlobal('fetch', fetcher);
    mocks.query.mockImplementationOnce(() => ({ data: { id: buildingId } })).mockImplementationOnce(() => ({ data: null }));
    expect((await route.GET(request('&preview=1', true))).status).toBe(404);
    expect((await route.GET(request('&preview=1&download=1', true))).status).toBe(200);
    expect(fetcher).not.toHaveBeenCalled();
    expect(mocks.sign).toHaveBeenCalledExactlyOnceWith(path, 300);
  });
  it('uses the unmodified image for small originals and when transforms are disabled', async () => {
    mocks.query.mockImplementationOnce(() => ({ data: { id: buildingId, name: '测试楼宇' } }))
      .mockImplementationOnce(() => ({ data: { ...photo, file_size: 32_000 } }));
    expect(await (await route.GET(request('&preview=1'))).json()).toMatchObject({ is_preview: false });
    vi.stubEnv('BUILDING_PHOTO_PREVIEWS_ENABLED', '0');
    expect(await (await route.GET(request('&preview=1'))).json()).toMatchObject({ is_preview: false });
    expect(mocks.sign.mock.calls).toEqual([[path, 300], [path, 300]]);
  });
  it('uses an original link if storage refuses to sign a preview', async () => {
    mocks.sign.mockResolvedValueOnce({ data: null, error: { message: 'unavailable' } });
    expect(await (await route.GET(request('&preview=1'))).json()).toMatchObject({ is_preview: false, url: 'https://synthetic.invalid/signed' });
    expect(mocks.sign).toHaveBeenCalledTimes(2);
    expect(mocks.sign).toHaveBeenLastCalledWith(path, 300);
  });
  it('signs the selected original again and names the download using the verified building and caption', async () => {
    mocks.sign.mockResolvedValue({ data: { signedUrl: 'https://synthetic.invalid/signed?token=short-lived' }, error: null });
    const response = await route.GET(request('&download=1&preview=1&filename=wrong.png'));
    expect(response.status).toBe(200);
    const link = new URL((await response.json()).url);
    expect(link.searchParams.get('token')).toBe('short-lived');
    expect(link.searchParams.get('download')).toBe('测试楼宇 - 双塔外观.webp');
    expect(mocks.sign).toHaveBeenCalledExactlyOnceWith(path, 300);
    expect(mocks.audit.mock.calls[0][1].details.access_mode).toBe('download');
  });
  it('rejects anonymous or unknown effective roles before any database read', async () => {
    mocks.identity.mockResolvedValueOnce({ response: NextResponse.json({ error: 'login' }, { status: 401 }) });
    const anonymous = await route.GET(request('&download=1'));
    expect(anonymous.status).toBe(401);
    expect(anonymous.headers.get('cache-control')).toContain('no-store');
    mocks.identity.mockResolvedValue({ identity: identity('unknown', true) });
    expect((await route.GET(request())).status).toBe(403);
    expect(mocks.from).not.toHaveBeenCalled();
    expect(mocks.sign).not.toHaveBeenCalled();
  });
  it('retains real caller attribution and the effective identity during impersonation', async () => {
    mocks.identity.mockResolvedValue({ identity: identity('viewer', true) });
    await route.GET(request());
    const event = mocks.audit.mock.calls[0][1];
    expect(event).toMatchObject({ user_id: 'synthetic@invalid.test', action_type: 'BUILDING_PHOTO_ACCESS', details: { effective_user_id: 'effective-viewer', is_impersonating: true } });
    expect(parseAuditLog(event.action_type, event.details)).toBe('查看了楼宇图片');
    expect(getLogBadgeStyle(event.action_type).label).toBe('查看图片');
    expect(parseAuditLog('BUILDING_PHOTO_IMPORT', { photo_count: 50 })).toBe('导入了楼宇图片（50 张）');
    expect(getLogBadgeStyle('BUILDING_PHOTO_IMPORT').label).toBe('图片导入');
  });
  it('does not expose browser mutation handlers', () => {
    for (const method of ['POST', 'PATCH', 'DELETE']) expect(route).not.toHaveProperty(method);
  });
  it('rejects invalid ids before querying buildings', async () => {
    expect((await route.GET(new Request('https://synthetic.invalid/api/map/building-photos?building_id=bad&photo_id=bad'))).status).toBe(400);
    expect(mocks.from).not.toHaveBeenCalled();
  });
  it.each(['buildings', 'building_photos'])('does not sign when the scoped %s row is absent', async missing => {
    mocks.query.mockImplementation((table: string) => ({ data: table === missing ? null : { id: buildingId }, error: null }));
    expect((await route.GET(request('&download=1'))).status).toBe(404);
    expect(mocks.sign).not.toHaveBeenCalled();
    expect(mocks.audit).not.toHaveBeenCalled();
  });
  it.each([`building-photos/v1/${photoId}/${buildingId}/exterior.webp`, `${path}/../other.jpg`, 'pilot-media/v1/private.jpg', ''])('rejects a stored path outside the exact photo prefix: %s', async storage_path => {
    mocks.query.mockImplementation((table: string) => ({ data: table === 'buildings' ? { id: buildingId } : { ...photo, storage_path }, error: null }));
    expect((await route.GET(request())).status).toBe(502);
    expect(mocks.sign).not.toHaveBeenCalled();
  });
  it('returns a validated external link without fetching or signing it', async () => {
    mocks.query.mockImplementation((table: string) => ({ data: table === 'buildings' ? { id: buildingId } : { ...photo, storage_path: null }, error: null }));
    const body = await (await route.GET(request())).json();
    expect(body).toMatchObject({ url: photo.image_url, can_download: false });
    expect((await route.GET(request('&download=1'))).status).toBe(409);
    expect(body).not.toHaveProperty('storage_path');
    expect(mocks.sign).not.toHaveBeenCalled();
  });
  it.each(['http://images.archdaily.com/photo.jpg', 'javascript:alert(1)', 'https://127.0.0.1/photo.jpg', 'https://localhost/photo.jpg', 'https://admin:secret@www.archdaily.com/photo.jpg'])('refuses unsafe external image links: %s', async image_url => {
    mocks.query.mockImplementation((table: string) => ({ data: table === 'buildings' ? { id: buildingId } : { ...photo, storage_path: null, image_url }, error: null }));
    expect((await route.GET(request())).status).toBe(502);
    expect(mocks.audit).not.toHaveBeenCalled();
  });
  it('fails visibly for a broken source or a signing failure', async () => {
    mocks.sign.mockResolvedValue({ data: null, error: { message: 'offline' } });
    expect((await route.GET(request())).status).toBe(502);
    mocks.query.mockImplementation((table: string) => ({ data: table === 'buildings' ? { id: buildingId } : { ...photo, source_url: 'javascript:alert(1)' }, error: null }));
    expect((await route.GET(request())).status).toBe(502);
    expect(mocks.sign).toHaveBeenCalledTimes(1);
  });
  it('returns explicit photo attribution and an HTTPS license, and rejects unsafe license links', async () => {
    const attribution = { attribution_text: '摄影：N509FZ / CC BY-SA 4.0', license_url: 'https://creativecommons.org/licenses/by-sa/4.0/' };
    mocks.query.mockImplementation((table: string) => ({ data: table === 'buildings' ? { id: buildingId } : { ...photo, ...attribution }, error: null }));
    expect(await (await route.GET(request())).json()).toMatchObject(attribution);
    mocks.query.mockImplementation((table: string) => ({ data: table === 'buildings' ? { id: buildingId } : { ...photo, license_url: 'javascript:alert(1)' }, error: null }));
    expect((await route.GET(request())).status).toBe(502);
    expect(mocks.sign).toHaveBeenCalledTimes(1);
  });
});
