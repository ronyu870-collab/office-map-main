import { z } from 'zod';
import { PROTOCOL } from './content';
const box = { x: z.number().min(0).max(13.334), y: z.number().min(0).max(7.5), w: z.number().positive().max(13.334), h: z.number().positive().max(7.5) };
export const slideSceneSchema = z.strictObject({
  protocol: z.literal(PROTOCOL), width: z.literal(13.333333), height: z.literal(7.5),
  layoutId: z.string().min(1), layoutVersion: z.number().int().positive(), themeId: z.string().min(1), themeVersion: z.number().int().positive(),
  elements: z.array(z.discriminatedUnion('kind', [
    z.strictObject({ kind: z.literal('text'), ...box, text: z.string().min(1).max(6000), role: z.enum(['title', 'body']), bold: z.boolean() }),
    z.strictObject({ kind: z.literal('image'), ...box, mediaAssetId: z.uuid(), mediaVersion: z.number().int().positive(), alt: z.string().max(4000) }),
  ])).min(1).max(100),
}).superRefine((scene, ctx) => {
  for (const b of scene.elements) if (b.x + b.w > scene.width + .001 || b.y + b.h > scene.height + .001) ctx.addIssue({ code: 'custom', message: 'Scene element outside page' });
});
export type SlideScene = z.infer<typeof slideSceneSchema>;
export const layoutDefinitionSchema = z.strictObject({ id: z.string().min(1).max(100), version: z.number().int().positive(), name: z.string().min(1), contentKinds: z.array(z.string()), engine: z.literal('text-image/1'), maxBodyCharacters: z.number().int().positive().max(600) });
export type LayoutDefinition = z.infer<typeof layoutDefinitionSchema>;
