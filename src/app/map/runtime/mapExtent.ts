import type { FullListBuilding } from '../model/fullBuildingList';
import { coordinateIssue } from '@/src/lib/map-coordinates';
export { coordinateIssue } from '@/src/lib/map-coordinates';

type Rect = { left: number; top: number; right: number; bottom: number; width: number; height: number };
export const mercatorPoint = (lng: number, lat: number) => [
  (lng + 180) / 360,
  (1 - Math.log(Math.tan(Math.PI / 4 + lat * Math.PI / 360)) / Math.PI) / 2,
] as const;
/** A geographic envelope, never an administrative or submarket boundary. */
export function fitMapExtent(buildings: FullListBuilding[], canvas: Rect, visible: Rect = canvas) {
  const located = buildings.filter(building => coordinateIssue(building) === null);
  if (!located.length || visible.width < 16 || visible.height < 16) return null;
  const points = located.map(building => mercatorPoint(building.location_lng!, building.location_lat!));
  const xs = points.map(point => point[0]), ys = points.map(point => point[1]);
  const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
  // Marker and name room scales with the usable canvas. Small sheets keep real
  // geographic room instead of losing it to a fixed desktop padding budget.
  const side = Math.min(96, visible.width * .16), vertical = Math.min(64, visible.height * .18);
  const width = visible.width - side * 2, height = visible.height - vertical * 2;
  const zoom = Math.max(2, Math.min(16,
    Math.log2(width / (256 * Math.max(maxX - minX, Number.EPSILON))),
    Math.log2(height / (256 * Math.max(maxY - minY, Number.EPSILON)))));
  const scale = 256 * 2 ** zoom;
  const x = (minX + maxX) / 2 - ((visible.left + visible.right - canvas.left - canvas.right) / 2) / scale;
  const y = (minY + maxY) / 2 - ((visible.top + visible.bottom - canvas.top - canvas.bottom) / 2) / scale;
  return { zoom, center: [x * 360 - 180, Math.atan(Math.sinh(Math.PI * (1 - 2 * y))) * 180 / Math.PI] as [number, number],
    padding: { side, vertical }, located: located.length };
}
