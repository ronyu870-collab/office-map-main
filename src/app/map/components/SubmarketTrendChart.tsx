'use client';

import * as React from 'react';
import * as echarts from 'echarts/core';
import { LineChart } from 'echarts/charts';
import { GridComponent, LegendComponent, TooltipComponent } from 'echarts/components';
import { CanvasRenderer } from 'echarts/renderers';
import type { SubmarketTrendPoint } from '../model/submarketMarketTrend';

echarts.use([LineChart, GridComponent, LegendComponent, TooltipComponent, CanvasRenderer]);

type Props = { data: SubmarketTrendPoint[] };

export function SubmarketTrendChart({ data }: Props) {
  const host = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    const element = host.current;
    if (!element || !data.length) return;
    const chart = echarts.init(element, undefined, { renderer: 'canvas' });
    const rent = data.map(point => point.rent == null ? null : Number(point.rent.toFixed(1)));
    const vacancy = data.map(point => point.vacancyPct == null ? null : Number(point.vacancyPct.toFixed(1)));

    chart.setOption({
      animationDuration: 180,
      color: ['#003e7e', '#b77929'],
      grid: { left: 54, right: 49, top: 64, bottom: 36 },
      legend: { top: 4, itemWidth: 22, itemHeight: 3, textStyle: { color: '#334155', fontSize: 12 },
        data: ['净有效租金', '空置率'] },
      tooltip: {
        trigger: 'axis', confine: true, appendToBody: false,
        backgroundColor: '#ffffff', borderColor: '#d9e0e8', textStyle: { color: '#172033', fontSize: 12 },
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
        axisLabel: { fontSize: 10, color: '#667085', interval: 'auto' },
      },
      yAxis: [
        {
          type: 'value', name: '元/㎡/月', nameLocation: 'end',
          scale: true, nameTextStyle: { color: '#003e7e', fontSize: 10, padding: [0, 0, 0, -6] },
          axisLabel: { color: '#003e7e', fontSize: 10 },
          axisLine: { show: false }, splitLine: { lineStyle: { color: '#edf1f5' } },
        },
        {
          type: 'value', name: '%', nameLocation: 'end', min: 0, max: (value: { max: number }) => Math.max(10, Math.ceil(value.max / 5) * 5),
          nameTextStyle: { color: '#975e1d', fontSize: 10 },
          axisLabel: { color: '#975e1d', fontSize: 10, formatter: '{value}%' },
          axisLine: { show: false }, splitLine: { show: false },
        },
      ],
      series: [
        {
          name: '净有效租金', type: 'line', yAxisIndex: 0, data: rent,
          showSymbol: true, symbolSize: 5, connectNulls: false, smooth: false,
          lineStyle: { width: 2.5 },
        },
        {
          name: '空置率', type: 'line', yAxisIndex: 1, data: vacancy,
          showSymbol: true, symbolSize: 5, connectNulls: false, smooth: false,
          lineStyle: { width: 2.5, type: 'dashed' },
        },
      ],
    });

    const observer = new ResizeObserver(() => chart.resize());
    observer.observe(element);
    return () => { observer.disconnect(); chart.dispose(); };
  }, [data]);

  return (
    <div>
      <div ref={host} style={{ width: '100%', height: 308 }} role="img"
        aria-label="同一季度时间轴上的净有效租金和空置率双纵轴趋势图" />
      <div className="sr-only">
        {data.map(row => `${row.period}，租金${row.rent?.toFixed(1) ?? '无数据'}，空置率${row.vacancyPct?.toFixed(1) ?? '无数据'}%。`).join(' ')}
      </div>
    </div>
  );
}
