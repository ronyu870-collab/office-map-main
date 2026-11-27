import { createHash } from "node:crypto";
import { slideContentSchema, type SlideContent } from "../contracts/content";
import { layoutIdSchema, slideSceneSchema, type SceneElement } from "../contracts/scene";
import { pitchRpc, type PitchContext } from "../data/store";
import { studioRegistry } from "../data/renderWorkflow";
import { layoutSlides } from "../layout/engine";
import { LayoutError } from "../layout/metrics";
import type { CanvasServices, RevisionPage, RevisionWorkspace } from "./proposal-canvas-services";
import type { ProposalEditTarget, ProposalRevisionRequest } from "./proposal-edit-intent";
import { knownTranslation, localizeProposalContent, sameTranslationNumbers, type ProposalLanguage } from "./proposal-language-content";

const compactText = (text: string) => text.replace(/\s+/gu, "");
const geometry = new Set(["x", "y", "w", "h", "editorId", "editorGroup", "rotation", "allowOverlap"]);
function elementKey(element: SceneElement) {
  const value = { ...element };
  if (value.kind === "text") value.text = compactText(value.text);
  return JSON.stringify(Object.entries(value).filter(([key]) => !geometry.has(key)));
}

async function preserveCanvas(ctx: PitchContext, page: RevisionPage, content: SlideContent) {
  const layout = layoutIdSchema.safeParse(page.scene.layoutId);
  if (!layout.success) return null;
  try {
    const { theme } = await studioRegistry(ctx, page.scene.themeId, page.scene.themeVersion);
    const before = await layoutSlides(page.content, theme.definition, layout.data, page.scene.variant);
    const after = await layoutSlides(content, theme.definition, layout.data, page.scene.variant);
    const edition = page.scene.pagination?.index ?? 0;
    if (before.length !== (page.scene.pagination?.count ?? 1) || after.length !== before.length) return null;
    const original = before[edition]?.elements, translated = after[edition]?.elements;
    if (!original || !translated || original.length !== translated.length) return null;
    const saved = page.scene.elements.map(elementKey);
    const elements = [...page.scene.elements];
    const applied = new Set<number>();
    for (const [index, element] of original.entries()) {
      ctx.signal.throwIfAborted();
      const next = translated[index];
      const key = elementKey(element);
      if (key === elementKey(next)) continue;
      if (next.kind !== element.kind || !["text", "image", "table", "chart", "map"].includes(element.kind)) return null;
      const possible = saved.flatMap((candidate, position) => candidate === key ? [position] : []);
      const atOriginalPosition = possible.find(position => {
        const savedElement = elements[position];
        return !savedElement.editorId && savedElement.x === element.x && savedElement.y === element.y;
      });
      const position = possible.length === 1 ? possible[0] : atOriginalPosition ?? -1;
      if (position < 0 || applied.has(position)) return null;
      const previous = elements[position];
      const { x, y, w, h, editorId, editorGroup } = previous;
      if (previous.kind === "text" && next.kind === "text") {
        elements[position] = { ...previous, text: next.text };
      } else if (previous.kind === "image" && next.kind === "image") {
        if (previous.mediaAssetId !== next.mediaAssetId || previous.mediaVersion !== next.mediaVersion) return null;
        elements[position] = { ...previous, alt: next.alt };
      } else {
        elements[position] = { ...next, x, y, w, h, editorId, editorGroup };
      }
      applied.add(position);
    }
    const parsed = slideSceneSchema.safeParse({ ...page.scene, elements });
    return parsed.success ? parsed.data : null;
  } catch (error) {
    if (error instanceof LayoutError) return null;
    throw error;
  }
}

async function reviewedWords(ctx: PitchContext, current: RevisionWorkspace, page: RevisionPage,
  requested: ProposalLanguage, receipt?: NonNullable<ProposalRevisionRequest["languageReceipts"]>[number],
) {
  if (!receipt) return new Map<string, { before: string; after: string }>();
  const { getReviewedCanvasText } = await import("./workflow");
  const reviewed = await getReviewedCanvasText(ctx, receipt.taskId, receipt.fingerprint);
  const { project } = current;
  if (reviewed.assetId !== page.asset_id || reviewed.assetVersion !== page.asset_version || reviewed.content.locale !== requested ||
    reviewed.scope.organizationId !== project.organization_id || reviewed.scope.region !== project.region ||
    reviewed.scope.city !== project.city || reviewed.scope.businessLine !== project.business_line) throw new Error("PITCH_CONFLICT");
  return new Map(reviewed.changes.flatMap(change => change.before === null ? [] :
    [[change.id, { before: change.before, after: change.after }]] as const));
}

export async function reviewProposalLanguage(ctx: PitchContext, current: RevisionWorkspace, input: ProposalRevisionRequest,
  target: ProposalEditTarget, language: ProposalLanguage, services: CanvasServices, confirmed?: string,
) {
  if (target.kind === "objects") return { status: "clarification" as const, message: "请指定要切换语言的页面或整套提案。" };
  const selectedIds = new Set(target.kind === "deck" ? current.slides.map(page => page.id) : target.pageIds);
  const selected = current.slides.filter(page => selectedIds.has(page.id));
  const supplied = input.languageTexts ?? [], receipts = input.languageReceipts ?? [];
  if (!selected.length || selected.length !== selectedIds.size ||
    [...supplied, ...receipts].some(entry => !selectedIds.has(entry.pageId))) throw new Error("PITCH_INVALID");
  const pending: { pageId: string; pageVersion: number; ref: string; text: string }[] = [];
  const translated: { pageId: string; pageVersion: number; original: string; changes: { ref: string; before: string; after: string }[] }[] = [];
  const reviewedPages: { before: RevisionPage; content: SlideContent }[] = [];
  const used = new Set<string>();
  for (const page of selected) {
    ctx.signal.throwIfAborted();
    const alreadyLocalized = page.content.locale.split("-")[0] === language;
    if (page.content.disclosure !== "internal") {
      if (alreadyLocalized) continue;
      if (confirmed) throw new Error("PITCH_CONFLICT");
      return { status: "unavailable" as const, message: "所选范围包含按特定披露条件审批的页面。译文需要单独核对。" };
    }
    const variants = new Map(supplied.filter(entry => entry.pageId === page.id).map(entry => [entry.ref, entry.text]));
    const approved = await reviewedWords(ctx, current, page, language, receipts.find(receipt => receipt.pageId === page.id));
    const changes: { ref: string; before: string; after: string }[] = [];
    const content = localizeProposalContent(page.content, language, (ref, before) => {
      const provided = variants.get(ref);
      const candidate = approved.get(ref);
      const after = provided ?? (candidate?.before === before ? candidate.after : knownTranslation(before, language));
      if (after === undefined) {
        pending.push({ pageId: page.id, pageVersion: page.version, ref, text: before });
        return before;
      }
      if (!sameTranslationNumbers(before, after)) throw new Error("PITCH_INVALID");
      if (provided !== undefined) used.add(page.id + ":" + ref);
      if (before !== after) changes.push({ ref, before, after });
      return after;
    });
    if (alreadyLocalized && !changes.length) continue;
    reviewedPages.push({ before: page, content });
    translated.push({ pageId: page.id, pageVersion: page.version, original: page.content.locale, changes });
  }
  if (used.size !== supplied.length) throw new Error("PITCH_INVALID");
  if (pending.length) {
    if (confirmed) throw new Error("PITCH_CONFLICT");
    return { status: "language-translation-required" as const, language, pending, translated };
  }
  const projectLanguage = target.kind === "deck" ? language : undefined;
  if (!reviewedPages.length && (!projectLanguage || current.workspace.context.language === language)) {
    if (confirmed) throw new Error("PITCH_CONFLICT");
    return { status: "unavailable" as const, message: "所选内容已使用此语言。" };
  }
  const updated: RevisionPage[] = [];
  for (const { before, content } of reviewedPages) {
    const parsed = slideContentSchema.safeParse(content);
    if (!parsed.success) throw new Error("PITCH_INVALID");
    const scene = await preserveCanvas(ctx, before, parsed.data);
    if (!scene) {
      if (confirmed) throw new Error("PITCH_CONFLICT");
      return { status: "unavailable" as const, message: "译文超出原版面，或现有对象无法与译文对应。请核对该页的文字长度。", pageId: before.id };
    }
    const page = { ...before, content: parsed.data, scene };
    await services.verifyPage(ctx, current.project.id, page);
    updated.push(page);
  }
  for (const receipt of receipts) await pitchRpc(ctx, { action: "ai_result", taskId: receipt.taskId });
  const fingerprint = createHash("sha256").update(JSON.stringify([current.project.id, current.project.version,
    language, target.kind, translated, receipts, updated.map(page => [page.id, page.version, page.content, page.scene])])).digest("hex");
  ctx.signal.throwIfAborted();
  if (confirmed) {
    if (confirmed !== fingerprint) throw new Error("PITCH_CONFLICT");
    return { status: "language-applied" as const, workspace: await services.persist(ctx, current, updated, projectLanguage) };
  }
  return { status: "language-review" as const, language, projectVersion: current.project.version, translated, fingerprint,
    command: { action: "proposal_apply_language" as const, confirmation: { input, fingerprint } } };
}
