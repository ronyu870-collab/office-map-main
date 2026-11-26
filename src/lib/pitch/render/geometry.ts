import type { SceneElement } from '../contracts/scene';
import type { DesignTheme } from '../design/theme';

type Chart = Extract<SceneElement, { kind: 'chart' }>;

export function contain(box: { x: number; y: number; w: number; h: number }, width: number, height: number) {
  const scale = Math.min(box.w / width, box.h / height), w = width * scale, h = height * scale;
  return { x: box.x + (box.w - w) / 2, y: box.y + (box.h - h) / 2, w, h };
}

/** Normalized focus is the preferred crop center. Clamp it to the source bounds. */
export function cover(box: { x: number; y: number; w: number; h: number }, width: number, height: number, focus = { x: .5, y: .5 }) {
  const scale = Math.max(box.w / width, box.h / height);
  const w = width * scale, h = height * scale;
  const x = Math.max(0, Math.min(w - box.w, w * focus.x - box.w / 2));
  const y = Math.max(0, Math.min(h - box.h, h * focus.y - box.h / 2));
  return { x, y, w, h, retained: box.w * box.h / (w * h), dpi: 1 / scale };
}

function scale(values: (number | null)[], includeZero: boolean) {
  const known = values.filter((v): v is number => v !== null);
  if (includeZero || !known.length) known.push(0);
  const low = Math.min(...known), high = Math.max(...known);
  const spread = high - low || Math.max(1, Math.abs(high) / 4);
  const min = includeZero ? low : low - spread * .08;
  const max = includeZero ? high : high + spread * .08;
  const power = Math.max(Number.MIN_VALUE, 10 ** Math.floor(Math.log10(spread)));
  const step = power * (spread / power <= 2 ? .5 : spread / power <= 5 ? 1 : 2) || Number.MIN_VALUE;
  const round = (v: number) => Number(v.toPrecision(14));
  return { min: round(Math.floor(min / step) * step), max: round(Math.ceil((max === min ? max + spread : max) / step) * step), step: round(step) };
}
export function chartScale(chart: Chart) {
  if (chart.xAxis) {
    const indices = chart.categories.map((_, i) => i).filter(i => chart.xAxis!.values[i] !== null);
    return scale(chart.series.flatMap(s => indices.map(i => s.values[i])), false);
  }
  const values = chart.chartType === 'stacked-column'
    ? chart.categories.flatMap((_, i) => {
      const values = chart.series.map(s => s.values[i] ?? 0);
      return [values.reduce((a, b) => a + Math.min(b, 0), 0), values.reduce((a, b) => a + Math.max(b, 0), 0)];
    })
    : chart.series.flatMap(s => s.values);
  return scale(values, true);
}
export function scatterXScale(chart: Chart) {
  const values = chart.xAxis!.values.filter((v, i) => v !== null && chart.series.some(s => s.values[i] !== null));
  return scale(values, false);
}
export function chartPlot(chart: Chart, theme: DesignTheme) {
  const left = theme.profile && chart.chartType === 'bar' ? Math.min(2.1, chart.w * .26) : 1;
  const top = theme.profile ? .50 : .65;
  const bottom = chart.chartType === 'scatter' ? .83 : theme.profile ? .60 : .85;
  return { x: chart.x + left, y: chart.y + top, w: chart.w - left - .2, h: chart.h - top - bottom };
}
export function seriesLabel(series: { name: string; unit: string }) {
  return series.unit ? `${series.name} (${series.unit})` : series.name;
}
export function chartColor(chart: Chart, theme: DesignTheme, series: number, category?: number) {
  if (chart.emphasis?.kind === 'target' && category !== undefined) {
    return chart.emphasis.category === category ? theme.chartColors[0] : theme.colors.secondary;
  }
  return theme.chartColors[series % theme.chartColors.length];
}
/** Equirectangular coordinate schematic, with longitude corrected by latitude. */
export function mapGeometry(map: Extract<SceneElement, { kind: 'map' }>) {
  const [west, south, east, north] = map.bounds, cosine = Math.cos((north + south) / 2 * Math.PI / 180);
  const box = contain({ x: map.x + .3, y: map.y + .3, w: map.w - .6, h: map.h - .6 }, (east - west) * cosine, north - south);
  return { box, points: map.points.map((p, i) => ({ ...p, number: i + 1, x: box.x + (p.longitude - west) / (east - west) * box.w, y: box.y + (north - p.latitude) / (north - south) * box.h })) };
}
