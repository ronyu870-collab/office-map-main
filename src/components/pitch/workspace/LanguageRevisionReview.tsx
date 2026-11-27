import { useState } from "react";
import { z } from "zod";
import { Button } from "@/src/components/ui";
import { proposalRevisionRequestSchema, readProposalEdit, type ProposalRevisionRequest } from "@/src/lib/pitch/ai/proposal-edit-intent";
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

export function matchesLanguageReview(value: LanguageReview | PendingLanguage, detail: WorkspaceDetail, input: ProposalRevisionRequest) {
  const intent = readProposalEdit(input);
  if (intent.kind !== "intent" || intent.target.kind === "objects" || intent.operations.length !== 1 ||
    intent.operations[0].kind !== "set-language" || intent.operations[0].language !== value.language) return false;
  const target = intent.target.kind === "pages" ? new Set(intent.target.pageIds) : new Set(detail.slides.map(slide => slide.id));
  const original = new Map(detail.slides.map(slide => [slide.id, slide]));
  const matches = ({ pageId, pageVersion }: { pageId: string; pageVersion: number }) =>
    target.has(pageId) && original.get(pageId)?.version === pageVersion;
  if (new Set(value.translated.map(item => item.pageId)).size !== value.translated.length ||
    !value.translated.every(item => matches(item) && original.get(item.pageId)?.content.locale === item.original)) return false;
  if (value.status === "language-translation-required") {
    return new Set(value.pending.map(item => `${item.pageId}:${item.ref}`)).size === value.pending.length && value.pending.every(matches);
  }
  const confirmation = value.command.confirmation;
  return value.projectVersion === detail.project.version && confirmation.fingerprint === value.fingerprint &&
    JSON.stringify(confirmation.input) === JSON.stringify(proposalRevisionRequestSchema.parse(input));
}

export function matchesAppliedLanguage(review: LanguageReview, previous: WorkspaceDetail, saved: WorkspaceDetail) {
  const intent = readProposalEdit(review.command.confirmation.input);
  if (intent.kind !== "intent") return false;
  const targets = new Set(review.translated.map(item => item.pageId));
  const expectedLanguage = intent.target.kind === "deck" ? review.language : previous.workspace.context.language;
  return saved.project.id === previous.project.id && saved.project.version > review.projectVersion &&
    saved.workspace.context.language === expectedLanguage && saved.slides.length === previous.slides.length &&
    saved.slides.every((slide, index) => {
      const prior = previous.slides[index];
      return slide.id === prior.id && (targets.has(slide.id) ?
        slide.content.locale === review.language :
        slide.content.locale === prior.content.locale);
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
