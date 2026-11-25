import { z } from 'zod';
import { PROTOCOL } from './content';
export const layoutIds = ['cover', 'section-divider', 'image-text', 'two-columns', 'kpi', 'team-profile', 'case-study', 'data-table', 'chart-insight', 'comparison', 'map-analysis', 'strategy-framework'] as const;
export const layoutIdSchema = z.enum(layoutIds);
export type LayoutId = z.infer<typeof layoutIdSchema>;
export const variantSchema = z.enum(['standard', 'alternate']);
const box = { x: z.number().min(0).max(13.334), y: z.number().min(0).max(7.5), w: z.number().positive().max(13.334), h: z.number().positive().max(7.5) };
const cell = z.union([z.string().max(4000), z.number().finite(), z.null()]);
const elementSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('text'), ...box, text: z.string().min(1).max(6000), role: z.enum(['title', 'body']), bold: z.boolean(), purpose: z.enum(['content', 'source', 'footer']).optional() }),
  z.strictObject({ kind: z.literal('image'), ...box, mediaAssetId: z.uuid(), mediaVersion: z.number().int().positive(), alt: z.string().max(4000), fit: z.literal('contain').optional() }),
  z.strictObject({ kind: z.literal('brand'), ...box, resource: z.literal('colliers-brand-assets/1') }),
  z.strictObject({ kind: z.literal('shape'), ...box, shape: z.enum(['rect', 'ellipse', 'arrow']), fill: z.enum(['primary', 'secondary', 'background']), background: z.boolean() }),
  z.strictObject({ kind: z.literal('line'), ...box, direction: z.enum(['horizontal', 'vertical']), arrow: z.boolean() }),
  z.strictObject({ kind: z.literal('table'), ...box, columns: z.array(z.string()).min(1).max(12), rows: z.array(z.array(cell)).min(1).max(30), columnWidths: z.array(z.number().positive()).min(1).max(12), rowHeights: z.array(z.number().positive()).min(2).max(31) }),
  z.strictObject({ kind: z.literal('chart'), ...box, chartType: z.enum(['column', 'bar', 'line', 'pie', 'combo']), categories: z.array(z.string()).min(1).max(12), series: z.array(z.strictObject({ name: z.string(), values: z.array(z.number().finite().nullable()).min(1).max(12), unit: z.string() })).min(1).max(4) }),
  z.strictObject({ kind: z.literal('map'), ...box, bounds: z.tuple([z.number(), z.number(), z.number(), z.number()]), points: z.array(z.strictObject({ label: z.string(), longitude: z.number(), latitude: z.number() })).min(1).max(12) }),
]);
export type SceneElement = z.infer<typeof elementSchema>;
export const slideSceneSchema = z.strictObject({
  protocol: z.literal(PROTOCOL), width: z.literal(13.333333), height: z.literal(7.5),
  layoutId: z.string().min(1), layoutVersion: z.number().int().positive(), themeId: z.string().min(1), themeVersion: z.number().int().positive(),
  rendererVersion: z.literal('pitch-scene/2').optional(), variant: variantSchema.optional(),
  pagination: z.strictObject({ index: z.number().int().min(0).max(49), count: z.number().int().min(1).max(50) }).optional(),
  elements: z.array(elementSchema).min(1).max(150),
}).superRefine((scene, ctx) => {
  for (const b of scene.elements) if (b.x + b.w > scene.width + .001 || b.y + b.h > scene.height + .001) ctx.addIssue({ code: 'custom', message: 'Scene element outside page' });
  for (const b of scene.elements) {
    if (b.kind === 'table' && (b.rows.some(r => r.length !== b.columns.length) || b.columnWidths.length !== b.columns.length || b.rowHeights.length !== b.rows.length + 1)) ctx.addIssue({ code: 'custom', message: 'Scene table shape mismatch' });
    if (b.kind === 'chart' && b.series.some(s => s.values.length !== b.categories.length)) ctx.addIssue({ code: 'custom', message: 'Scene chart shape mismatch' });
  }
});
export type SlideScene = z.infer<typeof slideSceneSchema>;
export const layoutDefinitionSchema = z.strictObject({ id: z.string().min(1).max(100), version: z.number().int().positive(), name: z.string().min(1), contentKinds: z.array(z.string()), engine: z.literal('text-image/1'), maxBodyCharacters: z.number().int().positive().max(600) });
export type LayoutDefinition = z.infer<typeof layoutDefinitionSchema>;
