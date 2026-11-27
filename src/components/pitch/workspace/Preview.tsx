/* eslint-disable @next/next/no-img-element -- private authenticated SVG is rendered by the shared server engine. */
"use client";
import * as React from "react";
import { Button, Dialog } from "@/src/components/ui";
import { Maximize2, Minus, Plus } from "lucide-react";
import type { WorkspaceDetail } from "@/src/lib/pitch/workspace/protocol";
import type { Call } from "./client";
import styles from "./workspace.module.css";
const previewSceneKey = (project: string, page: WorkspaceDetail["slides"][number]) =>
  JSON.stringify([project, page.id, page.scene]);
type PreviewEntry = { key: string; value: string };

export function usePagePreviews(
  call: Call,
  detail: WorkspaceDetail | null,
  active: string | null,
) {
  const [images, setImages] = React.useState<Record<string, PreviewEntry>>({}),
    [errors, setErrors] = React.useState<Record<string, PreviewEntry>>({}),
    [retry, setRetry] = React.useState(0);
  const cache = React.useRef(new Map<string, string>());
  const sceneKeys = React.useMemo(() => new Map(detail?.slides.map(page => [page.id, previewSceneKey(detail.project.id, page)])), [detail]);
  React.useEffect(() => {
    if (!detail?.slides.length) return;
    const c = new AbortController(),
      memory = cache.current;
    const work = detail.slides
      .map((page, i) => ({ page, i, key: sceneKeys.get(page.id)! }))
      .sort(
        (a, b) => Number(b.page.id === active) - Number(a.page.id === active),
      );
    let cursor = 0;
    void Promise.all(
      [0, 1].map(async () => {
        while (cursor < work.length && !c.signal.aborted) {
          const { page, i, key } = work[cursor++];
          try {
            let svg = memory.get(key);
            if (!svg) {
              const result = await call<{ svg: string; scene: typeof page.scene }>(
                { action: "preview", projectId: detail.project.id, page: i },
                true,
                "",
                c.signal,
              );
              if (JSON.stringify(result.scene) !== JSON.stringify(page.scene))
                throw new Error("页面版本已变化，请重新打开项目。");
              svg =
                "data:image/svg+xml;charset=utf-8," +
                encodeURIComponent(result.svg);
              if (c.signal.aborted) return;
              memory.set(key, svg);
              if (memory.size > 100) memory.delete(memory.keys().next().value!);
            }
            if (!c.signal.aborted) {
              setImages((v) => ({ ...Object.fromEntries(Object.entries(v).filter(([id]) => sceneKeys.has(id))), [page.id]: { key, value: svg! } }));
              setErrors((v) => ({ ...v, [page.id]: { key, value: "" } }));
            }
          } catch (error) {
            if (!c.signal.aborted)
              setErrors((v) => ({
                ...Object.fromEntries(Object.entries(v).filter(([id]) => sceneKeys.has(id))),
                [page.id]: { key, value: error instanceof Error ? error.message : "页面预览未完成" },
              }));
          }
        }
      }),
    );
    return () => c.abort();
  }, [call, detail, active, retry, sceneKeys]);
  const matching = (entries: Record<string, PreviewEntry>) => Object.fromEntries(
    [...sceneKeys.entries()].flatMap(([id, key]) => {
      const entry = entries[id];
      return entry?.key === key ? [[id, entry.value]] : [];
    }),
  );
  return { images: matching(images), errors: matching(errors), retry: () => setRetry((v) => v + 1) };
}
export function PagePreview({
  src,
  error,
  title,
  onRetry,
  pending,
}: {
  src?: string;
  error?: string;
  title: string;
  onRetry: () => void;
  pending: boolean;
}) {
  const [zoom, setZoom] = React.useState(100),
    [full, setFull] = React.useState(false),
    [failedImage, setFailedImage] = React.useState<string>();
  const picture = (
    <div className={styles.page} style={{ width: `${zoom}%` }}>
      {src ? (
        <img
          src={src}
          alt={title}
          onError={() => setFailedImage(src)}
        />
      ) : (
        <span role="status">正在读取页面…</span>
      )}
    </div>
  );
  return (
    <section className={styles.preview} aria-label="页面预览">
      {error || (src && failedImage === src) ? (
        <div role="alert" className={styles.notice}>
          {error || "页面图片加载失败。"}
          <Button variant="secondary" onClick={() => { setFailedImage(undefined); onRetry(); }}>
            重试预览
          </Button>
        </div>
      ) : (
        <div className={styles.canvas}>{picture}</div>
      )}
      {pending && <div role="status" className={styles.previewStatus}>正在保存并更新页面…</div>}
      <div className={styles.previewTools}>
        <Button
          variant="ghost"
          aria-label="缩小页面"
          disabled={zoom <= 50}
          onClick={() => setZoom((v) => Math.max(50, v - 10))}
        >
          <Minus size={16} />
        </Button>
        <output aria-label="页面缩放">{zoom}%</output>
        <Button
          variant="ghost"
          aria-label="放大页面"
          disabled={zoom >= 200}
          onClick={() => setZoom((v) => Math.min(200, v + 10))}
        >
          <Plus size={16} />
        </Button>
        <Button variant="ghost" onClick={() => setZoom(100)}>
          适合窗口
        </Button>
        <Button variant="ghost" onClick={() => setFull(true)}>
          <Maximize2 size={16} />
          全屏
        </Button>
      </div>
      <Dialog
        open={full}
        onOpenChange={setFull}
        title={title}
        presentation="fullscreen"
      >
        {picture}
      </Dialog>
    </section>
  );
}
