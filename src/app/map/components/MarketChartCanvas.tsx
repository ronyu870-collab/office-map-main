'use client';

import { useEffectEvent, useLayoutEffect, useRef } from 'react';
import * as echarts from 'echarts/core';
import { LineChart, ScatterChart } from 'echarts/charts';
import { GridComponent, TooltipComponent } from 'echarts/components';
import { CanvasRenderer } from 'echarts/renderers';
import { marketTrendAxisDensity, type MarketTrendPresentation } from '../model/marketTrendPresentation';
import { buildMarketTrendChartOptions, marketTrendTheme } from '@/src/services/map/marketTrendChartOptions';
import styles from './SubmarketResearchData.module.css';

echarts.use([LineChart, ScatterChart, GridComponent, TooltipComponent, CanvasRenderer]);

function setChartGroup(chart: echarts.ECharts, group: string) {
  if (chart.group === group) return;
  if (chart.group) echarts.disconnect(chart.group);
  chart.group = group;
  if (group) echarts.connect(group);
}

export function MarketChartCanvas({ presentation, label, active, group = '' }: {
  presentation: MarketTrendPresentation; label: string; active: boolean; group?: string;
}) {
  const host = useRef<HTMLDivElement>(null);
  const instance = useRef<echarts.ECharts | null>(null);
  const lastDraw = useRef<{
    width: number; height: number; density: ReturnType<typeof marketTrendAxisDensity>;
    presentation: MarketTrendPresentation;
  } | null>(null);

  const draw = useEffectEvent((element: HTMLDivElement) => {
    const { clientWidth: width, clientHeight: height } = element;
    if (!active || !width || !height) {
      const chart = instance.current;
      if (chart) {
        chart.dispatchAction({ type: 'hideTip' });
        setChartGroup(chart, '');
      }
      return;
    }

    const previous = lastDraw.current;
    const mustResize = previous?.width !== width || previous.height !== height;
    const density = marketTrendAxisDensity(width, presentation.axis.length);
    const mustUpdate = previous?.presentation !== presentation
      || previous.density.left !== density.left || previous.density.interval !== density.interval;
    let chart = instance.current;
    if (!chart) {
      chart = echarts.init(element, undefined, { renderer: 'canvas', width, height });
      instance.current = chart;
    } else {
      if (mustResize || mustUpdate) chart.dispatchAction({ type: 'hideTip' });
      // Resize the actual drawing surface during observer delivery, before that frame is painted.
      if (mustResize) chart.resize({ width, height });
    }
    if (mustUpdate) {
      const theme = marketTrendTheme(window.getComputedStyle(element), presentation.metric);
      chart.setOption(buildMarketTrendChartOptions(presentation, width, theme), { notMerge: true });
    }
    setChartGroup(chart, group);
    lastDraw.current = { width, height, density, presentation };
  });

  useLayoutEffect(() => {
    const element = host.current!;
    let mounted = true;
    const measure = () => { if (mounted) draw(element); };
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure);
    observer?.observe(element);
    if (!observer) window.addEventListener('resize', measure);
    return () => {
      mounted = false;
      observer?.disconnect();
      if (!observer) window.removeEventListener('resize', measure);
      if (instance.current) {
        setChartGroup(instance.current, '');
        instance.current.dispose();
        instance.current = null;
      }
      lastDraw.current = null;
    };
  }, []);

  useLayoutEffect(() => {
    if (host.current) draw(host.current);
  }, [presentation, active, group]);

  return <div ref={host} className={styles.chartCanvas} role="img" aria-label={label} />;
}
