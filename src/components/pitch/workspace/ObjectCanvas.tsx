/* eslint-disable @next/next/no-img-element -- individual layers are authenticated SVG previews. */
"use client";
import * as React from "react";
import { Button } from "@/src/components/ui";
import type { SlideScene } from "@/src/lib/pitch/contracts/scene";
import { canMoveObject, constrainedPosition, objectId, type ObjectMove } from "@/src/lib/pitch/workspace/object-layout";
import type { Call } from "./client";
import styles from "./workspace.module.css";

type Layer = { id: string | null; url: string };
type Position = Pick<ObjectMove, "x" | "y">;

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

export function ObjectCanvas({ call, projectId, slideId, scene, pendingMoves, onApply, onClose }: {
  call: Call;
  projectId: string;
  slideId: string;
  scene: SlideScene;
  pendingMoves?: ObjectMove[];
  onApply: (moves: ObjectMove[]) => void;
  onClose: () => void;
}) {
  const [layers, setLayers] = React.useState<Layer[]>([]);
  const [error, setError] = React.useState("");
  const [selected, setSelected] = React.useState<string | null>(null);
  const [moves, setMoves] = React.useState<ObjectMove[]>(pendingMoves ?? []);
  const [dragMove, setDragMove] = React.useState<ObjectMove | null>(null);
  const board = React.useRef<HTMLDivElement | null>(null);
  const drag = React.useRef<{ id: string; pointer: number; startX: number; startY: number; origin: Position; rect: DOMRect } | null>(null);
  const sceneKey = JSON.stringify(scene);
  const entries = scene.elements.map((element, i) => ({ element, id: objectId(element, i) }));
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
    setMoves(previous => {
      const rest = previous.filter(move => move.id !== id);
      return next.x === entry.element.x && next.y === entry.element.y ? rest : [...rest, { id, ...next }];
    });
  }
  const picked = entries.find(entry => entry.id === selected);
  return (
    <section className={styles.objectEditor} aria-label="画布对象编辑">
      <div className={styles.objectTools}>
        <Button variant="ghost" onClick={onClose}>返回预览</Button>
        <Button variant="ghost" disabled={!moves.length} onClick={() => setMoves([])}>清除临时移动</Button>
        <Button disabled={!!error || !layers.length || !moves.length} onClick={() => onApply(moves)}>应用位置</Button>
      </div>
      {error && <p role="alert">{error}</p>}
      {!layers.length && !error && <p role="status">正在读取页面对象…</p>}
      {layers.length > 0 && <div ref={board} className={styles.objectBoard}>
        {layers.map((layer, index) => {
          const element = entries[index - 1]?.element;
          const p = layer.id && element ? position(layer.id, element) : null;
          return <img key={layer.id ?? "background"} draggable={false} alt="" src={layer.url}
            style={p && element ? { transform: `translate(${(p.x - element.x) / scene.width * 100}%, ${(p.y - element.y) / scene.height * 100}%)` } : undefined} />;
        })}
        {entries.filter(({ element }) => canMoveObject(element)).map(({ id, element }, index) => {
          const p = position(id, element);
          const label = element.kind === "text" ? element.text.slice(0, 55)
            : element.kind === "image" ? element.alt || "图片"
            : ({ chart: "图表", table: "表格", shape: "形状", map: "地图" } as Record<string,string>)[element.kind] ?? "对象";
          return <button
            key={id} type="button" aria-label={`对象 ${index + 1}：${label}`} aria-pressed={selected === id}
            className={styles.objectTarget}
            style={{ left: `${p.x / scene.width * 100}%`, top: `${p.y / scene.height * 100}%`, width: `${element.w / scene.width * 100}%`, height: `${element.h / scene.height * 100}%` }}
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
              setDragMove({ id, ...constrainedPosition(scene, element,
                start.origin.x + (event.clientX - start.startX) / start.rect.width * scene.width,
                start.origin.y + (event.clientY - start.startY) / start.rect.height * scene.height) });
            }}
            onPointerUp={event => {
              const start = drag.current;
              if (!start || start.pointer !== event.pointerId) return;
              const dx = event.clientX - start.startX, dy = event.clientY - start.startY;
              if (Math.hypot(dx, dy) >= 2 && start.rect.width && start.rect.height) {
                place(id, constrainedPosition(scene, element, start.origin.x + dx / start.rect.width * scene.width, start.origin.y + dy / start.rect.height * scene.height));
              }
              drag.current = null;
              setDragMove(null);
            }}
            onLostPointerCapture={() => { drag.current = null; setDragMove(null); }}
            onPointerCancel={() => { drag.current = null; setDragMove(null); }}
            onKeyDown={event => {
              const offsets: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
              const d = offsets[event.key];
              if (!d) return;
              event.preventDefault();
              const step = event.shiftKey ? .25 : .05;
              place(id, constrainedPosition(scene, element, p.x + d[0] * step, p.y + d[1] * step));
            }}
          />;
        })}
      </div>}
      {picked && <output aria-live="polite" className={styles.objectPosition}>
        横向 {position(picked.id, picked.element).x.toFixed(2)} 英寸 · 纵向 {position(picked.id, picked.element).y.toFixed(2)} 英寸
      </output>}
    </section>
  );
}
