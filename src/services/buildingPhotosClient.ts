import type { BuildingPhotoAccess } from '@/src/lib/building-photos/model';

export async function loadStoredBuildingPhoto(buildingId: string, photoId: string, signal: AbortSignal): Promise<BuildingPhotoAccess> {
  const [{ getSessionFast }, { withImpersonationHeaders }] = await Promise.all([
    import('@/src/services/Auth'), import('@/src/services/impersonationHeaders'),
  ]);
  const session = await getSessionFast();
  const token = session?.session?.access_token;
  if (!token) throw new Error('登录状态已失效，请重新登录');
  const params = new URLSearchParams({ building_id: buildingId, photo_id: photoId });
  const response = await fetch(`/api/map/building-photos?${params}`, {
    headers: withImpersonationHeaders({ Authorization: `Bearer ${token}` }), cache: 'no-store', signal,
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error || '楼宇图片读取失败');
  return result as BuildingPhotoAccess;
}
