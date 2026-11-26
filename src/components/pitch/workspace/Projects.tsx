"use client";
import * as React from "react";
import { Button, Dialog } from "@/src/components/ui";
import type { Call } from "./client";
import styles from "./workspace.module.css";
type Row = {
  id: string;
  title: string;
  version: number;
  state: string;
  updated_at: string;
  page_count: number;
  deleted_at: string | null;
};
export function Projects({
  call,
  onOpen,
  onCopy,
  recentOnly = false,
}: {
  call: Call;
  recentOnly?: boolean;
  onOpen: (id: string) => Promise<void>;
  onCopy: (id: string, title: string) => Promise<void>;
}) {
  const [q, setQ] = React.useState(""),
    [filter, setFilter] = React.useState("active"),
    [items, setItems] = React.useState<Row[]>([]),
    [next, setNext] = React.useState<number | null>(null),
    [refresh, setRefresh] = React.useState(0),
    [error, setError] = React.useState(""),
    [busy, setBusy] = React.useState(false),
    [loading, setLoading] = React.useState(true),
    [deleting, setDeleting] = React.useState<Row | null>(null);
  React.useEffect(() => {
    const c = new AbortController(),
      timer = setTimeout(
        () =>
          void call<{ items: Row[]; next: number | null }>(
            { action: "list", q, filter },
            false,
            "workspace",
            c.signal,
          )
            .then((r) => {
              setItems(r.items);
              setNext(r.next);
              setError("");
              setLoading(false);
            })
            .catch((e) => {
              if (!c.signal.aborted) {
                setError(e.message);
                setLoading(false);
              }
            }),
        220,
      );
    return () => {
      clearTimeout(timer);
      c.abort();
    };
  }, [call, q, filter, refresh]);
  async function change(row: Row, state: string) {
    setBusy(true);
    try {
      await call(
        {
          action: "lifecycle",
          projectId: row.id,
          expectedVersion: row.version,
          state,
        },
        true,
      );
      setRefresh((v) => v + 1);
      setDeleting(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "操作未完成。");
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className={recentOnly ? styles.recentList : styles.content}>
      {!recentOnly && <div className={styles.filters}>
        <label>
          搜索 Pitch
          <input
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </label>
        <label>
          项目状态
          <select value={filter} onChange={(e) => setFilter(e.target.value)}>
            <option value="active">最近编辑</option>
            <option value="archived">已归档</option>
            <option value="deleted">已删除</option>
          </select>
        </label>
      </div>}
      {error && <p role="alert">{error}</p>}
      <ul className={styles.rows}>
        {(recentOnly ? items.slice(0, 5) : items).map((row) => (
          <li key={row.id}>
            <button
              className={styles.rowTitle}
              disabled={!!row.deleted_at || busy}
              onClick={() =>
                void onOpen(row.id).catch((e) => setError(e.message))
              }
            >
              <strong>{row.title}</strong>
              <span>
                {row.page_count} 页 ·{" "}
                {new Date(row.updated_at).toLocaleString("zh-CN")}
              </span>
            </button>
            {!recentOnly && <div className={styles.actions}>
              {row.deleted_at ? (
                <Button
                  variant="secondary"
                  disabled={busy}
                  onClick={() => void change(row, "draft")}
                >
                  恢复
                </Button>
              ) : (
                <>
                  <Button
                    variant="ghost"
                    disabled={busy}
                    onClick={() =>
                      void onCopy(row.id, row.title + " · 副本").catch((e) =>
                        setError(e.message),
                      )
                    }
                  >
                    复制
                  </Button>
                  <Button
                    variant="ghost"
                    disabled={busy}
                    onClick={() =>
                      void change(
                        row,
                        row.state === "archived" ? "draft" : "archived",
                      )
                    }
                  >
                    {row.state === "archived" ? "取消归档" : "归档"}
                  </Button>
                  <Button
                    variant="ghost"
                    disabled={busy}
                    onClick={() => setDeleting(row)}
                  >
                    删除
                  </Button>
                </>
              )}
            </div>}
          </li>
        ))}
      </ul>
      {loading && <p role="status">正在读取项目…</p>}
      {!loading && !error && !items.length && (
        <p>
          {q ? "没有匹配的 Pitch。" : "还没有项目，先从模板或素材生成页面。"}
        </p>
      )}
      {!recentOnly && next !== null && (
        <Button
          variant="secondary"
          onClick={() =>
            void call<{ items: Row[]; next: number | null }>(
              { action: "list", q, filter, offset: next },
              false,
            )
              .then((r) => {
                setItems((v) => [...v, ...r.items]);
                setNext(r.next);
              })
              .catch((e) => setError(e.message))
          }
        >
          更多 Pitch
        </Button>
      )}
      <Dialog
        open={!!deleting}
        onOpenChange={(open) => {
          if (!open) setDeleting(null);
        }}
        title="删除此 Pitch？"
        footer={
          <Button
            variant="danger"
            disabled={busy}
            onClick={() => deleting && void change(deleting, "deleted")}
          >
            删除
          </Button>
        }
      >
        <p>项目将移入已删除列表，可恢复。原始素材和历史导出记录将保留。</p>
      </Dialog>
    </section>
  );
}
