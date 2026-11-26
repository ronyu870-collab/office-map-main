import type { PitchContext } from '../data/store';
import type { ProposalAudience } from '../integration-contracts';
import { readPitchLocation, readPitchStackingPlan } from './derived-assets';
import { loadBuildingPhotoMedia } from './photos';
import { assertVisualVersion, pinnedVisualInput } from './reference';

/** Every replay goes back through the original permission and source-version checks. */
export async function resolvePitchVisualAsset(ctx: PitchContext, input: unknown, audience: ProposalAudience, options: { stackingImage?: boolean } = {}) {
  if (audience !== 'internal') throw new Error('QUERY_DENIED');
  const expected = pinnedVisualInput.parse(input);
  const { origin } = expected;
  if (origin.type === 'building-photo') return loadBuildingPhotoMedia(ctx, expected);
  const visual = origin.type === 'stacking-snapshot'
    ? await readPitchStackingPlan(ctx, origin.buildingId, origin.selection, options.stackingImage === true)
    : origin.type === 'market-locations'
      ? await readPitchLocation(ctx, { submarkets: origin.submarkets })
      : await readPitchLocation(ctx, { buildingIds: origin.buildingIds }, origin.targetId);
  if (!visual) throw new Error('PITCH_MEDIA_UNAVAILABLE');
  assertVisualVersion(visual.reference, expected);
  return visual;
}
