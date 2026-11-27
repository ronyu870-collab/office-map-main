import { z } from "zod";
import type { WorkspaceDetail } from "@/src/lib/pitch/workspace/protocol";
import { BusinessEvidence, evidenceValueSchema } from "./BusinessEvidence";
import styles from "./workspace.module.css";

export const dataRefreshPeriodSchema = z.object({
  year: z.number().int(), quarter: z.number().int().min(1).max(4),
});
const dataVersionSchema = z.object({
  dataVersion: z.string().min(1).optional(),
  dataAsOf: z.iso.date(),
  blocks: z.array(z.record(z.string(), z.unknown())),
});
export const dataRefreshReviewSchema = z.object({
  projectVersion: z.number().int(),
  fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  changed: z.boolean(),
  needsConclusionReview: z.boolean(),
  period: dataRefreshPeriodSchema.nullable(),
  changes: z.array(z.object({
    slideId: z.uuid(),
    changed: z.boolean(),
    before: dataVersionSchema,
    after: dataVersionSchema,
  })).min(1).max(50),
});
export type DataRefreshReview = z.infer<typeof dataRefreshReviewSchema>;
export const refreshPeriodLabel = ({ year, quarter }: z.infer<typeof dataRefreshPeriodSchema>) => `${year}-Q${quarter}`;

function orderedValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(orderedValue);
  if (value && typeof value === "object") return Object.fromEntries(
    Object.keys(value).sort().map(key => [key, orderedValue((value as Record<string, unknown>)[key])]),
  );
  return value;
}

function sameValue(before: unknown, after: unknown) {
  return JSON.stringify(orderedValue(before)) === JSON.stringify(orderedValue(after));
}

function matchesContent(expected: z.infer<typeof dataVersionSchema>, page?: WorkspaceDetail["slides"][number]) {
  if (!page || expected.dataAsOf !== page.content.dataAsOf) return false;
  const blocks = page.content.blocks.map(({ sourceIds, ...value }) => {
    void sourceIds;
    return value;
  });
  return sameValue(expected.blocks, blocks);
}

export function matchesDataRefreshReview(review: DataRefreshReview, detail: WorkspaceDetail, slideId: string, expectedPeriod: string | null) {
  return review.projectVersion === detail.project.version &&
    (review.period ? refreshPeriodLabel(review.period) : null) === expectedPeriod &&
    review.changed === review.changes.some(change => change.changed) &&
    review.changes.some(change => change.slideId === slideId) &&
    new Set(review.changes.map(change => change.slideId)).size === review.changes.length &&
    review.changes.every(change => {
      const page = detail.slides.find(slide => slide.id === change.slideId);
      return matchesContent(change.before, page) && change.before.blocks.length === change.after.blocks.length &&
        change.before.blocks.every((before, index) => before.kind === change.after.blocks[index].kind);
    });
}

export function matchesAppliedDataRefresh(review: DataRefreshReview, before: WorkspaceDetail, after: WorkspaceDetail) {
  return after.project.id === before.project.id && after.project.version > review.projectVersion &&
    after.slides.length === before.slides.length && after.slides.every((page, index) => page.id === before.slides[index].id) &&
    review.changes.every(change => matchesContent(change.after, after.slides.find(page => page.id === change.slideId)));
}

function BlockValue({ value }: { value?: Record<string, unknown> }) {
  if (!value) return <p>此版本没有该数据项。</p>;
  const parsed = evidenceValueSchema.safeParse(value);
  if (!parsed.success) return <p>此数据项在页面生成后可查看。</p>;
  return <BusinessEvidence block={parsed.data} />;
}

export function DataRefreshComparison({ review, slides }: {
  review: DataRefreshReview;
  slides: WorkspaceDetail["slides"];
}) {
  const affected = review.changes.filter(change => change.changed);
  return <>
    <p>{review.period && `${refreshPeriodLabel(review.period)} · `}{review.changed
      ? `影响 ${affected.length} 页` : "当前数据已是所选季度的版本。"}</p>
    {review.needsConclusionReview && <p role="status">应用后请复核相关分析结论。</p>}
    {affected.map(change => {
      const index = slides.findIndex(slide => slide.id === change.slideId);
      const title = slides[index]?.content.title ?? "页面";
      return <section key={change.slideId} className={styles.refreshChanges}>
        <h3>{index >= 0 && `第 ${index + 1} 页 · `}{title}</h3>
        <p>{change.before.dataAsOf} → {change.after.dataAsOf}</p>
        {change.before.dataVersion && change.after.dataVersion && change.before.dataVersion !== change.after.dataVersion &&
          sameValue(change.before.blocks, change.after.blocks) && <p>正式来源版本有更新，页面数值保持一致。</p>}
        {change.after.blocks.map((after, block) => {
          const before = change.before.blocks[block];
          return sameValue(before, after) ? null : <div key={block} className={styles.revisionColumns}>
            <div><h4>更新前</h4><BlockValue value={before} /></div>
            <div><h4>更新后</h4><BlockValue value={after} /></div>
          </div>;
        })}
      </section>;
    })}
  </>;
}
