import { useState } from "react";
import { z } from "zod";
import { Button } from "@/src/components/ui";
import { proposalRevisionRequestSchema, readProposalEdit, type ProposalRevisionRequest } from "@/src/lib/pitch/ai/proposal-edit-intent";
import { localizeProposalContent, sameTranslationNumbers } from "@/src/lib/pitch/ai/proposal-language-content";
import { workspaceDetailSchema, type WorkspaceDetail } from "@/src/lib/pitch/workspace/protocol";
import styles from "./workspace.module.css";

const locale = z.enum(["zh", "en"]);
const version = z.number().int().positive();
const fingerprint = z.string().regex(/^[0-9a-f]{64}$/);
const ref = z.string().regex(/^[a-z][a-z0-9:_-]{0,79}$/i);
const page = z.object({ pageId: z.uuid(), pageVersion: version });
const translations = z.array(page.extend({
  original: z.string(),
  changes: z.array(z.object({ ref, before: z.string(), after: z.string() })),
})).max(50);

export const languageReviewSchema = z.object({
  status: z.literal("language-review"), language: locale, projectVersion: version, fingerprint, translated: translations,
  command: z.strictObject({
    action: z.literal("proposal_apply_language"),
    confirmation: z.strictObject({ input: proposalRevisionRequestSchema, fingerprint }),
  }),
});
export const pendingLanguageSchema = z.object({
  status: z.literal("language-translation-required"), language: locale, translated: translations,
  pending: z.array(page.extend({ ref, text: z.string() })).min(1),
});
export const appliedLanguageSchema = z.object({ status: z.literal("language-applied"), workspace: workspaceDetailSchema });
type LanguageReview = z.infer<typeof languageReviewSchema>;
type PendingLanguage = z.infer<typeof pendingLanguageSchema>;
export type LanguageTexts = NonNullable<ProposalRevisionRequest["languageTexts"]>;

const equal = (left: unknown, right: unknown) => JSON.stringify(left) === JSON.stringify(right);
const geometry = (slide: WorkspaceDetail["slides"][number]) => slide.scene.elements.map(
  ({ kind, x, y, w, h, editorId, editorGroup, ...rest }) => [kind, x, y, w, h, editorId, editorGroup,
    "rotation" in rest ? rest.rotation : undefined, "allowOverlap" in rest ? rest.allowOverlap : undefined],
);

export function matchesLanguageReview(value: LanguageReview | PendingLanguage, detail: WorkspaceDetail, input: ProposalRevisionRequest) {
  const intent = readProposalEdit(input);
  if (input.projectId !== detail.project.id || input.expectedVersion !== detail.project.version ||
    intent.kind !== "intent" || intent.target.kind === "objects" || intent.operations.length !== 1 ||
    intent.operations[0].kind !== "set-language" || intent.operations[0].language !== value.language) return false;
  const target = intent.target.kind === "pages" ? new Set(intent.target.pageIds) : new Set(detail.slides.map(slide => slide.id));
  const available = new Map(detail.slides.filter(slide => target.has(slide.id)).map(slide => [slide.id, slide]));
  const translatedIds = new Set(value.translated.map(item => item.pageId));
  if (!target.size || available.size !== target.size || translatedIds.size !== value.translated.length) return false;

  const originalText = new Map<string, string>();
  for (const slide of available.values()) {
    localizeProposalContent(slide.content, value.language, (ref, text) => {
      originalText.set(`${slide.id}:${ref}`, text);
      return text;
    });
  }
  const reviewedText = new Map<string, string>();
  const editableVersion = ({ pageId, pageVersion }: { pageId: string; pageVersion: number }) => {
    const slide = available.get(pageId);
    return slide?.version === pageVersion && slide.content.disclosure === "internal" ? slide : undefined;
  };
  for (const item of value.translated) {
    if (editableVersion(item)?.content.locale !== item.original) return false;
    for (const change of item.changes) {
      const key = `${item.pageId}:${change.ref}`;
      if (reviewedText.has(key) || originalText.get(key) !== change.before || !sameTranslationNumbers(change.before, change.after)) return false;
      reviewedText.set(key, change.after);
    }
  }
  if (value.status === "language-translation-required") {
    const pendingKeys = new Set<string>();
    const pendingIds = new Set<string>();
    for (const item of value.pending) {
      const key = `${item.pageId}:${item.ref}`;
      if (!editableVersion(item) || pendingKeys.has(key) || reviewedText.has(key) || originalText.get(key) !== item.text) return false;
      pendingKeys.add(key);
      pendingIds.add(item.pageId);
    }
    return [...available.values()].every(slide => slide.content.locale.split("-")[0] === value.language ||
      translatedIds.has(slide.id) || pendingIds.has(slide.id));
  }

  const confirmation = value.command.confirmation;
  return (intent.target.kind === "deck" || translatedIds.size > 0) &&
    [...available.values()].every(slide => slide.content.locale.split("-")[0] === value.language || translatedIds.has(slide.id)) &&
    value.projectVersion === detail.project.version && confirmation.fingerprint === value.fingerprint &&
    equal(confirmation.input, proposalRevisionRequestSchema.parse(input)) &&
    (input.languageTexts ?? []).every(item => {
      const key = `${item.pageId}:${item.ref}`;
      return (reviewedText.get(key) ?? originalText.get(key)) === item.text;
    });
}

export function matchesAppliedLanguage(review: LanguageReview, previous: WorkspaceDetail, saved: WorkspaceDetail) {
  const intent = readProposalEdit(review.command.confirmation.input);
  if (intent.kind !== "intent") return false;
  const targets = new Map(review.translated.map(item => [item.pageId, item]));
  const expectedLanguage = intent.target.kind === "deck" ? review.language : previous.workspace.context.language;
  return saved.project.id === previous.project.id && saved.project.version === review.projectVersion + 1 &&
    saved.workspace.context.language === expectedLanguage && saved.slides.length === previous.slides.length &&
    saved.slides.every((slide, index) => {
      const prior = previous.slides[index];
      const target = targets.get(slide.id);
      if (slide.id !== prior.id) return false;
      if (!target) return equal(slide.content, prior.content) && equal(slide.scene, prior.scene);
      const translations = new Map(target.changes.map(change => [change.ref, change.after]));
      const content = localizeProposalContent(prior.content, review.language, (ref, text) => translations.get(ref) ?? text);
      return equal(slide.content, content) && equal(geometry(slide), geometry(prior)) &&
        slide.scene.layoutId === prior.scene.layoutId && slide.scene.variant === prior.scene.variant &&
        slide.scene.themeId === prior.scene.themeId && slide.scene.themeVersion === prior.scene.themeVersion;
    });
}

const languageName = { zh: "中文", en: "英文" };

export function LanguageRevisionReview({ review, detail }: { review: LanguageReview; detail: WorkspaceDetail }) {
  return <>
    <p>切换为{languageName[review.language]} · 更新 {review.translated.length} 页</p>
    <ol className={styles.handoffPages}>
      {review.translated.map(item => {
        const index = detail.slides.findIndex(slide => slide.id === item.pageId);
        return <li key={item.pageId}>
          <strong>第 {index + 1} 页 · {detail.slides[index].content.title}</strong>
          {item.changes.map(change => <div className={styles.revisionColumns} key={change.ref}>
            <div><strong>原文</strong><p>{change.before}</p></div>
            <div><strong>译文</strong><p>{change.after}</p></div>
          </div>)}
        </li>;
      })}
    </ol>
  </>;
}

export function PendingLanguageRevision({ review, detail, submit, busy }: {
  review: PendingLanguage; detail: WorkspaceDetail; submit: (texts: LanguageTexts) => void; busy: boolean;
}) {
  const [values, setValues] = useState<Record<string, string>>({});
  if (review.pending.length > 250) return <p>待补译文较多，请选择更少的页面后重新预览。</p>;
  const completed = review.pending.every(item => values[`${item.pageId}:${item.ref}`]?.trim());
  return <form className={styles.form} onSubmit={event => {
    event.preventDefault();
    if (completed && !busy) submit(review.pending.map(({ pageId, ref }) => ({
      pageId, ref, text: values[`${pageId}:${ref}`].trim(),
    })));
  }}>
    <p>补充{languageName[review.language]}译文后，在同一工作台核对修改。</p>
    {review.pending.map(item => {
      const key = `${item.pageId}:${item.ref}`;
      const index = detail.slides.findIndex(slide => slide.id === item.pageId);
      return <label key={key}>
        <span>第 {index + 1} 页 · {item.text}</span>
        <textarea rows={2} maxLength={4000} required disabled={busy} value={values[key] ?? ""}
          onChange={event => {
            const text = event.target.value;
            setValues(prior => ({ ...prior, [key]: text }));
          }} />
      </label>;
    })}
    <Button type="submit" variant="secondary" disabled={!completed || busy}>预览译文</Button>
  </form>;
}
