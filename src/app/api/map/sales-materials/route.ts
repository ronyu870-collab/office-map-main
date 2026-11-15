import { NextResponse } from 'next/server';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { resolveEffectiveRequestIdentity, type EffectiveRequestIdentity } from '@/src/lib/server/impersonationAuth';
import { writeAuditBestEffort } from '@/src/lib/serverAudit';
import { getBuildingMediaPilot, pilotMediaPath } from '@/src/lib/sales-materials/building-media-pilot';
import { buildingPhotoDownloadUrl } from '@/src/lib/building-photos/model';
import { parseUserRole, type UserRole } from '@/src/types/auth';
import { MATERIAL_PAGE_SIZE, SALES_MATERIAL_BUCKET, materialProvenance } from '@/src/lib/sales-materials/model';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;
const TABLE = 'building_sales_materials';
const PUBLIC_SELECT = 'id,title,document_date,source,notes,original_name,mime_type,file_size,created_at,series_key,scope_label,content_types,data_date,association_status,association_note,historical_context';
const UUID = z.uuid();

function json(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: { 'Cache-Control': 'private, no-store, max-age=0' } });
}

type Authorized = { response: NextResponse } | { admin: SupabaseClient; identity: EffectiveRequestIdentity; role: UserRole };
async function authorize(request: Request): Promise<Authorized> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const secret = process.env.SUPABASE_SECRET_KEY;
  if (!url || !secret) return { response: json({ error: '销控资料服务配置不完整' }, 503) };
  const admin = createClient(url, secret, { auth: { autoRefreshToken: false, persistSession: false } });
  const resolved = await resolveEffectiveRequestIdentity(request, admin);
  if ('response' in resolved) {
    resolved.response.headers.set('Cache-Control', 'private, no-store');
    return resolved;
  }
  const { identity } = resolved;
  const role = parseUserRole(identity.effectiveRole);
  if (!role) return { response: json({ error: '无权访问销控资料' }, 403) };
  return { admin, identity, role };
}

async function buildingScope(admin: SupabaseClient, buildingId: string): Promise<{ response: NextResponse } | { building: { id: string; name: string } }> {
  const { data, error } = await admin.from('buildings').select('id,name')
    .eq('id', buildingId).eq('is_active', true).eq('tracking_scope', 'tracked').maybeSingle();
  if (error) return { response: json({ error: '楼宇权限校验失败' }, 500) };
  if (!data) return { response: json({ error: '楼宇不存在或不在地图可见范围内' }, 404) };
  return { building: data };
}

function databaseError(error: { code?: string }, fallback: string) {
  if (['42P01', 'PGRST205', '42501'].includes(error.code || '')) {
    return json({ error: '销控资料尚未启用，请联系管理员完成配置' }, 503);
  }
  console.error('[map/sales-materials]', fallback, error);
  return json({ error: fallback }, 500);
}

async function audit(admin: SupabaseClient, identity: EffectiveRequestIdentity, action: 'ACCESS', buildingId: string, materialId: string, title?: string) {
  await writeAuditBestEffort(admin, {
    user_id: identity.caller.email || identity.caller.id,
    action_type: 'SALES_MATERIAL_ACCESS',
    module: 'map', page_url: '/map', target_name: title,
    request_source: 'server',
    details: { authority: 'server', building_id: buildingId, material_id: materialId },
  }, `map/sales-materials/${action.toLowerCase()}`);
}

export async function GET(request: Request): Promise<NextResponse> {
  try {
    const auth = await authorize(request);
    if ('response' in auth) return auth.response;
    const { admin, identity } = auth;
    const params = new URL(request.url).searchParams;
    const buildingId = params.get('building_id') || '';
    if (!UUID.safeParse(buildingId).success) return json({ error: '楼宇编号无效' }, 400);
    const scope = await buildingScope(admin, buildingId);
    if ('response' in scope) return scope.response;
    const pilot = getBuildingMediaPilot(buildingId);
    const cover = params.get('cover') === '1';
    const index = params.get('photo') ?? '0';
    const photo = cover && /^(0|[1-9][0-9]{0,2})$/.test(index) ? pilot?.photos[Number(index)] : undefined;
    if (cover && !photo) return json({ error: '没有这张项目图片' }, 404);
    const materialId = cover ? pilot?.materialId ?? null : params.get('material_id');
    if (materialId !== null) {
      if (!UUID.safeParse(materialId).success) return json({ error: '资料编号无效' }, 400);
      const { data: material, error } = await admin.from(TABLE).select('id,title,storage_path,original_location,original_name,details,commission_policies,project_facts,workbook_preview,created_at,source_sha256,extraction')
        .eq('building_id', buildingId).eq('id', materialId).eq('status', 'ready').maybeSingle();
      if (error) return databaseError(error, '销控资料读取失败');
      if (!material) return json({ error: '资料不存在或已撤回，请刷新列表' }, 404);
      if (photo) {
        if (material.original_location !== 'cloud' || !material.storage_path) {
          return json({ error: '暂无项目图片' }, 404);
        }
        const path = pilotMediaPath(buildingId, materialId, photo.file);
        const asset = await admin.storage.from(SALES_MATERIAL_BUCKET).createSignedUrl(path, 300);
        if (asset.error) return json({ error: '项目图片暂时无法访问，请重试' }, 502);
        return json({ url: params.get('download') === '1'
          ? buildingPhotoDownloadUrl(asset.data.signedUrl, scope.building.name, photo.caption, path)
          : asset.data.signedUrl });
      }
      let previewUrl: string | null = null;
      let downloadUrl: string | null = null;
      if (material.original_location !== 'local_archive') {
        if (!material.storage_path) return json({ error: '原件路径缺失，请联系管理员核对' }, 502);
        const bucket = admin.storage.from(SALES_MATERIAL_BUCKET);
        const [preview, download] = await Promise.all([
          bucket.createSignedUrl(material.storage_path, 300),
          bucket.createSignedUrl(material.storage_path, 300, { download: material.original_name }),
        ]);
        if (preview.error || download.error) return json({ error: '原文件暂时无法访问，请重试' }, 502);
        previewUrl = preview.data.signedUrl;
        downloadUrl = download.data.signedUrl;
      }
      await audit(admin, identity, 'ACCESS', buildingId, materialId, material.title);
      return json({
        preview_url: previewUrl, download_url: downloadUrl,
        details: material.details, commission_policies: material.commission_policies || [], project_facts: material.project_facts || [], workbook_preview: material.workbook_preview || undefined, provenance: materialProvenance(material),
      });
    }
    const pageRaw = params.get('page') ?? '0';
    if (!/^\d{1,5}$/.test(pageRaw)) return json({ error: '页码无效' }, 400);
    const page = Number(pageRaw);
    const { data, count, error } = await admin.from(TABLE).select(PUBLIC_SELECT, { count: 'exact' })
      .eq('building_id', buildingId).eq('status', 'ready')
      .order('created_at', { ascending: false }).order('id', { ascending: false })
      .range(page * MATERIAL_PAGE_SIZE, (page + 1) * MATERIAL_PAGE_SIZE - 1);
    if (error) return databaseError(error, '销控资料读取失败');
    return json({
      records: data || [],
      count: count ?? 0,
    });
  } catch (error) {
    console.error('[map/sales-materials] GET failed', error);
    return json({ error: '销控资料读取失败，请稍后重试' }, 500);
  }
}

