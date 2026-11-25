import { z } from 'zod';
import { slideContentSchema, type SlideContent } from '../contracts/content';
import { layoutDefinitionSchema, slideSceneSchema, type SlideScene } from '../contracts/scene';
import type { DesignTheme } from '../design/theme';

export const templateConfigSchema = z.strictObject({
  id: z.string().regex(/^[a-z0-9-]+$/).max(100), version: z.number().int().positive(),
  names: z.strictObject({ zh: z.string().min(1).max(100), en: z.string().min(1).max(100) }),
  categoryCode: z.string().min(1).max(100), assetTypes: z.array(z.enum(['content'])).min(1), scenarios: z.array(z.string().min(1).max(100)).min(1).max(20),
  inputSchema: z.literal('text-image-parameters/1'), adapter: z.literal('text-image/1'), dataSources: z.array(z.enum(['content_asset'])).min(1),
  requiredPermissions: z.array(z.enum(['internal_generate'])).min(1), layouts: z.array(z.literal('text-image')).min(1),
  exports: z.array(z.enum(['pptx'])).min(1), ai: z.literal('none'), missingData: z.literal('reject'),
});
export type BusinessTemplate = z.infer<typeof templateConfigSchema>;
export const templateParametersSchema = z.strictObject({ language: z.enum(['zh', 'en']).default('zh') });
export const BASIC_TEMPLATE: BusinessTemplate = templateConfigSchema.parse({
  id: 'basic-text-image', version: 1, names: { zh: '基础图文', en: 'Text and image' }, categoryCode: 'general',
  assetTypes: ['content'], scenarios: ['single-page'], inputSchema: 'text-image-parameters/1', adapter: 'text-image/1', dataSources: ['content_asset'],
  requiredPermissions: ['internal_generate'], layouts: ['text-image'], exports: ['pptx'], ai: 'none', missingData: 'reject',
});
export const BASIC_LAYOUT = layoutDefinitionSchema.parse({ id: 'text-image', version: 1, name: '图文双栏', contentKinds: ['paragraph', 'image'], engine: 'text-image/1', maxBodyCharacters: 240 });

/** Only reviewed code is executable. Configuration cannot supply a function, HTML or code. */
const adapters = new Map<string, (content: unknown, parameters: unknown) => SlideContent>([
  ['text-image/1', (raw, rawParameters) => {
    const content = slideContentSchema.parse(raw), parameters = templateParametersSchema.parse(rawParameters);
    if (!content.locale.startsWith(parameters.language)) throw new Error('PITCH_LANGUAGE_UNAVAILABLE');
    if (content.title.length > 40 || (content.subtitle?.length ?? 0) > 60
      || content.blocks.some(b => !['paragraph', 'image'].includes(b.kind))
      || content.blocks.filter(b => b.kind === 'image').length !== 1
      || content.blocks.filter(b => b.kind === 'paragraph').length < 1
      || content.blocks.filter(b => b.kind === 'paragraph').map(b => b.kind === 'paragraph' ? b.text : '').join('\n').length > BASIC_LAYOUT.maxBodyCharacters)
      throw new Error('PITCH_LAYOUT_CAPACITY');
    return content;
  }],
]);
export function buildTemplateContent(config: unknown, content: unknown, parameters: unknown): SlideContent {
  const template = templateConfigSchema.parse(config);
  const adapter = adapters.get(template.adapter);
  if (!adapter) throw new Error('PITCH_TEMPLATE_UNAVAILABLE');
  return adapter(content, parameters);
}
export function layoutContent(raw: SlideContent, theme: DesignTheme): SlideScene {
  const content = slideContentSchema.parse(raw), m = theme.margin, gap = theme.gridGap;
  const body = [content.subtitle, ...content.blocks.filter(b => b.kind === 'paragraph').map(b => b.text)].filter(Boolean).join('\n\n');
  const image = content.blocks.find(b => b.kind === 'image');
  if (!image || image.kind !== 'image') throw new Error('PITCH_IMAGE_REQUIRED');
  return slideSceneSchema.parse({ protocol: content.protocol, width: theme.width, height: theme.height,
    themeId: theme.id, themeVersion: theme.version, layoutId: BASIC_LAYOUT.id, layoutVersion: BASIC_LAYOUT.version,
    elements: [
      { kind: 'text', x: m, y: m, w: 11, h: .8, text: content.title, role: 'title', bold: true },
      { kind: 'text', x: m, y: 1.65, w: 6 - m, h: 3.85, text: body, role: 'body', bold: false },
      { kind: 'image', x: 6 + gap, y: 1.65, w: theme.width - 6 - gap - m, h: 3.85, mediaAssetId: image.mediaAssetId, mediaVersion: image.mediaVersion, alt: image.alt },
      { kind: 'text', x: m, y: 5.9, w: theme.width - 2 * m, h: .65, text: `来源：${content.sources.map(s => s.label).join('；')}｜数据时间：${content.dataAsOf}${content.isTestData ? '｜测试数据，非真实案例' : ''}`, role: 'body', bold: false },
    ] });
}
