"use client";

import { useEffect, useRef, useState } from "react";
import { z } from "zod";
import { Button, Dialog } from "@/src/components/ui";
import { saveSchema, workspaceDetailSchema, type WorkspaceDetail } from "@/src/lib/pitch/workspace/protocol";
import { objectId } from "@/src/lib/pitch/workspace/object-layout";
import { themeLabel, WorkspaceError, type Call } from "./client";
import styles from "./workspace.module.css";

const outcomeSchema = z.discriminatedUnion("status", [
  z.object({
    status: z.literal("ready"),
    scope: z.enum(["selected", "document"]),
    theme: z.object({ id: z.string(), version: z.number().int().positive() }).optional(),
    gaps: z.array(z.string()),
    plan: z.object({
      id: z.uuid(), projectId: z.uuid(), expectedVersion: z.number().int().positive(),
      basePageVersions: z.array(z.object({ id: z.uuid(), version: z.number().int().positive() })),
      pages: saveSchema.shape.pages,
      refresh: z.object({ id: z.uuid(), version: z.number().int().positive(), contextFingerprint: z.string() }).optional(),
    }),
  }),
  z.object({ status: z.literal("clarification"), message: z.string() }),
  z.object({ status: z.literal("unavailable") }),
]);
type Ready = Extract<z.infer<typeof outcomeSchema>, { status: "ready" }>;

export function ProposalRevision({ call, detail, question, active, selected, objectIds, disabled, onApplied, onOpenData }: {
  call: Call;
  detail: WorkspaceDetail;
  question: string;
  active?: string;
  selected: string[];
  objectIds: string[];
  disabled: boolean;
  onApplied: (result: WorkspaceDetail, expectedVersion: number) => void;
  onOpenData: () => void;
}) {
  const [review, setReview] = useState<{ key: string; value: Ready }>();
  const [working, setWorking] = useState<"preview" | "apply">();
  const [message, setMessage] = useState("");
  const request = useRef<AbortController | null>(null);
  const projectId = detail.project.id;
  const expectedVersion = detail.project.version;
  const key = JSON.stringify([projectId, expectedVersion, question, active, selected, objectIds]);
  const current = review?.key === key ? review.value : undefined;
  useEffect(() => () => request.current?.abort(), []);

  async function run(action: "preview" | "apply") {
    if (disabled || !question.trim() || !detail.slides.length || request.current) return;
    const controller = new AbortController();
    request.current = controller;
    setMessage("");
    setWorking(action);
    try {
      if (action === "preview") {
        const result = outcomeSchema.parse(await call({ action: "proposal_revision", input: {
          projectId, expectedVersion, question: question.trim(), currentPageId: active,
          pageIds: selected, objectIds,
        } }, true, "ai", controller.signal));
        if (controller.signal.aborted) return;
        if (result.status === "ready" && result.plan.expectedVersion === expectedVersion && result.plan.projectId === projectId) {
          setReview({ key, value: result });
        } else {
          setReview(undefined);
          setMessage(result.status === "clarification" ? result.message
            : "当前资料或版式无法生成可应用的修改。请缩小范围或指定要更改的内容。");
        }
      } else if (current && !current.plan.refresh) {
        const result = workspaceDetailSchema.parse(await call({
          action: "apply_modification", plan: current.plan, scope: current.scope, ...(current.theme ? { theme: current.theme } : {}),
        }, true, "workspace", controller.signal));
        if (controller.signal.aborted) return;
        setReview(undefined);
        onApplied(result, expectedVersion);
      }
    } catch (cause) {
      if (controller.signal.aborted) return;
      setReview(undefined);
      setMessage(cause instanceof WorkspaceError && cause.status === 409
        ? "项目版本已变化，请重新打开项目后再预览。"
        : cause instanceof Error && !(cause instanceof z.ZodError) ? cause.message : "修改未完成，请重新预览。");
    } finally {
      request.current = null;
      if (!controller.signal.aborted) setWorking(undefined);
    }
  }

  const edits = current?.plan.pages.filter(page => Object.keys(page).some(field => field !== "id")) ?? [];
  const removed = current?.scope === "document" ? detail.slides.filter(slide => !current.plan.pages.some(page => page.id === slide.id)) : [];
  const affected = current?.theme ? detail.slides.length : edits.length + removed.length;
  return <>
    <Button variant="ghost" disabled={disabled || !question.trim()}
      loading={working === "preview"} loadingLabel="正在准备修改…" onClick={() => void run("preview")}>
      预览修改
    </Button>
    {message && <p role="status">{message}</p>}
    <Dialog open={!!current} onOpenChange={open => { if (!open && !working) setReview(undefined); }}
      title="核对 AI 修改" size="lg" footer={current && (
        current.plan.refresh ? <Button onClick={() => { setReview(undefined); onOpenData(); }}>打开数据检查器</Button>
          : <Button disabled={disabled || !affected}
            loading={working === "apply"} loadingLabel="正在应用…" onClick={() => void run("apply")}>应用修改</Button>
      )}>
      {current && <>
        <p>{current.plan.refresh ? "逐组核对正式数据，再应用更新。" : `影响 ${affected} 页`}</p>
        {current.theme && <p>整套主题由「{themeLabel(detail.project.theme_id)}」改为「{themeLabel(current.theme.id)}」。</p>}
        <ul className={styles.handoffPages}>
          {edits.map(edit => {
            const index = detail.slides.findIndex(slide => slide.id === edit.id);
            const original = detail.slides[index];
            if (!original) return null;
            return <li key={edit.id}>
              <strong>第 {index + 1} 页 · {original.content.title}</strong>
              {edit.title && <p>标题改为「{edit.title}」。</p>}
              {edit.objectTexts?.map(item => {
                const layer = original.scene.elements.find((element, index) => objectId(element, index) === item.id);
                return <div key={item.id} className={styles.revisionColumns}>
                  <div><strong>修改前</strong><p>{layer?.kind === "text" ? layer.text : "所选对象"}</p></div>
                  <div><strong>修改后</strong><p>{item.text}</p></div>
                </div>;
              })}
            </li>;
          })}
          {removed.map(page => <li key={page.id}>移除第 {detail.slides.indexOf(page) + 1} 页 · {page.content.title}</li>)}
          {current.gaps.map((gap, index) => <li key={index}>{gap}</li>)}
        </ul>
      </>}
    </Dialog>
  </>;
}
