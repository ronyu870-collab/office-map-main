import { z } from 'zod';
import { sourceReferenceSchema } from '../contracts/content';
import type { VisualReferenceReceipt } from '../contracts/visual-reference';
import type { PitchContext } from '../data/store';
import type { SceneMedia } from '../render/media';
import { resolveReferencedVisualMedia, type ResolvedVisualMedia } from './resolve';
import { withAuditedStackingDelivery } from './stacking-delivery';

export const artifactVisualSourcesSchema = z.array(sourceReferenceSchema).default([]);

export function assertArtifactVisualSources(saved: readonly VisualReferenceReceipt[], rendered: readonly VisualReferenceReceipt[]) {
  const keys = (sources: readonly VisualReferenceReceipt[]) => [...new Set(sources.map(source => JSON.stringify(source)))].sort();
  if (JSON.stringify(keys(saved)) !== JSON.stringify(keys(rendered))) throw new Error('PITCH_SOURCE_CHANGED');
}

/** Never return bytes or a ready artifact before source checks and critical audit have completed. */
export async function prepareVisualDelivery<T>(ctx: PitchContext, pins: readonly VisualReferenceReceipt[],
  images: readonly Pick<SceneMedia, 'id' | 'version'>[], delivery: Parameters<typeof withAuditedStackingDelivery>[2],
  prepare: (media: ResolvedVisualMedia[]) => Promise<T>): Promise<T> {
  if (!pins.length) return prepare([]);
  const ordinary = pins.filter(pin => pin.kind !== 'stacking-plan' && pin.origin.type !== 'stacking-snapshot');
  const prepared: T[] = [];
  const response = await withAuditedStackingDelivery(ctx, pins, delivery, async () => {
    const media = await resolveReferencedVisualMedia(ctx, pins, images, delivery.audience);
    prepared.push(await prepare(media));
    await resolveReferencedVisualMedia(ctx, ordinary, [], delivery.audience);
    return new Response(null, { status: 204 });
  });
  if (!response.ok || !prepared.length) throw new Error('PITCH_SOURCE_AUDIT_UNAVAILABLE');
  return prepared[0];
}
