import { z } from 'zod';
import { assetInputSchema, localizedTextSchema, scopeSchema } from './content';
import { templateParametersSchema } from '../templates/registry';
import { layoutIdSchema, variantSchema } from './scene';
const formatSchema = z.enum(['pptx', 'png', 'svg', 'xlsx']);
export const compositionPartSchema = z.strictObject({ assetId: z.uuid(), layoutId: layoutIdSchema, variant: variantSchema.default('standard') });
export const pitchCommandSchema = z.discriminatedUnion('action', [
  z.strictObject({ action: z.literal('sample_create'), requestId: z.uuid(), scope: scopeSchema, fixture: layoutIdSchema.optional(), language: z.enum(['zh', 'en']).optional() }),
  z.strictObject({ action: z.literal('project_compose'), projectId: z.uuid(), title: z.string().trim().min(1).max(160), parts: z.array(compositionPartSchema).min(1).max(12), themeId: z.string().min(1).max(100), themeVersion: z.number().int().positive() }),
  z.strictObject({ action: z.literal('preview'), projectId: z.uuid(), page: z.number().int().min(0).max(49), layoutId: layoutIdSchema.optional(), variant: variantSchema.optional(), themeId: z.string().max(100).optional(), themeVersion: z.number().int().positive().optional() }),
  z.strictObject({ action: z.literal('export_start'), projectId: z.uuid(), exportId: z.uuid(), audience: z.enum(['internal', 'client']), format: formatSchema, page: z.number().int().min(0).max(49).optional(), pages: z.array(z.number().int().min(0).max(49)).min(1).max(50).refine(v => new Set(v).size === v.length).optional() }),
  z.strictObject({ action: z.literal('asset_save'), assetId: z.uuid(), expectedVersion: z.number().int().min(0), asset: assetInputSchema }),
  z.strictObject({ action: z.literal('project_create'), projectId: z.uuid(), assetId: z.uuid(), title: z.string().trim().min(1).max(160),
    templateId: z.string().min(1).max(100), templateVersion: z.number().int().positive(), themeId: z.string().min(1).max(100), themeVersion: z.number().int().positive(), parameters: templateParametersSchema }),
  z.strictObject({ action: z.literal('project_theme_upgrade'), sourceProjectId: z.uuid(), projectId: z.uuid(), expectedVersion: z.number().int().positive(), themeId: z.string().min(1).max(100), themeVersion: z.number().int().positive() }),
  z.strictObject({ action: z.literal('export'), projectId: z.uuid(), audience: z.enum(['internal', 'client']) }),
  z.strictObject({ action: z.literal('category_save'), id: z.uuid(), expectedRevision: z.number().int().min(0), systemCode: z.string().regex(/^[a-z0-9-]+$/).max(100), names: localizedTextSchema, enabled: z.boolean() }),
]);
export const pitchReadSchema = z.discriminatedUnion('action', [
  z.strictObject({ action: z.literal('catalog') }),
  z.strictObject({ action: z.literal('list_projects'), before: z.uuid().optional() }),
  z.strictObject({ action: z.literal('list_assets'), before: z.uuid().optional() }),
  z.strictObject({ action: z.literal('get_project'), projectId: z.uuid() }),
  z.strictObject({ action: z.literal('export_status'), projectId: z.uuid(), exportId: z.uuid() }),
  z.strictObject({ action: z.literal('download'), projectId: z.uuid(), exportId: z.uuid(), audience: z.enum(['internal', 'client']) }),
]);
export type PitchCommand = z.infer<typeof pitchCommandSchema>;
