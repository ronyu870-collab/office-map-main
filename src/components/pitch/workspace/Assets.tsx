"use client";
import * as React from "react";
import { Button } from "@/src/components/ui";
import type { Call } from "./client";
import type { LayoutId } from "@/src/lib/pitch/contracts/scene";
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
export function AssetPicker({
  call,
  onAdd,
  busy,
}: {
  call: Call;
  onAdd: (ids: string[], layout: LayoutId) => Promise<void>;
  busy: boolean;
}) {
  const [q, setQ] = React.useState(""),
    [tag, setTag] = React.useState(""),
    [items, setItems] = React.useState<Asset[]>([]),
    [selected, setSelected] = React.useState<string[]>([]),
    [layout, setLayout] = React.useState<LayoutId>("two-columns"),
    [next, setNext] = React.useState<string | null>(null),
    [error, setError] = React.useState("");
  React.useEffect(() => {
    const c = new AbortController(),
      timer = setTimeout(
        () =>
          void call<{ items: Asset[]; next: string | null }>(
            {
              action: "search",
              kind: "assets",
              q,
              state: "published",
              validity: "valid",
              ...(tag ? { tag } : {}),
            },
            false,
            "library",
            c.signal,
          )
            .then((r) => {
              setItems(r.items);
              setNext(r.next);
              setError("");
            })
            .catch((e) => {
              if (!c.signal.aborted) setError(e.message);
            }),
        250,
      );
    return () => {
      clearTimeout(timer);
      c.abort();
    };
  }, [q, tag, call]);
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
      {error && <p role="alert">{error}</p>}
      <ul className={styles.rows}>
        {items.map((a) => (
          <li key={a.id}>
            <label className={styles.check}>
              <input
                type="checkbox"
                checked={selected.includes(a.id)}
                disabled={
                  busy || (!selected.includes(a.id) && selected.length >= 12)
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
      {!items.length && <p>暂无适用的已发布素材。</p>}
      {next && (
        <Button
          variant="secondary"
          onClick={() =>
            void call<{ items: Asset[]; next: string | null }>(
              {
                action: "search",
                kind: "assets",
                q,
                state: "published",
                validity: "valid",
                before: next,
                ...(tag ? { tag } : {}),
              },
              false,
              "library",
            )
              .then((r) => {
                setItems((v) => [...v, ...r.items]);
                setNext(r.next);
              })
              .catch((e) => setError(e.message))
          }
        >
          更多素材
        </Button>
      )}
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
        disabled={busy || !selected.length}
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
