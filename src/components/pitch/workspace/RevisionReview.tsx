/* eslint-disable @next/next/no-img-element -- authenticated render returns a private in-memory SVG. */
"use client";
import * as React from "react";
import { Button, Dialog } from "@/src/components/ui";
import type { RevisionPreview } from "@/src/lib/pitch/ai/revision-preview";
import type { PitchScope } from "@/src/lib/pitch/contracts/content";
import { WorkspaceError, type Call } from "./client";
import styles from "./workspace.module.css";

export type RevisionDestination = { scope: PitchScope; categoryId: string };
export function RevisionReview({ call, taskId, destination, disabled }: {
  call: Call; taskId: string; destination?: RevisionDestination; disabled?: boolean;
}) {
  const [preview, setPreview] = React.useState<RevisionPreview | null>(null);
  const [selected, setSelected] = React.useState<string[]>([]);
  const [status, setStatus] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [saved, setSaved] = React.useState(false);
  const [uncertain, setUncertain] = React.useState(false);
  const controller = React.useRef<AbortController | null>(null);
  React.useEffect(() => () => controller.current?.abort(), []);
  function close() { if (!busy) { setPreview(null); setStatus(""); } }
  async function review(visual = false) {
    const c = new AbortController();
    controller.current = c;
    setBusy(true);
    setStatus("");
    try {
      const value = await call<RevisionPreview>({ action: "revision_preview", taskId,
        ...(visual ? { visual: true, ...(selected.length ? { selectedRefs: selected } : {}) } : {}),
      }, true, "ai", c.signal);
      if (!c.signal.aborted) {
        setPreview(value);
        setSelected(value.selectedRefs ?? value.changes.map(change => change.id));
      }
    } catch (error) {
      if (!c.signal.aborted) {
        setStatus(error instanceof Error ? error.message : "无法读取修订对照。");
        if (error instanceof WorkspaceError && (error.status === 403 || error.status === 409)) setPreview(null);
      }
    } finally {
      if (!c.signal.aborted) setBusy(false);
    }
  }
  const scopeMatches = preview && destination &&
    Object.entries(preview.scope).every(([key, value]) => destination.scope[key as keyof PitchScope] === value);
  const shownRefs = preview?.selectedRefs ?? preview?.changes.map(change => change.id) ?? [];
  const selectionMatches = selected.length === shownRefs.length && selected.every(ref => shownRefs.includes(ref));
  async function save() {
    if (!preview || !destination || !scopeMatches || !selectionMatches || busy || saved || uncertain) return;
    const c = new AbortController();
    controller.current = c;
    setBusy(true);
    setStatus("");
    try {
      await call({ action: "materialize", taskId, assetId: crypto.randomUUID(), ...destination,
        revisionFingerprint: preview.fingerprint,
        ...(preview.selectedRefs?.length ? { selectedRefs: preview.selectedRefs } : {}) }, true, "ai", c.signal);
      if (c.signal.aborted) return;
      setSaved(true);
      setPreview(null);
      setStatus("已保存到素材库的私有草稿，原稿未改。");
    } catch (error) {
      if (c.signal.aborted) return;
      if (!(error instanceof WorkspaceError) || error.status >= 500) {
        setUncertain(true);
        setStatus("保存结果暂未确认，请先在素材库查看是否已创建草稿，不要重复保存。");
      } else {
        setStatus(error.message);
        if (error.status === 409 || error.status === 403) setPreview(null);
      }
    } finally {
      if (!c.signal.aborted) setBusy(false);
    }
  }
  return <>
    <Button variant="secondary" disabled={disabled || busy || saved || uncertain} onClick={() => void review()}>
      查看修改前后
    </Button>
    {!preview && status && <p role="status">{status}</p>}
    <Dialog open={Boolean(preview)} onOpenChange={open => { if (!open) close(); }} title="文字修订对照"
      footer={<>
        <Button variant="secondary" disabled={busy} onClick={close}>暂不采用</Button>
        <Button disabled={busy || !destination || !scopeMatches || !selectionMatches || uncertain ||
          (!preview?.changes.length && preview?.beforeLanguage === preview?.afterLanguage)}
          onClick={() => void save()}>保存为私有草稿</Button>
      </>}>
      {preview && <div className={`${styles.studio} ${styles.form}`}>
        <p>来源 v{preview.sourceVersion} · 资料日期 {preview.dataAsOf}。保存不会覆盖当前页面，也不会发布素材。</p>
        {preview.redacted ? <p>仅展示获批脱敏片段的修订，不显示完整原文。原表格、图表与其他内容不进入这份独立草稿。</p>
          : <p>{preview.preservedBlocks} 个未改动的内容块保留，包含原有表格或图表（如有）。原始来源随草稿保留。</p>}
        {!preview.redacted && preview.beforeLanguage !== preview.afterLanguage &&
          <p>语言标记：{preview.beforeLanguage} → {preview.afterLanguage}</p>}
        {!preview.changes.length && <p>没有检测到文字变化。</p>}
        {preview.changes.map(change => <section key={change.id} className={styles.revisionChange}>
          <h3>{change.label}</h3>
          {!preview.redacted && <label className={styles.check}>
            <input type="checkbox" checked={selected.includes(change.id)} disabled={busy}
              onChange={event => setSelected(current =>
                event.target.checked ? [...current, change.id] : current.filter(ref => ref !== change.id))} />
            采用{change.label}
          </label>}
          <div className={styles.revisionColumns}>
            {change.before !== null && <div><strong>修改前</strong><p>{change.before}</p></div>}
            <div><strong>修改后</strong><p>{change.after}</p></div>
          </div>
        </section>)}
        {!preview.redacted && <div className={styles.actions}>
          <Button variant="secondary" disabled={busy || (!selected.length && !!preview.changes.length)}
            onClick={() => void review(true)}>预览所选改动</Button>
          {!selectionMatches && <p role="status">选择已变化。请重新预览所选改动后再保存。</p>}
        </div>}
        {selectionMatches && preview.visual === null && !preview.redacted &&
          <p role="status">这个素材暂不能完整渲染；文字对照与所选内容的核对仍然有效。</p>}
        {selectionMatches && preview.visual && <section aria-label="素材版式预览">
          <p>默认模板预览，非现有画布。原页面对象和版式不变。</p>
          <div className={styles.revisionColumns}>
            {([["修改前", preview.visual.before], ["仅采用所选改动", preview.visual.after]] as const).map(([label, images]) =>
              <div key={label}><strong>{label} · {images.length} 页</strong>
                {images.map((svg, i) => <img key={i} className={styles.revisionImage}
                  src={"data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg)}
                  alt={`${label}第 ${i + 1} 页`} />)}
              </div>)}
          </div>
        </section>}
        {!destination && <p>本项目没有可写入的素材分类；可在 AI 管理中选择归档位置。</p>}
        {destination && !scopeMatches && <p>草稿须保存在原素材范围：{preview.scope.region} / {preview.scope.city} / {preview.scope.businessLine}。</p>}
        {status && <p role="status">{status}</p>}
      </div>}
    </Dialog>
  </>;
}
