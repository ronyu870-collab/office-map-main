import { NextRequest, NextResponse } from 'next/server';
import { createHash } from 'node:crypto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { IMPERSONATION_REQUEST_HEADER, resolveEffectiveRequestIdentity } from '@/src/lib/server/impersonationAuth';
import { createAdminSessionGuard } from '@/src/lib/intelligence/adminSession';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const HEADERS = { 'Cache-Control': 'private, no-store', Vary: 'Authorization, x-colliers-impersonate-user' };
const EVIDENCE_BUCKET = 'stacking-plan-evidence';
// Stay below Vercel Functions' 4.5 MB request and response payload cap.
const MAX_EVIDENCE_BYTES = 4 * 1024 * 1024;
const ORIGINAL_MIMES: Record<string, string> = {
  'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp',
  'application/pdf': 'pdf',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
};
type RouteContext = { params: Promise<{ buildingId: string }> };
type Authorized = { client: SupabaseClient; actorId: string; guard: () => Promise<void> };
type Failure = { response: NextResponse };
const reply = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: HEADERS });

async function authorize(request: NextRequest): Promise<Authorized | Failure> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY;
  if (!url || !key) return { response: reply({ error: 'Stacking Plan 尚未配置' }, 503) };
  const client = createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
  const identity = await resolveEffectiveRequestIdentity(request, client);
  if ('response' in identity) {
    identity.response.headers.set('Cache-Control', 'private, no-store');
    return identity;
  }
  // A genuine admin only: no editor, viewer, demo or impersonated session.
  if (identity.identity.callerRole !== 'admin' || identity.identity.effectiveRole !== 'admin'
      || identity.identity.isImpersonating || request.headers.has(IMPERSONATION_REQUEST_HEADER)) {
    return { response: reply({ error: '仅真实管理员可访问 Stacking Plan' }, 403) };
  }
  try {
    const guard = await createAdminSessionGuard(request, client);
    return { client, actorId: identity.identity.caller.id, guard };
  } catch {
    return { response: reply({ error: '管理员身份或会话无法通过校验' }, 403) };
  }
}

/** Transactional audit write: the service-only RPC updates the source draft and
 * appends before/after snapshots in stacking_plan_space_events atomically. */
async function writeAuditStackingSpace(client: SupabaseClient, input: {
  buildingId: string; spaceId: string; actorId: string; revision: number; patch: Record<string, unknown>;
}) {
  return client.rpc('stacking_plan_space_save', {
    p_building_id: input.buildingId, p_space_id: input.spaceId,
    p_actor: input.actorId, p_expected_revision: input.revision, p_patch: input.patch,
  });
}

/** Export is an explicit audited action; no export is authorized before this insert. */
async function writeAuditStackingExport(client: SupabaseClient, input: {
  buildingId: string; actorId: string; format: string;
}) {
  return client.from('stacking_plan_export_events').insert({
    building_id: input.buildingId, actor_id: input.actorId, export_format: input.format,
  });
}

async function findBuilding(client: SupabaseClient, id: string) {
  return client.from('buildings').select('id,name').eq('id', id).maybeSingle();
}
async function getId(context: RouteContext) {
  const { buildingId } = await context.params;
  return UUID.test(buildingId) ? buildingId : null;
}
function databaseUnavailable(error: unknown) {
  console.error('[stacking-plan] database operation failed', error);
  return reply({ error: '楼宇堆叠图读取或保存失败，请稍后重试' }, 503);
}

export async function GET(request: NextRequest, context: RouteContext) {
  try {
    const id = await getId(context);
    if (!id) return reply({ error: '无效的楼宇 ID' }, 400);
    const auth = await authorize(request);
    if ('response' in auth) return auth.response;
    const { client, guard } = auth;
    // Original bytes are never exposed by a public or signed Storage URL.
    const originalSourceId = new URL(request.url).searchParams.get('original');
    if (originalSourceId !== null) {
      if (!/^[a-zA-Z0-9_-]{2,100}$/.test(originalSourceId)) return reply({ error: '原件来源标识无效' }, 400);
      const { data: source, error: sourceError } = await client.from('stacking_plan_sources')
        .select('id,evidence_storage_path,evidence_filename,evidence_mime')
        .eq('building_id', id).eq('id', originalSourceId).maybeSingle();
      if (sourceError) return databaseUnavailable(sourceError);
      if (!source?.evidence_storage_path) return reply({ error: '尚未归档原始文件' }, 404);
      await guard();
      const { data: file, error: fileError } = await client.storage.from(EVIDENCE_BUCKET)
        .download(source.evidence_storage_path);
      if (fileError || !file) return databaseUnavailable(fileError ?? new Error('Missing original'));
      await guard();
      const extension = ORIGINAL_MIMES[source.evidence_mime as string] ?? 'bin';
      return new NextResponse(await file.arrayBuffer(), { headers: {
        ...HEADERS, 'Content-Type': 'application/octet-stream',
        'Content-Disposition': 'attachment; filename="stacking-original.' + extension + '"',
        'X-Content-Type-Options': 'nosniff',
      } });
    }
    const { data: building, error: buildingError } = await findBuilding(client, id);
    if (buildingError) return databaseUnavailable(buildingError);
    if (!building) return reply({ error: '楼宇不存在' }, 404);

    const [towerResult, sourceResult] = await Promise.all([
      client.from('stacking_plan_towers').select('id,building_id,code,display_name').eq('building_id', id).order('code'),
      client.from('stacking_plan_sources').select('id,building_id,title,source_as_of,as_of_kind,review_state,source_note,evidence_storage_path,evidence_filename,evidence_mime,evidence_size_bytes,evidence_sha256,evidence_uploaded_at').eq('building_id', id),
    ]);
    // Preview may run before the additive production evidence migration. Keep
    // existing source snapshots readable without claiming the original is archived.
    let sources = sourceResult.data ?? [];
    let sourceError = sourceResult.error;
    let evidenceStorageReady = true;
    if (sourceError?.code === '42703') {
      evidenceStorageReady = false;
      const legacy = await client.from('stacking_plan_sources')
        .select('id,building_id,title,source_as_of,as_of_kind,review_state,source_note').eq('building_id', id);
      sourceError = legacy.error;
      sources = (legacy.data ?? []).map(item => ({
        ...item, evidence_storage_path: null, evidence_filename: null,
        evidence_mime: null, evidence_size_bytes: null, evidence_sha256: null,
        evidence_uploaded_at: null,
      }));
    }
    if (towerResult.error || sourceError) return databaseUnavailable(towerResult.error ?? sourceError);
    const towers = towerResult.data ?? [];
    let floors: Record<string, unknown>[] = [];
    let spaces: Record<string, unknown>[] = [];
    if (towers.length) {
      const floorResult = await client.from('stacking_plan_floors')
        .select('id,tower_id,floor_code,level_order,floor_area_sqm,zone,use_type,source_id')
        .in('tower_id', towers.map(t => t.id)).order('level_order', { ascending: false }).limit(200);
      if (floorResult.error) return databaseUnavailable(floorResult.error);
      floors = floorResult.data ?? [];
      if (floors.length) {
        const spaceResult = await client.from('stacking_plan_spaces')
          .select('id,floor_id,unit_code,occupancy_status,tenant_name,area_sqm,lease_steps,notes,verification_status,source_id,revision')
          .in('floor_id', floors.map(f => f.id as string)).order('unit_code').limit(1000);
        if (spaceResult.error) return databaseUnavailable(spaceResult.error);
        spaces = spaceResult.data ?? [];
      }
    }
    await guard();
    return reply({ building, towers, floors, spaces, sources, evidence_storage_ready: evidenceStorageReady, basis: 'source_snapshot_unverified' });
  } catch (error) {
    return databaseUnavailable(error);
  }
}

export async function PATCH(request: NextRequest, context: RouteContext) {
  try {
    const id = await getId(context);
    if (!id) return reply({ error: '无效的楼宇 ID' }, 400);
    const auth = await authorize(request);
    if ('response' in auth) return auth.response;
    const input: unknown = await request.json().catch(() => null);
    if (!input || typeof input !== 'object' || Array.isArray(input)) return reply({ error: '保存内容不正确' }, 400);
    const body = input as Record<string, unknown>;
    if (typeof body.space_id !== 'string' || !UUID.test(body.space_id)
        || !Number.isSafeInteger(body.expected_revision) || Number(body.expected_revision) < 1
        || !body.patch || typeof body.patch !== 'object' || Array.isArray(body.patch)) {
      return reply({ error: '请选择正确的单元和版本' }, 400);
    }
    const patch = body.patch as Record<string, unknown>;
    const allowed = ['tenant_name','occupancy_status','area_sqm','notes'];
    if (!Object.keys(patch).length || Object.keys(patch).some(k => !allowed.includes(k))) {
      return reply({ error: '包含不允许修改的字段' }, 400);
    }
    if ('tenant_name' in patch && patch.tenant_name !== null &&
        (typeof patch.tenant_name !== 'string' || patch.tenant_name.length > 200)) return reply({ error: '租户名称过长' }, 400);
    if ('occupancy_status' in patch && !['occupied','vacant','other','unknown'].includes(String(patch.occupancy_status))) {
      return reply({ error: '无效的租赁状态' }, 400);
    }
    if ('notes' in patch && (typeof patch.notes !== 'string' || patch.notes.length > 4000)) {
      return reply({ error: '备注内容过长' }, 400);
    }
    if ('area_sqm' in patch && patch.area_sqm !== null &&
      (typeof patch.area_sqm !== 'number' || !Number.isFinite(patch.area_sqm) || patch.area_sqm <= 0 || patch.area_sqm > 1000000)) {
      return reply({ error: '无效的单元面积' }, 400);
    }
    const { client, actorId, guard } = auth;
    await guard();
    const { data, error } = await writeAuditStackingSpace(client, {
      buildingId: id, spaceId: body.space_id, actorId,
      revision: Number(body.expected_revision), patch,
    });
    if (error) {
      if (error.code === '40001') return reply({ error: '已有其他修改，请刷新后重试' }, 409);
      if (error.code === 'P0002') return reply({ error: '单元已不存在' }, 404);
      if (error.code === '22023' || error.code === '23514') return reply({ error: '提交的数据不符合要求' }, 400);
      if (error.code === '42501') return reply({ error: '管理员权限已失效' }, 403);
      return databaseUnavailable(error);
    }
    await guard();
    return reply({ space: data });
  } catch (error) {
    return databaseUnavailable(error);
  }
}

export async function POST(request: NextRequest, context: RouteContext) {
  try {
    const id = await getId(context);
    if (!id) return reply({ error: '无效的楼宇 ID' }, 400);
    const auth = await authorize(request);
    if ('response' in auth) return auth.response;
    const { client, actorId, guard } = auth;
    if ((request.headers.get('content-type') ?? '').toLowerCase().includes('multipart/form-data')) {
      const claimedLength = Number(request.headers.get('content-length') ?? 0);
      if (claimedLength > MAX_EVIDENCE_BYTES + 16384) return reply({ error: '原件不得超过 4 MB' }, 413);
      const form = await request.formData();
      const original = form.get('file');
      const sourceId = form.get('source_id');
      // Node/undici and jsdom expose different File constructors. Validate the
      // standard web File contract rather than comparing one global constructor.
      const fileLike = original !== null && typeof original !== 'string'
        && typeof original.name === 'string' && typeof original.type === 'string'
        && typeof original.size === 'number' && typeof original.arrayBuffer === 'function';
      if (typeof sourceId !== 'string' || !/^[a-zA-Z0-9_-]{2,100}$/.test(sourceId)
          || !fileLike) return reply({ error: '请选择有效来源与原始文件' }, 400);
      const ext = ORIGINAL_MIMES[original.type];
      if (!ext || original.size < 1 || original.size > MAX_EVIDENCE_BYTES)
        return reply({ error: '仅允许 4 MB 内的 PNG、JPG、WebP、PDF 或 XLSX 原件' }, 400);
      const buffer = Buffer.from(await original.arrayBuffer());
      // Detect the actual file signature; do not trust a caller-provided MIME.
      const signature = buffer.subarray(0, 8);
      const validMagic = original.type === 'image/png'
        ? signature.equals(Buffer.from([137,80,78,71,13,10,26,10]))
        : original.type === 'image/jpeg'
          ? signature[0] === 0xff && signature[1] === 0xd8 && signature[2] === 0xff
          : original.type === 'image/webp'
            ? buffer.toString('ascii',0,4) === 'RIFF' && buffer.toString('ascii',8,12) === 'WEBP'
            : original.type === 'application/pdf'
              ? buffer.toString('ascii',0,5) === '%PDF-'
              : signature[0] === 0x50 && signature[1] === 0x4b && signature[2] === 3 && signature[3] === 4;
      if (!validMagic) return reply({ error: '文件内容与声明格式不符' }, 400);
      const filename = original.name.split(/[\\/]/).pop()?.replace(/[\x00-\x1f\x7f]/g,'').slice(0,200) || 'original.' + ext;
      const sha256 = createHash('sha256').update(buffer).digest('hex');
      const path = id + '/' + sourceId + '/' + sha256 + '.' + ext;
      const { data: source, error: sourceError } = await client.from('stacking_plan_sources')
        .select('id,evidence_sha256,evidence_storage_path')
        .eq('building_id', id).eq('id', sourceId).maybeSingle();
      if (sourceError) return databaseUnavailable(sourceError);
      if (!source) return reply({ error: '来源不存在' }, 404);
      await guard();
      if (source.evidence_sha256 === sha256 && source.evidence_storage_path === path) {
        return reply({ ok: true, duplicate: true, sha256 });
      }

      const existingBucket = await client.storage.getBucket(EVIDENCE_BUCKET);
      if (!existingBucket.data) {
        const created = await client.storage.createBucket(EVIDENCE_BUCKET, {
          public: false, fileSizeLimit: MAX_EVIDENCE_BYTES, allowedMimeTypes: Object.keys(ORIGINAL_MIMES),
        });
        if (created.error) {
          // A concurrent admin may have created it; verify again without loosening access.
          const raced = await client.storage.getBucket(EVIDENCE_BUCKET);
          if (!raced.data) return databaseUnavailable(created.error);
        }
      }
      const bucket = await client.storage.getBucket(EVIDENCE_BUCKET);
      if (bucket.error || !bucket.data || bucket.data.public) {
        return reply({ error: '原件私有存储未配置或权限不安全' }, 503);
      }
      const uploaded = await client.storage.from(EVIDENCE_BUCKET)
        .upload(path, buffer, { contentType: original.type, cacheControl: '0', upsert: false });
      if (uploaded.error) {
        // A prior request may have uploaded the immutable object then lost its
        // metadata RPC response. Only resume if downloaded bytes match exactly.
        const existing = await client.storage.from(EVIDENCE_BUCKET).download(path);
        if (existing.error || !existing.data) return databaseUnavailable(uploaded.error);
        const previousBytes = Buffer.from(await existing.data.arrayBuffer());
        if (previousBytes.length !== buffer.length
            || createHash('sha256').update(previousBytes).digest('hex') !== sha256) {
          return reply({ error: '原件存储中存在不一致的同路径文件，请联系管理员' }, 409);
        }
      }
      await guard();
      const { data, error } = await client.rpc('stacking_plan_source_attach', {
        p_building_id: id, p_source_id: sourceId, p_actor: actorId,
        p_path: path, p_name: filename, p_mime: original.type,
        p_size: original.size, p_sha256: sha256,
      });
      if (error) {
        // Never delete an existing source file. This new content-addressed object
        // remains private for administrative recovery if metadata persistence fails.
        return databaseUnavailable(error);
      }
      await guard();
      return reply({ ok: true, source: data, sha256 });
    }
    const input: unknown = await request.json().catch(() => null);
    const body = input && typeof input === 'object' && !Array.isArray(input) ? input as Record<string, unknown> : {};
    if (body.action !== 'export' || !['xlsx','png','svg'].includes(String(body.format))) {
      return reply({ error: '无效的导出类型' }, 400);
    }
    const { data: building, error: buildingError } = await findBuilding(client, id);
    if (buildingError || !building) return reply({ error: '楼宇不存在或不可读取' }, 404);
    await guard();
    const { error } = await writeAuditStackingExport(client, {
      buildingId: id, actorId, format: String(body.format),
    });
    if (error) return databaseUnavailable(error);
    await guard();
    return reply({ ok: true });
  } catch (error) {
    return databaseUnavailable(error);
  }
}
