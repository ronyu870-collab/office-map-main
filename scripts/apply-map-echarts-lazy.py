from __future__ import annotations

import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
TARGET = ROOT / "src/services/MapController.ts"


def replace_once(text: str, old: str, new: str, label: str) -> str:
    if old not in text:
        raise RuntimeError(f"missing exact replacement target: {label}")
    return text.replace(old, new, 1)


def sub_once(text: str, pattern: str, replacement: str, label: str) -> str:
    updated, count = re.subn(pattern, replacement, text, count=1, flags=re.S)
    if count != 1:
        raise RuntimeError(f"expected one regex replacement for {label}, got {count}")
    return updated


text = TARGET.read_text(encoding="utf-8")

static_imports = '''import * as echarts from "echarts/core";
import { BarChart, LineChart } from "echarts/charts";
import {
  GridComponent,
  TooltipComponent,
  LegendComponent,
} from "echarts/components";
import { CanvasRenderer } from "echarts/renderers";
'''
text = replace_once(text, static_imports, "", "remove static ECharts imports")

echarts_registration = '''echarts.use([
  BarChart,
  LineChart,
  GridComponent,
  TooltipComponent,
  LegendComponent,
  CanvasRenderer,
]);
'''
text = replace_once(text, echarts_registration, "", "remove top-level ECharts registration")

text = sub_once(
    text,
    r'/\*\* 初始化趋势图表 — 仅负责渲染，调用前确保容器可见且有尺寸 \*/\nfunction initTrendChart\(.*?\n\}\n\n(?=function escapeHtml)',
    "",
    "remove embedded trend chart runtime",
)

old_render = '''            // 等待下一帧确保容器有尺寸后再初始化图表
            requestAnimationFrame(() => {
              chartDom.innerHTML = "";
              const chart = initTrendChart(chartDom, chartData);
              if (chart) trend.chart = chart;
            });
'''
new_render = '''            // ECharts 仅在用户明确打开趋势面板且确有历史数据时加载。
            // 动态模块加载期间用户可能关闭面板或切换楼宇，因此渲染前后都做竞态保护。
            void import("./map/trendChartRuntime")
              .then(({ initTrendChart }) => {
                if (
                  trend.buildingId !== buildingId ||
                  panel.style.display === "none"
                ) {
                  return;
                }

                requestAnimationFrame(() => {
                  if (
                    trend.buildingId !== buildingId ||
                    panel.style.display === "none"
                  ) {
                    return;
                  }

                  chartDom.innerHTML = "";
                  const chart = initTrendChart(chartDom, chartData);
                  if (chart) trend.chart = chart;
                });
              })
              .catch((error) => {
                if (
                  trend.buildingId !== buildingId ||
                  panel.style.display === "none"
                ) {
                  return;
                }
                console.error("[MapController] 趋势图运行时加载失败:", error);
                chartDom.innerHTML =
                  '<div style="display:flex;align-items:center;justify-content:center;height:100%;color:#ef4444;font-size:12px;">趋势图加载失败，请稍后重试</div>';
              });
'''
text = replace_once(text, old_render, new_render, "replace trend chart render with lazy runtime")

TARGET.write_text(text, encoding="utf-8")
