import { z } from 'zod';
import { documentResultSchema } from '../business/document-version';
import { dynamicParametersSchema } from '../business/protocol';
import { disclosureSchema, scopeSchema, slideContentSchema, type SlideContent } from '../contracts/content';
import { workspaceChartTypeSchema } from "./presentation-edits";
import { pitchRpc, type PitchContext } from '../data/store';

const captureSchema = z.object({
  asset_id: z.uuid(), asset_version: z.number().int().positive(), generation_id: z.uuid(),
  snapshot_index: z.number().int().nonnegative(), content_index: z.number().int().nonnegative(),
  binding: z.object({ domain: z.enum(['quarter', 'lease']), permissionRevision: z.string(), policyVersion: z.string() }),
  data_version: z.string(), data_as_of: z.iso.date(), parameters: dynamicParametersSchema,
  compares_quarters: z.boolean(), has_research: z.boolean(), content: slideContentSchema, results: z.array(documentResultSchema),
});
export type Capture = z.infer<typeof captureSchema>;
export type Block = SlideContent['blocks'][number];

const encode = (value: unknown) => JSON.stringify(value);
export const captureKey = (assetId: string, assetVersion: number) => assetId + ':' + assetVersion;

const queryReceiptSchema = z.object({
  kind: z.literal('query_receipt'), asset_id: z.uuid(), asset_version: z.number().int().positive(),
  generation_id: z.uuid(), source_id: z.uuid(), receipt_id: z.string(), result_id: z.uuid(), entity_id: z.string(),
  binding: z.object({
    domain: z.enum(['quarter', 'lease', 'business']), dataVersion: z.string(), dataAsOf: z.iso.date().nullable(),
    permissionRevision: z.string(), policyVersion: z.string(), disclosure: z.literal('internal'),
  }),
  query: z.object({
    operation: z.string(), parameters: z.record(z.string(), z.unknown()), scopeFingerprint: z.string(),
    registryVersion: z.string(), fields: z.array(z.string()),
  }),
});
type QueryReceipt = z.infer<typeof queryReceiptSchema>;

const sha256 = z.string().regex(/^[a-f0-9]{64}$/);
const materialIdentity = z.object({ version: z.number().int().positive(), sha256, scope: scopeSchema });
const documentPolicy = z.object({
  visibility: z.enum(['private', 'organization']), clientExportConfigured: z.boolean(), isTestData: z.boolean(),
});
const materialReceipt = z.object({
  kind: z.literal('material_receipt'), slideId: z.uuid(),
  asset: materialIdentity.extend({
    id: z.uuid(), dataAsOf: z.iso.date(),
    policy: documentPolicy.omit({ clientExportConfigured: true }).extend({
      disclosure: disclosureSchema, internalGeneration: z.boolean(), clientExport: z.boolean(), externalAi: z.boolean(),
    }),
  }),
  documents: z.array(materialIdentity.extend({
    source_id: z.uuid(), document_id: z.uuid(), page_id: z.uuid().nullable(), data_as_of: z.iso.date().nullable(),
    revision: z.number().int().positive(), policy: documentPolicy,
  })),
  media: z.array(materialIdentity.extend({
    id: z.uuid(), data_as_of: z.iso.date().nullable(), page_id: z.uuid(), document_id: z.uuid(),
    document_version: z.number().int().positive(), document_sha256: sha256, revision: z.number().int().positive(), policy: documentPolicy,
  })),
  visuals: z.array(z.object({
    source_id: z.uuid(), kind: z.enum(['photo', 'map', 'stacking-plan']), id: z.uuid(), version: z.number().int().positive(),
    version_hash: sha256, content_hash: sha256, building_ids: z.array(z.uuid()).min(1).max(1000),
    query: z.record(z.string(), z.unknown()), source_date: z.iso.date(),
    binding: z.object({ dataAsOf: z.iso.date().nullable(), permissionRevision: z.string(), policyVersion: z.string() }).nullable(),
  })),
}).transform(({ kind, slideId, asset, documents, media, visuals }) => ({
  kind, slideId, asset,
  documents: documents.map(({ source_id, document_id, page_id, data_as_of, revision, ...metadata }) => ({
    sourceId: source_id, documentId: document_id, pageId: page_id, dataAsOf: data_as_of, revision, ...metadata,
  })),
  media: media.map(({ data_as_of, page_id, document_id, document_version, document_sha256, revision, ...metadata }) => ({
    dataAsOf: data_as_of, pageId: page_id, documentId: document_id, documentVersion: document_version,
    documentSha256: document_sha256, documentRevision: revision, ...metadata,
  })),
  visuals: visuals.map(({ source_id, version_hash, content_hash, building_ids, source_date, binding, ...visual }) => ({
    ...visual, sourceId: source_id, versionHash: version_hash, sha256: content_hash, buildingIds: building_ids,
    sourceDate: source_date, dataAsOf: binding?.dataAsOf ?? null,
    ...(binding ? { permissionRevision: binding.permissionRevision, policyVersion: binding.policyVersion } : {}),
    fields: visual.kind === 'photo' ? ['photo'] : visual.kind === 'map' ? ['location_lat', 'location_lng'] : ['towers', 'levels'],
    policy: { scope: visual.kind === 'stacking-plan' ? 'admin-internal' as const : 'internal' as const,
      clientExport: false as const, externalAi: false as const, sourceRecheckRequired: true as const },
  })),
}));
type MaterialReceipt = z.infer<typeof materialReceipt>;

export async function readBindings(ctx: PitchContext, projectId: string, version: number, includeMaterialReceipts = false) {
  const result = await pitchRpc(ctx, { action: 'workspace_document_bindings', projectId, expectedVersion: version,
    includeQueryReceipts: true, ...(includeMaterialReceipts ? { includeMaterialReceipts } : {}) });
  const captures = new Map<string, Capture>();
  const receipts = new Map<string, QueryReceipt[]>();
  const materials = new Map<string, Omit<MaterialReceipt, 'kind' | 'slideId'>>();
  for (const row of z.array(z.union([captureSchema, queryReceiptSchema, materialReceipt])).parse(result)) {
    if ('kind' in row && row.kind === 'material_receipt') {
      materials.set(row.slideId, { asset: row.asset, documents: row.documents, media: row.media, visuals: row.visuals });
      continue;
    }
    const key = captureKey(row.asset_id, row.asset_version);
    if ('kind' in row) {
      const current = receipts.get(key);
      if (current) current.push(row);
      else receipts.set(key, [row]);
    } else {
      captures.set(key, row);
    }
  }
  return { captures, receipts, materials };
}

export function blockQueryReceipts(block: Block, receipts: readonly QueryReceipt[] = []) {
  return receipts.filter(receipt => block.sourceIds.includes(receipt.source_id));
}

export function fieldIndex(block: Block, original: SlideContent) {
  const serialized = encode(block);
  const exact = original.blocks.findIndex(value => encode(value) === serialized);
  if (exact >= 0 || block.kind !== 'chart' || !workspaceChartTypeSchema.safeParse(block.chartType).success) return exact;
  const matches = original.blocks.flatMap((value, index) => value.kind === 'chart' &&
    workspaceChartTypeSchema.safeParse(value.chartType).success &&
    encode({ ...value, chartType: block.chartType }) === serialized ? [index] : []);
  return matches.length === 1 ? matches[0] : -1;
}
export function usesBusinessEvidence(block: Block, original: SlideContent) {
  return block.sourceIds.some(id => original.sources.some(source => source.id === id));
}
