import { z } from 'zod';
import { loadBusinessSnapshot } from '@/src/lib/intelligence/business/research';
import { readStackingSnapshot } from '@/src/lib/stacking-plan/readSnapshot';
import { stackingSelectionSchema } from '../contracts/visual-reference';
import type { PitchContext } from '../data/store';
import type { SceneMedia } from '../render/media';
import { authorizeVisualBuildings, marketVisualSelection, recheckVisualBuildings, type VisualBuildingSelection } from './buildings';
import { createLocationSchematic, locationSchematicSvg } from './location';
import { contentHash } from './photo-file';
import { pinVisual, stableVisualId, type PinnedVisualReference } from './reference';
import { createStackingVisual, stackingVisualSvg, type StackingSelection } from './stacking';

async function rasterizeSvg(svg: string, width = 2560) {
  if (Buffer.byteLength(svg) > 16 * 1024 * 1024) throw new Error('PITCH_VISUAL_LIMIT');
  const { renderAsync } = await import('@resvg/resvg-js');
  const raster = await renderAsync(svg, { fitTo: { mode: 'width', value: width }, font: { loadSystemFonts: false } });
  const bytes = raster.asPng();
  if (bytes.byteLength > 8 * 1024 * 1024) throw new Error('PITCH_VISUAL_LIMIT');
  return { bytes, width: raster.width, height: raster.height };
}

function sceneMedia(reference: PinnedVisualReference, raster: Awaited<ReturnType<typeof rasterizeSvg>>): SceneMedia {
  return { id: reference.id, version: reference.version, mime: 'image/png', ...raster };
}

/** Authorized current catalog coordinates. Historical market periods do not date this location asset. */
export async function readPitchLocation(ctx: PitchContext, selection: VisualBuildingSelection, targetId?: string) {
  const market = 'buildingIds' in selection ? null : marketVisualSelection(selection);
  if (targetId !== undefined) z.uuid().parse(targetId);
  if (market && targetId) throw new Error('PITCH_LOCATION_SELECTION');
  const authorized = await authorizeVisualBuildings(ctx, selection);
  const scene = authorized.buildings.length ? createLocationSchematic(authorized.buildings, targetId, Boolean(market)) : null;
  if (!scene) {
    await recheckVisualBuildings(ctx, authorized.authority);
    return null;
  }
  const origin = 'buildingIds' in selection ? { type: 'building-locations' as const, buildingIds: selection.buildingIds, targetId }
    : { type: 'market-locations' as const, ...market };
  if (market?.city) scene.title = `${market.city}子市场项目分布`;
  const id = stableVisualId(origin);
  const raster = await rasterizeSvg(await locationSchematicSvg(scene));
  const reference = pinVisual({
    id, kind: 'map', buildingIds: scene.markers.map(marker => marker.building.id), disclosure: 'internal',
    origin, contentHash: contentHash(raster.bytes), dimensions: { width: raster.width, height: raster.height },
    businessDate: null, sourceDateBasis: 'catalog-observed',
    rights: { scope: 'internal', holder: null, attribution: scene.source, licenseName: null, sourceUrl: null,
      licenseUrl: null, cropAllowed: false, clientDistribution: false, externalAi: false },
    source: { kind: 'record', recordId: id, label: scene.source,
      locator: '现有楼宇目录点位 · 目录观察日期 · 无底图', dataAsOf: authorized.observedOn },
  }, ['coordinate-schematic/1', scene.markers.map(({ building }) => building)]);
  await recheckVisualBuildings(ctx, authorized.authority);
  return { kind: 'map' as const, reference, scene, media: sceneMedia(reference, raster), mediaHash: reference.contentHash };
}

/** History stays restricted even when the caller has ordinary Pitch and building catalogue access. */
export async function readPitchStackingPlan(ctx: PitchContext, rawBuildingId: string, rawSelection: StackingSelection, renderFallback = false) {
  const buildingId = z.uuid().parse(rawBuildingId);
  const selection = stackingSelectionSchema.parse(rawSelection);
  const check = async () => {
    const [admin, access] = await Promise.all([
      ctx.client.rpc('ai_admin_session_authority', { p_actor: ctx.identity.actorId, p_session: ctx.identity.sessionId }).abortSignal(ctx.signal),
      loadBusinessSnapshot(ctx.client, ctx.identity, ctx.signal, { tool: 'query_stacking_plan', buildingIds: [buildingId] }),
    ]);
    if (admin.error || admin.data !== true || !access.export || ctx.identity.expiresAt <= Date.now()) throw new Error('QUERY_DENIED');
    return access.permission_revision;
  };
  const authorized = await authorizeVisualBuildings(ctx, { buildingIds: [buildingId] });
  const first = await check();
  const building = authorized.buildings[0];
  const snapshot = await readStackingSnapshot(ctx.client, buildingId, ctx.signal);
  const visual = createStackingVisual({ id: building.id, name: building.name }, snapshot, selection);
  const raster = visual && renderFallback ? await rasterizeSvg(await stackingVisualSvg(visual), visual.dimensions.width) : null;
  const [current] = await Promise.all([check(), recheckVisualBuildings(ctx, authorized.authority)]);
  if (current !== first) throw new Error('QUERY_DENIED');
  if (!visual) return null;
  const { structured: document } = visual;
  const origin = { type: 'stacking-snapshot' as const, buildingId, selection: {
    towerIds: document.towers.map(tower => tower.id), levelRange: selection.levelRange,
  } };
  const id = stableVisualId(origin);
  const reference = pinVisual({
    id, kind: 'stacking-plan', buildingIds: [buildingId], disclosure: 'restricted', origin,
    contentHash: contentHash(JSON.stringify(document)), dimensions: visual.dimensions, businessDate: document.businessDate,
    sourceDateBasis: document.businessDate ? 'source-data-as-of' : 'catalog-observed',
    rights: { scope: 'admin-internal', holder: null, attribution: 'Stacking Plan · 历史来源快照', licenseName: null,
      sourceUrl: null, licenseUrl: null, cropAllowed: false, clientDistribution: false, externalAi: false },
    source: { kind: 'record', recordId: document.sources.length === 1 ? document.sources[0].id : buildingId,
      label: 'Stacking Plan · 历史来源快照', locator: document.businessDate ? '已确认的来源数据日期，单元核验状态单列' : '目录观察日期，来源日期见各条记录',
      dataAsOf: document.businessDate ?? authorized.observedOn },
  }, 'stacking-plan/1');
  return { kind: 'stacking-plan' as const, reference, document, media: raster ? sceneMedia(reference, raster) : null, mediaHash: raster ? contentHash(raster.bytes) : null };
}
