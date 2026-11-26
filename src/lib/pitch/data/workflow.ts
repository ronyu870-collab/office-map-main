import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { PROTOCOL, slideContentSchema, type PitchScope } from '../contracts/content';
import { slideSceneSchema } from '../contracts/scene';
import { buildTemplateContent, layoutContent, templateConfigSchema } from '../templates/registry';
import { designThemeSchema } from '../design/theme';
import { digest, makeFile, mediaRowSchema, pitchRpc, readFile, uploadFile, type PitchContext } from './store';
import type { PitchCommand } from '../contracts/api';
import { PPTX_MIME } from '../render/pptx';
import type { LayoutId } from '../contracts/scene';

/** Synthetic art only. Never a real Colliers building, client or case study. */
async function sampleImage(): Promise<Uint8Array> {
  const { Resvg } = await import('@resvg/resvg-js');
  return new Resvg('<svg xmlns="http://www.w3.org/2000/svg" width="960" height="640"><rect width="960" height="640" fill="#E7EBEE"/><path d="M140 540V190h220v350M400 540V100h260v440M700 540V280h130v260" fill="#778BA5"/><path d="M175 230h150m-150 60h150m-150 60h150m-150 60h150m110-260h180m-180 70h180m-180 70h180m-180 70h180m-180 70h180m100-90h70m-70 65h70" stroke="#E7EBEE" stroke-width="18"/></svg>', { font: { loadSystemFonts: false } }).render().asPng();
}
export async function createSample(ctx: PitchContext, requestId: string, scope: PitchScope, fixture?: LayoutId, language: 'zh' | 'en' = 'zh') {
  // IDs are request-scoped so an interrupted upload can retry without duplicates.
  const { createHash } = await import('node:crypto');
  const id = (kind: string) => {
    const namespace = fixture ? 'pitch-sample/2' : 'pitch-sample/1';
    const b = createHash('sha256').update(`${namespace}:${ctx.identity.actorId}:${requestId}:${kind}`).digest().subarray(0, 16);
    b[6] = (b[6] & 15) | 64; b[8] = (b[8] & 63) | 128;
    const h = b.toString('hex'); return `${h.slice(0,8)}-${h.slice(8,12)}-${h.slice(12,16)}-${h.slice(16,20)}-${h.slice(20)}`;
  };
  await pitchRpc(ctx, { action: 'catalog' });
  const assetId = id('asset'), documentId = id('document'), pageId = id('page'), mediaId = id('media'), sourceId = id('source');
  // Fixed synthetic business date makes interrupted retries byte-identical.
  const dataAsOf = '2026-01-01';
  const { layoutFixture } = await import('../fixtures/layouts');
  const testContent = fixture ? layoutFixture(fixture, language, sourceId, mediaId) : undefined;
  const original = new TextEncoder().encode(JSON.stringify({ kind: 'synthetic', notice: '测试数据；非高力国际真实案例', dataAsOf, title: '测试办公空间', description: '此素材仅用于验证内容、页面、主题及文件导出的完整流程。', ...(testContent ? { content: testContent } : {}) }));
  const sourceFile = makeFile(`sources/${ctx.identity.actorId}/${documentId}/original.json`, 'application/json', original);
  const png = await sampleImage(), mediaFile = makeFile(`media/${ctx.identity.actorId}/${mediaId}/1.png`, 'image/png', png);
  const content = slideContentSchema.parse(testContent ? { ...testContent, sources: testContent.sources.map(s => ({ ...s, documentId, pageId, sha256: sourceFile.sha256 })) } : { protocol: PROTOCOL, locale: 'zh', title: '测试办公空间 · 非真实案例',
    subtitle: 'Pitch Studio 流程验证', dataAsOf, disclosure: 'internal', isTestData: true,
    blocks: [ { kind: 'paragraph', text: '此内容为隔离的合成测试素材，用于验证从内容资产到可编辑单页的完整流程。\n所有文字与配图均不代表真实项目或客户案例。', sourceIds: [sourceId] },
      { kind: 'image', mediaAssetId: mediaId, mediaVersion: 1, alt: '合成办公楼示意图；测试数据', sourceIds: [sourceId] } ],
    sources: [{ id: sourceId, kind: 'synthetic', documentId, pageId, label: '合成测试素材', locator: 'logical-unit:1', version: '1', sha256: sourceFile.sha256, dataAsOf }],
  });
  // Authorize target scope BEFORE touching storage; final transaction rechecks.
  const catalog = z.object({ scopes: z.array(z.object({ organizationId: z.string(), region: z.string().nullable(), city: z.string().nullable(), businessLine: z.string().nullable(), canGenerate: z.boolean() })) }).parse(await pitchRpc(ctx, { action: 'catalog' }));
  if (!catalog.scopes.some(g => g.canGenerate && g.organizationId === scope.organizationId && (!g.region || g.region === scope.region) && (!g.city || g.city === scope.city) && (!g.businessLine || g.businessLine === scope.businessLine))) throw new Error('PITCH_DENIED');
  const prior = z.object({ replayed: z.boolean() }).parse(await pitchRpc(ctx, { action: 'sample_lookup', assetId, scope, sourceSha256: sourceFile.sha256 }));
  if (prior.replayed) return { assetId, replayed: true };
  await uploadFile(ctx, sourceFile, original); await uploadFile(ctx, mediaFile, png);
  return pitchRpc(ctx, { action: 'sample_create', scope, assetId, documentId, pageId, mediaId, content, sourceFile, mediaFile, sha256: digest(new TextEncoder().encode(JSON.stringify(content))) });
}
export async function createProject(ctx: PitchContext, command: Extract<PitchCommand, { action: 'project_create' }>) {
  const stored = z.object({ asset: z.object({ id: z.uuid(), current_version: z.number().int().positive() }), version: z.object({ content: slideContentSchema }) }).parse(await pitchRpc(ctx, { action: 'get_asset', assetId: command.assetId }));
  const registry = z.object({ template: z.object({ config: templateConfigSchema }), theme: z.object({ definition: designThemeSchema }) }).parse(await pitchRpc(ctx, { ...command, action: 'registry' }));
  if (registry.template.config.id !== command.templateId || registry.template.config.version !== command.templateVersion || registry.theme.definition.id !== command.themeId || registry.theme.definition.version !== command.themeVersion) throw new Error('PITCH_REGISTRY_MISMATCH');
  const content = buildTemplateContent(registry.template.config, stored.version.content, command.parameters), theme = registry.theme.definition;
  const scene = layoutContent(content, theme);
  return pitchRpc(ctx, { ...command, action: 'project_create', slideId: randomUUID(), assetVersion: stored.asset.current_version,
    content, scene, sources: content.sources, layoutId: scene.layoutId, layoutVersion: scene.layoutVersion });
}
const exportContextSchema = z.object({
  export: z.object({ id: z.uuid(), storage_path: z.string(), state: z.enum(['pending', 'ready', 'failed']) }),
  project: z.object({ title: z.string() }),
  slides: z.array(z.object({ scene: slideSceneSchema })).min(1).max(50),
  themes: z.array(z.object({ definition: designThemeSchema })).min(1), media: z.array(mediaRowSchema),
});
export async function exportProject(ctx: PitchContext, projectId: string, audience: 'internal' | 'client') {
  const current = z.object({ slides: z.array(z.object({ scene: slideSceneSchema })) }).parse(await pitchRpc(ctx, { action: 'get_project', projectId }));
  if (current.slides.length > 1 || current.slides.some(s => s.scene.rendererVersion)) throw new Error('PITCH_ASYNC_REQUIRED');
  const exportId = randomUUID(), args = { projectId, exportId, audience };
  await pitchRpc(ctx, { action: 'export_prepare', ...args });
  try {
    const context = exportContextSchema.parse(await pitchRpc(ctx, { action: 'export_context', ...args }));
    const media = [];
    for (const m of context.media) {
      const file = makeFileFromRow(m);
      media.push({ id: m.id, version: m.version, mime: m.mime, bytes: await readFile(ctx, file) });
    }
    const pages = context.slides.map(s => {
      const theme = context.themes.find(t => t.definition.id === s.scene.themeId && t.definition.version === s.scene.themeVersion)?.definition;
      if (!theme) throw new Error('PITCH_THEME_UNAVAILABLE');
      return { scene: s.scene, theme };
    });
    const { renderPitchPptx } = await import('../render/pptx');
    const bytes = await renderPitchPptx(context.project.title, pages, media);
    const file = makeFile(context.export.storage_path, PPTX_MIME, bytes);
    await pitchRpc(ctx, { action: 'export_context', ...args });
    await uploadFile(ctx, file, bytes);
    await pitchRpc(ctx, { action: 'export_complete', ...args, sha256: file.sha256, size: file.size });
    return { projectId, exportId, audience, sha256: file.sha256, size: file.size };
  } catch (error) {
    // A revoked session may be unable to finalize; its durable running receipt
    // remains explicit for the future worker/reconciliation adapter.
    try { await pitchRpc(ctx, { action: 'export_fail', ...args }); } catch { /* Pending receipt retained; never report ready. */ }
    throw error;
  }
}
function makeFileFromRow(m: z.infer<typeof mediaRowSchema>) {
  return { bucket: 'pitch-studio-private' as const, path: m.storage_path, mime: m.mime, sha256: m.sha256, size: m.size_bytes };
}
export async function downloadExport(ctx: PitchContext, input: { projectId: string; exportId: string; audience: 'internal' | 'client' }) {
  const schema = z.object({ storage_path: z.string(), sha256: z.string(), size_bytes: z.coerce.number() });
  const current = schema.parse(await pitchRpc(ctx, { ...input, action: 'export_download' }));
  const bytes = await readFile(ctx, { bucket: 'pitch-studio-private', path: current.storage_path, mime: PPTX_MIME, sha256: current.sha256, size: current.size_bytes });
  await pitchRpc(ctx, { ...input, action: 'export_download' });
  return bytes;
}

/** An explicit upgrade creates a linked project revision. Original project,
 * content/asset versions and archived exports remain exactly reproducible. */
export async function upgradeProjectTheme(ctx: PitchContext, command: Extract<PitchCommand, { action: 'project_theme_upgrade' }>) {
  const source = z.object({ slides: z.array(z.object({ id: z.uuid(), layout_id: z.string(), layout_version: z.number(), scene: slideSceneSchema, content: slideContentSchema })).min(1).max(50) }).parse(await pitchRpc(ctx, { action: 'get_project', projectId: command.sourceProjectId }));
  const registry = z.object({ theme: z.object({ definition: designThemeSchema }) }).parse(await pitchRpc(ctx, { action: 'registry', templateId: 'basic-text-image', templateVersion: 1, themeId: command.themeId, themeVersion: command.themeVersion }));
  const theme = registry.theme.definition;
  if (theme.id !== command.themeId || theme.version !== command.themeVersion) throw new Error('PITCH_REGISTRY_MISMATCH');
  const slides = await Promise.all(source.slides.map(async s => {
    let scene;
    if (s.scene.rendererVersion) {
      const { layoutSlides } = await import('../layout/engine');
      const pages = await layoutSlides(s.content, theme, s.layout_id as LayoutId, s.scene.variant);
      if (pages.length !== s.scene.pagination?.count) throw new Error('PITCH_THEME_REPAGINATION');
      scene = pages[s.scene.pagination.index];
    } else scene = layoutContent(s.content, theme);
    return { sourceSlideId: s.id, slideId: randomUUID(), scene };
  }));
  const { numberDeckPages } = await import('../layout/pagination');
  const numbered = numberDeckPages(slides.map(s => ({ ...s, theme }))).map(s => ({ sourceSlideId: s.sourceSlideId, slideId: s.slideId, scene: s.scene }));
  return pitchRpc(ctx, { ...command, action: 'project_clone_theme', slides: numbered });
}
