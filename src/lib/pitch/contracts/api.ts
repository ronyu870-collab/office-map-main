import { z } from 'zod';
import { assetInputSchema, localizedTextSchema, scopeSchema } from './content';
import { templateParametersSchema } from '../templates/registry';
export const pitchCommandSchema = z.discriminatedUnion('action', [
  z.strictObject({ action: z.literal('sample_create'), requestId: z.uuid(), scope: scopeSchema }),
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
  z.strictObject({ action: z.literal('download'), projectId: z.uuid(), exportId: z.uuid(), audience: z.enum(['internal', 'client']) }),
]);
export type PitchCommand = z.infer<typeof pitchCommandSchema>;
