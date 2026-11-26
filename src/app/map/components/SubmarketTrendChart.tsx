'use client';

import { useEffect, useRef } from 'react';
import * as echarts from 'echarts/core';
import { LineChart } from 'echarts/charts';
import { GridComponent, TooltipComponent } from 'echarts/components';
import { CanvasRenderer } from 'echarts/renderers';
import type { SubmarketTrendPoint } from '../model/submarketMarketTrend';
import { researchNumber } from '../model/submarketResearch';
import styles from './SubmarketResearchData.module.css';

echarts.use([LineChart, GridComponent, TooltipComponent, CanvasRenderer]);

type Props = { data: readonly SubmarketTrendPoint[] };
const metrics = {
  rent: { name: '净有效租金', unit: '元/㎡/月', sampleKey: 'rentSamples' },
  vacancyPct: { name: '空置率', unit: '%', sampleKey: 'vacancySamples' },
} as const;
type Metric = keyof typeof metrics;

function MetricPlot({ data, metric }: Props & { metric: Metric }) {
  const host = useRef<HTMLDivElement>(null);
  const { name, unit, sampleKey } = metrics[metric];
  const latest = data.findLast(point => point[metric] != null);

  useEffect(() => {
    const element = host.current;
    if (!element) return;
    const chart = echarts.init(element, undefined, { renderer: 'canvas' });
    const motion = window.matchMedia?.('(prefers-reduced-motion: reduce)');
    const theme = window.getComputedStyle(element);
    const token = (name: string, fallback: string) => theme.getPropertyValue(`--cd-color-${name}`).trim() || fallback;
    const surface = token('surface', '#ffffff');
    const ink = token('text-primary', '#172033');
    const subtle = token('text-secondary', '#667085');
    const line = token('border', '#d9e0e8');
    const mark = token('brand', '#003e7e');
    const fontSize = parseFloat(theme.fontSize) || 14;
    const valueText = (value: number | null) => value == null ? '未收录' : `${researchNumber(value)}${unit === '%' ? '' : ' '}${unit}`;

    chart.setOption({
      animation: !motion?.matches,
      animationDuration: 180,
      animationDurationUpdate: 180,
      textStyle: { fontFamily: theme.fontFamily, fontSize, color: ink },
      color: [mark],
      grid: { left: 56, right: 28, top: 22, bottom: 36, containLabel: false },
      tooltip: {
        trigger: 'axis', confine: true, renderMode: 'richText',
        axisPointer: { type: 'line', snap: true, lineStyle: { color: subtle, type: 'dashed' } },
        backgroundColor: surface, borderColor: line, textStyle: { color: ink, fontSize },
        formatter: (params: unknown) => {
          const first = Array.isArray(params) ? params[0] : null;
          const row = data[Number(first?.dataIndex)];
          return row ? `${row.period}\n${name}：${valueText(row[metric])}（${row[sampleKey]} 个样本）` : '';
        },
      },
      xAxis: {
        type: 'category', boundaryGap: false, data: data.map(row => row.period),
        axisLine: { lineStyle: { color: line } }, axisTick: { show: false },
        axisLabel: { color: subtle, hideOverlap: true, showMinLabel: true, showMaxLabel: true, margin: 10 },
      },
      yAxis: {
        type: 'value', scale: metric === 'rent', splitNumber: 3,
        axisLabel: { color: subtle, formatter: metric === 'rent' ? '{value}' : '{value}%' },
        axisLine: { show: false }, splitLine: { lineStyle: { color: line } },
        ...(metric === 'vacancyPct' ? { max: (value: { max: number }) => Math.max(10, Math.ceil(value.max / 5) * 5) } : {}),
      },
      series: [{
        name, type: 'line', data: data.map(point => point[metric]),
        showSymbol: true, symbol: 'circle', symbolSize: 8, connectNulls: false, smooth: false,
        lineStyle: { width: 2 }, itemStyle: { borderWidth: 2, borderColor: surface },
      }],
    });

    const updateMotion = () => chart.setOption({ animation: !motion?.matches });
    motion?.addEventListener?.('change', updateMotion);
    const resize = () => chart.resize();
    const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(resize) : null;
    observer?.observe(element);
    if (!observer) window.addEventListener('resize', resize);
    return () => {
      motion?.removeEventListener?.('change', updateMotion);
      observer?.disconnect();
      if (!observer) window.removeEventListener('resize', resize);
      chart.dispose();
    };
  }, [data, metric, name, unit, sampleKey]);

  return <figure className={styles.chartFigure}>
    <figcaption className={styles.chartCaption}>
      <h4>{name}</h4><span className={styles.secondary}>
        {latest ? `${latest.period} · ${researchNumber(latest[metric]!)}${unit === '%' ? '' : ' '}${unit}` : unit}
      </span>
    </figcaption>
    {latest ? <div ref={host} className={styles.chartCanvas} role="img" aria-label={`${name}季度趋势图`} />
      : <p className={styles.chartStatus}>暂无已发布的有效季度观测。</p>}
  </figure>;
}

export function SubmarketTrendChart({ data }: Props) {
  return <>
    <div className={styles.charts}>
      <MetricPlot data={data} metric="rent" />
      <MetricPlot data={data} metric="vacancyPct" />
    </div>
    <details className={styles.quarterData}>
      <summary>查看季度数据</summary>
      <table aria-label="季度租金与空置率">
        <thead><tr><th scope="col">季度</th><th scope="col">租金<br />元/㎡/月</th><th scope="col">空置率<br />%</th></tr></thead>
        <tbody>{data.map(row => <tr key={row.period}>
          <th scope="row">{row.period}</th>
          <td>{row.rent == null ? '—' : researchNumber(row.rent)}<span>{row.rentSamples} 个样本</span></td>
          <td>{row.vacancyPct == null ? '—' : researchNumber(row.vacancyPct)}<span>{row.vacancySamples} 个样本</span></td>
        </tr>)}</tbody>
      </table>
    </details>
  </>;
}
