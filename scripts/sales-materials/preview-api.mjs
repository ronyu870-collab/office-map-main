import { z } from 'zod';
import { MATERIAL_PAGE_SIZE, materialProvenance } from '../../src/lib/sales-materials/model.ts';
import { getLocalMaterial, listLocalBuildings, listLocalMaterials, originalLocalFile } from './local-store.mjs';
const uuid = z.uuid();
const headers = { 'Cache-Control':'private, no-store', 'X-Content-Type-Options':'nosniff' };
const json = (body,status=200) => new Response(JSON.stringify(body), { status, headers:{...headers,'Content-Type':'application/json'} });

export async function readPreviewRequest(store, request) {
  const url = new URL(request.url);
  if (request.method !== 'GET') return json({error:'只读接口'},405);
  if (url.pathname === '/api/local/buildings') return json({ buildings:listLocalBuildings(store) });
  if (url.pathname !== '/api/local/sales-materials') return json({error:'Not found'},404);
  const buildingId = url.searchParams.get('building_id') || '';
  const materialId = url.searchParams.get('material_id');
  if (!uuid.safeParse(buildingId).success || (materialId !== null && !uuid.safeParse(materialId).success)) return json({error:'资料编号无效'},400);
  if (!listLocalBuildings(store).some(building=>building.id === buildingId)) return json({error:'楼宇不存在'},404);
  if (!materialId) {
    const raw = url.searchParams.get('page') || '0';
    if (!/^\d{1,5}$/.test(raw)) return json({error:'页码无效'},400);
    return json(listLocalMaterials(store,buildingId,Number(raw),MATERIAL_PAGE_SIZE));
  }
  const record = getLocalMaterial(store,buildingId,materialId);
  if (!record) return json({error:'资料不存在'},404);
  if (url.searchParams.has('original')) {
    try {
      const file = await originalLocalFile(store,buildingId,materialId);
      const download = url.searchParams.get('download') === '1';
      return new Response(file.bytes, { headers:{...headers,'Content-Type':file.row.mime_type,
        'Content-Disposition':`${download ? 'attachment' : 'inline'}; filename*=UTF-8''${encodeURIComponent(file.row.original_name)}` } });
    } catch { return json({error:'原件读取失败'},500); }
  }
  const base = `/api/local/sales-materials?${new URLSearchParams({building_id:buildingId,material_id:materialId,original:'1'})}`;
  return json({ preview_url:base,download_url:`${base}&download=1`,details:record.details,commission_policies:record.commission_policies,project_facts:record.project_facts,workbook_preview:record.workbook_preview,provenance:materialProvenance({...record,extraction:JSON.parse(record.extraction)}) });
}
