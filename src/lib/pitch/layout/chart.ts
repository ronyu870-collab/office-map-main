import type { SlideContent } from '../contracts/content';
import type { SceneElement } from '../contracts/scene';
import { chartTextSize } from '../design/theme';
import { cellText } from '../render/format';
import { chartPlot, seriesLabel } from '../render/geometry';
import type { sceneComponents } from './components';
import { LayoutError, lineHeight, textWidth, wrapText } from './metrics';

type ContentChart = Extract<SlideContent['blocks'][number], { kind: 'chart' }>;
type Chart = Extract<SceneElement, { kind: 'chart' }>;
type Tools = ReturnType<typeof sceneComponents>;

export function chartElement(block: ContentChart, box: Pick<Chart, 'x' | 'y' | 'w' | 'h'>, t: Tools): Chart {
  const { chartType, categories, series, xAxis, emphasis } = block;
  const scatter = chartType === 'scatter';
  if (scatter && !xAxis) throw new LayoutError('PITCH_CHART_UNSUPPORTED', '散点图需要显式提供横轴名称、单位和数值，避免把分类序号解释为数据。');
  if (!categories.length || categories.length > 12 || series.length > 4 || box.w < 3 || box.h < 1.8) {
    throw new LayoutError('PITCH_CHART_LABELS', '图表区域或标签容量不足，请更换布局。');
  }
  if (new Set(series.map(s => s.unit)).size !== 1) throw new LayoutError('PITCH_CHART_UNITS', '同一数轴要求系列单位一致。');
  const range = series.flatMap(s => s.values).concat(xAxis?.values ?? []);
  if (range.some(v => v !== null && (Math.abs(v) > 1e15 || v !== 0 && Math.abs(v) < 1e-12))) throw new LayoutError('PITCH_CHART_RANGE', '数值超过安全范围。');
  if (!series.some(s => s.values.some((v, i) => v !== null && (!xAxis || xAxis.values[i] !== null)))) {
    throw new LayoutError('PITCH_CHART_EMPTY', '图表没有可绘制的已知数值，未知值保持为空。');
  }
  if (chartType === 'pie' && (series.length !== 1 || series[0].values.some(v => v === null || v < 0) || !series[0].values.some(v => v! > 0))) {
    throw new LayoutError('PITCH_PIE_VALUES', '饼图需要一组完整、非负且总量大于零的数值。');
  }
  if (chartType === 'combo' && series.length !== 2) throw new LayoutError('PITCH_COMBO_SERIES', '组合图需要两个同单位系列：柱形与折线。');
  if (chartType === 'stacked-column' && (series.length < 2 || series.some(s => s.values.some(v => v === null)))) {
    throw new LayoutError('PITCH_STACK_VALUES', '堆叠图需要至少两个完整系列，缺项会使总高度失真。');
  }
  if (emphasis?.kind === 'target' &&
      (series[0].values[emphasis.category] === null || xAxis?.values[emphasis.category] === null)) {
    throw new LayoutError('PITCH_CHART_TARGET', '目标项目需要已知数值。');
  }
  const chart: Chart = { kind: 'chart', ...box, chartType, categories, series, ...(xAxis && { xAxis }), ...(emphasis && { emphasis }) };
  const size = chartTextSize(t.theme), plot = chartPlot(chart, t.theme);
  const lines = (value: string, width: number) => wrapText(value, Math.max(width, .2), size, t.font).length;
  const horizontal = chartType === 'bar', labels = categories.length;
  const legends = series.map(seriesLabel);
  if (scatter && (plot.h < .55 || categories.some(label => lines(label, Math.min(2.2, plot.w * .47)) > 1))
    || !scatter && legends.reduce((total, label) => total + textWidth(label, size, t.font) + .56, -.25) > box.w
    || legends.some(label => lines(label, box.w / series.length - .22) > 1)
    || !scatter && categories.some(label => lines(label, horizontal ? plot.x - box.x - .1 : plot.w / labels) > 2)
    || horizontal && categories.some(label => lines(label, plot.x - box.x - .1) * lineHeight(size) > plot.h / labels)
    || chartType === 'pie' && (labels * .4 > plot.h || categories.some((label, i) => lines(`${label}: ${cellText(series[0].values[i])}`, plot.w * .33) > 1))
    || xAxis && lines(seriesLabel({ name: xAxis.label, unit: xAxis.unit }), plot.w) > 1) {
    throw new LayoutError('PITCH_CHART_LABELS', '图例或标签拥挤，请减少分类、使用短标签或选择更宽布局。');
  }
  return chart;
}
