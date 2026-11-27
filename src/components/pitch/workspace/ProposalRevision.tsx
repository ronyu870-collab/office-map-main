"use client";

import { useEffect, useRef, useState } from "react";
import { z } from "zod";
import { Button, Dialog } from "@/src/components/ui";
import { contentBlockSchema, sourceReferenceSchema } from "@/src/lib/pitch/contracts/content";
import { outlineQuarter, saveSchema, workspaceDetailSchema, type WorkspaceDetail } from "@/src/lib/pitch/workspace/protocol";
import { objectId } from "@/src/lib/pitch/workspace/object-layout";
import { themeLabel, WorkspaceError, type Call } from "./client";
import { DataRefreshComparison, dataRefreshPeriodSchema, dataRefreshReviewSchema, refreshPeriodLabel } from "./DataRefreshReview";
import { EvidencePages } from "./BusinessEvidence";
import {
  appliedLanguageSchema, LanguageRevisionReview, languageReviewSchema, matchesAppliedLanguage, matchesLanguageReview,
  PendingLanguageRevision, pendingLanguageSchema, type LanguageTexts,
} from "./LanguageRevisionReview";
import { LayoutRevisionReview, matchesAppliedLayout, requestedLayoutPages, reviewLayoutChanges, type LayoutReview } from "./LayoutRevision";
import { ProposalPreview, reviewedProposalSchema } from "./ProposalPreview";
import { appliedPhotoSchema, matchesAppliedPhoto, matchesPhotoReview, PhotoRevisionReview, photoReviewSchema } from "./PhotoRevisionReview";
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
  shorteningPreview: z.object({
    originalPageCount: projectVersion.max(50), pageCount: projectVersion.max(50),
    removed: z.array(z.object({ pageId: z.uuid(), title: z.string() })).min(1).max(49),
  }).optional(),
  review: dataRefreshReviewSchema.optional(),
  command: commandSchema.optional(),
});
const buildingSchema = z.object({ id: z.uuid(), name: z.string(), submarket: z.string().nullish() });
const comparisonBuildings = z.array(z.uuid()).min(2).max(20);
const languages = z.enum(["zh", "en"]);
const comparisonSchema = z.object({
  status: z.literal("ready"), scope: z.literal("document"), mode: z.literal("append-comparison"),
  review: z.object({
    status: z.literal("ready"), competitor: buildingSchema, fingerprint, period: outlineQuarter,
    buildingIds: comparisonBuildings, language: languages,
    pages: z.array(z.object({ title: z.string(), blocks: z.array(contentBlockSchema).min(1),
      sources: z.array(sourceReferenceSchema).min(1) })).min(1).max(50),
  }),
  command: z.strictObject({
    action: z.literal("add_to_pitch"), taskId: z.uuid(), fingerprint,
    target: z.strictObject({ mode: z.literal("append"), expectedVersion: projectVersion }),
    handoff: z.strictObject({ projectId: z.uuid(), period: outlineQuarter, language: languages,
      source: z.strictObject({ kind: z.literal("buildings"), buildingIds: comparisonBuildings }) }),
  }),
});
const taskReceiptSchema = z.object({ id: z.uuid(), state: z.enum(["queued", "processing", "completed", "failed", "cancelled"]) });
const regenerationSchema = z.strictObject({
  question: z.string().min(1).max(1000), projectId: z.uuid(), city: z.string(),
  buildingIds: z.array(z.uuid()).max(20), assetIds: z.array(z.uuid()).max(20).optional(),
  period: outlineQuarter.optional(), language: languages, audience: z.literal("internal"),
});
const outcomeSchema = z.union([
  comparisonSchema,
  photoReviewSchema,
  languageReviewSchema,
  pendingLanguageSchema,
  readySchema.extend({ status: z.literal("ready") }),
  readySchema.extend({ status: z.literal("refresh-review"),
    refreshPlan: z.union([reviewedProposalSchema, z.object({ brief: z.object({ period: outlineQuarter.nullable() }) })]),
    regeneration: regenerationSchema.optional(),
  }),
  z.object({ status: z.literal("clarification"), message: z.string(), candidates: z.array(buildingSchema).max(10).optional() }),
  z.object({ status: z.literal("unavailable"), message: z.string().optional() }),
]);
type StandardPreview = Extract<z.infer<typeof outcomeSchema>, { status: "ready" | "refresh-review" }>;
type Preview = StandardPreview | z.infer<typeof photoReviewSchema> | LayoutReview
  | z.infer<typeof languageReviewSchema> | z.infer<typeof pendingLanguageSchema>;
type Plan = Extract<Preview, { plan: unknown }>;
const chartLabels = { bar: "条形图", column: "柱状图", line: "折线图" } as const;

function removedPages(plan: Plan | undefined, slides: WorkspaceDetail["slides"]) {
  if (plan?.scope !== "document") return [];
  const retained = new Set(plan.plan.pages.map(page => page.id));
  return slides.filter(slide => !retained.has(slide.id));
}

function matchesRegeneration(value: Extract<Plan, { status: "refresh-review" }>, detail: WorkspaceDetail) {
  const { project, workspace } = detail;
  const { regeneration, refreshPlan } = value;
  const reference = value.plan.refresh;
  if (!regeneration || !("plan" in refreshPlan) || !reference || value.scope !== "document") return false;
  const { plan, brief } = refreshPlan;
  const context = workspace.context;
  if (regeneration.projectId !== project.id || regeneration.city !== project.city || brief.language !== regeneration.language ||
    regeneration.buildingIds.join() !== context.buildingIds.join() || brief.buildingIds.join() !== regeneration.buildingIds.join() ||
    !outlineQuarter.safeParse(brief.period).success || regeneration.period && regeneration.period !== brief.period ||
    plan.id !== reference.id || plan.version !== reference.version || plan.contextFingerprint !== reference.contextFingerprint) return false;
  const client = brief.targetClient ?? "";
  const samePeriod = regeneration.period === context.period && brief.period === context.period;
  if (regeneration.language !== context.language)
    return samePeriod && brief.scenario === context.business && client === context.client;
  if (client !== context.client)
    return samePeriod && brief.scenario === "site-selection" && !!client && plan.slides.some(page => page.pageKind === "requirements");
  return context.business === "market-report" && brief.scenario === "market-report";
}

function matchesPreview(value: StandardPreview, detail: WorkspaceDetail) {
  if ("mode" in value) {
    const { command, review } = value;
    const { buildingIds, period, language } = detail.workspace.context;
    return command.handoff.projectId === detail.project.id && command.target.expectedVersion === detail.project.version &&
      command.fingerprint === review.fingerprint && command.handoff.period === review.period && review.period === period &&
      command.handoff.language === review.language && review.language === language &&
      command.handoff.source.buildingIds.join() === review.buildingIds.join() && new Set(review.buildingIds).size === review.buildingIds.length &&
      buildingIds.length > 0 && buildingIds.every(id => review.buildingIds.includes(id)) &&
      review.buildingIds.includes(review.competitor.id) && !buildingIds.includes(review.competitor.id) &&
      detail.slides.length + review.pages.length <= 50;
  }
  const { plan, command, review } = value;
  if (plan.projectId !== detail.project.id || plan.expectedVersion !== detail.project.version) return false;
  if (value.status === "refresh-review" && value.regeneration && !matchesRegeneration(value, detail)) return false;
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
  if (value.shorteningPreview) {
    const summary = value.shorteningPreview;
    const removed = removedPages(value, detail.slides);
    const removedIds = new Set(removed.map(slide => slide.id));
    const retained = detail.slides.filter(slide => !removedIds.has(slide.id));
    if (command?.action !== "apply_modification" || value.scope !== "document" || summary.originalPageCount !== detail.slides.length ||
      summary.pageCount !== retained.length || plan.pages.length !== retained.length || summary.removed.length !== removed.length ||
      retained.some((slide, index) => plan.pages[index].id !== slide.id) ||
      removed.some((slide, index) => summary.removed[index].pageId !== slide.id || summary.removed[index].title !== slide.content.title)) return false;
  }
  const changes = plan.pages.flatMap(page => (page.chartPresentation ?? []).map(chart => ({ ...chart, pageId: page.id })));
  const chartPreview = value.chartPreview ?? [];
  if (changes.length !== chartPreview.length || (changes.length && !command)) return false;
  return changes.every(change => {
    const block = detail.slides.find(slide => slide.id === change.pageId)?.content.blocks[change.blockIndex];
    return block?.kind === "chart" && chartPreview.some(chart => chart.pageId === change.pageId &&
      chart.blockIndex === change.blockIndex && chart.type === change.type && chart.from === block.chartType);
  });
}

export type ProposalRevisionProps = {
  call: Call;
  detail: WorkspaceDetail;
  question: string;
  active?: string;
  selected: string[];
  objectIds: string[];
  disabled: boolean;
  onApplied: (result: WorkspaceDetail, expectedVersion: number) => void;
  onOpenData: (period?: string) => void;
  onAppend: (receipt: z.infer<typeof taskReceiptSchema>, expectedVersion: number) => void;
  onGenerated?: (id: string) => Promise<void>;
};

export function ProposalRevision({ call, detail, question, active, selected, objectIds, disabled, onApplied, onOpenData, onAppend, onGenerated }: ProposalRevisionProps) {
  const [review, setReview] = useState<{ key: string; value: Preview }>();
  const [candidates, setCandidates] = useState<{ key: string; items: z.infer<typeof buildingSchema>[] }>();
  const [working, setWorking] = useState<"preview" | "apply">();
  const [regenerating, setRegenerating] = useState(false);
  const [message, setMessage] = useState("");
  const request = useRef<AbortController | null>(null);
  const projectId = detail.project.id;
  const expectedVersion = detail.project.version;
  const key = JSON.stringify([projectId, expectedVersion, question, active, selected, objectIds]);
  const visible = review?.key === key ? review.value : undefined;
  const layout = visible?.status === "layout-review" ? visible : undefined;
  const photo = visible?.status === "photo-review" ? visible : undefined;
  const language = visible?.status === "language-review" ? visible : undefined;
  const pendingLanguage = visible?.status === "language-translation-required" ? visible : undefined;
  const comparison = visible && "mode" in visible ? visible : undefined;
  const current: Plan | undefined = visible && "plan" in visible ? visible : undefined;
  const quarterReview = current?.command?.action === "apply_data_refresh" ? current.review : undefined;
  useEffect(() => () => request.current?.abort(), []);

  async function run(action: "preview" | "apply", competitorBuildingId?: string, languageTexts?: LanguageTexts) {
    if (disabled || !question.trim() || !detail.slides.length || request.current) return;
    const controller = new AbortController();
    request.current = controller;
    setMessage("");
    setWorking(action);
    try {
      if (action === "preview") {
        setCandidates(undefined);
        const layoutPages = requestedLayoutPages(question, detail, active, selected);
        if (layoutPages) {
          const result = await reviewLayoutChanges(call, detail, layoutPages, controller.signal);
          if (!controller.signal.aborted) setReview({ key, value: result });
          return;
        }
        const input = {
          projectId, expectedVersion, question: question.trim(), currentPageId: active,
          pageIds: selected, objectIds,
          ...(competitorBuildingId ? { competitorBuildingId } : {}),
          ...(languageTexts ? { languageTexts } : {}),
        };
        const result = outcomeSchema.parse(await call({ action: "proposal_revision", input }, true, "ai", controller.signal));
        if (controller.signal.aborted) return;
        if (result.status === "photo-review" && matchesPhotoReview(result, detail, input)) {
          setReview({ key, value: result });
        } else if ((result.status === "language-review" || result.status === "language-translation-required") &&
          matchesLanguageReview(result, detail, input)) {
          setReview({ key, value: result });
        } else if ((result.status === "ready" || result.status === "refresh-review") && matchesPreview(result, detail)) {
          setReview({ key, value: result });
        } else {
          setReview(undefined);
          if (result.status === "clarification" && result.candidates?.length) setCandidates({ key, items: result.candidates });
          const feedback = "message" in result ? result.message : undefined;
          setMessage(feedback || "当前资料或版式无法生成可应用的修改。请缩小范围或指定要更改的内容。");
        }
      } else if (layout) {
        const result = workspaceDetailSchema.parse(await call(layout.command, true, "workspace", controller.signal));
        if (controller.signal.aborted) return;
        if (!matchesAppliedLayout(layout, detail, result)) throw new Error("无法核对保存后的版式，请重新打开项目检查。");
        setReview(undefined);
        onApplied(result, expectedVersion);
      } else if (photo) {
        const result = appliedPhotoSchema.parse(await call(photo.command, true, "ai", controller.signal));
        if (controller.signal.aborted) return;
        if (!matchesAppliedPhoto(photo, result.workspace)) throw new Error("无法核对保存后的照片，请重新打开项目检查。");
        setReview(undefined);
        onApplied(result.workspace, expectedVersion);
      } else if (language) {
        const result = appliedLanguageSchema.parse(await call(language.command, true, "ai", controller.signal));
        if (controller.signal.aborted) return;
        if (!matchesAppliedLanguage(language, detail, result.workspace)) throw new Error("无法核对保存后的译文，请重新打开项目检查。");
        setReview(undefined);
        onApplied(result.workspace, expectedVersion);
      } else if (comparison) {
        const receipt = taskReceiptSchema.parse(await call(comparison.command, true, "workspace", controller.signal));
        if (controller.signal.aborted) return;
        if (receipt.id !== comparison.command.taskId) throw new Error("追加任务编号不匹配，请重新查询。");
        setReview(undefined);
        onAppend(receipt, expectedVersion);
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
      const mayRetryAppend = action === "apply" && comparison &&
        (!(cause instanceof WorkspaceError) || cause.status >= 500 || cause.status === 408);
      if (!mayRetryAppend && !(languageTexts && pendingLanguage)) setReview(undefined);
      setMessage(cause instanceof WorkspaceError && cause.status === 409
        ? photo ? "项目或照片来源已更新，请重新打开项目后再核对。" : "项目版本已变化，请重新打开项目后再预览。"
        : cause instanceof Error && !(cause instanceof z.ZodError) ? cause.message : "修改未完成，请重新预览。");
    } finally {
      request.current = null;
      if (!controller.signal.aborted) setWorking(undefined);
    }
  }

  const edits = current?.plan.pages.filter(page => Object.keys(page).some(field => field !== "id")) ?? [];
  const removed = removedPages(current, detail.slides);
  const theme = current?.theme;
  const themeChanged = theme && (theme.id !== detail.project.theme_id || theme.version !== detail.project.theme_version);
  const affected = themeChanged ? detail.slides.length : edits.length + removed.length;
  const regeneration = current?.status === "refresh-review" && onGenerated && current.regeneration && "plan" in current.refreshPlan
    ? { input: current.regeneration, data: current.refreshPlan } : undefined;
  const suggestedPeriod = current?.status === "refresh-review" ? current.refreshPlan.brief.period ?? undefined : undefined;
  return <>
    <Button variant="ghost" disabled={disabled || !question.trim()}
      loading={working === "preview"} loadingLabel="正在准备修改…" onClick={() => void run("preview")}>
      预览修改
    </Button>
    {message && !visible && <p role="status">{message}</p>}
    {candidates?.key === key && <div className={styles.form} aria-label="匹配的竞品">
      {candidates.items.map(candidate => <Button key={candidate.id} variant="secondary" disabled={disabled || !!working}
        onClick={() => void run("preview", candidate.id)}>{candidate.name}{candidate.submarket && ` · ${candidate.submarket}`}</Button>)}
    </div>}
    <Dialog open={!!visible} dismissible={!regenerating} onOpenChange={open => { if (!open && !working && !regenerating) setReview(undefined); }}
      title="核对 AI 修改" size="lg" footer={layout ? <Button disabled={disabled} loading={working === "apply"}
        loadingLabel="正在应用…" onClick={() => void run("apply")}>应用新布局</Button>
        : photo ? <Button disabled={disabled} loading={working === "apply"}
        loadingLabel="正在更换…" onClick={() => void run("apply")}>确认换图</Button>
        : language ? <Button disabled={disabled} loading={working === "apply"}
        loadingLabel="正在保存…" onClick={() => void run("apply")}>确认语言切换</Button>
        : comparison ? <Button disabled={disabled} loading={working === "apply"}
        loadingLabel="正在提交…" onClick={() => void run("apply")}>{message ? "继续追加" : "追加对比页"}</Button> : current && !regeneration && (
        current.plan.refresh && !quarterReview
          ? <Button onClick={() => { setReview(undefined); onOpenData(suggestedPeriod); }}>打开数据检查器</Button>
          : <Button disabled={disabled || (quarterReview ? !quarterReview.changed : !affected)}
            loading={working === "apply"} loadingLabel="正在应用…" onClick={() => void run("apply")}>应用修改</Button>
      )}>
      {layout && <LayoutRevisionReview review={layout} detail={detail} />}
      {photo && <PhotoRevisionReview review={photo} detail={detail} />}
      {language && <LanguageRevisionReview review={language} detail={detail} />}
      {pendingLanguage && <>
        <PendingLanguageRevision key={key} review={pendingLanguage} detail={detail} busy={disabled || !!working}
          submit={texts => void run("preview", undefined, texts)} />
        {message && <p role="alert">{message}</p>}
      </>}
      {comparison && <>
        <p>{comparison.review.competitor.name} · {comparison.review.period} · 追加 {comparison.review.pages.length} 页</p>
        <EvidencePages pages={comparison.review.pages} />
        {message && <p role="alert">{message}</p>}
      </>}
      {regeneration && onGenerated && <>
        {(regeneration.input.language !== detail.workspace.context.language ||
          (regeneration.data.brief.targetClient ?? "") !== detail.workspace.context.client) &&
          <p>{["生成衍生项目", regeneration.data.brief.period, regeneration.input.language === "en" ? "英文" : "中文",
            regeneration.data.brief.targetClient].filter(Boolean).join(" · ")}</p>}
        <ProposalPreview key={regeneration.data.plan.id} call={call} projectId={projectId} projectVersion={expectedVersion}
          city={regeneration.input.city} question={regeneration.input.question} language={regeneration.input.language}
          period={regeneration.input.period ?? ""} buildingIds={regeneration.input.buildingIds} disabled={disabled}
          reviewed={regeneration} onGenerating={setRegenerating}
          onGenerated={async id => { await onGenerated(id); setReview(undefined); }} />
      </>}
      {current && !regeneration && <>
        {quarterReview ? <DataRefreshComparison review={quarterReview} slides={detail.slides} />
          : <p>{current.plan.refresh
            ? `${suggestedPeriod ? `正式季度 ${suggestedPeriod} · ` : ""}逐组核对正式数据，再应用更新。`
            : current.shorteningPreview ? `从 ${current.shorteningPreview.originalPageCount} 页精简至 ${current.shorteningPreview.pageCount} 页`
            : `影响 ${affected} 页`}</p>}
        {themeChanged && <p>整套主题由「{themeLabel(detail.project.theme_id)}」改为「{themeLabel(theme.id)}」。</p>}
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
