import { z } from 'zod';

export const PROTOCOL = 'colliers-pitch/1' as const;
export const lifecycleSchema = z.enum(['draft', 'pending_review', 'published', 'archived']);
export const disclosureSchema = z.enum(['internal', 'client_approved', 'restricted']);
export const localizedTextSchema = z.record(z.string().regex(/^[a-z]{2}(?:-[A-Za-z0-9]+)*$/), z.string().max(4000)).refine(v => Object.keys(v).length > 0);
export const scopeSchema = z.strictObject({ organizationId: z.string().min(1).max(100), region: z.string().min(1).max(100), city: z.string().min(1).max(100), businessLine: z.string().min(1).max(100) });
export type PitchScope = z.infer<typeof scopeSchema>;
export const sourceReferenceSchema = z.strictObject({
  id: z.uuid(), kind: z.enum(['document', 'record', 'synthetic']), label: z.string().min(1).max(300),
  documentId: z.uuid().optional(), pageId: z.uuid().optional(), recordId: z.string().max(200).optional(),
  locator: z.string().min(1).max(300), version: z.string().min(1).max(100), sha256: z.string().regex(/^[a-f0-9]{64}$/).optional(),
  dataAsOf: z.iso.date(),
}).refine(v => v.kind !== 'document' || Boolean(v.documentId), 'Document evidence requires documentId');
export type SourceReference = z.infer<typeof sourceReferenceSchema>;
const text = z.string().min(1).max(4000);
const refs = z.array(z.uuid()).min(1).max(30);
const evidence = { sourceIds: refs };
export const contentBlockSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('paragraph'), text, ...evidence }),
  z.strictObject({ kind: z.literal('metric'), label: text, value: z.number().finite().nullable(), unit: z.string().max(60), ...evidence }),
  z.strictObject({ kind: z.literal('image'), mediaAssetId: z.uuid(), mediaVersion: z.number().int().positive(), alt: text, ...evidence }),
  z.strictObject({ kind: z.literal('table'), columns: z.array(text).min(1).max(12), rows: z.array(z.array(z.union([z.string().max(4000), z.number().finite(), z.null()])).max(12)).max(200), ...evidence }),
  z.strictObject({ kind: z.literal('chart'), chartType: z.enum(['bar', 'line', 'scatter']), categories: z.array(text).max(200), series: z.array(z.strictObject({ name: text, values: z.array(z.number().finite().nullable()).max(200), unit: z.string().max(60) })).min(1).max(10), ...evidence }),
  z.strictObject({ kind: z.literal('map'), mapId: text, snapshotVersion: text, buildingIds: z.array(z.uuid()).max(100), ...evidence }),
  z.strictObject({ kind: z.literal('timeline'), entries: z.array(z.strictObject({ date: z.iso.date(), title: text, description: text })).min(1).max(50), ...evidence }),
  z.strictObject({ kind: z.literal('team'), members: z.array(z.strictObject({ name: text, title: text, biography: text, mediaAssetId: z.uuid().optional() })).min(1).max(30), ...evidence }),
  z.strictObject({ kind: z.literal('case'), title: text, challenge: text, approach: text, outcome: text, ...evidence }),
  z.strictObject({ kind: z.literal('insight'), claim: text, basis: text, limitations: z.array(text).min(1).max(10), ...evidence }),
]);
export const slideContentSchema = z.strictObject({
  protocol: z.literal(PROTOCOL), locale: z.string().regex(/^[a-z]{2}(?:-[A-Za-z0-9]+)*$/),
  title: z.string().min(1).max(160), subtitle: z.string().max(400).optional(),
  blocks: z.array(contentBlockSchema).min(1).max(50), sources: z.array(sourceReferenceSchema).min(1).max(100),
  dataAsOf: z.iso.date(), disclosure: disclosureSchema, isTestData: z.boolean(),
}).superRefine((v, ctx) => {
  const ids = new Set(v.sources.map(s => s.id));
  if (ids.size !== v.sources.length) ctx.addIssue({ code: 'custom', message: 'Duplicate evidence IDs' });
  if (!v.isTestData && v.sources.some(s => s.kind === 'synthetic')) ctx.addIssue({ code: 'custom', message: 'Synthetic evidence must be marked as test data' });
  for (const b of v.blocks) {
    if (b.sourceIds.some(id => !ids.has(id))) ctx.addIssue({ code: 'custom', message: 'Missing source reference' });
    if (b.kind === 'table' && b.rows.some(r => r.length !== b.columns.length)) ctx.addIssue({ code: 'custom', message: 'Table shape mismatch' });
    if (b.kind === 'chart' && b.series.some(s => s.values.length !== b.categories.length)) ctx.addIssue({ code: 'custom', message: 'Chart shape mismatch' });
  }
});
export type SlideContent = z.infer<typeof slideContentSchema>;
export const assetInputSchema = z.strictObject({
  scope: scopeSchema, categoryId: z.uuid(), tags: z.array(z.string().min(1).max(60)).max(30),
  names: localizedTextSchema, content: slideContentSchema,
  state: lifecycleSchema, visibility: z.enum(['private', 'organization']),
  allowInternalGeneration: z.boolean(), allowClientExport: z.boolean(), allowExternalAi: z.boolean(),
  validFrom: z.iso.date().nullable(), validUntil: z.iso.date().nullable(),
}).refine(v => !v.validFrom || !v.validUntil || v.validFrom <= v.validUntil, 'Invalid validity period')
  .refine(v => !v.allowClientExport || v.content.disclosure === 'client_approved', 'Client disclosure requires approval')
  .refine(v => !v.content.isTestData || !v.allowClientExport && !v.allowExternalAi, 'Test data cannot be sent to clients or AI');
export type ContentAssetInput = z.infer<typeof assetInputSchema>;
