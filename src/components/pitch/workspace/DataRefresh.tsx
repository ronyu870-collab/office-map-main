"use client";

import { useEffect, useRef, useState } from "react";
import { z } from "zod";
import { Button, Dialog } from "@/src/components/ui";
import { catalogDimensions, numericFields } from "@/src/lib/intelligence/query/registry";
import { outlineQuarter, workspaceCommandSchema, type WorkspaceDetail } from "@/src/lib/pitch/workspace/protocol";
import { workspaceResponseSchema as workspaceDetailSchema, type WorkspaceResponse, type Call } from "./client";
import type { DocumentBindings } from "./DocumentBindings";
import { DataRefreshComparison, dataRefreshPeriodSchema, dataRefreshReviewSchema, refreshPeriodLabel,
  matchesAppliedDataRefresh, matchesDataRefreshReview, type DataRefreshReview } from "./DataRefreshReview";
import styles from "./workspace.module.css";

const fieldNames: Record<string, { label: string }> = { ...catalogDimensions, ...numericFields };
const pageNoteSchema = z.object({ text: z.string(), baseSubtitle: z.string().optional() });
type DataRefreshProps = {
  call: Call;
  detail: WorkspaceResponse;
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
  const originalNote = pageNoteSchema.safeParse(detail.workspace.page_settings[slideId]?.note).data?.text ?? "";
  const [note, setNote] = useState(originalNote);
  const [period, setPeriod] = useState(suggestedPeriod ?? "");
  const [review, setReview] = useState<DataRefreshReview>();
  const [error, setError] = useState("");
  const [working, setWorking] = useState<"preview" | "apply">();
  const pending = useRef<AbortController | null>(null);
  const projectId = detail.project.id;
  const expectedVersion = detail.project.version;
  useEffect(() => () => pending.current?.abort(), []);
  const validPeriod = !period || outlineQuarter.safeParse(period).success;
  const expectedPeriod = period || (boundPeriod ? refreshPeriodLabel(boundPeriod) : null);
  const quarter = period ? { year: Number(period.slice(0, 4)), quarter: Number(period.at(-1)) } : undefined;
  const page = detail.slides.find(candidate => candidate.id === slideId);
  const editableCaption = page && !page.scene.elements.some(element => element.editorId) && (page.scene.pagination?.count ?? 1) === 1;
  const manualNote = note.trim() || null;
  const noteChanged = (manualNote ?? "") !== originalNote;
  const amend = review?.changed && editableCaption ? {
    action: "apply_modification", scope: "selected", plan: {
      id: projectId, projectId, expectedVersion,
      basePageVersions: review.changes.map(change => ({ id: change.slideId,
        version: detail.slides.find(page => page.id === change.slideId)?.version })),
      pages: [{ id: slideId, manualNote }],
      refresh: { kind: "reviewed-data", slideId, ...(quarter ? { period: quarter } : {}), fingerprint: review.fingerprint },
    },
  } : undefined;
  const supportsNote = !!amend && workspaceCommandSchema.safeParse(amend).success;

  async function run(action: "preview" | "apply") {
    if (disabled || pending.current || !validPeriod) return;
    const request = new AbortController();
    pending.current = request;
    setError("");
    setWorking(action);
    try {
      const input = { projectId, slideId, expectedVersion, ...(quarter ? { period: quarter } : {}) };
      if (action === "preview") {
        const result = dataRefreshReviewSchema.parse(await call({ action: "preview_data_refresh", ...input }, true, "workspace", request.signal));
        if (request.signal.aborted) return;
        if (!matchesDataRefreshReview(result, detail, slideId, expectedPeriod))
          throw new Error("核对结果与当前页面或季度不一致，请重新打开项目。");
        setReview(result);
      } else if (review?.changed) {
        const adjusted = supportsNote && noteChanged && amend;
        const result = workspaceDetailSchema.parse(await call(adjusted
          ? { ...adjusted, plan: { ...adjusted.plan, id: crypto.randomUUID() } }
          : { action: "apply_data_refresh", ...input, fingerprint: review.fingerprint }, true, "workspace", request.signal));
        if (request.signal.aborted) return;
        if (!matchesAppliedDataRefresh(review, detail, result))
          throw new Error("无法核对保存后的正式数据，请重新打开项目。");
        if (adjusted) {
          const savedNote = pageNoteSchema.safeParse(result.workspace.page_settings[slideId]?.note).data;
          const savedCaption = result.slides.find(page => page.id === slideId)?.content.subtitle;
          const label = page?.content.locale.startsWith("en") ? "Manual note: " : "人工说明：";
          if ((savedNote?.text ?? null) !== manualNote || result.project.version !== expectedVersion + 1 ||
            (manualNote && savedCaption !== [savedNote?.baseSubtitle, label + manualNote].filter(Boolean).join(" · ")))
            throw new Error("无法核对保存后的人工说明，请重新打开项目。");
        }
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
      {review && <div className={styles.form}>
        <DataRefreshComparison review={review} slides={detail.slides} />
        {supportsNote && <label>本页人工说明（可选）
          <input value={note} onChange={event => setNote(event.target.value)} disabled={!!working} maxLength={80} />
        </label>}
      </div>}
    </Dialog>
  </>;
}
