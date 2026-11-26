"use client";

import { useEffect, useRef, useState } from "react";
import { z } from "zod";
import { outlineQuarter } from "@/src/lib/pitch/workspace/protocol";
import { Button } from "@/src/components/ui";
import type { Call } from "./client";
import { WorkspaceError } from "./client";
import styles from "./workspace.module.css";

const responseSchema = z.discriminatedUnion("status", [
  z.object({
    status: z.literal("ready"),
    plan: z.object({
      id: z.uuid(),
      title: z.string(),
      version: z.number().int().positive(),
      contextFingerprint: z.string().regex(/^[a-f0-9]{64}$/),
      slides: z.array(z.object({ id: z.uuid(), title: z.string() })),
      gaps: z.array(z.object({ pageKind: z.string(), reason: z.string() })),
    }),
    brief: z.object({
      city: z.string(),
      submarkets: z.array(z.string()),
      period: z.string().nullable(),
      buildingIds: z.array(z.uuid()),
    }),
    selection: z.enum(["explicit", "scoped-sample", "none"]),
  }),
  z.object({
    status: z.enum(["clarification", "unavailable"]),
    message: z.string(),
    candidates: z.array(z.object({ id: z.uuid(), name: z.string(), submarket: z.string().optional() })).optional(),
  }),
]);
type Result = z.infer<typeof responseSchema>;
type Request = {
  question: string;
  projectId: string;
  language: "zh" | "en";
  buildingIds: string[];
  city?: string;
  period?: string;
  audience: "internal";
};
const receiptSchema = z.object({ taskId: z.uuid(), projectId: z.uuid(), state: z.literal("completed") });

export function ProposalPreview({ call, projectId, city, question, language, period, buildingIds, initialQuestion, disabled, projectVersion, onGenerated }: {
  call: Call;
  projectId: string;
  city?: string;
  question: string;
  language: "zh" | "en";
  period: string;
  buildingIds: string[];
  initialQuestion?: string;
  disabled: boolean;
  projectVersion: number;
  onGenerated: (projectId: string) => Promise<void>;
}) {
  const [result, setResult] = useState<{ key: string; data: Result; input: Request }>();
  const [error, setError] = useState("");
  const [working, setWorking] = useState<"plan" | "generate">();
  const [recovery, setRecovery] = useState(false);
  const submission = useRef<{ key: string; taskId: string; completedProject?: string }>(null);
  const request = useRef<AbortController | null>(null);
  const autoStarted = useRef(false);
  const inputKey = JSON.stringify([projectId, projectVersion, city, question, language, period, buildingIds]);
  const visible = result?.key === inputKey ? result.data : undefined;
  const validPeriod = !period || outlineQuarter.safeParse(period).success;

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
        question: question.trim(), projectId, language,
        buildingIds: candidate ? [candidate] : buildingIds,
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
        ? "正式提案规划暂不可用。你可以继续使用下方的提纲和素材工具。"
        : cause instanceof Error && !(cause instanceof z.ZodError) ? cause.message : "提案规划暂时未能读取，请重试。");
    } finally {
      if (!current.signal.aborted) setWorking(undefined);
    }
  }

  async function generate() {
    if (!result || visible?.status !== "ready" || disabled || working) return;
    const { id: planId, contextFingerprint } = visible.plan;
    const key = JSON.stringify([inputKey, planId, contextFingerprint]);
    if (submission.current?.key !== key) submission.current = { key, taskId: crypto.randomUUID() };
    const entry = submission.current;
    const current = new AbortController();
    request.current = current;
    setError("");
    setWorking("generate");
    try {
      if (!entry.completedProject) {
        const receipt = receiptSchema.parse(await call({
          action: "proposal_generate",
          confirmation: { taskId: entry.taskId, projectId, expectedVersion: projectVersion,
            planId, contextFingerprint, request: result.input },
        }, true, "ai", current.signal));
        if (receipt.taskId !== entry.taskId) throw new Error("生成任务编号不匹配，请重新查询。");
        entry.completedProject = receipt.projectId;
      }
      if (!current.signal.aborted) await onGenerated(entry.completedProject);
    } catch (cause) {
      if (current.signal.aborted) return;
      if (cause instanceof WorkspaceError && cause.status === 409) {
        setResult(undefined);
        setError("项目或资料已更新，请重新规划正式提案。");
      } else {
        setRecovery(true);
        setError(cause instanceof Error && !(cause instanceof z.ZodError) ? cause.message : "生成结果暂时无法读取。");
      }
    } finally {
      if (!current.signal.aborted) setWorking(undefined);
    }
  }

  return <section className={styles.proposalReview} aria-label="业务提案规划">
    <Button variant="secondary" disabled={disabled || !question.trim() || !validPeriod || working === "generate"}
      loading={working === "plan"} loadingLabel="正在核对范围与正式资料…" onClick={() => void preview()}>
      规划正式提案
    </Button>
    {error && <p role="alert">{error}</p>}
    {visible?.status === "ready" && <>
      <h3>{visible.plan.title}</h3>
      <p>{[visible.brief.city, ...visible.brief.submarkets, visible.brief.period, `${visible.plan.slides.length} 页`].filter(Boolean).join(" · ")}</p>
      {visible.selection === "scoped-sample" && <p>按需求范围选取的候选样本。可在「数据」中指定楼宇后重新核对。</p>}
      <ol>{visible.plan.slides.map(slide => <li key={slide.id}>{slide.title}</li>)}</ol>
      {visible.plan.gaps.length > 0 && <details>
        <summary>资料缺口（{visible.plan.gaps.length}）</summary>
        <ul>{visible.plan.gaps.map(({ reason }, index) => <li key={index}>{reason}</li>)}</ul>
      </details>}
      <Button disabled={disabled || working === "plan"} loading={working === "generate"}
        loadingLabel="正在按已核对的方案生成…" onClick={() => void generate()}>
        {recovery ? "重新查询或继续生成" : "确认并生成 Pitch"}
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
