/* eslint-disable @next/next/no-img-element -- individual layers are authenticated SVG previews. */
"use client";
import * as React from "react";
import { Button } from "@/src/components/ui";
import type { SlideContent } from "@/src/lib/pitch/contracts/content";
import { boxFits, normalizedRotation, rotateVector, visualBounds, type SceneBox } from "@/src/lib/pitch/contracts/scene-geometry";
import type { SlideScene, SceneElement } from "@/src/lib/pitch/contracts/scene";
import { canMoveObject, canScaleObject, constrainedScale, constrainGroupDelta, objectId, objectOverlap, objectRotation, sceneLayerEntries, sceneObjectGroups, textAnchors, validObjectOrder, type ObjectMove, type ObjectText, type ObjectGroup } from "@/src/lib/pitch/workspace/object-layout";
import type { Call } from "./client";
import styles from "./workspace.module.css";

type Layer = { id: string | null; url: string };
type Position = Pick<ObjectMove, "x" | "y" | "scale" | "rotation" | "allowOverlap">;
type Axis = "x" | "y";
type DragPreview = { moves: ObjectMove[]; guideX?: number; guideY?: number };
type Drag = {
  id: string; pointer: number; startX: number; startY: number; origin: Position;
  members?: ObjectMove[]; rect: DOMRect; resizing?: boolean;
};
const emptyDrag: DragPreview = { moves: [] };
const alignmentModes = [
  { id: "left", label: "左对齐", axis: "x", edge: 0 },
  { id: "center", label: "水平居中", axis: "x", edge: 1 },
  { id: "right", label: "右对齐", axis: "x", edge: 2 },
  { id: "top", label: "顶端对齐", axis: "y", edge: 0 },
  { id: "middle", label: "垂直居中", axis: "y", edge: 1 },
  { id: "bottom", label: "底端对齐", axis: "y", edge: 2 },
] as const;

function alignmentPoints(box: SceneBox, axis: Axis) {
  const start = box[axis], extent = axis === "x" ? box.w : box.h;
  return [start, start + extent / 2, start + extent] as const;
}

function enclosingBox(boxes: SceneBox[]): SceneBox {
  const x = Math.min(...boxes.map(box => box.x)), y = Math.min(...boxes.map(box => box.y));
  return { x, y, w: Math.max(...boxes.map(box => box.x + box.w)) - x,
    h: Math.max(...boxes.map(box => box.y + box.h)) - y };
}

function nearestGuide(box: SceneBox, references: SceneBox[], axis: Axis, limit: number, tolerance: number) {
  const targets = [0, limit / 2, limit, ...references.flatMap(reference => alignmentPoints(reference, axis))];
  let best: { target: number; offset: number } | undefined;
  for (const anchor of alignmentPoints(box, axis)) {
    for (const target of targets) {
      const offset = target - anchor;
      if (Math.abs(offset) <= tolerance && (!best || Math.abs(offset) < Math.abs(best.offset)))
        best = { target, offset };
    }
  }
  return best;
}
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

export function ObjectCanvas({ call, projectId, slideId, scene, content, allowParagraphs, lockedParagraphs, pendingMoves, pendingTexts, pendingOrder, pendingGroups, onSelectionChange, imageReplacement, photoReplacement, materialSource, onApply, onClose }: {
  call: Call;
  projectId: string;
  slideId: string;
  scene: SlideScene;
  content: SlideContent;
  allowParagraphs: boolean;
  lockedParagraphs?: ReadonlySet<number>;
  pendingMoves?: ObjectMove[];
  pendingTexts?: ObjectText[];
  pendingOrder?: string[];
  pendingGroups?: ObjectGroup[];
  onSelectionChange?: (selection: { ids: string[]; dirty: boolean }) => void;
  imageReplacement?: { identify: (id: string) => number | undefined; open: (index: number) => void };
  photoReplacement?: { canOpen: (id: string) => boolean; open: (id: string) => void };
  materialSource?: { canOpen: (element: SceneElement) => boolean; open: (element: SceneElement) => void };
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
  const [dragPreview, setDragPreview] = React.useState<DragPreview>(emptyDrag);
  const board = React.useRef<HTMLDivElement | null>(null);
  const drag = React.useRef<Drag | null>(null);
  const sceneKey = JSON.stringify(scene);
  const entries = React.useMemo(() => scene.elements.map((element, i) => ({ element, id: objectId(element, i) })), [scene]);
  const entryById = React.useMemo(() => new Map(entries.map(entry => [entry.id, entry])), [entries]);
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
  const anchors = React.useMemo(() => {
    const editable = textAnchors(scene, content, allowParagraphs);
    if (lockedParagraphs?.size) {
      for (const [id, anchor] of editable) {
        if (anchor.kind === "paragraph" && lockedParagraphs.has(anchor.block)) editable.delete(id);
      }
    }
    return editable;
  }, [scene, content, allowParagraphs, lockedParagraphs]);
  const canonicalText = (id: string) => {
    const anchor = anchors.get(id);
    if (anchor?.kind === "title") return content.title;
    const block = anchor?.kind === "paragraph" ? content.blocks[anchor.block] : undefined;
    return block?.kind === "paragraph" ? block.text : "";
  };
  const hasChanges = !!(moves.length || texts.length || order || groupPatch);
  const localEdits = hasChanges || !!typing;
  React.useEffect(() => {
    onSelectionChange?.({ ids: marked.length ? marked : selected ? [selected] : [], dirty: localEdits });
  }, [localEdits, marked, onSelectionChange, selected]);
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
    const local = dragPreview.moves.find(move => move.id === id) ?? moves.find(move => move.id === id);
    return { x: fallback.x, y: fallback.y, rotation: objectRotation(fallback), allowOverlap: objectOverlap(fallback), ...local };
  }
  function placeBatch(updates: ObjectMove[]) {
    if (!updates.length) return;
    setBoundsMessage("");
    dispatch({ type: "record", update: previous => {
      const targets = new Set(updates.map(update => update.id));
      const rest = previous.moves.filter(move => !targets.has(move.id));
      const changed = updates.flatMap(next => {
        const entry = entryById.get(next.id);
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
      const entry = entryById.get(id);
      return entry ? [{ id, ...position(id, entry.element) }] : [];
    });
  }
  function objectBox(at: Position, element: SceneElement) {
    return { ...at, w: element.w * (at.scale ?? 1), h: element.h * (at.scale ?? 1) };
  }
  function moveBoxes(members: ObjectMove[]) {
    return members.flatMap(member => {
      const element = entryById.get(member.id)?.element;
      return element ? [objectBox(member, element)] : [];
    });
  }
  function translate(members: ObjectMove[], dx: number, dy: number): ObjectMove[] {
    const boxes = moveBoxes(members);
    if (boxes.length !== members.length || !boxes.length) return [];
    const delta = constrainGroupDelta(scene, boxes, dx, dy);
    return members.map(member => ({ ...member, x: Math.max(0, member.x + delta.x), y: Math.max(0, member.y + delta.y) }));
  }
  function dragObjects(start: Drag, event: React.PointerEvent<HTMLButtonElement>): DragPreview {
    const { width, height } = start.rect;
    const members = start.members ?? [];
    const dx = event.clientX - start.startX, dy = event.clientY - start.startY;
    if (!width || !height || Math.hypot(dx, dy) < 2) return emptyDrag;
    const proposed = translate(members, dx * scene.width / width, dy * scene.height / height);
    if (!proposed.length) return emptyDrag;

    const moving = new Set(members.map(member => member.id));
    const bounds = enclosingBox(moveBoxes(proposed).map(visualBounds));
    const references = entries.flatMap(({ id, element }) => moving.has(id) || !canMoveObject(element)
      ? [] : [visualBounds(objectBox(position(id, element), element))]);
    // Use screen pixels so the guide feels the same at different zoom levels.
    const x = nearestGuide(bounds, references, "x", scene.width, 5 * scene.width / width);
    const y = nearestGuide(bounds, references, "y", scene.height, 5 * scene.height / height);
    if (!x && !y) return { moves: proposed };
    const dxSnapped = proposed[0].x - members[0].x + (x?.offset ?? 0);
    const dySnapped = proposed[0].y - members[0].y + (y?.offset ?? 0);
    const moves = translate(members, dxSnapped, dySnapped);
    return {
      moves,
      guideX: x && Math.abs(moves[0].x - proposed[0].x - x.offset) < .0001 ? x.target : undefined,
      guideY: y && Math.abs(moves[0].y - proposed[0].y - y.offset) < .0001 ? y.target : undefined,
    };
  }

  function endDrag(event: React.PointerEvent<HTMLButtonElement>) {
    if (drag.current?.pointer !== event.pointerId) return;
    drag.current = null;
    setDragPreview(emptyDrag);
  }

  const arrangeable = marked.filter(id => originalOrder.includes(id) && !groupFor(id));
  function arrangementSelection() {
    return arrangeable.flatMap(id => {
      const element = entryById.get(id)?.element;
      if (!element) return [];
      const at = position(id, element), box = objectBox(at, element);
      return [{ id, at, box, visual: visualBounds(box) }];
    });
  }
  function align({ axis, edge }: (typeof alignmentModes)[number]) {
    const picks = arrangementSelection();
    if (picks.length < 2) return;
    const target = alignmentPoints(enclosingBox(picks.map(item => item.visual)), axis)[edge];
    const updates = picks.map(({ id, at, visual }) => {
      const offset = target - alignmentPoints(visual, axis)[edge];
      return { id, ...at, [axis]: Math.abs(offset) < .0001 ? at[axis] : Math.round((at[axis] + offset) * 1e4) / 1e4 };
    });
    if (picks.some(({ box }, index) => !boxFits(scene, { ...box, ...updates[index] }))) {
      setBoundsMessage("对齐后会有对象超出页面。请先调整对象位置。");
      return;
    }
    placeBatch(updates);
  }

  function distribute(axis: Axis) {
    const size = axis === "x" ? "w" : "h";
    const picks = arrangementSelection().sort((first, second) => first.visual[axis] - second.visual[axis]);
    if (picks.length < 3) return;
    const start = picks[0].visual[axis];
    const last = picks[picks.length - 1].visual;
    const occupied = picks.reduce((sum, entry) => sum + entry.visual[size], 0);
    const gap = (last[axis] + last[size] - start - occupied) / (picks.length - 1);
    if (gap < 0) {
      setBoundsMessage("对象之间没有足够的间距。请拉开两端后再分布。");
      return;
    }
    let target = start;
    const updates = picks.map(({ id, at, visual }) => {
      const next = { id, ...at, [axis]: at[axis] + target - visual[axis] };
      target += visual[size] + gap;
      return next;
    });
    if (picks.some(({ box }, index) => !boxFits(scene, { ...box, ...updates[index] }))) {
      setBoundsMessage("分布后会有对象超出页面。请先调整对象位置。");
      return;
    }
    placeBatch(updates.slice(1, -1));
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
  const imageIndex = picked && !localEdits ? imageReplacement?.identify(picked.id) : undefined;
  const canReplacePhoto = picked && !localEdits && marked.length <= 1 && photoReplacement?.canOpen(picked.id);
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
            key={id} type="button" aria-label={`对象 ${index + 1}：${label}`} aria-pressed={selected === id || marked.includes(id)}
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
              if (start?.id === id && start.pointer === event.pointerId && !start.resizing) setDragPreview(dragObjects(start, event));
            }}
            onPointerUp={event => {
              const start = drag.current;
              if (start?.id !== id || start.pointer !== event.pointerId || start.resizing) return;
              placeBatch(dragObjects(start, event).moves);
              endDrag(event);
            }}
            onLostPointerCapture={endDrag}
            onPointerCancel={endDrag}
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
        {dragPreview.guideX !== undefined && <span className={styles.objectGuide} aria-hidden="true" data-axis="x" style={{ left: `${dragPreview.guideX / scene.width * 100}%` }} />}
        {dragPreview.guideY !== undefined && <span className={styles.objectGuide} aria-hidden="true" data-axis="y" style={{ top: `${dragPreview.guideY / scene.height * 100}%` }} />}
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
              if (next) setDragPreview({ moves: [{ id: picked.id, ...next }] });
            }}
            onPointerUp={event => {
              const next = draggedScale(event, picked.element);
              if (!next) return;
              place(picked.id, next);
              endDrag(event);
            }}
            onLostPointerCapture={endDrag}
            onPointerCancel={endDrag}
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
                    {!groupFor(id) && <input type="checkbox" aria-label={`多选对象：${layerName(id, element)}`}
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
          {arrangeable.length >= 2 && <select aria-label="对齐所选对象" value="" disabled={!!typing || !!dragPreview.moves.length}
            onChange={event => {
              const mode = alignmentModes.find(item => item.id === event.currentTarget.value);
              if (mode) align(mode);
            }}>
            <option value="">对齐所选对象</option>
            {alignmentModes.map(({ id, label }) => <option value={id} key={id}>{label}</option>)}
          </select>}
          {arrangeable.length >= 3 && <>
            <Button variant="ghost" disabled={!!typing} onClick={() => distribute("x")}>水平等距分布</Button>
            <Button variant="ghost" disabled={!!typing} onClick={() => distribute("y")}>垂直等距分布</Button>
          </>}
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
          {imageIndex !== undefined && imageReplacement &&
            <Button variant="secondary" onClick={() => imageReplacement.open(imageIndex)}>更换所选图片</Button>}
          {canReplacePhoto && photoReplacement &&
            <Button variant="secondary" onClick={() => photoReplacement.open(picked.id)}>更换楼宇照片</Button>}
          {materialSource?.canOpen(picked.element) && marked.length <= 1 &&
            <Button variant="ghost" onClick={() => materialSource.open(picked.element)}>查看素材来源</Button>}
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
