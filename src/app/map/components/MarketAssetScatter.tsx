'use client';

import { useEffect, useRef } from 'react';
import * as echarts from 'echarts/core';
import { ScatterChart } from 'echarts/charts';
import { GridComponent, TooltipComponent, MarkLineComponent } from 'echarts/components';
import { CanvasRenderer } from 'echarts/renderers';
import { marketTrendTheme } from '@/src/services/map/marketTrendChartOptions';
import { niceMarketStep, productNames, quantile, RESEARCH_PRODUCTS, type AssetObservation } from '../model/marketAssetAnalytics';
import styles from './MarketAssetAnalytics.module.css';

echarts.use([ScatterChart, GridComponent, TooltipComponent, MarkLineComponent, CanvasRenderer]);

export function MarketAssetScatter({ points, onOpen }: { points: readonly AssetObservation[]; onOpen: (id: string) => void }) {
  const host = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const element = host.current;
    if (!element || !points.length) return;
    let chart: echarts.ECharts | null = null;
    const render = () => {
      if (!element.clientWidth || !element.clientHeight) return;
      if (chart) { chart.resize(); return; }
      chart = echarts.init(element, undefined, { renderer: 'canvas' });
      const theme = marketTrendTheme(getComputedStyle(element), 'rent');
      const palette = [theme.mark, getComputedStyle(element).getPropertyValue('--cd-color-market-vacancy').trim() || '#326A78', theme.subtle];
      const max = Math.max(...points.map(p => p.rent!));
      const step = niceMarketStep(max / 5);
      const maxArea = Math.max(1, ...points.map(p => p.area ?? 0));
      const rents = points.map(p => p.rent!).sort((a, b) => a - b);
      const vacancies = points.map(p => p.vacancy!).sort((a, b) => a - b);
      const marker = ['circle', 'diamond', 'rect'];
      chart.setOption({
        animation: false,
        textStyle: { fontFamily: theme.fontFamily, fontSize: theme.fontSize, color: theme.ink },
        grid: { left: 12, right: 12, top: 20, bottom: 10, containLabel: true },
        tooltip: { trigger: 'item', triggerOn: 'mousemove|click', renderMode: 'richText', confine: true,
          backgroundColor: theme.surface, borderColor: theme.border, textStyle: { color: theme.ink },
          formatter: (raw: unknown) => {
            const data = (raw as { data?: { id?: string } }).data;
            const p = points.find(point => point.id === data?.id);
            return p ? [p.name.replace(/[{}\r\n]/g, ' '), productNames[p.grade],
              '净有效租金 ' + p.rent!.toFixed(1) + ' 元/㎡/月', '空置率 ' + p.vacancy!.toFixed(1) + '%'].join('\n') : '';
          } },
        xAxis: { type: 'value', min: 0, max: Math.max(step, Math.ceil(max / step) * step), interval: step,
          axisLabel: { color: theme.subtle, hideOverlap: true }, axisLine: { lineStyle: { color: theme.border } },
          splitLine: { lineStyle: { color: theme.border } } },
        yAxis: { type: 'value', min: 0, max: 100, interval: 20,
          axisLabel: { color: theme.subtle, formatter: '{value}%' }, splitLine: { lineStyle: { color: theme.border } } },
        series: RESEARCH_PRODUCTS.map((grade, index) => ({
          name: productNames[grade], type: 'scatter', symbol: marker[index], itemStyle: { color: palette[index], opacity: 0.88 },
          data: points.filter(p => p.grade === grade).map(p => ({ id: p.id, value: [p.rent, p.vacancy], symbolSize: 7 + 12 * Math.sqrt((p.area ?? 0) / maxArea) })),
          ...(index === 0 && points.length >= 5 ? { markLine: { silent: true, symbol: 'none', label: { show: false },
            lineStyle: { color: theme.subtle, type: 'dashed' },
            data: [{ xAxis: quantile(rents, .5) }, { yAxis: quantile(vacancies, .5) }] } } : {}),
        })),
      });
      chart.on('click', params => {
        const id = (params.data as { id?: string } | undefined)?.id;
        if (id && points.some(p => p.id === id)) onOpen(id);
      });
    };
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(render);
    observer?.observe(element);
    if (!observer) window.addEventListener('resize', render);
    render();
    return () => { observer?.disconnect(); if (!observer) window.removeEventListener('resize', render); chart?.dispose(); };
  }, [points, onOpen]);
  return <div ref={host} className={styles.scatter} role="img" aria-label="同季度楼宇净有效租金与空置率散点图" />;
}
