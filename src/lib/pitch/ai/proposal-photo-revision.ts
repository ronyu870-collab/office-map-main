import { createHash } from "node:crypto";
import { z } from "zod";
import { slideContentSchema, type SlideContent, type SourceReference } from "../contracts/content";
import { layoutIdSchema, slideSceneSchema, type SlideScene } from "../contracts/scene";
import { pitchRpc, type PitchContext } from "../data/store";
import { studioRegistry } from "../data/renderWorkflow";
import { layoutSlides } from "../layout/engine";
import { LayoutError } from "../layout/metrics";
import { assertSceneQuality } from "../layout/quality";
import { objectId } from "../workspace/object-layout";
import type { WorkspaceDetail } from "../workspace/protocol";
import { getWorkspace } from "../workspace/workflow";
import type { ProposalEditIntent, ProposalEditTarget, ProposalRevisionRequest } from "./proposal-edit-intent";

const fingerprintSchema = z.string().regex(/^[a-f0-9]{64}$/);
type PhotoCategory = Extract<ProposalEditIntent, { kind: "replace-photo" }>["category"];
type Image = Extract<SlideContent["blocks"][number], { kind: "image" }>;
type Page = WorkspaceDetail["slides"][number] & { version: number };
type PhotoWorkspace = Omit<WorkspaceDetail, "slides"> & { slides: Page[] };
const photoPin = z.object({
  id: z.uuid(), version: z.number().int().positive(), versionHash: fingerprintSchema, contentHash: fingerprintSchema,
  kind: z.literal("photo"), buildingIds: z.tuple([z.uuid()]),
  origin: z.object({ type: z.literal("building-photo"), buildingId: z.uuid(), photoId: z.uuid() }),
}).refine(pin => pin.buildingIds[0] === pin.origin.buildingId);
const sourcePin = z.object({ visual: photoPin });
type PhotoPin = z.infer<typeof photoPin>;

export type ProposalPhotoCandidate = { category: string; source: SourceReference };
export type ProposalPhotoServices = {
  readChoices(ctx: PitchContext, buildingId: string, category: PhotoCategory, usedHashes: readonly string[]): Promise<readonly ProposalPhotoCandidate[]>;
  resolve(ctx: PitchContext, source: SourceReference): Promise<{ image: Image; source: SourceReference }>;
  verifyPage(ctx: PitchContext, projectId: string, page: Page): Promise<void>;
  persist(ctx: PitchContext, current: PhotoWorkspace, updated: Page[]): Promise<WorkspaceDetail>;
};

type PhotoWorkspaceBinding = Pick<ProposalPhotoServices, "readChoices" | "resolve"> & {
  readPageMedia(ctx: PitchContext, projectId: string, page: Page): Promise<Parameters<typeof assertSceneQuality>[2]>;
  commitPayload(ctx: PitchContext, current: PhotoWorkspace, pages: Page[], settings: PhotoWorkspace["workspace"]["page_settings"]):
    Promise<Record<string, unknown>>;
};

export function createWorkspacePhotoServices(binding: PhotoWorkspaceBinding): ProposalPhotoServices {
  const { readChoices, resolve, readPageMedia, commitPayload } = binding;
  return {
    readChoices,
    resolve,
    async verifyPage(ctx, projectId, page) {
      const { theme } = await studioRegistry(ctx, page.scene.themeId, page.scene.themeVersion);
      await assertSceneQuality(page.scene, theme.definition, await readPageMedia(ctx, projectId, page));
    },
    async persist(ctx, current, updated) {
      const replacements = new Map(updated.map(page => [page.id, page]));
      const pages = current.slides.map(page => replacements.get(page.id) ?? page);
      const settings = { ...current.workspace.page_settings };
      for (const page of updated) settings[page.id] = { ...settings[page.id], manual: true };
      const payload = await commitPayload(ctx, current, pages, settings);
      if (payload.projectId !== current.project.id || payload.expectedVersion !== current.project.version) throw new Error("PITCH_INVALID");
      await pitchRpc(ctx, { ...payload, action: "workspace_save" });
      return getWorkspace(ctx, current.project.id);
    },
  };
}

const capture = (source: SourceReference) => {
  const parsed = sourcePin.safeParse(source);
  if (!parsed.success) return null;
  const { visual } = parsed.data;
  return source.kind === "record" && source.sha256 === visual.contentHash && source.version === visual.versionHash &&
    source.recordId === visual.origin.photoId ? visual : null;
};
const sameImage = (image: Pick<Image, "mediaAssetId" | "mediaVersion">, pin: PhotoPin) =>
  image.mediaAssetId === pin.id && image.mediaVersion === pin.version;

function boundPhotos(page: Page) {
  return page.content.blocks.flatMap((image, blockIndex) => {
    if (image.kind !== "image") return [];
    const bound = page.content.sources.flatMap(source => {
      const pin = image.sourceIds.includes(source.id) ? capture(source) : null;
      return pin && sameImage(image, pin) ? [{ source, pin }] : [];
    });
    if (bound.length !== 1) return [];
    const objects = page.scene.elements.flatMap((element, index) =>
      element.kind === "image" && sameImage(element, bound[0].pin) ? [objectId(element, index)] : []);
    return objects.length === 1 ? [{ ...bound[0], image, blockIndex, object: objects[0] }] : [];
  });
}

function preserveObjects(original: Page, scene: SlideScene, selected: string, previous: Image, nextPin: PhotoPin) {
  if (scene.layoutId !== original.scene.layoutId || scene.layoutVersion !== original.scene.layoutVersion ||
    scene.themeId !== original.scene.themeId || scene.themeVersion !== original.scene.themeVersion ||
    scene.variant !== original.scene.variant || (scene.pagination?.count ?? 1) !== 1 ||
    scene.elements.length !== original.scene.elements.length) return false;
  const captions = z.object({ caption: z.string().optional(), credit: z.string().optional() }).parse(previous);
  const withoutWhitespace = (text: string) => text.replace(/\s+/gu, "");
  const originalCredits = [previous.alt, captions.caption, captions.credit].flatMap(credit => credit ? [withoutWhitespace(credit)] : []);
  return original.scene.elements.every((element, index) => {
    const next = scene.elements[index];
    if (objectId(next, index) !== objectId(element, index) || element.editorGroup !== next.editorGroup ||
      element.kind !== next.kind || element.x !== next.x || element.y !== next.y || element.w !== next.w || element.h !== next.h) return false;
    if (objectId(element, index) === selected) {
      return element.kind === "image" && next.kind === "image" && sameImage(next, nextPin) &&
        element.rotation === next.rotation && element.allowOverlap === next.allowOverlap;
    }
    if (element.kind === "text" && next.kind === "text" && (element.purpose === "source" ||
      (!element.editorId && element.role === "body" && originalCredits.some(credit => withoutWhitespace(element.text).includes(credit))))) {
      return JSON.stringify({ ...element, text: next.text }) === JSON.stringify(next);
    }
    return JSON.stringify(element) === JSON.stringify(next);
  });
}

function replacePhotoAndGeneratedCaptions(content: SlideContent, previous: Image, replacement: Image, blockIndex: number) {
  const images = content.blocks.filter(block => block.kind === "image");
  return content.blocks.map((block, index) => {
    if (index === blockIndex) return replacement;
    if (block.kind !== "paragraph" || !previous.sourceIds.some(id => block.sourceIds.includes(id))) return block;
    const pictured = images.filter(image => image.sourceIds.every(id => block.sourceIds.includes(id)));
    const allSources = (photos: Image[]) => [...new Set(photos.flatMap(image => image.sourceIds))];
    if (!pictured.includes(previous) || allSources(pictured).join() !== block.sourceIds.join() ||
      pictured.map(image => image.alt).join(" · ") !== block.text) return block;
    const updated = pictured.map(image => image === previous ? replacement : image);
    return { ...block, text: updated.map(image => image.alt).join(" · "), sourceIds: allSources(updated) };
  });
}

/** Reconcile the renderer's photo and credit changes with the saved native
 * canvas. The caller verifies the final Scene and all its visual receipts. */
async function buildProposalPhotoScene(ctx: PitchContext, page: Page, content: SlideContent, selected: string) {
  const layout = layoutIdSchema.safeParse(page.scene.layoutId);
  if (!layout.success) return null;
  const changedIndex = page.scene.elements.findIndex((element, index) => objectId(element, index) === selected);
  const selectedImage = page.scene.elements[changedIndex];
  if (selectedImage?.kind !== "image") return null;
  try {
    const { theme } = await studioRegistry(ctx, page.scene.themeId, page.scene.themeVersion);
    const before = await layoutSlides(page.content, theme.definition, layout.data, page.scene.variant);
    const after = await layoutSlides(content, theme.definition, layout.data, page.scene.variant);
    if (before.length !== 1 || after.length !== 1 || before[0].elements.length !== after[0].elements.length) return null;
    const elements = [...page.scene.elements];
    const changed = new Set<number>();
    for (const [index, previous] of before[0].elements.entries()) {
      ctx.signal.throwIfAborted();
      const next = after[0].elements[index];
      if (JSON.stringify(previous) === JSON.stringify(next)) continue;
      if (previous.kind === "image" && next.kind === "image" &&
        previous.mediaAssetId === selectedImage.mediaAssetId && previous.mediaVersion === selectedImage.mediaVersion) {
        if (changed.has(changedIndex)) return null;
        const { x, y, w, h, editorId, editorGroup, rotation, allowOverlap } = selectedImage;
        elements[changedIndex] = { ...next, x, y, w, h, editorId, editorGroup, rotation, allowOverlap };
        changed.add(changedIndex);
      } else if (previous.kind === "text" && next.kind === "text") {
        if (previous.text === next.text) continue;
        const matches = page.scene.elements.flatMap((element, position) => element.kind === "text" &&
          element.purpose === previous.purpose && element.role === previous.role && element.text === previous.text ? [position] : []);
        if (matches.length !== 1 || changed.has(matches[0])) return null;
        const position = matches[0];
        const anchor = elements[position];
        if (anchor.kind !== "text" || (anchor.editorId && anchor.purpose !== "source")) return null;
        elements[position] = { ...anchor, text: next.text };
        changed.add(position);
      } else {
        return null;
      }
    }
    if (!changed.has(changedIndex)) return null;
    const rendered = slideSceneSchema.safeParse({ ...page.scene, elements });
    return rendered.success ? rendered.data : null;
  } catch (error) {
    if (error instanceof LayoutError) return null;
    throw error;
  }
}

export async function reviewProposalPhotoReplacement(ctx: PitchContext, current: PhotoWorkspace,
  input: ProposalRevisionRequest, target: ProposalEditTarget, category: PhotoCategory,
  services: ProposalPhotoServices, confirmed?: string,
) {
  const incomplete = (status: "clarification" | "unavailable", message: string) => {
    if (confirmed) throw new Error("PITCH_CONFLICT");
    return { status, message };
  };
  const selectedIds = target.kind === "pages" ? target.pageIds : target.kind === "objects" ? [target.pageId] : current.slides.map(page => page.id);
  const selected = current.slides.filter(page => selectedIds.includes(page.id));
  if (!selected.length || selected.length !== selectedIds.length) throw new Error("PITCH_INVALID");
  const reads = new Map<string, Promise<readonly ProposalPhotoCandidate[]>>();
  const usedHashes = [...new Set(current.slides.flatMap(page => page.content.sources.flatMap(source => capture(source)?.contentHash ?? [])))];
  const changes = [];
  const updated: Page[] = [];
  for (const page of selected) {
    ctx.signal.throwIfAborted();
    const photos = boundPhotos(page);
    if (!photos.length && target.kind === "deck") continue;
    const choices = target.kind === "objects" ? photos.filter(photo => target.objectIds.includes(photo.object)) : photos;
    if (choices.length !== 1 || (target.kind === "objects" && target.objectIds.length !== 1)) {
      return incomplete("clarification", "请在每张要修改的页面上明确选择一张楼宇实景照片。");
    }
    if (page.content.disclosure !== "internal" || (page.scene.pagination?.count ?? 1) !== 1) {
      return incomplete("unavailable", "这张照片的版式或披露范围暂不支持原位替换。");
    }
    const old = choices[0];
    const { buildingId } = old.pin.origin;
    const lookup = reads.get(buildingId) ?? services.readChoices(ctx, buildingId, category, usedHashes.slice(0, 100));
    reads.set(buildingId, lookup);
    const candidates = await lookup;
    ctx.signal.throwIfAborted();
    const alternative = candidates.find(item => {
      const pin = capture(item.source);
      return pin && pin.origin.buildingId === buildingId && pin.id !== old.pin.id &&
        !usedHashes.includes(pin.contentHash) && (category === "any" || category === item.category);
    });
    if (!alternative) return incomplete("unavailable", "该楼宇目前没有符合要求且可核验的其他照片。");
    const asset = await services.resolve(ctx, alternative.source);
    ctx.signal.throwIfAborted();
    const nextPin = capture(asset.source);
    if (!nextPin || JSON.stringify(capture(alternative.source)) !== JSON.stringify(nextPin) ||
      !sameImage(asset.image, nextPin) || asset.image.sourceIds.join() !== asset.source.id) throw new Error("PITCH_CONFLICT");
    const blocks = replacePhotoAndGeneratedCaptions(page.content, old.image, asset.image, old.blockIndex);
    const keepPrevious = blocks.some(block => block.sourceIds.includes(old.source.id));
    const replacement = slideContentSchema.parse({ ...page.content, blocks,
      sources: [...page.content.sources.filter(source => keepPrevious || source.id !== old.source.id), asset.source] });
    const scene = await buildProposalPhotoScene(ctx, page, replacement, old.object);
    if (!scene || !preserveObjects(page, slideSceneSchema.parse(scene), old.object, old.image, nextPin)) {
      return incomplete("unavailable", "替换会影响原画布的对象绑定，请选择另一张照片或页面。");
    }
    const updatedPage = { ...page, content: replacement, scene };
    await services.verifyPage(ctx, current.project.id, updatedPage);
    ctx.signal.throwIfAborted();
    updated.push(updatedPage);
    changes.push({ pageId: page.id, pageVersion: page.version, objectId: old.object, buildingId,
      before: { caption: old.image.alt, pin: old.pin }, after: { caption: asset.image.alt, pin: nextPin, category: alternative.category,
        sourceLabel: asset.source.label } });
  }
  if (!updated.length) return incomplete("unavailable", "所选范围内没有可替换的楼宇实景照片。");
  const fingerprint = createHash("sha256").update(JSON.stringify([current.project.id, current.project.version,
    changes.map(change => [change.pageId, change.pageVersion, change.objectId, change.before.pin, change.after.pin]),
    updated.map(page => [page.content, page.scene])])).digest("hex");
  ctx.signal.throwIfAborted();
  if (confirmed) {
    if (confirmed !== fingerprint) throw new Error("PITCH_CONFLICT");
    return { status: "photo-applied" as const, workspace: await services.persist(ctx, current, updated) };
  }
  return { status: "photo-review" as const, projectId: current.project.id, projectVersion: current.project.version,
    changes, fingerprint, command: { action: "proposal_apply_photo" as const, confirmation: { input, fingerprint } } };
}
