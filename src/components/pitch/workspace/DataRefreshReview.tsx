import { z } from "zod";
import type { WorkspaceDetail } from "@/src/lib/pitch/workspace/protocol";
import { BusinessEvidence, evidenceValueSchema } from "./BusinessEvidence";
import styles from "./workspace.module.css";

export const dataRefreshPeriodSchema = z.object({
  year: z.number().int(), quarter: z.number().int().min(1).max(4),
});
const dataVersionSchema = z.object({
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
  })),
});
export type DataRefreshReview = z.infer<typeof dataRefreshReviewSchema>;
export const refreshPeriodLabel = ({ year, quarter }: z.infer<typeof dataRefreshPeriodSchema>) => `${year}-Q${quarter}`;

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
        {change.after.blocks.map((after, block) => {
          const before = change.before.blocks[block];
          return JSON.stringify(before) === JSON.stringify(after) ? null : <div key={block} className={styles.revisionColumns}>
            <div><h4>更新前</h4><BlockValue value={before} /></div>
            <div><h4>更新后</h4><BlockValue value={after} /></div>
          </div>;
        })}
      </section>;
    })}
  </>;
}
