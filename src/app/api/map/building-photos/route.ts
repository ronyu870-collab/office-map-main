import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { resolveEffectiveRequestIdentity } from '@/src/lib/server/impersonationAuth';
import { writeAuditBestEffort } from '@/src/lib/serverAudit';
import { parseUserRole } from '@/src/types/auth';
import { BUILDING_PHOTO_BUCKET, BUILDING_PHOTO_TABLE, buildingPhotoDownloadUrl, isBuildingPhotoPath, publicPhotoUrl } from '@/src/lib/building-photos/model';
import { loadInlineBuildingPhoto, PHOTO_PREVIEW_TRANSFORM } from './inlinePreview';

export const dynamic = 'force-dynamic';
const UUID = z.uuid();
const PREVIEW_MIN_BYTES = 192 * 1024;
const privateCache = 'private, no-store, max-age=0';
const json = (body: unknown, status = 200) => NextResponse.json(body, {
  status, headers: { 'Cache-Control': privateCache },
});

/** Asset access uses the same effective identity and building scope as the map. */
export async function GET(request: Request): Promise<NextResponse> {
  try {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const secret = process.env.SUPABASE_SECRET_KEY;
    if (!url || !secret) return json({ error: '楼宇图片服务配置不完整' }, 503);
    const admin = createClient(url, secret, { auth: { autoRefreshToken: false, persistSession: false } });
    const resolved = await resolveEffectiveRequestIdentity(request, admin);
    if ('response' in resolved) {
      resolved.response.headers.set('Cache-Control', privateCache);
      return resolved.response;
    }
    const { identity } = resolved;
    if (!parseUserRole(identity.effectiveRole)) return json({ error: '无权查看楼宇图片' }, 403);

    const params = new URL(request.url).searchParams;
    const buildingId = params.get('building_id') || '';
    const photoId = params.get('photo_id') || '';
    if (!UUID.safeParse(buildingId).success || !UUID.safeParse(photoId).success) {
      return json({ error: '楼宇或图片编号无效' }, 400);
    }
    // Both scoped lookups are independent after identity verification. Do not sign until both pass.
    const [{ data: building, error: buildingError }, { data: photo, error }] = await Promise.all([
      admin.from('buildings').select('id,name')
        .eq('id', buildingId).eq('is_active', true).eq('tracking_scope', 'tracked').maybeSingle(),
      admin.from(BUILDING_PHOTO_TABLE)
        .select('id,caption,image_url,storage_path,file_size,sha256,source_url,source_name,attribution_text,license_url')
        .eq('building_id', buildingId).eq('id', photoId).eq('status', 'ready').maybeSingle(),
    ]);
    if (buildingError) return json({ error: '楼宇权限校验失败' }, 500);
    if (!building) return json({ error: '楼宇不存在或不在地图可见范围内' }, 404);
    if (error) return json({ error: '楼宇图片读取失败，请稍后重试' }, 500);
    if (!photo) return json({ error: '图片不存在或已撤回，请刷新地图' }, 404);

    const sourceUrl = publicPhotoUrl(photo.source_url, true);
    if (!sourceUrl) return json({ error: '图片来源信息无效，请联系管理员核对' }, 502);
    const licenseUrl = photo.license_url == null ? null : publicPhotoUrl(photo.license_url);
    if (photo.license_url != null && !licenseUrl) return json({ error: '图片许可信息无效，请联系管理员核对' }, 502);
    const download = params.get('download') === '1';
    const canDownload = photo.storage_path != null;
    if (download && !canDownload) return json({ error: '此照片仅支持打开原图' }, 409);
    const metadata = {
      can_download: canDownload, source_url: sourceUrl, source_name: String(photo.source_name || ''),
      attribution_text: photo.attribution_text ?? null, license_url: licenseUrl,
    };
    const audit = {
      user_id: identity.caller.email || identity.caller.id,
      action_type: 'BUILDING_PHOTO_ACCESS', module: 'map', page_url: '/map',
      target_name: building.name, request_source: 'server',
      details: {
        authority: 'server', building_id: buildingId, photo_id: photoId,
        access_mode: download ? 'download' : 'view',
        effective_user_id: identity.effectiveUserId, is_impersonating: identity.isImpersonating,
      },
    };
    let assetUrl: string | null;
    let isPreview = false;
    if (photo.storage_path != null) {
      if (!isBuildingPhotoPath(photo.storage_path, buildingId, photoId)) {
        return json({ error: '图片路径无效，请联系管理员核对' }, 502);
      }
      const usePreview = !download && params.get('preview') === '1' && process.env.BUILDING_PHOTO_PREVIEWS_ENABLED !== '0'
        && Number(photo.file_size) > PREVIEW_MIN_BYTES;
      const useInline = usePreview && request.headers.get('accept') === 'image/webp'
        && process.env.BUILDING_PHOTO_INLINE_PREVIEWS_ENABLED !== '0';
      if (useInline) {
        const preview = await loadInlineBuildingPhoto(url, secret, photo.storage_path, photo.sha256, metadata, request.signal);
        if (preview) {
          await writeAuditBestEffort(admin, audit, 'map/building-photos');
          return new NextResponse(preview.bytes, { headers: {
            'Content-Type': 'image/webp', 'Cache-Control': privateCache, 'X-Content-Type-Options': 'nosniff',
            'X-Building-Photo-Metadata': preview.metadataHeader, Vary: 'Accept',
          } });
        }
      }
      const bucket = admin.storage.from(BUILDING_PHOTO_BUCKET);
      let previewUrl: string | undefined;
      if (usePreview && !useInline) {
        const preview = await bucket.createSignedUrl(photo.storage_path, 300, { transform: PHOTO_PREVIEW_TRANSFORM });
        previewUrl = preview.data?.signedUrl;
      }
      if (previewUrl) {
        assetUrl = previewUrl;
        isPreview = true;
      } else {
        const signed = await bucket.createSignedUrl(photo.storage_path, 300);
        if (signed.error || !signed.data?.signedUrl) return json({ error: '图片暂时无法访问，请重试' }, 502);
        assetUrl = download
          ? buildingPhotoDownloadUrl(signed.data.signedUrl, building.name, photo.caption, photo.storage_path)
          : signed.data.signedUrl;
      }
    } else {
      assetUrl = publicPhotoUrl(photo.image_url);
    }
    if (!assetUrl) return json({ error: '图片链接无效，请联系管理员核对' }, 502);

    await writeAuditBestEffort(admin, audit, 'map/building-photos');
    return json({ url: assetUrl, is_preview: isPreview, ...metadata });
  } catch (error) {
    console.error('[map/building-photos] GET failed', error);
    return json({ error: '楼宇图片读取失败，请稍后重试' }, 500);
  }
}
