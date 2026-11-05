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
const photo = { id: photoId, storage_path: path, image_url: 'https://images.archdaily.com/photo.jpg', source_url: 'https://www.archdaily.com/project', source_name: 'ArchDaily' };
const identity = (role = 'viewer', impersonating = false) => ({
  caller: { id: 'caller', email: 'synthetic@invalid.test' }, callerRole: 'admin',
  effectiveRole: role, effectiveUserId: 'effective-viewer', isImpersonating: impersonating,
});
const request = (suffix = '') => new Request(`https://synthetic.invalid/api/map/building-photos?building_id=${buildingId}&photo_id=${photoId}${suffix}`);

beforeEach(() => {
  vi.clearAllMocks(); mocks.calls.length = 0;
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://synthetic.invalid');
  vi.stubEnv('SUPABASE_SECRET_KEY', 'synthetic');
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
afterEach(() => vi.unstubAllEnvs());

describe('楼宇图片授权访问', () => {
  it.each(['viewer', 'editor', 'admin'])('allows %s to read only a ready photo of a visible building', async role => {
    mocks.identity.mockResolvedValue({ identity: identity(role) });
    const response = await route.GET(request('&path=other.jpg&url=https://evil.test/'));
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toContain('no-store');
    expect(await response.json()).toEqual({ url: 'https://synthetic.invalid/signed', source_url: photo.source_url, source_name: photo.source_name, attribution_text: null, license_url: null });
    for (const [table, field, value] of [
      ['buildings', 'id', buildingId], ['buildings', 'is_active', true], ['buildings', 'tracking_scope', 'tracked'],
      ['building_photos', 'building_id', buildingId], ['building_photos', 'id', photoId], ['building_photos', 'status', 'ready'],
    ]) expect(mocks.calls).toContainEqual({ table, op: 'eq', args: [field, value] });
    expect(mocks.bucket).toHaveBeenCalledWith('building-sales-materials');
    expect(mocks.sign).toHaveBeenCalledExactlyOnceWith(path, 300);
  });
  it('rejects anonymous or unknown effective roles before any database read', async () => {
    mocks.identity.mockResolvedValueOnce({ response: NextResponse.json({ error: 'login' }, { status: 401 }) });
    const anonymous = await route.GET(request());
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
    expect((await route.GET(request())).status).toBe(404);
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
    expect(body.url).toBe(photo.image_url);
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
