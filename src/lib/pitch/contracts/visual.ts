import { z } from 'zod';

export const imageFocusSchema = z.strictObject({ x: z.number().min(0).max(1), y: z.number().min(0).max(1) });
export const imageFitSchema = z.enum(['contain', 'cover']);
export const textSemanticSchema = z.enum(['cover', 'conclusion', 'section', 'metric', 'unit', 'subheading', 'body', 'caption', 'source', 'footer']);
export const chartTypeSchema = z.enum(['column', 'bar', 'line', 'pie', 'combo', 'scatter', 'stacked-column']);

export const scatterAxisSchema = z.strictObject({
  label: z.string().trim().min(1).max(100),
  unit: z.string().max(60),
  values: z.array(z.number().finite().nullable()).min(1).max(200),
});
export const chartEmphasisSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('target'), category: z.number().int().min(0).max(199) }),
  z.strictObject({ kind: z.literal('benchmark') }),
]);
export const tableHeatScaleSchema = z.strictObject({
  min: z.number().finite(), max: z.number().finite(),
}).refine(scale => scale.min <= scale.max && Number.isFinite(scale.max - scale.min));
