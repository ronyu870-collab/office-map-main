import { z } from "zod";
import { boxFits, visualBounds } from "../contracts/scene-geometry";
import { slideSceneSchema, type SceneElement, type SlideScene } from "../contracts/scene";

const objectKeySchema = z.string().regex(/^object-[0-9]{1,3}$/);
export const objectOrderSchema = z.array(objectKeySchema).min(2).max(150);
export const objectMoveSchema = z.strictObject({
  id: objectKeySchema,
  x: z.number().min(0).max(13.334),
  y: z.number().min(0).max(7.5),
  scale: z.number().min(.1).max(4).optional(),
  rotation: z.number().int().min(-180).max(179).optional(),
  allowOverlap: z.boolean().optional(),
});
export type ObjectMove = z.infer<typeof objectMoveSchema>;

export const canMoveObject = (element: SceneElement) =>
  (element.kind === "text" && (!element.purpose || element.purpose === "content")) ||
  (element.kind === "shape" && !element.background) ||
  ["image", "table", "chart", "map"].includes(element.kind);

export const canScaleObject = (element: SceneElement) =>
  element.kind === "image" || (element.kind === "shape" && !element.background);

export const objectOverlap = (element: SceneElement) =>
  (element.kind === "image" || element.kind === "shape") && element.allowOverlap === true;

export const objectRotation = (element: SceneElement) =>
  element.kind === "image" || element.kind === "shape" ? element.rotation ?? 0 : 0;

export function constrainedScale(
  scene: Pick<SlideScene, "width" | "height">,
  element: Pick<SceneElement, "w" | "h">,
  at: Pick<ObjectMove, "x" | "y">,
  scale: number,
  rotation = 0,
) {
  const box = visualBounds({ ...element, x: 0, y: 0, rotation });
  const max = Math.min(4, (scene.width - at.x) / Math.max(element.w, box.x + box.w),
    (scene.height - at.y) / Math.max(element.h, box.y + box.h),
    box.x < 0 ? at.x / -box.x : Infinity, box.y < 0 ? at.y / -box.y : Infinity);
  return Math.max(.1, Math.min(max, Math.round(scale * 10000) / 10000));
}

export const objectId = (element: SceneElement, index: number) =>
  element.editorId ?? `object-${index + 1}`;

export function constrainedPosition(
  scene: Pick<SlideScene, "width" | "height">,
  element: Pick<SceneElement, "w" | "h">,
  x: number,
  y: number,
  rotation = 0,
) {
  const box = visualBounds({ ...element, x: 0, y: 0, rotation });
  const coordinate = (value: number, floor: number, ceiling: number) =>
    Math.min(ceiling, Math.max(floor, Math.round(value * 10000) / 10000));
  return {
    x: coordinate(x, Math.max(0, -box.x), scene.width - Math.max(element.w, box.x + box.w)),
    y: coordinate(y, Math.max(0, -box.y), scene.height - Math.max(element.h, box.y + box.h)),
  };
}

/** The browser submits coordinates, never an arbitrary scene or replacement content. */
export function applyObjectMoves(scene: SlideScene, value: ObjectMove[]): SlideScene {
  const moves = z.array(objectMoveSchema).min(1).max(100).parse(value);
  const pending = new Map(moves.map(move => [move.id, move]));
  if (pending.size !== moves.length || scene.rendererVersion !== "pitch-scene/2")
    throw new Error("PITCH_OBJECT_LAYOUT_INVALID");
  const elements = scene.elements.map((element, index) => {
    const id = objectId(element, index);
    const move = pending.get(id);
    if (!canMoveObject(element)) {
      if (move) throw new Error("PITCH_OBJECT_LAYOUT_INVALID");
      return element;
    }
    if (!move) return { ...element, editorId: id };
    if ((move.scale !== undefined || move.rotation !== undefined || move.allowOverlap !== undefined) && !canScaleObject(element)) throw new Error("PITCH_OBJECT_LAYOUT_INVALID");
    const w = element.w * (move.scale ?? 1), h = element.h * (move.scale ?? 1);
    const rotated = { x: move.x, y: move.y, w, h, rotation: move.rotation ?? objectRotation(element) };
    if (!boxFits(scene, rotated))
      throw new Error("PITCH_OBJECT_LAYOUT_INVALID");
    pending.delete(id);
    return {
      ...element, editorId: id, x: move.x, y: move.y, w, h,
      ...(move.rotation !== undefined ? { rotation: move.rotation } : {}),
      ...(move.allowOverlap !== undefined ? { allowOverlap: move.allowOverlap } : {}),
    };
  });
  if (pending.size) throw new Error("PITCH_OBJECT_LAYOUT_INVALID");
  return slideSceneSchema.parse({ ...scene, elements });
}

export function validObjectOrder(originalOrder: string[], next: string[]) {
  const ids = new Set(originalOrder);
  return originalOrder.length === next.length && new Set(next).size === next.length && next.every(id => ids.has(id));
}

export function sceneLayerEntries<T extends { element: SceneElement; id: string }>(entries: T[], order?: string[]): T[] {
  if (!order) return entries;
  const editable = new Map(entries.filter(entry => canMoveObject(entry.element)).map(entry => [entry.id, entry]));
  if (!validObjectOrder([...editable.keys()], order))
    throw new Error("PITCH_OBJECT_ORDER_INVALID");
  let i = 0;
  return entries.map(entry => canMoveObject(entry.element) ? editable.get(order[i++])! : entry);
}

export function applyObjectOrder(scene: SlideScene, value: string[]): SlideScene {
  const order = objectOrderSchema.parse(value);
  if (scene.rendererVersion !== "pitch-scene/2") throw new Error("PITCH_OBJECT_ORDER_INVALID");
  const entries = scene.elements.map((element, index) => ({ element, id: objectId(element, index) }));
  return slideSceneSchema.parse({
    ...scene,
    elements: sceneLayerEntries(entries, order).map(({ element, id }) =>
      canMoveObject(element) ? { ...element, editorId: id } : element),
  });
}

export const objectGroupSchema = z.strictObject({
  id: z.uuid(),
  memberIds: z.array(objectKeySchema).min(2).max(100),
});
export const objectGroupsSchema = z.array(objectGroupSchema).max(75);
export type ObjectGroup = z.infer<typeof objectGroupSchema>;

export function sceneObjectGroups(entries: { id: string; element: SceneElement }[]): ObjectGroup[] {
  const groups = new Map<string, string[]>();
  for (const { id, element } of entries) {
    if (element.editorGroup) groups.set(element.editorGroup, [...(groups.get(element.editorGroup) ?? []), id]);
  }
  return [...groups].map(([id, memberIds]) => ({ id, memberIds }));
}

export function applyObjectGroups(scene: SlideScene, value: ObjectGroup[]): SlideScene {
  const groups = objectGroupsSchema.parse(value);
  const ids = new Set<string>(), membership = new Map<string, string>();
  if (scene.rendererVersion !== "pitch-scene/2") throw new Error("PITCH_OBJECT_GROUP_INVALID");
  const entries = scene.elements.map((element, index) => ({ element, id: objectId(element, index) }));
  const editable = new Set(entries.filter(entry => canMoveObject(entry.element)).map(entry => entry.id));
  for (const group of groups) {
    if (ids.has(group.id)) throw new Error("PITCH_OBJECT_GROUP_INVALID");
    ids.add(group.id);
    for (const id of group.memberIds) {
      if (!editable.has(id) || membership.has(id)) throw new Error("PITCH_OBJECT_GROUP_INVALID");
      membership.set(id, group.id);
    }
  }
  return slideSceneSchema.parse({
    ...scene,
    elements: entries.map(({ element, id }) => {
      if (!canMoveObject(element)) return element;
      const editorGroup = membership.get(id);
      return { ...element, editorId: id, editorGroup };
    }),
  });
}

export function constrainGroupDelta(
  scene: Pick<SlideScene, "width" | "height">,
  boxes: { x: number; y: number; w: number; h: number; rotation?: number }[],
  requestedX: number,
  requestedY: number,
) {
  let minX = -Infinity, minY = -Infinity, maxX = Infinity, maxY = Infinity;
  for (const base of boxes) {
    const drawn = visualBounds(base);
    minX = Math.max(minX, -Math.min(base.x, drawn.x));
    minY = Math.max(minY, -Math.min(base.y, drawn.y));
    maxX = Math.min(maxX, scene.width - Math.max(base.x + base.w, drawn.x + drawn.w));
    maxY = Math.min(maxY, scene.height - Math.max(base.y + base.h, drawn.y + drawn.h));
  }
  const fixed = (number: number) => Math.round((number + Number.EPSILON) * 10000) / 10000;
  return {
    x: Math.min(maxX, Math.max(minX, fixed(requestedX))),
    y: Math.min(maxY, Math.max(minY, fixed(requestedY))),
  };
}

export const objectTextSchema = z.strictObject({
  id: objectKeySchema,
  text: z.string().trim().min(1).max(4000),
});
export type ObjectText = z.infer<typeof objectTextSchema>;

export type TextAnchor = { kind: "title"; maxLength: 160 } | { kind: "paragraph"; block: number; maxLength: 4000 };
const matchText = (text: string) => text.replace(/\s+/gu, "");

export function textAnchors(scene: SlideScene, content: import("../contracts/content").SlideContent, allowParagraphs = true): Map<string, TextAnchor> {
  const anchors = new Map<string, TextAnchor>();
  if (scene.rendererVersion !== "pitch-scene/2" || (scene.pagination?.count ?? 1) !== 1 || content.disclosure === "restricted") return anchors;
  for (const [index, element] of scene.elements.entries()) {
    if (element.kind !== "text" || element.purpose) continue;
    const normalized = matchText(element.text), id = objectId(element, index);
    if (scene.elements.filter(candidate => candidate.kind === "text" && candidate.role === element.role &&
      !candidate.purpose && matchText(candidate.text) === normalized).length !== 1) continue;
    if (element.role === "title" && normalized === matchText(content.title)) {
      anchors.set(id, { kind: "title", maxLength: 160 });
    } else if (allowParagraphs && element.role === "body" && normalized !== matchText(content.subtitle ?? "")) {
      const blocks = content.blocks.flatMap((block, i) =>
        block.kind === "paragraph" && matchText(block.text) === normalized ? [i] : []);
      if (blocks.length === 1) anchors.set(id, { kind: "paragraph", block: blocks[0], maxLength: 4000 });
    }
  }
  return anchors;
}

export function applyObjectTexts(
  scene: SlideScene,
  content: import("../contracts/content").SlideContent,
  changes: ObjectText[],
  allowParagraphs = true,
): { scene: SlideScene; content: typeof content; changedBlocks: Set<number> } {
  const patches = z.array(objectTextSchema).min(1).max(30).parse(changes);
  const targets = textAnchors(scene, content, allowParagraphs), edits = new Map(patches.map(patch => [patch.id, patch.text]));
  if (edits.size !== patches.length) throw new Error("PITCH_OBJECT_TEXT_INVALID");
  const next = structuredClone(content), changedBlocks = new Set<number>();
  for (const [id, text] of edits) {
    const anchor = targets.get(id);
    if (!anchor || text.length > anchor.maxLength) throw new Error("PITCH_OBJECT_TEXT_INVALID");
    if (anchor.kind === "title") next.title = text;
    else {
      const block = next.blocks[anchor.block];
      if (block.kind !== "paragraph") throw new Error("PITCH_OBJECT_TEXT_INVALID");
      next.blocks[anchor.block] = { ...block, text };
      changedBlocks.add(anchor.block);
    }
  }
  return {
    content: next, changedBlocks,
    scene: slideSceneSchema.parse({ ...scene, elements: scene.elements.map((element, i) => {
      const id = objectId(element, i), text = edits.get(id);
      return element.kind === "text" && text !== undefined ? { ...element, editorId: id, text } : element;
    }) }),
  };
}
