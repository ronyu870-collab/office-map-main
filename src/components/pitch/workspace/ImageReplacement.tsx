"use client";

import { useEffect, useRef, useState } from "react";
import { z } from "zod";
import { Button } from "@/src/components/ui";
import type { WorkspaceDetail, WorkspaceSave } from "@/src/lib/pitch/workspace/protocol";
import type { Call } from "./client";
import styles from "./workspace.module.css";

type Images = NonNullable<WorkspaceSave["pages"][number]["images"]>;
type Slide = WorkspaceDetail["slides"][number];
const matchesImage = (first: Images[number], second: Images[number]) => first.id === second.id && first.version === second.version;
const imageKey = (image: Images[number]) => `${image.id}:${image.version}`;
const searchResult = z.object({
  items: z.array(z.object({ id: z.uuid(), version: z.number().int().positive(), alt: z.string().nullish() })),
});

export function libraryImagesForReplacement(slide: Slide) {
  if ((slide.scene.pagination?.count ?? 1) > 1 || slide.scene.elements.some(element => element.editorId)) return null;
  const sources = new Set(slide.content.sources.flatMap(source => source.kind === "document" && source.pageId ? [source.id] : []));
  const images = slide.content.blocks.filter(block => block.kind === "image");
  // The current save command resolves every image on the page through the library.
  if (!images.length || images.length > 10 || images.some(image => !image.sourceIds.some(id => sources.has(id)))) return null;
  return images.map(image => ({ id: image.mediaAssetId, version: image.mediaVersion, alt: image.alt.slice(0, 400) }));
}

export function ImageReplacement({ call, originals, pending, selectedIndex, disabled, onChange }: {
  call: Call;
  originals: Images;
  pending?: Images;
  selectedIndex?: number;
  disabled: boolean;
  onChange: (images: Images | undefined) => void;
}) {
  const [open, setOpen] = useState(selectedIndex !== undefined);
  const [query, setQuery] = useState("");
  const [retry, setRetry] = useState(0);
  const [response, setResponse] = useState<{ key: string; items: Images; error?: string }>();
  const search = useRef<HTMLInputElement>(null);
  const key = JSON.stringify([query.trim(), retry]);
  const result = response?.key === key ? response : undefined;

  useEffect(() => { if (open && selectedIndex !== undefined) search.current?.focus(); }, [open, selectedIndex]);
  useEffect(() => {
    if (!open) return;
    const request = new AbortController();
    const timer = setTimeout(() => {
      void call({ action: "search", kind: "media", state: "published", validity: "valid", q: query.trim() }, false, "library", request.signal)
        .then(searchResult.parse)
        .then(({ items }) => {
          if (!request.signal.aborted) setResponse({ key, items: items.map(item => ({ ...item, alt: (item.alt ?? "").slice(0, 400) })) });
        })
        .catch((error: unknown) => {
          if (!request.signal.aborted) setResponse({ key, items: [], error: error instanceof Error && !(error instanceof z.ZodError)
            ? error.message : "暂时无法读取图库。" });
        });
    }, 250);
    return () => { clearTimeout(timer); request.abort(); };
  }, [call, key, open, query]);

  function replace(index: number, option: string) {
    const image = option === "original" ? originals[index] : result?.items.find(item => imageKey(item) === option);
    if (!image || disabled) return;
    const images = (pending ?? originals).map((original, item) => item === index ? image : original);
    onChange(images.every((item, index) => matchesImage(item, originals[index])) ? undefined : images);
  }

  return <details open={open} onToggle={event => setOpen(event.currentTarget.open)}>
    <summary>更换图片</summary>
    {open && <div className={styles.form}>
      <label>
        搜索已发布图片
        <input ref={search} type="search" maxLength={120} value={query} onChange={event => setQuery(event.target.value)} />
      </label>
      {!result && <p role="status">正在查找图片…</p>}
      {result?.error && <div role="alert"><p>{result.error}</p>
        <Button variant="ghost" onClick={() => setRetry(value => value + 1)}>重试搜索</Button></div>}
      {result && !result.error && !result.items.length && <p>没有匹配的已发布图片。</p>}
      {originals.map((original, index) => {
        if (selectedIndex !== undefined && selectedIndex !== index) return null;
        const current = pending?.[index] ?? original;
        const alternatives = result?.items.filter(item => !matchesImage(item, original)) ?? [];
        const chosen = !matchesImage(current, original);
        return <label key={index}>
          {selectedIndex !== undefined ? `所选图片 · ${original.alt || `图片 ${index + 1}`}` : `图片 ${index + 1}`}
          <select value={chosen ? imageKey(current) : "original"} onChange={event => replace(index, event.target.value)}
            disabled={disabled || (!alternatives.length && !chosen)}>
            <option value="original">当前图片</option>
            {chosen && !alternatives.some(item => matchesImage(item, current)) &&
              <option value={imageKey(current)}>{current.alt || "已选图片"}</option>}
            {alternatives.map(item => <option key={imageKey(item)} value={imageKey(item)}>{item.alt || "已发布图片"}</option>)}
          </select>
        </label>;
      })}
    </div>}
  </details>;
}
