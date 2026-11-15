import type { BuildingPhotoAccess } from '@/src/lib/building-photos/model';

export async function loadStoredBuildingPhoto(buildingId: string, photoId: string, signal: AbortSignal, mode: 'preview' | 'original' | 'download' = 'preview'): Promise<BuildingPhotoAccess & { previewBlob?: Blob }> {
  const [{ getSessionFast }, { withImpersonationHeaders }] = await Promise.all([
    import('@/src/services/Auth'), import('@/src/services/impersonationHeaders'),
  ]);
  const session = await getSessionFast();
  const token = session?.session?.access_token;
  if (!token) throw new Error('登录状态已失效，请重新登录');
  const params = new URLSearchParams({ building_id: buildingId, photo_id: photoId });
  if (mode !== 'original') params.set(mode, '1');
  const response = await fetch(`/api/map/building-photos?${params}`, {
    headers: withImpersonationHeaders({
      Authorization: `Bearer ${token}`, ...(mode === 'preview' ? { Accept: 'image/webp' } : {}),
    }), cache: 'no-store', signal,
  });
  if (mode === 'preview' && response.ok && response.headers.get('content-type') === 'image/webp') {
    const encoded = response.headers.get('x-building-photo-metadata');
    if (!encoded) throw new Error('楼宇图片信息读取失败');
    const bytes = Uint8Array.from(atob(encoded.replace(/-/g, '+').replace(/_/g, '/')), ch => ch.charCodeAt(0));
    const metadata = JSON.parse(new TextDecoder().decode(bytes)) as Omit<BuildingPhotoAccess, 'url' | 'is_preview'>;
    return { ...metadata, url: '', is_preview: true, previewBlob: await response.blob() };
  }
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error || '楼宇图片读取失败');
  return result as BuildingPhotoAccess;
}
