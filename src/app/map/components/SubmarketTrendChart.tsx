'use client';

import * as React from 'react';
import * as echarts from 'echarts/core';
import { LineChart } from 'echarts/charts';
import { GridComponent, LegendComponent, TooltipComponent } from 'echarts/components';
import { CanvasRenderer } from 'echarts/renderers';
import type { SubmarketTrendPoint } from '../model/submarketMarketTrend';

echarts.use([LineChart, GridComponent, LegendComponent, TooltipComponent, CanvasRenderer]);

type Props = { data: SubmarketTrendPoint[]; compact?: boolean };

export function SubmarketTrendChart({ data, compact = false }: Props) {
  const host = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    const element = host.current;
    if (!element || !data.length) return;
    const chart = echarts.init(element, undefined, { renderer: 'canvas' });
    const motion = window.matchMedia?.('(prefers-reduced-motion: reduce)');
    const rent = data.map(point => point.rent == null ? null : Number(point.rent.toFixed(1)));
    const vacancy = data.map(point => point.vacancyPct == null ? null : Number(point.vacancyPct.toFixed(1)));

    chart.setOption({
      animation: !motion?.matches,
      animationDuration: 180,
      animationDurationUpdate: 180,
      color: ['#003e7e', '#b77929'],
      grid: { left: compact ? 52 : 64, right: compact ? 56 : 64, top: 64, bottom: compact ? 32 : 44, containLabel: false },
      legend: { top: 7, left: compact ? 4 : 12, itemWidth: 23, itemHeight: 3, itemGap: compact ? 12 : 20,
        textStyle: { color: '#334155', fontSize: 14, fontWeight: 400 }, data: ['净有效租金', '空置率'] },
      tooltip: {
        trigger: 'axis', confine: true, appendToBody: false, axisPointer: { type: 'line', lineStyle: { color: '#94a3b8', type: 'dashed' } },
        backgroundColor: '#ffffff', borderColor: '#d9e0e8', textStyle: { color: '#172033', fontSize: 14 },
        formatter: (params: unknown) => {
          const first = Array.isArray(params) ? params[0] : null;
          const index = Number(first?.dataIndex);
          const row = data[index];
          if (!row) return '';
          const rentValue = row.rent === null ? '暂无数据' : `${row.rent.toFixed(1)} 元/㎡/月（${row.rentSamples} 个样本）`;
          const vacValue = row.vacancyPct === null ? '暂无数据' : `${row.vacancyPct.toFixed(1)}%（${row.vacancySamples} 个样本）`;
          return `<strong>${row.period}</strong><div style="margin-top:6px">净有效租金：${rentValue}</div><div>空置率：${vacValue}</div>`;
        },
      },
      xAxis: {
        type: 'category', boundaryGap: false, data: data.map(row => row.period),
        axisLine: { lineStyle: { color: '#c3ccd8' } }, axisTick: { show: false },
        axisLabel: { fontSize: 14, color: '#667085', interval: 'auto', margin: 14 },
      },
      yAxis: [
        {
          type: 'value', name: '元/㎡/月', nameLocation: 'end',
          scale: true, nameTextStyle: { color: '#003e7e', fontSize: 14, padding: [0, 0, 0, -6] },
          axisLabel: { color: '#003e7e', fontSize: 14 },
          axisLine: { show: false }, splitLine: { lineStyle: { color: '#edf1f5' } },
        },
        {
          type: 'value', name: '%', nameLocation: 'end', min: 0, max: (value: { max: number }) => Math.max(10, Math.ceil(value.max / 5) * 5),
          nameTextStyle: { color: '#975e1d', fontSize: 14 },
          axisLabel: { color: '#975e1d', fontSize: 14, formatter: '{value}%' },
          axisLine: { show: false }, splitLine: { show: false },
        },
      ],
      series: [
        {
          name: '净有效租金', type: 'line', yAxisIndex: 0, data: rent,
          showSymbol: true, symbolSize: compact ? 4 : 6, connectNulls: false, smooth: false,
          lineStyle: { width: compact ? 2.5 : 3 }, itemStyle: { borderWidth: 2 },
        },
        {
          name: '空置率', type: 'line', yAxisIndex: 1, data: vacancy,
          showSymbol: true, symbolSize: compact ? 4 : 6, connectNulls: false, smooth: false,
          lineStyle: { width: compact ? 2 : 2.5, type: 'dashed' }, itemStyle: { borderWidth: 2 },
        },
      ],
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
  }, [data, compact]);

  return (
    <div>
      <div ref={host} className={compact ? 'h-[188px] w-full sm:h-[208px]' : 'h-[240px] w-full sm:h-[300px]'} role="img"
        aria-label="同一季度时间轴上的净有效租金和空置率双纵轴趋势图" />
      <details className="submarket-quarter-data">
        <summary>查看季度数据</summary>
        <table aria-label="季度租金与空置率">
          <thead><tr><th scope="col">季度</th><th scope="col">租金<br />元/㎡/月</th><th scope="col">空置率<br />%</th></tr></thead>
          <tbody>{data.map(row => <tr key={row.period}>
            <th scope="row">{row.period}</th>
            <td>{row.rent?.toFixed(1) ?? '—'}<span>{row.rentSamples} 个样本</span></td>
            <td>{row.vacancyPct?.toFixed(1) ?? '—'}<span>{row.vacancySamples} 个样本</span></td>
          </tr>)}</tbody>
        </table>
      </details>
    </div>
  );
}
