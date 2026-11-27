"use client";

import { useEffect, useRef, useState } from "react";
import { z } from "zod";
import { Button, Dialog } from "@/src/components/ui";
import { outlineQuarter, workspaceDetailSchema, type WorkspaceDetail } from "@/src/lib/pitch/workspace/protocol";
import { WorkspaceError, type Call } from "./client";
import { DataRefreshComparison, dataRefreshPeriodSchema, dataRefreshReviewSchema, refreshPeriodLabel,
  type DataRefreshReview } from "./DataRefreshReview";
import styles from "./workspace.module.css";

const bindingsSchema = z.object({
  projectVersion: z.number().int(),
  pages: z.array(z.object({
    id: z.uuid(),
    objects: z.array(z.object({
      valueOrigin: z.enum(["manual", "asset", "business"]),
      binding: z.object({ domain: z.enum(["quarter", "lease"]), dataAsOf: z.iso.date() }).optional(),
      query: z.object({ period: dataRefreshPeriodSchema }).optional(),
    })),
  })),
});
export function DataRefresh({ call, detail, slideId, disabled, suggestedPeriod, onApplied }: {
  call: Call;
  detail: WorkspaceDetail;
  slideId: string;
  disabled: boolean;
  suggestedPeriod?: string;
  onApplied: (workspace: WorkspaceDetail, expectedVersion: number) => void;
}) {
  const [binding, setBinding] = useState<z.infer<typeof bindingsSchema>>();
  const [loadingError, setLoadingError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const [period, setPeriod] = useState(suggestedPeriod ?? "");
  const [review, setReview] = useState<DataRefreshReview>();
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
        const result = dataRefreshReviewSchema.parse(await call({ action: "preview_data_refresh", ...input }, true, "workspace", request.signal));
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
        placeholder={refreshPeriodLabel(business.query.period)} maxLength={7} aria-invalid={!validPeriod}
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
      {review && <DataRefreshComparison review={review} slides={detail.slides} />}
    </Dialog>
  </section>;
}
