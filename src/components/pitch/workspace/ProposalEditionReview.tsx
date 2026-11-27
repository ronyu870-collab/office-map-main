import { z } from "zod";
import { outlineQuarter, type WorkspaceDetail } from "@/src/lib/pitch/workspace/protocol";
import { BusinessEvidence, formalEvidenceValueSchema } from "./BusinessEvidence";
import styles from "./workspace.module.css";

const endpoint = z.object({
  id: z.uuid(), title: z.string().max(160), position: z.number().int().min(1).max(50), dataAsOf: z.iso.date(),
});
const changeSchema = z.object({ before: formalEvidenceValueSchema.optional(), after: formalEvidenceValueSchema.optional() })
  .refine(change => !!change.before || !!change.after);
export const proposalEditionReviewSchema = z.object({
  beforePeriod: outlineQuarter,
  afterPeriod: outlineQuarter,
  needsConclusionReview: z.boolean(),
  pages: z.array(z.object({
    before: endpoint.optional(), after: endpoint.optional(), changes: z.array(changeSchema), conclusionChanged: z.boolean(),
  }).refine(change => !!change.before || !!change.after)).max(100),
});
type Edition = z.infer<typeof proposalEditionReviewSchema>;

export function matchesEditionReview(review: Edition, detail: WorkspaceDetail, nextPeriod: string | null) {
  if (review.beforePeriod !== detail.workspace.context.period || review.afterPeriod !== nextPeriod ||
    review.beforePeriod === review.afterPeriod) return false;
  const oldIds = new Set<string>();
  const newIds = new Set<string>();
  const newPositions = new Set<number>();
  return review.pages.every(({ before, after, changes }) => {
    if (after) {
      if (newIds.has(after.id) || newPositions.has(after.position)) return false;
      newIds.add(after.id);
      newPositions.add(after.position);
    } else if (changes.some(change => change.after)) return false;
    if (!before) return changes.every(change => !change.before);
    const page = detail.slides[before.position - 1];
    if (page?.id !== before.id || oldIds.has(before.id) ||
      page.content.title !== before.title || page.content.dataAsOf !== before.dataAsOf) return false;
    oldIds.add(before.id);
    const values = page.content.blocks.flatMap(block => {
      const { sourceIds: _sources, ...evidence } = block;
      void _sources;
      const parsed = formalEvidenceValueSchema.safeParse(evidence);
      return parsed.success ? [JSON.stringify(parsed.data)] : [];
    });
    return changes.every(change => {
      if (!change.before) return true;
      const index = values.indexOf(JSON.stringify(change.before));
      if (index < 0) return false;
      values.splice(index, 1);
      return true;
    });
  });
}

export function ProposalEditionComparison({ review }: { review: Edition }) {
  return <section aria-label="季度改版对照">
    <p>{review.beforePeriod} → {review.afterPeriod} · {review.pages.length} 页有变化</p>
    {review.needsConclusionReview && <p role="status">请复核受数据更新影响的分析结论。</p>}
    {review.pages.map(({ before, after, changes, conclusionChanged }) => {
      const page = after ?? before;
      if (!page) return null;
      return <details key={before?.id ?? after?.id} className={styles.refreshChanges}>
        <summary>第 {page.position} 页 · {page.title}{!before ? " · 新增" : !after ? " · 移除" : ""}</summary>
        {before && after ? <p>{before.dataAsOf} → {after.dataAsOf}</p> : <p>数据截至 {page.dataAsOf}</p>}
        {conclusionChanged && <p>本页分析结论有变化。</p>}
        {changes.map(({ before, after }, index) => <div key={index} className={styles.revisionColumns}>
          <div><h4>更新前</h4>{before ? <BusinessEvidence block={before} /> : <p>本期没有此数据项。</p>}</div>
          <div><h4>更新后</h4>{after ? <BusinessEvidence block={after} /> : <p>本期没有此数据项。</p>}</div>
        </div>)}
      </details>;
    })}
  </section>;
}
