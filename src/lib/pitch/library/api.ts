import { z } from 'zod';
import { assetInputSchema } from '../contracts/content';
import { uploadMetadataSchema, MAX_FILE } from './protocol';
const id = z.uuid(), short = z.string().trim().min(1).max(120);
export const libraryCommandSchema = z.discriminatedUnion('action', [
 z.strictObject({ action: z.literal('prepare'), requestId: id, filename: z.string().min(1).max(300), mime: z.string().max(150), size: z.number().int().positive().max(MAX_FILE), sha256: z.string().regex(/^[a-f0-9]{64}$/), metadata: uploadMetadataSchema, versionOf: id.optional() }),
 z.strictObject({ action: z.literal('finish'), jobId: id }),
 z.strictObject({ action: z.literal('step'), jobId: id }), z.strictObject({ action: z.literal('cancel'), jobId: id }), z.strictObject({ action: z.literal('retry'), jobId: id }),
 z.strictObject({ action: z.literal('save_asset'), assetId: id, expectedVersion: z.number().int().min(0), pageId: id.optional(), asset: assetInputSchema, acknowledgePartial: z.boolean().default(false) }),
 z.strictObject({ action: z.literal('confirm'), items: z.array(z.strictObject({ assetId: id, expectedVersion: z.number().int().positive() })).min(1).max(30), acknowledgePartial: z.boolean() }),
 z.strictObject({ action: z.literal('document_save'), documentId: id, expectedRevision: z.number().int().positive(), categoryId: id, tags: z.array(z.string().min(1).max(60)).max(30), state: z.enum(['draft','archived']).optional() }),
 z.strictObject({ action: z.literal('normalize'), projectId: id, assetId: id, title: z.string().trim().min(1).max(160), themeId: short, themeVersion: z.number().int().positive() }),
 z.strictObject({ action: z.literal('merge'), targetId: id, sourceIds: z.array(id).min(1).max(10).refine(v => new Set(v).size === v.length) }),
 z.strictObject({ action: z.literal('variant'), assetId: id, variantId: id, kind: z.enum(['regional','language']), scope: uploadMetadataSchema.shape.scope, language: z.string().regex(/^[a-z]{2}(?:-[A-Za-z0-9]+)*$/) }),
]);
export const libraryReadSchema = z.discriminatedUnion('action', [
 z.strictObject({ action: z.literal('search'), kind: z.enum(['documents','pages','assets','media']), q: short.optional(), before: id.optional(), documentId: id.optional(), region: short.optional(), city: short.optional(), line: short.optional(), mime: short.optional(), categoryId: id.optional(), state: z.enum(['draft','pending_review','published','archived']).optional(), tag: short.optional(), language: short.optional(), from: z.iso.date().optional(), until: z.iso.date().optional(), validity: z.enum(['valid','expired','all']).optional() }),
 z.strictObject({ action: z.literal('document'), documentId: id }), z.strictObject({ action: z.literal('versions'), documentId: id }), z.strictObject({ action: z.literal('page'), pageId: id }), z.strictObject({ action: z.literal('asset'), assetId: id, version: z.coerce.number().int().positive().optional() }),
 z.strictObject({ action: z.literal('status'), jobId: id }), z.strictObject({ action: z.literal('original'), documentId: id }),
 z.strictObject({ action: z.literal('thumbnail'), pageId: id.optional(), mediaId: id.optional(), version: z.coerce.number().int().positive().default(1) }).refine(v => !!v.pageId !== !!v.mediaId),
]);
export type LibraryCommand = z.infer<typeof libraryCommandSchema>;
