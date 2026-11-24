/**
 * MapController：高德地图 JS API 终极控制器（去除冗杂框线、纯享双列UI、搜索聚焦、竞品分析雷达）
 */

"use client";
import { mountBuildingContactDialog } from "./map/buildingContactDialog";
import type { TrendChartReadingOptions } from "./map/trendChartReading";
import { hasLeedCertification, leedFallbackBadge } from '@/src/lib/leed-display';
import { hasMapCoordinates } from '@/src/lib/map-coordinates';
import { coordinateIssue, fitMapExtent } from '@/src/app/map/runtime/mapExtent';

import { WORKSPACE_MOTION } from '@/src/app/map/runtime/workspaceMotion';
import {beginBuildingReading,type ReadingEntry} from '@/src/utils/readingAuditContext';
import { createSelectionMarker, markerBadgeImage, futureSupplyImage } from '@/src/app/map/runtime/mapSelectionMarker';
import { markerTextColor } from '@/src/app/map/runtime/mapMarkerContrast';
import type { WorkspaceBuildingDetail, WorkspaceBuilding } from '@/src/app/map/workspace/buildingDetail';
import { auditBuildingReading } from '@/src/utils/buildingReadingAudit';
import { resolveBuildingId } from './buildingIdentity';

import { supabase } from "./supabaseClient";
import { isDemoMode } from "@/src/config/demoMode";
import { getSessionFast } from "./Auth";
import { fetchBuildingTrendPayload, fetchFutureSupplyPayload, fetchMapBuildingPayload } from "./mapDataClient";
import { recordMapStartup } from "@/src/utils/mapStartupProbe";
import { futureSupplyDisplayLabel, isCommercialFutureSupply } from "@/src/app/map/model/mapDomain";
import { readMapVisibleArea, visibleMapRect, visibleProjectCenter } from "@/src/app/map/runtime/mapFocusViewport";
import { mapOptionalNumber, observedVacantArea } from "@/src/app/map/model/vacancyMetrics";
import { futureSupplyDate, isPendingFutureSupply } from "@/src/lib/future-supply-status";
import { MAP_BUILDING_TIER_MIN_ZOOM } from "@/src/app/map/runtime/mapMarkerZoom";
import { clearMapReadCache } from "./mapReadCache";
import { bindBuildingPopup } from "./map/buildingPopup";
import { summarizeSubmarkets, officeGrade } from "@/src/app/map/model/submarketOverview";
import { normalizeMapSubmarket } from "@/src/app/map/model/mapDomain";
import { getBuildingMediaPilot } from "@/src/lib/sales-materials/building-media-pilot";
import { bindBuildingPhotoGallery, buildPhotoGallery, buildPhotoTrigger, type GalleryPhoto } from "./map/buildingPhotoGallery";
import { photoSummaries } from "@/src/lib/building-photos/model";

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
      total_area: mapOptionalNumber(rm.total_area),
      asking_rent: mapOptionalNumber(rm.asking_rent),
      management_fee: mapOptionalNumber(rm.management_fee),
      face_rent: mapOptionalNumber(rm.face_rent),
      rent_free_period: mapOptionalNumber(rm.rent_free_period),
      net_effective_rent: mapOptionalNumber(rm.net_effective_rent),
      vacancy_rate: mapOptionalNumber(rm.vacancy_rate),
      vacant_area: mapOptionalNumber(rm.vacant_area),
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
    photos: photoSummaries(r.photos),
    metrics,
  };
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
      bgColor = "#4f7968";
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
    const vac = mapOptionalNumber(latestMetric?.vacancy_rate);
    fontSize = "10px";
    if (!Number.isFinite(vac) || isFuture) {
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
      bgColor = "#d9edf3";
      borderColor = "#68aebf";
      textColor = "#225a68";
      text = "P"; // 铂金
    } else if (leed.includes("GOLD")) {
      bgColor = "#eadfbd";
      borderColor = "#b69a52";
      textColor = "#6f5a25";
      text = "G"; // 黄金
    } else if (leed.includes("SILVER")) {
      bgColor = "#e7ebef";
      borderColor = "#9ca8b3";
      textColor = "#52606d";
      text = "S"; // 白银
    } else {
      bgColor = "#eef1f4";
      borderColor = "#bdc6ce";
      textColor = "#6f7c89";
      text = leedFallbackBadge(leed); // 缺失与明确未认证分开
    }
  }

  // 对比组颜色只属于“项目”模式；租金 / 空置 / LEED 模式必须保持指标图例语义。
  if (comparisonGroupColor && mode === "default") {
    bgColor = comparisonGroupColor;
    borderColor = "#ffffff";
    textColor = "#ffffff";
  }

  return { bgColor, borderColor, textColor: markerTextColor(bgColor, textColor), text, fontSize };
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
      (!building.submarket || !g.submarkets.includes(building.submarket))
    )
      continue;
    if (g.grades.length > 0 && !matchesGroupGrades(building.grade, g.grades))
      continue;
    if (
      g.districts.length > 0 &&
      (!building.district || !g.districts.includes(building.district))
    )
      continue;
    return g.color;
  }
  return undefined;
}

export class MapController<T extends BuildingMarkerData = BuildingMarkerData> {
  private AMap: any | null = null;
  private map: any | null = null;
  private initialTilesReady = false;
  private baseMapPointsVisible = false;
  private infoWindow: any | null = null;
  private workspaceDetailHandler: ((detail: WorkspaceBuildingDetail) => void) | null = null;
  private workspaceBuilding: WorkspaceBuilding | null = null;
  private workspaceSelectionMarker: any | null = null;
  private workspaceSubmarket: string | null = null;

  private workspaceSelectedBuilding: WorkspaceBuilding | null = null;
  private workspaceSelectionContent: HTMLDivElement | null = null;
  private workspaceSelectionRenderer: ((building: WorkspaceBuilding) => string) | null = null;
  private workspaceMarkerMode: RenderMode = 'default';
  private workspaceMarkerGroups: CompareGroup[] | undefined;

  setWorkspaceSelectionRenderer(renderer: ((building: WorkspaceBuilding) => string) | null): void {
    this.workspaceSelectionRenderer = renderer;
    if (renderer) this.refreshWorkspaceSelection();
  }
  private workspaceSelectionImage(building: WorkspaceBuilding): string {
    if (this.workspaceSelectionRenderer) return this.workspaceSelectionRenderer(building);
    if (building._dataType === 'future') return futureSupplyImage(building, this.workspaceMarkerMode);
    const style = getMarkerStyle(building, pickLatestMetric(building.metrics ?? []), this.workspaceMarkerMode, false,
      this.workspaceMarkerGroups ? findBuildingGroupColor(building, this.workspaceMarkerGroups) : undefined);
    return markerBadgeImage({ background: style.bgColor, border: style.borderColor, textColor: style.textColor,
      text: style.text, fontSize: parseFloat(style.fontSize) });
  }
  refreshWorkspaceSelection(): void {
    const image = this.workspaceSelectionContent?.querySelector('img');
    if (!image || !this.workspaceSelectedBuilding) return;
    const next = this.workspaceSelectionImage(this.workspaceSelectedBuilding);
    if (image.getAttribute('src') !== next) image.src = next;
  }

  /** Public base-layer features only; project overlays and camera are independent. */
  setBaseMapPointsVisible(visible: boolean): void {
    this.baseMapPointsVisible = visible;
    this.map?.setFeatures?.(this.baseMapFeatures());
  }
  private baseMapFeatures(): string[] {
    return this.baseMapPointsVisible ? ['bg', 'road', 'building', 'point'] : ['bg', 'road', 'building'];
  }

  setWorkspaceSubmarket(name: string | null): void { this.workspaceSubmarket = name; }
  isWorkspaceActive(): boolean { return Boolean(this.workspaceDetailHandler); }
  setWorkspaceSelection(building: WorkspaceBuilding | null): void {
    const previousAction = this.workspaceSelectionContent?.querySelector<HTMLButtonElement>('button');
    if (previousAction) previousAction.onclick = null;
    if (this.workspaceSelectionMarker) this.map?.remove?.(this.workspaceSelectionMarker);
    this.workspaceSelectionMarker = null;
    this.workspaceSelectionContent = null;
    this.workspaceSelectedBuilding = building;
    if (!this.map || !building || !hasMapCoordinates(building) || !this.AMap?.Marker) return;
    const content = createSelectionMarker(this.workspaceSelectionImage(building), building._dataType === 'future', {
      name: building.name || '未命名项目', onLocate: () => this.locateWorkspaceSelection(building),
    });
    this.workspaceSelectionContent = content;
    this.workspaceSelectionMarker = new this.AMap.Marker({ position: [building.location_lng, building.location_lat], content, anchor: 'center', zIndex: 999999, bubble: true });
    this.map.add(this.workspaceSelectionMarker);
  }

  private locateWorkspaceSelection(building: WorkspaceBuilding): void {
    const current = () => !this._destroyed && this.workspaceSelectedBuilding === building && hasMapCoordinates(building);
    if (!current()) return;
    const move = (immediately = false) => {
      if (!current() || !this.map) return;
      const zoom = Number(this.map.getZoom?.());
      const reduced = immediately || (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false);
      const targetZoom = Math.max(14, Math.min(18, Number.isFinite(zoom) ? zoom : 14));
      let center: [number, number] = [building.location_lng!, building.location_lat!];
      const container = this.map.getContainer?.() ?? document.getElementById('map-container');
      if (container) {
        const { rect, reserved } = readMapVisibleArea(container), visible = visibleMapRect(rect, reserved);
        if (visible.width < 16 || visible.height < 16) return;
        center = visibleProjectCenter(center, targetZoom, rect, visible);
      }
      this.map.setZoomAndCenter(targetZoom, center, reduced, reduced ? 0 : WORKSPACE_MOTION.spatial);
    };
    if (this.workspaceCameraHandler) this.workspaceCameraHandler(move);
    else move();
  }

  /** React owns detail rendering; the controller retains existing authorized data/actions. */
  setWorkspaceDetailHandler(handler: ((detail: WorkspaceBuildingDetail) => void) | null): void {
    this.workspaceDetailHandler = handler;
  }

  getWorkspaceBuildingDetail(building: WorkspaceBuilding): WorkspaceBuildingDetail {
    const future = building._dataType === 'future';
    return { building, metric: future ? null : pickLatestMetric(building.metrics ?? []),
      photos: this.getPhotoSet(future ? building.building_id ?? undefined : building.id, building.photos)?.photos ?? [],
      isDemo: this._isDemo, canEdit: this._isAdmin && !this._isDemo && !future,
      overrides: Object.fromEntries(this._displayOverridesCache.get(building.id) ?? []) };
  }

  runWorkspaceBuildingAction(action: 'nearby' | 'contact' | 'trend' | 'edit', building: WorkspaceBuilding, trendReading?: TrendChartReadingOptions): void {
    if (action === 'edit') { if (this._isAdmin && !this._isDemo && building._dataType !== 'future') this._onEditBuildingMetrics?.(building.id, building.name ?? ''); }
    if (action === 'nearby' && hasMapCoordinates(building)) {
      (window as any).__colliers_analyzeCompetitors?.(building.id, building.location_lng, building.location_lat, Number(pickLatestMetric(building.metrics ?? [])?.net_effective_rent ?? 0));
    }
    if (action === 'contact') (window as any).__colliers_showContactModal?.(this._isDemo ? '***' : building.name, this._isDemo ? '***' : building.contact_phone || '', building.id);
    if (action === 'trend') (window as any).__colliers_toggleTrend?.(building.id, trendReading);
  }

  disposeWorkspaceTrend(): void { this.clearBuildingPopupTrend(); }
  closeWorkspaceBuilding(): void { this.workspaceBuilding = null; this.setWorkspaceSelection(null); this.clearBuildingPopupTrend(); }

  private publishWorkspaceBuilding(building: WorkspaceBuilding): boolean {
    if (!this.workspaceDetailHandler) return false;
    this.hideHoverTooltip();
    this.workspaceBuilding = building;
    this.setWorkspaceSelection(building);
    this.workspaceDetailHandler(this.getWorkspaceBuildingDetail(building));
    auditBuildingReading('VIEW_BUILDING', building, undefined, this._isDemo);
    return true;
  }
  private buildingPopupBinding: ReturnType<typeof bindBuildingPopup> | null = null;
  private futurePhotoCleanup: (() => void) | null = null;

  private markers: any[] = [];
  private dotMarkers: any[] = []; // Level 3: 小圆点标记
  private closeContactDialog?: () => void;
  private futureMarkers: any[] = [];
  private futureMarkersById = new Map<string, any>();
  private _cachedFutureSuppliesPromise: Promise<any[]> | null = null;
  private submarketMarkers: any[] = [];
  private currentRenderMode: "submarket" | "dot" | "building" | null = null;
  private _zoomListenerBound = false;
  private clusterer: any | null = null;

  private districtPolygons: any[] = [];
  private _districtRenderVersion = 0;
  private _subwayRenderVersion = 0;
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
        buildingId?: string,
      ) => {
        try {
          this.closeContactDialog = mountBuildingContactDialog(buildingName, contactPhone, () => {
            if (buildingId && !this._destroyed) auditBuildingReading('VIEW_BUILDING_CONTACT', { id: buildingId, name: buildingName }, undefined, this._isDemo);
          });
        } catch (error) {
          console.error("[Action Module] Failed to show contact modal", error);
          alert("联系方式弹窗加载失败，请稍后再试。");
        }
      };

      const toggleTrend = (window as any).__colliers_toggleTrend = (buildingId: string, reading?: TrendChartReadingOptions) => {
        const panel = document.getElementById("info-chart-panel");
        if (!panel) return;
        const trend = (window as any).__colliers_trend;
        const isSameBuilding = trend?.buildingId === buildingId;
        const showing = panel.style.display === "none";
        // 切换面板显示
        panel.style.display = showing ? "block" : "none";
        if (!showing) {
          trend.readRequest = null;
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
        const readRequest = Symbol('trend-read');
        trend.readRequest = readRequest;
        const isCurrentRead = () => !this._destroyed && trend.readRequest === readRequest &&
          trend.buildingId === buildingId && panel.isConnected && panel.style.display !== 'none';
        const showStatus = (state: 'loading' | 'empty' | 'error', message: string) => {
          const hadFocus = chartDom.contains(document.activeElement);
          panel.dataset.trendState = state;
          chartDom.hidden = false;
          const status = document.createElement('div');
          status.className = 'workspace-trend-status';
          const text = document.createElement('span');
          text.setAttribute('role', 'status');
          text.textContent = message;
          status.append(text);
          if (state === 'error') {
            const retry = document.createElement('button');
            retry.type = 'button';
            retry.className = 'workspace-business-action';
            retry.textContent = '重试读取历史数据';
            retry.addEventListener('click', () => {
              if (!isCurrentRead()) return;
              panel.style.display = 'none';
              toggleTrend(buildingId, reading);
            });
            status.append(retry);
          }
          chartDom.replaceChildren(status);
          if (hadFocus) {
            status.tabIndex = -1;
            (status.querySelector('button') ?? status).focus({ preventScroll: true });
          }
        };
        // 重置状态
        trend.buildingId = buildingId;
        trend.data = null;
        if (trend.chart) {
          trend.chart.dispose();
          trend.chart = null;
        }
        // 显示加载状态
        showStatus('loading', '加载中...');
        // 用户已明确打开 Trend：让图表运行时和历史数据请求并行，消除串行 waterfall。
        // 仍然保持在 Trend 点击之后才加载，因此不会进入 Map 首屏 bundle。
        const trendRuntimePromise = import("./map/trendChartRuntime");
        // 获取数据：最新季度 + 前面年份的Q4，最近6年。通过服务端权限边界读取，
        // 使真实 viewer 与管理员模拟 viewer 使用完全相同的数据范围。
        fetchBuildingTrendPayload(buildingId)
          .then((data) => {
            // 竞态保护：如果用户已切换到其他楼宇，跳过渲染
            if (!isCurrentRead()) return;
            if (!data?.length) {
              showStatus('empty', '暂无历史数据');
              reading?.onReady?.();
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
              period: `${r.record_year}Q${r.record_quarter}`,
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
            // 动态模块加载期间用户可能关闭面板或切换楼宇，因此渲染前后都做竞态保护。
            void trendRuntimePromise
              .then(({ initTrendChart }) => {
                if (!isCurrentRead()) {
                  return;
                }

                requestAnimationFrame(() => {
                  if (!isCurrentRead()) {
                    return;
                  }

                  const restoreFocus = chartDom.contains(document.activeElement);
                  panel.dataset.trendState = 'ready';
                  chartDom.innerHTML = "";
                  const building = this.workspaceBuilding?.id === buildingId ? this.workspaceBuilding : this._allBuildingsCache.find(item => item.id === buildingId);
                  const chart = initTrendChart(chartDom, chartData, metric => {
                    auditBuildingReading('VIEW_BUILDING_TREND', { id: buildingId, name: building?.name }, { metric }, this._isDemo);
                  }, reading);
                  if (chart) trend.chart = chart;
                  if (restoreFocus) panel.querySelector<HTMLElement>('.workspace-trend-switch [aria-pressed="true"]')?.focus({ preventScroll: true });
                  reading?.onReady?.();
                });
              })
              .catch((error) => {
                if (!isCurrentRead()) {
                  return;
                }
                console.error("[MapController] 趋势图运行时加载失败:", error);
                showStatus('error', '趋势图加载失败，请稍后重试');
                reading?.onReady?.();
              });
          })
          .catch((error) => {
            if (!isCurrentRead()) return;
            console.error("[MapController] 历史趋势读取失败:", error);
            showStatus('error', '历史数据读取失败，请稍后重试');
            reading?.onReady?.();
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
    this.initialTilesReady = false;

    try {
      const securityCode = getSafeAmapSecurityCode();
      if (securityCode && securityCode !== "这里粘贴你的真实高德安全密钥") {
        (window as any)._AMapSecurityConfig = { securityJsCode: securityCode };
      }
      const amapKey = getSafeAmapKey();

      recordMapStartup('sdk_start');
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
      recordMapStartup('sdk_ready');
      this.AMap = AMap;

      const containerEl = document.getElementById(containerId);
      if (!containerEl) return;

      this.map = new AMap.Map(containerId, {
        zoom: options?.zoom ?? DEFAULT_MAP_ZOOM,
        center: [resolvedCenter.lng, resolvedCenter.lat],
        viewMode: options?.viewMode ?? "2D",
        mapStyle: options?.mapStyle ?? "amap://styles/whitesmoke",
        features: this.baseMapFeatures(),
      });
      const initialMap = this.map;
      // A warm map can complete before the runtime resumes after awaiting initMap.
      // Keep this listener until map destruction so other listeners see the same event.
      initialMap.on("complete", () => {
        if (!this._destroyed && this.map === initialMap && !this.initialTilesReady) {
          this.initialTilesReady = true;
          recordMapStartup('tiles_complete');
        }
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
      this.map.on("click", (event?: { originEvent?: Event }) => {
        if (this.workspaceDetailHandler) return;
        const target = event?.originEvent?.target;
        if (target instanceof Element && target.closest(".building-popup")) return;
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

      // MapClient owns data loading, role filtering and the first marker render.
      // Do not render here as well: it duplicates the complete marker construction path.
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
    if (!this.map || !this.AMap || !this._allBuildingsCache.length || !hasMapCoordinates({ location_lng: lng, location_lat: lat })) return;

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

    // Future supply has a separate marker layer; clear via the public method so
    // V3 and fallback renderers also forget their pending future-marker state.
    this.clearFutureMarkers();

    const centerPoint = this._compCenterPoint;
    const buildingId = this._compBuildingId;
    const radius = this._compRadius;

    // 计算距离并筛选
    this._compDistances.clear();
    const hasGradeFilter = this._compFilterGrades.size > 0;
    const hasLeedFilter = this._compFilterLeeds.size > 0;
    const hasConds = this._compFilterConds.length > 0;

    const competitors = this._allBuildingsCache.filter((b) => {
      if (this.workspaceSubmarket && normalizeMapSubmarket(b.submarket) !== this.workspaceSubmarket) return false;
      if (b.id === buildingId) return false;
      if (!hasMapCoordinates(b)) return false;
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
          const raw = (latest as unknown as Record<string, unknown>)[cond.field];
          if (raw === null || raw === undefined || raw === "") return false;
          // building_metrics.vacancy_rate is a 0-1 fraction; the filter UI uses percent.
          const val = Number(raw) * (cond.field === "vacancy_rate" ? 100 : 1);
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

    this.fitToBuildings(markersToRender);

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
      if (!hasMapCoordinates({ location_lng: lng, location_lat: lat })) continue;

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
        <div class="map-competitor-marker" data-building-id="${building.id}" style="
          display:flex;flex-direction:column;align-items:center;gap:2px;
        ">
          <div class="map-competitor-marker__core" style="
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
      marker.on("click", () => this.showBuildingPopup(building, pickLatestMetric(building.metrics)));

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
        background:#ffffff;
        border:1px solid #d9e0e8; border-radius:6px;
        box-shadow:0 3px 12px rgba(23,32,51,0.10);
        font-family:-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
        width:min(520px, calc(100vw - 24px)); max-width:520px; min-width:0; box-sizing:border-box;
      ">
        <div style="display:flex; align-items:center; gap:6px; padding:8px 10px; flex-wrap:wrap; row-gap:6px;">
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
                border-radius:6px;padding:3px 8px;cursor:pointer;
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
            <span class="comp-filter-collapse" style="font-size:11px;color:#94a3b8;cursor:pointer;display:flex;align-items:center;gap:2px;padding:2px 6px;border-radius:4px;" title="收起筛选面板">
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
  public bounceMarker(buildingId: string, type: 'existing' | 'future' = 'existing') {
    if (!this.map) return;
    if (type === 'future') {
      const marker = this.futureMarkersById.get(buildingId);
      if (!marker) return;
      marker.setOpacity?.(0.72); marker.setzIndex?.(999999);
      requestAnimationFrame(() => { if (this.futureMarkersById.get(buildingId) === marker) marker.setOpacity?.(1); });
      return;
    }
    const el = this.map
      .getContainer()
      ?.querySelector(
        `[data-building-id="${buildingId}"]`,
      ) as HTMLElement | null;
    if (!el) return;
    // List hover identifies the same geographic point without moving it or
    // forcing layout on every repeated pointer entry.
    el.classList.add('map-marker-linked');
  }

  public stopBounceMarker(buildingId: string, type: 'existing' | 'future' = 'existing') {
    if (!this.map) return;
    if (type === 'future') {
      const marker = this.futureMarkersById.get(buildingId);
      marker?.setOpacity?.(1); marker?.setzIndex?.(110);
      return;
    }
    const el = this.map
      .getContainer()
      ?.querySelector(
        `[data-building-id="${buildingId}"]`,
      ) as HTMLElement | null;
    if (el) el.classList.remove('map-marker-linked');
  }

  private restoreAllMarkers() {
    if (!this.map || !this._allBuildingsCache.length) return;
    this.renderMarkers(this._allBuildingsCache, "default");
  }

  // 显示未来供应悬停提示框
  public showFutureSupplyHoverTooltip(
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
    const pending = isPendingFutureSupply(supply);
    const time = futureSupplyDate(supply);

    tooltip.innerHTML = `
      <div style="font-size: 13px; font-weight: 700; color: #0f172a; margin-bottom: 6px; line-height: 1.3;">
        <span style="background:#d1fae5; color:#047857; font-size:9px; padding:1px 4px; border-radius:3px; font-weight:bold; margin-right:4px;">${futureSupplyDisplayLabel(supply)}</span>
        ${this._mask(name)}
      </div>
      <div style="display: flex; gap: 16px;">
        <div>
          <div style="font-size: 10px; color: #94a3b8; margin-bottom: 2px;">${pending ? '时间状态' : '预计入市'}</div>
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
    if (this.buildingPopupBinding) return;
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

  private workspaceCameraHandler: ((move: (immediately?: boolean) => void) => void) | null = null;
  setWorkspaceCameraHandler(handler: ((move: (immediately?: boolean) => void) => void) | null) { this.workspaceCameraHandler = handler; }

  fitToBuildings(buildingsData: BuildingWithMetrics[], coordinated = false, immediately = false): boolean {
    if (!coordinated && this.workspaceCameraHandler) {
      this.workspaceCameraHandler(immediate => this.fitToBuildings(buildingsData, true, immediate));
      return false;
    }
    if (!this.map || !this.AMap || buildingsData.length === 0) return false;

    const container = this.map.getContainer?.() ?? document.getElementById('map-container');
    if (!container) return false;
    const { rect, reserved } = readMapVisibleArea(container);
    const camera = fitMapExtent(buildingsData, rect, visibleMapRect(rect, reserved));
    // Diagnose invalid coordinates without correcting production records or
    // excluding a geographically distant but valid business project.
    const invalid = buildingsData.flatMap(building => {
      const issue = coordinateIssue(building);
      return issue && issue !== 'missing' ? [{ id: building.id, issue }] : [];
    });
    if (invalid.length) console.warn('[MapController] Unlocatable project coordinates', invalid);
    if (!camera) return false;
    const reduced = immediately || (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false);
    this.map.setZoomAndCenter(camera.zoom, camera.center, reduced, reduced ? 0 : WORKSPACE_MOTION.spatial);
    return true;
  }

  /** 恢复地图工作台的初始总览视野（大气泡层级）。 */
  resetToDefaultView(coordinated = false, immediately = false) {
    if (!coordinated && this.workspaceCameraHandler) {
      this.workspaceCameraHandler(immediate => this.resetToDefaultView(true, immediate));
      return;
    }
    if (!this.map) return;
    const reduced = immediately || (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false);
    this.map.setZoomAndCenter(DEFAULT_MAP_ZOOM, [
      DEFAULT_MAP_CENTER.lng,
      DEFAULT_MAP_CENTER.lat,
    ], reduced, reduced ? 0 : WORKSPACE_MOTION.spatial);
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
    const renderVersion = ++this._districtRenderVersion;
    this._clearDistrictBoundariesNow();
    if (districts.length === 0) return;

    try {
      const mapData = await this.loadLocalMapData();
      if (this._destroyed || renderVersion !== this._districtRenderVersion) return;

      for (const districtName of districts) {
        if (renderVersion !== this._districtRenderVersion) return;
        const districtData = mapData.districts.find(
          (d) => d.name === districtName,
        );

        if (!districtData) {
          console.warn(`未找到行政区数据: ${districtName}`);
          continue;
        }

        for (const boundary of districtData.boundaries) {
          if (renderVersion !== this._districtRenderVersion) return;
          const polygon = new this.AMap.Polygon({
            strokeWeight: 2,
            path: boundary,
            fillOpacity: 0.05,
            fillColor: "#003e7e",
            strokeColor: "#003e7e",
            strokeStyle: "dashed",
            strokeDasharray: [1, 5],
          });
          this.districtPolygons.push(polygon);
          this.map.add(polygon);
        }
      }
    } catch (error) {
      if (renderVersion === this._districtRenderVersion) {
        console.error("绘制行政区边界失败:", error);
      }
    }
  }

  private _clearDistrictBoundariesNow() {
    if (this.map && this.districtPolygons.length > 0) {
      this.map.remove(this.districtPolygons);
    }
    this.districtPolygons = [];
  }

  clearDistrictBoundaries() {
    this._districtRenderVersion += 1;
    this._clearDistrictBoundariesNow();
  }

  /**
   * 绘制地铁线路（离线版本，从本地 JSON 读取）
   */
  async fetchAndDrawSubwayLine(lineName: string): Promise<any[]> {
    if (!this.AMap || !this.map) return [];
    const renderVersion = ++this._subwayRenderVersion;
    this._clearSubwayElementsNow();

    try {
      const mapData = await this.loadLocalMapData();
      if (this._destroyed || renderVersion !== this._subwayRenderVersion) return [];

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
      if (renderVersion !== this._subwayRenderVersion) return [];

      this.subwayPolyline = new this.AMap.Polyline({
        path: subwayData.path,
        strokeColor: "#e11d48",
        strokeWeight: 4,
        strokeStyle: "solid",
        lineJoin: "round",
      });
      this.map.add(this.subwayPolyline);
      // Completing an asynchronous layer read does not own the workspace camera.
      if (!this.isWorkspaceActive()) this.map.setFitView([this.subwayPolyline]);
      return subwayData.stations;
    } catch (error) {
      if (renderVersion === this._subwayRenderVersion) {
        console.error("绘制地铁线路失败:", error);
      }
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
    if (!this.isWorkspaceActive()) this.map.setFitView([this.radiusCircle]);
  }

  private _clearSubwayElementsNow() {
    if (this.map) {
      if (this.subwayPolyline) this.map.remove(this.subwayPolyline);
      if (this.stationMarker) this.map.remove(this.stationMarker);
      if (this.radiusCircle) this.map.remove(this.radiusCircle);
    }
    this.subwayPolyline = null;
    this.stationMarker = null;
    this.radiusCircle = null;
  }

  clearSubwayElements() {
    this._subwayRenderVersion += 1;
    this._clearSubwayElementsNow();
  }

  calculateDistance(
    lngLat1: [number, number],
    lngLat2: [number, number],
  ): number {
    if (!this.AMap?.GeometryUtil) {
      const rad = Math.PI / 180;
      const lat = (lngLat2[1] - lngLat1[1]) * rad, lng = (lngLat2[0] - lngLat1[0]) * rad;
      const arc = Math.sin(lat / 2) ** 2 + Math.cos(lngLat1[1] * rad) * Math.cos(lngLat2[1] * rad) * Math.sin(lng / 2) ** 2;
      return 6378137 * 2 * Math.asin(Math.sqrt(Math.max(0, Math.min(1, arc))));
    }
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
      const payload = await fetchMapBuildingPayload("all");

      this._displayOverridesCache = new Map();
      for (const override of payload.displayOverrides) {
        if (!this._displayOverridesCache.has(override.building_id)) {
          this._displayOverridesCache.set(override.building_id, new Map());
        }
        this._displayOverridesCache.get(override.building_id)!.set(
          override.field_name,
          { display_label: override.display_label, display_value: override.display_value },
        );
      }

      const rows = Array.isArray(payload.buildings) ? payload.buildings : [];
      const buildings: BuildingWithMetrics[] = [];
      let skippedNoCoords = 0;
      for (const row of rows) {
        const building = transformBuildingRow(row as Record<string, unknown>);
        if (building.location_lng === null || building.location_lat === null) skippedNoCoords += 1;
        buildings.push(building);
      }

      this._allBuildingsCache = buildings.filter(
        building => building.id !== "" && building.name !== "",
      );
      console.log(
        `[MapController] 角色范围数据加载: ${this._allBuildingsCache.length} 条建筑, 其中 ${skippedNoCoords} 条无坐标`,
      );
      return this._allBuildingsCache;
    })();

    try {
      const buildings = await this._cachedMapDataPromise;
      if (buildings.length === 0) this._cachedMapDataPromise = null;
      return buildings;
    } catch (error) {
      this._cachedMapDataPromise = null;
      throw error;
    }
  }

  async fetchFutureSupplies(): Promise<any[]> {
    if (this._cachedFutureSuppliesPromise) return this._cachedFutureSuppliesPromise;
    this._cachedFutureSuppliesPromise = fetchFutureSupplyPayload();

    try {
      return await this._cachedFutureSuppliesPromise;
    } catch (error) {
      this._cachedFutureSuppliesPromise = null;
      throw error;
    }
  }

  renderFutureMarkers(
    supplies: any[],
    renderMode: RenderMode = "default",
  ): void {
    if (this._destroyed || !this.map || !this.AMap) return;
    this.workspaceMarkerMode = renderMode;
    this.refreshWorkspaceSelection();
    const AMap = this.AMap;

    this.removeFutureMarkerOverlays();
    if (!Array.isArray(supplies) || supplies.length === 0) return;

    for (const supply of supplies) {
      const lng = toNullableFiniteNumber(supply.location_lng);
      const lat = toNullableFiniteNumber(supply.location_lat);
      if (!hasMapCoordinates({ location_lng: lng, location_lat: lat })) continue;

      const markerEl = `<div class="map-future-supply-marker" data-future-supply-id="${escapeHtml(supply.id)}" role="img" aria-label="${futureSupplyDisplayLabel(supply)}"><img src="${futureSupplyImage(supply, renderMode)}" width="34" height="34" alt="" /></div>`;

      const marker = new AMap.Marker({
        position: [lng, lat],
        content: markerEl,
        offset: new AMap.Pixel(-17, -17),
        zooms: [MAP_BUILDING_TIER_MIN_ZOOM, 20],
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
        this.openFutureSupplyInfoWindow(supply);
      });

      this.futureMarkers.push(marker);
      this.futureMarkersById.set(String(supply.id), marker);
    }

    this.map.add(this.futureMarkers);
  }

  clearFutureMarkers(): void {
    this.removeFutureMarkerOverlays();
  }

  private removeFutureMarkerOverlays(): void {
    this.futureMarkersById.clear();
    if (!this.map) { this.futureMarkers = []; return; }
    if (this.futureMarkers.length > 0) {
      try {
        this.map.remove(this.futureMarkers);
      } catch (e) {}
    }
    this.futureMarkers = [];
  }

  openFutureSupplyInfoWindow(supply: any, entry:ReadingEntry='map_marker'): void {
    if (!supply || this._destroyed) return;
    beginBuildingReading(supply.id,entry,supply.building_id);
    if (this.publishWorkspaceBuilding({ ...supply, _dataType: 'future' })) return;
    if (!this.map || !this.AMap) return;
    const lng = toNullableFiniteNumber(supply.location_lng);
    const lat = toNullableFiniteNumber(supply.location_lat);
    if (!hasMapCoordinates({ location_lng: lng, location_lat: lat })) return;

    if (this.buildingPopupBinding) {
      this.infoWindow?.close?.();
      this.releaseBuildingPopup();
    }
    this.releaseFuturePhotoGallery();
    const containerDiv = document.createElement("div");
    containerDiv.innerHTML = this.buildFutureSupplyInfoWindow(supply);
    const info = new this.AMap.InfoWindow({
      isCustom: false,
      offset: new this.AMap.Pixel(0, -35),
      // Popup placement is handled locally; opening a future card must not pan the map.
      autoMove: false,
      content: containerDiv,
    });
    this.infoWindow = info;
    const pilot = this.getPhotoSet(supply.building_id, supply.photos);
    if (pilot) {
      const dispose = bindBuildingPhotoGallery(containerDiv, supply.building_id, pilot.photos);
      this.futurePhotoCleanup = dispose;
      info.on("close", () => {
        if (this.futurePhotoCleanup === dispose) this.releaseFuturePhotoGallery();
      });
    }
    info.open(this.map, [lng, lat]);
    auditBuildingReading('VIEW_BUILDING', { ...supply, _dataType: 'future' }, undefined, this._isDemo);
  }

  private buildFutureSupplyInfoWindow(supply: any): string {
    const name = escapeHtml(supply.name);
    const photoPilot = this.getPhotoSet(supply.building_id, supply.photos);
    const galleryId = photoPilot ? `building-gallery-${escapeHtml(supply.building_id)}` : "";
    const commercial = isCommercialFutureSupply(supply);
    const pending = isPendingFutureSupply(supply);
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
    const notes = typeof supply.notes === "string" ? escapeHtml(supply.notes.trim()) : "";
    const materialsButton = supply.building_id && !pending ? `
      <button type="button" data-map-action="building-sales-control"
        data-building-id="${escapeHtml(supply.building_id)}" data-building-name="${name}"
        style="width:100%;min-height:44px;margin-top:8px;background:var(--cd-color-surface);color:var(--cd-color-brand);border:1px solid var(--cd-color-border);border-radius:5px;font-size:14px;font-weight:600;cursor:pointer;">
        项目资料与佣金
      </button>` : '';

    return `
      <div class="map-future-popup" style="width:min(300px, calc(100vw - 72px)); max-width:300px; min-width:240px; box-sizing:border-box; font-family:ui-sans-serif,system-ui,-apple-system; background:#ffffff; padding:4px;">
        <div style="margin-bottom: 10px; border-bottom: 2px solid #10b981; padding-bottom: 8px;">
           <span style="background:#d1fae5; color:#047857; font-size:10px; padding:2px 6px; border-radius:4px; font-weight:bold; margin-right:6px;">${futureSupplyDisplayLabel(supply)}</span>
           ${photoPilot
             ? `<div class="building-pilot-title-row building-pilot-title-row--future"><span class="building-pilot-name" title="${name}">${name}</span>${buildPhotoTrigger(galleryId)}</div>`
             : `<span style="font-size:16px; font-weight:900; color:#0f172a;">${this._mask(name)}</span>`}
        </div>
        ${photoPilot ? buildPhotoGallery(galleryId, name, photoPilot.photos) : ""}
        <div style="font-size: 12px; color: #475569; line-height: 1.8;">
          <div style="display:flex; justify-content:space-between;"><span>预计入市：</span> <span style="font-weight:700; color:#10b981;">${time}</span></div>
          <div style="display:flex; justify-content:space-between;"><span>总体量：</span> <span style="font-weight:700; color:#0f172a;">${area}</span></div>
          ${commercial || pending ? "" : `<div style="display:flex; justify-content:space-between;"><span>楼宇等级：</span> <span style="font-weight:700; color:#0f172a;">${grade}</span></div>`}
          <div style="display:flex; justify-content:space-between;"><span>业主：</span> <span style="font-weight:700; color:#0f172a;">${this._mask(owner)}</span></div>
          ${notes ? `<div style="margin-top: 8px; padding-top: 8px; border-top: 1px dashed #e2e8f0;">
             <span style="color:#94a3b8;">备注：</span><span style="color:#64748b; font-size:11px;">${notes}</span>
          </div>` : ""}
          ${materialsButton}
        </div>
      </div>
    `;
  }

  renderMarkers(
    buildingsData: BuildingWithMetrics[],
    renderMode: RenderMode = "default",
    districtLeedMap?: Map<string, { totalCount: number; leedCount: number }>,
    comparisonGroups?: CompareGroup[],
    // Read by the installed overview renderers; legacy point rendering ignores it.
    _showAreaPlaceholders = false,
    overviewBuildings?: BuildingWithMetrics[],
  ): void {
    if (this._destroyed || !this.map || !this.AMap) return;
    this.workspaceMarkerMode = renderMode;
    this.workspaceMarkerGroups = comparisonGroups;
    this.refreshWorkspaceSelection();
    const AMap = this.AMap;
    this.clearMarkers();

    const items = Array.isArray(buildingsData) ? buildingsData : [];
    if (items.length === 0) return;

    for (const building of items) {
      const lng = building.location_lng;
      const lat = building.location_lat;
      if (!hasMapCoordinates({ location_lng: lng, location_lat: lat })) continue;

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
        ">
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

      marker.on("click", () => this.showBuildingPopup(building, latestMetric));
      this.markers.push(marker);
    }

    const submarketMap = new Map<string, any>();
    const visibleSubmarkets = new Set(items.map(b => normalizeMapSubmarket(b.submarket)));
    const scopedSubmarketSummaries = summarizeSubmarkets(overviewBuildings ?? items);
    for (const b of overviewBuildings ?? items) {
      const sub = normalizeMapSubmarket(b.submarket);
      if (!visibleSubmarkets.has(sub)) continue;
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
      if (officeGrade(b.grade) === 'a' || officeGrade(b.grade) === 'b') agg.count += 1;
      if (hasMapCoordinates(b)) {
        agg.lngSum += b.location_lng;
        agg.latSum += b.location_lat;
        agg.coordCount += 1;
      }

      const latest = pickLatestMetric(b.metrics);
      if (latest) {
        const area = Number(latest.total_area);
        const rent = Number(latest.net_effective_rent);
        const vacArea = observedVacantArea(latest);
        if (Number.isFinite(area) && area > 0 && Number.isFinite(vacArea)) {
          agg.totalArea += area;
          agg.vacantArea += vacArea;
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
        if (hasLeedCertification(b.leed_certification)) {
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
      const fullSummary = scopedSubmarketSummaries.get(agg.name);
      const avgRentNum = fullSummary?.rent ?? 0;
      const vacRateNum = fullSummary?.vacancyPct ?? Number.NaN;

      // 显示用的文本
      const avgRent = avgRentNum > 0 ? avgRentNum.toFixed(1) : "-";
      const vacRate = Number.isFinite(vacRateNum) ? vacRateNum.toFixed(1) : "-";

      // ================ 增加模式联动的气泡样式引擎 ================
      let bgColor = "rgba(0, 62, 126, 0.92)"; // 默认底色（蓝）
      let hoverColor = "rgba(0, 62, 126, 1)";

      let extraContent = `
        <div style="font-size: 11px; font-weight: 700; opacity: 0.95;">¥${avgRent} · ${vacRate === "-" ? "—" : `${vacRate}%`}</div>
        <div style="font-size: 11px; font-weight: 700; color: #fcd34d;">甲乙级 ${fullSummary?.officeCount ?? 0} 个</div>
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
          <div style="font-size: 11px; font-weight: 700; opacity: 0.95;">¥${avgRent} · ${vacRate === "-" ? "—" : `${vacRate}%`}</div>
          <div style="font-size: 11px; font-weight: 700; color: #fcd34d;">甲乙级 ${fullSummary?.officeCount ?? 0} 个</div>
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
          <div style="font-size: 11px; font-weight: 700; opacity: 0.95;">¥${avgRent} · ${vacRate === "-" ? "—" : `${vacRate}%`}</div>
          <div style="font-size: 11px; font-weight: 700; color: #fcd34d;">甲乙级 ${fullSummary?.officeCount ?? 0} 个</div>
        `;
      } else if (renderMode === "leed") {
        // 直接从子市场的楼宇计算 LEED 认证率
        const buildingsInSubmarket = items.filter(
          (b) => b.submarket === agg.name,
        );

        let totalCount = 0;
        let leedCount = 0;

        for (const b of buildingsInSubmarket) {
          if (hasLeedCertification(b.leed_certification)) {
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
          <div style="font-size: 12px; font-weight: 700; opacity: 0.95;">${leedPercentage}% · 甲乙级 ${fullSummary?.officeCount ?? 0} 个</div>
        `;
      }

      const smMarkerEl = `
        <div style="
          width: 102px; height: 102px; border-radius: 50%;
          background: ${bgColor}; border: 2px solid rgba(255,255,255,0.9);
          box-shadow: 0 8px 24px rgba(0,0,0,0.2); display: flex; flex-direction: column; align-items: center; justify-content: center;
          color: #ffffff; cursor: pointer; transition: background-color 120ms;
        " onmouseover="this.style.background='${hoverColor}';" onmouseout="this.style.background='${bgColor}';">
          <div style="font-size: 13px; font-weight: 900; margin-bottom: 2px; text-shadow: 0 1px 2px rgba(0,0,0,0.4); line-height:1.2; text-align:center;">${agg.name.length > 5 ? escapeHtml(agg.name.slice(0, Math.ceil(agg.name.length / 2))) + "<br>" + escapeHtml(agg.name.slice(Math.ceil(agg.name.length / 2))) : escapeHtml(agg.name)}</div>
          ${extraContent}
        </div>
      `;

      const smMarker = new AMap.Marker({
        position: [centerLng, centerLat],
        content: smMarkerEl,
        offset: new AMap.Pixel(-51, -51),
        zIndex: 90,
      });
      smMarker.on("click", () => {
        window.dispatchEvent(new CustomEvent("map-submarket-open", { detail: { name: agg.name } }));
      });
      this.submarketMarkers.push(smMarker);
    }

    // ================ Level 3: 小圆点标记（zoom 12-14）================
    this.dotMarkers = [];
    for (const building of items) {
      const lng = building.location_lng;
      const lat = building.location_lat;
      if (!hasMapCoordinates({ location_lng: lng, location_lat: lat })) continue;

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
          transition: opacity 120ms;
          box-shadow: 0 1px 3px rgba(0,0,0,0.2);
        "
        onmouseover="this.style.opacity='1';"
        onmouseout="this.style.opacity='0.85';"
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
        if (this.workspaceDetailHandler) { this.showBuildingPopup(building, latestMetric); return; }
        this.map.setZoomAndCenter(14, [lng, lat]);
        // 延迟显示 InfoWindow，等待缩放动画完成
        setTimeout(() => {
          this.showBuildingPopup(building, latestMetric);
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

  /** 获取楼宇字段的显示覆盖规则 */
  getDisplayOverride(buildingId: string, fieldName: string): { display_label: string; display_value: string } | null {
    return this._displayOverridesCache.get(buildingId)?.get(fieldName) ?? null;
  }

  /** 获取所有显示覆盖规则缓存 */
  getDisplayOverridesCache(): Map<string, Map<string, { display_label: string; display_value: string }>> {
    return this._displayOverridesCache;
  }

  private getPhotoSet(buildingId?: string, storedPhotos?: unknown): { photos: GalleryPhoto[] } | null {
    if (this._isDemo || !buildingId) return null;
    const pilot = getBuildingMediaPilot(buildingId);
    const photos: GalleryPhoto[] = [
      ...(pilot?.photos.map((photo, pilotIndex) => ({ ...photo, pilotIndex })) ?? []),
      ...photoSummaries(storedPhotos),
    ];
    return photos.length ? { photos } : null;
  }

  private releaseFuturePhotoGallery() {
    this.futurePhotoCleanup?.();
    this.futurePhotoCleanup = null;
  }

  private buildInfoWindowContent(
    building: BuildingWithMetrics,
    latestMetric: BuildingMetric | null,
  ): string {
    const name = escapeHtml(this._isDemo ? "***" : building.name);
    const id = escapeHtml(building.id);
    const photoPilot = this.getPhotoSet(building.id, building.photos);
    const galleryId = `building-gallery-${id}`;
    const grade = this.getDisplayOverride(building.id, "grade");
    const submarket = this.getDisplayOverride(building.id, "submarket");
    const protectedText = (value: string | null | undefined) => this._isDemo && value ? "***" : value || "暂无";
    const row = (label: string, value: unknown, emphasize = false) => `
      <div class="building-popup__row">
        <dt>${escapeHtml(label)}</dt><dd${emphasize ? ' class="building-popup__metric-key"' : ""} data-popup-value="${escapeHtml(label)}"><span class="building-popup__value">${escapeHtml(value)}</span></dd>
      </div>`;
    const leed = building.leed_certification;
    const currency = (value: number | null | undefined) => value == null ? "—" : formatZhNumber(Number(value));
    const quarter = latestMetric ? `${latestMetric.record_year}Q${latestMetric.record_quarter}` : "无数据";

    return `
      <section class="building-popup" data-building-id="${id}" data-building-name="${name}" aria-label="${name}楼宇详情">
        <header class="building-popup__titlebar">
          <div class="building-popup__title">
            ${photoPilot
              ? `<div class="building-pilot-title-row"><h2 class="building-pilot-name" title="${name}">${name}</h2>${buildPhotoTrigger(galleryId)}</div>`
              : `<h2>${name}</h2>`}
            ${leed && leed !== "NULL" ? `<span class="building-popup__certification">LEED ${escapeHtml(leed)}</span>` : ""}
          </div>
          <button type="button" class="building-popup__quiet building-popup__close" data-popup-action="close" aria-label="关闭楼宇详情">
            <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"><path d="m6 6 12 12M18 6 6 18"/></svg>
          </button>
        </header>
        <div class="building-popup__body">
          <div class="building-popup__summary">
            ${photoPilot ? buildPhotoGallery(galleryId, name, photoPilot.photos) : ""}
            <div class="building-popup__facts">
              <section class="building-popup__group" aria-label="楼宇概况">
                <div class="building-popup__group-head"><h3>楼宇概况</h3></div>
                <dl>
                  ${row(grade?.display_label ?? "楼宇等级", grade?.display_value ?? displayGrade(building.grade))}
                  ${row(submarket?.display_label ?? "子市场", submarket?.display_value ?? (building.submarket || "—"))}
                  ${row("入市时间", building.completion_year || "—")}
                  ${row("项目业主", protectedText(building.owner))}
                  ${row("物业公司", protectedText(building.property_management))}
                </dl>
              </section>
              <section class="building-popup__group building-popup__metrics" aria-label="经营指标">
                <div class="building-popup__group-head">
                  <h3>经营指标</h3>
                  <button type="button" class="building-popup__quiet building-popup__edit" data-popup-action="edit" aria-label="编辑指标"${this._isAdmin ? "" : " hidden"}>编辑</button>
                </div>
                <dl>
                  ${row("空置率", latestMetric ? formatVacancyRate(latestMetric.vacancy_rate) : "—")}
                  ${row("表面租金", currency(latestMetric?.face_rent))}
                  ${row("净有效租金", currency(latestMetric?.net_effective_rent), latestMetric?.net_effective_rent != null)}
                  ${row("物业费", currency(latestMetric?.management_fee))}
                  ${row("指标季度", quarter)}
                </dl>
                <p class="building-popup__units">租金及物业费：元/㎡/月</p>
              </section>
            </div>
          </div>
          <div class="building-popup__actions" role="group" aria-label="楼宇操作">
            <button type="button" class="building-popup__action" data-map-action="nearby-compare" data-popup-action="nearby">周边项目对比</button>
            <button type="button" class="building-popup__action" data-map-action="building-compare">楼宇对比</button>
            <button type="button" class="building-popup__action" data-map-action="building-ai" hidden>AI 分析</button>
            <button type="button" class="building-popup__action" data-map-action="related-leases">关联成交</button>
            ${this._isAdmin && !this._isDemo && building.id === "9ee3e3ff-4845-41a1-a78f-390c11b1917a" ? `<a class="building-popup__action" href="/stacking-plan/${id}" aria-label="查看${name}的租赁堆叠图">Stacking Plan</a>` : ""}
            <button type="button" class="building-popup__action" data-map-action="trend" data-popup-action="trend" aria-controls="info-chart-panel" aria-expanded="false">季度趋势</button>
            <button type="button" class="building-popup__action" data-map-action="contact" data-popup-action="contact">联系方式</button>
            <button type="button" class="building-popup__action" data-map-action="building-sales-control"
              data-building-id="${id}" data-building-name="${escapeHtml(building.name)}" data-category="availability">销控与佣金</button>
            <button type="button" class="building-popup__action" data-map-action="building-sales-control"
              data-building-id="${id}" data-building-name="${escapeHtml(building.name)}" data-category="brochure">楼书与资料</button>
          </div>
          <div class="building-popup__proposal" data-map-proposal-slot hidden></div>
          <div id="info-chart-panel" class="building-popup__trend" style="display:none">
            <div class="building-popup__trend-head">
              <h3>近五年趋势追踪</h3>
              <div class="building-popup__trend-tabs">
                <button type="button" id="chart-btn-rent" data-chart="rent" class="building-popup__action">租金</button>
                <button type="button" id="chart-btn-vac" data-chart="vac" class="building-popup__action">空置率</button>
              </div>
            </div>
            <div id="info-chart-container"></div>
          </div>
        </div>
      </section>`;
  }

  private createBuildingPopupContent(building: BuildingWithMetrics, metric: BuildingMetric | null) {
    const content = document.createElement("div");
    content.innerHTML = this.buildInfoWindowContent(building, metric);
    const root = content.firstElementChild as HTMLElement;
    this.buildingPopupBinding?.dispose();
    const popup = bindBuildingPopup(root, action => {
      switch (action) {
        case "close":
          this.infoWindow?.close?.();
          break;
        case "edit":
          if (this._isAdmin) this._onEditBuildingMetrics?.(building.id, building.name);
          break;
        case "nearby":
          (window as any).__colliers_analyzeCompetitors?.(building.id, building.location_lng, building.location_lat, metric ? Number(metric.net_effective_rent) : 0);
          break;
        case "contact":
          (window as any).__colliers_showContactModal?.(this._isDemo ? "***" : building.name, this._isDemo ? "***" : building.contact_phone || "", building.id);
          break;
        case "trend": {
          (window as any).__colliers_toggleTrend?.(building.id);
          const showing = root.querySelector<HTMLElement>("#info-chart-panel")?.style.display === "block";
          root.toggleAttribute("data-trend-open", showing);
          root.querySelector('[data-map-action="trend"]')?.setAttribute("aria-expanded", String(showing));
          if (showing) {
            const body = root.querySelector<HTMLElement>(".building-popup__body");
            if (body) body.scrollTop = body.scrollHeight;
          }
          break;
        }
      }
    });
    const pilot = this.getPhotoSet(building.id, building.photos);
    const disposeGallery = pilot ? bindBuildingPhotoGallery(root, building.id, pilot.photos) : null;
    this.buildingPopupBinding = {
      ...popup,
      dispose() {
        disposeGallery?.();
        popup.dispose();
      },
    };
    return content;
  }

  private showBuildingPopup(building: BuildingWithMetrics, metric: BuildingMetric | null, entry:ReadingEntry='map_marker') {
    if (this._destroyed) return;
    beginBuildingReading(building.id,entry);
    if (this.publishWorkspaceBuilding({ ...building, _dataType: 'existing' })) return;
    if (!this.map || !this.AMap) return;
    this.hideHoverTooltip();
    // Replacing the card must not clear an active nearby comparison.
    this._isClearingCompetitor = true;
    this.infoWindow?.close?.();
    this._isClearingCompetitor = false;
    this.releaseBuildingPopup();
    this.releaseFuturePhotoGallery();
    const content = this.createBuildingPopupContent(building, metric);
    const info = new this.AMap.InfoWindow({
      isCustom: false,
      content,
      offset: new this.AMap.Pixel(0, -35),
      // The workbench fits the card around its own controls without moving the map.
      autoMove: false,
    });
    this.infoWindow = info;
    info.on("close", () => {
      if (this.infoWindow !== info) return;
      this.releaseBuildingPopup();
    });
    info.open(this.map, [building.location_lng, building.location_lat]);
    auditBuildingReading('VIEW_BUILDING', building, undefined, this._isDemo);
  }

  private releaseBuildingPopup() {
    if (!this.buildingPopupBinding) return;
    this.buildingPopupBinding.dispose();
    this.buildingPopupBinding = null;
    this.clearBuildingPopupTrend();
  }

  private clearBuildingPopupTrend() {
    const trend = (window as any).__colliers_trend;
    if (trend?.chart) {
      trend.chart.dispose();
      trend.chart = null;
    }
    if (trend) trend.buildingId = null;
  }

  /** Close the active detail without changing zoom, filters or the map viewport. */
  closeInfoWindow(): void {
    this.infoWindow?.close?.();
  }

  getMapInstance(): unknown {
    return this.map;
  }

  areInitialTilesReady(): boolean {
    return this.initialTilesReady;
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
  openBuildingInfoWindow(buildingId: string, entry:ReadingEntry='map_list'): void {
    if (this._destroyed || !buildingId) return;

    // 从缓存中查找楼宇
    const building = this._allBuildingsCache.find((b) => b.id === buildingId);
    if (!building) {
      console.warn("[MapController] Building not found:", buildingId);
      return;
    }

    if (this.workspaceDetailHandler) { this.showBuildingPopup(building, pickLatestMetric(building.metrics),entry); return; }
    if (!this.map || !this.AMap) return;
    const lng = building.location_lng;
    const lat = building.location_lat;

    if (!hasMapCoordinates({ location_lng: lng, location_lat: lat })) {
      console.warn(
        "[MapController] Invalid building coordinates:",
        building.name,
      );
      return;
    }

    this.showBuildingPopup(building, pickLatestMetric(building.metrics),entry);
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

    const content = this.infoWindow?.getContent?.();
    if (content instanceof HTMLElement) {
      const edit = content.querySelector<HTMLButtonElement>('.building-popup__edit');
      if (edit) edit.hidden = !isAdmin;
    }
  }

  /**
   * 刷新指定楼宇的数据
   * @param buildingId 楼宇ID
   */
  async refreshBuildingData(buildingId: string): Promise<void> {
    clearMapReadCache();
    if (this._destroyed) return;

    try {
      buildingId = await resolveBuildingId(supabase, buildingId);
      const { data, error } = await supabase
        .from('buildings')
        .select('*, building_metrics(*)')
        .eq('id', buildingId)
        .single();

      if (error) throw error;
      if (!data) return;

      // 用统一的转换函数清洗数据（与 fetchMapData 一致）
      const cached = this._allBuildingsCache.find(b => b.id === buildingId);
      const building = transformBuildingRow({ ...data, photos: cached?.photos });

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

      if (this.workspaceBuilding?.id === buildingId && this.workspaceBuilding._dataType !== 'future') {
        this.publishWorkspaceBuilding({ ...building, _dataType: 'existing' });
      }
      // 更新 InfoWindow（如果当前打开的是这个楼宇）。AMap 当前传入的是 DOM 容器而非字符串。
      if (this.infoWindow && this.infoWindow.getVisible()) {
        const content = this.infoWindow.getContent();
        const contentElement = content instanceof HTMLElement ? content : null;
        const rootBuildingId = contentElement?.firstElementChild?.getAttribute('data-building-id')
          ?? contentElement?.getAttribute('data-building-id');
        const matchesCurrentBuilding = typeof content === 'string'
          ? content.includes(`data-building-id="${buildingId}"`)
          : rootBuildingId === buildingId;

        if (matchesCurrentBuilding) {
          const latestMetric = pickLatestMetric(building.metrics);
          this.clearBuildingPopupTrend();
          this.infoWindow.setContent(this.createBuildingPopupContent(building, latestMetric));
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
      vacancyRate: mapOptionalNumber(latestMetric?.vacancy_rate),
      vacancyArea: mapOptionalNumber(latestMetric?.vacant_area),
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
    this.closeContactDialog?.();
    this.closeContactDialog = undefined;
    this.initialTilesReady = false;
    this.releaseBuildingPopup();
    this.releaseFuturePhotoGallery();
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
    this.setWorkspaceSelection(null);
    this.workspaceDetailHandler = null;
    this.workspaceBuilding = null;
    this.AMap = null;
  }
}

