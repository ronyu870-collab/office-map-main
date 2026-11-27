"use client";

import { useEffect, useRef, useState } from "react";
import { ZodError } from "zod";
import { Button, Dialog } from "@/src/components/ui";
import { LAYOUTS } from "@/src/lib/pitch/layout/definitions";
import { legacyLayoutIds } from "@/src/lib/pitch/contracts/scene";
import type { WorkspaceDetail } from "@/src/lib/pitch/workspace/protocol";
import { WorkspaceError, workspaceResponseSchema, type Call } from "./client";
import { hasLayoutChoice, layoutSelectionError, LayoutRevisionReview, matchesAppliedLayout, reviewLayoutChanges,
  type LayoutChoice, type LayoutReview } from "./LayoutRevision";
import styles from "./workspace.module.css";

const variantLayouts = new Set<string>(legacyLayoutIds);

export function BatchLayout({ call, detail, selected, disabled, onApplied }: {
  call: Call;
  detail: WorkspaceDetail;
  selected: string[];
  disabled: boolean;
  onApplied: (result: WorkspaceDetail, version: number) => void;
}) {
  const [choice, setChoice] = useState<LayoutChoice>({ layoutId: "", variant: "standard" });
  const [review, setReview] = useState<LayoutReview>();
  const [working, setWorking] = useState<"preview" | "apply">();
  const [error, setError] = useState("");
  const request = useRef<AbortController>(null);
  const selectedPages = detail.slides.filter(page => selected.includes(page.id));
  const compatibility = layoutSelectionError(detail, selected);
  const common = LAYOUTS.filter(layout => selectedPages.every(page => page.content.blocks.every(block => layout.kinds.includes(block.kind))));
  const changed = selectedPages.filter(page => !hasLayoutChoice(page, choice)).length;
  const canPreview = !compatibility && common.some(layout => layout.id === choice.layoutId) && changed > 0;

  useEffect(() => () => request.current?.abort(), []);

  async function run(action: "preview" | "apply") {
    if (disabled || !canPreview || request.current || (action === "apply" && !review)) return;
    const controller = new AbortController();
    request.current = controller;
    setError("");
    setWorking(action);
    try {
      if (action === "preview") {
        const result = await reviewLayoutChanges(call, detail, selected, controller.signal, choice);
        if (!controller.signal.aborted) setReview(result);
      } else if (review) {
        const after = workspaceResponseSchema.parse(await call(review.command, true, "workspace", controller.signal));
        if (controller.signal.aborted) return;
        if (!matchesAppliedLayout(review, detail, after)) throw new Error("无法核对保存后的布局，请重新打开项目检查。");
        setReview(undefined);
        onApplied(after, detail.project.version);
      }
    } catch (cause) {
      if (controller.signal.aborted) return;
      setReview(undefined);
      setError(cause instanceof WorkspaceError && cause.status === 409
        ? "项目版本已变化，请重新打开项目后再预览。"
        : cause instanceof Error && !(cause instanceof ZodError) ? cause.message : "布局未能读取，请重新预览。");
    } finally {
      if (!controller.signal.aborted) setWorking(undefined);
      controller.abort();
      request.current = null;
    }
  }

  return <section className={styles.form} aria-label="所选页面的布局">
    <strong>批量布局（{selected.length} 页）</strong>
    {compatibility ? <p>{compatibility}</p> : common.length ? <>
      <label>
        批量页面布局
        <select value={choice.layoutId} disabled={disabled || !!working} onChange={event => {
          setError("");
          setChoice({ layoutId: event.target.value, variant: "standard" });
        }}>
          <option value="">选择共用布局</option>
          {common.map(layout => <option key={layout.id} value={layout.id}>{layout.zh}</option>)}
        </select>
      </label>
      {variantLayouts.has(choice.layoutId) && <label>
        批量布局变体
        <select value={choice.variant} disabled={disabled || !!working} onChange={event => {
          setError("");
          setChoice({ ...choice, variant: event.target.value === "alternate" ? "alternate" : "standard" });
        }}>
          <option value="standard">标准</option>
          <option value="alternate">替换布局</option>
        </select>
      </label>}
      {choice.layoutId && !changed && <p>所选页面已采用这个布局。</p>}
      <Button variant="secondary" disabled={disabled || !canPreview || working === "apply"}
        loading={working === "preview"} loadingLabel="正在渲染所选页面…" onClick={() => void run("preview")}>
        预览批量布局
      </Button>
    </> : <p>所选页面没有共用布局。请选择内容类型相近的页面。</p>}
    {error && <p role="alert">{error}</p>}
    <Dialog open={!!review} title="核对批量布局" size="lg" dismissible={working !== "apply"}
      onOpenChange={open => { if (!open && !working) setReview(undefined); }}
      footer={<Button disabled={disabled} loading={working === "apply"} loadingLabel="正在应用…" onClick={() => void run("apply")}>
        应用批量布局
      </Button>}>
      {review && <LayoutRevisionReview review={review} detail={detail} />}
    </Dialog>
  </section>;
}
