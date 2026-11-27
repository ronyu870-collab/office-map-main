"use client";

import { useEffect, useEffectEvent, useLayoutEffect, useRef, useState } from "react";
import { z } from "zod";
import { proposalInterpretationReceiptSchema } from "@/src/lib/pitch/ai/proposal-brief";
import { outlineQuarter } from "@/src/lib/pitch/workspace/protocol";
import { Button } from "@/src/components/ui";
import type { Call } from "./client";
import { WorkspaceError } from "./client";
import { PhotoPreviewImage } from "./PhotoPreviewImage";
import { plannedPhotoSchema } from "./PhotoRevisionReview";
import styles from "./workspace.module.css";

const projectThemeSchema = z.object({ id: z.string().min(1).max(100), version: z.number().int().positive() });
const responseSchema = z.discriminatedUnion("status", [
  z.object({
    status: z.literal("ready"),
    interpretationReceipt: proposalInterpretationReceiptSchema.optional(),
    plan: z.object({
      id: z.uuid(),
      title: z.string(),
      version: z.number().int().positive(),
      contextFingerprint: z.string().regex(/^[a-f0-9]{64}$/),
      theme: projectThemeSchema.optional(),
      slides: z.array(z.object({
        id: z.uuid(), title: z.string(), pageKind: z.string().optional(),
        visuals: z.array(z.unknown()).optional().transform(refs => (refs ?? []).flatMap(ref => {
          const photo = plannedPhotoSchema.safeParse(ref);
          return photo.success ? [photo.data] : [];
        })),
      })),
      gaps: z.array(z.object({ pageKind: z.string(), reason: z.string() })),
    }),
    brief: z.object({
      city: z.string(),
      submarkets: z.array(z.string()),
      period: z.string().nullable(),
      buildingIds: z.array(z.uuid()),
      language: z.enum(["zh", "en"]).optional(),
      scenario: z.string().optional(),
      targetClient: z.string().nullable().optional(),
    }),
    selection: z.enum(["explicit", "scoped-sample", "none"]),
  }),
  z.object({
    status: z.enum(["clarification", "unavailable"]),
    message: z.string(),
    candidates: z.array(z.object({ id: z.uuid(), name: z.string(), submarket: z.string().nullish() })).optional(),
  }),
]);
export const reviewedProposalSchema = responseSchema.options[0];
type Result = z.infer<typeof responseSchema>;
type Request = {
  question: string;
  projectId?: string;
  language: "zh" | "en";
  buildingIds: string[];
  assetIds?: string[];
  city?: string;
  period?: string;
  audience: "internal";
};
const receiptSchema = z.discriminatedUnion("state", [
  z.object({ taskId: z.uuid(), state: z.literal("completed"), projectId: z.uuid() }),
  z.object({ taskId: z.uuid(), state: z.enum(["queued", "running", "failed", "cancelled"]), projectId: z.uuid().optional(), errorCode: z.string().optional() }),
]);
type Project = { id: string; version: number };
export type ProposalProjectInput = {
  id: string;
  title: string;
  language: "zh" | "en";
  buildingIds: string[];
  period: string;
  theme?: z.infer<typeof projectThemeSchema>;
};
type Destination =
  | { projectId: string; projectVersion: number; createProject?: never }
  | { projectId?: never; projectVersion?: never; createProject: (input: ProposalProjectInput) => Promise<Project> };

function PlannedPhotos({ slides, onStale }: {
  slides: z.infer<typeof reviewedProposalSchema>["plan"]["slides"];
  onStale: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState(0);
  const photos = [...new Map(slides.flatMap(slide => slide.visuals.map(photo =>
    [photo.pin.versionHash, photo] as const))).values()];
  const photo = photos[selected] ?? photos[0];
  if (!photo) return null;
  return <details className={styles.refreshChanges} onToggle={event => setOpen(event.currentTarget.open)}>
    <summary>已选楼宇照片（{photos.length}）</summary>
    {open && <div className={styles.form}>
      {photos.length > 1 && <label>
        照片
        <select value={selected} onChange={event => setSelected(Number(event.target.value))}>
          {photos.map((item, index) => <option key={item.pin.versionHash} value={index}>{item.caption}</option>)}
        </select>
      </label>}
      <PhotoPreviewImage key={photo.pin.versionHash} pin={photo.pin} caption={photo.caption} onStale={onStale} />
      <p>{photo.label}</p>
    </div>}
  </details>;
}

export function ProposalPreview({ call, projectId, city, question, language, period, buildingIds, initialQuestion, disabled, projectVersion, createProject, onGenerated, onGenerating, reviewed }: Destination & {
  call: Call;
  city?: string;
  question: string;
  language: "zh" | "en";
  period: string;
  buildingIds: string[];
  initialQuestion?: string;
  disabled: boolean;
  onGenerated: (projectId: string) => Promise<void>;
  onGenerating?: (generating: boolean) => void;
  reviewed?: { data: z.infer<typeof reviewedProposalSchema>; input: Request };
}) {
  const inputKey = JSON.stringify([projectId, projectVersion, city, question, language, period, buildingIds]);
  const [result, setResult] = useState<{ key: string; data: Result; input: Request } | undefined>(
    () => reviewed && { key: inputKey, ...reviewed },
  );
  const [error, setError] = useState("");
  const [working, setWorking] = useState<"plan" | "generate">();
  const [recovery, setRecovery] = useState(false);
  const [taskProgress, setTaskProgress] = useState<{ key: string; state: "queued" | "running" }>();
  const submission = useRef<{ key: string; taskId: string; sourceId: string; source?: Project; completedProject?: string }>(null);
  const request = useRef<AbortController | null>(null);
  const autoStarted = useRef(false);
  const currentInput = useRef(inputKey);
  const visible = result?.key === inputKey ? result.data : undefined;
  const taskState = taskProgress?.key === inputKey ? taskProgress.state : undefined;
  const validPeriod = !period || outlineQuarter.safeParse(period).success;

  useLayoutEffect(() => { currentInput.current = inputKey; }, [inputKey]);
  useEffect(() => () => request.current?.abort(), []);
  useEffect(() => {
    if (autoStarted.current || !initialQuestion || !question.trim() || disabled) return;
    const timer = setTimeout(() => {
      autoStarted.current = true;
      void preview();
    }, 0);
    return () => clearTimeout(timer);
  // Trigger once when the operator explicitly starts a preset on the home screen.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialQuestion, disabled]);

  async function preview(candidate?: string) {
    if (!question.trim() || disabled || !validPeriod || working === "generate") return;
    request.current?.abort();
    const current = new AbortController();
    request.current = current;
    setError("");
    setWorking("plan");
    setRecovery(false);
    try {
      const input: Request = {
        question: question.trim(), ...(projectId ? { projectId } : {}), language,
        buildingIds: candidate ? [candidate] : buildingIds,
        ...(reviewed?.input.assetIds?.length ? { assetIds: reviewed.input.assetIds } : {}),
        ...(city ? { city } : {}),
        ...(period ? { period } : {}),
        audience: "internal",
      };
      const data = responseSchema.parse(await call({ action: "proposal_plan", input }, true, "ai", current.signal));
      if (!current.signal.aborted) setResult({ key: inputKey, data, input });
    } catch (cause) {
      if (current.signal.aborted) return;
      setResult(undefined);
      setError(cause instanceof WorkspaceError && [400, 404].includes(cause.status)
        ? "正式提案规划暂不可用。"
        : cause instanceof Error && !(cause instanceof z.ZodError) ? cause.message : "提案规划暂时未能读取，请重试。");
    } finally {
      if (request.current === current) request.current = null;
      if (!current.signal.aborted) setWorking(undefined);
    }
  }

  async function generate() {
    if (!result || visible?.status !== "ready" || disabled || working || request.current) return;
    const { id: planId, contextFingerprint } = visible.plan;
    const { interpretationReceipt } = visible;
    const key = JSON.stringify([inputKey, planId, contextFingerprint, interpretationReceipt]);
    if (submission.current?.key !== key) submission.current = {
      key, taskId: crypto.randomUUID(), sourceId: projectId ?? crypto.randomUUID(),
    };
    const entry = submission.current;
    const current = new AbortController();
    request.current = current;
    setError("");
    setWorking("generate");
    onGenerating?.(true);
    try {
      if (!entry.completedProject) {
        entry.source ??= projectId !== undefined
          ? { id: projectId, version: projectVersion }
          : await createProject({
            id: entry.sourceId, title: visible.plan.title,
            language: visible.brief.language ?? language,
            buildingIds: visible.brief.buildingIds,
            period: visible.brief.period ?? "",
            theme: visible.plan.theme,
          });
        if (current.signal.aborted) return;
        const source = entry.source;
        const receipt = receiptSchema.parse(await call({
          action: "proposal_generate",
          confirmation: { taskId: entry.taskId, projectId: source.id, expectedVersion: source.version,
            planId, contextFingerprint, ...(interpretationReceipt ? { interpretationReceipt } : {}),
            request: { ...result.input, projectId: source.id } },
        }, true, "ai", current.signal));
        if (current.signal.aborted) return;
        if (receipt.taskId !== entry.taskId) throw new Error("生成任务编号不匹配，请重新查询。");
        setRecovery(false);
        if (receipt.state === "queued" || receipt.state === "running") {
          setTaskProgress({ key: inputKey, state: receipt.state });
          return;
        }
        setTaskProgress(undefined);
        if (receipt.state !== "completed") {
          submission.current = { ...entry, taskId: crypto.randomUUID() };
          setError(receipt.errorCode === "PITCH_EDITION_LAYOUT" ? "新季度内容无法与部分已编辑页面对应。请核对原稿布局和文字后再预览。"
            : receipt.state === "cancelled" ? "生成已取消。可以重新生成。" : "生成失败。可以重新生成。");
          if (receipt.errorCode === "PITCH_EDITION_LAYOUT") setResult(undefined);
          return;
        }
        entry.completedProject = receipt.projectId;
      }
      if (!current.signal.aborted && currentInput.current === inputKey) await onGenerated(entry.completedProject);
    } catch (cause) {
      if (current.signal.aborted || currentInput.current !== inputKey) return;
      if (cause instanceof WorkspaceError && cause.status === 409) {
        if (!projectId) entry.source = undefined;
        setTaskProgress(undefined);
        setResult(undefined);
        setError(reviewed ? "项目或资料已更新，请关闭核对窗口后重新预览修改。" : "项目或资料已更新，请重新规划正式提案。");
      } else {
        setRecovery(true);
        setError(cause instanceof Error && !(cause instanceof z.ZodError) ? cause.message : "生成结果暂时无法读取。");
      }
    } finally {
      if (request.current === current) request.current = null;
      if (!current.signal.aborted) setWorking(undefined);
      onGenerating?.(false);
    }
  }

  const queryProgress = useEffectEvent(() => void generate());
  const following = !!taskState && !recovery && !working && !disabled;
  useEffect(() => {
    if (!following) return;
    const timer = setTimeout(() => queryProgress(), 1500);
    return () => clearTimeout(timer);
  }, [following, taskProgress]);

  return <section className={styles.proposalReview} aria-label="业务提案规划">
    {!reviewed && <Button variant="secondary" disabled={disabled || !question.trim() || !validPeriod || !!taskState || working === "generate"}
      loading={working === "plan"} loadingLabel="正在核对范围与正式资料…" onClick={() => void preview()}>
      规划正式提案
    </Button>}
    {error && <p role="alert">{error}</p>}
    {visible?.status === "ready" && <>
      <h3>{visible.plan.title}</h3>
      <p>{[visible.brief.city, ...visible.brief.submarkets, visible.brief.period,
        visible.brief.buildingIds.length ? `${visible.brief.buildingIds.length} 栋楼宇` : null,
        `${visible.plan.slides.length} 页`].filter(Boolean).join(" · ")}</p>
      {visible.selection === "scoped-sample" && <p>按需求范围选取的候选样本。{projectId
        ? "可在「数据」中指定楼宇后重新核对。"
        : "如需指定楼宇，可先打开项目设置。"}</p>}
      <ol>{visible.plan.slides.map(slide => <li key={slide.id}>{slide.title}</li>)}</ol>
      <PlannedPhotos key={visible.plan.id} slides={visible.plan.slides} onStale={() => {
        if (request.current || working || taskState || recovery) return;
        setResult(undefined);
        setError(reviewed ? "照片版本已更新，请关闭核对窗口后重新预览修改。" : "照片版本已更新，请重新规划正式提案。");
      }} />
      {visible.plan.gaps.length > 0 && <details>
        <summary>资料缺口（{visible.plan.gaps.length}）</summary>
        <ul>{visible.plan.gaps.map(({ reason }, index) => <li key={index}>{reason}</li>)}</ul>
      </details>}
      {taskState && <p role="status">{taskState === "queued" ? "等待生成提案…" : "正在生成提案…"}</p>}
      <Button disabled={disabled || working === "plan"} loading={working === "generate"}
        loadingLabel={taskState ? "正在查询生成进度…" : "正在按已核对的方案生成…"} onClick={() => void generate()}>
        {taskState ? recovery ? "重新查询生成进度" : "查询生成进度"
          : recovery ? "重新查询或继续生成" : reviewed ? "确认并生成新版 Pitch" : "确认并生成 Pitch"}
      </Button>
    </>}
    {visible && visible.status !== "ready" && <>
      <p role="status">{visible.message}</p>
      {visible.candidates?.map(candidate => <Button variant="ghost" key={candidate.id}
        disabled={disabled || !!working} onClick={() => void preview(candidate.id)}>
        {candidate.name}{candidate.submarket ? ` · ${candidate.submarket}` : ""}
      </Button>)}
    </>}
  </section>;
}
