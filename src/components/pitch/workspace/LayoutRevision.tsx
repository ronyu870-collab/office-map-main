/* eslint-disable @next/next/no-img-element -- authenticated slides are SVG rendered by the Pitch route. */
import { z } from "zod";
import { legacyLayoutIds, slideSceneSchema } from "@/src/lib/pitch/contracts/scene";
import { LAYOUTS } from "@/src/lib/pitch/layout/definitions";
import { saveSchema, type WorkspaceDetail } from "@/src/lib/pitch/workspace/protocol";
import { WorkspaceError, type Call } from "./client";
import styles from "./workspace.module.css";

const range = /^(?:请)?(?:重新设计|重排)\s*第?\s*(\d{1,2})\s*页?\s*(?:(?:至|到|[-–—])\s*第?\s*(\d{1,2})\s*)?页$/u;
const englishRange = /^redesign\s+slides?\s+(\d{1,2})(?:\s*(?:to|through|[-–—])\s*(\d{1,2}))?$/i;
const currentPage = /^(?:(?:这(?:一)?页|当前页)(?:太丑|不够好看)?[，, ]*)?(?:换(?:一?种|个)?|调整)(?:设计|版式|布局)$/u;
const selectedPages = /^(?:请)?(?:重新设计|重排)\s*(?:所选|选中的?)页面$/u;
const legacyLayouts = new Set<string>(legacyLayoutIds);
const previewSchema = z.object({
  svg: z.string().startsWith("<svg"), scene: slideSceneSchema, pageCount: z.number().int().positive(),
});

export function requestedLayoutPages(question: string, detail: WorkspaceDetail, active: string | undefined, selected: string[]) {
  const text = question.normalize("NFKC").trim().replace(/[。.!！]$/u, "").trim();
  const numbers = range.exec(text) ?? englishRange.exec(text);
  if (numbers) {
    const first = Number(numbers[1]), last = Number(numbers[2] ?? first);
    if (first < 1 || last < first || last > detail.slides.length) throw new Error("页码不在当前提案范围内。请核对后重新预览。");
    return detail.slides.slice(first - 1, last).map(page => page.id);
  }
  if (selectedPages.test(text)) {
    if (!selected.length) throw new Error("请先在左侧选择要重新设计的页面。");
    return selected;
  }
  if (currentPage.test(text) || /^(?:请)?(?:重新设计|重排)(?:这(?:一)?页|当前页)$/u.test(text) || /^redesign (?:this|the current) slide$/i.test(text)) {
    if (!active) throw new Error("请先选择要重新设计的页面。");
    return [active];
  }
  return undefined;
}

type LayoutChoice = { layoutId: string; variant: "standard" | "alternate" };
type LayoutChange = LayoutChoice & { id: string; position: number; svg: string; scene: WorkspaceDetail["slides"][number]["scene"] };
export type LayoutReview = { status: "layout-review"; changes: LayoutChange[]; command: z.infer<typeof saveSchema> };

function layoutChoices(slide: WorkspaceDetail["slides"][number]): LayoutChoice[] {
  const { layoutId, variant } = slide.scene;
  const sibling: LayoutChoice[] = legacyLayouts.has(layoutId) ? [{ layoutId, variant: variant === "alternate" ? "standard" : "alternate" }] : [];
  if (layoutId === "cover" || layoutId === "section-divider") return sibling;
  const alternatives = LAYOUTS.filter(layout => layout.id !== layoutId && layout.id !== "cover" && layout.id !== "section-divider"
    && slide.content.blocks.every(block => layout.kinds.includes(block.kind)));
  return [...sibling, ...alternatives.map<LayoutChoice>(layout => ({ layoutId: layout.id, variant: "standard" }))].slice(0, 4);
}

export async function reviewLayoutChanges(call: Call, detail: WorkspaceDetail, ids: string[], signal: AbortSignal): Promise<LayoutReview> {
  const project = detail.project;
  const selected = detail.slides.flatMap((slide, position) => ids.includes(slide.id) ? [{ slide, position }] : []);
  if (selected.length !== ids.length) throw new Error("选择的页面已变化，请重新选择。");
  if (detail.slides.some(({ scene }) => scene.themeId !== project.theme_id || scene.themeVersion !== project.theme_version)) {
    throw new Error("此提案包含不同主题版本的页面。请先在设计面板核对主题。");
  }
  const blocked = selected.find(({ slide }) => slide.content.disclosure === "restricted" ||
    (slide.scene.pagination?.count ?? 1) !== 1 || slide.scene.elements.some(element => element.editorId));
  if (blocked) {
    throw new Error(`第 ${blocked.position + 1} 页含受限资料、跨页内容或手调对象。请先核对该页，再选择其他页面重新设计。`);
  }

  const changes: LayoutChange[] = [];
  for (const { slide, position } of selected) {
    let changed = false;
    for (const choice of layoutChoices(slide)) {
      signal.throwIfAborted();
      try {
        const { svg, scene, pageCount } = previewSchema.parse(await call({
          action: "preview", projectId: project.id, page: position, ...choice,
        }, true, "", signal));
        if (pageCount !== 1 || scene.layoutId !== choice.layoutId || (scene.variant ?? "standard") !== choice.variant ||
          scene.themeId !== slide.scene.themeId || scene.themeVersion !== slide.scene.themeVersion ||
          JSON.stringify(scene.elements) === JSON.stringify(slide.scene.elements)) continue;
        changes.push({ id: slide.id, position, ...choice, svg, scene });
        changed = true;
        break;
      } catch (error) {
        if (!(error instanceof WorkspaceError && error.status === 422)) throw error;
      }
    }
    if (!changed) throw new Error(`第 ${position + 1} 页没有适配现有内容的单页版式。请在设计面板查看可用布局。`);
  }

  const byId = new Map(changes.map(change => [change.id, change]));
  const command = saveSchema.parse({
    action: "save", projectId: project.id, expectedVersion: project.version, title: project.title,
    themeId: project.theme_id, themeVersion: project.theme_version, context: detail.workspace.context,
    activeSlide: detail.workspace.active_slide,
    pages: detail.slides.map(({ id }) => {
      const change = byId.get(id);
      return change ? { id, layoutId: change.layoutId, variant: change.variant } : { id };
    }),
  });
  return { status: "layout-review", changes, command };
}

export function matchesAppliedLayout(review: LayoutReview, before: WorkspaceDetail, after: WorkspaceDetail) {
  return after.project.id === before.project.id && after.project.version === before.project.version + 1 &&
    before.slides.length === after.slides.length && before.slides.every((slide, index) => {
      const saved = after.slides[index];
      const change = review.changes.find(candidate => candidate.id === slide.id);
      return saved.id === slide.id && JSON.stringify(saved.content) === JSON.stringify(slide.content) &&
        JSON.stringify(saved.scene) === JSON.stringify(change?.scene ?? slide.scene);
    });
}

export function LayoutRevisionReview({ review, detail }: { review: LayoutReview; detail: WorkspaceDetail }) {
  return <>
    <p>影响 {review.changes.length} 页</p>
    <ol className={styles.handoffPages}>
      {review.changes.map(change => {
        const label = LAYOUTS.find(layout => layout.id === change.layoutId)?.zh;
        return <li key={change.id}>
          <strong>第 {change.position + 1} 页 · {detail.slides[change.position].content.title}</strong>
          <p>{label}{change.variant === "alternate" && " · 替换布局"}</p>
          <img className={styles.revisionSlide} src={"data:image/svg+xml;charset=utf-8," + encodeURIComponent(change.svg)}
            alt={`第 ${change.position + 1} 页新布局预览`} loading="lazy" />
        </li>;
      })}
    </ol>
  </>;
}
