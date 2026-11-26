/* eslint-disable @next/next/no-img-element -- these thumbnails are authenticated scene previews. */
"use client";

import { useEffect, useState } from "react";
import type { LayoutId } from "@/src/lib/pitch/contracts/scene";
import { PATTERN_BY_ID } from "@/src/lib/pitch/layout/patterns/catalog";
import { Button } from "@/src/components/ui";
import type { Call } from "./client";
import styles from "./workspace.module.css";

type Variant = "standard" | "alternate";
const options: { id: Variant; label: string }[] = [
  { id: "standard", label: "标准" },
  { id: "alternate", label: "替换布局" },
];

export function LayoutVariants({ call, projectId, pageIndex, layoutId, value, disabled, onChange }: {
  call: Call;
  projectId: string;
  pageIndex: number;
  layoutId: LayoutId;
  value: Variant;
  disabled: boolean;
  onChange: (value: Variant) => void;
}) {
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<{ id: string; images: Partial<Record<Variant, string>>; failed: boolean }>();
  const layoutKey = `${projectId}:${pageIndex}:${layoutId}:${attempt}`;
  const visible = PATTERN_BY_ID.has(layoutId) ? options.slice(0, 1) : options;

  useEffect(() => {
    if (disabled) return;
    const request = new AbortController();
    const supported = PATTERN_BY_ID.has(layoutId) ? options.slice(0, 1) : options;
    void Promise.allSettled(supported.map(async variant => {
      const result = await call<{ svg: string }>({
        action: "preview", projectId, page: pageIndex, layoutId, variant: variant.id,
      }, true, "", request.signal);
      return [variant.id, "data:image/svg+xml;charset=utf-8," + encodeURIComponent(result.svg)] as const;
    })).then(results => {
      if (request.signal.aborted) return;
      setState({ id: layoutKey, images: Object.fromEntries(results.flatMap(result =>
        result.status === "fulfilled" ? [result.value] : [])), failed: results.some(result => result.status === "rejected") });
    });
    return () => request.abort();
  }, [call, disabled, layoutId, layoutKey, pageIndex, projectId]);

  const loaded = state?.id === layoutKey ? state : undefined;
  return <section aria-label="布局变体" className={styles.form}>
    <strong>布局变体</strong>
    <div className={styles.layoutVariants}>
      {visible.map(variant => <button type="button" key={variant.id} aria-pressed={value === variant.id}
        disabled={disabled || !loaded?.images[variant.id] || value === variant.id} onClick={() => onChange(variant.id)}>
        {loaded?.images[variant.id] ? <img src={loaded.images[variant.id]} alt="" /> : <span className={styles.thumbLoading} aria-hidden="true" />}
        <span>{variant.label}</span>
      </button>)}
    </div>
    {!disabled && !loaded && <p role="status">正在渲染布局缩略图…</p>}
    {loaded?.failed && <Button variant="ghost" onClick={() => setAttempt(value => value + 1)}>重试布局预览</Button>}
  </section>;
}
