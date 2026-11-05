import type { MaterialAccess, MaterialList } from '@/src/lib/sales-materials/model';

export type SalesMaterialReader = {
  list: (buildingId: string, page: number, signal?: AbortSignal) => Promise<MaterialList>;
  access: (buildingId: string, materialId: string, signal?: AbortSignal) => Promise<MaterialAccess>;
};

async function readMaterial<T>(params: URLSearchParams, signal?: AbortSignal): Promise<T> {
  const [{ getSessionFast }, { withImpersonationHeaders }] = await Promise.all([
    import('@/src/services/Auth'), import('@/src/services/impersonationHeaders'),
  ]);
  const session = await getSessionFast();
  const token = session?.session?.access_token;
  if (!token) throw new Error('登录状态已失效，请重新登录');
  const response = await fetch(`/api/map/sales-materials?${params}`, {
    headers: withImpersonationHeaders({ Authorization: `Bearer ${token}` }), cache: 'no-store', signal,
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error || '销控资料读取失败');
  return result as T;
}
export async function loadBuildingPhoto(buildingId: string, photoIndex: number, signal: AbortSignal): Promise<string> {
  return (await readMaterial<{ url: string }>(new URLSearchParams({ building_id: buildingId, cover: '1', photo: String(photoIndex) }), signal)).url;
}

export const salesMaterialReader: SalesMaterialReader = {
  list: (buildingId, page, signal) => readMaterial(new URLSearchParams({ building_id: buildingId, page: String(page) }), signal),
  access: (buildingId, materialId, signal) => readMaterial(new URLSearchParams({ building_id: buildingId, material_id: materialId }), signal),
};
