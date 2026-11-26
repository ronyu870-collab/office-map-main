"use client";
import * as React from "react";
import { Button, Dialog } from "@/src/components/ui";
import type { WorkspaceDetail } from "@/src/lib/pitch/workspace/protocol";
import { downloadBlob, type Call } from "./client";
import styles from "./workspace.module.css";
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
    [receipt, setReceipt] = React.useState<{
      id: string;
      state: string;
      progress: number;
      filename?: string;
      error?: string;
    } | null>(null),
    [error, setError] = React.useState(""),
    [pollFailed, setPollFailed] = React.useState(false),
    [pollAttempt, setPollAttempt] = React.useState(0),
    [busy, setBusy] = React.useState(false);
  const running =
      receipt && ["pending", "queued", "running"].includes(receipt.state),
    life = React.useRef(new AbortController());
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
              state: r.state,
              progress: r.progress,
              filename: r.filename,
              error: r.error_code,
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
      const saved = await flush(),
        exportId = crypto.randomUUID();
      const indexes = saved.slides
        .map((p, i) => ({ id: p.id, i }))
        .filter((p) =>
          range === "current"
            ? p.id === active
            : range === "selected"
              ? selected.includes(p.id)
              : true,
        )
        .map((p) => p.i);
      if (!indexes.length) throw new Error("请先选择需要导出的页面。");
      await call(
        {
          action: "export_start",
          projectId: saved.project.id,
          exportId,
          audience,
          format,
          ...(["png", "svg"].includes(format)
            ? { page: indexes[0] }
            : range !== "all"
              ? { pages: indexes }
              : {}),
        },
        true,
        "",
      );
      setReceipt({ id: exportId, state: "pending", progress: 0 });
    } catch (e) {
      setError(e instanceof Error ? e.message : "导出未启动。");
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
        open={open || openSignal > dismissedSignal}
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
              disabled={!!running}
              onChange={(e) => {
                setFormat(e.target.value);
                if (["png", "svg"].includes(e.target.value))
                  setRange("current");
              }}
            >
              <option value="pptx">PowerPoint</option>
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
              disabled={!!running || ["png", "svg"].includes(format)}
              onChange={(e) => setRange(e.target.value)}
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
              disabled={!!running}
              onChange={(e) => setAudience(e.target.value)}
            >
              <option value="internal">内部使用</option>
              {canClient && <option value="client">对客使用</option>}
            </select>
          </label>
          {audience === "client" && (
            <p>将重新核对素材披露授权。用户改写内容与测试素材无法对客导出。</p>
          )}
          {error && <p role="alert">{error}</p>}
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
                    <progress max={100} value={receipt.progress} />
                  </label>
                  <span>正在生成文件 {receipt.progress}%</span>
                </>
              ) : receipt.state === "ready" ? (
                <Button
                  onClick={() => void download(receipt.id, receipt.filename)}
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
            disabled={busy || !!running}
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
