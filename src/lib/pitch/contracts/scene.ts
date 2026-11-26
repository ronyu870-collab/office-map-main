import { z } from 'zod';
import { boxFits } from './scene-geometry';
import { PROTOCOL } from './content';
import { chartEmphasisSchema, chartTypeSchema, imageFitSchema, imageFocusSchema, scatterAxisSchema, tableHeatScaleSchema, textSemanticSchema } from './visual';
import { PATTERN_BY_ID } from '../layout/patterns/catalog';
export const legacyLayoutIds = ['cover', 'section-divider', 'image-text', 'two-columns', 'kpi', 'team-profile', 'case-study', 'data-table', 'chart-insight', 'comparison', 'map-analysis', 'strategy-framework'] as const;
export const layoutIds = [...legacyLayoutIds, ...PATTERN_BY_ID.keys()];
/** Only code-reviewed, versioned patterns are addressable; no arbitrary scripts. */
export const layoutIdSchema = z.string().min(1).max(100).refine(id => layoutIds.includes(id), 'Unregistered layout');
export type LayoutId = z.infer<typeof layoutIdSchema>;
export const variantSchema = z.enum(['standard', 'alternate']);
const box = { editorGroup: z.uuid().optional(), editorId: z.string().regex(/^object-[0-9]{1,3}$/).optional(), x: z.number().min(0).max(13.334), y: z.number().min(0).max(7.5), w: z.number().positive().max(13.334), h: z.number().positive().max(7.5) };
const rotation = z.number().int().min(-180).max(179).optional();
const allowOverlap = z.boolean().optional();
const cell = z.union([z.string().max(4000), z.number().finite(), z.null()]);
const elementSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('text'), ...box, text: z.string().min(1).max(6000), role: z.enum(['title', 'body']), bold: z.boolean(), semantic: textSemanticSchema.optional(), align: z.enum(['left', 'right']).optional(), purpose: z.enum(['content', 'source', 'footer']).optional() }),
  z.strictObject({ kind: z.literal('image'), ...box, rotation, allowOverlap, mediaAssetId: z.uuid(), mediaVersion: z.number().int().positive(), alt: z.string().max(4000), fit: imageFitSchema.optional(), focus: imageFocusSchema.optional(), bleed: z.literal(true).optional() }),
  z.strictObject({ kind: z.literal('brand'), ...box, resource: z.literal('colliers-brand-assets/1') }),
  z.strictObject({ kind: z.literal('shape'), ...box, rotation, allowOverlap, shape: z.enum(['rect', 'ellipse', 'arrow', 'triangle', 'trapezoid']), fill: z.enum(['primary', 'secondary', 'background']), background: z.boolean(), opacity: z.number().min(0).max(1).optional() }),
  z.strictObject({ kind: z.literal('line'), ...box, direction: z.enum(['horizontal', 'vertical']), arrow: z.boolean() }),
  z.strictObject({ kind: z.literal('table'), ...box, columns: z.array(z.string()).min(1).max(12), rows: z.array(z.array(cell)).min(1).max(30), columnWidths: z.array(z.number().positive()).min(1).max(12), rowHeights: z.array(z.number().positive()).min(2).max(31), heatScale: tableHeatScaleSchema.optional() }),
  z.strictObject({ kind: z.literal('chart'), ...box, chartType: chartTypeSchema, xAxis: scatterAxisSchema.optional(), emphasis: chartEmphasisSchema.optional(), categories: z.array(z.string()).min(1).max(12), series: z.array(z.strictObject({ name: z.string(), values: z.array(z.number().finite().nullable()).min(1).max(12), unit: z.string() })).min(1).max(4) }),
  z.strictObject({ kind: z.literal('map'), ...box, bounds: z.tuple([z.number(), z.number(), z.number(), z.number()]), points: z.array(z.strictObject({ label: z.string(), longitude: z.number(), latitude: z.number() })).min(1).max(12) }),
]);
export type SceneElement = z.infer<typeof elementSchema>;
export const slideSceneSchema = z.strictObject({
  protocol: z.literal(PROTOCOL), width: z.literal(13.333333), height: z.literal(7.5),
  layoutId: z.string().min(1), layoutVersion: z.number().int().positive(), themeId: z.string().min(1), themeVersion: z.number().int().positive(),
  rendererVersion: z.literal('pitch-scene/2').optional(), designVersion: z.literal(1).optional(), composition: z.string().max(64).optional(), variant: variantSchema.optional(),
  pagination: z.strictObject({ index: z.number().int().min(0).max(49), count: z.number().int().min(1).max(50) }).optional(),
  elements: z.array(elementSchema).min(1).max(150),
}).superRefine((scene, ctx) => {
  if (scene.designVersion && !scene.rendererVersion) ctx.addIssue({ code: 'custom', message: 'Design extensions require the current scene renderer' });
  const editorIds = scene.elements.flatMap(element => element.editorId ? [element.editorId] : []);
  if (new Set(editorIds).size !== editorIds.length) ctx.addIssue({ code: 'custom', message: 'Duplicate scene object identifier' });
  const groupCounts = new Map<string, number>();
  for (const element of scene.elements) {
    if (!element.editorGroup) continue;
    const locked = element.kind === 'brand' || element.kind === 'line' ||
      (element.kind === 'shape' && element.background) ||
      (element.kind === 'text' && !!element.purpose && element.purpose !== 'content');
    if (locked || !element.editorId) ctx.addIssue({ code: 'custom', message: 'Managed scene layer cannot be grouped' });
    groupCounts.set(element.editorGroup, (groupCounts.get(element.editorGroup) ?? 0) + 1);
  }
  if ([...groupCounts.values()].some(count => count < 2)) ctx.addIssue({ code: 'custom', message: 'A group needs two or more layers' });
  for (const b of scene.elements) {
    const extended = (b.kind === 'text' && (b.semantic || b.align)) || (b.kind === 'image' && (b.fit === 'cover' || b.focus || b.bleed)) ||
      (b.kind === 'table' && b.heatScale) || (b.kind === 'chart' && (b.xAxis || b.emphasis || b.chartType === 'stacked-column'));
    if (extended && !scene.designVersion) ctx.addIssue({ code: 'custom', message: 'Scene element requires designVersion' });
    if (!boxFits(scene, b, .001)) ctx.addIssue({ code: 'custom', message: 'Scene element outside page' });
    if ((b.kind === 'image' || b.kind === 'shape') && (b.rotation || b.allowOverlap) && !scene.rendererVersion) ctx.addIssue({ code: 'custom', message: 'Rotation requires the current scene renderer' });
    if (b.kind === 'shape' && b.background && (b.rotation || b.allowOverlap)) ctx.addIssue({ code: 'custom', message: 'Background rotation is not allowed' });
  }
  for (const b of scene.elements) {
    if (b.kind === 'table' && (b.rows.some(r => r.length !== b.columns.length) || b.columnWidths.length !== b.columns.length || b.rowHeights.length !== b.rows.length + 1)) ctx.addIssue({ code: 'custom', message: 'Scene table shape mismatch' });
    if (b.kind === 'chart' && (b.series.some(s => s.values.length !== b.categories.length) ||
      (b.chartType === 'scatter') !== Boolean(b.xAxis) ||
      b.xAxis && b.xAxis.values.length !== b.categories.length ||
      b.emphasis?.kind === 'target' && (b.emphasis.category >= b.categories.length || b.series.length !== 1 ||
        !['bar', 'column', 'scatter'].includes(b.chartType) || b.series[0].values[b.emphasis.category] === null ||
        b.xAxis?.values[b.emphasis.category] === null) ||
      b.emphasis?.kind === 'benchmark' && b.chartType !== 'combo' ||
      b.chartType === 'combo' && b.series.length !== 2 ||
      b.chartType === 'stacked-column' && (b.series.length < 2 || b.series.some(s => s.values.some(value => value === null))) ||
      b.chartType === 'pie' && (b.series.length !== 1 || b.series[0].values.some(value => value === null || value < 0) || !b.series[0].values.some(value => value! > 0))))
      ctx.addIssue({ code: 'custom', message: 'Scene chart shape mismatch' });
    if (b.kind === 'image' && b.bleed && (!scene.designVersion || b.rotation || b.allowOverlap || b.x !== 0 || b.y !== 0 || b.w !== scene.width || b.h !== scene.height)) ctx.addIssue({ code: 'custom', message: 'Bleed image must be full page and unrotated' });
    if (b.kind === 'image' && b.focus && b.fit !== 'cover') ctx.addIssue({ code: 'custom', message: 'Image focus requires cover fit' });
    if (b.kind === 'table' && b.heatScale && (b.columns.length < 2 || b.rows.some(row =>
      typeof row[0] !== 'string' || row.slice(1).some(value => value !== null &&
        (typeof value !== 'number' || value < b.heatScale!.min || value > b.heatScale!.max)))))
      ctx.addIssue({ code: 'custom', message: 'Scene heatmap values outside shared scale' });
  }
});
export type SlideScene = z.infer<typeof slideSceneSchema>;
export const layoutDefinitionSchema = z.strictObject({ id: z.string().min(1).max(100), version: z.number().int().positive(), name: z.string().min(1), contentKinds: z.array(z.string()), engine: z.literal('text-image/1'), maxBodyCharacters: z.number().int().positive().max(600) });
export type LayoutDefinition = z.infer<typeof layoutDefinitionSchema>;
