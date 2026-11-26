import type { PitchContext } from '../data/store';
import type { ProposalBrief } from '../integration-contracts';
import { proposalMapImage, proposalPhoto, proposalStackingImage } from '../proposals/authorized-data';
import type { Photo } from '../proposals/projection';
import type { ProposalMaterials, UnifiedProposalContext } from '../proposals/unified-projection';
import { readPitchLocation, readPitchStackingPlan } from './derived-assets';
import type { PhotoCategory } from './photo-selection';
import { getBuildingPhotoChoices } from './photos';
import type { PinnedVisualReference } from './reference';
import type { StackingSelection } from './stacking';

const proposalPhotoKinds: Record<PhotoCategory, Photo['kind']> = {
  exterior: 'exterior', lobby: 'lobby', interior: 'office', amenity: 'amenity',
  rendering: 'other', construction: 'other', other: 'other',
};

type PhotoPlacement = NonNullable<Awaited<ReturnType<typeof getBuildingPhotoChoices>>[number]['placement']>;

/** Consume the confirmed brief and resolved candidates. Return references for the composer and replay provider. */
export async function readProposalVisualMaterials(ctx: PitchContext, brief: ProposalBrief,
  context: Pick<UnifiedProposalContext, 'buildings'>, options: { targetBuildingId?: string; stacking?: StackingSelection } = {}) {
  if (brief.audience !== 'internal') throw new Error('QUERY_DENIED');
  const names = new Map(context.buildings.map(building => [building.buildingId, building.name]));
  const loaded = [...names.keys()];
  const selected = brief.buildingIds;
  const leasing = brief.scenario === 'leasing-agency';
  const promotion = brief.scenario === 'building-promotion';
  const market = brief.scenario === 'market-report';
  const comparison = leasing || brief.scenario === 'office-comparison' || brief.scenario === 'site-selection';
  const buildingIds = leasing && selected.length === 1 ? [...new Set([...selected, ...loaded])] : selected.length ? selected : loaded;
  if (buildingIds.some(id => !names.has(id)) || (options.targetBuildingId && !buildingIds.includes(options.targetBuildingId))) {
    throw new Error('PITCH_VISUAL_SELECTION');
  }
  const targetId = options.targetBuildingId ?? buildingIds[0];
  if (options.stacking && !targetId) throw new Error('PITCH_VISUAL_SELECTION');
  const targetName = names.get(targetId);
  const photoIds = comparison ? buildingIds : targetId && (promotion || market) ? [targetId] : [];
  const cover = promotion || leasing ? targetId : undefined;
  const [choices, targetMap, candidateMap, marketMap, stacking] = await Promise.all([
    photoIds.length ? getBuildingPhotoChoices(ctx, { buildingIds: photoIds, use: comparison ? 'comparison' : 'profile' }, cover) : [],
    targetId && (promotion || leasing) ? readPitchLocation(ctx, { buildingIds: [targetId] }, targetId) : null,
    comparison && buildingIds.length > 1 ? readPitchLocation(ctx, { buildingIds }, leasing ? targetId : options.targetBuildingId) : null,
    market ? readPitchLocation(ctx, { city: brief.city, submarkets: brief.submarkets }) : null,
    targetId && options.stacking ? readPitchStackingPlan(ctx, targetId, options.stacking) : null,
  ]);

  const visuals = new Map<string, PinnedVisualReference>();
  const buildingMedia: Record<string, NonNullable<ProposalMaterials['buildingMedia']>[string]> = {};
  const photoPlacements: Record<string, PhotoPlacement> = {};
  const coverPlacements: Record<string, PhotoPlacement> = {};
  for (const choice of choices) {
    const photos = new Map([...(choice.cover ? [choice.cover.reference] : []), ...(choice.primary ? [choice.primary] : []),
      ...choice.alternatives].map(photo => [photo.id, photo]));
    if (choice.primary && choice.placement) photoPlacements[choice.primary.id] = choice.placement;
    if (choice.cover) coverPlacements[choice.cover.reference.id] = choice.cover.placement;
    buildingMedia[choice.buildingId] = { photos: [...photos.values()].map(photo => {
      visuals.set(photo.id, photo);
      return proposalPhoto(photo, proposalPhotoKinds[photo.category], `${names.get(choice.buildingId)} · ${photo.caption}`);
    }) };
  }
  if (stacking) {
    visuals.set(stacking.reference.id, stacking.reference);
    buildingMedia[targetId] = { ...buildingMedia[targetId], stackingPlan: proposalStackingImage(stacking.reference,
      `${targetName}历史楼层分布`, stacking.reference.businessDate) };
  }
  function mapMaterial(map: typeof targetMap, alt: string) {
    if (!map) return undefined;
    visuals.set(map.reference.id, map.reference);
    return proposalMapImage(map.reference, alt);
  }
  const maps = {
    target: mapMaterial(targetMap, `${targetName}区位示意图`),
    candidates: mapMaterial(candidateMap, '候选楼宇区位示意图'),
    market: mapMaterial(marketMap, `${brief.city}楼宇分布示意图`),
  };
  const materials = { maps, buildingMedia, visuals: [...visuals.values()] } satisfies ProposalMaterials;
  return { ...materials, photoPlacements, coverPlacements };
}
