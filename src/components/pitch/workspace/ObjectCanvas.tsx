/* eslint-disable @next/next/no-img-element -- individual layers are authenticated SVG previews. */
"use client";
import * as React from "react";
import { Button } from "@/src/components/ui";
import type { SlideContent } from "@/src/lib/pitch/contracts/content";
import { boxFits, normalizedRotation, rotateVector } from "@/src/lib/pitch/contracts/scene-geometry";
import type { SlideScene, SceneElement } from "@/src/lib/pitch/contracts/scene";
import { canMoveObject, canScaleObject, constrainedScale, constrainGroupDelta, objectId, objectOverlap, objectRotation, sceneLayerEntries, sceneObjectGroups, textAnchors, validObjectOrder, type ObjectMove, type ObjectText, type ObjectGroup } from "@/src/lib/pitch/workspace/object-layout";
import type { Call } from "./client";
import styles from "./workspace.module.css";

type Layer = { id: string | null; url: string };
type Position = Pick<ObjectMove, "x" | "y" | "scale" | "rotation" | "allowOverlap">;
type Changes = { moves: ObjectMove[]; texts: ObjectText[]; order?: string[]; groups?: ObjectGroup[] };
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

export function ObjectCanvas({ call, projectId, slideId, scene, content, allowParagraphs, pendingMoves, pendingTexts, pendingOrder, pendingGroups, onApply, onClose }: {
  call: Call;
  projectId: string;
  slideId: string;
  scene: SlideScene;
  content: SlideContent;
  allowParagraphs: boolean;
  pendingMoves?: ObjectMove[];
  pendingTexts?: ObjectText[];
  pendingOrder?: string[];
  pendingGroups?: ObjectGroup[];
  onApply: (changes: Changes) => void;
  onClose: () => void;
}) {
  const [layers, setLayers] = React.useState<Layer[]>([]);
  const [error, setError] = React.useState("");
  const [boundsMessage, setBoundsMessage] = React.useState("");
  const [angleInput, setAngleInput] = React.useState<{ id: string; value: string } | null>(null);
  const [selected, setSelected] = React.useState<string | null>(null);
  const [marked, setMarked] = React.useState<string[]>([]);
  const [history, dispatch] = React.useReducer(editHistory, {
    past: [], present: { moves: pendingMoves ?? [], texts: pendingTexts ?? [], order: pendingOrder, groups: pendingGroups }, future: [],
  });
  const { moves, texts, order, groups: groupPatch } = history.present;
  const [typing, setTyping] = React.useState<{ id: string; value: string } | null>(null);
  const [dragMoves, setDragMoves] = React.useState<ObjectMove[]>([]);
  const board = React.useRef<HTMLDivElement | null>(null);
  const drag = React.useRef<{ id: string; pointer: number; startX: number; startY: number; origin: Position; members?: ObjectMove[]; rect: DOMRect; resizing?: boolean } | null>(null);
  const sceneKey = JSON.stringify(scene);
  const entries = React.useMemo(() => scene.elements.map((element, i) => ({ element, id: objectId(element, i) })), [scene]);
  const originalOrder = entries.filter(entry => canMoveObject(entry.element)).map(entry => entry.id);
  const validOrder = !order || validObjectOrder(originalOrder, order);
  const orderedEntries = validOrder ? sceneLayerEntries(entries, order) : entries;
  const originalGroups = React.useMemo(() => sceneObjectGroups(entries), [entries]);
  const groups = groupPatch ?? originalGroups;
  const memberGroups = React.useMemo(() => new Map(groups.flatMap(group =>
    group.memberIds.map(id => [id, group] as const))), [groups]);
  const groupFor = (id: string) => memberGroups.get(id);
  const selectedGroup = selected ? groupFor(selected) : undefined;
  const currentOrder = validOrder && order ? order : originalOrder;
  const layerById = React.useMemo(() => new Map(layers.map(layer => [layer.id, layer])), [layers]);
  const anchors = React.useMemo(() => textAnchors(scene, content, allowParagraphs), [scene, content, allowParagraphs]);
  const canonicalText = (id: string) => {
    const anchor = anchors.get(id);
    if (anchor?.kind === "title") return content.title;
    const block = anchor?.kind === "paragraph" ? content.blocks[anchor.block] : undefined;
    return block?.kind === "paragraph" ? block.text : "";
  };
  const hasChanges = !!(moves.length || texts.length || order || groupPatch);
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

  function position(id: string, fallback: SceneElement): Position {
    const local = dragMoves.find(move => move.id === id) ?? moves.find(move => move.id === id);
    return { x: fallback.x, y: fallback.y, rotation: objectRotation(fallback), allowOverlap: objectOverlap(fallback), ...local };
  }
  function placeBatch(updates: ObjectMove[]) {
    if (!updates.length) return;
    setBoundsMessage("");
    dispatch({ type: "record", update: previous => {
      const targets = new Set(updates.map(update => update.id));
      const rest = previous.moves.filter(move => !targets.has(move.id));
      const changed = updates.flatMap(next => {
        const entry = entries.find(value => value.id === next.id);
        if (!entry) return [];
        const { x, y, scale } = next;
        const angleChanged = next.rotation !== undefined && next.rotation !== objectRotation(entry.element);
        const overlapChanged = next.allowOverlap !== undefined && next.allowOverlap !== objectOverlap(entry.element);
        return x === entry.element.x && y === entry.element.y && (scale ?? 1) === 1 && !angleChanged && !overlapChanged
          ? [] : [{ id: next.id, x, y, ...(scale !== undefined && scale !== 1 ? { scale } : {}),
            ...(angleChanged ? { rotation: next.rotation } : {}), ...(overlapChanged ? { allowOverlap: next.allowOverlap } : {}) }];
      });
      return { ...previous, moves: [...rest, ...changed] };
    } });
  }
  function place(id: string, next: Position) { placeBatch([{ id, ...next }]); }
  function moveOrigins(id: string): ObjectMove[] {
    return (groupFor(id)?.memberIds ?? [id]).flatMap(id => {
      const entry = entries.find(item => item.id === id);
      return entry ? [{ id, ...position(id, entry.element) }] : [];
    });
  }
  function translate(members: ObjectMove[], dx: number, dy: number): ObjectMove[] {
    const boxes = members.flatMap(member => {
      const element = entries.find(item => item.id === member.id)?.element;
      if (!element) return [];
      return [{ ...member, w: element.w * (member.scale ?? 1), h: element.h * (member.scale ?? 1) }];
    });
    if (boxes.length !== members.length || !boxes.length) return [];
    const delta = constrainGroupDelta(scene, boxes, dx, dy);
    return members.map(member => ({ ...member, x: Math.max(0, member.x + delta.x), y: Math.max(0, member.y + delta.y) }));
  }
  function createGroup() {
    if (marked.length < 2 || marked.length > 100 || marked.some(id => !originalOrder.includes(id) || groupFor(id))) return;
    const group = { id: crypto.randomUUID(), memberIds: [...marked] };
    dispatch({ type: "record", update: previous => ({ ...previous, groups: [...(previous.groups ?? originalGroups), group] }) });
    setSelected(marked[0]);
    setMarked([]);
  }
  function removeGroup(id: string) {
    dispatch({ type: "record", update: previous => ({
      ...previous, groups: (previous.groups ?? originalGroups).filter(group => group.id !== id),
    }) });
  }

  function resizeFrom(at: Position, element: Pick<SlideScene["elements"][number], "w" | "h">, scale: number) {
    return { x: at.x, y: at.y, rotation: at.rotation, allowOverlap: at.allowOverlap, scale: constrainedScale(scene, element, at, scale, at.rotation) };
  }
  function changeRotation(id: string, element: SceneElement, angle: number) {
    const at = position(id, element), rotation = normalizedRotation(angle), scale = at.scale ?? 1;
    if (!boxFits(scene, { ...at, w: element.w * scale, h: element.h * scale, rotation })) {
      setBoundsMessage("旋转后会超出页面。请先移动或缩小对象。");
      return;
    }
    place(id, { ...at, rotation });
  }
  function changeLayer(id: string, delta: -1 | 1) {
    dispatch({ type: "record", update: previous => {
      const order = [...(previous.order && validObjectOrder(originalOrder, previous.order) ? previous.order : originalOrder)];
      const from = order.indexOf(id), to = from + delta;
      if (from < 0 || to < 0 || to >= order.length) return previous;
      [order[from], order[to]] = [order[to], order[from]];
      return { ...previous, order: order.every((item, index) => item === originalOrder[index]) ? undefined : order };
    } });
  }
  const layerName = (id: string, element: SceneElement) => element.kind === "text"
    ? (texts.find(change => change.id === id)?.text ?? element.text).slice(0, 55)
    : element.kind === "image" ? element.alt || "图片"
    : ({ chart: "图表", table: "表格", shape: "形状", map: "地图", brand: "品牌标识", line: "版式线条" } as Record<string,string>)[element.kind] ?? "对象";
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
  const resizeCorner = picked ? rotateVector(picked.element.w * pickedScale / 2, picked.element.h * pickedScale / 2, pickedPosition?.rotation ?? 0) : null;
  function draggedScale(event: React.PointerEvent<HTMLButtonElement>, element: SlideScene["elements"][number]) {
    const start = drag.current;
    if (!start || !start.resizing || start.pointer !== event.pointerId || !start.rect.width || !start.rect.height)
      return null;
    const dx = element.w / scene.width * start.rect.width;
    const dy = element.h / scene.height * start.rect.height;
    const axis = rotateVector(dx, dy, start.origin.rotation ?? 0);
    const delta = ((event.clientX - start.startX) * axis.x + (event.clientY - start.startY) * axis.y) / (dx * dx + dy * dy);
    return resizeFrom(start.origin, element, (start.origin.scale ?? 1) + delta);
  }
  return (
    <section className={styles.objectEditor} aria-label="画布对象编辑" onKeyDown={event => {
      if (typing || event.target instanceof HTMLInputElement || event.nativeEvent.isComposing || !(event.metaKey || event.ctrlKey) ||
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
        <Button disabled={!!error || !layers.length || !hasChanges || !!typing || !validOrder}
          onClick={() => onApply(history.present)}>{texts.length || order || groupPatch ? "应用到页面" : "应用位置"}</Button>
      </div>
      {error && <p role="alert">{error}</p>}
      {!validOrder && <p role="alert">图层已变化，请丢弃未应用的调整后重试。</p>}
      {boundsMessage && <p role="status">{boundsMessage}</p>}
      {!layers.length && !error && <p role="status">正在读取页面对象…</p>}
      {layers.length > 0 && <div ref={board} className={styles.objectBoard}>
        {[{ id: null, element: undefined }, ...orderedEntries].map(({ id, element }) => {
          const layer = layerById.get(id);
          if (!layer) return null;
          const p = layer.id && element ? position(layer.id, element) : null;
          const text = layer.id ? texts.find(change => change.id === layer.id)?.text : undefined;
          if (layer.id && element?.kind === "text" && p && (text || typing?.id === layer.id)) {
            if (typing?.id === layer.id) return null;
            return <div key={layer.id} className={styles.objectTextPreview} data-title={element.role === "title"}
              style={{ left: `${p.x / scene.width * 100}%`, top: `${p.y / scene.height * 100}%`,
                width: `${element.w / scene.width * 100}%`, height: `${element.h / scene.height * 100}%` }}>{text}</div>;
          }
          const scale = p?.scale ?? 1;
          const fraction = (x: number, y: number) => `${x / scene.width * 100}%, ${y / scene.height * 100}%`;
          const transform = p && element
            ? `translate(${fraction(p.x + element.w * scale / 2, p.y + element.h * scale / 2)}) rotate(${(p.rotation ?? 0) - objectRotation(element)}deg) scale(${scale}) translate(${fraction(-element.x - element.w / 2, -element.y - element.h / 2)})`
            : undefined;
          return <img key={layer.id ?? "background"} draggable={false} alt="" src={layer.url}
            style={transform ? { transformOrigin: "0 0", transform } : undefined} />;
        })}
        {orderedEntries.filter(({ element }) => canMoveObject(element)).map(({ id, element }, index) => {
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
          const label = layerName(id, element);
          return <button
            key={id} type="button" aria-label={`对象 ${index + 1}：${label}`} aria-pressed={selected === id}
            className={styles.objectTarget}
            data-group-member={selectedGroup?.memberIds.includes(id) || undefined}
            data-canvas-id={id} style={{ ...bounds, transform: p.rotation ? `rotate(${p.rotation}deg)` : undefined }}
            onDoubleClick={() => startTyping(id)}
            onClick={() => setSelected(id)}
            onFocus={() => setSelected(id)}
            onPointerDown={event => {
              if (event.button !== 0 || drag.current || !board.current) return;
              setSelected(id);
              if (typeof event.currentTarget.setPointerCapture !== "function") return;
              drag.current = { id, pointer: event.pointerId, startX: event.clientX, startY: event.clientY, origin: p, members: moveOrigins(id), rect: board.current.getBoundingClientRect() };
              event.currentTarget.setPointerCapture(event.pointerId);
            }}
            onPointerMove={event => {
              const start = drag.current;
              if (!start || start.pointer !== event.pointerId || !start.rect.width || !start.rect.height) return;
              setDragMoves(translate(start.members ?? [],
                (event.clientX - start.startX) / start.rect.width * scene.width,
                (event.clientY - start.startY) / start.rect.height * scene.height));
            }}
            onPointerUp={event => {
              const start = drag.current;
              if (!start || start.pointer !== event.pointerId) return;
              const dx = event.clientX - start.startX, dy = event.clientY - start.startY;
              if (Math.hypot(dx, dy) >= 2 && start.rect.width && start.rect.height) {
                placeBatch(translate(start.members ?? [], dx / start.rect.width * scene.width, dy / start.rect.height * scene.height));
              }
              drag.current = null;
              setDragMoves([]);
            }}
            onLostPointerCapture={() => { drag.current = null; setDragMoves([]); }}
            onPointerCancel={() => { drag.current = null; setDragMoves([]); }}
            onKeyDown={event => {
              if (event.key === "F2" && anchors.has(id)) { event.preventDefault(); startTyping(id); return; }
              const offsets: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
              const d = offsets[event.key];
              if (!d) return;
              event.preventDefault();
              const step = event.shiftKey ? .25 : .05;
              placeBatch(translate(moveOrigins(id), d[0] * step, d[1] * step));
            }}
          />;
        })}
        {picked && pickedPosition && resizeCorner && !typing && canScaleObject(picked.element) && (
          <button type="button" aria-label="缩放所选对象"
            className={styles.objectResize}
            style={{
              left: `${(pickedPosition.x + picked.element.w * pickedScale / 2 + resizeCorner.x) / scene.width * 100}%`,
              top: `${(pickedPosition.y + picked.element.h * pickedScale / 2 + resizeCorner.y) / scene.height * 100}%`,
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
              if (next) setDragMoves([{ id: picked.id, ...next }]);
            }}
            onPointerUp={event => {
              const next = draggedScale(event, picked.element);
              if (!next) return;
              place(picked.id, next);
              drag.current = null;
              setDragMoves([]);
            }}
            onLostPointerCapture={() => { drag.current = null; setDragMoves([]); }}
            onPointerCancel={() => { drag.current = null; setDragMoves([]); }}
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
      {layers.length > 0 && <details className={styles.layerPanel}>
        <summary>图层（从上到下）</summary>
        <ol>
          {[...orderedEntries].reverse().map(({ id, element }) => (
            <li key={id}>
              {canMoveObject(element)
                ? <div className={styles.layerRow}>
                    {!groupFor(id) && <input type="checkbox" aria-label={`选入组合：${layerName(id, element)}`}
                      checked={marked.includes(id)}
                      onChange={event => setMarked(previous => event.target.checked ? [...previous, id] : previous.filter(item => item !== id))} />}
                    <button type="button" aria-pressed={selected === id}
                      onClick={() => setSelected(id)}>{layerName(id, element)}{groupFor(id) && " · 已组合"}</button>
                  </div>
                : <span>{element.kind === "text" && element.purpose
                    ? (element.purpose === "source" ? "来源" : "页脚") : layerName(id, element)}（受保护）</span>}
            </li>
          ))}
        </ol>
        <div className={styles.objectTools}>
          <Button variant="ghost" disabled={!selected || !!typing || currentOrder.indexOf(selected) < 0 || currentOrder.indexOf(selected) >= currentOrder.length - 1}
            onClick={() => selected && changeLayer(selected, 1)}>上移一层</Button>
          <Button variant="ghost" disabled={!selected || !!typing || currentOrder.indexOf(selected) <= 0}
            onClick={() => selected && changeLayer(selected, -1)}>下移一层</Button>
          <Button variant="ghost" disabled={!!typing || marked.length < 2 || marked.length > 100} onClick={createGroup}>组合所选对象</Button>
          <Button variant="ghost" disabled={!!typing || !selectedGroup}
            onClick={() => selectedGroup && removeGroup(selectedGroup.id)}>取消所选组合</Button>
        </div>
      </details>}
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
          <Button variant="ghost" onClick={() => changeRotation(
            picked.id, picked.element, (position(picked.id, picked.element).rotation ?? 0) - 15,
          )}>左转 15°</Button>
          <Button variant="ghost" onClick={() => changeRotation(
            picked.id, picked.element, (position(picked.id, picked.element).rotation ?? 0) + 15,
          )}>右转 15°</Button>
          <Button variant="ghost" disabled={!position(picked.id, picked.element).rotation}
            onClick={() => changeRotation(picked.id, picked.element, 0)}>角度归零</Button>
          <label className={styles.rotationField}>
            旋转角度
            <input type="number" min={-180} max={180} step={1}
              value={angleInput?.id === picked.id ? angleInput.value : position(picked.id, picked.element).rotation ?? 0}
              onChange={event => setAngleInput({ id: picked.id, value: event.target.value })}
              onBlur={() => {
                if (angleInput?.id !== picked.id) return;
                const angle = Number(angleInput.value);
                if (angleInput.value.trim() && Number.isInteger(angle) && angle >= -180 && angle <= 180)
                  changeRotation(picked.id, picked.element, angle);
                else setBoundsMessage("请输入 -180° 到 180° 之间的整数。");
                setAngleInput(null);
              }}
              onKeyDown={event => {
                if (event.key === "Enter") { event.preventDefault(); event.currentTarget.blur(); }
              }}
            />
          </label>
          <output aria-label="所选对象角度">{position(picked.id, picked.element).rotation ?? 0}°</output>
          <label className={styles.overlapField}>
            <input type="checkbox" checked={position(picked.id, picked.element).allowOverlap ?? false}
              onChange={event => place(picked.id, { ...position(picked.id, picked.element), allowOverlap: event.target.checked })} />
            允许与其他已开启的图片或形状叠放
          </label>
        </div>
      )}
      {picked && <output aria-live="polite" className={styles.objectPosition}>
        横向 {position(picked.id, picked.element).x.toFixed(2)} 英寸 · 纵向 {position(picked.id, picked.element).y.toFixed(2)} 英寸
      </output>}
    </section>
  );
}
