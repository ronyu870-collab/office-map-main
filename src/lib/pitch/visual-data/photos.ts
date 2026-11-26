import { z } from 'zod';
import { BUILDING_PHOTO_TABLE } from '@/src/lib/building-photos/model';
import { scheduleAuditBestEffort } from '@/src/lib/serverAudit';
import { visualBuildingIds } from '../contracts/visual-reference';
import type { PitchContext } from '../data/store';
import type { SceneMedia } from '../render/media';
import { authorizeVisualBuildings, recheckVisualBuildings } from './buildings';
import { photoSceneBytes, readPhotoFile } from './photo-file';
import { classifyBuildingPhoto, reusablePhotoLicense, selectBuildingPhotos, type PhotoCandidate } from './photo-selection';

import { assertVisualVersion, pinVisual, pinnedVisualInput, stableVisualId, visualSha256 } from './reference';

const select = 'id,building_id,storage_path,sha256,file_size,width,height,photo_kind,caption,sort_order,source_url,source_name,license_url,attribution_text,collected_at';
const photo = z.object({
  id: z.uuid(), building_id: z.uuid(), storage_path: z.string().nullable(), sha256: visualSha256.nullable(),
  file_size: z.number().nullable(), width: z.number().nullable(), height: z.number().nullable(),
  photo_kind: z.string(), caption: z.string().min(1), sort_order: z.number().int(), source_url: z.string(),
  source_name: z.string(), license_url: z.string().nullable(), attribution_text: z.string().nullable(), collected_at: z.iso.datetime({ offset: true }),
});
const MAX_CANDIDATES = 100;
const MAX_VERIFICATION_BYTES = 128 * 1024 * 1024;

const selectionSchema = z.strictObject({
  buildingIds: visualBuildingIds, use: z.enum(['cover', 'profile', 'comparison']),
  usedHashes: z.array(visualSha256).max(100).optional(),
});

function photoRowToCandidate(row: z.infer<typeof photo>, file: PhotoCandidate['file'], license: PhotoCandidate['license']): PhotoCandidate {
  return { id: row.id, buildingId: row.building_id, category: classifyBuildingPhoto(row.photo_kind, row.caption),
    sortOrder: row.sort_order, imageTitle: row.caption, collectedOn: row.collected_at.slice(0, 10), license, file };
}

function referenceFor(candidate: PhotoCandidate) {
  const { id, buildingId, imageTitle, collectedOn, license, category, file } = candidate;
  const reference = pinVisual({
    kind: 'photo', id: stableVisualId(['building-photo', id]), buildingIds: [buildingId], disclosure: 'internal',
    origin: { type: 'building-photo', buildingId, photoId: id }, contentHash: file.sha256,
    dimensions: { width: file.width, height: file.height }, businessDate: null, sourceDateBasis: 'catalog-recorded',
    rights: { scope: 'internal', holder: null, attribution: license.attribution, licenseName: license.name,
      sourceUrl: license.sourceUrl, licenseUrl: license.licenseUrl, cropAllowed: license.cropAllowed, clientDistribution: false, externalAi: false },
    source: { kind: 'record', recordId: id, label: `${license.attribution} · ${license.name}`.slice(0, 300),
      locator: `楼宇照片目录 · ${license.sourceName} · 采集日期，拍摄日期未知`.slice(0, 300), dataAsOf: collectedOn },
  }, [category, imageTitle, collectedOn, 'scene-photo/1']);
  return { ...reference, category, caption: imageTitle };
}

export type BuildingPhotoReference = ReturnType<typeof referenceFor>;

export async function getBuildingPhotoChoices(ctx: PitchContext, input: z.input<typeof selectionSchema>, coverBuildingId?: string) {
  const { buildingIds, use, usedHashes } = selectionSchema.parse(input);
  if (coverBuildingId !== undefined && !buildingIds.includes(coverBuildingId)) throw new Error('PITCH_VISUAL_SELECTION');
  const authorized = await authorizeVisualBuildings(ctx, { buildingIds });
  const { data, error } = await ctx.client.from(BUILDING_PHOTO_TABLE).select(select)
    .in('building_id', buildingIds).eq('status', 'ready').order('building_id').order('sort_order').order('id')
    .limit(MAX_CANDIDATES + 1).abortSignal(ctx.signal);
  if (error) throw new Error('PITCH_PHOTO_CATALOG_UNAVAILABLE');
  if ((data?.length ?? 0) > MAX_CANDIDATES) throw new Error('PITCH_VISUAL_SCOPE_TOO_LARGE');
  const allowedIds = new Set(buildingIds);
  const rows = (data ?? []).flatMap(row => {
    const parsed = photo.safeParse(row);
    return parsed.success && allowedIds.has(parsed.data.building_id) ? [parsed.data] : [];
  });
  const originalOwners = new Map<string, Set<string>>();
  for (const row of rows) if (row.sha256) {
    const owners = originalOwners.get(row.sha256) ?? new Set<string>();
    owners.add(row.building_id);
    originalOwners.set(row.sha256, owners);
  }
  const verified: PhotoCandidate[] = [];
  const eligible = rows.flatMap(row => {
    const license = reusablePhotoLicense(row);
    return license && row.storage_path && row.sha256 && originalOwners.get(row.sha256)?.size === 1 ? [{ row, license }] : [];
  });
  if (eligible.reduce((total, { row }) => total + (row.file_size ?? 0), 0) > MAX_VERIFICATION_BYTES) {
    throw new Error('PITCH_VISUAL_SCOPE_TOO_LARGE');
  }
  // Bound memory and storage concurrency for multi-building requests. Per-file failures do not suppress other choices.
  for (let offset = 0; offset < eligible.length; offset += 3) {
    const group = eligible.slice(offset, offset + 3);
    const files = await Promise.allSettled(group.map(({ row }) => readPhotoFile(ctx.client, row, ctx.signal)));
    ctx.signal.throwIfAborted();
    files.forEach((result, i) => {
      if (result.status !== 'fulfilled') return;
      const { width, height, mime, sha256, sharpness, needsOrientation } = result.value;
      verified.push(photoRowToCandidate(group[i].row, { width, height, mime, sha256, sharpness, needsOrientation }, group[i].license));
    });
  }
  const choices = selectBuildingPhotos(buildingIds, verified, use, usedHashes);
  const cover = coverBuildingId ? selectBuildingPhotos([coverBuildingId], verified, 'cover', usedHashes)[0] : undefined;
  await recheckVisualBuildings(ctx, authorized.authority);
  return choices.map(({ buildingId, primary, alternatives, placement }) => ({
    buildingId, primary: primary ? referenceFor(primary) : null, alternatives: alternatives.map(referenceFor), placement,
    ...(cover?.buildingId === buildingId && cover.primary && cover.placement
      ? { cover: { reference: referenceFor(cover.primary), placement: cover.placement } } : {}),
  }));
}

/** Read and reauthorize the exact source again for rendering. A stale reference never substitutes a newer photo. */
export async function loadBuildingPhotoMedia(ctx: PitchContext, ref: z.input<typeof pinnedVisualInput>) {
  const expected = pinnedVisualInput.parse(ref);
  if (expected.kind !== 'photo' || expected.origin.type !== 'building-photo') throw new Error('PITCH_INVALID');
  const { photoId: id, buildingId } = expected.origin;
  const authorized = await authorizeVisualBuildings(ctx, { buildingIds: [buildingId] });
  const { data, error } = await ctx.client.from(BUILDING_PHOTO_TABLE).select(select).eq('id', id)
    .eq('building_id', buildingId).eq('status', 'ready').abortSignal(ctx.signal).maybeSingle();
  if (error) throw new Error('PITCH_PHOTO_CATALOG_UNAVAILABLE');
  const row = photo.safeParse(data);
  if (!row.success || row.data.id !== id || row.data.building_id !== buildingId) throw new Error('PITCH_MEDIA_UNAVAILABLE');
  const license = reusablePhotoLicense(row.data);
  if (!license) throw new Error('QUERY_DENIED');
  const file = await readPhotoFile(ctx.client, row.data, ctx.signal);
  const candidate = photoRowToCandidate(row.data, file, license);
  const reference = referenceFor(candidate);
  assertVisualVersion(reference, expected);
  const media = await photoSceneBytes(file);
  await recheckVisualBuildings(ctx, authorized.authority);
  scheduleAuditBestEffort(ctx.client, { user_id: ctx.identity.actorId, action_type: 'BUILDING_PHOTO_ACCESS', target_table: BUILDING_PHOTO_TABLE,
    target_id: id, module: 'pitch', request_source: 'server', details: { entry: 'pitch', building_id: buildingId,
      photo_id: id, access_mode: 'view', source_sha256: reference.contentHash, phase: 'resource_access_issued',
      effective_user_id: ctx.identity.effectiveUserId, is_impersonating: false } }, 'pitch/building-photos');
  const sceneMedia: SceneMedia = { id: reference.id, version: reference.version, bytes: media.bytes, mime: media.mime,
    width: media.width, height: media.height };
  return { kind: 'photo' as const, reference, media: sceneMedia, mediaHash: media.sha256 };
}
