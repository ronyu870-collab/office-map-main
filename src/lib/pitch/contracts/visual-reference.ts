import { z } from 'zod';

export const visualSha256 = z.string().regex(/^[a-f0-9]{64}$/);
export const visualBuildingIds = z.array(z.uuid()).min(1).max(20).refine(ids => new Set(ids).size === ids.length);
export const marketVisualSelectionSchema = z.strictObject({
  submarkets: z.array(z.string().trim().min(1).max(80)).max(8).optional(),
  city: z.string().trim().regex(/^[\p{L}\p{M}\p{N} ·-]{1,80}$/u).optional(),
}).refine(selection => Boolean(selection.city || selection.submarkets?.length));
export const stackingSelectionSchema = z.strictObject({
  towerIds: z.array(z.uuid()).min(1).max(2).optional(),
  levelRange: z.tuple([z.number().int().min(-200).max(300), z.number().int().min(-200).max(300)]).optional(),
}).refine(s => (!s.levelRange || s.levelRange[0] <= s.levelRange[1])
  && (!s.towerIds || s.towerIds.length === new Set(s.towerIds).size));

const originSchema = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('building-photo'), buildingId: z.uuid(), photoId: z.uuid() }),
  z.strictObject({ type: z.literal('building-locations'), buildingIds: visualBuildingIds, targetId: z.uuid().optional() }),
  marketVisualSelectionSchema.safeExtend({ type: z.literal('market-locations') }),
  z.strictObject({ type: z.literal('stacking-snapshot'), buildingId: z.uuid(), selection: stackingSelectionSchema }),
]);
export type VisualOrigin = z.infer<typeof originSchema>;

const receiptFields = {
  id: z.uuid(), kind: z.enum(['photo', 'map', 'stacking-plan']), buildingIds: z.array(z.uuid()).min(1).max(1000),
  version: z.number().int().positive(), versionHash: visualSha256, contentHash: visualSha256, origin: originSchema,
};
export const visualReferenceReceiptSchema = z.strictObject(receiptFields);
export const pinnedVisualInput = z.object(receiptFields);
export type VisualReferenceReceipt = z.infer<typeof visualReferenceReceiptSchema>;
