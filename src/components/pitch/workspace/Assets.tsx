"use client";
import * as React from "react";
import { z } from "zod";
import { Button } from "@/src/components/ui";
import type { Call } from "./client";
import { layoutIdSchema, type LayoutId } from "@/src/lib/pitch/contracts/scene";
import { LAYOUTS } from "@/src/lib/pitch/layout/definitions";
import styles from "./workspace.module.css";
type Asset = {
  id: string;
  names: Record<string, string>;
  state: string;
  is_test_data: boolean;
  data_as_of?: string;
  tags?: string[];
};
export const pitchAssetDragType = "application/x-colliers-pitch-assets";
const assetTransferSchema = z.strictObject({
  projectId: z.uuid(),
  ids: z.array(z.uuid()).min(1).max(12),
  layout: layoutIdSchema,
});

export function readAssetTransfer(transfer: DataTransfer) {
  try {
    const result = assetTransferSchema.safeParse(JSON.parse(transfer.getData(pitchAssetDragType)));
    return result.success ? { ...result.data, ids: [...new Set(result.data.ids)] } : null;
  } catch {
    return null;
  }
}

export function AssetPicker({
  call,
  onAdd,
  busy,
  projectId,
}: {
  call: Call;
  projectId?: string;
  onAdd: (ids: string[], layout: LayoutId) => Promise<void>;
  busy: boolean;
}) {
  const [q, setQ] = React.useState(""),
    [tag, setTag] = React.useState(""),
    [items, setItems] = React.useState<Asset[]>([]),
    [selected, setSelected] = React.useState<string[]>([]),
    [layout, setLayout] = React.useState<LayoutId>("two-columns"),
    [next, setNext] = React.useState<string | null>(null),
    [error, setError] = React.useState(""),
    [loadedKey, setLoadedKey] = React.useState<string | null>(null),
    [pageLoading, setPageLoading] = React.useState(false),
    [retry, setRetry] = React.useState(0);
  const searchRequest = React.useRef<AbortController>(null);
  const key = JSON.stringify([q, tag, retry]);
  const loading = key !== loadedKey;
  const query = React.useMemo(() => ({
    action: "search",
    kind: "assets",
    q,
    state: "published",
    validity: "valid",
    ...(tag ? { tag } : {}),
  }), [q, tag]);
  React.useEffect(() => {
    const request = new AbortController();
    searchRequest.current = request;
    const timer = setTimeout(() => {
      void call<{ items: Asset[]; next: string | null }>(query, false, "library", request.signal)
        .then((result) => {
          if (request.signal.aborted) return;
          setItems(result.items);
          setNext(result.next);
          setError("");
          setLoadedKey(key);
        })
        .catch((e: Error) => {
          if (request.signal.aborted) return;
          setItems([]);
          setNext(null);
          setError(e.message);
          setLoadedKey(key);
        });
    }, 250);
    return () => {
      clearTimeout(timer);
      request.abort();
    };
  }, [call, key, query]);

  async function loadMore() {
    const request = searchRequest.current;
    if (!request || !next || pageLoading) return;
    setPageLoading(true);
    setError("");
    try {
      const result = await call<{ items: Asset[]; next: string | null }>(
        { ...query, before: next }, false, "library", request.signal,
      );
      if (request.signal.aborted) return;
      setItems((previous) => [...previous, ...result.items]);
      setNext(result.next);
    } catch (cause) {
      if (!request.signal.aborted) setError(cause instanceof Error ? cause.message : "素材暂未加载。");
    } finally {
      setPageLoading(false);
    }
  }

  return (
    <section className={styles.form} aria-label="企业素材选择">
      <label>
        搜索企业素材
        <input type="search" value={q} onChange={(e) => setQ(e.target.value)} />
      </label>
      <label>
        素材标签
        <input value={tag} onChange={(e) => setTag(e.target.value)} />
      </label>
      {loading && <p role="status">正在查找已发布素材…</p>}
      {!loading && error && <div role="alert">
        <p>{error}</p>
        <Button variant="ghost" onClick={() => setRetry((value) => value + 1)}>重试搜索</Button>
      </div>}
      <ul className={styles.rows} aria-busy={loading}>
        {items.map((a) => (
          <li key={a.id}
            draggable={!!projectId && !busy && !loading}
            onDragStart={(event) => {
              if (!projectId || busy || loading) return;
              const ids = selected.includes(a.id) ? selected : [a.id];
              event.dataTransfer.effectAllowed = "copy";
              event.dataTransfer.setData(pitchAssetDragType, JSON.stringify({ projectId, ids, layout }));
            }}>

            <label className={styles.check}>
              <input
                type="checkbox"
                checked={selected.includes(a.id)}
                disabled={
                  busy || loading || (!selected.includes(a.id) && selected.length >= 12)
                }
                onChange={(e) =>
                  setSelected((v) =>
                    e.target.checked
                      ? [...v, a.id]
                      : v.filter((id) => id !== a.id),
                  )
                }
              />
              <span>
                <strong>{a.names.zh ?? a.names.en}</strong>
                <span>
                  {a.data_as_of ?? ""}
                  {a.is_test_data ? " · 测试素材" : ""}
                </span>
              </span>
            </label>
          </li>
        ))}
      </ul>
      {!loading && !error && !items.length && <p>没有匹配的已发布素材。</p>}
      {next && !loading && <Button variant="secondary" loading={pageLoading} loadingLabel="正在加载…"
        onClick={() => void loadMore()}>
        更多素材
      </Button>}
      <label>
        组合布局
        <select
          value={layout}
          onChange={(e) => setLayout(e.target.value as LayoutId)}
        >
          {LAYOUTS.map((l) => (
            <option key={l.id} value={l.id}>
              {l.zh}
            </option>
          ))}
        </select>
      </label>
      <Button
        disabled={busy || loading || !selected.length}
        onClick={() =>
          void onAdd(selected, layout)
            .then(() => setSelected([]))
            .catch((e) => setError(e.message))
        }
      >
        添加到 Pitch（{selected.length}）
      </Button>
    </section>
  );
}
