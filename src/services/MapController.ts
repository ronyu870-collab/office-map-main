/**
 * MapController：高德地图 JS API 终极控制器（去除冗杂框线、纯享双列UI、搜索聚焦、竞品分析雷达）
 */

"use client";

import * as echarts from "echarts/core";
import { BarChart, LineChart } from "echarts/charts";
import {
  GridComponent,
  TooltipComponent,
  LegendComponent,
} from "echarts/components";
import { CanvasRenderer } from "echarts/renderers";
import { supabase } from "./supabaseClient";
import { isDemoMode } from "@/src/config/demoMode";
import { getSessionFast } from "./Auth";
import { attachTitleTooltip } from "@/src/utils/titleTooltip";

echarts.use([
  BarChart,
  LineChart,
  GridComponent,
  TooltipComponent,
  LegendComponent,
  CanvasRenderer,
]);
import type { BuildingMetric, BuildingWithMetrics } from "@/src/types";
import type {
  BeijingMapData,
  DistrictBoundary,
  SubwayLine,
} from "@/src/utils/exportMapData";
import type { CompareGroup } from "@/src/components/SidebarFilter";

export interface LngLat {
  lng: number;
  lat: number;
}
export interface MapCenter extends LngLat {}

const DEFAULT_MAP_CENTER: MapCenter = { lng: 116.460787, lat: 39.905477 };
const DEFAULT_MAP_ZOOM = 11.2;
export interface BuildingMarkerData {
  id?: string;
  name?: string;
  district?: string;
  position: LngLat;
  rent?: number;
  vacancyRate?: number;
  vacancyArea?: number;
  totalArea?: number;
  grade?: string;
  leed?: string;
  [key: string]: unknown;
}

export type RenderMode = "default" | "rent" | "vacancy" | "leed";

/**
 * Action Module Configuration Interface
 * Defines the structure for bottom panel action modules
 */
export interface ActionModule {
  id: string;
  label: string;
  icon: string;
  enabled: boolean;
  onClick?: string; // JavaScript code for onclick handler
}

/**
 * Action Modules Configuration
 * Defines the core action modules in the bottom panel
 * - 周边项目对比: Active module with click handler
 * - 最新销控: Grayed/disabled module (future functionality)
 */
export const ACTION_MODULES: ActionModule[] = [
  {
    id: "compare-nearby",
    label: "周边项目对比",
    icon: "🎯",
    enabled: true,
    // onClick will be dynamically generated with building-specific parameters
  },
  {
    id: "latest-sales",
    label: "最新销控",
    icon: "📊",
    enabled: false,
  },
];

type AMapLike = unknown;

function isBrowser(): boolean {
  return typeof window !== "undefined" && typeof document !== "undefined";
}
function extractToken(raw: string): string {
  const trimmed = String(raw).trim();
  const m = trimmed.match(/^[0-9A-Za-z]+/);
  return m?.[0] || trimmed.split(/\s+/)[0];
}
function getSafeAmapKey(): string {
  return extractToken(
    String(
      process.env.NEXT_PUBLIC_AMAP_KEY || "",
    ),
  );
}
function getSafeAmapSecurityCode(): string {
  return extractToken(
    String(
      process.env.NEXT_PUBLIC_AMAP_SECURITY_CODE || "",
    ),
  );
}

let _amapLoadPromise: Promise<any> | null = null;

function toFiniteNumber(input: unknown): number {
  const n =
    typeof input === "number"
      ? input
      : typeof input === "string"
        ? Number(input.trim())
        : Number.NaN;
  return Number.isFinite(n) ? n : 0;
}
function toNullableFiniteNumber(input: unknown): number | null {
  const n =
    typeof input === "number"
      ? input
      : typeof input === "string"
        ? Number(input.trim())
        : Number.NaN;
  return Number.isFinite(n) ? n : null;
}

function pickLatestMetric(metrics: BuildingMetric[]): BuildingMetric | null {
  if (!Array.isArray(metrics) || metrics.length === 0) return null;
  const sorted = [...metrics].sort((a, b) => {
    const ay = a.record_year ?? 0,
      by = b.record_year ?? 0;
    if (ay !== by) return by - ay;
    return (b.record_quarter ?? 0) - (a.record_quarter ?? 0);
  });
  return sorted[0] ?? null;
}

/** 将 Supabase 原始行转换为 BuildingWithMetrics（与 fetchMapData 使用相同的清洗逻辑） */
function transformBuildingRow(r: Record<string, unknown>): BuildingWithMetrics {
  const metricsRaw: Record<string, unknown>[] = Array.isArray(r.building_metrics)
    ? r.building_metrics
    : [];
  const metrics: BuildingMetric[] = metricsRaw
    .map((rm: Record<string, unknown>) => ({
      id: String(rm.id ?? ""),
      building_id: String(rm.building_id ?? ""),
      total_area: toFiniteNumber(rm.total_area),
      asking_rent: toFiniteNumber(rm.asking_rent),
      management_fee: toFiniteNumber(rm.management_fee),
      face_rent: toFiniteNumber(rm.face_rent),
      rent_free_period: toFiniteNumber(rm.rent_free_period),
      net_effective_rent: toFiniteNumber(rm.net_effective_rent),
      vacancy_rate: toFiniteNumber(rm.vacancy_rate),
      vacant_area: toFiniteNumber(rm.vacant_area),
      record_year: toFiniteNumber(rm.record_year),
      record_quarter: toFiniteNumber(rm.record_quarter),
    }))
    .filter((m: BuildingMetric) => m.id !== "" && m.building_id !== "");
  return {
    id: String(r.id ?? ""),
    name: String(r.name ?? ""),
    submarket: String(r.submarket ?? ""),
    grade: String(r.grade ?? ""),
    city: String(r.city ?? ""),
    district: String(r.district ?? ""),
    location_lng: toNullableFiniteNumber(r.location_lng) as number,
    location_lat: toNullableFiniteNumber(r.location_lat) as number,
    completion_year: String(r.completion_year ?? ""),
    leed_certification: String(r.leed_certification ?? ""),
    owner: r.owner ? String(r.owner) : undefined,
    property_management: r.property_management ? String(r.property_management) : undefined,
    contact_phone: r.contact_phone ? String(r.contact_phone) : undefined,
    metrics,
  };
}

/** 初始化趋势图表 — 仅负责渲染，调用前确保容器可见且有尺寸 */
function initTrendChart(
  chartDom: HTMLElement,
  histData: any[],
): echarts.ECharts | null {
  if (!chartDom || !histData?.length) return null;
  // 销毁旧实例
  const existing = echarts.getInstanceByDom(chartDom);
  if (existing) existing.dispose();
  const myChart = echarts.init(chartDom);
  const xAxisData = histData.map((r: any) =>
    r.label || (r.quarter ? `${r.year}${r.quarter}` : `${r.year}`),
  );
  const rentData = histData.map((r: any) =>
    Number(Number(r.net_effective_rent).toFixed(1)),
  );
  const vacData = histData.map((r: any) =>
    Number((Number(r.vacancy_rate) * 100).toFixed(1)),
  );
  const lastIdx = rentData.length - 1;
  const calcAxisRange = (data: number[]) => {
    const minVal = Math.min(...data),
      maxVal = Math.max(...data);
    const range = maxVal - minVal || Math.abs(minVal) * 0.2 || 1;
    return { min: minVal - range * 0.35, max: maxVal + range * 0.15 };
  };
  const buildOption = (mode: "rent" | "vac") => {
    const isRent = mode === "rent";
    const data = isRent ? rentData : vacData;
    const range = isRent ? calcAxisRange(rentData) : calcAxisRange(vacData);
    return {
      grid: { top: 15, bottom: 25, left: 30, right: 30 },
      tooltip: {
        trigger: "axis",
        valueFormatter: (v: any) => (isRent ? `¥${v}` : `${v}%`),
      },
      xAxis: {
        type: "category",
        data: xAxisData,
        axisLabel: { fontSize: 10, color: "#64748b", showMaxLabel: true, showMinLabel: true },
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
          symbol: (_: any, p: any) =>
            p.dataIndex === 0 || p.dataIndex === lastIdx ? "circle" : "none",
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
            formatter: (p: any) =>
              p.dataIndex === 0 || p.dataIndex === lastIdx
                ? isRent
                  ? `¥${p.value}`
                  : `${p.value}%`
                : "",
          },
        },
      ],
    };
  };
  myChart.setOption(buildOption("rent"));
  // 绑定按钮事件
  const btnRent = document.getElementById("chart-btn-rent");
  const btnVac = document.getElementById("chart-btn-vac");
  const setActive = (active: "rent" | "vac") => {
    myChart.setOption(buildOption(active), true);
    if (btnRent) {
      btnRent.style.background = active === "rent" ? "#003e7e" : "#fff";
      btnRent.style.color = active === "rent" ? "#fff" : "#64748b";
      btnRent.style.borderColor = active === "rent" ? "#003e7e" : "#e2e8f0";
    }
    if (btnVac) {
      btnVac.style.background = active === "vac" ? "#f59e0b" : "#fff";
      btnVac.style.color = active === "vac" ? "#fff" : "#64748b";
      btnVac.style.borderColor = active === "vac" ? "#f59e0b" : "#e2e8f0";
    }
  };
  btnRent?.addEventListener("click", () => setActive("rent"));
  btnVac?.addEventListener("click", () => setActive("vac"));
  return myChart;
}

function escapeHtml(input: unknown): string {
  return String(input ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
function formatZhNumber(input: number): string {
  return !Number.isFinite(input)
    ? "-"
    : input.toLocaleString("zh-CN", { maximumFractionDigits: 2 });
}
function formatVacancyRate(vacancyRate: number): string {
  return !Number.isFinite(vacancyRate)
    ? "-"
    : `${(vacancyRate <= 1 ? vacancyRate * 100 : vacancyRate).toFixed(1)}%`;
}
/** 前端显示用：等级 P→A（超甲级归入甲级），BP 保持不变，数据库不改 */
function displayGrade(grade: string | undefined | null): string {
  const g = (grade || "—").trim();
  if (!g || g === "—") return "—";
  const upper = g.toUpperCase();
  if (upper === "BP") return g;
  if (upper.includes("P")) return g.replace(/P/gi, "A");
  return g;
}

// ================== 核心视觉渲染引擎 ==================
function getMarkerStyle(
  building: any,
  latestMetric: any,
  mode: RenderMode,
  isFuture: boolean = false,
  comparisonGroupColor?: string,
) {
  let bgColor = "#003e7e";
  let borderColor = "#ffffff";
  let textColor = "#ffffff";
  let text = "A";
  let fontSize = "12px";

  if (mode === "default") {
    if (isFuture) {
      bgColor = "#10b981";
      borderColor = "#ffffff";
      text = "F";
    } else {
      const gradeStr = (building.grade ?? "").toUpperCase();
      if (gradeStr.includes("BP")) {
        bgColor = "#d97706";
        text = "BP";
        fontSize = "9px";
      } else if (gradeStr.includes("A") || gradeStr.includes("P")) {
        bgColor = "#003e7e";
        text = "A";
      } else if (gradeStr.includes("B")) {
        bgColor = "#059669";
        text = "B";
      } else {
        bgColor = "#94a3b8";
        text = "U";
      }
    }
  } else if (mode === "rent") {
    const rent = latestMetric ? Number(latestMetric.net_effective_rent) : null;
    fontSize = "10px";
    if (!rent || !Number.isFinite(rent) || isFuture) {
      bgColor = "#94a3b8";
      text = "-";
    } else {
      text = Math.round(rent).toString();
      if (rent >= 300)
        bgColor = "#ef4444"; // 极高租金 - 红色
      else if (rent >= 200)
        bgColor = "#f97316"; // 高租金 - 橙色
      else if (rent >= 100)
        bgColor = "#f59e0b"; // 中等租金 - 琥珀色
      else bgColor = "#10b981"; // 较低租金 - 绿色
    }
  } else if (mode === "vacancy") {
    const vac = latestMetric ? Number(latestMetric.vacancy_rate) : null;
    fontSize = "10px";
    if (vac === null || !Number.isFinite(vac) || isFuture) {
      bgColor = "#94a3b8";
      text = "-";
    } else {
      const vacPct = vac <= 1 ? vac * 100 : vac;
      text = Math.round(vacPct) + "%";
      fontSize = "9px";
      if (vacPct >= 30)
        bgColor = "#ef4444"; // 高空置风险 - 红色
      else if (vacPct >= 20)
        bgColor = "#f97316"; // 中高空置 - 橙色
      else if (vacPct >= 10)
        bgColor = "#f59e0b"; // 中等空置 - 琥珀色
      else bgColor = "#10b981"; // 低空置健康 - 绿色
    }
  } else if (mode === "leed") {
    const leed = (
      building.leed_certification ??
      building.leed ??
      ""
    ).toUpperCase();
    if (leed.includes("PLATINUM")) {
      bgColor = "#e0f2fe";
      borderColor = "#38bdf8";
      textColor = "#0369a1";
      text = "P"; // 铂金
    } else if (leed.includes("GOLD")) {
      bgColor = "#fef3c7";
      borderColor = "#fbbf24";
      textColor = "#b45309";
      text = "G"; // 黄金
    } else if (leed.includes("SILVER")) {
      bgColor = "#f1f5f9";
      borderColor = "#94a3b8";
      textColor = "#475569";
      text = "S"; // 白银
    } else {
      bgColor = "#f8fafc";
      borderColor = "#e2e8f0";
      textColor = "#94a3b8";
      text = "N"; // 无认证
    }
  }

  // 对比组颜色覆盖：当有对比组匹配时，用组颜色替代默认颜色
  if (comparisonGroupColor) {
    bgColor = comparisonGroupColor;
    borderColor = "#ffffff";
    textColor = "#ffffff";
  }

  return { bgColor, borderColor, textColor, text, fontSize };
}

function matchesGroupGrades(grade: string, groupGrades: string[]): boolean {
  if (groupGrades.length === 0) return true;
  const g = (grade || "").toUpperCase();
  for (const fg of groupGrades) {
    if (fg === "产业园" && g.includes("BP")) return true;
    if (
      fg === "甲级" &&
      (g.includes("A") || g.includes("P")) &&
      !g.includes("BP")
    )
      return true;
    if (fg === "乙级" && g.includes("B") && !g.includes("BP")) return true;
  }
  return false;
}

function findBuildingGroupColor(
  building: any,
  groups: CompareGroup[],
): string | undefined {
  for (let i = groups.length - 1; i >= 0; i--) {
    const g = groups[i];
    if (
      g.submarkets.length > 0 &&
      building.submarket &&
      !g.submarkets.includes(building.submarket)
    )
      continue;
    if (g.grades.length > 0 && !matchesGroupGrades(building.grade, g.grades))
      continue;
    if (
      g.districts.length > 0 &&
      building.district &&
      !g.districts.includes(building.district)
    )
      continue;
    return g.color;
  }
  return undefined;
}

export class MapController<T extends BuildingMarkerData = BuildingMarkerData> {
  private AMap: any | null = null;
  private map: any | null = null;
  private infoWindow: any | null = null;

  private markers: any[] = [];
  private dotMarkers: any[] = []; // Level 3: 小圆点标记
  private futureMarkers: any[] = [];
  private _cachedFutureSuppliesPromise: Promise<any[]> | null = null;
  private submarketMarkers: any[] = [];
  private currentRenderMode: "submarket" | "dot" | "building" | null = null;
  private _zoomListenerBound = false;
  private clusterer: any | null = null;

  private districtPolygons: any[] = [];
  private subwayPolyline: any | null = null;
  private stationMarker: any | null = null;
  private radiusCircle: any | null = null;

  private compRadiusCircle: any | null = null;
  private compCenterMarker: any | null = null;
  private compExitButton: HTMLDivElement | null = null;
  private _isClearingCompetitor = false;

  // 🌟 CL-010: 周边项目对比状态
  private _compCenterPoint: [number, number] | null = null;
  private _compBuildingId: string | null = null;
  private _compCurrentRent: number = 0;
  private _compRadius: number = 5000;
  private _compDistances: Map<string, number> = new Map();
  // CL-012: 对比筛选条件
  private _compFilterGrades: Set<string> = new Set();
  private _compFilterLeeds: Set<string> = new Set();
  private _compFilterConds: Array<{
    field: string;
    op: string;
    value: number;
  }> = [];
  private _compFilterOpen: boolean = false;

  // 悬停提示框
  private hoverTooltip: HTMLDivElement | null = null;
  private hoverTimeout: ReturnType<typeof setTimeout> | null = null;

  private _cachedMapDataPromise: Promise<BuildingWithMetrics[]> | null = null;
  private _allBuildingsCache: BuildingWithMetrics[] = [];

  // 楼宇显示覆盖规则缓存: Map<buildingId, Map<fieldName, override>>
  private _displayOverridesCache: Map<string, Map<string, { display_label: string; display_value: string }>> = new Map();

  // 新增：本地地图数据缓存
  private _localMapDataPromise: Promise<BeijingMapData> | null = null;
  private _localMapDataCache: BeijingMapData | null = null;

  private _destroyed = false;
  private _isDemo = false;

  // 管理员模式
  private _isAdmin = false;
  private _currentUserId: string | null = null;
  private _onEditBuildingMetrics: ((buildingId: string, buildingName: string) => void) | null = null;

  constructor(amap?: AMapLike) {
    this.AMap = (amap as any) ?? null;
    this._initDemoMode();

    if (isBrowser()) {
      // 初始化趋势图状态
      (window as any).__colliers_trend = {
        buildingId: null,
        data: null,
        chart: null,
      };
      // Wrap analyzeCompetitors with error handling and logging
      (window as any).__colliers_analyzeCompetitors = (
        buildingId: string,
        lng: number,
        lat: number,
        rent: number,
      ) => {
        try {
          // Log module click event for analytics
          console.log("[Action Module] 周边项目对比 clicked", {
            buildingId,
            lng,
            lat,
            rent,
            timestamp: new Date().toISOString(),
          });

          // Validate inputs
          if (
            !buildingId ||
            typeof lng !== "number" ||
            typeof lat !== "number" ||
            typeof rent !== "number"
          ) {
            throw new Error("Invalid parameters for competitor analysis");
          }

          // Check if map controller is initialized
          if (this._destroyed) {
            throw new Error("Map controller has been destroyed");
          }

          if (!this.map || !this.AMap) {
            throw new Error("Map not initialized");
          }

          // Execute the analysis
          this.analyzeCompetitors(buildingId, lng, lat, rent);
        } catch (error) {
          console.error("[Action Module] Failed to analyze competitors", error);

          // Display user-friendly error message
          const errorMessage =
            error instanceof Error ? error.message : "未知错误";
          alert(
            `周边项目对比功能暂时不可用：${errorMessage}\n\n请稍后再试或联系技术支持。`,
          );
        }
      };

      // 🌟 新增：联系方式弹窗全局函数
      (window as any).__colliers_showContactModal = (
        buildingName: string,
        contactPhone: string,
      ) => {
        try {
          console.log("[Action Module] 联系方式 clicked", {
            buildingName,
            contactPhone,
            timestamp: new Date().toISOString(),
          });

          // 创建遮罩层
          const overlay = document.createElement("div");
          overlay.id = "__colliers_contact_modal_overlay";
          overlay.style.cssText = `
            position: fixed;
            inset: 0;
            z-index: 99999;
            display: flex;
            align-items: center;
            justify-content: center;
            background: rgba(0, 0, 0, 0.5);
            backdrop-filter: blur(4px);
          `;

          // 创建弹窗内容
          const hasPhone = contactPhone && contactPhone.trim() !== "";
          const modalContent = `
            <div style="
              position: relative;
              width: 90%;
              max-width: 420px;
              background: #ffffff;
              border-radius: 12px;
              border: 1px solid #e2e8f0;
              box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04);
              padding: 24px;
              font-family: ui-sans-serif, system-ui, -apple-system;
            ">
              <!-- 关闭按钮 -->
              <button 
                onclick="document.getElementById('__colliers_contact_modal_overlay').remove()"
                style="
                  position: absolute;
                  top: 16px;
                  right: 16px;
                  width: 32px;
                  height: 32px;
                  display: flex;
                  align-items: center;
                  justify-content: center;
                  border-radius: 50%;
                  border: none;
                  background: transparent;
                  color: #94a3b8;
                  cursor: pointer;
                  transition: all 0.2s;
                "
                onmouseover="this.style.background='#f1f5f9'; this.style.color='#475569';"
                onmouseout="this.style.background='transparent'; this.style.color='#94a3b8';"
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <line x1="18" y1="6" x2="6" y2="18"></line>
                  <line x1="6" y1="6" x2="18" y2="18"></line>
                </svg>
              </button>
              
              <!-- 标题 -->
              <div style="margin-bottom: 20px;">
                <h3 style="font-size: 18px; font-weight: 900; color: #0f172a; margin: 0 0 4px 0;">${buildingName}</h3>
                <p style="font-size: 14px; color: #64748b; margin: 0;">联系方式</p>
              </div>
              
              <!-- 内容区域 -->
              <div style="
                border-radius: 8px;
                border: 1px solid #e2e8f0;
                background: #f8fafc;
                padding: 20px;
              ">
                ${
                  hasPhone
                    ? `
                  <div style="display: flex; align-items: center; gap: 16px;">
                    <div style="
                      flex-shrink: 0;
                      width: 48px;
                      height: 48px;
                      display: flex;
                      align-items: center;
                      justify-content: center;
                      border-radius: 50%;
                      background: #dbeafe;
                    ">
                      <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#3b82f6" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                        <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"></path>
                      </svg>
                    </div>
                    <div style="flex: 1; min-width: 0;">
                      <div style="font-size: 12px; color: #64748b; margin-bottom: 4px;">联系电话</div>
                      <div style="font-size: 20px; font-weight: 900; color: #0f172a;">${contactPhone}</div>
                    </div>
                    <a 
                      href="tel:${contactPhone}"
                      style="
                        flex-shrink: 0;
                        background: #3b82f6;
                        color: #ffffff;
                        border: none;
                        border-radius: 8px;
                        padding: 10px 20px;
                        font-size: 14px;
                        font-weight: 700;
                        text-decoration: none;
                        cursor: pointer;
                        transition: all 0.2s;
                      "
                      onmouseover="this.style.background='#2563eb';"
                      onmouseout="this.style.background='#3b82f6';"
                    >
                      拨打
                    </a>
                  </div>
                `
                    : `
                  <div style="
                    display: flex;
                    flex-direction: column;
                    align-items: center;
                    justify-content: center;
                    padding: 32px 16px;
                    text-align: center;
                  ">
                    <svg xmlns="http://www.w3.org/2000/svg" width="56" height="56" viewBox="0 0 24 24" fill="none" stroke="#cbd5e1" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" style="margin-bottom: 16px;">
                      <circle cx="12" cy="12" r="10"></circle>
                      <line x1="12" y1="8" x2="12" y2="12"></line>
                      <line x1="12" y1="16" x2="12.01" y2="16"></line>
                    </svg>
                    <p style="font-size: 15px; font-weight: 700; color: #475569; margin: 0 0 8px 0;">暂无联系方式数据</p>
                    <p style="font-size: 13px; color: #94a3b8; margin: 0;">该楼宇尚未录入联系电话</p>
                  </div>
                `
                }
              </div>
            </div>
          `;

          overlay.innerHTML = modalContent;

          // 点击遮罩层关闭弹窗
          overlay.addEventListener("click", (e) => {
            if (e.target === overlay) {
              overlay.remove();
            }
          });

          document.body.appendChild(overlay);
        } catch (error) {
          console.error("[Action Module] Failed to show contact modal", error);
          alert("联系方式弹窗加载失败，请稍后再试。");
        }
      };

      (window as any).__colliers_toggleTrend = (buildingId: string) => {
        const panel = document.getElementById("info-chart-panel");
        if (!panel) return;
        const trend = (window as any).__colliers_trend;
        const isSameBuilding = trend?.buildingId === buildingId;
        const showing = panel.style.display === "none";
        // 切换面板显示
        panel.style.display = showing ? "block" : "none";
        if (!showing) {
          // 隐藏时销毁图表
          if (trend?.chart) {
            trend.chart.dispose();
            trend.chart = null;
          }
          return;
        }
        // 显示面板：如果同一建筑且已有图表，只需 resize
        if (isSameBuilding && trend?.chart) {
          requestAnimationFrame(() => trend.chart.resize());
          return;
        }
        // 显示面板：需要获取数据并初始化图表
        const chartDom = document.getElementById(
          "info-chart-container",
        ) as HTMLElement;
        if (!chartDom) return;
        // 重置状态
        trend.buildingId = buildingId;
        trend.data = null;
        if (trend.chart) {
          trend.chart.dispose();
          trend.chart = null;
        }
        // 显示加载状态
        chartDom.innerHTML =
          '<div style="display:flex;align-items:center;justify-content:center;height:100%;color:#94a3b8;font-size:12px;">加载中...</div>';
        // 获取数据：最新季度 + 前面年份的Q4，最近6年
        supabase
          .from("building_metrics")
          .select("record_year, record_quarter, net_effective_rent, vacancy_rate")
          .eq("building_id", buildingId)
          .order("record_year", { ascending: false })
          .order("record_quarter", { ascending: false })
          .then(({ data }) => {
            // 竞态保护：如果用户已切换到其他楼宇，跳过渲染
            if (trend.buildingId !== buildingId) return;
            if (!data?.length) {
              chartDom.innerHTML =
                '<div style="display:flex;align-items:center;justify-content:center;height:100%;color:#94a3b8;font-size:12px;">暂无历史数据</div>';
              return;
            }

            // 找到最新的一条数据
            const latest = data[0];
            const latestYear = latest.record_year;
            const latestQuarter = latest.record_quarter;

            // 构建结果：最新季度 + 前面年份的Q4（共6条）
            const result = [latest];
            const startYear = latestYear - 5;
            for (let y = latestYear - 1; y >= startYear; y--) {
              const q4 = data.find(r => r.record_year === y && r.record_quarter === 4);
              if (q4) result.push(q4);
            }
            result.reverse(); // 按年份升序

            // 转换为图表数据，X轴标签：最新显示"年份+季度"，其他只显示"年份"
            const chartData = result.map(r => ({
              year: r.record_year,
              quarter: r.record_year === latestYear && r.record_quarter === latestQuarter
                ? `Q${r.record_quarter}`  // 最新季度显示季度
                : '',                       // 其他只显示年份
              label: r.record_year === latestYear && r.record_quarter === latestQuarter
                ? `${r.record_year}Q${r.record_quarter}`  // 如 "2026Q2"
                : `${r.record_year}`,                       // 如 "2025"
              net_effective_rent: r.net_effective_rent,
              vacancy_rate: r.vacancy_rate,
            }));
            trend.data = chartData;
            // 等待下一帧确保容器有尺寸后再初始化图表
            requestAnimationFrame(() => {
              chartDom.innerHTML = "";
              const chart = initTrendChart(chartDom, chartData);
              if (chart) trend.chart = chart;
            });
          });
      };
    }
  }

  async initMap(
    containerId: string,
    center?: MapCenter,
    options?: { zoom?: number; viewMode?: "2D" | "3D"; mapStyle?: string },
  ): Promise<void> {
    if (!isBrowser() || !containerId || !String(containerId).trim()) return;
    const resolvedCenter = center ?? DEFAULT_MAP_CENTER;
    this._destroyed = false;

    try {
      const securityCode = getSafeAmapSecurityCode();
      if (securityCode && securityCode !== "这里粘贴你的真实高德安全密钥") {
        (window as any)._AMapSecurityConfig = { securityJsCode: securityCode };
      }
      const amapKey = getSafeAmapKey();

      if (!_amapLoadPromise) {
        _amapLoadPromise = (async () => {
          const mod = await import("@amap/amap-jsapi-loader");
          const loader = (mod as any).default ?? mod;
          return loader.load({
            key: amapKey,
            version: "2.0",
            // 移除 DistrictSearch 和 LineSearch，不再需要
            plugins: [
              "AMap.Scale",
              "AMap.ToolBar",
              "AMap.InfoWindow",
              "AMap.GeometryUtil",
            ],
          });
        })();
      }

      const AMap = await _amapLoadPromise;
      if (this._destroyed) return;
      this.AMap = AMap;

      const containerEl = document.getElementById(containerId);
      if (!containerEl) return;

      this.map = new AMap.Map(containerId, {
        zoom: options?.zoom ?? DEFAULT_MAP_ZOOM,
        center: [resolvedCenter.lng, resolvedCenter.lat],
        viewMode: options?.viewMode ?? "2D",
        mapStyle: options?.mapStyle ?? "amap://styles/whitesmoke",
      });
      this.infoWindow = new AMap.InfoWindow({
        isCustom: false,
        offset: new AMap.Pixel(0, -35),
        autoMove: true,
      });

      // CL-041: 强制 AMap overlay 层高于浮动栏(z-index:300)，确保 InfoWindow 不被遮挡
      if (!document.getElementById("amap-overlay-fix")) {
        const style = document.createElement("style");
        style.id = "amap-overlay-fix";
        style.textContent = ".amap-overlays { z-index: 400 !important; }";
        document.head.appendChild(style);
      }

      // 🌟 CL-008: 点击地图空白区域自动关闭 InfoWindow（不退出周边项目对比模式）
      this.map.on("click", () => {
        if (this.infoWindow) {
          this._isClearingCompetitor = true;
          this.infoWindow.close();
          this._isClearingCompetitor = false;
        }
      });

      // 预加载本地地图数据
      this.loadLocalMapData().catch((e) =>
        console.warn("本地地图数据加载失败:", e),
      );

      this.fetchAndRenderMarkers().catch((e) =>
        console.error("Marker渲染失败:", e),
      );
    } catch (err) {
      console.error("高德地图初始化失败:", err);
    }
  }

  public analyzeCompetitors(
    buildingId: string,
    lng: number,
    lat: number,
    currentRent: number,
  ) {
    if (!this.map || !this.AMap || !this._allBuildingsCache.length) return;

    this._isClearingCompetitor = true;
    this.infoWindow?.close?.();
    this._isClearingCompetitor = false;
    this.clearCompetitorElements();
    this.clearSubwayElements();

    // 🌟 CL-010: 存储状态，支持动态切换距离
    this._compCenterPoint = [lng, lat];
    this._compBuildingId = buildingId;
    this._compCurrentRent = currentRent;
    this._compRadius = 5000;
    this._compDistances.clear();

    this._renderCompetitorsByRadius();
  }

  // 🌟 CL-010: 按半径筛选并渲染周边项目
  private _renderCompetitorsByRadius() {
    if (
      !this.map ||
      !this.AMap ||
      !this._compCenterPoint ||
      !this._compBuildingId
    )
      return;

    const centerPoint = this._compCenterPoint;
    const buildingId = this._compBuildingId;
    const radius = this._compRadius;

    // 计算距离并筛选
    this._compDistances.clear();
    const hasGradeFilter = this._compFilterGrades.size > 0;
    const hasLeedFilter = this._compFilterLeeds.size > 0;
    const hasConds = this._compFilterConds.length > 0;

    const competitors = this._allBuildingsCache.filter((b) => {
      if (b.id === buildingId) return false;
      if (b.location_lng == null || b.location_lat == null) return false;
      const dist = this.calculateDistance(
        [b.location_lng, b.location_lat],
        centerPoint,
      );
      this._compDistances.set(b.id, dist);
      if (dist > radius) return false;

      // 等级筛选（甲级含P/超甲级）
      if (hasGradeFilter) {
        const g = (b.grade || "").trim().toUpperCase();
        let match = false;
        for (const fg of this._compFilterGrades) {
          if (fg === "产业园" && g.includes("BP")) {
            match = true;
            break;
          }
          if (
            fg === "甲级" &&
            (g.includes("A") || g.includes("P")) &&
            !g.includes("BP")
          ) {
            match = true;
            break;
          }
          if (fg === "乙级" && g.includes("B") && !g.includes("BP")) {
            match = true;
            break;
          }
        }
        if (!match) return false;
      }

      // LEED 筛选
      if (hasLeedFilter) {
        const l = b.leed_certification;
        if (!l || l === "NULL" || l === "" || !this._compFilterLeeds.has(l))
          return false;
      }

      // 数值条件筛选
      if (hasConds) {
        const latest = pickLatestMetric(b.metrics);
        if (!latest) return false;
        for (const cond of this._compFilterConds) {
          let val: number;
          if (cond.field === "vacancy_rate")
            val = Number(latest.vacancy_rate) * 100;
          else val = Number((latest as any)[cond.field]);
          if (!Number.isFinite(val)) return false;
          switch (cond.op) {
            case ">=":
              if (!(val >= cond.value)) return false;
              break;
            case "<=":
              if (!(val <= cond.value)) return false;
              break;
            case ">":
              if (!(val > cond.value)) return false;
              break;
            case "<":
              if (!(val < cond.value)) return false;
              break;
          }
        }
      }

      return true;
    });

    if (competitors.length === 0) {
      const radiusLabel = radius < 1000 ? `${radius}m` : `${radius / 1000}km`;
      alert(`方圆${radiusLabel}内未发现其他周边项目。`);
    }

    // 清除旧的圆形和中心标记
    if (this.compRadiusCircle) this.map.remove(this.compRadiusCircle);
    if (this.compCenterMarker) this.map.remove(this.compCenterMarker);

    this.compCenterMarker = new this.AMap.Marker({
      position: centerPoint,
      content: `<div style="width:20px;height:20px;background:#f59e0b;border:3px solid #fff;border-radius:50%;box-shadow:0 0 8px rgba(0,0,0,0.4);"></div>`,
      offset: new this.AMap.Pixel(-10, -10),
      zIndex: 150,
    });

    this.compRadiusCircle = new this.AMap.Circle({
      center: centerPoint,
      radius,
      strokeColor: "#f59e0b",
      strokeOpacity: 0.6,
      strokeWeight: 2,
      strokeStyle: "dashed",
      fillColor: "#f59e0b",
      fillOpacity: 0.1,
      zIndex: 50,
      clickable: false,
    });

    this.map.add([this.compCenterMarker, this.compRadiusCircle]);

    // 渲染距离标记
    const clickedBuilding = this._allBuildingsCache.find(
      (b) => b.id === buildingId,
    );
    const markersToRender = clickedBuilding
      ? [clickedBuilding, ...competitors]
      : competitors;
    this._renderDistanceMarkers(markersToRender);

    this.map.setFitView([this.compRadiusCircle]);
    setTimeout(() => {
      if (this.map.getZoom() < 13.5) this.map.setZoom(13.6);
    }, 100);

    this.showCompExitButton();

    window.dispatchEvent(
      new CustomEvent("competitors-found", {
        detail: { buildings: markersToRender, targetBuildingId: buildingId },
      }),
    );
  }

  // 🌟 CL-010: 距离标记渲染（替代普通 marker）
  private _renderDistanceMarkers(buildings: any[]) {
    if (!this.map || !this.AMap) return;
    this.clearMarkers();

    for (const building of buildings) {
      const lng = building.location_lng;
      const lat = building.location_lat;
      if (!Number.isFinite(lng) || !Number.isFinite(lat)) continue;

      const dist = this._compDistances.get(building.id);
      const isCenter = building.id === this._compBuildingId;
      const distText = isCenter
        ? "目标"
        : dist != null
          ? `${(dist / 1000).toFixed(1)}km`
          : "";
      const bgColor = isCenter ? "#f59e0b" : "#3b82f6";
      const textColor = "#fff";

      const markerEl = `
        <div data-building-id="${building.id}" style="
          display:flex;flex-direction:column;align-items:center;gap:2px;
          transition: transform 0.2s;
        " onmouseover="this.style.transform='scale(1.15)'" onmouseout="this.style.transform='scale(1)'">
          <div style="
            width:26px;height:26px;border-radius:50%;
            background:${bgColor};border:2px solid #fff;
            box-shadow:0 4px 12px rgba(0,0,0,0.2);
            display:flex;align-items:center;justify-content:center;
            color:${textColor};font-weight:800;font-size:10px;
          ">${isCenter ? "★" : "●"}</div>
          <span style="
            font-size:10px;font-weight:700;color:#1e293b;
            background:rgba(255,255,255,0.92);border-radius:4px;
            padding:1px 5px;white-space:nowrap;
            box-shadow:0 1px 4px rgba(0,0,0,0.1);
          ">${distText}</span>
        </div>
      `;

      const marker = new this.AMap.Marker({
        position: [lng, lat],
        content: markerEl,
        offset: new this.AMap.Pixel(-13, -18),
        zIndex: isCenter ? 150 : 100,
      });

      marker.on("mouseover", (e: any) => {
        if (this.hoverTimeout) {
          clearTimeout(this.hoverTimeout);
          this.hoverTimeout = null;
        }
        const x = e.originEvent?.clientX || e.pixel?.getX() || 0;
        const y = e.originEvent?.clientY || e.pixel?.getY() || 0;
        this.showHoverTooltip(building, x, y);
      });
      marker.on("mouseout", () => {
        this.hoverTimeout = setTimeout(() => this.hideHoverTooltip(), 80);
      });
      marker.on("click", () => {
        // 切换 InfoWindow 时保护不退出周边项目对比模式
        this._isClearingCompetitor = true;
        this.infoWindow?.close?.();
        this._isClearingCompetitor = false;
        const latestMetric = pickLatestMetric(building.metrics);
        const containerDiv = document.createElement("div");
        containerDiv.innerHTML = this.buildInfoWindowContent(
          building,
          latestMetric,
        );
        const info = new this.AMap.InfoWindow({
          isCustom: false,
          content: containerDiv,
          offset: new this.AMap.Pixel(0, -35),
          autoMove: true,
        });
        this.infoWindow = info;
        info.on("close", () => {
          // 关闭时销毁图表
          const trend = (window as any).__colliers_trend;
          if (trend?.chart) {
            trend.chart.dispose();
            trend.chart = null;
          }
          const panel = document.getElementById("info-chart-panel");
          if (panel) panel.style.display = "none";
        });
        info.open(this.map, [lng, lat]);
      });

      this.markers.push(marker);
    }
    this.map.add(this.markers);
  }

  private clearCompetitorElements() {
    if (this.map) {
      if (this.compRadiusCircle) this.map.remove(this.compRadiusCircle);
      if (this.compCenterMarker) this.map.remove(this.compCenterMarker);
    }
    this.compRadiusCircle = null;
    this.compCenterMarker = null;
    this._compCenterPoint = null;
    this._compBuildingId = null;
    this._compCurrentRent = 0;
    this._compRadius = 5000;
    this._compDistances.clear();
    this._compFilterGrades.clear();
    this._compFilterLeeds.clear();
    this._compFilterConds = [];
    this._compFilterOpen = false;
    this.hideCompExitButton();
    // 通知外部：竞品分析已清除（联动右侧列表恢复）
    window.dispatchEvent(new Event("competitors-cleared"));
  }

  private showCompExitButton() {
    if (this.compExitButton) return;
    const wrapper = document.createElement("div");
    const currentRadiusKm = this._compRadius / 1000;

    const leedSet = new Set<string>();
    for (const b of this._allBuildingsCache) {
      const l = b.leed_certification;
      if (l && l !== "NULL" && l !== "") leedSet.add(l);
    }
    const leedList = Array.from(leedSet).sort();

    const NUM_FIELDS = [
      { value: "net_effective_rent", label: "净有效租金" },
      { value: "vacancy_rate", label: "空置率 (%)" },
      { value: "vacant_area", label: "空置面积" },
      { value: "total_area", label: "总面积" },
      { value: "management_fee", label: "物业费" },
    ];
    const OPS = [
      { value: ">=", label: "≥" },
      { value: "<=", label: "≤" },
      { value: ">", label: ">" },
      { value: "<", label: "<" },
    ];

    wrapper.innerHTML = `
      <div style="
        display:flex; flex-direction:column; gap:0;
        background: rgba(255,255,255,0.97); backdrop-filter: blur(12px);
        border: 1px solid #e2e8f0; border-radius: 10px;
        box-shadow: 0 4px 24px rgba(0,0,0,0.12);
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
        min-width: 520px;
      ">
        <div style="display:flex; align-items:center; gap:8px; padding:8px 16px;">
          <span style="width:8px;height:8px;border-radius:50%;background:#f59e0b;flex-shrink:0;"></span>
          <span style="font-size:13px;font-weight:600;color:#334155;white-space:nowrap;">周边项目对比</span>
          <span style="font-size:11px;color:#94a3b8;">|</span>
          <div class="comp-dist-btns" style="display:flex;gap:4px;">
            ${[0.5, 1, 3, 5]
              .map(
                (km) => `
              <button data-dist="${km}" style="
                font-size:11px;font-weight:${km === currentRadiusKm ? "700" : "500"};
                color:${km === currentRadiusKm ? "#f59e0b" : "#64748b"};
                background:${km === currentRadiusKm ? "#fffbeb" : "transparent"};
                border:1px solid ${km === currentRadiusKm ? "#f59e0b" : "#e2e8f0"};
                border-radius:6px;padding:3px 8px;cursor:pointer;transition:all 0.15s;
              ">${km < 1 ? "500m" : km + "km"}</button>
            `,
              )
              .join("")}
          </div>
          <span style="font-size:11px;color:#94a3b8;">|</span>
          <span class="comp-filter-toggle" style="font-size:11px;font-weight:600;color:#3b82f6;cursor:pointer;display:flex;align-items:center;gap:3px;white-space:nowrap;">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#3b82f6" stroke-width="2.5"><polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"/></svg>
            筛选
          </span>
          <span style="flex:1;"></span>
          <span class="comp-exit-btn" style="font-size:12px;font-weight:600;color:#ef4444;cursor:pointer;display:flex;align-items:center;gap:3px;white-space:nowrap;">
            退出
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#ef4444" stroke-width="2.5" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </span>
        </div>
        <div class="comp-filter-panel" style="display:none; border-top:1px solid #f1f5f9; padding:10px 16px; max-height:260px; overflow-y:auto;">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">
            <div style="font-size:10px;font-weight:700;color:#94a3b8;">项目等级</div>
            <span class="comp-filter-collapse" style="font-size:11px;color:#94a3b8;cursor:pointer;display:flex;align-items:center;gap:2px;padding:2px 6px;border-radius:4px;transition:all 0.15s;" title="收起筛选面板">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#94a3b8" stroke-width="2.5" stroke-linecap="round"><polyline points="18 15 12 9 6 15"/></svg>
              收起
            </span>
          </div>
          <div style="margin-bottom:10px;">
            <div style="display:flex;flex-wrap:wrap;gap:4px;" class="comp-filter-grades">
              ${["甲级", "乙级", "产业园"].map((g) => `<label style="display:flex;align-items:center;gap:3px;font-size:11px;color:#475569;cursor:pointer;padding:2px 6px;border:1px solid #e2e8f0;border-radius:4px;" data-grade="${g}"><input type="checkbox" data-grade-cb="${g}" style="width:12px;height:12px;accent-color:#f59e0b;">${g}${g === "甲级" ? " (含超甲)" : ""}</label>`).join("")}
            </div>
          </div>
          ${
            leedList.length > 0
              ? `
          <div style="margin-bottom:10px;">
            <div style="font-size:10px;font-weight:700;color:#94a3b8;margin-bottom:6px;">LEED 认证</div>
            <div style="display:flex;flex-wrap:wrap;gap:4px;" class="comp-filter-leeds">
              ${leedList.map((l) => `<label style="display:flex;align-items:center;gap:3px;font-size:11px;color:#475569;cursor:pointer;padding:2px 6px;border:1px solid #e2e8f0;border-radius:4px;" data-leed="${l}"><input type="checkbox" data-leed-cb="${l}" style="width:12px;height:12px;accent-color:#10b981;">${l}</label>`).join("")}
            </div>
          </div>`
              : ""
          }
          <div style="margin-bottom:10px;">
            <div style="font-size:10px;font-weight:700;color:#94a3b8;margin-bottom:6px;">数值条件</div>
            <div class="comp-filter-cond-list" style="display:flex;flex-direction:column;gap:4px;"></div>
            <button class="comp-filter-add-cond" style="margin-top:6px;width:100%;display:flex;align-items:center;justify-content:center;gap:4px;padding:4px;border:1px dashed #cbd5e1;border-radius:4px;font-size:11px;color:#3b82f6;cursor:pointer;background:transparent;">
              + 添加条件
            </button>
          </div>
          <div style="display:flex;justify-content:flex-end;gap:8px;">
            <button class="comp-filter-reset" style="font-size:11px;padding:4px 12px;border:1px solid #e2e8f0;border-radius:4px;background:#fff;color:#64748b;cursor:pointer;">重置</button>
            <button class="comp-filter-apply" style="font-size:11px;padding:4px 12px;border:1px solid #f59e0b;border-radius:4px;background:#f59e0b;color:#fff;cursor:pointer;font-weight:600;">应用筛选</button>
          </div>
        </div>
      </div>
    `;
    wrapper.style.cssText =
      "position:absolute; top:16px; left:50%; transform:translateX(-50%); z-index:300;";

    const filterToggle = wrapper.querySelector(
      ".comp-filter-toggle",
    ) as HTMLElement;
    const filterPanel = wrapper.querySelector(
      ".comp-filter-panel",
    ) as HTMLElement;
    const filterCollapse = wrapper.querySelector(
      ".comp-filter-collapse",
    ) as HTMLElement;
    filterToggle.addEventListener("click", () => {
      this._compFilterOpen = !this._compFilterOpen;
      filterPanel.style.display = this._compFilterOpen ? "block" : "none";
      filterToggle.style.color = this._compFilterOpen ? "#f59e0b" : "#3b82f6";
    });
    // 收起按钮：点击后隐藏筛选面板
    filterCollapse.addEventListener("click", () => {
      this._compFilterOpen = false;
      filterPanel.style.display = "none";
      filterToggle.style.color = "#3b82f6";
    });

    wrapper
      .querySelector(".comp-exit-btn")
      ?.addEventListener("click", () => this.clearCompetitorElements());

    wrapper.querySelectorAll("[data-dist]").forEach((el) => {
      el.addEventListener("click", () => {
        this._compRadius = Number((el as HTMLElement).dataset.dist) * 1000;
        this._updateDistButtons();
        this._renderCompetitorsByRadius();
      });
    });

    // 动态添加条件行
    const condList = wrapper.querySelector(
      ".comp-filter-cond-list",
    ) as HTMLElement;
    const addCondRow = () => {
      const row = document.createElement("div");
      row.style.cssText = "display:flex;align-items:center;gap:4px;";
      row.innerHTML = `
        <select class="comp-cf-field" style="flex:1;font-size:11px;padding:3px 4px;border:1px solid #e2e8f0;border-radius:4px;background:#f8fafc;outline:none;">
          ${NUM_FIELDS.map((f) => `<option value="${f.value}">${f.label}</option>`).join("")}
        </select>
        <select class="comp-cf-op" style="font-size:11px;padding:3px 4px;border:1px solid #e2e8f0;border-radius:4px;background:#f8fafc;outline:none;width:42px;text-align:center;">
          ${OPS.map((o) => `<option value="${o.value}">${o.label}</option>`).join("")}
        </select>
        <input type="number" class="comp-cf-val" placeholder="数值" style="width:70px;font-size:11px;padding:3px 4px;border:1px solid #e2e8f0;border-radius:4px;outline:none;">
        <button class="comp-cf-del" style="padding:2px 4px;cursor:pointer;font-size:12px;color:#ef4444;background:none;border:none;" title="删除">×</button>
      `;
      row
        .querySelector(".comp-cf-del")
        ?.addEventListener("click", () => row.remove());
      condList.appendChild(row);
    };
    wrapper
      .querySelector(".comp-filter-add-cond")
      ?.addEventListener("click", addCondRow);

    // 应用筛选
    wrapper
      .querySelector(".comp-filter-apply")
      ?.addEventListener("click", () => {
        this._compFilterGrades.clear();
        wrapper
          .querySelectorAll("[data-grade-cb]:checked")
          .forEach((el) =>
            this._compFilterGrades.add(
              (el as HTMLInputElement).dataset.gradeCb!,
            ),
          );
        this._compFilterLeeds.clear();
        wrapper
          .querySelectorAll("[data-leed-cb]:checked")
          .forEach((el) =>
            this._compFilterLeeds.add((el as HTMLInputElement).dataset.leedCb!),
          );
        this._compFilterConds = [];
        condList.querySelectorAll("div").forEach((row) => {
          const field = (
            row.querySelector(".comp-cf-field") as HTMLSelectElement
          )?.value;
          const op = (row.querySelector(".comp-cf-op") as HTMLSelectElement)
            ?.value;
          const val = (row.querySelector(".comp-cf-val") as HTMLInputElement)
            ?.value;
          if (field && op && val !== "" && !isNaN(Number(val))) {
            this._compFilterConds.push({ field, op, value: Number(val) });
          }
        });
        this._renderCompetitorsByRadius();
      });

    // 重置
    wrapper
      .querySelector(".comp-filter-reset")
      ?.addEventListener("click", () => {
        this._compFilterGrades.clear();
        this._compFilterLeeds.clear();
        this._compFilterConds = [];
        wrapper
          .querySelectorAll("[data-grade-cb]")
          .forEach((el) => ((el as HTMLInputElement).checked = false));
        wrapper
          .querySelectorAll("[data-leed-cb]")
          .forEach((el) => ((el as HTMLInputElement).checked = false));
        condList.innerHTML = "";
        this._renderCompetitorsByRadius();
      });

    this.map.getContainer().appendChild(wrapper);
    this.compExitButton = wrapper;
  }

  private hideCompExitButton() {
    if (this.compExitButton) {
      this.compExitButton.remove();
      this.compExitButton = null;
    }
  }

  // 🌟 CL-010: 更新距离按钮高亮状态
  private _updateDistButtons() {
    if (!this.compExitButton) return;
    const currentKm = this._compRadius / 1000;
    this.compExitButton.querySelectorAll("[data-dist]").forEach((el) => {
      const btn = el as HTMLElement;
      const km = Number(btn.dataset.dist);
      const active = km === currentKm;
      btn.style.fontWeight = active ? "700" : "500";
      btn.style.color = active ? "#f59e0b" : "#64748b";
      btn.style.background = active ? "#fffbeb" : "transparent";
      btn.style.borderColor = active ? "#f59e0b" : "#e2e8f0";
    });
  }

  // 🌟 CL-013: marker 弹跳动画
  public bounceMarker(buildingId: string) {
    if (!this.map) return;
    const el = this.map
      .getContainer()
      ?.querySelector(
        `[data-building-id="${buildingId}"]`,
      ) as HTMLElement | null;
    if (!el) return;
    if (!document.getElementById("marker-bounce-style")) {
      const style = document.createElement("style");
      style.id = "marker-bounce-style";
      style.textContent = `@keyframes markerBounce{0%,100%{transform:translateY(0)}30%{transform:translateY(-10px)}50%{transform:translateY(0)}70%{transform:translateY(-5px)}}`;
      document.head.appendChild(style);
    }
    // 先清除再强制回流，确保重复触发也能播放动画
    el.style.animation = "none";
    el.offsetHeight; // force reflow
    el.style.animation = "markerBounce 0.6s ease-in-out";
  }

  public stopBounceMarker(buildingId: string) {
    if (!this.map) return;
    const el = this.map
      .getContainer()
      ?.querySelector(
        `[data-building-id="${buildingId}"]`,
      ) as HTMLElement | null;
    if (el) el.style.animation = "";
  }

  private restoreAllMarkers() {
    if (!this.map || !this._allBuildingsCache.length) return;
    this.renderMarkers(this._allBuildingsCache, "default");
  }

  // 显示未来供应悬停提示框
  private showFutureSupplyHoverTooltip(
    supply: any,
    x: number,
    y: number,
  ): void {
    const tooltip = this.createHoverTooltip();

    const name = supply.name || "-";
    const grade = supply.grade || "-";
    const area = supply.total_area
      ? `${Number(supply.total_area).toLocaleString()} ㎡`
      : "-";
    const time =
      supply.launch_year && supply.launch_quarter
        ? `${supply.launch_year} ${supply.launch_quarter}`
        : supply.launch_year
          ? `${supply.launch_year}年`
          : "待定";

    tooltip.innerHTML = `
      <div style="font-size: 13px; font-weight: 700; color: #0f172a; margin-bottom: 6px; line-height: 1.3;">
        <span style="background:#d1fae5; color:#047857; font-size:9px; padding:1px 4px; border-radius:3px; font-weight:bold; margin-right:4px;">未来</span>
        ${this._mask(name)}
      </div>
      <div style="display: flex; gap: 16px;">
        <div>
          <div style="font-size: 10px; color: #94a3b8; margin-bottom: 2px;">预计入市</div>
          <div style="font-size: 13px; font-weight: 700; color: #10b981;">${time}</div>
        </div>
        <div style="border-left: 1px solid #e2e8f0; padding-left: 12px;">
          <div style="font-size: 10px; color: #94a3b8; margin-bottom: 2px;">体量</div>
          <div style="font-size: 13px; font-weight: 700; color: #0f172a;">${area}</div>
        </div>
      </div>
    `;

    // 定位
    const tooltipWidth = 180;
    const tooltipHeight = 80;
    const padding = 16;

    let left = x + padding;
    let top = y - tooltipHeight / 2;

    if (left + tooltipWidth > window.innerWidth) {
      left = x - tooltipWidth - padding;
    }
    if (top < padding) top = padding;
    if (top + tooltipHeight > window.innerHeight - padding) {
      top = window.innerHeight - tooltipHeight - padding;
    }

    tooltip.style.left = `${left}px`;
    tooltip.style.top = `${top}px`;
    tooltip.style.opacity = "1";
    tooltip.style.transform = "translateY(0)";
  }

  // 创建悬停提示框
  private createHoverTooltip(): HTMLDivElement {
    if (this.hoverTooltip) return this.hoverTooltip;

    const tooltip = document.createElement("div");
    tooltip.style.cssText = `
      position: fixed;
      z-index: 9999;
      pointer-events: none;
      background: white;
      border-radius: 8px;
      box-shadow: 0 4px 16px rgba(0,0,0,0.12), 0 1px 4px rgba(0,0,0,0.08);
      padding: 10px 14px;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      opacity: 0;
      transform: translateY(4px);
      transition: opacity 0.15s ease, transform 0.15s ease;
      min-width: 160px;
      border: 1px solid rgba(0,0,0,0.06);
    `;
    document.body.appendChild(tooltip);
    this.hoverTooltip = tooltip;
    return tooltip;
  }

  // 显示悬停提示框
  private showHoverTooltip(
    building: BuildingWithMetrics,
    x: number,
    y: number,
  ): void {
    const tooltip = this.createHoverTooltip();
    const latestMetric = pickLatestMetric(building.metrics);

    const rent = latestMetric?.net_effective_rent;
    const vacancy = latestMetric?.vacancy_rate;

    const rentText =
      rent != null && Number.isFinite(rent) ? `¥${Math.round(rent)}` : "-";
    const vacText =
      vacancy != null && Number.isFinite(vacancy)
        ? `${(vacancy * 100).toFixed(1)}%`
        : "-";

    tooltip.innerHTML = `
      <div style="font-size: 13px; font-weight: 700; color: #0f172a; margin-bottom: 6px; line-height: 1.3;">
        ${this._mask(building.name || "-")}
      </div>
      <div style="display: flex; gap: 16px;">
        <div>
          <div style="font-size: 10px; color: #94a3b8; margin-bottom: 2px;">净有效租金</div>
          <div style="font-size: 14px; font-weight: 800; color: #003e7e;">${rentText}</div>
        </div>
        <div style="border-left: 1px solid #e2e8f0; padding-left: 12px;">
          <div style="font-size: 10px; color: #94a3b8; margin-bottom: 2px;">空置率</div>
          <div style="font-size: 14px; font-weight: 800; color: #f59e0b;">${vacText}</div>
        </div>
      </div>
    `;

    // 定位：优先右侧，空间不足时放左侧
    const tooltipWidth = 180;
    const tooltipHeight = 80;
    const padding = 16;

    let left = x + padding;
    let top = y - tooltipHeight / 2;

    // 右侧空间不足
    if (left + tooltipWidth > window.innerWidth) {
      left = x - tooltipWidth - padding;
    }

    // 上下边界
    if (top < padding) top = padding;
    if (top + tooltipHeight > window.innerHeight - padding) {
      top = window.innerHeight - tooltipHeight - padding;
    }

    tooltip.style.left = `${left}px`;
    tooltip.style.top = `${top}px`;
    tooltip.style.opacity = "1";
    tooltip.style.transform = "translateY(0)";
  }

  // 隐藏悬停提示框
  private hideHoverTooltip(): void {
    if (this.hoverTooltip) {
      this.hoverTooltip.style.opacity = "0";
      this.hoverTooltip.style.transform = "translateY(4px)";
    }
  }

  // 清理悬停提示框
  private destroyHoverTooltip(): void {
    if (this.hoverTimeout) {
      clearTimeout(this.hoverTimeout);
      this.hoverTimeout = null;
    }
    if (this.hoverTooltip) {
      this.hoverTooltip.remove();
      this.hoverTooltip = null;
    }
  }

  fitToBuildings(buildingsData: BuildingWithMetrics[]) {
    if (!this.map || !this.AMap || buildingsData.length === 0) return;

    this.clearCompetitorElements();

    const withCoords = buildingsData.filter(b => Number.isFinite(b.location_lng) && Number.isFinite(b.location_lat));
    if (withCoords.length === 0) return;

    if (withCoords.length === 1 && withCoords[0]) {
      this.map.setZoomAndCenter(16, [
        withCoords[0].location_lng,
        withCoords[0].location_lat,
      ]);
    } else {
      let minLng = 180,
        maxLng = -180,
        minLat = 90,
        maxLat = -90;
      withCoords.forEach((b) => {
        if (b.location_lng < minLng) minLng = b.location_lng;
        if (b.location_lng > maxLng) maxLng = b.location_lng;
        if (b.location_lat < minLat) minLat = b.location_lat;
        if (b.location_lat > maxLat) maxLat = b.location_lat;
      });
      const bounds = new this.AMap.Bounds([minLng, minLat], [maxLng, maxLat]);
      this.map.setBounds(bounds);

      setTimeout(() => {
        if (this.map.getZoom() < 14) {
          this.map.setZoom(14.5);
        }
      }, 50);
    }
  }

  /** 恢复地图工作台的初始总览视野（大气泡层级）。 */
  resetToDefaultView() {
    if (!this.map) return;
    this.map.setZoomAndCenter(DEFAULT_MAP_ZOOM, [
      DEFAULT_MAP_CENTER.lng,
      DEFAULT_MAP_CENTER.lat,
    ]);
  }

  /**
   * 加载本地地图数据（行政区边界 + 地铁线路）
   * 数据文件位置：public/data/beijing_map_data.json
   */
  private async loadLocalMapData(): Promise<BeijingMapData> {
    if (this._localMapDataCache) {
      return this._localMapDataCache;
    }

    if (this._localMapDataPromise) {
      return this._localMapDataPromise;
    }

    this._localMapDataPromise = (async () => {
      try {
        const response = await fetch("/data/beijing_map_data.json");
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
        const data: BeijingMapData = await response.json();
        this._localMapDataCache = data;
        console.log("✅ 本地地图数据加载成功:", {
          districts: data?.districts?.length ?? 0,
          subways: data?.subways?.length ?? 0,
          version: data.version,
        });
        return data;
      } catch (error) {
        console.error("❌ 本地地图数据加载失败:", error);
        this._localMapDataPromise = null;
        throw error;
      }
    })();

    return this._localMapDataPromise;
  }

  /**
   * 绘制行政区边界（离线版本，从本地 JSON 读取）
   */
  async drawDistrictBoundaries(districts: string[]) {
    if (!this.AMap || !this.map) return;
    this.clearDistrictBoundaries();
    if (districts.length === 0) return;

    try {
      // 从本地缓存加载数据
      const mapData = await this.loadLocalMapData();

      for (const districtName of districts) {
        // 在本地数据中查找对应的行政区
        const districtData = mapData.districts.find(
          (d) => d.name === districtName,
        );

        if (!districtData) {
          console.warn(`未找到行政区数据: ${districtName}`);
          continue;
        }

        // 绘制所有边界多边形
        for (const boundary of districtData.boundaries) {
          const polygon = new this.AMap.Polygon({
            strokeWeight: 2,
            path: boundary,
            fillOpacity: 0.05,
            fillColor: "#003e7e",
            strokeColor: "#003e7e",
            strokeStyle: "dashed",
          });
          this.districtPolygons.push(polygon);
          this.map.add(polygon);
        }
      }
    } catch (error) {
      console.error("绘制行政区边界失败:", error);
    }
  }

  clearDistrictBoundaries() {
    if (this.map && this.districtPolygons.length > 0) {
      this.map.remove(this.districtPolygons);
    }
    this.districtPolygons = [];
  }

  /**
   * 绘制地铁线路（离线版本，从本地 JSON 读取）
   */
  async fetchAndDrawSubwayLine(lineName: string): Promise<any[]> {
    if (!this.AMap || !this.map) return [];
    this.clearSubwayElements();

    try {
      // 从本地缓存加载数据
      const mapData = await this.loadLocalMapData();

      // 在本地数据中查找对应的地铁线路
      const subwayData = mapData.subways.find(
        (s) =>
          s.name === lineName ||
          s.name.includes(lineName) ||
          lineName.includes(s.name),
      );

      if (!subwayData) {
        console.warn(`未找到地铁线路数据: ${lineName}`);
        return [];
      }

      // 绘制地铁线路
      this.subwayPolyline = new this.AMap.Polyline({
        path: subwayData.path,
        strokeColor: "#e11d48",
        strokeWeight: 4,
        strokeStyle: "solid",
        lineJoin: "round",
      });
      this.map.add(this.subwayPolyline);
      this.map.setFitView([this.subwayPolyline]);

      // 返回站点数据
      return subwayData.stations;
    } catch (error) {
      console.error("绘制地铁线路失败:", error);
      return [];
    }
  }

  drawSubwayRadius(station: any, distanceMeters: number) {
    if (!this.AMap || !this.map || !station) return;
    if (this.stationMarker) this.map.remove(this.stationMarker);
    if (this.radiusCircle) this.map.remove(this.radiusCircle);
    this.clearCompetitorElements();

    this.stationMarker = new this.AMap.Marker({
      position: station.center,
      content: `<div style="width:16px;height:16px;background:#e11d48;border:2px solid #fff;border-radius:50%;box-shadow:0 0 5px rgba(0,0,0,0.5);"></div>`,
      offset: new this.AMap.Pixel(-8, -8),
      zIndex: 150,
    });
    this.radiusCircle = new this.AMap.Circle({
      center: station.center,
      radius: distanceMeters,
      strokeColor: "#e11d48",
      strokeOpacity: 0.4,
      strokeWeight: 2,
      strokeStyle: "dashed",
      fillColor: "#e11d48",
      fillOpacity: 0.1,
      zIndex: 50,
    });
    this.map.add([this.stationMarker, this.radiusCircle]);
    this.map.setFitView([this.radiusCircle]);
  }

  clearSubwayElements() {
    if (this.map) {
      if (this.subwayPolyline) this.map.remove(this.subwayPolyline);
      if (this.stationMarker) this.map.remove(this.stationMarker);
      if (this.radiusCircle) this.map.remove(this.radiusCircle);
    }
    this.subwayPolyline = null;
    this.stationMarker = null;
    this.radiusCircle = null;
  }

  calculateDistance(
    lngLat1: [number, number],
    lngLat2: [number, number],
  ): number {
    if (!this.AMap || !this.AMap.GeometryUtil) return 999999;
    return this.AMap.GeometryUtil.distance(lngLat1, lngLat2);
  }

  async fetchAndRenderMarkers(): Promise<void> {
    try {
      const buildings = await this.fetchMapData();
      if (this._destroyed) return;
      this.renderMarkers(buildings, "default");
    } catch (e) {}
  }

  async fetchMapData(): Promise<BuildingWithMetrics[]> {
    if (this._cachedMapDataPromise) return this._cachedMapDataPromise;
    this._cachedMapDataPromise = (async () => {
      const [buildingsResult, overridesResult] = await Promise.all([
        supabase
          .from("buildings")
          .select("*, building_metrics(*)")
          .eq("is_active", true)
          .or("project_type.neq.future,project_type.is.null"),
        supabase
          .from("building_display_overrides")
          .select("building_id, field_name, display_label, display_value"),
      ]);

      const { data, error } = buildingsResult;
      if (error) {
        console.error("[MapController] buildings 查询失败:", error);
        throw new Error(`查询失败: ${error.message}`);
      }

      if (overridesResult.data) {
        this._displayOverridesCache = new Map();
        for (const override of overridesResult.data) {
          if (!this._displayOverridesCache.has(override.building_id)) {
            this._displayOverridesCache.set(override.building_id, new Map());
          }
          this._displayOverridesCache.get(override.building_id)!.set(
            override.field_name,
            { display_label: override.display_label, display_value: override.display_value }
          );
        }
        console.log(`[MapController] 加载 ${overridesResult.data.length} 条显示覆盖规则`);
      }

      const rows = Array.isArray(data) ? data : [];
      console.log(`[MapController] Supabase 返回 ${rows.length} 条 buildings 记录`);
      const buildings: BuildingWithMetrics[] = [];
      let skippedNoCoords = 0;
      for (const r of rows) {
        const building = transformBuildingRow(r as Record<string, unknown>);
        if (building.location_lng === null || building.location_lat === null) {
          skippedNoCoords++;
        }
        buildings.push(building);
      }
      this._allBuildingsCache = buildings.filter(
        (b) => b.id !== "" && b.name !== "",
      );
      console.log(
        `[MapController] 数据加载: ${this._allBuildingsCache.length} 条建筑, 其中 ${skippedNoCoords} 条无坐标`,
      );
      return this._allBuildingsCache;
    })();
    try {
      const buildings = await this._cachedMapDataPromise;
      // 空结果可能来自认证刚刷新或短暂的 Data API 异常，不能永久缓存。
      // 保留正常结果缓存，同时允许调用方对异常空结果重新请求。
      if (buildings.length === 0) this._cachedMapDataPromise = null;
      return buildings;
    } catch (e) {
      this._cachedMapDataPromise = null;
      throw e;
    }
  }

  async fetchFutureSupplies(): Promise<any[]> {
    if (this._cachedFutureSuppliesPromise)
      return this._cachedFutureSuppliesPromise;

    this._cachedFutureSuppliesPromise = (async () => {
      const { data, error } = await supabase
        .from("future_supplies")
        .select("*")
        .limit(1000);
      if (error) throw new Error(`未来供应查询失败: ${error.message}`);
      return data || [];
    })();

    try {
      return await this._cachedFutureSuppliesPromise;
    } catch (e) {
      this._cachedFutureSuppliesPromise = null;
      throw e;
    }
  }

  renderFutureMarkers(
    supplies: any[],
    renderMode: RenderMode = "default",
  ): void {
    if (this._destroyed || !this.map || !this.AMap) return;
    const AMap = this.AMap;

    this.clearFutureMarkers();
    if (!Array.isArray(supplies) || supplies.length === 0) return;

    for (const supply of supplies) {
      const lng = toNullableFiniteNumber(supply.location_lng);
      const lat = toNullableFiniteNumber(supply.location_lat);
      if (lng === null || lat === null) continue;

      const style = getMarkerStyle(supply, null, renderMode, true);
      const borderStyle = renderMode === "default" ? "dashed" : "solid";

      const markerEl = `
        <div style="
          width:26px;height:26px;border-radius:50%;
          background:${style.bgColor};border:2px ${borderStyle} ${style.borderColor};
          box-shadow:0 6px 14px rgba(0,0,0,0.18);
          display:flex;align-items:center;justify-content:center;
          color:${style.textColor};font-weight:800;font-size:${style.fontSize};
          transition: transform 0.2s, background-color 0.3s;
        " onmouseover="this.style.transform='scale(1.15)'" onmouseout="this.style.transform='scale(1)'">
          ${style.text}
        </div>
      `;

      const marker = new AMap.Marker({
        position: [lng, lat],
        content: markerEl,
        offset: new AMap.Pixel(-13, -13),
        zIndex: 110,
      });

      // 悬停事件：显示提示框
      marker.on("mouseover", (e: any) => {
        if (this.hoverTimeout) {
          clearTimeout(this.hoverTimeout);
          this.hoverTimeout = null;
        }
        const x = e.originEvent?.clientX || e.pixel?.getX() || 0;
        const y = e.originEvent?.clientY || e.pixel?.getY() || 0;
        this.showFutureSupplyHoverTooltip(supply, x, y);
      });

      marker.on("mouseout", () => {
        this.hoverTimeout = setTimeout(() => this.hideHoverTooltip(), 80);
      });

      marker.on("click", () => {
        const containerDiv = document.createElement("div");
        containerDiv.innerHTML = this.buildFutureSupplyInfoWindow(supply);

        const info = new AMap.InfoWindow({
          isCustom: false,
          offset: new AMap.Pixel(0, -35),
          autoMove: true,
          content: containerDiv,
        });
        info.open(this.map, [lng, lat]);
      });

      this.futureMarkers.push(marker);
    }

    this.map.add(this.futureMarkers);
  }

  clearFutureMarkers(): void {
    if (!this.map) return;
    if (this.futureMarkers.length > 0) {
      try {
        this.map.remove(this.futureMarkers);
      } catch (e) {}
    }
    this.futureMarkers = [];
  }

  private buildFutureSupplyInfoWindow(supply: any): string {
    const name = escapeHtml(supply.name);
    const grade = escapeHtml(displayGrade(supply.grade));
    const owner = escapeHtml(supply.owner || "—");
    const time =
      supply.launch_year && supply.launch_quarter
        ? `${supply.launch_year}${supply.launch_quarter}`
        : supply.launch_year
          ? `${supply.launch_year}年`
          : "待定";
    const area = supply.total_area
      ? `${Number(supply.total_area).toLocaleString()} ㎡`
      : "未知";
    const notes = escapeHtml(supply.notes || "无");

    return `
      <div style="width: 300px; font-family: ui-sans-serif, system-ui, -apple-system; background: #ffffff; padding: 4px;">
        <div style="margin-bottom: 10px; border-bottom: 2px solid #10b981; padding-bottom: 8px;">
           <span style="background:#d1fae5; color:#047857; font-size:10px; padding:2px 6px; border-radius:4px; font-weight:bold; margin-right:6px;">未来供应</span>
           <span style="font-size:16px; font-weight:900; color:#0f172a;">${this._mask(name)}</span>
        </div>
        <div style="font-size: 12px; color: #475569; line-height: 1.8;">
          <div style="display:flex; justify-content:space-between;"><span>预计入市：</span> <span style="font-weight:700; color:#10b981;">${time}</span></div>
          <div style="display:flex; justify-content:space-between;"><span>总体量：</span> <span style="font-weight:700; color:#0f172a;">${area}</span></div>
          <div style="display:flex; justify-content:space-between;"><span>楼宇等级：</span> <span style="font-weight:700; color:#0f172a;">${grade}</span></div>
          <div style="display:flex; justify-content:space-between;"><span>业主：</span> <span style="font-weight:700; color:#0f172a;">${this._mask(owner)}</span></div>
          <div style="margin-top: 8px; padding-top: 8px; border-top: 1px dashed #e2e8f0;">
             <span style="color:#94a3b8;">备注：</span><span style="color:#64748b; font-size:11px;">${notes}</span>
          </div>
        </div>
      </div>
    `;
  }

  renderMarkers(
    buildingsData: BuildingWithMetrics[],
    renderMode: RenderMode = "default",
    districtLeedMap?: Map<string, { totalCount: number; leedCount: number }>,
    comparisonGroups?: CompareGroup[],
  ): void {
    if (this._destroyed || !this.map || !this.AMap) return;
    const AMap = this.AMap;
    this.clearMarkers();

    const items = Array.isArray(buildingsData) ? buildingsData : [];
    if (items.length === 0) return;

    for (const building of items) {
      const lng = building.location_lng;
      const lat = building.location_lat;
      if (!Number.isFinite(lng) || !Number.isFinite(lat)) continue;

      const latestMetric = pickLatestMetric(building.metrics);
      const groupColor = comparisonGroups
        ? findBuildingGroupColor(building, comparisonGroups)
        : undefined;
      const style = getMarkerStyle(
        building,
        latestMetric,
        renderMode,
        false,
        groupColor,
      );

      const markerEl = `
        <div data-building-id="${building.id}" style="
          width:26px;height:26px;border-radius:50%;
          background:${style.bgColor};border:2px solid ${style.borderColor};
          box-shadow:0 6px 14px rgba(0,0,0,0.18);
          display:flex;align-items:center;justify-content:center;
          color:${style.textColor};font-weight:800;font-size:${style.fontSize};
          transition: transform 0.2s, background-color 0.3s;
        " onmouseover="this.style.transform='scale(1.15)'" onmouseout="this.style.transform='scale(1)'">
          ${style.text}
        </div>
      `;

      const marker = new AMap.Marker({
        position: [lng, lat],
        content: markerEl,
        offset: new AMap.Pixel(-13, -13),
        zIndex: 100,
      });
      marker.setExtData({ id: building.id });

      // 悬停事件：显示提示框
      marker.on("mouseover", (e: any) => {
        if (this.hoverTimeout) {
          clearTimeout(this.hoverTimeout);
          this.hoverTimeout = null;
        }
        // 获取鼠标位置
        const x = e.originEvent?.clientX || e.pixel?.getX() || 0;
        const y = e.originEvent?.clientY || e.pixel?.getY() || 0;
        this.showHoverTooltip(building, x, y);
      });

      marker.on("mouseout", () => {
        this.hoverTimeout = setTimeout(() => this.hideHoverTooltip(), 80);
      });

      marker.on("click", () => {
        // 切换 InfoWindow 时保护不退出周边项目对比模式
        this._isClearingCompetitor = true;
        this.infoWindow?.close?.();
        this._isClearingCompetitor = false;
        const containerDiv = document.createElement("div");
        containerDiv.innerHTML = this.buildInfoWindowContent(
          building,
          latestMetric,
        );
        const info = new AMap.InfoWindow({
          isCustom: false,
          content: containerDiv,
          offset: new AMap.Pixel(0, -35),
          autoMove: true,
        });
        this.infoWindow = info;
        info.on("close", () => {
          // 关闭时销毁图表
          const trend = (window as any).__colliers_trend;
          if (trend?.chart) {
            trend.chart.dispose();
            trend.chart = null;
          }
          const panel = document.getElementById("info-chart-panel");
          if (panel) panel.style.display = "none";
        });
        info.open(this.map, [lng, lat]);
      });
      this.markers.push(marker);
    }

    const submarketMap = new Map<string, any>();
    for (const b of items) {
      const sub = b.submarket?.trim?.() ?? "";
      if (!sub || sub === "其他") continue;

      if (!submarketMap.has(sub)) {
        submarketMap.set(sub, {
          name: sub,
          lngSum: 0,
          latSum: 0,
          coordCount: 0,
          count: 0,
          totalArea: 0,
          vacantArea: 0,
          rentWeightSum: 0,
          rentWeightAreaSum: 0,
        });
      }
      const agg = submarketMap.get(sub);
      agg.count += 1;
      if (Number.isFinite(b.location_lng) && Number.isFinite(b.location_lat)) {
        agg.lngSum += b.location_lng;
        agg.latSum += b.location_lat;
        agg.coordCount += 1;
      }

      const latest = pickLatestMetric(b.metrics);
      if (latest) {
        const area = Number(latest.total_area);
        const rent = Number(latest.net_effective_rent);
        const vacArea = Number(latest.vacant_area);
        if (Number.isFinite(area) && area > 0) {
          agg.totalArea += area;
          agg.vacantArea += Number.isFinite(vacArea) ? vacArea : 0;
        }
        if (
          Number.isFinite(area) &&
          area > 0 &&
          Number.isFinite(rent) &&
          rent > 0
        ) {
          agg.rentWeightAreaSum += area;
          agg.rentWeightSum += rent * area;
        }
      }
    }

    // ================ 按区域聚合 LEED 认证数据（如果未提供则现场计算）================
    let computedDistrictLeedMap = districtLeedMap;
    if (!computedDistrictLeedMap) {
      computedDistrictLeedMap = new Map<
        string,
        { totalCount: number; leedCount: number }
      >();
      for (const b of items) {
        const dist = b.district?.trim?.() ?? "";
        if (!dist) continue;

        if (!computedDistrictLeedMap.has(dist)) {
          computedDistrictLeedMap.set(dist, { totalCount: 0, leedCount: 0 });
        }
        const distData = computedDistrictLeedMap.get(dist)!;
        distData.totalCount += 1;

        // 检查是否有 LEED 认证
        const leed = (b.leed_certification || "").trim().toUpperCase();
        if (leed && leed !== "NULL" && leed !== "") {
          distData.leedCount += 1;
        }
      }
    }

    for (const agg of Array.from(submarketMap.values())) {
      if (agg.count === 0) continue;
      if (agg.coordCount === 0) continue; // 该子市场所有建筑都无坐标，无法显示气泡
      const centerLng = agg.lngSum / agg.coordCount;
      const centerLat = agg.latSum / agg.coordCount;

      // 计算用于数值比较的纯数字
      const avgRentNum =
        agg.rentWeightAreaSum > 0
          ? agg.rentWeightSum / agg.rentWeightAreaSum
          : 0;
      const vacRateNum =
        agg.totalArea > 0 ? (agg.vacantArea / agg.totalArea) * 100 : 0;

      // 显示用的文本
      const avgRent = avgRentNum > 0 ? avgRentNum.toFixed(1) : "-";
      const vacRate = agg.totalArea > 0 ? vacRateNum.toFixed(1) : "-";

      // ================ 增加模式联动的气泡样式引擎 ================
      let bgColor = "rgba(0, 62, 126, 0.92)"; // 默认底色（蓝）
      let hoverColor = "rgba(0, 62, 126, 1)";

      let extraContent = `
        <div style="font-size: 10px; font-weight: 700; opacity: 0.95;">¥${avgRent}</div>
        <div style="font-size: 10px; font-weight: 700; color: #fcd34d;">${vacRate}%</div>
      `;

      if (renderMode === "rent") {
        if (avgRentNum === 0) {
          bgColor = "rgba(148, 163, 184, 0.92)";
          hoverColor = "rgba(148, 163, 184, 1)";
        } else if (avgRentNum >= 300) {
          bgColor = "rgba(239, 68, 68, 0.92)";
          hoverColor = "rgba(239, 68, 68, 1)";
        } else if (avgRentNum >= 200) {
          bgColor = "rgba(249, 115, 22, 0.92)";
          hoverColor = "rgba(249, 115, 22, 1)";
        } else if (avgRentNum >= 100) {
          bgColor = "rgba(245, 158, 11, 0.92)";
          hoverColor = "rgba(245, 158, 11, 1)";
        } else {
          bgColor = "rgba(16, 185, 129, 0.92)";
          hoverColor = "rgba(16, 185, 129, 1)";
        }

        extraContent = `
          <div style="font-size: 10px; font-weight: 700; color: #fcd34d; margin-top: 2px;">平均租金</div>
          <div style="font-size: 11px; font-weight: 800; opacity: 0.95;">¥${avgRent}</div>
        `;
      } else if (renderMode === "vacancy") {
        if (vacRateNum === 0 && agg.totalArea === 0) {
          bgColor = "rgba(148, 163, 184, 0.92)";
          hoverColor = "rgba(148, 163, 184, 1)";
        } else if (vacRateNum >= 30) {
          bgColor = "rgba(239, 68, 68, 0.92)";
          hoverColor = "rgba(239, 68, 68, 1)";
        } else if (vacRateNum >= 20) {
          bgColor = "rgba(249, 115, 22, 0.92)";
          hoverColor = "rgba(249, 115, 22, 1)";
        } else if (vacRateNum >= 10) {
          bgColor = "rgba(245, 158, 11, 0.92)";
          hoverColor = "rgba(245, 158, 11, 1)";
        } else {
          bgColor = "rgba(16, 185, 129, 0.92)";
          hoverColor = "rgba(16, 185, 129, 1)";
        }

        extraContent = `
          <div style="font-size: 10px; font-weight: 700; color: #fcd34d; margin-top: 2px;">空置率</div>
          <div style="font-size: 11px; font-weight: 800; opacity: 0.95;">${vacRate}%</div>
        `;
      } else if (renderMode === "leed") {
        // 直接从子市场的楼宇计算 LEED 认证率
        const buildingsInSubmarket = items.filter(
          (b) => b.submarket === agg.name,
        );

        let totalCount = 0;
        let leedCount = 0;

        for (const b of buildingsInSubmarket) {
          if (b.leed_certification && b.leed_certification !== '无' && b.leed_certification !== '-') {
            leedCount++;
          }
          totalCount++;
        }

        const leedPercentage =
          totalCount > 0 ? ((leedCount / totalCount) * 100).toFixed(1) : "0.0";
        const leedPercentageNum =
          totalCount > 0 ? (leedCount / totalCount) * 100 : 0;

        // 根据认证率设置颜色深浅（认证率越高，绿色越深）
        if (leedPercentageNum === 0) {
          bgColor = "rgba(148, 163, 184, 0.92)"; // 灰色 - 无认证
          hoverColor = "rgba(148, 163, 184, 1)";
        } else if (leedPercentageNum >= 60) {
          bgColor = "rgba(5, 150, 105, 0.92)"; // 深绿 - 高认证率
          hoverColor = "rgba(5, 150, 105, 1)";
        } else if (leedPercentageNum >= 40) {
          bgColor = "rgba(16, 185, 129, 0.92)"; // 中绿 - 中高认证率
          hoverColor = "rgba(16, 185, 129, 1)";
        } else if (leedPercentageNum >= 20) {
          bgColor = "rgba(52, 211, 153, 0.92)"; // 浅绿 - 中等认证率
          hoverColor = "rgba(52, 211, 153, 1)";
        } else {
          bgColor = "rgba(110, 231, 183, 0.92)"; // 极浅绿 - 低认证率
          hoverColor = "rgba(110, 231, 183, 1)";
        }

        extraContent = `
          <div style="font-size: 10px; font-weight: 700; color: #fef08a; margin-top: 2px;">LEED 认证率</div>
          <div style="font-size: 13px; font-weight: 900; opacity: 0.95;">${leedPercentage}%</div>
        `;
      }

      const smMarkerEl = `
        <div style="
          width: 82px; height: 82px; border-radius: 50%;
          background: ${bgColor}; border: 2px solid rgba(255,255,255,0.9);
          box-shadow: 0 8px 24px rgba(0,0,0,0.2); display: flex; flex-direction: column; align-items: center; justify-content: center;
          color: #ffffff; cursor: pointer; backdrop-filter: blur(4px); transition: transform 0.2s ease, background 0.2s;
        " onmouseover="this.style.transform='scale(1.05)'; this.style.background='${hoverColor}';" onmouseout="this.style.transform='scale(1)'; this.style.background='${bgColor}';">
          <div style="font-size: 13px; font-weight: 900; margin-bottom: 2px; text-shadow: 0 1px 2px rgba(0,0,0,0.4); line-height:1.2; text-align:center;">${agg.name.length > 5 ? escapeHtml(agg.name.slice(0, Math.ceil(agg.name.length / 2))) + "<br>" + escapeHtml(agg.name.slice(Math.ceil(agg.name.length / 2))) : escapeHtml(agg.name)}</div>
          ${extraContent}
        </div>
      `;

      const smMarker = new AMap.Marker({
        position: [centerLng, centerLat],
        content: smMarkerEl,
        offset: new AMap.Pixel(-41, -41),
        zIndex: 90,
      });
      smMarker.on("click", () => {
        this.map.setZoomAndCenter(14, [centerLng, centerLat]);
      });
      this.submarketMarkers.push(smMarker);
    }

    // ================ Level 3: 小圆点标记（zoom 12-14）================
    this.dotMarkers = [];
    for (const building of items) {
      const lng = building.location_lng;
      const lat = building.location_lat;
      if (!Number.isFinite(lng) || !Number.isFinite(lat)) continue;

      const latestMetric = pickLatestMetric(building.metrics);
      const groupColor = comparisonGroups
        ? findBuildingGroupColor(building, comparisonGroups)
        : undefined;
      const style = getMarkerStyle(
        building,
        latestMetric,
        renderMode,
        false,
        groupColor,
      );

      // 小圆点：只显示颜色，不显示文字
      const dotSize = 10;
      const dotEl = `
        <div data-building-id="${building.id}" style="
          width: ${dotSize}px;
          height: ${dotSize}px;
          border-radius: 50%;
          background: ${style.bgColor};
          opacity: 0.85;
          cursor: pointer;
          transition: transform 0.15s ease-out, opacity 0.15s ease-out;
          box-shadow: 0 1px 3px rgba(0,0,0,0.2);
        "
        onmouseover="this.style.transform='scale(1.8)'; this.style.opacity='1';"
        onmouseout="this.style.transform='scale(1)'; this.style.opacity='0.85';"
        title="${escapeHtml(building.name)}"
        aria-label="${escapeHtml(building.name)}"
        ></div>
      `;

      const dotMarker = new AMap.Marker({
        position: [lng, lat],
        content: dotEl,
        offset: new AMap.Pixel(-dotSize / 2, -dotSize / 2),
        zIndex: 60,
      });

      // Hover 显示简洁提示
      dotMarker.on("mouseover", (e: any) => {
        if (this.hoverTimeout) {
          clearTimeout(this.hoverTimeout);
          this.hoverTimeout = null;
        }
        const x = e.originEvent?.clientX || e.pixel?.getX() || 0;
        const y = e.originEvent?.clientY || e.pixel?.getY() || 0;
        this.showHoverTooltip(building, x, y);
      });

      dotMarker.on("mouseout", () => {
        this.hoverTimeout = setTimeout(() => this.hideHoverTooltip(), 80);
      });

      // 点击放大到 Level 4 并显示 InfoWindow
      dotMarker.on("click", () => {
        this.map.setZoomAndCenter(14, [lng, lat]);
        // 延迟显示 InfoWindow，等待缩放动画完成
        setTimeout(() => {
          const containerDiv = document.createElement("div");
          containerDiv.innerHTML = this.buildInfoWindowContent(
            building,
            latestMetric,
          );
          const info = new AMap.InfoWindow({
            isCustom: false,
            content: containerDiv,
            offset: new AMap.Pixel(0, -35),
            autoMove: true,
          });
          this.infoWindow = info;
          info.on("close", () => {
            const trend = (window as any).__colliers_trend;
            if (trend?.chart) {
              trend.chart.dispose();
              trend.chart = null;
            }
            const panel = document.getElementById("info-chart-panel");
            if (panel) panel.style.display = "none";
          });
          info.open(this.map, [lng, lat]);
        }, 300);
      });

      this.dotMarkers.push(dotMarker);
    }

    if (!this._zoomListenerBound) {
      this.map.on("zoomend", this.updateVisibilityByZoom.bind(this));
      this._zoomListenerBound = true;
    }

    this.currentRenderMode = null;
    this.updateVisibilityByZoom();
  }

  private updateVisibilityByZoom() {
    if (this._destroyed || !this.map) return;
    const zoom = this.map.getZoom();

    // 3级缩放策略：
    // Level 2: zoom < 11.3 → 子市场聚合气泡
    // Level 3: 11.3 ≤ zoom < 13 → 小圆点（只显示颜色）
    // Level 4: zoom ≥ 13 → 完整标记（显示文字）
    let targetMode: "submarket" | "dot" | "building";
    if (zoom < 11.3) {
      targetMode = "submarket";
    } else if (zoom < 13) {
      targetMode = "dot";
    } else {
      targetMode = "building";
    }

    if (this.currentRenderMode !== targetMode) {
      // 移除所有现有标记
      if (this.currentRenderMode === "submarket") {
        this.map.remove(this.submarketMarkers);
      } else if (this.currentRenderMode === "dot") {
        this.map.remove(this.dotMarkers);
      } else if (this.currentRenderMode === "building") {
        this.map.remove(this.markers);
      }

      // 添加新标记
      if (targetMode === "submarket") {
        this.map.add(this.submarketMarkers);
        this.infoWindow?.close?.();
      } else if (targetMode === "dot") {
        this.map.add(this.dotMarkers);
        this.infoWindow?.close?.();
      } else {
        this.map.add(this.markers);
      }

      this.currentRenderMode = targetMode;
      console.log(
        `[MapController] Zoom level changed: ${zoom.toFixed(1)}, mode: ${targetMode}`,
      );
    }
  }

  private async _initDemoMode(): Promise<void> {
    try {
      const session = await getSessionFast();
      if (session?.user?.email) {
        this._isDemo = isDemoMode(session.user.email);
      }
    } catch {
      /* ignore */
    }
  }

  private _mask(text: string): string {
    if (!this._isDemo) return text;
    return `<span style="filter:blur(6px);user-select:none;cursor:default;" title="演示模式，数据已脱敏">${text}</span>`;
  }

  /** 截断文本，超过 maxLen 个字符显示省略号 */
  private _truncate(text: string, maxLen: number): string {
    if (!text || text.length <= maxLen) return text;
    return text.slice(0, maxLen) + "...";
  }

  /** 获取楼宇字段的显示覆盖规则 */
  getDisplayOverride(buildingId: string, fieldName: string): { display_label: string; display_value: string } | null {
    return this._displayOverridesCache.get(buildingId)?.get(fieldName) ?? null;
  }

  /** 获取所有显示覆盖规则缓存 */
  getDisplayOverridesCache(): Map<string, Map<string, { display_label: string; display_value: string }>> {
    return this._displayOverridesCache;
  }

  private buildInfoWindowContent(
    building: BuildingWithMetrics,
    latestMetric: BuildingMetric | null,
  ): string {
    const name = escapeHtml(building.name);

    // 检查显示覆盖规则
    const gradeOverride = this.getDisplayOverride(building.id, 'grade');
    const submarketOverride = this.getDisplayOverride(building.id, 'submarket');

    const gradeLabel = gradeOverride?.display_label ?? '楼宇等级';
    const gradeValue = escapeHtml(gradeOverride?.display_value ?? displayGrade(building.grade));
    const submarketLabel = submarketOverride?.display_label ?? '子市场';
    const submarketValue = escapeHtml(submarketOverride?.display_value ?? (building.submarket || "—"));

    const completionYear = building.completion_year
      ? escapeHtml(building.completion_year)
      : "—";
    const leed = building.leed_certification;
    const ownerFull = escapeHtml(building.owner || "暂无");
    const owner = this._truncate(ownerFull, 7);
    const propertyMgmtFull = escapeHtml(building.property_management || "暂无");
    const propertyMgmt = this._truncate(propertyMgmtFull, 7);
    const contactPhone = building.contact_phone || "";

    const currentRent = latestMetric
      ? Number(latestMetric.net_effective_rent)
      : 0;
    const rentText = latestMetric ? `¥${formatZhNumber(currentRent)}` : "-";
    const faceRentText =
      latestMetric && latestMetric.face_rent
        ? `¥${formatZhNumber(Number(latestMetric.face_rent))}`
        : "-";
    const vacText = latestMetric
      ? formatVacancyRate(latestMetric.vacancy_rate)
      : "-";
    const mgtFeeText =
      latestMetric && latestMetric.management_fee
        ? `¥${formatZhNumber(latestMetric.management_fee)}`
        : "-";
    const latestQuarter = latestMetric
      ? `${latestMetric.record_year}Q${latestMetric.record_quarter}`
      : "无数据";

    const leedBadgeHtml =
      leed && leed !== "NULL" && leed !== ""
        ? `<span style="padding:2px 8px; border-radius:4px; background:#dcfce3; color:#166534; font-size:10px; font-weight:800; border: 1px solid #bbf7d0;">LEED ${escapeHtml(leed)}</span>`
        : "";

    const ROW = (
      label: string,
      value: string,
      color = "#0f172a",
      titleText?: string,
    ) => {
      const title = titleText ? ` title="${escapeHtml(titleText)}"` : "";
      return `<div style="display:flex; justify-content:space-between; align-items:baseline; padding:4px 0; border-bottom:1px solid #f8fafc;">
        <span style="font-size:11px; color:#64748b; white-space:nowrap;">${label}</span>
        <span${title} style="font-size:11px; font-weight:800; color:${color}; text-align:right; max-width:55%; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${value}</span>
      </div>`;
    };

    return `
      <div style="width: 360px; font-family: ui-sans-serif, system-ui, -apple-system; background: #ffffff; padding: 4px;">

        <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:8px;">
          <div title="${escapeHtml(name)}" style="font-size:16px; font-weight:900; color:#0f172a; line-height:1.3; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; flex:1;">${this._mask(name)}</div>
          ${this._isAdmin ? `
            <button
              onclick="window.__colliers_editBuildingMetrics('${building.id}', '${escapeHtml(name)}')"
              title="编辑数据"
              style="
                background: transparent;
                color: #059669;
                border: 1px solid #d1d5db;
                padding: 2px 6px;
                border-radius: 4px;
                font-size: 10px;
                font-weight: 600;
                cursor: pointer;
                transition: all 0.15s;
                white-space: nowrap;
                margin-left: 8px;
                flex-shrink: 0;
              "
              onmouseover="this.style.background='#d1fae5'; this.style.borderColor='#059669';"
              onmouseout="this.style.background='transparent'; this.style.borderColor='#d1d5db';"
            >
              编辑
            </button>
          ` : ''}
        </div>

        ${leedBadgeHtml ? `<div style="margin-bottom:8px;">${leedBadgeHtml}</div>` : ""}

        <div style="display:grid; grid-template-columns:1fr 1fr; gap:0 16px; margin-bottom:10px;">
          <div>
            ${ROW(gradeLabel, gradeValue)}
            ${ROW(submarketLabel, submarketValue, "#0f172a", submarketOverride ? submarketValue : building.submarket)}
            ${ROW("入市时间", completionYear)}
            ${ROW("项目业主", this._mask(owner), "#0f172a", building.owner)}
            ${ROW("物业公司", this._mask(propertyMgmt), "#0f172a", building.property_management)}
          </div>
          <div>
            ${ROW("空置率", vacText)}
            ${ROW("表面租金", faceRentText)}
            ${ROW("净有效租金", rentText, "#003e7e")}
            ${ROW("物业费", mgtFeeText)}
            ${ROW("更新时间", latestQuarter, "#003e7e")}
          </div>
        </div>

        <div id="info-chart-panel" style="display:none; border-top:1px dashed #e2e8f0; padding-top:10px; margin-bottom:10px;">
          <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:8px;">
            <span style="font-size:12px; font-weight:800; color:#334155;">近五年趋势追踪</span>
            <div style="display:flex; gap:4px;">
              <button id="chart-btn-rent" data-chart="rent" style="
                font-size:10px; font-weight:700; padding:3px 10px; border-radius:4px;
                background:#003e7e; color:#fff; border:1px solid #003e7e;
                cursor:pointer; transition:all 0.15s;
              ">租金</button>
              <button id="chart-btn-vac" data-chart="vac" style="
                font-size:10px; font-weight:700; padding:3px 10px; border-radius:4px;
                background:#fff; color:#64748b; border:1px solid #e2e8f0;
                cursor:pointer; transition:all 0.15s;
              ">空置率</button>
            </div>
          </div>
          <div id="info-chart-container" style="width: 100%; height: 220px;"></div>
        </div>

        <div style="display: grid; grid-template-columns: repeat(2, 1fr); gap: 4px; margin-top: 10px;">
          ${ACTION_MODULES.map((module) => {
            const moduleDisabled = !module.enabled;

            if (!moduleDisabled) {
              const onClickHandler =
                module.id === "compare-nearby"
                  ? `window.__colliers_analyzeCompetitors('${building.id}', ${building.location_lng}, ${building.location_lat}, ${currentRent})`
                  : "";

              return `
                <button
                  onclick="${onClickHandler}"
                  style="
                    background: #fff;
                    color: #f59e0b;
                    border: 1px solid #fcd34d;
                    padding: 6px 2px;
                    border-radius: 5px;
                    font-size: 9px;
                    font-weight: 700;
                    cursor: pointer;
                    transition: all 0.2s;
                    box-shadow: 0 1px 3px rgba(245,158,11,0.1);
                    text-align: center;
                    white-space: nowrap;
                  "
                  onmouseover="this.style.background='#fef3c7'; this.style.borderColor='#f59e0b';"
                  onmouseout="this.style.background='#fff'; this.style.borderColor='#fcd34d';"
                >
                  ${module.label}
                </button>
              `;
            } else {
              return `
                <div style="
                  background: #f8fafc;
                  color: #94a3b8;
                  border: 1px solid #e2e8f0;
                  padding: 6px 2px;
                  border-radius: 5px;
                  font-size: 9px;
                  font-weight: 700;
                  cursor: not-allowed;
                  text-align: center;
                  opacity: 0.6;
                  white-space: nowrap;
                ">
                  ${module.label}
                </div>
              `;
            }
          }).join("")}

          <button onclick="window.__colliers_toggleTrend('${building.id}')"
            style="
              background: #fff;
              color: #8b5cf6;
              border: 1px solid #c4b5fd;
              padding: 6px 2px;
              border-radius: 5px;
              font-size: 9px;
              font-weight: 700;
              cursor: pointer;
              transition: all 0.2s;
              box-shadow: 0 1px 3px rgba(139,92,246,0.1);
              text-align: center;
              white-space: nowrap;
            "
            onmouseover="this.style.background='#f5f3ff'; this.style.borderColor='#8b5cf6';"
            onmouseout="this.style.background='#fff'; this.style.borderColor='#c4b5fd';"
          >
            趋势追踪
          </button>

          <button
            onclick="window.__colliers_showContactModal('${this._isDemo ? "***" : escapeHtml(name)}', '${this._isDemo ? "***" : escapeHtml(contactPhone)}')"
            style="
              background: #fff;
              color: #3b82f6;
              border: 1px solid #93c5fd;
              padding: 6px 2px;
              border-radius: 5px;
              font-size: 9px;
              font-weight: 700;
              cursor: pointer;
              transition: all 0.2s;
              box-shadow: 0 1px 3px rgba(59,130,246,0.1);
              text-align: center;
              white-space: nowrap;
            "
            onmouseover="this.style.background='#dbeafe'; this.style.borderColor='#3b82f6';"
            onmouseout="this.style.background='#fff'; this.style.borderColor='#93c5fd';"
          >
            联系方式
          </button>
        </div>

      </div>
    `;
  }

  getMapInstance(): unknown {
    return this.map;
  }

  clearMap(): void {
    if (!this.map) return;
    this.clearDistrictBoundaries();
    this.clearSubwayElements();
    this.clearCompetitorElements();
    this._safeRemove(this.markers);
    this._safeRemove(this.dotMarkers);
    this._safeRemove(this.submarketMarkers);
    this.markers = [];
    this.dotMarkers = [];
    this.submarketMarkers = [];
  }

  clearMarkers(): void {
    if (!this.map) return;
    this._safeRemove(this.markers);
    this._safeRemove(this.dotMarkers);
    this._safeRemove(this.submarketMarkers);
    this.markers = [];
    this.dotMarkers = [];
    this.submarketMarkers = [];
  }

  private _safeRemove(arr: unknown[]): void {
    if (arr.length > 0) {
      try { this.map!.remove(arr); } catch {}
    }
  }

  disableCluster(): void {
    if (!this.clusterer) return;
    try {
      this.clusterer.setMap?.(null);
      this.clusterer.clearMarkers?.();
    } catch {
    } finally {
      this.clusterer = null;
    }
  }

  /**
   * 🌟 打开指定楼宇的信息窗口
   */
  openBuildingInfoWindow(buildingId: string): void {
    if (!this.map || !this.AMap || !buildingId) return;

    // 从缓存中查找楼宇
    const building = this._allBuildingsCache.find((b) => b.id === buildingId);
    if (!building) {
      console.warn("[MapController] Building not found:", buildingId);
      return;
    }

    const lng = building.location_lng;
    const lat = building.location_lat;

    if (!Number.isFinite(lng) || !Number.isFinite(lat)) {
      console.warn(
        "[MapController] Invalid building coordinates:",
        building.name,
      );
      return;
    }

    const latestMetric = pickLatestMetric(building.metrics);
    const containerDiv = document.createElement("div");
    containerDiv.innerHTML = this.buildInfoWindowContent(
      building,
      latestMetric,
    );

    const info = new this.AMap.InfoWindow({
      isCustom: false,
      content: containerDiv,
      offset: new this.AMap.Pixel(0, -35),
      autoMove: true,
    });
    this.infoWindow = info;
    info.on("close", () => {
      // 关闭时销毁图表
      const trend = (window as any).__colliers_trend;
      if (trend?.chart) {
        trend.chart.dispose();
        trend.chart = null;
      }
      const panel = document.getElementById("info-chart-panel");
      if (panel) panel.style.display = "none";
    });
    // 打开信息窗口
    info.open(this.map, [lng, lat]);
  }

  /**
   * 设置管理员模式
   * @param isAdmin 是否为管理员
   * @param userId 当前用户ID
   * @param onEditCallback 编辑楼宇指标数据的回调函数
   */
  setAdminMode(
    isAdmin: boolean,
    userId?: string,
    onEditCallback?: (buildingId: string, buildingName: string) => void
  ): void {
    this._isAdmin = isAdmin;
    this._currentUserId = userId || null;
    this._onEditBuildingMetrics = onEditCallback || null;

    // 注册全局编辑函数
    if (isBrowser()) {
      if (isAdmin && onEditCallback) {
        (window as any).__colliers_editBuildingMetrics = (
          buildingId: string,
          buildingName: string
        ) => {
          this._onEditBuildingMetrics?.(buildingId, buildingName);
        };
      } else {
        delete (window as any).__colliers_editBuildingMetrics;
      }
    }
  }

  /**
   * 刷新指定楼宇的数据
   * @param buildingId 楼宇ID
   */
  async refreshBuildingData(buildingId: string): Promise<void> {
    if (this._destroyed) return;

    try {
      const { data, error } = await supabase
        .from('buildings')
        .select('*, building_metrics(*)')
        .eq('id', buildingId)
        .single();

      if (error) throw error;
      if (!data) return;

      // 用统一的转换函数清洗数据（与 fetchMapData 一致）
      const building = transformBuildingRow(data as Record<string, unknown>);

      // 更新缓存
      const index = this._allBuildingsCache.findIndex(b => b.id === buildingId);
      if (index !== -1) {
        this._allBuildingsCache[index] = building;
      } else {
        this._allBuildingsCache.push(building);
      }

      // 更新地图标记
      this._updateMarkerData(buildingId, building);

      // 使全局缓存失效（下次 fetchMapData 会重新查询）
      this._cachedMapDataPromise = null;

      // 更新 InfoWindow（如果当前打开的是这个楼宇）
      if (this.infoWindow && this.infoWindow.getVisible()) {
        const content = this.infoWindow.getContent();
        if (typeof content === 'string' && content.includes(buildingId)) {
          const latestMetric = pickLatestMetric(building.metrics);
          const newContent = this.buildInfoWindowContent(building, latestMetric);
          this.infoWindow.setContent(newContent);
        }
      }
    } catch (err) {
      console.error('刷新楼宇数据失败:', err);
      throw err;
    }
  }

  /**
   * 更新指定楼宇的标记数据
   */
  private _updateMarkerData(buildingId: string, building: BuildingWithMetrics): void {
    const marker = this.markers.find(m => {
      const extData = m.getExtData();
      return extData?.id === buildingId;
    });

    if (!marker) return;

    const latestMetric = pickLatestMetric(building.metrics);
    const updatedData = {
      ...marker.getExtData(),
      ...building,
      rent: latestMetric?.net_effective_rent || 0,
      vacancyRate: latestMetric?.vacancy_rate || 0,
      vacancyArea: latestMetric?.vacant_area || 0,
      totalArea: latestMetric?.total_area || 0,
    };

    marker.setExtData(updatedData);
    this._updateMarkerStyle(marker, updatedData);
  }

  /**
   * 更新标记样式
   */
  private _updateMarkerStyle(marker: any, data: any): void {
    // 这里可以根据当前渲染模式更新标记颜色等
    // 暂时留空，后续可以扩展
  }

  destroy(): void {
    this._destroyed = true;
    this.destroyHoverTooltip();
    this.clearMap();
    if (isBrowser()) {
      if ((window as any).__colliers_analyzeCompetitors) {
        delete (window as any).__colliers_analyzeCompetitors;
      }
      if ((window as any).__colliers_showContactModal) {
        delete (window as any).__colliers_showContactModal;
      }
      if ((window as any).__colliers_toggleTrend) {
        delete (window as any).__colliers_toggleTrend;
      }
      // 清理编辑楼宇指标数据函数
      if ((window as any).__colliers_editBuildingMetrics) {
        delete (window as any).__colliers_editBuildingMetrics;
      }
      // 清理趋势图状态
      const trend = (window as any).__colliers_trend;
      if (trend) {
        if (trend.chart) trend.chart.dispose();
        delete (window as any).__colliers_trend;
      }
      // 清理可能存在的联系方式弹窗
      const modalOverlay = document.getElementById(
        "__colliers_contact_modal_overlay",
      );
      if (modalOverlay) {
        modalOverlay.remove();
      }
    }
    this.infoWindow?.close?.();
    try {
      this.map?.destroy?.();
    } catch {}
    this.map = null;
    this.infoWindow = null;
    this.AMap = null;
  }
}
