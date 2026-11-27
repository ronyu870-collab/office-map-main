import { z } from 'zod';
import { documentResultSchema } from '../business/document-version';
import { dynamicParametersSchema } from '../business/protocol';
import { slideContentSchema, type SlideContent } from '../contracts/content';
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

export async function readBindings(ctx: PitchContext, projectId: string, version: number) {
  const result = await pitchRpc(ctx, { action: 'workspace_document_bindings', projectId, expectedVersion: version });
  const captures = new Map<string, Capture>();
  const receipts = new Map<string, QueryReceipt[]>();
  for (const row of z.array(z.union([captureSchema, queryReceiptSchema])).parse(result)) {
    const key = captureKey(row.asset_id, row.asset_version);
    if ('kind' in row) {
      const current = receipts.get(key);
      if (current) current.push(row);
      else receipts.set(key, [row]);
    } else {
      captures.set(key, row);
    }
  }
  return { captures, receipts };
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
