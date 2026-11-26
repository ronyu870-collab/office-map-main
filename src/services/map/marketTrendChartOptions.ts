import type { EChartsCoreOption } from 'echarts/core';
import {
  compareTrendQuarters, marketTrendAxisDensity, marketTrendLabels, type MarketTrendPresentation,
} from '@/src/app/map/model/marketTrendPresentation';
import { marketTrendChangeText, marketTrendValueText } from '@/src/app/map/model/marketTrendText';
import { researchNumber } from '@/src/app/map/model/submarketResearch';
import { trendCoverage, trendSamples, trendValue, type MarketTrendMetric } from '@/src/app/map/model/submarketTrendDigest';

function buildTooltip(presentation: MarketTrendPresentation, index: number) {
  const { axis, observations, metric } = presentation;
  const quarter = axis[index];
  if (!quarter) return '';
  const value = trendValue(quarter.point, metric);
  const { name } = marketTrendLabels[metric];
  if (value == null) return `${quarter.period}\n${name}：未收录`;
  const coverage = trendCoverage(quarter.point, metric);
  const previous = observations.findLast(row => row.key < quarter.key);
  const change = compareTrendQuarters(metric, quarter, previous);
  return [
    quarter.period,
    `${name} ${marketTrendValueText(value, metric)}`,
    change && marketTrendChangeText(change, metric),
    `${trendSamples(quarter.point, metric)} 个有效样本${coverage == null ? '' : ` · 面积覆盖 ${researchNumber(coverage * 100)}%`}`,
    quarter.point?.source === 'building_metrics' ? '已发布季度记录' : '季度观测',
  ].filter(Boolean).join('\n');
}

export function marketTrendTheme(css: CSSStyleDeclaration, metric: MarketTrendMetric) {
  const token = (name: string, fallback: string) => css.getPropertyValue(`--cd-color-${name}`).trim() || fallback;
  return {
    surface: token('surface', '#FFFFFF'),
    ink: token('text-primary', '#172033'),
    subtle: token('text-secondary', '#667085'),
    border: token('border', '#D9E0E8'),
    mark: metric === 'rent' ? token('brand', '#003E7E') : token('market-vacancy', '#326A78'),
    fontFamily: css.fontFamily,
    fontSize: parseFloat(css.fontSize) || 14,
  };
}

export function buildMarketTrendChartOptions(
  presentation: MarketTrendPresentation, width: number, theme: ReturnType<typeof marketTrendTheme>,
): EChartsCoreOption {
  const { axis, kind, metric, latest } = presentation;
  const { name, unit } = marketTrendLabels[metric];
  const density = marketTrendAxisDensity(width, axis.length);
  const values = axis.map(row => trendValue(row.point, metric));
  const observed = values.filter(value => value != null);
  const min = Math.min(...observed), max = Math.max(...observed);
  // Use a minimum domain span so small movements don't occupy the entire plot.
  const padding = Math.max((max - min) * 0.25, metric === 'rent' ? (max + min) / 20 : 2, 1);
  const step = metric === 'rent' ? 5 : 2;
  const lower = Math.max(0, Math.floor((min - padding) / step) * step);
  const upper = Math.ceil((max + padding) / step) * step;
  const marker = metric === 'rent' ? 'circle' : 'diamond';
  return {
    animation: false,
    color: [theme.mark],
    textStyle: { fontFamily: theme.fontFamily, fontSize: theme.fontSize, color: theme.ink },
    grid: { left: density.left, right: density.right, top: 18, bottom: 4, containLabel: true },
    tooltip: {
      trigger: 'axis', triggerOn: 'mousemove|click', confine: true, renderMode: 'richText',
      transitionDuration: 0, hideDelay: 0,
      axisPointer: { type: 'line', snap: true, lineStyle: { color: theme.subtle, type: 'dashed' } },
      backgroundColor: theme.surface, borderColor: theme.border, padding: 8,
      textStyle: { color: theme.ink, fontSize: theme.fontSize },
      formatter: (params: unknown) => {
        const entries = Array.isArray(params) ? params : [params];
        const param = entries[0];
        return param ? buildTooltip(presentation, Number(param.dataIndex)) : '';
      },
    },
    xAxis: {
      type: 'category', boundaryGap: true, data: axis.map(row => row.period),
      axisLine: { lineStyle: { color: theme.border } }, axisTick: { show: false },
      axisLabel: {
        color: theme.subtle, hideOverlap: true, showMinLabel: true, showMaxLabel: true, margin: 8,
        interval: (index: number) => index === 0 || index === axis.length - 1
          || axis[index].key === latest?.key
          || (index % density.interval === 0 && index < axis.length - density.interval),
      },
    },
    yAxis: {
      type: 'value', min: lower, max: metric === 'vacancyPct' ? Math.min(100, upper) : upper,
      splitNumber: density.splitNumber,
      axisLabel: { color: theme.subtle, formatter: (value: number) => `${value.toLocaleString('zh-CN')}${unit === '%' ? '%' : ''}` },
      axisLine: { show: false }, axisTick: { show: false }, splitLine: { lineStyle: { color: theme.border } },
    },
    series: [{
      name, id: metric, type: kind, data: values.map((value, index) =>
        value != null && axis[index].key === latest?.key ? { value, symbolSize: 9 } : value),
      symbol: marker, symbolSize: kind === 'scatter' ? 6 : 4,
      ...(kind === 'line' && { showSymbol: true, showAllSymbol: true, connectNulls: false, smooth: false, lineStyle: { width: 2 } }),
      itemStyle: { color: theme.mark, opacity: 1 },
      emphasis: { scale: kind === 'scatter' ? 1.45 : true, itemStyle: { borderWidth: 1, borderColor: theme.surface } },
    }],
  };
}
