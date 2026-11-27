"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { z } from "zod";
import { Button, Dialog } from "@/src/components/ui";
import type { WorkspaceDetail } from "@/src/lib/pitch/workspace/protocol";
import { WorkspaceError, type Call } from "./client";
import { appliedPhotoSchema, matchesAppliedPhoto, matchesPhotoReview, PhotoRevisionReview,
  photoReviewSchema, type PhotoRevisionInput, type PhotoReview } from "./PhotoRevisionReview";
import styles from "./workspace.module.css";

const choices = [
  { value: "any", label: "不限类型", prompt: "把所选对象换用同楼宇的另一张照片" },
  { value: "exterior", label: "外立面", prompt: "把所选对象换用楼宇外立面照片" },
  { value: "lobby", label: "大堂", prompt: "把所选对象换用楼宇大堂照片" },
  { value: "interior", label: "室内", prompt: "把所选对象换用楼宇室内照片" },
] as const;
const unavailable = z.object({ status: z.enum(["clarification", "unavailable"]), message: z.string() });
type Choice = typeof choices[number]["value"];

export function PhotoReplacementPicker({ call, detail, pageId, objectId, onClose, onApplied }: {
  call: Call;
  detail: WorkspaceDetail;
  pageId: string;
  objectId: string;
  onClose: () => void;
  onApplied: (result: WorkspaceDetail, expectedVersion: number) => void;
}) {
  const [category, setCategory] = useState<Choice>("any");
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<{ key: string; review: PhotoReview } | { key: string; message: string; retry: boolean }>();
  const [applying, setApplying] = useState(false);
  const [applyMessage, setApplyMessage] = useState("");
  const [stale, setStale] = useState(false);
  const onImageStale = useCallback(() => setStale(true), []);
  const applyRequest = useRef<AbortController | null>(null);
  const { id: projectId, version: expectedVersion } = detail.project;
  const key = `${projectId}:${expectedVersion}:${pageId}:${objectId}:${category}:${attempt}`;
  const current = state?.key === key ? state : undefined;
  const review = current && "review" in current ? current.review : undefined;

  useEffect(() => {
    const request = new AbortController();
    const input: PhotoRevisionInput = {
      projectId, expectedVersion, currentPageId: pageId, pageIds: [], objectIds: [objectId],
      question: choices.find(choice => choice.value === category)!.prompt,
    };
    void call({ action: "proposal_revision", input }, true, "ai", request.signal).then(value => {
      if (request.signal.aborted) return;
      const result = photoReviewSchema.safeParse(value);
      if (result.success && matchesPhotoReview(result.data, detail, input) &&
        result.data.changes.length === 1 && (category === "any" || result.data.changes[0].after.category === category)) {
        setState({ key, review: result.data });
      } else {
        const feedback = unavailable.safeParse(value);
        setState({ key, message: feedback.success ? feedback.data.message : "无法核对这张备选照片，请重新查询。", retry: !feedback.success });
      }
    }).catch((error: unknown) => {
      if (request.signal.aborted) return;
      const conflict = error instanceof WorkspaceError && error.status === 409;
      setState({ key, message: conflict ? "项目已更新，请重新打开项目后查看备选照片。"
        : error instanceof WorkspaceError ? error.message : "照片查询未完成，请重试。",
      retry: !conflict && (!(error instanceof WorkspaceError) || error.status >= 500) });
    });
    return () => request.abort();
  }, [call, category, detail, expectedVersion, key, objectId, pageId, projectId]);

  useEffect(() => () => applyRequest.current?.abort(), []);

  async function apply() {
    if (!review || applyRequest.current || applyMessage || stale) return;
    const request = new AbortController();
    applyRequest.current = request;
    setApplying(true);
    try {
      const result = appliedPhotoSchema.parse(await call(review.command, true, "ai", request.signal));
      if (request.signal.aborted) return;
      if (!matchesAppliedPhoto(review, result.workspace)) throw new Error("无法核对保存后的照片，请重新打开项目检查。");
      onApplied(result.workspace, expectedVersion);
      onClose();
    } catch (error) {
      if (!request.signal.aborted) setApplyMessage(error instanceof WorkspaceError && error.status === 409
        ? "项目或照片来源已更新，请重新打开项目后再核对。"
        : error instanceof Error && !(error instanceof z.ZodError) ? error.message : "更换未完成，请重新查询后核对。");
    } finally {
      applyRequest.current = null;
      if (!request.signal.aborted) setApplying(false);
    }
  }

  return <Dialog open onOpenChange={open => { if (!open) onClose(); }} dismissible={!applying} title="更换楼宇照片"
    size="lg" footer={review && <Button disabled={!!applyMessage || stale} loading={applying} loadingLabel="正在更换…" onClick={() => void apply()}>
      确认换图
    </Button>}>
    <div className={`${styles.studio} ${styles.form}`}>
      <label>
        备选照片类型
        <select value={category} disabled={applying} onChange={event => {
          setApplyMessage("");
          setStale(false);
          setAttempt(value => value + 1);
          setCategory(event.target.value as Choice);
        }}>
          {choices.map(choice => <option key={choice.value} value={choice.value}>{choice.label}</option>)}
        </select>
      </label>
      {!current && <p role="status">正在查询同楼宇照片…</p>}
      {current && "message" in current && <p role="status">{current.message}</p>}
      {review && <PhotoRevisionReview review={review} detail={detail} onImageStale={onImageStale} />}
      {applyMessage && <p role="alert">{applyMessage}</p>}
      {((current && "retry" in current && current.retry) || applyMessage || stale) && <Button variant="ghost"
        disabled={applying} onClick={() => { setApplyMessage(""); setStale(false); setAttempt(value => value + 1); }}>重新查询</Button>}
    </div>
  </Dialog>;
}
