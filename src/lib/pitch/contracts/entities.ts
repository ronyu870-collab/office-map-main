import { z } from 'zod';
import { lifecycleSchema, localizedTextSchema, scopeSchema, slideContentSchema } from './content';

/** Version 1 domain DTOs. Snake-case database rows are mapped at data adapters;
 * callers must not use transport rows as an unversioned content protocol. */
export const fileReferenceSchema = z.strictObject({ bucket: z.literal('pitch-studio-private'), path: z.string().regex(/^[\w/-]+\.[a-z0-9]+$/).refine(p => !p.includes('..')), sha256: z.string().regex(/^[a-f0-9]{64}$/), mime: z.string().min(1).max(150), size: z.number().int().positive().max(24 * 1024 * 1024) });
export type FileReference = z.infer<typeof fileReferenceSchema>;
export const entityMetadataSchema = z.strictObject({ id: z.uuid(), createdBy: z.uuid(), updatedBy: z.uuid(), scope: scopeSchema, state: lifecycleSchema, version: z.number().int().positive(), createdAt: z.iso.datetime(), updatedAt: z.iso.datetime() });
export type EntityMetadata = z.infer<typeof entityMetadataSchema>;
export const sourceDocumentSchema = entityMetadataSchema.extend({ file: fileReferenceSchema, filename: z.string().min(1).max(300), language: z.string().min(2).max(30), dataAsOf: z.iso.date(), isTestData: z.boolean(), visibility: z.enum(['private', 'organization']) });
export type SourceDocument = z.infer<typeof sourceDocumentSchema>;
export const sourcePageSchema = z.strictObject({ id: z.uuid(), documentId: z.uuid(), ordinal: z.number().int().positive(), locator: z.string().min(1).max(300), extractedText: z.string().max(4_000_000), parserVersion: z.string().min(1).max(100) });
export type SourcePage = z.infer<typeof sourcePageSchema>;
export const mediaAssetSchema = entityMetadataSchema.extend({ file: fileReferenceSchema, sourcePageId: z.uuid(), alt: z.string().min(1).max(4000) });
export type MediaAsset = z.infer<typeof mediaAssetSchema>;
export const contentAssetSchema = entityMetadataSchema.extend({ content: slideContentSchema, categoryId: z.uuid(), names: localizedTextSchema, tags: z.array(z.string().min(1).max(60)).max(30), visibility: z.enum(['private', 'organization']), allowInternalGeneration: z.boolean(), allowClientExport: z.boolean(), allowExternalAi: z.boolean(), validFrom: z.iso.date().nullable(), validUntil: z.iso.date().nullable() });
export type ContentAsset = z.infer<typeof contentAssetSchema>;
export const pitchProjectSchema = entityMetadataSchema.extend({ title: z.string().min(1).max(160), parentProjectId: z.uuid().nullable(), themeId: z.string().min(1).max(100), themeVersion: z.number().int().positive(), isTestData: z.boolean() });
export type PitchProject = z.infer<typeof pitchProjectSchema>;
export const pitchSlideSchema = z.strictObject({ id: z.uuid(), projectId: z.uuid(), position: z.number().int().positive(), version: z.number().int().positive(), assetId: z.uuid(), assetVersion: z.number().int().positive(), templateId: z.string().min(1).max(100), templateVersion: z.number().int().positive(), layoutId: z.string().min(1).max(100), layoutVersion: z.number().int().positive(), themeId: z.string().min(1).max(100), themeVersion: z.number().int().positive(), content: slideContentSchema });
export type PitchSlide = z.infer<typeof pitchSlideSchema>;
export const jobStateSchema = z.enum(['queued', 'running', 'succeeded', 'failed']);
export const generationJobSchema = z.strictObject({ id: z.uuid(), projectId: z.uuid(), kind: z.enum(['parse', 'generate', 'export']), state: jobStateSchema, errorCode: z.string().max(100).nullable(), createdBy: z.uuid(), createdAt: z.iso.datetime() });
export type GenerationJob = z.infer<typeof generationJobSchema>;
export const exportArtifactSchema = z.strictObject({ id: z.uuid(), projectId: z.uuid(), jobId: z.uuid(), audience: z.enum(['internal', 'client']), file: fileReferenceSchema, slideVersions: z.array(z.strictObject({ id: z.uuid(), version: z.number().int().positive() })).min(1).max(50), createdBy: z.uuid(), createdAt: z.iso.datetime() });
export type ExportArtifact = z.infer<typeof exportArtifactSchema>;
