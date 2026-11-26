"use client";

import { useEffect, useRef, useState } from "react";
import { z } from "zod";
import { Button, Dialog } from "@/src/components/ui";
import type { PitchScope } from "@/src/lib/pitch/contracts/content";
import { outlineQuarter, workspaceDetailSchema } from "@/src/lib/pitch/workspace/protocol";
import type { PitchHandoffNavigation } from "../PitchHandoffLink";
import { WorkspaceError, type Call } from "./client";
import styles from "./workspace.module.css";

const projectsSchema = z.object({
  items: z.array(z.object({ id: z.uuid(), title: z.string(), state: z.string().optional() })),
});
const readySchema = z.object({
  status: z.literal("ready"), period: z.string(), fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  submarkets: z.array(z.string()), buildingIds: z.array(z.uuid()),
  binding: z.object({ dataAsOf: z.iso.date() }),
  pages: z.array(z.object({ title: z.string(), sources: z.array(z.object({ label: z.string() })) })),
});
const reviewSchema = z.discriminatedUnion("status", [readySchema, z.object({ status: z.literal("period_required") })]);
const receiptSchema = z.object({ state: z.enum(["queued", "processing", "completed", "failed", "cancelled"]) });
type Ready = z.infer<typeof readySchema>;
type AddToPitch = PitchHandoffNavigation & { projectId?: string };

type Target = { mode: "append"; expectedVersion: number } | ({
  mode: "create"; projectId: string; title: string; scope: PitchScope; themeId: string; themeVersion: number;
});
type Submit = { action: "add_to_pitch"; handoff: AddToPitch; target: Target; fingerprint: string; taskId: string };

export function HandoffReview({ source, call, grants, theme, onOpen, onClose }: {
  source: PitchHandoffNavigation;
  call: Call;
  grants: PitchScope[];
  theme?: { id: string; current_version: number };
  onOpen: (id: string) => Promise<void>;
  onClose: () => void;
}) {
  const [projects, setProjects] = useState<z.infer<typeof projectsSchema>["items"]>([]);
  const [projectId, setProjectId] = useState("");
  const [scopeIndex, setScopeIndex] = useState(0);
  const [period, setPeriod] = useState(source.period ?? "");
  const lease = source.source.kind === "lease-search" ? source.source : undefined;
  const [title, setTitle] = useState("");
  const [review, setReview] = useState<{ data: Ready; handoff: AddToPitch; version?: number }>();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState<"review" | "submit">();
  const [submitted, setSubmitted] = useState(false);
  const [projectListError, setProjectListError] = useState("");
  const [listAttempt, setListAttempt] = useState(0);
  const operation = useRef<AbortController>(null);
  const command = useRef<{ payload: Submit; projectId: string; accepted: boolean }>(null);
  const canCreate = !!grants[scopeIndex] && !!theme;
  const validPeriod = !period || outlineQuarter.safeParse(period).success;

  useEffect(() => {
    const request = new AbortController();
    void call({ action: "list", filter: "active" }, false, "workspace", request.signal)
      .then(projectsSchema.parse)
      .then(result => { if (!request.signal.aborted) setProjects(result.items); })
      .catch((cause: unknown) => {
        if (!request.signal.aborted) setProjectListError(cause instanceof Error && !(cause instanceof z.ZodError) ? cause.message : "项目列表读取未完成。");
      });
    return () => request.abort();
  }, [call, listAttempt]);
  useEffect(() => () => operation.current?.abort(), []);

  function resetReview() {
    setReview(undefined);
    setError("");
    setSubmitted(false);
    command.current = null;
  }

  async function checkSource() {
    if (operation.current || !validPeriod || (!projectId && !canCreate)) return;
    const request = new AbortController();
    operation.current = request;
    resetReview();
    setBusy("review");
    try {
      const handoff: AddToPitch = {
        source: source.source,
        ...(period ? { period } : {}),
        ...(source.language ? { language: source.language } : {}),
        ...(projectId ? { projectId } : {}),
      };
      const selected = projectId
        ? workspaceDetailSchema.parse(await call({ action: "get", projectId }, true, "workspace", request.signal))
        : null;
      const response = reviewSchema.parse(await call({ action: "review_handoff", handoff }, true, "workspace", request.signal));
      if (request.signal.aborted) return;
      if (response.status === "period_required") {
        setError("请选择正式季度后重新核对。");
        return;
      }
      setTitle(value => value || response.pages[0]?.title || "业务提案");
      setReview({ data: response, handoff, version: selected?.project.version });
    } catch (cause) {
      if (!request.signal.aborted) setError(cause instanceof Error && !(cause instanceof z.ZodError) ? cause.message : "来源核对结果暂时无法读取。");
    } finally {
      operation.current = null;
      if (!request.signal.aborted) setBusy(undefined);
    }
  }

  async function submit() {
    if (!review || operation.current) return;
    const request = new AbortController();
    const destination = projectId || crypto.randomUUID();
    if (!command.current) {
      const scope = grants[scopeIndex];
      const target: Target | null = projectId
        ? review.version === undefined ? null : { mode: "append", expectedVersion: review.version }
        : scope && theme && title.trim() ? { mode: "create", projectId: destination, title: title.trim(),
          scope: { organizationId: scope.organizationId, region: scope.region, city: scope.city, businessLine: scope.businessLine },
          themeId: theme.id, themeVersion: theme.current_version } : null;
      if (!target) return;
      command.current = { payload: { action: "add_to_pitch", handoff: review.handoff, target,
        fingerprint: review.data.fingerprint, taskId: crypto.randomUUID() }, projectId: destination, accepted: false };
    }
    const entry = command.current;
    operation.current = request;
    setError("");
    setSubmitted(true);
    setBusy("submit");
    try {
      if (!entry.accepted) {
        receiptSchema.parse(await call(entry.payload, true, "workspace", request.signal));
        entry.accepted = true;
      }
      if (!request.signal.aborted) await onOpen(entry.projectId);
      if (!request.signal.aborted) onClose();
    } catch (cause) {
      if (request.signal.aborted) return;
      if (!entry.accepted && cause instanceof WorkspaceError && cause.status < 500 && cause.status !== 408) {
        resetReview();
      }
      setError(cause instanceof Error && !(cause instanceof z.ZodError) ? cause.message : "暂时无法读取提案，请重试。");
    } finally {
      operation.current = null;
      if (!request.signal.aborted) setBusy(undefined);
    }
  }

  const sourceLabel = lease ? "成交库的代表成交" : source.source.kind === "buildings"
    ? `已选 ${source.source.buildingIds.length} 栋楼宇`
    : source.source.kind === "submarket" ? source.source.key : "Colliers AI 的获权分析结果";

  return <Dialog open onOpenChange={value => { if (!value && !busy) onClose(); }}
    title="加入 Pitch" size="md" footer={
      review ? <Button disabled={busy === "review" || (!projectId && !title.trim())}
        loading={busy === "submit"} onClick={() => void submit()}>
        {submitted ? "重新查询或继续提交" : projectId ? "确认并追加" : "确认并创建"}
      </Button> : <Button disabled={(!projectId && !canCreate) || !validPeriod}
        loading={busy === "review"} onClick={() => void checkSource()}>核对来源</Button>
    }>
    <div className={`${styles.studio} ${styles.form}`}>
      <div>
        <p>{sourceLabel}</p>
        {lease && <p>{lease.from} 至 {lease.to} · {lease.dataset === "live" ? "日常填报" : lease.dataset === "history" ? "历史导入" : "合并来源"}</p>}
      </div>
      <label>
        目标项目
        <select value={projectId} disabled={!!busy || submitted}
          onChange={event => { resetReview(); setProjectId(event.target.value); }}>
          <option value="">新建 Pitch</option>
          {projects.filter(project => project.state !== "archived").map(project => <option key={project.id} value={project.id}>{project.title}</option>)}
        </select>
      </label>
      {projectListError && <div role="alert">
        <p>{projectListError}</p>
        <Button variant="ghost" onClick={() => { setProjectListError(""); setListAttempt(value => value + 1); }}>重试读取项目</Button>
      </div>}
      {!projectId && grants.length > 1 && <label>
        所属区域
        <select value={scopeIndex} disabled={!!busy || submitted}
          onChange={event => { resetReview(); setScopeIndex(Number(event.target.value)); }}>
          {grants.map((scope, index) => <option key={index} value={index}>{scope.city} · {scope.businessLine}</option>)}
        </select>
      </label>}
      {!projectId && !canCreate && <p>当前没有可创建提案的授权范围。</p>}
      {!lease && <label>
        正式季度
        <input placeholder={projectId ? "默认沿用目标项目" : "例如 2026-Q3"} value={period} maxLength={7}
          aria-invalid={!validPeriod} disabled={!!busy || submitted}
          onChange={event => { resetReview(); setPeriod(event.target.value); }} />
      </label>}
      {!validPeriod && <p role="alert">季度格式为 YYYY-Q1 至 YYYY-Q4。</p>}
      {error && <p role="alert">{error}</p>}
      {review && <>
        {!projectId && <label>
          项目名称
          <input value={title} maxLength={160} disabled={!!busy || submitted} onChange={event => setTitle(event.target.value)} />
        </label>}
        <p>{review.data.period && `${review.data.period} · `}{review.data.binding.dataAsOf} · 仅供内部使用</p>
        <ol className={styles.handoffPages}>
          {review.data.pages.map((page, index) => <li key={index}>
            <strong>{page.title}</strong>
            {page.sources.length > 0 && <p>{[...new Set(page.sources.map(item => item.label))].join("、")}</p>}
          </li>)}
        </ol>
      </>}
    </div>
  </Dialog>;
}
