"use client";

import { useEffect, useRef, useState } from "react";
import { z } from "zod";
import { Button, Dialog } from "@/src/components/ui";
import { outlineQuarter, saveSchema, workspaceDetailSchema, type WorkspaceDetail } from "@/src/lib/pitch/workspace/protocol";
import { objectId } from "@/src/lib/pitch/workspace/object-layout";
import { themeLabel, WorkspaceError, type Call } from "./client";
import { DataRefreshComparison, dataRefreshPeriodSchema, dataRefreshReviewSchema, refreshPeriodLabel } from "./DataRefreshReview";
import styles from "./workspace.module.css";

const chartTypeSchema = z.enum(["bar", "column", "line"]);
const chartEditSchema = z.strictObject({ blockIndex: z.number().int().min(0).max(49), type: chartTypeSchema });
const fingerprint = z.string().regex(/^[a-f0-9]{64}$/);
const projectVersion = z.number().int().positive();
const scopeSchema = z.enum(["selected", "document"]);
const themeSchema = z.strictObject({ id: z.string().min(1).max(100), version: projectVersion });
const planSchema = z.strictObject({
  id: z.uuid(), projectId: z.uuid(), expectedVersion: projectVersion,
  basePageVersions: z.array(z.strictObject({ id: z.uuid(), version: projectVersion })).max(50),
  pages: z.array(saveSchema.shape.pages.element.safeExtend({
    chartPresentation: z.array(chartEditSchema).min(1).max(10).optional(),
  })).max(50),
  refresh: z.strictObject({ id: z.uuid(), version: projectVersion, contextFingerprint: fingerprint }).optional(),
});
const commandSchema = z.discriminatedUnion("action", [
  z.strictObject({ action: z.literal("apply_modification"), plan: planSchema, scope: scopeSchema, theme: themeSchema.optional() }),
  z.strictObject({ action: z.literal("apply_data_refresh"), projectId: z.uuid(), slideId: z.uuid(),
    expectedVersion: projectVersion, period: dataRefreshPeriodSchema, fingerprint }),
]);
const readySchema = z.object({
  scope: scopeSchema,
  theme: themeSchema.optional(),
  gaps: z.array(z.string()),
  plan: planSchema,
  chartPreview: z.array(chartEditSchema.extend({ pageId: z.uuid(), from: chartTypeSchema })).optional(),
  review: dataRefreshReviewSchema.optional(),
  command: commandSchema.optional(),
});
const outcomeSchema = z.discriminatedUnion("status", [
  readySchema.extend({ status: z.literal("ready") }),
  readySchema.extend({ status: z.literal("refresh-review"),
    refreshPlan: z.object({ brief: z.object({ period: outlineQuarter.nullable() }) }) }),
  z.object({ status: z.literal("clarification"), message: z.string() }),
  z.object({ status: z.literal("unavailable") }),
]);
type Ready = Extract<z.infer<typeof outcomeSchema>, { status: "ready" | "refresh-review" }>;
const chartLabels = { bar: "条形图", column: "柱状图", line: "折线图" } as const;

function matchesPreview(value: Ready, detail: WorkspaceDetail) {
  const { plan, command, review } = value;
  if (plan.projectId !== detail.project.id || plan.expectedVersion !== detail.project.version) return false;
  if (command?.action === "apply_data_refresh") {
    return !!review?.period && command.projectId === plan.projectId && command.expectedVersion === plan.expectedVersion &&
      review.projectVersion === plan.expectedVersion && command.fingerprint === review.fingerprint &&
      command.fingerprint === plan.refresh?.contextFingerprint &&
      refreshPeriodLabel(command.period) === refreshPeriodLabel(review.period) &&
      review.changes.some(change => change.slideId === command.slideId) &&
      review.changes.every(change => detail.slides.some(slide => slide.id === change.slideId));
  }
  if (command && (JSON.stringify(command.plan) !== JSON.stringify(plan) || command.scope !== value.scope ||
    JSON.stringify(command.theme) !== JSON.stringify(value.theme))) return false;
  const changes = plan.pages.flatMap(page => (page.chartPresentation ?? []).map(chart => ({ ...chart, pageId: page.id })));
  const chartPreview = value.chartPreview ?? [];
  if (changes.length !== chartPreview.length || (changes.length && !command)) return false;
  return changes.every(change => {
    const block = detail.slides.find(slide => slide.id === change.pageId)?.content.blocks[change.blockIndex];
    return block?.kind === "chart" && chartPreview.some(chart => chart.pageId === change.pageId &&
      chart.blockIndex === change.blockIndex && chart.type === change.type && chart.from === block.chartType);
  });
}

export function ProposalRevision({ call, detail, question, active, selected, objectIds, disabled, onApplied, onOpenData }: {
  call: Call;
  detail: WorkspaceDetail;
  question: string;
  active?: string;
  selected: string[];
  objectIds: string[];
  disabled: boolean;
  onApplied: (result: WorkspaceDetail, expectedVersion: number) => void;
  onOpenData: (period?: string) => void;
}) {
  const [review, setReview] = useState<{ key: string; value: Ready }>();
  const [working, setWorking] = useState<"preview" | "apply">();
  const [message, setMessage] = useState("");
  const request = useRef<AbortController | null>(null);
  const projectId = detail.project.id;
  const expectedVersion = detail.project.version;
  const key = JSON.stringify([projectId, expectedVersion, question, active, selected, objectIds]);
  const current = review?.key === key ? review.value : undefined;
  const quarterReview = current?.command?.action === "apply_data_refresh" ? current.review : undefined;
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
        if ((result.status === "ready" || result.status === "refresh-review") && matchesPreview(result, detail)) {
          setReview({ key, value: result });
        } else {
          setReview(undefined);
          setMessage(result.status === "clarification" ? result.message
            : "当前资料或版式无法生成可应用的修改。请缩小范围或指定要更改的内容。");
        }
      } else if (current && (!current.plan.refresh || quarterReview?.changed)) {
        const command = current.command ?? {
          action: "apply_modification", plan: current.plan, scope: current.scope, ...(current.theme ? { theme: current.theme } : {}),
        };
        const result = workspaceDetailSchema.parse(await call(command, true, "workspace", controller.signal));
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
  const suggestedPeriod = current?.status === "refresh-review" ? current.refreshPlan.brief.period ?? undefined : undefined;
  return <>
    <Button variant="ghost" disabled={disabled || !question.trim()}
      loading={working === "preview"} loadingLabel="正在准备修改…" onClick={() => void run("preview")}>
      预览修改
    </Button>
    {message && <p role="status">{message}</p>}
    <Dialog open={!!current} onOpenChange={open => { if (!open && !working) setReview(undefined); }}
      title="核对 AI 修改" size="lg" footer={current && (
        current.plan.refresh && !quarterReview
          ? <Button onClick={() => { setReview(undefined); onOpenData(suggestedPeriod); }}>打开数据检查器</Button>
          : <Button disabled={disabled || (quarterReview ? !quarterReview.changed : !affected)}
            loading={working === "apply"} loadingLabel="正在应用…" onClick={() => void run("apply")}>应用修改</Button>
      )}>
      {current && <>
        {quarterReview ? <DataRefreshComparison review={quarterReview} slides={detail.slides} />
          : <p>{current.plan.refresh
            ? `${suggestedPeriod ? `正式季度 ${suggestedPeriod} · ` : ""}逐组核对正式数据，再应用更新。`
            : `影响 ${affected} 页`}</p>}
        {current.theme && <p>整套主题由「{themeLabel(detail.project.theme_id)}」改为「{themeLabel(current.theme.id)}」。</p>}
        <ul className={styles.handoffPages}>
          {edits.map(edit => {
            const index = detail.slides.findIndex(slide => slide.id === edit.id);
            const original = detail.slides[index];
            if (!original) return null;
            return <li key={edit.id}>
              <strong>第 {index + 1} 页 · {original.content.title}</strong>
              {edit.title && <p>标题改为「{edit.title}」。</p>}
              {current.chartPreview?.filter(chart => chart.pageId === edit.id).map(chart => {
                const block = original.content.blocks[chart.blockIndex];
                const label = block?.kind === "chart" ? block.series.map(series => series.name).join("、") : "图表";
                return <p key={chart.blockIndex}>{label} · {chartLabels[chart.from]} → {chartLabels[chart.type]}</p>;
              })}
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
