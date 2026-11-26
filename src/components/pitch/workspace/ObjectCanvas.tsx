/* eslint-disable @next/next/no-img-element -- individual layers are authenticated SVG previews. */
"use client";
import * as React from "react";
import { Button } from "@/src/components/ui";
import type { SlideContent } from "@/src/lib/pitch/contracts/content";
import type { SlideScene } from "@/src/lib/pitch/contracts/scene";
import { canMoveObject, canScaleObject, constrainedPosition, constrainedScale, objectId, textAnchors, type ObjectMove, type ObjectText } from "@/src/lib/pitch/workspace/object-layout";
import type { Call } from "./client";
import styles from "./workspace.module.css";

type Layer = { id: string | null; url: string };
type Position = Pick<ObjectMove, "x" | "y" | "scale">;
type Changes = { moves: ObjectMove[]; texts: ObjectText[] };
type History = { past: Changes[]; present: Changes; future: Changes[] };
type HistoryAction = { type: "record"; update: (value: Changes) => Changes } | { type: "undo" | "redo" };
function editHistory(state: History, action: HistoryAction): History {
  if (action.type === "record") {
    const present = action.update(state.present);
    return JSON.stringify(present) === JSON.stringify(state.present) ? state :
      { past: [...state.past, state.present].slice(-100), present, future: [] };
  }
  if (action.type === "undo" && state.past.length)
    return { past: state.past.slice(0, -1), present: state.past[state.past.length - 1], future: [state.present, ...state.future] };
  if (action.type === "redo" && state.future.length)
    return { past: [...state.past, state.present], present: state.future[0], future: state.future.slice(1) };
  return state;
}

export function splitLayers(svg: string): Layer[] {
  const root = new DOMParser().parseFromString(svg, "image/svg+xml").documentElement;
  if (root.localName !== "svg" || root.namespaceURI !== "http://www.w3.org/2000/svg")
    throw new Error("无法读取对象图层。");
  const encoder = new XMLSerializer();
  return Array.from(root.children).map(child => {
    const layer = root.cloneNode(false) as Element;
    layer.appendChild(child.cloneNode(true));
    return {
      id: child.getAttribute("data-pitch-object"),
      url: "data:image/svg+xml;charset=utf-8," + encodeURIComponent(encoder.serializeToString(layer)),
    };
  });
}

export function ObjectCanvas({ call, projectId, slideId, scene, content, allowParagraphs, pendingMoves, pendingTexts, onApply, onClose }: {
  call: Call;
  projectId: string;
  slideId: string;
  scene: SlideScene;
  content: SlideContent;
  allowParagraphs: boolean;
  pendingMoves?: ObjectMove[];
  pendingTexts?: ObjectText[];
  onApply: (changes: Changes) => void;
  onClose: () => void;
}) {
  const [layers, setLayers] = React.useState<Layer[]>([]);
  const [error, setError] = React.useState("");
  const [selected, setSelected] = React.useState<string | null>(null);
  const [history, dispatch] = React.useReducer(editHistory, {
    past: [], present: { moves: pendingMoves ?? [], texts: pendingTexts ?? [] }, future: [],
  });
  const { moves, texts } = history.present;
  const [typing, setTyping] = React.useState<{ id: string; value: string } | null>(null);
  const [dragMove, setDragMove] = React.useState<ObjectMove | null>(null);
  const board = React.useRef<HTMLDivElement | null>(null);
  const drag = React.useRef<{ id: string; pointer: number; startX: number; startY: number; origin: Position; rect: DOMRect; resizing?: boolean } | null>(null);
  const sceneKey = JSON.stringify(scene);
  const entries = scene.elements.map((element, i) => ({ element, id: objectId(element, i) }));
  const anchors = React.useMemo(() => textAnchors(scene, content, allowParagraphs), [scene, content, allowParagraphs]);
  const canonicalText = (id: string) => {
    const anchor = anchors.get(id);
    if (anchor?.kind === "title") return content.title;
    const block = anchor?.kind === "paragraph" ? content.blocks[anchor.block] : undefined;
    return block?.kind === "paragraph" ? block.text : "";
  };
  const hasChanges = !!(moves.length || texts.length);
  React.useEffect(() => {
    const request = new AbortController();
    void call<{ svg: string; scene: SlideScene }>({
      action: "preview", projectId, page: 0, editorSlideId: slideId,
    }, true, "", request.signal).then(result => {
      if (request.signal.aborted) return;
      if (JSON.stringify(result.scene) !== sceneKey) throw new Error("页面已更新，请关闭后重新打开对象编辑。");
      const split = splitLayers(result.svg);
      if (split.length !== result.scene.elements.length + 1 || split[0]?.id !== null ||
        result.scene.elements.some((element, index) => split[index + 1]?.id !== objectId(element, index)))
        throw new Error("未能读取完整的对象图层。");
      setLayers(split);
    }).catch(cause => {
      if (!request.signal.aborted) setError(cause instanceof Error ? cause.message : "对象图层未加载。");
    });
    return () => request.abort();
  }, [call, projectId, slideId, sceneKey]);

  function position(id: string, fallback: Position) {
    return (dragMove?.id === id ? dragMove : moves.find(move => move.id === id)) ?? fallback;
  }
  function place(id: string, next: Position) {
    const entry = entries.find(value => value.id === id);
    if (!entry) return;
    dispatch({ type: "record", update: previous => {
      const rest = previous.moves.filter(move => move.id !== id);
      const { x, y, scale } = next;
      const moves = x === entry.element.x && y === entry.element.y && (scale ?? 1) === 1
        ? rest : [...rest, { id, x, y, ...(scale !== undefined && scale !== 1 ? { scale } : {}) }];
      return { ...previous, moves };
    } });
  }
  function moveFrom(at: Position, element: Pick<SlideScene["elements"][number], "w" | "h">, x: number, y: number) {
    const scale = at.scale ?? 1;
    return { ...constrainedPosition(scene, { w: element.w * scale, h: element.h * scale }, x, y),
      ...(scale !== 1 ? { scale } : {}) };
  }

  function resizeFrom(at: Position, element: Pick<SlideScene["elements"][number], "w" | "h">, scale: number) {
    return { x: at.x, y: at.y, scale: constrainedScale(scene, element, at, scale) };
  }
  function startTyping(id: string) {
    if (anchors.has(id)) setTyping({ id, value: texts.find(text => text.id === id)?.text ?? canonicalText(id) });
  }
  function commitText() {
    if (!typing) return;
    const { id, value } = typing, text = value.trim(), anchor = anchors.get(id);
    if (!anchor || !text || text.length > anchor.maxLength) return;
    dispatch({ type: "record", update: before => {
      const rest = before.texts.filter(change => change.id !== id);
      return { ...before, texts: text === canonicalText(id) ? rest : [...rest, { id, text }] };
    } });
    setTyping(null);
    requestAnimationFrame(() => board.current?.querySelector<HTMLButtonElement>(`[data-canvas-id="${id}"]`)?.focus());
  }
  const picked = entries.find(entry => entry.id === selected);
  const pickedPosition = picked ? position(picked.id, picked.element) : null;
  const pickedScale = pickedPosition?.scale ?? 1;
  function draggedScale(event: React.PointerEvent<HTMLButtonElement>, element: SlideScene["elements"][number]) {
    const start = drag.current;
    if (!start || !start.resizing || start.pointer !== event.pointerId || !start.rect.width || !start.rect.height)
      return null;
    const dx = element.w / scene.width * start.rect.width;
    const dy = element.h / scene.height * start.rect.height;
    const delta = ((event.clientX - start.startX) * dx + (event.clientY - start.startY) * dy) / (dx * dx + dy * dy);
    return resizeFrom(start.origin, element, (start.origin.scale ?? 1) + delta);
  }
  return (
    <section className={styles.objectEditor} aria-label="画布对象编辑" onKeyDown={event => {
      if (typing || event.nativeEvent.isComposing || !(event.metaKey || event.ctrlKey) ||
        event.key.toLowerCase() !== "z") return;
      event.preventDefault();
      dispatch({ type: event.shiftKey ? "redo" : "undo" });
    }}>
      <div className={styles.objectTools}>
        <Button variant="ghost" onClick={onClose}>返回预览</Button>
        <Button variant="ghost" disabled={!!typing || !history.past.length} onClick={() => dispatch({ type: "undo" })}>撤销画布操作</Button>
        <Button variant="ghost" disabled={!!typing || !history.future.length} onClick={() => dispatch({ type: "redo" })}>重做画布操作</Button>
        {picked && anchors.has(picked.id) && !typing &&
          <Button variant="ghost" onClick={() => startTyping(picked.id)}>编辑所选文字</Button>}
        <Button disabled={!!error || !layers.length || !hasChanges || !!typing}
          onClick={() => onApply(history.present)}>{texts.length ? "应用到页面" : "应用位置"}</Button>
      </div>
      {error && <p role="alert">{error}</p>}
      {!layers.length && !error && <p role="status">正在读取页面对象…</p>}
      {layers.length > 0 && <div ref={board} className={styles.objectBoard}>
        {layers.map((layer, index) => {
          const element = entries[index - 1]?.element;
          const p = layer.id && element ? position(layer.id, element) : null;
          const text = layer.id ? texts.find(change => change.id === layer.id)?.text : undefined;
          if (layer.id && element?.kind === "text" && p && (text || typing?.id === layer.id)) {
            if (typing?.id === layer.id) return null;
            return <div key={layer.id} className={styles.objectTextPreview} data-title={element.role === "title"}
              style={{ left: `${p.x / scene.width * 100}%`, top: `${p.y / scene.height * 100}%`,
                width: `${element.w / scene.width * 100}%`, height: `${element.h / scene.height * 100}%` }}>{text}</div>;
          }
          const scale = p?.scale ?? 1;
          return <img key={layer.id ?? "background"} draggable={false} alt="" src={layer.url}
            style={p && element ? { transformOrigin: "0 0", transform: `translate(${(p.x - element.x * scale) / scene.width * 100}%, ${(p.y - element.y * scale) / scene.height * 100}%) scale(${scale})` } : undefined} />;
        })}
        {entries.filter(({ element }) => canMoveObject(element)).map(({ id, element }, index) => {
          const p = position(id, element);
          const factor = p.scale ?? 1;
          const bounds = { left: `${p.x / scene.width * 100}%`, top: `${p.y / scene.height * 100}%`,
            width: `${element.w * factor / scene.width * 100}%`, height: `${element.h * factor / scene.height * 100}%` };
          if (typing?.id === id) return <textarea key={id} className={styles.objectTextInput}
            aria-label="画布文字" autoFocus style={bounds} maxLength={anchors.get(id)?.maxLength}
            value={typing.value} onChange={event => setTyping({ id, value: event.target.value })}
            onKeyDown={event => {
              if (event.nativeEvent.isComposing) return;
              if (event.key === "Escape") { event.preventDefault(); setTyping(null); }
              if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) { event.preventDefault(); commitText(); }
            }} />;
          const label = element.kind === "text" ? (texts.find(change => change.id === id)?.text ?? element.text).slice(0, 55)
            : element.kind === "image" ? element.alt || "图片"
            : ({ chart: "图表", table: "表格", shape: "形状", map: "地图" } as Record<string,string>)[element.kind] ?? "对象";
          return <button
            key={id} type="button" aria-label={`对象 ${index + 1}：${label}`} aria-pressed={selected === id}
            className={styles.objectTarget}
            data-canvas-id={id} style={bounds}
            onDoubleClick={() => startTyping(id)}
            onClick={() => setSelected(id)}
            onFocus={() => setSelected(id)}
            onPointerDown={event => {
              if (event.button !== 0 || drag.current || !board.current) return;
              setSelected(id);
              if (typeof event.currentTarget.setPointerCapture !== "function") return;
              drag.current = { id, pointer: event.pointerId, startX: event.clientX, startY: event.clientY, origin: p, rect: board.current.getBoundingClientRect() };
              event.currentTarget.setPointerCapture(event.pointerId);
            }}
            onPointerMove={event => {
              const start = drag.current;
              if (!start || start.pointer !== event.pointerId || !start.rect.width || !start.rect.height) return;
              setDragMove({ id, ...moveFrom(start.origin, element,
                start.origin.x + (event.clientX - start.startX) / start.rect.width * scene.width,
                start.origin.y + (event.clientY - start.startY) / start.rect.height * scene.height) });
            }}
            onPointerUp={event => {
              const start = drag.current;
              if (!start || start.pointer !== event.pointerId) return;
              const dx = event.clientX - start.startX, dy = event.clientY - start.startY;
              if (Math.hypot(dx, dy) >= 2 && start.rect.width && start.rect.height) {
                place(id, moveFrom(start.origin, element, start.origin.x + dx / start.rect.width * scene.width, start.origin.y + dy / start.rect.height * scene.height));
              }
              drag.current = null;
              setDragMove(null);
            }}
            onLostPointerCapture={() => { drag.current = null; setDragMove(null); }}
            onPointerCancel={() => { drag.current = null; setDragMove(null); }}
            onKeyDown={event => {
              if (event.key === "F2" && anchors.has(id)) { event.preventDefault(); startTyping(id); return; }
              const offsets: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
              const d = offsets[event.key];
              if (!d) return;
              event.preventDefault();
              const step = event.shiftKey ? .25 : .05;
              place(id, moveFrom(p, element, p.x + d[0] * step, p.y + d[1] * step));
            }}
          />;
        })}
        {picked && pickedPosition && !typing && canScaleObject(picked.element) && (
          <button type="button" aria-label="缩放所选对象"
            className={styles.objectResize}
            style={{
              left: `${(pickedPosition.x + picked.element.w * pickedScale) / scene.width * 100}%`,
              top: `${(pickedPosition.y + picked.element.h * pickedScale) / scene.height * 100}%`,
            }}
            onPointerDown={event => {
              if (event.button !== 0 || drag.current || !board.current ||
                typeof event.currentTarget.setPointerCapture !== "function") return;
              drag.current = { id: picked.id, pointer: event.pointerId, startX: event.clientX,
                startY: event.clientY, origin: pickedPosition, rect: board.current.getBoundingClientRect(), resizing: true };
              event.currentTarget.setPointerCapture(event.pointerId);
            }}
            onPointerMove={event => {
              const next = draggedScale(event, picked.element);
              if (next) setDragMove({ id: picked.id, ...next });
            }}
            onPointerUp={event => {
              const next = draggedScale(event, picked.element);
              if (!next) return;
              place(picked.id, next);
              drag.current = null;
              setDragMove(null);
            }}
            onLostPointerCapture={() => { drag.current = null; setDragMove(null); }}
            onPointerCancel={() => { drag.current = null; setDragMove(null); }}
            onKeyDown={event => {
              const step = event.shiftKey ? .1 : .025;
              const direction = ["ArrowLeft", "ArrowUp", "-"].includes(event.key) ? -1
                : ["ArrowRight", "ArrowDown", "+"].includes(event.key) ? 1 : 0;
              if (!direction) return;
              event.preventDefault();
              place(picked.id, resizeFrom(pickedPosition, picked.element, pickedScale + direction * step));
            }}
          />
        )}
      </div>}
      {typing && <div className={styles.objectTools}>
        <Button variant="ghost" onClick={() => setTyping(null)}>取消文字修改</Button>
        <Button variant="secondary" disabled={!typing.value.trim()} onClick={commitText}>完成文字编辑</Button>
      </div>}
      {picked && !typing && canScaleObject(picked.element) && (
        <div className={styles.objectTools}>
          <Button variant="ghost" onClick={() => {
            const at = position(picked.id, picked.element);
            place(picked.id, resizeFrom(at, picked.element, (at.scale ?? 1) - .1));
          }}>缩小所选</Button>
          <Button variant="ghost" onClick={() => {
            const at = position(picked.id, picked.element);
            place(picked.id, resizeFrom(at, picked.element, (at.scale ?? 1) + .1));
          }}>放大所选</Button>
          <output aria-label="所选对象缩放">{Math.round((position(picked.id, picked.element).scale ?? 1) * 100)}%</output>
        </div>
      )}
      {picked && <output aria-live="polite" className={styles.objectPosition}>
        横向 {position(picked.id, picked.element).x.toFixed(2)} 英寸 · 纵向 {position(picked.id, picked.element).y.toFixed(2)} 英寸
      </output>}
    </section>
  );
}
