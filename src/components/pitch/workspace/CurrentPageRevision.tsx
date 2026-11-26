"use client";
import * as React from "react";
import { Button } from "@/src/components/ui";
import { RevisionReview, type CanvasRevisionTarget } from "./RevisionReview";
import { WorkspaceError, type Call } from "./client";
import styles from "./workspace.module.css";

type Receipt = { id: string; state: string; authorized: boolean; error_code: string | null };
const stateText: Record<string, string> = {
  queued: "已排队", processing: "正在起草", completed: "建议已就绪",
  paused: "任务已暂停", failed: "没有生成建议", cancelled: "任务已取消",
};
export function CurrentPageRevision({ call, target, batchId, rememberBatch, onCanvasSaved, disabled }: {
  call: Call;
  target: CanvasRevisionTarget;
  batchId?: string;
  rememberBatch: (id: string | undefined) => void;
  onCanvasSaved: (result: unknown) => void;
  disabled?: boolean;
}) {
  const [receipt, setReceipt] = React.useState<Receipt>();
  const [status, setStatus] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [holdPoll, setHoldPoll] = React.useState(false);
  const controller = React.useRef<AbortController | null>(null);
  React.useEffect(() => () => controller.current?.abort(), []);
  const waiting = !receipt || ["queued", "processing"].includes(receipt.state);
  React.useEffect(() => {
    if (!batchId || !waiting || busy || holdPoll) return;
    const c = new AbortController();
    const timer = setTimeout(() => {
      void call<{ tasks: Receipt[] }>({ action: "status", batchId }, true, "ai", c.signal)
        .then(({ tasks }) => {
          if (c.signal.aborted) return;
          if (tasks.length !== 1) {
            setStatus("没有查到该修订任务，请先确认后再重试。");
            setHoldPoll(true);
            return;
          }
          setReceipt(tasks[0]);
          setStatus("");
        }).catch(() => {
          if (c.signal.aborted) return;
          setStatus("暂时查不到修订状态，可以重新查询；不会再提交任务。");
          setHoldPoll(true);
        });
    }, receipt ? 1600 : 250);
    return () => { clearTimeout(timer); c.abort(); };
  }, [batchId, busy, call, holdPoll, receipt, waiting]);
  async function start() {
    if (disabled || busy || (batchId && (waiting || receipt?.state === "completed"))) return;
    const id = crypto.randomUUID(), c = new AbortController();
    controller.current = c;
    rememberBatch(id);
    setBusy(true);
    setReceipt(undefined);
    setStatus("");
    setHoldPoll(false);
    try {
      const result = await call<{ tasks: Receipt[] }>({ ...target, action: "start_canvas_text", batchId: id }, true, "workspace", c.signal);
      if (!c.signal.aborted) setReceipt(result.tasks[0]);
    } catch (error) {
      if (c.signal.aborted) return;
      if (error instanceof WorkspaceError && error.status < 500) {
        rememberBatch(undefined);
        setStatus(error.message);
      } else {
        setStatus("提交结果待查，先查询同一任务，不重复提交。");
      }
    } finally {
      if (!c.signal.aborted) setBusy(false);
    }
  }
  return <section aria-label="当前页文字修订" className={styles.form}>
    {(!batchId || (receipt && !waiting && receipt.state !== "completed")) && <>
      <Button variant="secondary" disabled={disabled || busy} onClick={() => void start()}>修订本页文字</Button>
      <p>用已获批的素材文字起草建议，不改表格或图表。确认后才改当前页。</p>
    </>}
    {!!batchId && <p role="status">{receipt ? stateText[receipt.state] ?? "状态待查" : "正在查询文字修订"}
      {receipt?.error_code === "authorization_denied" ? " · 素材未获权" : ""}
      {receipt?.error_code === "budget_exceeded" ? " · 当前预算不足" : ""}</p>}
    {status && <p role="status">{status}</p>}
    {holdPoll && <Button variant="ghost" onClick={() => setHoldPoll(false)}>重新查询修订状态</Button>}
    {receipt?.state === "completed" && (receipt.authorized
      ? <RevisionReview call={call} taskId={receipt.id} canvasOnly canvasTarget={target} onCanvasSaved={onCanvasSaved} disabled={disabled} />
      : <p>原素材权限已变化，不能预览或应用。</p>)}
  </section>;
}
