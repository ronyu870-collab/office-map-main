import { z } from "zod";
import { slideSceneSchema, type SceneElement, type SlideScene } from "../contracts/scene";

export const objectMoveSchema = z.strictObject({
  id: z.string().regex(/^object-[0-9]{1,3}$/),
  x: z.number().min(0).max(13.334),
  y: z.number().min(0).max(7.5),
});
export type ObjectMove = z.infer<typeof objectMoveSchema>;

export const canMoveObject = (element: SceneElement) =>
  (element.kind === "text" && (!element.purpose || element.purpose === "content")) ||
  (element.kind === "shape" && !element.background) ||
  ["image", "table", "chart", "map"].includes(element.kind);

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
    if (move.x + element.w > scene.width + .0001 || move.y + element.h > scene.height + .0001)
      throw new Error("PITCH_OBJECT_LAYOUT_INVALID");
    pending.delete(id);
    return { ...element, editorId: id, x: move.x, y: move.y };
  });
  if (pending.size) throw new Error("PITCH_OBJECT_LAYOUT_INVALID");
  return slideSceneSchema.parse({ ...scene, elements });
}
