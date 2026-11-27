"use client";
import * as React from "react";
import { z } from "zod";
import { Button, Dialog } from "@/src/components/ui";
import { pitchCommandSchema } from "@/src/lib/pitch/contracts/api";
import type { WorkspaceDetail } from "@/src/lib/pitch/workspace/protocol";
import { downloadBlob, WorkspaceError, type Call } from "./client";
import styles from "./workspace.module.css";
const eligibilitySchema = z.object({
  projectVersion: z.number().int(),
  audienceAllowed: z.boolean(),
  pages: z.array(z.object({ id: z.uuid(), position: z.number().int(), reasons: z.array(z.string()) })),
});
type Eligibility = z.infer<typeof eligibilitySchema>;
const versionedExport = pitchCommandSchema.options.some(command =>
  command.shape.action.value === "export_start" && Object.hasOwn(command.shape, "expectedVersion"));
const projectVersionConflictMessage = "项目已在其他窗口更新。请重新打开项目后再导出。";
const exportReasons: Record<string, string> = {
  restricted: "页面受到披露限制",
  internal_only: "页面仅供内部使用",
  test_data: "页面包含测试数据",
  manual_review_required: "编辑后的页面需要披露审核",
  source_permission: "来源授权已失效或不含此用途",
  media_permission: "部分媒体授权已失效或不含此用途",
};

function selectSlideIndexes(slides: WorkspaceDetail["slides"], range: string, active: string | null, selected: string[]) {
  return slides.flatMap((slide, index) =>
    range === "all" || (range === "current" ? slide.id === active : selected.includes(slide.id)) ? [index] : []);
}

async function readEligibility(call: Call, projectId: string, audience: string, signal?: AbortSignal) {
  try {
    const response = await call({ action: "export_eligibility", projectId, audience }, false, "", signal);
    const parsed = eligibilitySchema.safeParse(response);
    return parsed.success ? parsed.data : null;
  } catch (cause) {
    // Deployment order allows the older PPTX endpoint to coexist during rollout.
    if (cause instanceof WorkspaceError && [400, 404].includes(cause.status)) return null;
    throw cause;
  }
}

export function ExportPanel({
  call,
  detail,
  active,
  selected,
  flush,
  canClient,
  disabled,
  openSignal = 0,
  outlineReady = false,
}: {
  openSignal?: number;
  outlineReady?: boolean;
  call: Call;
  detail: WorkspaceDetail;
  active: string | null;
  selected: string[];
  flush: () => Promise<WorkspaceDetail>;
  canClient: boolean;
  disabled: boolean;
}) {
  const [open, setOpen] = React.useState(false),
    [dismissedSignal, setDismissedSignal] = React.useState(0),
    [format, setFormat] = React.useState("pptx"),
    [audience, setAudience] = React.useState("internal"),
    [range, setRange] = React.useState("all"),
    [exportState, setReceipt] = React.useState<{
      id: string;
      key: string;
      state: string;
      progress: number;
      filename?: string;
      error?: string;
      audience: string;
      projectId: string;
      stage?: string;
    } | null>(null),
    [error, setError] = React.useState(""),
    [pollFailed, setPollFailed] = React.useState(false),
    [pollAttempt, setPollAttempt] = React.useState(0),
    [busy, setBusy] = React.useState(false),
    [eligibility, setEligibility] = React.useState<{ key: string; report: Eligibility | null; failure?: string }>(),
    [eligibilityAttempt, setEligibilityAttempt] = React.useState(0);
  const dialogOpen = open || openSignal > dismissedSignal;
  const projectId = detail.project.id;
  const version = detail.project.version;
  const activeReceipt = exportState?.projectId === projectId ? exportState : null;
  const eligibilityKey = JSON.stringify([projectId, version, audience, eligibilityAttempt, openSignal]);
  const currentEligibility = eligibility?.key === eligibilityKey ? eligibility : undefined;
  const receivedReport = currentEligibility?.report;
  const report = receivedReport && receivedReport.projectVersion === version ? receivedReport : null;
  const indexes = selectSlideIndexes(detail.slides, range, active, selected);
  const exportKey = JSON.stringify([projectId, version, audience, format, range, indexes]);
  const running = !!activeReceipt && ["pending", "queued", "running"].includes(activeReceipt.state);
  const receipt = running || activeReceipt?.key === exportKey ? activeReceipt : null;
  const pageIds = new Set(indexes.map(index => detail.slides[index].id));
  const blockedPages = report?.pages.filter(page => pageIds.has(page.id) && page.reasons.length) ?? [];
  const audienceBlocked = report?.audienceAllowed === false;
  const eligibilityPending = dialogOpen && !currentEligibility;
  const eligibilityStale = !!currentEligibility?.report && !report;
  const pendingStart = React.useRef<{ key: string; id: string } | null>(null);
  React.useEffect(() => {
    if (!dialogOpen) return;
    const controller = new AbortController();
    void readEligibility(call, projectId, audience, controller.signal).then((result) => {
      if (!controller.signal.aborted) setEligibility({ key: eligibilityKey, report: result });
    }).catch((cause: unknown) => {
      if (!controller.signal.aborted) {
        setEligibility({ key: eligibilityKey, report: null, failure: cause instanceof Error ? cause.message : "无法核对导出权限。" });
      }
    });
    return () => controller.abort();
  }, [audience, call, dialogOpen, eligibilityKey, projectId]);
  const life = React.useRef(new AbortController());
  React.useEffect(() => {
    const c = life.current;
    return () => c.abort();
  }, []);
  React.useEffect(() => {
    if (!running || !receipt) return;
    const id = receipt.id,
      timer = setTimeout(() => {
        void call<{
          state: string;
          progress: number;
          filename?: string;
          error_code?: string;
          stage?: string;
        }>(
          {
            action: "export_status",
            projectId: detail.project.id,
            exportId: id,
          },
          false,
          "",
          life.current.signal,
        )
          .then((r) => {
            setPollFailed(false);
            setError("");
            setReceipt({
              id,
              key: receipt.key,
              state: r.state,
              progress: r.progress,
              filename: r.filename,
              error: r.error_code,
              audience: receipt.audience,
              projectId: receipt.projectId,
              stage: r.stage,
            });
          })
          .catch((e) => {
            if (life.current.signal.aborted) return;
            setError(e.message);
            setPollFailed(true);
          });
      }, 900);
    return () => clearTimeout(timer);
  }, [receipt, running, call, detail.project.id, pollAttempt]);
  async function start() {
    setBusy(true);
    setError("");
    setPollFailed(false);
    try {
      const saved = await flush();
      const pages = selectSlideIndexes(saved.slides, range, active, selected);
      if (!pages.length) throw new Error("请先选择需要导出的页面。");
      const current = saved.project.version === version ? report
        : await readEligibility(call, saved.project.id, audience, life.current.signal);
      if (current && current.projectVersion !== saved.project.version) {
        setEligibilityAttempt(value => value + 1);
        throw new Error("项目版本刚刚变化，请重新核对导出范围。");
      }
      const ids = new Set(pages.map(index => saved.slides[index].id));
      if (current && (!current.audienceAllowed || current.pages.some(page => ids.has(page.id) && page.reasons.length))) {
        setEligibilityAttempt(value => value + 1);
        throw new Error("所选范围有页面无法导出。请查看披露原因。");
      }
      if (format === "pdf" && !current) throw new Error("PDF 导出资格暂不可用。");
      const options = [saved.project.id, saved.project.version, audience, format, range, pages];
      const key = JSON.stringify(options);
      const exportId = pendingStart.current?.key === key ? pendingStart.current.id : crypto.randomUUID();
      pendingStart.current = { key, id: exportId };
      const ack = await call<{ state?: string; progress?: number; filename?: string }>(
        {
          action: "export_start",
          projectId: saved.project.id,
          ...(versionedExport ? { expectedVersion: saved.project.version } : {}),
          exportId,
          audience,
          format,
          ...(["png", "svg"].includes(format)
            ? { page: pages[0] }
            : range !== "all"
              ? { pages }
              : {}),
        },
        true,
        "",
      );
      pendingStart.current = null;
      setReceipt({ id: exportId, key, audience, projectId: saved.project.id, state: ack.state ?? "pending",
        progress: ack.progress ?? (ack.state === "ready" ? 100 : 0), filename: ack.filename });
    } catch (e) {
      if (e instanceof WorkspaceError && e.status < 500 && e.status !== 408) {
        pendingStart.current = null;
        if (e.status === 403 || e.status === 409) setEligibilityAttempt(value => value + 1);
      }
      setError(e instanceof WorkspaceError && e.status === 409
        ? projectVersionConflictMessage
        : e instanceof Error ? e.message : "导出未启动。");
    } finally {
      setBusy(false);
    }
  }
  async function download(id: string, name?: string, who = audience) {
    setBusy(true);
    setError("");
    try {
      const blob = await call<Blob>(
        {
          action: "download",
          projectId: detail.project.id,
          exportId: id,
          audience: who,
        },
        false,
        "",
      );
      downloadBlob(blob, name ?? "Pitch.pptx");
    } catch (e) {
      setError(e instanceof Error ? e.message : "下载未完成。");
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <Button
        disabled={disabled || !detail.slides.length}
        onClick={() => {
          setError("");
          setEligibilityAttempt(value => value + 1);
          if (outlineReady && !running) {
            setFormat("pptx");
            setRange("all");
            setAudience("internal");
          }
          setOpen(true);
        }}
      >
        {outlineReady ? "导出可编辑 PPTX" : "导出"}
      </Button>
      <Dialog
        open={dialogOpen}
        onOpenChange={(value) => {
          setOpen(value);
          if (!value) setDismissedSignal(openSignal);
        }}
        title="导出 Pitch"
        size="sm"
      >
        <div className={`${styles.studio} ${styles.form}`}>
          <label>
            文件格式
            <select
              aria-label="文件格式"
              value={format}
              disabled={busy || !!running}
              onChange={(e) => {
                setError("");
                setFormat(e.target.value);
                if (["png", "svg"].includes(e.target.value))
                  setRange("current");
              }}
            >
              <option value="pptx">PowerPoint</option>
              {(report || format === "pdf") && <option value="pdf">PDF</option>}
              <option value="png">PNG 图片</option>
              <option value="svg">SVG 矢量图</option>
              <option value="xlsx">Excel 数据</option>
            </select>
          </label>
          <label>
            页面范围
            <select
              aria-label="页面范围"
              value={range}
              disabled={busy || !!running || ["png", "svg"].includes(format)}
              onChange={(e) => { setError(""); setRange(e.target.value); }}
            >
              <option value="all">全部页面</option>
              <option value="current">当前页面</option>
              <option value="selected" disabled={!selected.length}>
                选中页面（{selected.length}）
              </option>
            </select>
          </label>
          <label>
            使用范围
            <select
              aria-label="使用范围"
              value={audience}
              disabled={busy || !!running}
              onChange={(e) => { setError(""); setAudience(e.target.value); }}
            >
              <option value="internal">内部使用</option>
              {canClient && <option value="client">对客使用</option>}
            </select>
          </label>
          {eligibilityPending && <p role="status">正在核对所选用途的导出权限…</p>}
          {audienceBlocked && <p role="alert">当前账号或项目范围无此用途的导出授权。</p>}
          {blockedPages.length > 0 && (
            <section aria-label="页面导出限制">
              <p>请调整页面范围，或选择有授权的用途。</p>
              <ul className={styles.handoffPages}>
                {blockedPages.map(page => <li key={page.id}>
                  第 {page.position} 页 {detail.slides.find(slide => slide.id === page.id)?.content.title} ·{" "}
                  {page.reasons.map(reason => exportReasons[reason] ?? "需要重新核对披露权限").join("、")}
                </li>)}
              </ul>
            </section>
          )}
          {currentEligibility?.failure && (
            <div role="alert">
              <p>{currentEligibility.failure}</p>
              <Button variant="ghost" onClick={() => setEligibilityAttempt(value => value + 1)}>重新核对导出权限</Button>
            </div>
          )}
          {(eligibilityStale || error) && <p role="alert">{eligibilityStale ? projectVersionConflictMessage : error}</p>}
          {pollFailed && running && (
            <Button
              variant="secondary"
              onClick={() => {
                setPollFailed(false);
                setPollAttempt((v) => v + 1);
              }}
            >
              重新查询进度
            </Button>
          )}
          {receipt && (
            <div role="status">
              {running ? (
                <>
                  <label>
                    文件生成进度
                    <progress max={100} value={receipt.progress > 0 ? receipt.progress : undefined} />
                  </label>
                  <span>{receipt.stage === "storing" ? "正在存储文件" : receipt.stage === "rendering" ? "正在渲染页面"
                    : receipt.stage === "queued" ? "等待生成文件" : "正在生成文件"}
                    {receipt.progress > 0 && ` ${receipt.progress}%`}
                  </span>
                </>
              ) : receipt.state === "ready" ? (
                <Button
                  onClick={() => void download(receipt.id, receipt.filename, receipt.audience)}
                  disabled={busy}
                >
                  下载已生成文件
                </Button>
              ) : (
                <p>
                  导出未完成，原页面已保留。
                  {receipt.error === "PITCH_WORKER_TIMEOUT"
                    ? "任务超时，请重试。"
                    : ""}
                </p>
              )}
            </div>
          )}
          <Button
            disabled={busy || !!running || !indexes.length || eligibilityPending || eligibilityStale || audienceBlocked || !!blockedPages.length || !!currentEligibility?.failure}
            loading={busy}
            onClick={() => void start()}
          >
            {receipt && receipt.state !== "ready" ? "重新导出" : "生成文件"}
          </Button>
          <details>
            <summary>历史导出</summary>
            <ul className={styles.rows}>
              {detail.exports.slice(0, 30).map((e) => (
                <li key={String(e.id)}>
                  <span>
                    {String(e.filename ?? "Pitch")} ·{" "}
                    {e.state === "ready"
                      ? "已生成"
                      : e.state === "failed"
                        ? "失败"
                        : "处理中"}
                  </span>
                  <Button
                    variant="ghost"
                    disabled={busy || e.state !== "ready"}
                    onClick={() =>
                      void download(
                        String(e.id),
                        String(e.filename ?? "Pitch.pptx"),
                        String(e.audience),
                      )
                    }
                  >
                    下载
                  </Button>
                </li>
              ))}
            </ul>
          </details>
        </div>
      </Dialog>
    </>
  );
}
