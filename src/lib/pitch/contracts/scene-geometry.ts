export type SceneBox = { x: number; y: number; w: number; h: number };
export type OrientableBox = SceneBox & { rotation?: number };

export function rotateVector(x: number, y: number, degrees: number) {
  const radians = degrees * Math.PI / 180, cos = Math.cos(radians), sin = Math.sin(radians);
  return { x: x * cos - y * sin, y: x * sin + y * cos };
}

export function visualBounds(box: OrientableBox): SceneBox {
  if (!box.rotation) return box;
  const { x, y } = rotateVector(1, 0, box.rotation);
  const w = Math.abs(box.w * x) + Math.abs(box.h * y);
  const h = Math.abs(box.w * y) + Math.abs(box.h * x);
  return { x: box.x + (box.w - w) / 2, y: box.y + (box.h - h) / 2, w, h };
}

export function boxFits(page: { width: number; height: number }, box: OrientableBox, epsilon = .0001) {
  const visual = visualBounds(box);
  return box.x >= -epsilon && box.y >= -epsilon &&
    box.x + box.w <= page.width + epsilon && box.y + box.h <= page.height + epsilon &&
    visual.x >= -epsilon && visual.y >= -epsilon &&
    visual.x + visual.w <= page.width + epsilon && visual.y + visual.h <= page.height + epsilon;
}

export function normalizedRotation(value: number) {
  return ((Math.round(value) + 180) % 360 + 360) % 360 - 180;
}
