import type { SceneElement } from '../contracts/scene';
export function contain(box: { x: number; y: number; w: number; h: number }, width: number, height: number) {
  const scale = Math.min(box.w / width, box.h / height), w = width * scale, h = height * scale;
  return { x: box.x + (box.w - w) / 2, y: box.y + (box.h - h) / 2, w, h };
}
export function chartScale(chart: Extract<SceneElement, { kind: 'chart' }>) {
  const values = chart.series.flatMap(s => s.values).filter((v): v is number => v !== null);
  const rawMin = Math.min(0, ...values), rawMax = Math.max(0, ...values);
  const span = rawMax - rawMin || 1, power = 10 ** Math.floor(Math.log10(span));
  const step = power * (span / power <= 2 ? .5 : span / power <= 5 ? 1 : 2);
  return { min: Math.floor(rawMin / step) * step, max: Math.ceil((rawMax === rawMin ? 1 : rawMax) / step) * step, step };
}
/** Equirectangular coordinate schematic, with longitude corrected by latitude. */
export function mapGeometry(map: Extract<SceneElement, { kind: 'map' }>) {
  const [west, south, east, north] = map.bounds, cosine = Math.cos((north + south) / 2 * Math.PI / 180);
  const box = contain({ x: map.x + .3, y: map.y + .3, w: map.w - .6, h: map.h - .6 }, (east - west) * cosine, north - south);
  return { box, points: map.points.map((p, i) => ({ ...p, number: i + 1, x: box.x + (p.longitude - west) / (east - west) * box.w, y: box.y + (north - p.latitude) / (north - south) * box.h })) };
}
