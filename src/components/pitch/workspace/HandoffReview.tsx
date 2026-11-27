"use client";

import { useEffect, useRef, useState } from "react";
import { z } from "zod";
import { Button, Dialog } from "@/src/components/ui";
import { contentBlockSchema, type PitchScope } from "@/src/lib/pitch/contracts/content";
import { outlineQuarter, workspaceDetailSchema } from "@/src/lib/pitch/workspace/protocol";
import { pitchStackingSourceSchema, readPitchAnalysisPeriods, type PitchHandoffNavigation } from "../PitchHandoffLink";
import { WorkspaceError, type Call } from "./client";
import { EvidencePages } from "./BusinessEvidence";
import styles from "./workspace.module.css";

const projectsSchema = z.object({
  items: z.array(z.object({ id: z.uuid(), title: z.string(), state: z.string().optional(), city: z.string().optional() })),
});
const readySchema = z.object({
  status: z.literal("ready"), period: z.string(), fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  submarkets: z.array(z.string()), buildingIds: z.array(z.uuid()),
  binding: z.object({ dataAsOf: z.iso.date().nullable(), observedOn: z.iso.date().optional(),
    disclosure: z.enum(["internal", "restricted"]).optional() }),
  sourceCity: z.string().optional(),
  stackingSource: pitchStackingSourceSchema.optional(),
  parameters: z.object({ analysisResult: z.object({
    requestId: z.uuid(), resultId: z.uuid(), plan: z.unknown(),
  }).optional() }).optional(),
  pages: z.array(z.object({ title: z.string(), sources: z.array(z.object({ label: z.string() })),
    blocks: z.array(contentBlockSchema).optional() })),
});
const reviewSchema = z.discriminatedUnion("status", [readySchema, z.object({ status: z.literal("period_required") })]);
const receiptSchema = z.object({ state: z.enum(["queued", "processing", "completed", "failed", "cancelled"]) });
type Ready = z.infer<typeof readySchema>;
type AddToPitch = PitchHandoffNavigation & { projectId?: string };

type Target = { mode: "append"; expectedVersion: number } | ({
  mode: "create"; projectId: string; title: string; scope: PitchScope; themeId: string; themeVersion: number;
});
type Submit = { action: "add_to_pitch"; handoff: AddToPitch; target: Target; fingerprint: string; taskId: string };

export type HandoffDestination = { id: string; title: string };

function matchesSourceScope(source: AddToPitch["source"], preview: Ready) {
  const same = (left: string[], right: string[]) => left.length === right.length &&
    new Set(right).size === right.length && right.every(item => left.includes(item));
  if (source.kind === "buildings") return same(source.buildingIds, preview.buildingIds) && !preview.submarkets.length;
  if (source.kind === "submarket") return same([source.key], preview.submarkets) && !preview.buildingIds.length;
  if (source.kind === "lease-search") return same(source.buildingIds, preview.buildingIds) && same(source.submarkets, preview.submarkets);
  return true;
}

export function HandoffReview({ source, call, grants, theme, destination, onOpen, onClose }: {
  source: PitchHandoffNavigation;
  call: Call;
  grants: PitchScope[];
  theme?: { id: string; current_version: number };
  destination?: HandoffDestination;
  onOpen: (id: string) => Promise<void>;
  onClose: () => void;
}) {
  const research = source.source.kind === "quarterly-research" ? source.source : undefined;
  const researchPeriod = research?.edition.replace("Q", "-Q");
  const researchCity = research ? "北京" : undefined;
  const [projects, setProjects] = useState<z.infer<typeof projectsSchema>["items"]>([]);
  const [projectId, setProjectId] = useState(destination?.id ?? "");
  const [scopeIndex, setScopeIndex] = useState(() => researchCity
    ? Math.max(0, grants.findIndex(scope => scope.city === researchCity)) : 0);
  const [period, setPeriod] = useState(source.period ?? "");
  const lease = source.source.kind === "lease-search" ? source.source : undefined;
  const stacking = source.source.kind === "stacking-plan" ? source.source : undefined;
  const analysis = source.source.kind === "analysis-result" ? source.source : undefined;
  const analysisPeriod = analysis ? source.period : undefined;
  const fixedPeriod = researchPeriod ?? analysisPeriod;
  const carriesSourceDate = !!lease || !!stacking || !!fixedPeriod;
  const [title, setTitle] = useState("");
  const [review, setReview] = useState<{ data: Ready; handoff: AddToPitch; version?: number }>();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState<"review" | "submit">();
  const [submitted, setSubmitted] = useState(false);
  const [projectListError, setProjectListError] = useState("");
  const [listAttempt, setListAttempt] = useState(0);
  const operation = useRef<AbortController>(null);
  const autoReviewed = useRef(false);
  const command = useRef<{ payload: Submit; projectId: string; accepted: boolean }>(null);
  const sourceCity = researchCity ?? (stacking ? review?.data.sourceCity : undefined);
  const eligibleForSource = !sourceCity || grants[scopeIndex]?.city === sourceCity;
  const canCreate = !!grants[scopeIndex] && !!theme && eligibleForSource;
  const validPeriod = !period || outlineQuarter.safeParse(period).success;

  useEffect(() => {
    if (destination) return;
    const request = new AbortController();
    void call({ action: "list", filter: "active" }, false, "workspace", request.signal)
      .then(projectsSchema.parse)
      .then(result => { if (!request.signal.aborted) setProjects(result.items); })
      .catch((cause: unknown) => {
        if (!request.signal.aborted) setProjectListError(cause instanceof Error && !(cause instanceof z.ZodError) ? cause.message : "项目列表读取未完成。");
      });
    return () => request.abort();
  }, [call, destination, listAttempt]);
  useEffect(() => () => operation.current?.abort(), []);
  useEffect(() => {
    if (!destination || !source.period || autoReviewed.current) return;
    const timer = setTimeout(() => {
      autoReviewed.current = true;
      void checkSource();
    }, 0);
    return () => clearTimeout(timer);
  // The workspace opens with an explicit review action and a saved default quarter.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [destination, source.period]);

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
        ...(period && !carriesSourceDate ? { period } : {}),
        ...(source.language ? { language: source.language } : {}),
        ...(projectId ? { projectId } : {}),
      };
      const selected = projectId
        ? workspaceDetailSchema.parse(await call({ action: "get", projectId }, true, "workspace", request.signal))
        : null;
      const response = reviewSchema.parse(await call({ action: "review_handoff", handoff }, true, "workspace", request.signal));
      if (request.signal.aborted) return;
      if (response.status === "period_required") {
        setError(carriesSourceDate ? "暂时无法核对原始来源日期。" : "请选择正式季度后重新核对。");
        return;
      }
      if (research && (response.period !== researchPeriod || response.sourceCity !== researchCity)) {
        setError("返回的季度研究范围与所选版次不一致，请重新核对。");
        return;
      }
      const archived = response.parameters?.analysisResult;
      if (analysis?.resultId && (archived?.requestId !== analysis.id || archived.resultId !== analysis.resultId)) {
        setError("返回的归档与所选分析结果不一致，请重新打开分析结果。");
        return;
      }
      const expectedPeriod = analysisPeriod ?? handoff.period;
      if ((expectedPeriod && response.period !== expectedPeriod) || !matchesSourceScope(handoff.source, response)) {
        setError("返回的范围或季度与所选来源不一致，请重新核对。");
        return;
      }
      if (stacking) {
        if (!response.sourceCity || !response.stackingSource || response.period || response.binding.disclosure !== "restricted" ||
          response.buildingIds.length !== 1 || response.buildingIds[0] !== stacking.buildingId ||
          JSON.stringify(response.stackingSource) !== JSON.stringify(pitchStackingSourceSchema.parse(stacking))) {
          setError("返回的堆叠图范围与所选来源不一致，请重新核对。");
          return;
        }
        setScopeIndex(index => grants[index]?.city === response.sourceCity ? index
          : Math.max(0, grants.findIndex(scope => scope.city === response.sourceCity)));
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
        : scope && theme && canCreate && title.trim() ? { mode: "create", projectId: destination, title: title.trim(),
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

  const sourceLabel = research ? "北京甲级写字楼 · 获权跟踪样本"
    : stacking ? "历史 Stacking Plan" : lease ? "成交库的代表成交" : source.source.kind === "buildings"
    ? `已选 ${source.source.buildingIds.length} 栋楼宇`
    : source.source.kind === "submarket" ? source.source.key : "Colliers AI 的获权分析结果";
  const reviewedPeriod = review?.data.period;
  const reviewedAnalysisStart = readPitchAnalysisPeriods(review?.data.parameters?.analysisResult?.plan).start;
  const periodRange = reviewedAnalysisStart && reviewedPeriod && reviewedAnalysisStart !== reviewedPeriod
    ? `${reviewedAnalysisStart} 至 ${reviewedPeriod}` : reviewedPeriod;

  return <Dialog open onOpenChange={value => { if (!value && !busy) onClose(); }}
    title="加入 Pitch" size="md" footer={
      review ? <Button disabled={busy === "review" || (!projectId && (!title.trim() || !canCreate))}
        loading={busy === "submit"} onClick={() => void submit()}>
        {submitted ? "重新查询或继续提交" : projectId ? "确认并追加" : "确认并创建"}
      </Button> : <Button disabled={(!projectId && !canCreate) || !validPeriod}
        loading={busy === "review"} onClick={() => void checkSource()}>核对来源</Button>
    }>
    <div className={`${styles.studio} ${styles.form}`}>
      <div>
        <p>{sourceLabel}</p>
        {fixedPeriod && !review && <p>{fixedPeriod}</p>}
        {lease && <p>{lease.from} 至 {lease.to} · {lease.dataset === "live" ? "日常填报" : lease.dataset === "history" ? "历史导入" : "合并来源"}</p>}
      </div>
      {destination ? <p>追加到 {destination.title}</p> : <label>
        目标项目
        <select value={projectId} disabled={!!busy || submitted}
          onChange={event => { resetReview(); setProjectId(event.target.value); }}>
          <option value="">新建 Pitch</option>
          {projects.filter(project => project.state !== "archived" && (!sourceCity || !project.city || sourceCity === project.city))
            .map(project => <option key={project.id} value={project.id}>{project.title}</option>)}
        </select>
      </label>}
      {projectListError && <div role="alert">
        <p>{projectListError}</p>
        <Button variant="ghost" onClick={() => { setProjectListError(""); setListAttempt(value => value + 1); }}>重试读取项目</Button>
      </div>}
      {!projectId && grants.length > 1 && <label>
        所属区域
        <select value={scopeIndex} disabled={!!busy || submitted}
          onChange={event => { resetReview(); setScopeIndex(Number(event.target.value)); }}>
          {grants.map((scope, index) => <option key={index} value={index} disabled={!!sourceCity && scope.city !== sourceCity}>
            {scope.city} · {scope.businessLine}
          </option>)}
        </select>
      </label>}
      {!projectId && !canCreate && <p>当前没有可创建{sourceCity ? `${sourceCity} ` : ""}提案的授权范围。</p>}
      {!carriesSourceDate && <label>
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
        <p>{[periodRange, review.data.binding.dataAsOf ?? "来源日期待确认",
          review.data.binding.observedOn && `观察日期 ${review.data.binding.observedOn}`,
          review.data.binding.disclosure === "restricted" ? "受限来源" : "仅供内部使用"].filter(Boolean).join(" · ")}</p>
        <EvidencePages pages={review.data.pages} />
      </>}
    </div>
  </Dialog>;
}
