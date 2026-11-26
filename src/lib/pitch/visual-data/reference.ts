import { z } from 'zod';
import { sourceReferenceSchema } from '../contracts/content';
import type { VisualAssetReference } from '../integration-contracts';
import { marketVisualSelectionSchema } from './buildings';
import { contentHash } from './photo-file';
import { stackingSelectionSchema } from './stacking';

export const visualSha256 = z.string().regex(/^[a-f0-9]{64}$/);
const originSchema = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('building-photo'), buildingId: z.uuid(), photoId: z.uuid() }),
  z.strictObject({ type: z.literal('building-locations'), buildingIds: z.array(z.uuid()).min(1).max(20), targetId: z.uuid().optional() }),
  marketVisualSelectionSchema.safeExtend({ type: z.literal('market-locations') }),
  z.strictObject({ type: z.literal('stacking-snapshot'), buildingId: z.uuid(), selection: stackingSelectionSchema }),
]);
export type VisualOrigin = z.infer<typeof originSchema>;

/** Visual metadata extends the common reference. Persist it with the opaque reference to reopen it. */
export type PinnedVisualReference = VisualAssetReference & {
  origin: VisualOrigin;
  contentHash: string;
  dimensions: { width: number; height: number };
  businessDate: string | null;
  sourceDateBasis: 'source-data-as-of' | 'catalog-recorded' | 'catalog-observed';
  rights: {
    scope: 'internal' | 'admin-internal';
    holder: string | null;
    attribution: string;
    licenseName: string | null;
    sourceUrl: string | null;
    licenseUrl: string | null;
    cropAllowed: boolean;
    clientDistribution: false;
    externalAi: false;
  };
};

export function stableVisualId(key: unknown) {
  const hash = contentHash(JSON.stringify(['pitch-visual', key]));
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-8${hash.slice(13, 16)}-a${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
}

export function pinVisual(data: Omit<PinnedVisualReference, 'version' | 'versionHash' | 'source'> & {
  source: Omit<VisualAssetReference['source'], 'id' | 'version' | 'sha256'>;
}, revisions: unknown): PinnedVisualReference {
  // Catalog observation dates are receipts. A re-read on a later day leaves
  // unchanged bytes and source identity on the same immutable media version.
  const { source, ...details } = data;
  const sourceVersionFields = { kind: source.kind, recordId: source.recordId, label: source.label, locator: source.locator };
  const versionHash = contentHash(JSON.stringify([details, sourceVersionFields, revisions]));
  const version = 1 + Number.parseInt(versionHash.slice(0, 7), 16);
  return { ...details, version, versionHash, source: sourceReferenceSchema.parse({
    ...source, id: stableVisualId(['source', data.id]), sha256: data.contentHash, version: versionHash,
  }) };
}

export const pinnedVisualInput = z.object({
  id: z.uuid(), kind: z.enum(['photo', 'map', 'stacking-plan']), buildingIds: z.array(z.uuid()).min(1).max(1000),
  version: z.number().int().positive(), versionHash: visualSha256, contentHash: visualSha256, origin: originSchema,
});

export function assertVisualVersion(current: PinnedVisualReference, expected: z.infer<typeof pinnedVisualInput>) {
  if (current.id !== expected.id || current.kind !== expected.kind || current.version !== expected.version
      || current.versionHash !== expected.versionHash || current.contentHash !== expected.contentHash
      || JSON.stringify(current.buildingIds) !== JSON.stringify(expected.buildingIds)) throw new Error('PITCH_SOURCE_CHANGED');
}
