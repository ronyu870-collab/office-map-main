"use client";

import type { TrendChartReadingOptions } from "./trendChartReading";
import * as echarts from "echarts/core";
import { LineChart } from "echarts/charts";
import { GridComponent, TooltipComponent } from "echarts/components";
import { CanvasRenderer } from "echarts/renderers";

echarts.use([LineChart, GridComponent, TooltipComponent, CanvasRenderer]);

export interface TrendChartDatum {
  year: number | string;
  quarter?: string;
  label?: string;
  period?: string;
  net_effective_rent: number | string | null | undefined;
  vacancy_rate: number | string | null | undefined;
}

/**
 * Heavy ECharts runtime for the Building Detail → Trend panel.
 *
 * Keep every runtime ECharts import in this module. MapController loads this
 * module with import() only after a user explicitly opens the Trend panel, so
 * the normal map path does not download/parse ECharts.
 */
export function initTrendChart(
  chartDom: HTMLElement,
  histData: TrendChartDatum[],
  onMetricView?: (metric: "rent" | "vac") => void,
  reading?: TrendChartReadingOptions,
): echarts.ECharts | null {
  if (!chartDom || !histData?.length) return null;

  const existing = echarts.getInstanceByDom(chartDom);
  if (existing) existing.dispose();

  const chart = echarts.init(chartDom);
  const xAxisData = histData.map((row) =>
    row.label || (row.quarter ? `${row.year}${row.quarter}` : `${row.year}`),
  );
  const metricValue = (value: TrendChartDatum['net_effective_rent'], factor = 1): number | null => {
    if (value == null || (typeof value === "string" && !value.trim())) return null;
    const numeric = Number(value);
    return Number.isFinite(numeric) ? Number((numeric * factor).toFixed(1)) : null;
  };
  const rentData = histData.map(row => metricValue(row.net_effective_rent));
  const vacancyData = histData.map(row => metricValue(row.vacancy_rate, 100));
  const motion = typeof matchMedia === "function" ? matchMedia('(prefers-reduced-motion: reduce)') : null;
  const dataHost = chartDom.parentElement?.querySelector<HTMLElement>('[data-building-trend-data]');
  const metricStatus = document.createElement('p');
  metricStatus.className = 'workspace-note';
  metricStatus.setAttribute('role', 'status');
  metricStatus.textContent = '当前指标暂无有效历史数值，可展开期间数据查看。';
  let details: HTMLDetailsElement | undefined;
  let currentMetric: "rent" | "vac" = reading?.value?.metric ?? "rent";
  const reportReading = () => reading?.onChange?.({ metric: currentMetric, tableOpen: details?.open ?? false });
  if (dataHost) {
    details = document.createElement('details');
    details.open = reading?.value?.tableOpen ?? false;
    details.className = 'workspace-trend-data';
    const summary = document.createElement('summary');
    summary.textContent = '查看期间数据';
    const table = document.createElement('table');
    table.setAttribute('aria-label', '项目期间租金与空置率');
    const head = table.createTHead().insertRow();
    for (const label of ['期间', '净有效租金（元/㎡/月）', '空置率（%）']) {
      const cell = document.createElement('th');
      cell.scope = 'col'; cell.textContent = label; head.appendChild(cell);
    }
    const body = table.createTBody();
    histData.forEach((row, index) => {
      const tr = body.insertRow();
      const period = document.createElement('th');
      period.scope = 'row'; period.textContent = row.period || (row.quarter ? `${row.year}${row.quarter}` : xAxisData[index]);
      tr.appendChild(period);
      for (const value of [rentData[index], vacancyData[index]]) tr.insertCell().textContent = value == null ? '—' : value.toFixed(1);
    });
    details.append(summary, table); dataHost.replaceChildren(metricStatus, details);
    details.addEventListener('toggle', reportReading);
  }

  const calculateAxisRange = (data: (number | null)[]) => {
    const observed = data.filter((value): value is number => value !== null);
    if (!observed.length) return { min: 0, max: 1 };
    const minValue = Math.min(...observed);
    const maxValue = Math.max(...observed);
    const range = maxValue - minValue || Math.abs(minValue) * 0.2 || 1;
    return {
      min: minValue - range * 0.35,
      max: maxValue + range * 0.15,
    };
  };

  const buildOption = (mode: "rent" | "vac") => {
    const isRent = mode === "rent";
    const data = isRent ? rentData : vacancyData;
    const range = calculateAxisRange(data);

    return {
      animation: !motion?.matches,
      textStyle: { fontFamily: 'Arial, "PingFang SC", "Microsoft YaHei", sans-serif', fontSize: 14, fontWeight: 400 },
      grid: { top: 40, bottom: 16, left: 8, right: 20, containLabel: true },
      tooltip: {
        trigger: "axis",
        valueFormatter: (value: unknown) =>
          value == null ? "未提供" : isRent ? `${String(value)} 元/㎡/月` : `${String(value)}%`,
      },
      xAxis: {
        type: "category",
        data: xAxisData,
        axisLabel: {
          fontSize: 14,
          color: "#64748b",
          showMaxLabel: true,
          showMinLabel: true,
        },
        axisLine: { show: false },
        axisTick: { show: false },
      },
      yAxis: [
        {
          type: "value",
          show: true,
          name: isRent ? '元/㎡/月' : '%',
          nameTextStyle: { fontSize: 14, fontWeight: 400, color: '#667085', align: 'left' },
          nameLocation: 'end',
          axisLabel: { color: '#667085', fontSize: 14, formatter: (value: number) => Number(value.toFixed(1)).toLocaleString('zh-CN') },
          axisLine: { show: false },
          axisTick: { show: false },
          scale: true,
          min: range.min,
          max: range.max,
          splitLine: { show: true, lineStyle: { color: "#e7ebf0" } },
        },
      ],
      series: [
        {
          type: "line",
          data,
          name: isRent ? '净有效租金' : '空置率',
          smooth: false,
          connectNulls: false,
          showSymbol: true,
          showAllSymbol: true,
          symbol: 'circle',
          symbolSize: 6,
          itemStyle: { color: '#003e7e' },
          lineStyle: { width: 2 },
          label: { show: false },
        },
      ],
    };
  };

  const rentButton = document.getElementById("chart-btn-rent");
  const vacancyButton = document.getElementById("chart-btn-vac");
  const syncButtons = () => {
    rentButton?.setAttribute('aria-pressed', String(currentMetric === 'rent'));
    vacancyButton?.setAttribute('aria-pressed', String(currentMetric === 'vac'));
    const hasData = (currentMetric === 'rent' ? rentData : vacancyData).some(value => value !== null);
    metricStatus.hidden = hasData;
    const wasHidden = chartDom.hidden;
    chartDom.hidden = !hasData;
    if (wasHidden && hasData) chart.resize();
  };
  chart.setOption(buildOption(currentMetric));
  syncButtons();
  onMetricView?.(currentMetric);

  const setActive = (metric: "rent" | "vac") => {
    if (metric === currentMetric) return;
    currentMetric = metric;
    chart.setOption(buildOption(metric), true);
    syncButtons();
    reportReading();
    onMetricView?.(metric);
  };
  const syncMotion = () => chart.setOption(buildOption(currentMetric), true);
  motion?.addEventListener('change', syncMotion);

  const showRent = () => setActive("rent");
  const showVacancy = () => setActive("vac");
  rentButton?.addEventListener("click", showRent);
  vacancyButton?.addEventListener("click", showVacancy);
  // The workspace can resize without a window resize (dragging, focus mode, tabs).
  let active = true;
  const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(entries => {
    const rect = entries[0]?.contentRect;
    if (active && rect && rect.width > 0 && rect.height > 0) chart.resize();
  });
  observer?.observe(chartDom);
  const dispose = chart.dispose.bind(chart);
  chart.dispose = () => {
    if (!active) return;
    active = false;
    observer?.disconnect();
    motion?.removeEventListener('change', syncMotion);
    details?.removeEventListener('toggle', reportReading);
    dataHost?.replaceChildren();
    chartDom.hidden = false;
    rentButton?.removeEventListener("click", showRent);
    vacancyButton?.removeEventListener("click", showVacancy);
    dispose();
  };

  return chart;
}
