import { z } from "zod";
import { slideSceneSchema, type SceneElement, type SlideScene } from "../contracts/scene";

export const objectMoveSchema = z.strictObject({
  id: z.string().regex(/^object-[0-9]{1,3}$/),
  x: z.number().min(0).max(13.334),
  y: z.number().min(0).max(7.5),
  scale: z.number().min(.1).max(4).optional(),
});
export type ObjectMove = z.infer<typeof objectMoveSchema>;

export const canMoveObject = (element: SceneElement) =>
  (element.kind === "text" && (!element.purpose || element.purpose === "content")) ||
  (element.kind === "shape" && !element.background) ||
  ["image", "table", "chart", "map"].includes(element.kind);

export const canScaleObject = (element: SceneElement) =>
  element.kind === "image" || (element.kind === "shape" && !element.background);

export function constrainedScale(
  scene: Pick<SlideScene, "width" | "height">,
  element: Pick<SceneElement, "w" | "h">,
  at: Pick<ObjectMove, "x" | "y">,
  scale: number,
) {
  const max = Math.min(4, (scene.width - at.x) / element.w, (scene.height - at.y) / element.h);
  return Math.max(.1, Math.min(max, Math.round(scale * 10000) / 10000));
}

export const objectId = (element: SceneElement, index: number) =>
  element.editorId ?? `object-${index + 1}`;

export function constrainedPosition(
  scene: Pick<SlideScene, "width" | "height">,
  element: Pick<SceneElement, "w" | "h">,
  x: number,
  y: number,
) {
  const coordinate = (value: number, room: number) => Math.min(
    Math.max(0, room),
    Math.max(0, Math.round(value * 10000) / 10000),
  );
  return { x: coordinate(x, scene.width - element.w), y: coordinate(y, scene.height - element.h) };
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
    if (move.scale !== undefined && !canScaleObject(element)) throw new Error("PITCH_OBJECT_LAYOUT_INVALID");
    const w = element.w * (move.scale ?? 1), h = element.h * (move.scale ?? 1);
    if (move.x + w > scene.width + .0001 || move.y + h > scene.height + .0001)
      throw new Error("PITCH_OBJECT_LAYOUT_INVALID");
    pending.delete(id);
    return { ...element, editorId: id, x: move.x, y: move.y, w, h };
  });
  if (pending.size) throw new Error("PITCH_OBJECT_LAYOUT_INVALID");
  return slideSceneSchema.parse({ ...scene, elements });
}

export const objectTextSchema = z.strictObject({
  id: z.string().regex(/^object-[0-9]{1,3}$/),
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
