import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { runPitchDataAdapter } from '../business/adapter';
import { dynamicParametersSchema, generationSchema } from '../business/protocol';
import { documentDataVersion } from '../business/document-version';
import { prepareBusinessProject } from '../business/workflow';
import { slideContentSchema, type SlideContent } from '../contracts/content';
import { slideSceneSchema, type SlideScene } from '../contracts/scene';
import { loadMedia, studioRegistry } from '../data/renderWorkflow';
import { digest, mediaRowSchema, pitchRpc, type PitchContext } from '../data/store';
import type { BusinessDataBinding } from '../integration-contracts';
import { layoutSlides } from '../layout/engine';
import { assertSceneQuality } from '../layout/quality';
import { stackingHandoffPartSchema, type WorkspaceCommand, type WorkspaceDetail } from './protocol';
import { captureKey, fieldIndex, readCaptures, usesBusinessEvidence, type Block, type Capture } from './bindingStore';
import { noteSubtitle, type PageNote } from './presentation-edits';
import { commitPayload, getWorkspace } from './workflow';

type RefreshCommand = Extract<WorkspaceCommand, { action: 'preview_data_refresh' | 'apply_data_refresh' }>;
const encode = (value: unknown) => JSON.stringify(value);

function bindingMetadata(capture: Capture): BusinessDataBinding {
  return { ...capture.binding, dataVersion: capture.data_version, dataAsOf: capture.data_as_of };
}

export async function readDocumentBindings(ctx: PitchContext, projectId: string) {
  const document = await getWorkspace(ctx, projectId);
  const captures = await readCaptures(ctx, projectId, document.project.version);
  return {
    projectVersion: document.project.version,
    pages: document.slides.map(page => {
      const capture = captures.get(captureKey(page.asset_id, page.asset_version));
      const settings = document.workspace.page_settings[page.id];
      const stacking = stackingHandoffPartSchema.safeParse(settings?.part);
      const manualSourceIds = new Set(page.content.sources.filter(s => s.recordId?.startsWith('workspace:')).map(s => s.id));
      return {
        id: page.id, assetId: page.asset_id, assetVersion: page.asset_version,
        disclosure: page.content.disclosure, sources: page.content.sources,
        manualNote: settings?.note?.text,
        objects: page.content.blocks.map((block, index) => {
          if (stacking.success && !block.sourceIds.some(id => manualSourceIds.has(id))) {
            const { stackingSource, dataVersion, dataAsOf, observedOn, permissionRevision, policyVersion } = stacking.data;
            return {
              index, kind: block.kind, valueOrigin: 'business' as const, sourceIds: block.sourceIds, query: stackingSource,
              binding: { domain: 'business' as const, disclosure: 'restricted' as const,
                dataVersion, dataAsOf, observedOn, permissionRevision, policyVersion },
              ...(block.kind === 'image' ? { mediaId: block.mediaAssetId, mediaVersion: block.mediaVersion } : {}),
            };
          }
          const origin = capture ? fieldIndex(block, capture.content) : -1;
          if (capture && usesBusinessEvidence(block, capture.content) && block.kind !== 'insight') {
            return {
              index, kind: block.kind, valueOrigin: 'business' as const,
              ...(origin >= 0 ? { blockIndex: origin } : { derived: true }),
              binding: bindingMetadata(capture), query: capture.parameters, sourceIds: block.sourceIds,
            };
          }
          return {
            index, kind: block.kind, valueOrigin: block.sourceIds.some(id => manualSourceIds.has(id))
              ? 'manual' as const : 'asset' as const,
            sourceIds: block.sourceIds,
            ...(block.kind === 'image' ? { mediaId: block.mediaAssetId, mediaVersion: block.mediaVersion } : {}),
          };
        }),
      };
    }),
  };
}

function blockValue({ sourceIds: _sourceIds, ...value }: Block) {
  void _sourceIds;
  return value;
}
function mergeContent(page: SlideContent, previous: SlideContent, proposed: SlideContent, note: PageNote | undefined) {
  if (previous.blocks.length !== proposed.blocks.length ||
    previous.blocks.some((block, index) => block.kind !== proposed.blocks[index].kind))
    throw new Error('PITCH_DATA_REFRESH_LAYOUT');
  const additions = new Map(proposed.sources.map(source => [source.id, source]));
  let updated = false;
  const blocks = page.blocks.map(block => {
    const index = fieldIndex(block, previous);
    if (block.kind === 'insight') return block;
    if (index < 0) {
      if (usesBusinessEvidence(block, previous)) throw new Error('PITCH_DATA_REFRESH_LAYOUT');
      return block;
    }
    updated = true;
    const replacement = proposed.blocks[index];
    return block.kind === 'chart' && replacement.kind === 'chart' ? { ...replacement, chartType: block.chartType } : replacement;
  });
  if (!updated) throw new Error('PITCH_DATA_REFRESH_LAYOUT');
  const referenced = new Set(blocks.flatMap(block => block.sourceIds));
  // Keep evidence for untouched notes, images and insights, and replace only the
  // source references that served the refreshed blocks.
  const previousIds = new Set(previous.sources.map(source => source.id));
  const sources = [...page.sources.filter(source => !previousIds.has(source.id) || referenced.has(source.id)),
    ...[...additions.values()].filter(source => referenced.has(source.id))];
  const base = note ? note.baseSubtitle : page.subtitle;
  const baseSubtitle = base === previous.subtitle ? proposed.subtitle : base;
  return {
    content: slideContentSchema.parse({
      ...page, blocks, sources, dataAsOf: proposed.dataAsOf,
      subtitle: note ? noteSubtitle(baseSubtitle, note.text, page.locale) : baseSubtitle,
    }),
    note: note ? { ...note, baseSubtitle } : undefined,
  };
}

async function prepareRefresh(ctx: PitchContext, command: RefreshCommand) {
  const document = await getWorkspace(ctx, command.projectId);
  if (document.project.version !== command.expectedVersion) throw new Error('PITCH_CONFLICT');
  const captures = await readCaptures(ctx, command.projectId, command.expectedVersion);
  const anchor = document.slides.find(page => page.id === command.slideId);
  const original = anchor && captures.get(captureKey(anchor.asset_id, anchor.asset_version));
  if (!original || original.has_research) throw new Error('PITCH_DATA_REFRESH_UNAVAILABLE');
  const target = command.period;
  if (target && original.binding.domain !== 'quarter') throw new Error('PITCH_INVALID');
  const trend = original.parameters.templateId.endsWith('-trend');
  const parameters = target ? dynamicParametersSchema.parse({
    ...original.parameters, period: target, end: target,
    start: trend ? original.parameters.start : target,
  }) : original.parameters;
  const language = original.content.locale.startsWith('en') ? 'en' as const : 'zh' as const;
  const fetched = await runPitchDataAdapter(ctx, parameters, language, original.compares_quarters);
  const pages = document.slides.flatMap(page => {
    const capture = captures.get(captureKey(page.asset_id, page.asset_version));
    if (!capture || capture.generation_id !== original.generation_id || capture.snapshot_index !== original.snapshot_index) return [];
    const candidate = fetched.content[capture.content_index];
    if (!candidate) throw new Error('PITCH_DATA_REFRESH_LAYOUT');
    return [{ page, capture, ...mergeContent(page.content, capture.content, candidate, document.workspace.page_settings[page.id]?.note) }];
  });
  const afterVersion = documentDataVersion(fetched.results);
  const changes = pages.map(({ page, capture, content }) => {
    const after = content.blocks.map(blockValue), before = page.content.blocks.map(blockValue);
    const beforeVersion = documentDataVersion(capture.results);
    return {
      slideId: page.id, changed: beforeVersion !== afterVersion ||
        page.content.dataAsOf !== content.dataAsOf || encode(before) !== encode(after),
      before: { dataVersion: beforeVersion, dataAsOf: page.content.dataAsOf, blocks: before },
      after: { dataVersion: afterVersion, dataAsOf: content.dataAsOf, blocks: after },
      needsConclusionReview: false,
    };
  });
  const changed = changes.some(page => page.changed);
  for (const change of changes) {
    const page = pages.find(item => item.page.id === change.slideId)!;
    change.needsConclusionReview = change.changed && page.page.content.blocks.some(block => block.kind === 'insight');
  }
  const needsConclusionReview = changed && document.slides.some(page => page.content.blocks.some(block => block.kind === 'insight'));
  const fingerprint = digest(Buffer.from(encode({ projectId: command.projectId, version: command.expectedVersion,
    source: original.generation_id, snapshot: original.snapshot_index, parameters, binding: fetched.binding, changes })));
  const review = { projectVersion: command.expectedVersion, fingerprint, changed, changes, needsConclusionReview,
    period: original.binding.domain === 'quarter' ? parameters.period : null };
  return { document, original, fetched, pages, language, parameters, review };
}

export async function previewDataRefresh(ctx: PitchContext, command: Extract<RefreshCommand, { action: 'preview_data_refresh' }>) {
  return (await prepareRefresh(ctx, command)).review;
}

function preserveSceneEdits(before: SlideScene, rendered: SlideScene) {
  if (!before.elements.some(element => element.editorId)) return rendered;
  if (before.elements.length !== rendered.elements.length) throw new Error('PITCH_DATA_REFRESH_LAYOUT');
  const elements = before.elements.map((element, index) => {
    const sourceIndex = element.editorId ? Number(element.editorId.slice('object-'.length)) - 1 : index;
    const replacement = rendered.elements[sourceIndex];
    if (!replacement || replacement.kind !== element.kind ||
      (replacement.kind === 'text' && element.kind === 'text' && replacement.role !== element.role))
      throw new Error('PITCH_DATA_REFRESH_LAYOUT');
    if (element.kind === 'image' || element.kind === 'shape') return element;
    if (!element.editorId) return replacement;
    return { ...replacement, editorId: element.editorId, editorGroup: element.editorGroup, x: element.x, y: element.y };
  });
  return slideSceneSchema.parse({ ...rendered, elements });
}

export async function applyDataRefresh(ctx: PitchContext, command: Extract<RefreshCommand, { action: 'apply_data_refresh' }>) {
  const update = await prepareRefresh(ctx, command);
  if (command.fingerprint !== update.review.fingerprint) throw new Error('PITCH_DATA_REFRESH_CHANGED');
  if (!update.review.changed) return update.document;
  const { document, fetched, original, pages, parameters, language } = update;
  const project = document.project;
  const prepared = await prepareBusinessProject(ctx, generationSchema.parse({
    action: 'generate', projectId: randomUUID(), parentProjectId: project.id, title: project.title,
    scope: { organizationId: project.organization_id, region: project.region, city: project.city, businessLine: project.business_line },
    themeId: project.theme_id, themeVersion: project.theme_version, language,
    parts: [{ mode: 'dynamic', parameters }],
  }), undefined, undefined, original.compares_quarters, fetched);
  const mediaRows = z.object({ media: z.array(mediaRowSchema) }).parse(
    await pitchRpc(ctx, { action: 'preview_context', projectId: project.id }),
  ).media;
  const next = new Map<string, WorkspaceDetail['slides'][number]>();
  const registry = new Map<string, Awaited<ReturnType<typeof studioRegistry>>>();
  for (const { page, capture, content } of pages) {
    const asset = prepared.capturedAssets.find(item => item.contentIndex === capture.content_index);
    if (!asset) throw new Error('PITCH_DATA_REFRESH_LAYOUT');
    const key = page.scene.themeId + ':' + page.scene.themeVersion;
    if (!registry.has(key)) registry.set(key, await studioRegistry(ctx, page.scene.themeId, page.scene.themeVersion));
    const theme = registry.get(key)!.theme.definition;
    const rendered = await layoutSlides(content, theme, page.scene.layoutId, page.scene.variant);
    if (rendered.length !== (page.scene.pagination?.count ?? 1)) throw new Error('PITCH_DATA_REFRESH_LAYOUT');
    const scene = preserveSceneEdits(page.scene, rendered[page.scene.pagination?.index ?? 0]);
    await assertSceneQuality(scene, theme, await loadMedia(ctx, mediaRows, [scene]));
    next.set(page.id, { ...page, content, scene, asset_id: asset.assetId, asset_version: 1 });
  }
  const settings = { ...document.workspace.page_settings };
  for (const { page, note } of pages) settings[page.id] = { ...settings[page.id], origin: 'data', note };
  const save = await commitPayload(ctx, document, document.slides.map(page => next.get(page.id) ?? page), settings);
  await pitchRpc(ctx, {
    action: 'workspace_data_refresh_commit', projectId: project.id, expectedVersion: project.version,
    generation: prepared.input, save,
  });
  return getWorkspace(ctx, project.id);
}
