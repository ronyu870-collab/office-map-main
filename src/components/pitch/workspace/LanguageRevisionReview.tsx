import { useId, useState } from "react";
import { z } from "zod";
import { Button } from "@/src/components/ui";
import { workspaceResponseSchema, type WorkspaceResponse } from "./client";
import styles from "./workspace.module.css";

const locale = z.enum(["zh", "en"]);
const version = z.number().int().positive();
const fingerprint = z.string().regex(/^[0-9a-f]{64}$/);
const ref = z.string().regex(/^[a-z][a-z0-9:_-]{0,79}$/i);
const entryId = ({ pageId, ref }: { pageId: string; ref: string }) => pageId + ":" + ref;
const languageTextSchema = z.strictObject({ pageId: z.uuid(), ref, text: z.string().trim().min(1).max(4000) });
const languageInputSchema = z.strictObject({
  projectId: z.uuid(), expectedVersion: version, question: z.string().trim().min(1).max(1000), currentPageId: z.uuid().optional(),
  competitorBuildingId: z.uuid().optional(), pageIds: z.array(z.uuid()).max(50), objectIds: z.array(z.string().min(1).max(160)).max(30),
  languageTexts: z.array(languageTextSchema).max(250).optional(),
});
type LanguageInput = z.infer<typeof languageInputSchema>;
export type LanguageTexts = z.infer<typeof languageTextSchema>[];
const page = z.object({ pageId: z.uuid(), pageVersion: version });
const translations = z.array(page.extend({
  original: z.string(), changes: z.array(z.object({ ref, before: z.string(), after: z.string() })),
})).max(50);
export const languageReviewSchema = z.object({
  status: z.literal("language-review"), language: locale, projectVersion: version, fingerprint,
  translated: translations,
  command: z.strictObject({ action: z.literal("proposal_apply_language"),
    confirmation: z.strictObject({ input: languageInputSchema, fingerprint }) }),
});
export const pendingLanguageSchema = z.object({
  status: z.literal("language-translation-required"), language: locale, translated: translations,
  pending: z.array(page.extend({ ref, text: z.string() })).min(1),
});
export const appliedLanguageSchema = z.object({ status: z.literal("language-applied"), workspace: workspaceResponseSchema });
type LanguageReview = z.infer<typeof languageReviewSchema>;
type PendingLanguage = z.infer<typeof pendingLanguageSchema>;
type Slide = WorkspaceResponse["slides"][number];

const wholeDeck = (question: string) =>
  /整套|全套|整份|全部(?:页面|幻灯片)|整个(?:提案|文稿)|whole deck|entire (?:deck|presentation)|all slides/i.test(question);

function getText(slide: Slide, key: string): unknown {
  const [scope, position, field, item, property] = key.split(":");
  if (scope === "title") return slide.content.title;
  if (scope === "subtitle") return slide.content.subtitle;
  const block = scope === "block" ? slide.content.blocks[Number(position)] : undefined;
  if (!block) return undefined;
  const index = Number(item);
  switch (block.kind) {
    case "paragraph": return field === undefined ? block.text : undefined;
    case "metric": return field === "label" ? block.label : undefined;
    case "image":
      if (field === "alt") return block.alt;
      return field === "caption" && "caption" in block ? block.caption : undefined;
    case "table":
      if (field === "column") return block.columns[index];
      return field === "cell" ? block.rows[index]?.[Number(property)] : undefined;
    case "chart":
      if (field === "category") return block.categories[index];
      if (field === "series") return block.series[index]?.name;
      if (field === "xaxis" && "xAxis" in block) return z.object({ label: z.string() }).safeParse(block.xAxis).data?.label;
      return undefined;
    case "map": return field === "point" ? block.points?.[index]?.label : undefined;
    case "timeline":
      return field === "entry" && (property === "title" || property === "description") ? block.entries[index]?.[property] : undefined;
    case "team":
      if (field !== "member") return undefined;
      if (property === "title") return block.members[index]?.title;
      return property === "bio" ? block.members[index]?.biography : undefined;
    case "case":
      return field === "title" || field === "challenge" || field === "approach" || field === "outcome" ? block[field] : undefined;
    case "insight":
      if (field === "claim" || field === "basis") return block[field];
      return field === "limitation" ? block.limitations[index] : undefined;
  }
}

function textNumbers(value: string) {
  return JSON.stringify(value.normalize("NFKC").match(/[-+]?\d+(?:[.,]\d+)*(?:\s*%)?/g)?.map(part => part.replace(/\s+/g, "")) ?? []);
}

export function matchesLanguageReview(review: LanguageReview | PendingLanguage, detail: WorkspaceResponse, input: LanguageInput) {
  const question = input.question.normalize("NFKC");
  const expectsEnglish = /(?:改|换|切换|翻译|translate|switch).{0,28}(?:英文版?|英语|English)/i.test(question);
  const expectsChinese = /(?:改|换|切换|翻译|translate|switch).{0,28}(?:中文版?|汉语|Chinese)/i.test(question);
  if (input.projectId !== detail.project.id || input.expectedVersion !== detail.project.version || input.objectIds.length ||
    input.competitorBuildingId || (review.language === "en" ? !expectsEnglish || expectsChinese : !expectsChinese || expectsEnglish)) return false;
  const target = new Set(wholeDeck(question) ? detail.slides.map(slide => slide.id) : input.pageIds.length
    ? input.pageIds : input.currentPageId ? [input.currentPageId] : []);
  const available = new Map(detail.slides.filter(slide => target.has(slide.id)).map(slide => [slide.id, slide]));
  const translatedIds = new Set(review.translated.map(item => item.pageId));
  if (!target.size || available.size !== target.size || translatedIds.size !== review.translated.length) return false;
  const reviewedText = new Map<string, string>();
  for (const item of review.translated) {
    const slide = available.get(item.pageId);
    if (!slide || slide.version !== item.pageVersion || slide.content.locale !== item.original || slide.content.disclosure !== "internal") return false;
    for (const change of item.changes) {
      const key = entryId({ pageId: item.pageId, ref: change.ref });
      if (reviewedText.has(key) || getText(slide, change.ref) !== change.before || textNumbers(change.before) !== textNumbers(change.after)) return false;
      reviewedText.set(key, change.after);
    }
  }
  if (review.status === "language-translation-required") {
    const pendingIds = new Set(review.pending.map(item => item.pageId));
    return [...available.values()].every(slide => slide.content.locale.split("-")[0] === review.language ||
      translatedIds.has(slide.id) || pendingIds.has(slide.id)) &&
      new Set(review.pending.map(entryId)).size === review.pending.length && review.pending.every(item => {
      const slide = available.get(item.pageId);
      return !!slide && slide.version === item.pageVersion && slide.content.disclosure === "internal" &&
        !reviewedText.has(entryId(item)) && getText(slide, item.ref) === item.text;
    });
  }
  const confirmation = review.command.confirmation;
  const parsed = languageInputSchema.safeParse(input);
  return (wholeDeck(question) || translatedIds.size > 0) && parsed.success &&
    [...available.values()].every(slide => slide.content.locale.split("-")[0] === review.language || translatedIds.has(slide.id)) &&
    review.projectVersion === detail.project.version && confirmation.fingerprint === review.fingerprint &&
    JSON.stringify(confirmation.input) === JSON.stringify(parsed.data) &&
    (input.languageTexts ?? []).every(item => {
      const original = available.get(item.pageId);
      return !!original && (reviewedText.get(entryId(item)) ?? getText(original, item.ref)) === item.text;
    });
}

const nonTextFields = new Set(["unit", "sourceIds", "mediaAssetId", "mapId", "snapshotVersion", "kind", "chartType", "fit", "treatment"]);
function dataShape(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(dataShape);
  if (typeof value === "object" && value !== null) return Object.fromEntries(Object.entries(value).map(([key, entry]) =>
    [key, nonTextFields.has(key) ? entry : dataShape(entry)]));
  return typeof value === "string" ? { text: true } : value;
}

const equal = (left: unknown, right: unknown) => JSON.stringify(left) === JSON.stringify(right);
const geometry = (slide: Slide) => slide.scene.elements.map(({ kind, x, y, w, h, editorId, editorGroup, ...rest }) =>
  [kind, x, y, w, h, editorId, editorGroup, "rotation" in rest ? rest.rotation : undefined]);

export function matchesAppliedLanguage(review: LanguageReview, previous: WorkspaceResponse, saved: WorkspaceResponse) {
  const targets = new Map(review.translated.map(item => [item.pageId, item]));
  const expected = wholeDeck(review.command.confirmation.input.question) ? review.language : previous.workspace.context.language;
  return saved.project.id === previous.project.id && saved.project.version === review.projectVersion + 1 &&
    saved.workspace.context.language === expected && saved.slides.length === previous.slides.length && saved.slides.every((slide, index) => {
      const prior = previous.slides[index];
      const target = targets.get(slide.id);
      if (slide.id !== prior.id) return false;
      if (!target) return equal(slide.content, prior.content) && equal(slide.scene, prior.scene);
      return slide.content.locale === review.language && target.changes.every(change => getText(slide, change.ref) === change.after) &&
        slide.scene.layoutId === prior.scene.layoutId && slide.scene.variant === prior.scene.variant &&
        slide.scene.themeId === prior.scene.themeId && slide.scene.themeVersion === prior.scene.themeVersion &&
        slide.content.dataAsOf === prior.content.dataAsOf && slide.content.disclosure === prior.content.disclosure &&
        equal(slide.content.sources, prior.content.sources) && equal(geometry(slide), geometry(prior)) &&
        equal(dataShape(slide.content.blocks), dataShape(prior.content.blocks));
    });
}

const names = { zh: "中文", en: "英文" };

export function LanguageRevisionReview({ review, detail }: { review: LanguageReview; detail: WorkspaceResponse }) {
  return <>
    <p>切换为{names[review.language]} · 更新 {review.translated.length} 页</p>
    <ol className={styles.handoffPages}>
      {review.translated.map(item => {
        const index = detail.slides.findIndex(slide => slide.id === item.pageId);
        return <li key={item.pageId}>
          <details open={review.translated.length === 1 ? true : undefined}>
            <summary>第 {index + 1} 页 · {detail.slides[index].content.title}</summary>
            {item.changes.map(change => <div className={styles.revisionColumns} key={change.ref}>
              <div><strong>原文</strong><p>{change.before}</p></div>
              <div><strong>译文</strong><p>{change.after}</p></div>
            </div>)}
          </details>
        </li>;
      })}
    </ol>
  </>;
}

export function PendingLanguageRevision({ review, detail, submit, busy }: {
  review: PendingLanguage; detail: WorkspaceResponse; submit: (texts: LanguageTexts) => void; busy: boolean;
}) {
  const labelPrefix = useId();
  const [values, setValues] = useState<Record<string, string>>({});
  if (review.pending.length > 250) return <p>待补译文较多，请选择更少的页面后重新预览。</p>;
  const completed = review.pending.every(item => values[entryId(item)]?.trim());
  return <form className={styles.form} onSubmit={event => {
    event.preventDefault();
    if (completed && !busy) submit(review.pending.map(item => ({
      pageId: item.pageId, ref: item.ref, text: values[entryId(item)].trim(),
    })));
  }}>
    <p>补充{names[review.language]}译文，再核对修改。</p>
    {review.pending.map((item, position) => {
      const key = entryId(item);
      const labelId = `${labelPrefix}-${position}`;
      const index = detail.slides.findIndex(slide => slide.id === item.pageId);
      return <label key={key}>
        <span id={labelId}>第 {index + 1} 页 · {item.text}</span>
        <textarea aria-labelledby={labelId} rows={2} maxLength={4000} required disabled={busy} value={values[key] ?? ""}
          onChange={event => {
            const text = event.target.value;
            setValues(prior => ({ ...prior, [key]: text }));
          }} />
      </label>;
    })}
    <Button type="submit" variant="secondary" disabled={!completed || busy}>预览译文</Button>
  </form>;
}
