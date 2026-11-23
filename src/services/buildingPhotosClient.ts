import { createReadingContext, readingHeaders, type ReadingContext } from '@/src/utils/readingAuditContext';
import type { BuildingPhotoAccess } from '@/src/lib/building-photos/model';
export class BuildingPhotoReadError extends Error {
  constructor(message: string, public status: number) { super(message); }
}

export async function loadStoredBuildingPhoto(buildingId: string, photoId: string, signal: AbortSignal, mode: 'preview' | 'original' | 'download' = 'preview', context:ReadingContext=createReadingContext('map_gallery')): Promise<BuildingPhotoAccess & { previewBlob?: Blob }> {
  const [{ getSessionFast }, { withImpersonationHeaders, getImpersonationTargetUserId }] = await Promise.all([
    import('@/src/services/Auth'), import('@/src/services/impersonationHeaders'),
  ]);
  const session = await getSessionFast();
  const token = session?.session?.access_token;
  if (!token) throw new BuildingPhotoReadError('登录状态已失效，请重新登录', 401);
  const target = getImpersonationTargetUserId();
  const assertCurrentIdentity = async () => {
    const current = await getSessionFast();
    if (signal.aborted) throw new DOMException('请求已取消', 'AbortError');
    if (current?.session?.access_token !== token || current?.user?.id !== session.user?.id || getImpersonationTargetUserId() !== target) {
      throw new BuildingPhotoReadError('登录状态已变化，请重试', 401);
    }
  };
  const params = new URLSearchParams({ building_id: buildingId, photo_id: photoId });
  if (mode !== 'original') params.set(mode, '1');
  const response = await fetch(`/api/map/building-photos?${params}`, {
    headers: withImpersonationHeaders({
      Authorization: `Bearer ${token}`, ...readingHeaders(context), ...(mode === 'preview' ? { Accept: 'image/webp' } : {}),
    }), cache: 'no-store', signal,
  });
  if (mode === 'preview' && response.ok && response.headers.get('content-type') === 'image/webp') {
    const encoded = response.headers.get('x-building-photo-metadata');
    if (!encoded) throw new Error('楼宇图片信息读取失败');
    const bytes = Uint8Array.from(atob(encoded.replace(/-/g, '+').replace(/_/g, '/')), ch => ch.charCodeAt(0));
    const metadata = JSON.parse(new TextDecoder().decode(bytes)) as Omit<BuildingPhotoAccess, 'url' | 'is_preview'>;
    const previewBlob = await response.blob();
    await assertCurrentIdentity();
    return { ...metadata, url: '', is_preview: true, previewBlob };
  }
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new BuildingPhotoReadError(result.error || '楼宇图片读取失败', response.status);
  await assertCurrentIdentity();
  return result as BuildingPhotoAccess;
}
