/* eslint-disable @next/next/no-img-element -- authenticated SVG thumbnails. */
"use client";

import * as React from "react";
import { ArrowDown, ArrowUp, Copy, Ellipsis, Trash2 } from "lucide-react";
import { Button, IconButton } from "@/src/components/ui";
import styles from "./workspace.module.css";

type Slide = { id: string; title: string; image?: string; section?: boolean };
type Props = {
  slides: Slide[];
  active: string | null;
  selected: string[];
  disabled: boolean;
  onOpen: (id: string) => void;
  onSelect: (ids: string[]) => void;
  onCopy: (ids: string[]) => void;
  onRemove: (ids: string[]) => void;
  onMove: (id: string, index: number) => void;
  onUndoSave?: () => void;
};

function PageActions({ id, page, canCopy, canMoveUp, canMoveDown, onCopy, onRemove, onMove }: {
  id: string;
  page: number;
  canCopy: boolean;
  canMoveUp: boolean;
  canMoveDown: boolean;
  onCopy: Props["onCopy"];
  onRemove: Props["onRemove"];
  onMove: Props["onMove"];
}) {
  const menuId = React.useId();
  const trigger = React.useRef<HTMLButtonElement>(null);
  const panel = React.useRef<HTMLDivElement>(null);

  function act(run: () => void) {
    panel.current?.hidePopover?.();
    trigger.current?.focus();
    run();
  }

  return (
    <>
      <IconButton variant="ghost" size="sm" label={`第 ${page} 页操作`}
        ref={trigger} popoverTarget={menuId} data-slide-actions="">
        <Ellipsis size={14} />
      </IconButton>
      <div id={menuId} ref={panel} popover="auto" className={styles.projectMenu}
        role="group" aria-label={`第 ${page} 页操作`}>
        <Button variant="ghost" disabled={!canCopy} aria-label={`复制第 ${page} 页`} onClick={() => act(() => onCopy([id]))}>
          <Copy size={14} /> 复制页面
        </Button>
        <Button variant="ghost" disabled={!canMoveUp} aria-label={`前移第 ${page} 页`} onClick={() => act(() => onMove(id, page - 2))}>
          <ArrowUp size={14} /> 向前移动
        </Button>
        <Button variant="ghost" disabled={!canMoveDown} aria-label={`后移第 ${page} 页`} onClick={() => act(() => onMove(id, page))}>
          <ArrowDown size={14} /> 向后移动
        </Button>
        <Button variant="ghost" aria-label={`删除第 ${page} 页`} onClick={() => act(() => onRemove([id]))}>
          <Trash2 size={14} /> 删除页面
        </Button>
      </div>
    </>
  );
}

const maxPages = 50;

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
  const sections = slides.filter(slide => slide.section);
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
      {sections.length > 0 && <select aria-label="跳转章节" value=""
        onChange={(event) => { if (event.target.value) onOpen(event.target.value); }}>
        <option value="">跳转章节</option>
        {sections.map(({ id, title }) => <option key={id} value={id}>{title}</option>)}
      </select>}
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
        {selected.length > 0 && <IconButton variant="ghost" size="sm" label="复制选中"
          disabled={disabled || slides.length + selected.length > maxPages} onClick={() => onCopy(selected)}>
          <Copy size={16} />
        </IconButton>}
        {selected.length > 0 && <IconButton variant="ghost" size="sm"
          label="删除选中"
          disabled={disabled || !selected.length}
          onClick={() => onRemove(selected)}
        >
          <Trash2 size={16} />
        </IconButton>}
      </div>
      {onUndoSave && <Button variant="ghost" disabled={disabled} onClick={onUndoSave}>撤销上次保存</Button>}
      {!visible.length && <p>{q ? "没有匹配的页面。" : "尚无页面。"}</p>}
      <ol className={styles.ribbon}>
        {visible.map(({ id, title, image, section, i }) => (
          <li key={id} data-active={active === id} data-section={section || undefined} draggable={!disabled && !q}
            onContextMenu={(event) => {
              const button = event.currentTarget.querySelector<HTMLButtonElement>("[data-slide-actions]");
              const menu = button?.popoverTargetElement;
              if (!(menu instanceof HTMLElement) || !menu.showPopover) return;
              event.preventDefault();
              if (!menu.matches(":popover-open")) {
                button?.focus();
                button?.click();
              }
            }}
            onDragStart={(event) => {
              drag.current = id;
              event.dataTransfer.effectAllowed = "move";
              event.dataTransfer.setData("application/x-colliers-pitch-slide", id);
            }}
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
              {!disabled && <PageActions id={id} page={i + 1} canCopy={slides.length < maxPages}
                canMoveUp={!q && i > 0} canMoveDown={!q && i < slides.length - 1}
                onCopy={onCopy} onRemove={onRemove} onMove={onMove} />}
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
              {image
                ? <img src={image} alt="" loading="lazy" draggable={false} />
                : <span className={styles.slidePlaceholder} aria-hidden="true" /> }
              <span>{title}</span>
            </button>
          </li>
        ))}
      </ol>
    </section>
  );
}
