import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { slideContentSchema, type SlideContent } from '../contracts/content';
import { slideSceneSchema, type SlideScene } from '../contracts/scene';
import { pitchRpc, type PitchContext } from '../data/store';
import { noteSubtitle, workspaceChartTypeSchema } from './presentation-edits';
import type { WorkspaceDetail } from './protocol';

type Page = WorkspaceDetail['slides'][number];
type Block = SlideContent['blocks'][number];
type Element = SlideScene['elements'][number];
type Settings = WorkspaceDetail['workspace']['page_settings'];

const editionPageSchema = z.object({
  slideId: z.uuid(), ownerProjectId: z.uuid().nullable(), recipeKey: z.string().nullable(), content: slideContentSchema,
});
const baselineSchema = z.object({ pages: z.array(editionPageSchema), recipeKeys: z.array(z.string()), title: z.string().nullable(), submarkets: z.array(z.string()).nullable().optional() });
type Baseline = z.infer<typeof baselineSchema>;

export async function readEditionBaseline(ctx: PitchContext, current: WorkspaceDetail) {
  return baselineSchema.parse(await pitchRpc(ctx, { action: 'workspace_edition_base',
    projectId: current.project.id, expectedVersion: current.project.version }));
}

function periodTitle(title: string, period: string) {
  const [year, quarter] = period.split('-Q');
  return quarter ? title.replace(new RegExp(`(?<!\\d)${year}\\s*(?:[-年]\\s*)?(?:Q${quarter}|第?${quarter}季度)(?!\\d)`, 'giu'), '{quarter}') : title;
}

function pageLabel(content: SlideContent, scene: SlideScene, period: string) {
  return JSON.stringify([periodTitle(content.title, period), scene.pagination?.index ?? 0]);
}

const changed = (before: unknown, after: unknown) => JSON.stringify(before) !== JSON.stringify(after);
const sourceRoles = (content: SlideContent, ids: string[]) => content.sources.filter(source => ids.includes(source.id));

export function carryPageContent(previous: Page, baseline: SlideContent, fresh: Page, note?: Settings[string]['note']) {
  const sources = new Map(fresh.content.sources.map(source => [source.id, source]));
  const manualSources = (ids: string[]) => {
    for (const source of sourceRoles(previous.content, ids)) sources.set(source.id, source);
  };
  const blocks = fresh.content.blocks.slice();
  const priorKinds = baseline.blocks.map(block => block.kind);
  const currentKinds = previous.content.blocks.map(block => block.kind);
  if (changed(priorKinds, currentKinds)) throw new Error('PITCH_EDITION_LAYOUT');
  const matchingSlot = (index: number, block: Block) => {
    const matching = blocks[index];
    if (!matching || matching.kind !== block.kind ||
      changed(priorKinds.slice(0, index + 1), fresh.content.blocks.slice(0, index + 1).map(item => item.kind)))
      throw new Error('PITCH_EDITION_LAYOUT');
    return matching;
  };

  for (const [index, block] of previous.content.blocks.entries()) {
    const original = baseline.blocks[index];
    if (!changed(original, block)) continue;

    if (block.kind === 'paragraph' && original.kind === 'paragraph') {
      if (block.text === original.text) continue;
      const target = matchingSlot(index, block);
      const ownSources = sourceRoles(previous.content, block.sourceIds);
      if (target.kind !== 'paragraph' || target.text !== original.text || !ownSources.length ||
        ownSources.some(source => !source.recordId?.startsWith('workspace:')))
        throw new Error('PITCH_EDITION_LAYOUT');
      manualSources(block.sourceIds);
      blocks[index] = { ...target, text: block.text, sourceIds: block.sourceIds };
    } else if (block.kind === 'image' && original.kind === 'image') {
      const target = matchingSlot(index, block);
      if (target.kind !== 'image' || fresh.content.disclosure === 'restricted') throw new Error('PITCH_EDITION_LAYOUT');
      // Keep an operator's chosen image and crop when the same recipe slot survives.
      manualSources(block.sourceIds);
      blocks[index] = block;
    } else if (block.kind === 'chart' && original.kind === 'chart' && block.chartType !== original.chartType) {
      const target = matchingSlot(index, block);
      if (target.kind !== 'chart' || !workspaceChartTypeSchema.safeParse(block.chartType).success)
        throw new Error('PITCH_EDITION_LAYOUT');
      blocks[index] = { ...target, chartType: block.chartType };
    } else if (changed({ ...block, sourceIds: [] }, { ...original, sourceIds: [] })) {
      throw new Error('PITCH_EDITION_LAYOUT');
    }
  }
  const title = previous.content.title === baseline.title ? fresh.content.title : previous.content.title;
  const baseSubtitle = fresh.content.subtitle;
  const nextNote = note && { text: note.text, baseSubtitle };
  const keepSources = new Set(blocks.flatMap(block => block.sourceIds));
  for (const source of fresh.content.sources) {
    // Keep intentional page-level provenance and drop a superseded image pin.
    if (!fresh.content.blocks.some(block => block.sourceIds.includes(source.id))) keepSources.add(source.id);
  }
  if (title !== fresh.content.title || note) {
    for (const source of previous.content.sources.filter(source => source.recordId?.startsWith('workspace:'))) {
      sources.set(source.id, source);
      keepSources.add(source.id);
    }
  }
  return {
    content: slideContentSchema.parse({
      ...fresh.content, title, blocks, isTestData: fresh.content.isTestData || previous.content.isTestData, sources: [...sources.values()].filter(source => keepSources.has(source.id)),
      subtitle: nextNote ? noteSubtitle(baseSubtitle, nextNote.text, fresh.content.locale) : baseSubtitle,
    }),
    note: nextNote,
  };
}

function sameElement(previous: Element, next: Element | undefined): next is Element {
  return !!next && previous.kind === next.kind &&
    (next.kind !== 'text' || previous.kind === 'text' && next.role === previous.role && next.purpose === previous.purpose) &&
    (next.kind !== 'shape' || previous.kind === 'shape' && next.shape === previous.shape && next.background === previous.background);
}

export function carryPageGeometry(previous: SlideScene, rendered: SlideScene) {
  const authored = previous.elements.some(element => element.editorId);
  if (authored && previous.elements.length !== rendered.elements.length) throw new Error('PITCH_EDITION_LAYOUT');
  const elements = authored ? previous.elements.map((element, index) => {
    const source = element.editorId ? Number(element.editorId.slice('object-'.length)) - 1 : index;
    const replacement = rendered.elements[source];
    if (!sameElement(element, replacement)) throw new Error('PITCH_EDITION_LAYOUT');
    if (element.kind === 'image' && replacement.kind === 'image') {
      // The renderer has already checked which images may be cropped.
      const crop = element.mediaAssetId === replacement.mediaAssetId && element.mediaVersion === replacement.mediaVersion
        ? { fit: element.fit, ...('focus' in element ? { focus: element.focus } : {}) } : {};
      return { ...replacement, ...crop, x: element.x, y: element.y, w: element.w, h: element.h,
        editorId: element.editorId, editorGroup: element.editorGroup, rotation: element.rotation, allowOverlap: element.allowOverlap };
    }
    if (element.kind === 'shape') return element;
    if (!element.editorId) return replacement;
    return { ...replacement, x: element.x, y: element.y, w: element.w, h: element.h,
      editorId: element.editorId, editorGroup: element.editorGroup };
  }) : rendered.elements.map((element, index) => {
    const prior = previous.elements[index];
    if (element.kind !== 'image' || prior?.kind !== 'image' || element.mediaAssetId !== prior.mediaAssetId
      || element.mediaVersion !== prior.mediaVersion) return element;
    return { ...element, fit: prior.fit, ...('focus' in prior ? { focus: prior.focus } : {}) };
  });
  const after = slideSceneSchema.safeParse({ ...rendered, elements });
  if (!after.success) throw new Error('PITCH_EDITION_LAYOUT');
  return after.data;
}

type EditionOptions = {
  current: WorkspaceDetail;
  baseline: Baseline;
  nextPeriod: string;
  fresh: Page[];
  recipeKeys: Record<string, string>;
  render(content: SlideContent, previous: SlideScene, fresh: SlideScene, original: SlideContent): Promise<SlideScene>;
};

export async function prepareProposalEdition({ current, baseline, nextPeriod, fresh, recipeKeys, render }: EditionOptions) {
  const base = new Map(baseline.pages.map(page => [page.slideId, page]));
  const activeRecipeKeys = new Set(baseline.pages.flatMap(page => page.recipeKey ? [page.recipeKey] : []));
  const previouslyRemoved = new Set(baseline.recipeKeys.filter(key => !activeRecipeKeys.has(key)));
  const output: Page[] = [];
  const remaining = new Map(fresh.filter(page => !previouslyRemoved.has(recipeKeys[page.id])).map(page => [page.id, page]));
  const settings: Settings = {};
  const preserved = new Map<string, string>();
  const usedAssets = new Set<string>();
  const oldPeriod = current.workspace.context.period;
  for (const previous of current.slides) {
    const original = base.get(previous.id);
    if (!original) throw new Error('PITCH_DENIED');
    const setting = current.workspace.page_settings[previous.id];
    const assetSlot = previous.asset_id + ':' + (previous.scene.pagination?.index ?? 0);
    if (original.ownerProjectId !== current.project.id || usedAssets.has(assetSlot) && !original.recipeKey) {
      const copy = { ...previous, id: randomUUID() };
      output.push(copy);
      settings[copy.id] = setting ?? { origin: 'asset' };
      preserved.set(previous.id, copy.id);
      continue;
    }
    usedAssets.add(assetSlot);
    const matches = [...remaining.values()].filter(page => original.recipeKey
      ? recipeKeys[page.id] === original.recipeKey
      : pageLabel(original.content, previous.scene, oldPeriod) === pageLabel(page.content, page.scene, nextPeriod));
    if (matches.length !== 1) {
      if (matches.length > 1 || setting?.manual || setting?.note || previous.scene.elements.some(item => item.editorId)
        || changed(original.content.blocks, previous.content.blocks) || original.content.title !== previous.content.title)
        throw new Error('PITCH_EDITION_LAYOUT');
      continue;
    }
    const page = matches[0];
    remaining.delete(page.id);
    const { content, note } = carryPageContent(previous, original.content, page, setting?.note);
    const scene = await render(content, previous.scene, page.scene, page.content);
    output.push({ ...page, content, scene });
    preserved.set(previous.id, page.id);
    settings[page.id] = { ...setting, note, origin: 'data' };
  }
  // Keep the prior order. New recipe pages go before their next surviving recipe neighbour.
  for (const [index, page] of fresh.entries()) {
    if (!remaining.has(page.id)) continue;
    const next = fresh.slice(index + 1).find(item => output.some(existing => existing.id === item.id));
    const nextIndex = next ? output.findIndex(item => item.id === next.id) : -1;
    output.splice(nextIndex < 0 ? output.length : nextIndex, 0, page);
    settings[page.id] = { origin: 'data' };
  }
  if (!output.length || output.length > 50) throw new Error('PITCH_PAGE_LIMIT');
  return { pages: output, settings, preserved, activeSlide: preserved.get(current.workspace.active_slide ?? '') ?? output[0].id };
}
