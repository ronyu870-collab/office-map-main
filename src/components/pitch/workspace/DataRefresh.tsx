"use client";

import { useEffect, useRef, useState } from "react";
import { z } from "zod";
import { Button, Dialog } from "@/src/components/ui";
import { contentBlockSchema } from "@/src/lib/pitch/contracts/content";
import { outlineQuarter, workspaceDetailSchema, type WorkspaceDetail } from "@/src/lib/pitch/workspace/protocol";
import { WorkspaceError, type Call } from "./client";
import styles from "./workspace.module.css";

const periodSchema = z.object({ year: z.number().int(), quarter: z.number().int().min(1).max(4) });
const bindingsSchema = z.object({
  projectVersion: z.number().int(),
  pages: z.array(z.object({
    id: z.uuid(),
    objects: z.array(z.object({
      valueOrigin: z.enum(["manual", "asset", "business"]),
      binding: z.object({ domain: z.enum(["quarter", "lease"]), dataAsOf: z.iso.date() }).optional(),
      query: z.object({ period: periodSchema }).optional(),
    })),
  })),
});
const versionSchema = z.object({
  dataAsOf: z.iso.date(),
  blocks: z.array(z.record(z.string(), z.unknown())),
});
const refreshSchema = z.object({
  projectVersion: z.number().int(),
  fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  changed: z.boolean(),
  needsConclusionReview: z.boolean(),
  period: periodSchema.nullable(),
  changes: z.array(z.object({
    slideId: z.uuid(),
    changed: z.boolean(),
    before: versionSchema,
    after: versionSchema,
  })),
});
type Review = z.infer<typeof refreshSchema>;
type Quarter = z.infer<typeof periodSchema>;
const periodLabel = ({ year, quarter }: Quarter) => `${year}-Q${quarter}`;
const refreshBlockSchema = z.discriminatedUnion("kind",
  contentBlockSchema.options.map(option => option.omit({ sourceIds: true })));


function ValueTable({ columns, rows }: { columns: string[]; rows: (string | number | null)[][] }) {
  return <div className={styles.tableScroll} tabIndex={0} role="region" aria-label="数据预览">
    <table>
      <thead><tr>{columns.map((column, index) => <th key={index} scope="col">{column}</th>)}</tr></thead>
      <tbody>{rows.map((row, index) => <tr key={index}>{row.map((value, cell) => <td key={cell}>{value ?? "—"}</td>)}</tr>)}</tbody>
    </table>
  </div>;
}

function BlockValue({ value }: { value?: Record<string, unknown> }) {
  if (!value) return <p>此版本没有该数据项。</p>;
  const parsed = refreshBlockSchema.safeParse(value);
  if (!parsed.success) return <p>此数据项在页面生成后可查看。</p>;
  const block = parsed.data;
  if (block.kind === "paragraph") return <p>{block.text}</p>;
  if (block.kind === "table") return <ValueTable columns={block.columns} rows={block.rows} />;
  if (block.kind === "metric") return <dl className={styles.refreshMetric}>
    <div><dt>{block.label}</dt><dd>{block.value === null ? "—" : `${block.value} ${block.unit}`}</dd></div>
    {block.qoq !== undefined && <div><dt>环比</dt><dd>{block.qoq ?? "—"}</dd></div>}
    {block.yoy !== undefined && <div><dt>同比</dt><dd>{block.yoy ?? "—"}</dd></div>}
  </dl>;
  if (block.kind === "chart") return <ValueTable columns={["类别", ...block.series.map(series => series.unit ? `${series.name}（${series.unit}）` : series.name)]}
    rows={block.categories.map((item, index) => [item, ...block.series.map(series => series.values[index] ?? null)])} />;
  return <p>此数据项在页面生成后可查看。</p>;
}

export function DataRefresh({ call, detail, slideId, disabled, onApplied }: {
  call: Call;
  detail: WorkspaceDetail;
  slideId: string;
  disabled: boolean;
  onApplied: (workspace: WorkspaceDetail, expectedVersion: number) => void;
}) {
  const [binding, setBinding] = useState<z.infer<typeof bindingsSchema>>();
  const [loadingError, setLoadingError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const [period, setPeriod] = useState("");
  const [review, setReview] = useState<Review>();
  const [error, setError] = useState("");
  const [working, setWorking] = useState<"preview" | "apply">();
  const pending = useRef<AbortController | null>(null);
  const projectId = detail.project.id;
  const expectedVersion = detail.project.version;

  useEffect(() => {
    const request = new AbortController();
    void call({ action: "document_bindings", projectId }, false, "workspace", request.signal)
      .then(bindingsSchema.parse)
      .then((result) => { if (!request.signal.aborted) setBinding(result); })
      .catch((cause: unknown) => {
        if (request.signal.aborted || cause instanceof WorkspaceError && [400, 404].includes(cause.status)) return;
        setLoadingError(cause instanceof Error && !(cause instanceof z.ZodError) ? cause.message : "数据绑定暂时无法读取。");
      });
    return () => request.abort();
  }, [attempt, call, projectId, expectedVersion]);
  useEffect(() => () => pending.current?.abort(), []);

  const business = binding?.projectVersion === expectedVersion
    ? binding.pages.find(page => page.id === slideId)?.objects.find(item => item.valueOrigin === "business" && item.binding)
    : undefined;
  if (!business) return loadingError ? <div role="alert">
    <p>{loadingError}</p><Button variant="ghost" onClick={() => { setLoadingError(""); setAttempt(value => value + 1); }}>重试读取绑定</Button>
  </div> : null;
  const validPeriod = !period || outlineQuarter.safeParse(period).success;
  function commandQuarter() {
    if (!period) return {};
    return { period: { year: Number(period.slice(0, 4)), quarter: Number(period.at(-1)) } };
  }

  async function run(action: "preview" | "apply") {
    if (disabled || pending.current || !validPeriod) return;
    const request = new AbortController();
    pending.current = request;
    setError("");
    setWorking(action);
    try {
      const input = { projectId, slideId, expectedVersion, ...commandQuarter() };
      if (action === "preview") {
        const result = refreshSchema.parse(await call({ action: "preview_data_refresh", ...input }, true, "workspace", request.signal));
        if (request.signal.aborted || result.projectVersion !== expectedVersion) return;
        setReview(result);
      } else if (review?.changed) {
        const result = workspaceDetailSchema.parse(await call({
          action: "apply_data_refresh", ...input, fingerprint: review.fingerprint,
        }, true, "workspace", request.signal));
        if (request.signal.aborted) return;
        setReview(undefined);
        onApplied(result, expectedVersion);
      }
    } catch (cause) {
      if (request.signal.aborted) return;
      setReview(undefined);
      setError(cause instanceof Error && !(cause instanceof z.ZodError) ? cause.message : "数据更新结果暂时无法读取。");
    } finally {
      pending.current = null;
      if (!request.signal.aborted) setWorking(undefined);
    }
  }

  return <section className={styles.form} aria-label="正式数据绑定">
    <h2>正式数据绑定</h2>
    {business.query && business.binding?.domain === "quarter" && <label>
      目标季度
      <input value={period} onChange={event => { setPeriod(event.target.value); setReview(undefined); }}
        placeholder={periodLabel(business.query.period)} maxLength={7} aria-invalid={!validPeriod}
        disabled={!!working} />
    </label>}
    {!validPeriod && <p role="alert">季度格式为 YYYY-Q1 至 YYYY-Q4。</p>}
    {error && <p role="alert">{error}</p>}
    <Button variant="secondary" disabled={disabled || !validPeriod || working === "apply"}
      loading={working === "preview"} loadingLabel="正在查询正式数据…" onClick={() => void run("preview")}>
      预览数据更新
    </Button>
    <Dialog open={!!review} onOpenChange={open => { if (!open && !working) setReview(undefined); }}
      title="核对数据更新" size="lg"
      footer={review?.changed && <Button disabled={disabled || working === "preview"}
        loading={working === "apply"} loadingLabel="正在应用…" onClick={() => void run("apply")}>应用数据更新</Button>}>
      {review && <>
        <p>{review.period && `${periodLabel(review.period)} · `}{review.changed ? `影响 ${review.changes.filter(change => change.changed).length} 页` : "当前数据已是所选季度的版本。"}</p>
        {review.needsConclusionReview && <p role="status">应用后请复核相关分析结论。</p>}
        {review.changes.filter(change => change.changed).map(change => {
          const index = detail.slides.findIndex(slide => slide.id === change.slideId);
          const title = detail.slides[index]?.content.title ?? "页面";
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
      </>}
    </Dialog>
  </section>;
}
