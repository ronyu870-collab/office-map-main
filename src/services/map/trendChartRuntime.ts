"use client";

import * as echarts from "echarts/core";
import { LineChart } from "echarts/charts";
import { GridComponent, TooltipComponent } from "echarts/components";
import { CanvasRenderer } from "echarts/renderers";

echarts.use([LineChart, GridComponent, TooltipComponent, CanvasRenderer]);

export interface TrendChartDatum {
  year: number | string;
  quarter?: string;
  label?: string;
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
  const lastIndex = rentData.length - 1;

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
      grid: { top: 15, bottom: 25, left: 30, right: 30 },
      tooltip: {
        trigger: "axis",
        valueFormatter: (value: unknown) =>
          value == null ? "未提供" : isRent ? `¥${String(value)}` : `${String(value)}%`,
      },
      xAxis: {
        type: "category",
        data: xAxisData,
        axisLabel: {
          fontSize: 10,
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
          show: false,
          scale: true,
          min: range.min,
          max: range.max,
          splitLine: { show: false },
        },
      ],
      series: [
        {
          type: "line",
          data,
          smooth: true,
          symbol: (_: unknown, params: { dataIndex: number }) =>
            params.dataIndex === 0 || params.dataIndex === lastIndex
              ? "circle"
              : "none",
          symbolSize: 6,
          itemStyle: { color: isRent ? "#003e7e" : "#f59e0b" },
          lineStyle: { width: 3 },
          label: {
            show: true,
            position: isRent ? "top" : "bottom",
            offset: [0, isRent ? -4 : 4],
            color: isRent ? "#003e7e" : "#b45309",
            fontSize: 10,
            fontWeight: 800,
            formatter: (params: { dataIndex: number; value: unknown }) =>
              params.dataIndex === 0 || params.dataIndex === lastIndex
                ? isRent
                  ? `¥${String(params.value)}`
                  : `${String(params.value)}%`
                : "",
          },
        },
      ],
    };
  };

  chart.setOption(buildOption("rent"));
  let currentMetric: "rent" | "vac" = "rent";
  onMetricView?.("rent");

  const rentButton = document.getElementById("chart-btn-rent");
  const vacancyButton = document.getElementById("chart-btn-vac");

  const setActive = (active: "rent" | "vac") => {
    if (active === currentMetric) return;
    chart.setOption(buildOption(active), true);
    currentMetric = active;
    onMetricView?.(active);

    if (rentButton) {
      rentButton.style.background = active === "rent" ? "#003e7e" : "#fff";
      rentButton.style.color = active === "rent" ? "#fff" : "#64748b";
      rentButton.style.borderColor = active === "rent" ? "#003e7e" : "#e2e8f0";
    }

    if (vacancyButton) {
      vacancyButton.style.background = active === "vac" ? "#f59e0b" : "#fff";
      vacancyButton.style.color = active === "vac" ? "#fff" : "#64748b";
      vacancyButton.style.borderColor = active === "vac" ? "#f59e0b" : "#e2e8f0";
    }
  };

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
    rentButton?.removeEventListener("click", showRent);
    vacancyButton?.removeEventListener("click", showVacancy);
    dispose();
  };

  return chart;
}
