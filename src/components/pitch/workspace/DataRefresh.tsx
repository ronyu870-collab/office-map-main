"use client";

import { useEffect, useRef, useState } from "react";
import { z } from "zod";
import { Button, Dialog } from "@/src/components/ui";
import { catalogDimensions, numericFields } from "@/src/lib/intelligence/query/registry";
import { outlineQuarter, workspaceDetailSchema, type WorkspaceDetail } from "@/src/lib/pitch/workspace/protocol";
import type { Call } from "./client";
import type { DocumentBindings } from "./DocumentBindings";
import { DataRefreshComparison, dataRefreshPeriodSchema, dataRefreshReviewSchema, refreshPeriodLabel,
  type DataRefreshReview } from "./DataRefreshReview";
import styles from "./workspace.module.css";

const fieldNames: Record<string, { label: string }> = { ...catalogDimensions, ...numericFields };
type DataRefreshProps = {
  call: Call;
  detail: WorkspaceDetail;
  slideId: string;
  disabled: boolean;
  suggestedPeriod?: string;
  onApplied: (workspace: WorkspaceDetail, expectedVersion: number) => void;
};

export function DataRefresh({ bindings, ...props }: DataRefreshProps & { bindings: DocumentBindings }) {
  const { detail, slideId, suggestedPeriod } = props;
  const pageBindings = bindings.status === "ready"
    ? bindings.data.pages.find(page => page.id === slideId)?.objects ?? [] : [];
  const business = pageBindings.find(item => item.valueOrigin === "business" &&
    (item.binding?.domain === "quarter" || item.binding?.domain === "lease"));
  const receipts = new Map(pageBindings.flatMap(item => (item.receipts ?? []).map(receipt =>
    [JSON.stringify([receipt.sourceId, receipt.receiptId, receipt.resultId]), receipt] as const)));
  const page = detail.slides.find(page => page.id === slideId);
  const evidence = [...receipts].flatMap(([key, receipt]) => {
    const source = page?.content.sources.find(source => source.id === receipt.sourceId);
    return source ? [{ key, source, ...receipt }] : [];
  });
  if (!business && !evidence.length) return bindings.status === "error" ? <div role="alert">
    <p>{bindings.message}</p><Button variant="ghost" onClick={bindings.retry}>重试读取绑定</Button>
  </div> : null;
  return <section className={styles.form} aria-label="正式数据绑定">
    <h2>正式数据绑定</h2>
    {evidence.length > 0 && <details key={slideId}>
      <summary>正式查询依据</summary>
      <ul className={styles.handoffPages}>
        {evidence.map(({ key, source, binding, query }) => <li key={key}>
          <strong>{source.label}</strong>
          <p>{binding.dataAsOf ? `数据截至 ${binding.dataAsOf} · 仅供内部使用` : "资料日期待确认 · 仅供内部使用"}</p>
          {query.fields.length > 0 && <p>{query.fields.map(field =>
            Object.hasOwn(fieldNames, field) ? fieldNames[field].label : field).join(" · ")}</p>}
        </li>)}
      </ul>
    </details>}
    {business && <RefreshActions key={`${slideId}:${suggestedPeriod ?? ""}`} {...props}
      boundPeriod={business.binding?.domain === "quarter" ? business.query?.period : undefined} />}
  </section>;
}

function RefreshActions({ call, detail, slideId, disabled, suggestedPeriod, onApplied, boundPeriod }:
  DataRefreshProps & { boundPeriod?: z.infer<typeof dataRefreshPeriodSchema> }) {
  const [period, setPeriod] = useState(suggestedPeriod ?? "");
  const [review, setReview] = useState<DataRefreshReview>();
  const [error, setError] = useState("");
  const [working, setWorking] = useState<"preview" | "apply">();
  const pending = useRef<AbortController | null>(null);
  const projectId = detail.project.id;
  const expectedVersion = detail.project.version;
  useEffect(() => () => pending.current?.abort(), []);
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

  return <>
    {boundPeriod && <label>
      目标季度
      <input value={period} onChange={event => { setPeriod(event.target.value); setReview(undefined); }}
        placeholder={refreshPeriodLabel(boundPeriod)} maxLength={7} aria-invalid={!validPeriod}
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
  </>;
}
