/* eslint-disable @next/next/no-img-element -- authenticated SVG thumbnails. */
"use client";

import * as React from "react";
import { ArrowDown, ArrowUp, Copy, Trash2 } from "lucide-react";
import { Button, IconButton } from "@/src/components/ui";
import styles from "./workspace.module.css";

type Slide = { id: string; title: string; image?: string };
type Props = {
  slides: Slide[];
  active: string | null;
  selected: string[];
  disabled: boolean;
  onOpen: (id: string) => void;
  onSelect: (ids: string[]) => void;
  onCopy: (index: number) => void;
  onRemove: (ids: string[]) => void;
  onMove: (id: string, index: number) => void;
  onUndoSave?: () => void;
};

export function SlideNavigator({
  slides, active, selected, disabled, onOpen, onSelect, onCopy, onRemove,
  onMove, onUndoSave,
}: Props) {
  const [query, setQuery] = React.useState("");
  const anchor = React.useRef<string | null>(null);
  const drag = React.useRef<string | null>(null);
  const q = query.trim().toLocaleLowerCase();
  const visible = slides.map((slide, i) => ({ ...slide, i })).filter(
    ({ title, i }) => !q || title.toLocaleLowerCase().includes(q) || String(i + 1) === q,
  );
  const ids = new Set(selected);
  const allVisible = visible.length > 0 && visible.every((slide) => ids.has(slide.id));

  function applySelection(affected: string[], checked: boolean) {
    const next = new Set(selected);
    for (const item of affected) {
      if (checked) next.add(item);
      else next.delete(item);
    }
    onSelect(slides.map((slide) => slide.id).filter((id) => next.has(id)));
  }

  function selectPage(id: string, checked: boolean, range: boolean) {
    const first = visible.findIndex((slide) => slide.id === anchor.current);
    const last = visible.findIndex((slide) => slide.id === id);
    const affected = range && first >= 0
      ? visible.slice(Math.min(first, last), Math.max(first, last) + 1).map((slide) => slide.id)
      : [id];
    applySelection(affected, checked);
    anchor.current = id;
  }

  return (
    <section className={styles.basket} aria-label="Pitch 页面">
      <input
        type="search"
        aria-label="搜索页面"
        placeholder="搜索页码或标题"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
      />
      <div className={styles.actions}>
        <label className={styles.check}>
          <input
            type="checkbox"
            checked={allVisible}
            disabled={!visible.length}
            onChange={(event) => applySelection(visible.map((slide) => slide.id), event.currentTarget.checked)}
          />
          {q ? "选中结果" : "全选"}
        </label>
        <span>{selected.length ? `已选 ${selected.length} 页` : `${slides.length} 页`}</span>
        <IconButton
          label="删除选中"
          disabled={disabled || !selected.length}
          onClick={() => onRemove(selected)}
        >
          <Trash2 size={16} />
        </IconButton>
      </div>
      {onUndoSave && <Button variant="ghost" disabled={disabled} onClick={onUndoSave}>撤销上次保存</Button>}
      {!visible.length && <p>{q ? "没有匹配的页面。" : "尚无页面。"}</p>}
      <ol className={styles.ribbon}>
        {visible.map(({ id, title, image, i }) => (
          <li key={id} data-active={active === id} draggable={!disabled && !q}
            onDragStart={() => { drag.current = id; }}
            onDragEnd={() => { drag.current = null; }}
            onDragOver={(event) => { if (drag.current) event.preventDefault(); }}
            onDrop={(event) => {
              if (!drag.current || q || disabled) return;
              event.preventDefault();
              onMove(drag.current, i);
              drag.current = null;
            }}>
            <div className={styles.thumbHeader}>
              <label className={styles.check}>
                <input type="checkbox" aria-label={`选择第 ${i + 1} 页`} checked={ids.has(id)}
                  onChange={(event) => selectPage(id, event.currentTarget.checked, event.nativeEvent instanceof MouseEvent && event.nativeEvent.shiftKey)}
                />
                {i + 1}
              </label>
              <IconButton label={`复制第 ${i + 1} 页`} disabled={disabled} onClick={() => onCopy(i)}>
                <Copy size={14} />
              </IconButton>
            </div>
            <button type="button" className={styles.thumbButton}
              aria-label={`打开第 ${i + 1} 页：${title}`}
              aria-current={active === id ? "page" : undefined}
              onClick={() => onOpen(id)}
              onKeyDown={(event) => {
                if (disabled || q || !event.altKey) return;
                const offset = ["ArrowUp", "ArrowLeft"].includes(event.key) ? -1
                  : ["ArrowDown", "ArrowRight"].includes(event.key) ? 1 : 0;
                if (offset) {
                  event.preventDefault();
                  onMove(id, i + offset);
                }
              }}>
              {image && <img src={image} alt="" />}
              <span>{title}</span>
            </button>
            <div className={styles.thumbMoves}>
              <IconButton label={`前移第 ${i + 1} 页`} disabled={disabled || !!q || i === 0} onClick={() => onMove(id, i - 1)}>
                <ArrowUp size={14} />
              </IconButton>
              <IconButton label={`后移第 ${i + 1} 页`} disabled={disabled || !!q || i === slides.length - 1} onClick={() => onMove(id, i + 1)}>
                <ArrowDown size={14} />
              </IconButton>
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}
