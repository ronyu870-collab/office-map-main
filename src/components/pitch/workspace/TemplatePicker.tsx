/* eslint-disable @next/next/no-img-element -- thumbnails are genuine server-rendered synthetic examples. */
"use client";
import * as React from "react";
import { Button } from "@/src/components/ui";
import { Star } from "lucide-react";
import type { BusinessRecipe } from "@/src/lib/pitch/business/protocol";
import type { Call } from "./client";
import styles from "./workspace.module.css";
export type Template = {
  id: string;
  name: string;
  description: string;
  kind: string;
  recipe?: BusinessRecipe;
};
export function TemplatePicker({
  call,
  templates,
  onChoose,
  favorites,
  recent,
  onFavorite,
  compact = false,
}: {
  call: Call;
  templates: Template[];
  onChoose: (t: Template) => void;
  favorites: string[];
  recent: string[];
  onFavorite: (id: string) => void;
  compact?: boolean;
}) {
  const [q, setQ] = React.useState(""),
    [category, setCategory] = React.useState("all"),
    [thumbs, setThumbs] = React.useState<Record<string, string>>({}),
    [limit, setLimit] = React.useState(9),
    [error, setError] = React.useState("");
  const filtered = templates.filter(
    (t) =>
      (category === "all" ||
        (category === "favorites" && favorites.includes(t.id)) ||
        (category === "recent" && recent.includes(t.id)) ||
        t.kind === category) &&
      `${t.name} ${t.description}`.toLowerCase().includes(q.toLowerCase()),
  );
  const visible = filtered.slice(0, limit),
    key = visible.map((t) => t.id).join(",");
  React.useEffect(() => {
    const c = new AbortController();
    let cursor = 0;
    const ids = key.split(",").filter(Boolean);
    void Promise.all(
      [0, 1].map(async () => {
        while (cursor < ids.length && !c.signal.aborted) {
          const id = ids[cursor++];
          try {
            const r = await call<{ svg: string }>(
              { action: "thumbnail", templateId: id },
              false,
              "workspace",
              c.signal,
            );
            if (!c.signal.aborted)
              setThumbs((v) => ({
                ...v,
                [id]:
                  "data:image/svg+xml;charset=utf-8," +
                  encodeURIComponent(r.svg),
              }));
          } catch {
            if (!c.signal.aborted) setError("部分示例暂未加载，仍可选择模板。");
          }
        }
      }),
    );
    return () => c.abort();
  }, [call, key]);
  return (
    <section
      className={compact ? styles.picker : styles.content}
      aria-label="模板选择"
    >
      <div className={styles.filters}>
        <label>
          搜索模板
          <input
            type="search"
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setLimit(9);
            }}
          />
        </label>
        <label>
          模板分类
          <select
            value={category}
            onChange={(e) => {
              setCategory(e.target.value);
              setLimit(9);
            }}
          >
            {Object.entries({
              all: "全部模板",
              favorites: "收藏",
              recent: "最近使用",
              corporate: "公司介绍",
              team: "团队",
              case: "案例",
              research: "市场研究",
              dynamic: "业务数据",
              custom: "自定义",
            }).map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </select>
        </label>
      </div>
      {error && <p role="status">{error}</p>}
      <div className={compact ? styles.templateList : styles.templateGrid}>
        {visible.map((t) => (
          <article key={t.id} className={styles.template}>
            <button
              className={styles.templateChoose}
              onClick={() => onChoose(t)}
            >
              {thumbs[t.id] ? (
                <img
                  loading="lazy"
                  src={thumbs[t.id]}
                  alt={`${t.name} · 模板示例`}
                />
              ) : (
                <span className={styles.thumbLoading}>示例加载中</span>
              )}
              <strong>{t.name}</strong>
              <span>{t.description}</span>
            </button>
            <Button
              variant="ghost"
              aria-label={`${favorites.includes(t.id) ? "取消收藏" : "收藏"}${t.name}`}
              aria-pressed={favorites.includes(t.id)}
              onClick={() => onFavorite(t.id)}
            >
              <Star
                size={16}
                fill={favorites.includes(t.id) ? "currentColor" : "none"}
              />
            </Button>
          </article>
        ))}
      </div>
      {!filtered.length && <p>没有匹配的模板。</p>}
      {filtered.length > limit && (
        <Button variant="secondary" onClick={() => setLimit((v) => v + 9)}>
          更多模板
        </Button>
      )}
    </section>
  );
}
