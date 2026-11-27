import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { PitchCommand } from '../contracts/api';
import { slideContentSchema } from '../contracts/content';
import { slideSceneSchema, type LayoutId } from '../contracts/scene';
import { designThemeSchema, type DesignTheme } from '../design/theme';
import { numberDeckPages } from '../layout/pagination';
import { layoutSlides } from '../layout/engine';
import { assertSceneQuality } from '../layout/quality';
import { buildTemplateContent, templateConfigSchema } from '../templates/registry';
import { artifactName, exportFormats, MIME } from '../render/format';
import { inspectMedia, sceneMediaReferences, type SceneMedia } from '../render/media';
import { artifactVisualSourcesSchema, assertArtifactVisualSources, prepareVisualDelivery } from '../visual-data/artifact';
import { fitResolvedVisualImages, getVisualPageReceipts, resolveReferencedVisualMedia } from '../visual-data/resolve';
import { makeFile, mediaRowSchema, pitchRpc, readFile, uploadFile, type PitchContext } from './store';

// Include the deployed build so an updated renderer cannot silently reuse a
// package produced with earlier rendering code.
const deliveryRevision = 'pitch-export-output/1' + (process.env.VERCEL_GIT_COMMIT_SHA ? '/' + process.env.VERCEL_GIT_COMMIT_SHA : '');
const pageSchema = z.object({ id: z.uuid(), content: slideContentSchema, scene: slideSceneSchema });
const previewContextSchema = z.object({ slides: z.array(pageSchema).min(1).max(50), themes: z.array(z.object({ definition: designThemeSchema })), media: z.array(mediaRowSchema) });
export async function loadMedia(ctx: PitchContext, rows: z.infer<typeof mediaRowSchema>[], scenes: z.infer<typeof slideSceneSchema>[],
  { missing = 'PITCH_MEDIA_UNAVAILABLE', resolved = [] }: { missing?: string; resolved?: readonly SceneMedia[] } = {}) {
  const refs = sceneMediaReferences(scenes), files: SceneMedia[] = [...resolved];
  const available = new Map(rows.map(row => [`${row.id}:${row.version}`, row]));
  const seen = new Set(resolved.map(row => `${row.id}:${row.version}`));
  for (const ref of refs) {
    const key = `${ref.id}:${ref.version}`;
    if (seen.has(key)) continue;
    const row = available.get(key);
    if (!row) throw new Error(missing);
    seen.add(key);
    files.push({ id: row.id, version: row.version, mime: row.mime, bytes: await readFile(ctx, { bucket: 'pitch-studio-private', path: row.storage_path, mime: row.mime, size: row.size_bytes, sha256: row.sha256 }) });
  }
  return inspectMedia(files);
}
export async function studioRegistry(ctx: PitchContext, themeId: string, themeVersion: number) {
  const reg = z.object({ template: z.object({ config: templateConfigSchema }), theme: z.object({ definition: designThemeSchema }) }).parse(await pitchRpc(ctx, { action: 'registry', templateId: 'studio-content', templateVersion: 1, themeId, themeVersion }));
  if (reg.theme.definition.id !== themeId || reg.theme.definition.version !== themeVersion || reg.template.config.adapter !== 'structured-content/2') throw new Error('PITCH_REGISTRY_MISMATCH');
  return reg;
}
export async function composeProject(ctx: PitchContext, command: Extract<PitchCommand, { action: 'project_compose' }>) {
  const registry = await studioRegistry(ctx, command.themeId, command.themeVersion), pages = [];
  for (const part of command.parts) {
    const stored = z.object({ asset: z.object({ current_version: z.number() }), version: z.object({ content: slideContentSchema }), media: z.array(mediaRowSchema) }).parse(await pitchRpc(ctx, { action: 'get_asset', assetId: part.assetId }));
    const content = buildTemplateContent(registry.template.config, stored.version.content, { language: stored.version.content.locale.startsWith('en') ? 'en' : 'zh', layoutId: part.layoutId, variant: part.variant });
    const scenes = await layoutSlides(content, registry.theme.definition, part.layoutId, part.variant);
    const media = await loadMedia(ctx, stored.media, scenes);
    for (const scene of scenes) await assertSceneQuality(scene, registry.theme.definition, media);
    for (const scene of scenes) pages.push({ slideId: randomUUID(), assetId: part.assetId, assetVersion: stored.asset.current_version, content, scene, sources: content.sources });
    if (pages.length > 50) throw new Error('PITCH_PAGE_LIMIT');
  }
  // Persist only generated scenes; the browser can never submit a scene or XML.
  return pitchRpc(ctx, { ...command, action: 'project_compose', slides: numberDeckPages(pages.map(p => ({ ...p, theme: registry.theme.definition }))).map(p => ({ slideId: p.slideId, assetId: p.assetId, assetVersion: p.assetVersion, content: p.content, scene: p.scene, sources: p.sources })), templateId: 'studio-content', templateVersion: 1 });
}
function pageTheme(scene: z.infer<typeof slideSceneSchema>, themes: { definition: DesignTheme }[]) {
  const theme = themes.find(t => t.definition.id === scene.themeId && t.definition.version === scene.themeVersion)?.definition;
  if (!theme) throw new Error('PITCH_THEME_UNAVAILABLE');
  return theme;
}
export async function previewPage(ctx: PitchContext, command: Extract<PitchCommand, { action: 'preview' }>) {
  const input = { action: 'preview_context', projectId: command.projectId }, stored = previewContextSchema.parse(await pitchRpc(ctx, input));
  const page = command.editorSlideId ? stored.slides.find(slide => slide.id === command.editorSlideId) : stored.slides[command.page];
  if (!page) throw new Error(command.editorSlideId ? 'PITCH_CONFLICT' : 'PITCH_INVALID');
  if (command.editorSlideId && (command.layoutId || command.variant || command.themeId || command.themeVersion)) throw new Error('PITCH_INVALID');
  let scene = page.scene, theme = pageTheme(scene, stored.themes), pageCount = scene.pagination?.count ?? 1;
  if (command.layoutId && command.layoutId !== scene.layoutId || command.variant && command.variant !== scene.variant || command.themeId && (command.themeId !== theme.id || command.themeVersion !== theme.version)) {
    const registry = await studioRegistry(ctx, command.themeId ?? theme.id, command.themeVersion ?? theme.version);
    theme = registry.theme.definition;
    const scenes = await layoutSlides(page.content, theme, command.layoutId ?? scene.layoutId as LayoutId, command.variant ?? scene.variant);
    // Parameter editing refreshes only the selected content group. Additional
    // generated pages are reported, never silently discarded from a saved deck.
    scene = numberDeckPages([{ scene: scenes[page.scene.pagination?.index ?? 0] ?? scenes[0], theme }], command.page)[0].scene;
    pageCount = scenes.length;
  }
  const pins = getVisualPageReceipts([page.content]);
  const resolved = await resolveReferencedVisualMedia(ctx, pins, sceneMediaReferences([scene]), 'internal');
  scene = fitResolvedVisualImages(scene, resolved);
  const media = await loadMedia(ctx, stored.media, [scene], { resolved }), { renderSceneSvg } = await import('../render/svg');
  const svg = await renderSceneSvg(scene, theme, media, !!command.editorSlideId);
  const quality = await assertSceneQuality(scene, theme, media);
  await resolveReferencedVisualMedia(ctx, pins, [], 'internal');
  await pitchRpc(ctx, input);
  return { svg, scene, pageCount, quality, font: 'Noto Sans SC', fontMode: 'bundled-glyph-outlines' };
}
export async function prepareRenderExport(ctx: PitchContext, command: Extract<PitchCommand, { action: 'export_start' }>) {
  if (command.pages && (command.page !== undefined || ['png','svg'].includes(command.format))) throw new Error('PITCH_INVALID');
  if (['png', 'svg'].includes(command.format) && command.page === undefined) throw new Error('PITCH_SINGLE_PAGE_REQUIRED');
  const current = z.object({ project: z.object({ title: z.string() }) }).parse(await pitchRpc(ctx, { action: 'get_project', projectId: command.projectId }));
  const receipt = z.object({
    blocked: z.object({
      projectVersion: z.number().int(), audienceAllowed: z.boolean(),
      pages: z.array(z.object({ id: z.uuid(), position: z.number().int(), reasons: z.array(z.string()) })),
    }).optional(),
  }).passthrough().parse(await pitchRpc(ctx, { ...command, action: 'export_prepare', asynchronous: true, pipeline: 'delivery/1', deliveryRevision: command.format === 'pptx' ? deliveryRevision + '/shared-picture-parts-1/dengxian-1' : deliveryRevision, filename: artifactName(current.project.title, command.format, command.page) }));
  if (receipt.blocked) throw new ExportEligibilityError(receipt.blocked);
  return receipt;
}
export class ExportEligibilityError extends Error {
  constructor(readonly report: { projectVersion: number; audienceAllowed: boolean; pages: { id: string; position: number; reasons: string[] }[] }) {
    super('PITCH_DENIED');
  }
}
/** Runs after the HTTP acknowledgement. Durable claim/progress/deadline permit
 * owner polling and explicit retry after a worker crash, without holding an API
 * response or storing generated files in the function's ephemeral filesystem. */
export async function runRenderExport(ctx: PitchContext, command: { projectId: string; exportId: string; audience?: 'internal' | 'client' }) {
  const args = { projectId: command.projectId, exportId: command.exportId, workerToken: randomUUID(),
    ...(command.audience && { audience: command.audience }) };
  try {
    const claim = z.object({ claimed: z.boolean() }).parse(await pitchRpc(ctx, { action: 'export_claim', ...args }));
    if (!claim.claimed) return;
    const context = previewContextSchema.extend({ selected: z.literal(true).optional(), export: z.object({ storage_path: z.string(), format: z.enum(exportFormats),
      render_options: z.object({ page: z.number().optional(), pages: z.array(z.number()).optional() }), visual_source_snapshot: artifactVisualSourcesSchema,
    }), project: z.object({ title: z.string() }) }).parse(await pitchRpc(ctx, { action: 'export_context', ...args }));
    const selected = context.export.render_options.page;
    const slides = context.selected ? context.slides : context.export.render_options.pages ? context.export.render_options.pages.map(i => context.slides[i]) : selected === undefined ? context.slides : [context.slides[selected]];
    if (!slides.length || slides.some(s => !s)) throw new Error('PITCH_INVALID');
    const pins = getVisualPageReceipts([{ sources: context.export.visual_source_snapshot }]);
    assertArtifactVisualSources(pins, getVisualPageReceipts(slides.map(s => s.content)));
    const format = context.export.format, scenes = slides.map(s => s.scene);
    const file = await prepareVisualDelivery(ctx, pins, sceneMediaReferences(scenes), { format, audience: command.audience ?? 'internal', stage: 'export' }, async resolved => {
      const media = await loadMedia(ctx, context.media, scenes, { resolved });
      const pages = scenes.map(scene => ({ scene: fitResolvedVisualImages(scene, resolved), theme: pageTheme(scene, context.themes) }));
      await pitchRpc(ctx, { action: 'export_progress', ...args, progress: 30 });
      let bytes: Uint8Array;
      if (format === 'pptx') bytes = await (await import('../render/pptx')).renderPitchPptx(context.project.title, pages, media);
      else if (format === 'xlsx') bytes = await (await import('../render/xlsx')).renderSceneXlsx(pages.map(p => p.scene));
      else if (format === 'pdf') bytes = await (await import('../render/pdf')).renderScenePdf(pages, media, ctx.signal);
      else {
        if (pages.length !== 1) throw new Error('PITCH_SINGLE_PAGE_REQUIRED');
        const renderer = await import('../render/svg');
        bytes = format === 'png' ? await renderer.renderScenePng(pages[0].scene, pages[0].theme, media) : new TextEncoder().encode(await renderer.renderSceneSvg(pages[0].scene, pages[0].theme, media));
      }
      if (bytes.length > 16 * 1024 * 1024) throw new Error('PITCH_EXPORT_LIMIT');
      await pitchRpc(ctx, { action: context.selected ? 'export_verify' : 'export_context', ...args });
      await pitchRpc(ctx, { action: 'export_progress', ...args, progress: 85 });
      const prepared = makeFile(context.export.storage_path, MIME[format], bytes);
      await uploadFile(ctx, prepared, bytes);
      return prepared;
    });
    await pitchRpc(ctx, { action: 'export_complete', ...args, sha256: file.sha256, size: file.size });
  } catch (error) {
    try { await pitchRpc(ctx, { action: 'export_fail', ...args, errorCode: error instanceof Error ? error.message : 'PITCH_EXPORT_FAILED' }); } catch { /* Revoked/expired identity leaves a bounded, explicitly pending receipt. */ }
  }
}
export async function downloadArtifact(ctx: PitchContext, input: { projectId: string; exportId: string; audience: 'internal' | 'client' }) {
  const args = { ...input, action: 'export_download' }, current = z.object({ storage_path: z.string(), sha256: z.string(), size_bytes: z.coerce.number(),
    format: z.enum(exportFormats), filename: z.string().nullable().optional(), visual_source_snapshot: artifactVisualSourcesSchema,
  }).parse(await pitchRpc(ctx, args));
  const pins = getVisualPageReceipts([{ sources: current.visual_source_snapshot }]);
  const bytes = await prepareVisualDelivery(ctx, pins, [], { format: current.format, audience: input.audience, stage: 'download' }, () =>
    readFile(ctx, { bucket: 'pitch-studio-private', path: current.storage_path, mime: MIME[current.format], sha256: current.sha256, size: current.size_bytes }));
  await pitchRpc(ctx, args);
  return { bytes, mime: MIME[current.format], filename: current.filename ?? artifactName('Pitch', current.format) };
}
