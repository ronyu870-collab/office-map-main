import { sourceReferenceSchema } from '../contracts/content';
import { pinnedVisualInput, type VisualOrigin, type VisualReferenceReceipt } from '../contracts/visual-reference';
import type { VisualAssetReference } from '../integration-contracts';
import { contentHash } from './photo-file';
export { pinnedVisualInput, visualSha256 } from '../contracts/visual-reference';
export type { VisualOrigin } from '../contracts/visual-reference';

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
  source: Omit<VisualAssetReference['source'], 'id' | 'version' | 'sha256' | 'visual'>;
}, revisions: unknown): PinnedVisualReference {
  // Catalog observation dates are receipts. A re-read on a later day leaves
  // unchanged bytes and source identity on the same immutable media version.
  const { source, ...details } = data;
  const sourceVersionFields = { kind: source.kind, recordId: source.recordId, label: source.label, locator: source.locator };
  const versionHash = contentHash(JSON.stringify([details, sourceVersionFields, revisions]));
  const version = 1 + Number.parseInt(versionHash.slice(0, 7), 16);
  const visual = pinnedVisualInput.parse({ ...details, version, versionHash });
  return { ...details, version, versionHash, source: sourceReferenceSchema.parse({
    ...source, id: stableVisualId(['source', data.id]), sha256: data.contentHash, version: versionHash, visual,
  }) };
}

export function assertVisualVersion(current: PinnedVisualReference, expected: VisualReferenceReceipt) {
  if (current.id !== expected.id || current.kind !== expected.kind || current.version !== expected.version
      || current.versionHash !== expected.versionHash || current.contentHash !== expected.contentHash
      || JSON.stringify(current.buildingIds) !== JSON.stringify(expected.buildingIds)) throw new Error('PITCH_SOURCE_CHANGED');
}
