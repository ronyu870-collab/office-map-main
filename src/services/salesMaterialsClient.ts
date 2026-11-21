import type { MaterialAccess, MaterialList } from '@/src/lib/sales-materials/model';

import { createReadingContext,readingHeaders,type ReadingContext } from '@/src/utils/readingAuditContext';

export type SalesMaterialReader = {
  list: (buildingId: string, page: number, signal?: AbortSignal, context?:ReadingContext) => Promise<MaterialList>;
  access: (buildingId: string, materialId: string, signal?: AbortSignal, context?:ReadingContext) => Promise<MaterialAccess>;
};

async function readMaterial<T>(params: URLSearchParams, signal?: AbortSignal, context=createReadingContext()): Promise<T> {
  const [{ getSessionFast }, { withImpersonationHeaders }] = await Promise.all([
    import('@/src/services/Auth'), import('@/src/services/impersonationHeaders'),
  ]);
  const session = await getSessionFast();
  const token = session?.session?.access_token;
  if (!token) throw new Error('登录状态已失效，请重新登录');
  const response = await fetch(`/api/map/sales-materials?${params}`, {
    headers: withImpersonationHeaders({ Authorization: `Bearer ${token}`, ...readingHeaders(context) }), cache: 'no-store', signal,
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error || '销控资料读取失败');
  if(params.get('download')==='1'){const current=await getSessionFast();if(current?.session?.access_token!==token || current?.user?.id!==session.user?.id)throw new Error('登录状态已变化，请重试');}
  return result as T;
}
export async function loadBuildingPhoto(buildingId: string, photoIndex: number, signal: AbortSignal, download = false, context:ReadingContext=createReadingContext('map_gallery')): Promise<string> {
  const params = new URLSearchParams({ building_id: buildingId, cover: '1', photo: String(photoIndex) });
  if (download) params.set('download', '1');
  return (await readMaterial<{ url: string }>(params, signal,context)).url;
}

export const salesMaterialReader: SalesMaterialReader = {
  list: (buildingId, page, signal,context) => readMaterial(new URLSearchParams({ building_id: buildingId, page: String(page) }), signal,context),
  access: (buildingId, materialId, signal,context) => readMaterial(new URLSearchParams({ building_id: buildingId, material_id: materialId }), signal,context),
};

export async function downloadSalesMaterial(buildingId:string, materialId:string,context:ReadingContext):Promise<string>{
 return (await readMaterial<{url:string}>(new URLSearchParams({building_id:buildingId,material_id:materialId,download:'1'}),undefined,context)).url;
}
