import type { SlideContent } from '../contracts/content';
import type { SlideScene } from '../contracts/scene';
import type { PitchContext } from '../data/store';
import type { ProposalAudience } from '../integration-contracts';
import { sceneMediaReferences, type SceneMedia } from '../render/media';
import { readPitchLocation, readPitchStackingPlan } from './derived-assets';
import { loadBuildingPhotoMedia } from './photos';
import { assertVisualVersion, pinnedVisualInput, stableVisualId, type PinnedVisualReference } from './reference';

/** Every replay goes back through the original permission and source-version checks. */
export async function resolvePitchVisualAsset(ctx: PitchContext, input: unknown, audience: ProposalAudience,
  options: { stackingImage?: boolean; recordPhotoAccess?: boolean } = {}) {
  if (audience !== 'internal') throw new Error('QUERY_DENIED');
  const expected = pinnedVisualInput.parse(input);
  const { origin } = expected;
  if (origin.type === 'building-photo') return loadBuildingPhotoMedia(ctx, expected, options.recordPhotoAccess);
  const visual = origin.type === 'stacking-snapshot'
    ? await readPitchStackingPlan(ctx, origin.buildingId, origin.selection, options.stackingImage === true)
    : origin.type === 'market-locations'
      ? await readPitchLocation(ctx, { submarkets: origin.submarkets, city: origin.city })
      : await readPitchLocation(ctx, { buildingIds: origin.buildingIds }, origin.targetId);
  if (!visual) throw new Error('PITCH_MEDIA_UNAVAILABLE');
  assertVisualVersion(visual.reference, expected);
  return visual;
}

/** Recheck every visual bound to the selected pages, including sources rendered
 * as native shapes. Return bytes only for images the scenes actually reference. */
export async function resolveReferencedVisualMedia(ctx: PitchContext, pins: readonly unknown[],
  images: readonly Pick<SceneMedia, 'id' | 'version'>[], audience: ProposalAudience) {
  if (pins.length > 200) throw new Error('PITCH_VISUAL_SCOPE_TOO_LARGE');
  const key = ({ id, version }: Pick<SceneMedia, 'id' | 'version'>) => `${id}:${version}`;
  const used = new Set(images.map(key));
  const selected = new Map<string, ReturnType<typeof pinnedVisualInput.parse>>();
  for (const pin of pins) {
    const reference = pinnedVisualInput.parse(pin);
    const identifier = key(reference);
    const previous = selected.get(identifier);
    if (previous && JSON.stringify(previous) !== JSON.stringify(reference)) throw new Error('PITCH_SOURCE_CHANGED');
    selected.set(identifier, reference);
  }
  const media: (SceneMedia & { reference: PinnedVisualReference })[] = [];
  for (const reference of selected.values()) {
    const needsImage = used.has(key(reference));
    const resolved = await resolvePitchVisualAsset(ctx, reference, audience, { stackingImage: needsImage, recordPhotoAccess: needsImage });
    if (!needsImage) continue;
    if (!resolved.media) throw new Error('PITCH_MEDIA_UNAVAILABLE');
    media.push({ ...resolved.media, reference: resolved.reference });
  }
  return media;
}

/** Read the immutable receipts from the selected persisted slides or export manifest. */
export function getVisualPageReceipts(pages: readonly Pick<SlideContent, 'sources'>[]) {
  return pages.flatMap(page => page.sources.flatMap(source => {
    if (!source.visual) return [];
    if (source.id !== stableVisualId(['source', source.visual.id])) throw new Error('PITCH_SOURCE_CHANGED');
    return [source.visual];
  }));
}

export async function resolveVisualPageMedia(ctx: PitchContext,
  pages: readonly { content: Pick<SlideContent, 'sources'>; scene: SlideScene }[], audience: ProposalAudience) {
  return resolveReferencedVisualMedia(ctx, getVisualPageReceipts(pages.map(page => page.content)),
    sceneMediaReferences(pages.map(page => page.scene)), audience);
}
