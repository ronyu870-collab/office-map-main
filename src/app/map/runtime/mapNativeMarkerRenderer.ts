'use client';

import type { MapController } from '@/src/services/MapController';
import { createAreaPlaceholder, getAreaPlaceholders } from './mapSubmarketOverview';

type RenderMode = 'default' | 'rent' | 'vacancy' | 'leed';
type MarkerMode = 'submarket' | 'dot' | 'building';
type EventHandler = (event?: any) => void;

type MarkerLike = {
  show?: () => void;
  hide?: () => void;
  on?: (eventName: string, handler: EventHandler) => void;
  off?: (eventName: string, handler: EventHandler) => void;
  setOpacity?: (opacity: number) => void;
};

type LabelMarkerLike = MarkerLike & {
  setzIndex?: (zIndex: number) => void;
};

type LabelsLayerLike = {
  add?: (markers: LabelMarkerLike[] | LabelMarkerLike) => void;
  clear?: () => void;
  setOpacity?: (opacity: number) => void;
};

type MassMarksLike = {
  setMap?: (map: MapLike | null) => void;
  clear?: () => void;
  on?: (eventName: string, handler: EventHandler) => void;
  off?: (eventName: string, handler: EventHandler) => void;
  setOpacity?: (opacity: number) => void;
};

export type MapLike = {
  add?: (overlays: unknown[] | unknown) => void;
  remove?: (overlays: unknown[] | unknown) => void;
  getZoom?: () => number;
  setZoomAndCenter?: (
    zoom: number,
    center: [number, number],
    immediately?: boolean,
    duration?: number,
  ) => void;
  on?: (eventName: string, handler: EventHandler) => void;
  off?: (eventName: string, handler: EventHandler) => void;
};

type AMapToolkit = {
  Marker?: new (options: Record<string, unknown>) => MarkerLike;
  Pixel?: new (x: number, y: number) => unknown;
  Size?: new (width: number, height: number) => unknown;
  LabelsLayer?: new (options: Record<string, unknown>) => LabelsLayerLike;
  LabelMarker?: new (options: Record<string, unknown>) => LabelMarkerLike;
  MassMarks?: new (
    data: Array<Record<string, unknown>>,
    options: Record<string, unknown>,
  ) => MassMarksLike;
};

export type ControllerInternals = {
  AMap?: AMapToolkit | null;
  map?: MapLike | null;
  markers?: MarkerLike[];
  dotMarkers?: MarkerLike[];
  submarketMarkers?: MarkerLike[];
  currentRenderMode?: MarkerMode | null;
  infoWindow?: { close?: () => void } | null;
  updateVisibilityByZoom?: () => void;
  renderMarkers: (...args: any[]) => void;
  clearMarkers: () => void;
  renderFutureMarkers?: (...args: any[]) => void;
  clearFutureMarkers?: () => void;
  openBuildingInfoWindow?: (buildingId: string) => void;
  bounceMarker?: (buildingId: string) => void;
  stopBounceMarker?: (buildingId: string) => void;
  refreshBuildingData?: (buildingId: string) => Promise<void>;
  showHoverTooltip?: (building: any, x: number, y: number) => void;
  hideHoverTooltip?: () => void;
  _allBuildingsCache?: any[];
};

type BuildingVisual = {
  background: string;
  border: string;
  textColor: string;
  text: string;
  fontSize: number;
};

type SubmarketAggregate = {
  name: string;
  lngSum: number;
  latSum: number;
  coordCount: number;
  count: number;
  totalArea: number;
  vacantArea: number;
  rentWeightSum: number;
  rentWeightAreaSum: number;
  leedCount: number;
};

const MARKER_ZOOM = {
  submarketMax: 11.58,
  dotMin: 11.05,
  dotMax: 13.35,
  detailMin: 12.72,
  nameMin: 14.05,
} as const;

const PALETTE = {
  brand: '#245b78',
  gradeA: '#245b78',
  gradeB: '#4f7968',
  gradeBP: '#9b6948',
  neutral: '#8794a4',
  low: '#4f7968',
  medium: '#967a43',
  high: '#a56142',
  extreme: '#97515a',
};

function escapeHtml(input: unknown): string {
  return String(input ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function isFiniteCoordinate(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function clamp(value: number, min = 0, max = 1): number {
  return Math.min(max, Math.max(min, value));
}

function smoothStep(start: number, end: number, value: number): number {
  if (end <= start) return value >= end ? 1 : 0;
  const t = clamp((value - start) / (end - start));
  return t * t * (3 - 2 * t);
}

function latestMetric(
  building: any,
  cache: WeakMap<object, any | null>,
): any | null {
  if (!building || typeof building !== 'object') return null;
  if (cache.has(building)) return cache.get(building) ?? null;

  let latest: any | null = null;
  let order = Number.NEGATIVE_INFINITY;
  for (const metric of Array.isArray(building.metrics) ? building.metrics : []) {
    const nextOrder =
      (Number(metric?.record_year) || 0) * 10 +
      (Number(metric?.record_quarter) || 0);
    if (nextOrder > order) {
      latest = metric;
      order = nextOrder;
    }
  }
  cache.set(building, latest);
  return latest;
}

function matchesGroupGrades(grade: string, groupGrades: string[]): boolean {
  if (groupGrades.length === 0) return true;
  const normalized = (grade || '').toUpperCase();
  return groupGrades.some(filterGrade => {
    if (filterGrade === '产业园') return normalized.includes('BP');
    if (filterGrade === '甲级') {
      return (
        (normalized.includes('A') || normalized.includes('P')) &&
        !normalized.includes('BP')
      );
    }
    if (filterGrade === '乙级') {
      return normalized.includes('B') && !normalized.includes('BP');
    }
    return false;
  });
}

function comparisonColor(building: any, groups?: any[]): string | undefined {
  if (!Array.isArray(groups)) return undefined;
  for (let index = groups.length - 1; index >= 0; index -= 1) {
    const group = groups[index];
    if (
      group?.submarkets?.length > 0 &&
      (!building.submarket || !group.submarkets.includes(building.submarket))
    ) continue;
    if (
      group?.grades?.length > 0 &&
      !matchesGroupGrades(building.grade, group.grades)
    ) continue;
    if (
      group?.districts?.length > 0 &&
      (!building.district || !group.districts.includes(building.district))
    ) continue;
    if (typeof group?.color === 'string' && group.color) return group.color;
  }
  return undefined;
}

function scaleColor(value: number, hasValue = true): string {
  if (!hasValue) return PALETTE.neutral;
  if (value >= 300) return PALETTE.extreme;
  if (value >= 200) return PALETTE.high;
  if (value >= 100) return PALETTE.medium;
  return PALETTE.low;
}

function vacancyColor(value: number, hasValue = true): string {
  if (!hasValue) return PALETTE.neutral;
  if (value >= 30) return PALETTE.extreme;
  if (value >= 20) return PALETTE.high;
  if (value >= 10) return PALETTE.medium;
  return PALETTE.low;
}

function buildingVisual(
  building: any,
  mode: RenderMode,
  metric: any | null,
  groups?: any[],
): BuildingVisual {
  let background: string = PALETTE.gradeA;
  let border = '#ffffff';
  let textColor = '#ffffff';
  let text = 'A';
  let fontSize = 12;

  if (mode === 'default') {
    const grade = String(building?.grade ?? '').toUpperCase();
    if (grade.includes('BP')) {
      background = PALETTE.gradeBP;
      text = 'BP';
      fontSize = 9;
    } else if (grade.includes('A') || grade.includes('P')) {
      background = PALETTE.gradeA;
      text = 'A';
    } else if (grade.includes('B')) {
      background = PALETTE.gradeB;
      text = 'B';
    } else {
      background = PALETTE.neutral;
      text = '·';
    }
  } else if (mode === 'rent') {
    const rent = Number(metric?.net_effective_rent);
    const hasRent = Number.isFinite(rent) && rent > 0;
    text = hasRent ? String(Math.round(rent)) : '–';
    background = scaleColor(rent, hasRent);
    fontSize = text.length >= 3 ? 9.5 : 10.5;
  } else if (mode === 'vacancy') {
    const vacancy = Number(metric?.vacancy_rate);
    const hasVacancy = Number.isFinite(vacancy);
    const pct = hasVacancy ? (vacancy <= 1 ? vacancy * 100 : vacancy) : 0;
    text = hasVacancy ? `${Math.round(pct)}%` : '–';
    background = vacancyColor(pct, hasVacancy);
    fontSize = text.length >= 3 ? 9 : 10;
  } else {
    const leed = String(building?.leed_certification ?? '').toUpperCase();
    if (leed.includes('PLATINUM')) {
      background = '#d9edf3';
      border = '#68aebf';
      textColor = '#225a68';
      text = 'P';
    } else if (leed.includes('GOLD')) {
      background = '#eadfbd';
      border = '#b69a52';
      textColor = '#6f5a25';
      text = 'G';
    } else if (leed.includes('SILVER')) {
      background = '#e7ebef';
      border = '#9ca8b3';
      textColor = '#52606d';
      text = 'S';
    } else {
      background = '#eef1f4';
      border = '#bdc6ce';
      textColor = '#6f7c89';
      text = 'N';
    }
  }

  const groupColor = mode === 'default' ? comparisonColor(building, groups) : undefined;
  if (groupColor) {
    background = groupColor;
    border = '#ffffff';
    textColor = '#ffffff';
  }

  return { background, border, textColor, text, fontSize };
}

function submarketAccent(
  mode: RenderMode,
  rent: number,
  vacancy: number,
  leed: number,
): string {
  if (mode === 'default') return PALETTE.brand;
  if (mode === 'rent') return scaleColor(rent, rent > 0);
  if (mode === 'vacancy') return vacancyColor(vacancy, Number.isFinite(vacancy));
  if (leed >= 60) return '#3f715f';
  if (leed >= 40) return '#537f6c';
  if (leed >= 20) return '#6f927f';
  if (leed > 0) return '#88a493';
  return PALETTE.neutral;
}

function svgDataUri(svg: string): string {
  return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`;
}

function dotImage(background: string, border: string): string {
  return svgDataUri(
    `<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 12 12">` +
      '<circle cx="6" cy="6" r="5.25" fill="#ffffff" fill-opacity="0.92"/>' +
      `<circle cx="6" cy="6" r="4.15" fill="${background}" stroke="${border}" stroke-width="0.7"/>` +
      '</svg>',
  );
}

function detailBubbleImage(visual: BuildingVisual): string {
  const safeText = escapeHtml(visual.text);
  return svgDataUri(
    `<svg xmlns="http://www.w3.org/2000/svg" width="34" height="34" viewBox="0 0 34 34">` +
      '<circle cx="17" cy="17" r="16" fill="#ffffff" fill-opacity="0.96"/>' +
      `<circle cx="17" cy="17" r="13.7" fill="${visual.background}" stroke="${visual.border}" stroke-width="1.3"/>` +
      `<text x="17" y="17.4" text-anchor="middle" dominant-baseline="middle" ` +
      `font-family="Arial, PingFang SC, Microsoft YaHei, sans-serif" font-size="${visual.fontSize}" ` +
      `font-weight="800" fill="${visual.textColor}">${safeText}</text>` +
      '</svg>',
  );
}

function currentMode(zoom: number): MarkerMode {
  return zoom < 11.32 ? 'submarket' : zoom < 13 ? 'dot' : 'building';
}

function stableMode(zoom: number, active: MarkerMode | null): MarkerMode {
  if (active === 'submarket' && zoom < 11.5) return 'submarket';
  if (active === 'dot' && zoom >= 11.14 && zoom < 13.18) return 'dot';
  if (active === 'building' && zoom >= 12.82) return 'building';
  return currentMode(zoom);
}

function renderSignature(
  buildings: any[],
  mode: RenderMode,
  groups: any[] | undefined,
  objectTokens: WeakMap<object, number>,
  metricCache: WeakMap<object, any | null>,
  nextToken: () => number,
): string {
  let hash = 2166136261;
  const feed = (value: string) => {
    for (let index = 0; index < value.length; index += 1) {
      hash ^= value.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
  };

  feed(mode);
  for (const building of buildings) {
    let token = 0;
    if (building && typeof building === 'object') {
      token = objectTokens.get(building) ?? nextToken();
      if (!objectTokens.has(building)) objectTokens.set(building, token);
    }
    const metric = latestMetric(building, metricCache);
    feed([
      building?.id ?? '',
      token,
      building?.name ?? '',
      building?.grade ?? '',
      building?.submarket ?? '',
      building?.district ?? '',
      building?.leed_certification ?? '',
      building?.location_lng ?? '',
      building?.location_lat ?? '',
      metric?.record_year ?? '',
      metric?.record_quarter ?? '',
      metric?.net_effective_rent ?? '',
      metric?.vacancy_rate ?? '',
      metric?.total_area ?? '',
      metric?.vacant_area ?? '',
    ].join(':') + '|');
  }
  if (Array.isArray(groups)) {
    for (const group of groups) {
      feed(
        `${group?.id ?? ''}:${group?.color ?? ''}:` +
        `${(group?.submarkets ?? []).join(',')}:` +
        `${(group?.grades ?? []).join(',')}:` +
        `${(group?.districts ?? []).join(',')}|`,
      );
    }
  }
  return `${buildings.length}:${hash >>> 0}`;
}

export function installFallbackMarkerHardening(
  controller: ControllerInternals,
  container: HTMLElement,
): () => void {
  const map = controller.map;
  if (!map || typeof map.getZoom !== 'function') return () => {};

  const originalUpdate = controller.updateVisibilityByZoom?.bind(controller);
  const mounted = new Set<MarkerMode>();
  let active: MarkerMode | null = null;
  let frame: number | null = null;

  const markersFor = (mode: MarkerMode) =>
    mode === 'submarket'
      ? controller.submarketMarkers ?? []
      : mode === 'dot'
        ? controller.dotMarkers ?? []
        : controller.markers ?? [];

  const choose = (): MarkerMode => {
    const building = controller.markers ?? [];
    const dots = controller.dotMarkers ?? [];
    const submarkets = controller.submarketMarkers ?? [];
    if (building.length > 0 && dots.length === 0 && submarkets.length === 0) {
      return 'building';
    }
    return stableMode(map.getZoom?.() ?? 14, active);
  };

  const visibility = (mode: MarkerMode, visible: boolean) => {
    for (const marker of markersFor(mode)) {
      if (visible) marker.show?.();
      else marker.hide?.();
    }
  };

  const apply = () => {
    frame = null;
    const next = choose();
    if (next === active && mounted.has(next)) return;

    container.classList.add('map-marker-switching');
    if (active && active !== next) visibility(active, false);
    if (!mounted.has(next)) {
      const markers = markersFor(next);
      if (markers.length > 0) map.add?.(markers as unknown[]);
      mounted.add(next);
    }
    visibility(next, true);
    if (next !== 'building') controller.infoWindow?.close?.();

    controller.currentRenderMode = next;
    active = next;
    container.dataset.markerTier = next;
    requestAnimationFrame(() => container.classList.remove('map-marker-switching'));
  };

  const schedule = () => {
    if (frame !== null) cancelAnimationFrame(frame);
    frame = requestAnimationFrame(apply);
  };

  controller.updateVisibilityByZoom = schedule;
  return () => {
    if (frame !== null) cancelAnimationFrame(frame);
    if (originalUpdate) controller.updateVisibilityByZoom = originalUpdate;
    container.classList.remove('map-marker-switching');
    delete container.dataset.markerTier;
  };
}

export function installNativeMarkerRenderer(
  controller: ControllerInternals,
  container: HTMLElement,
): (() => void) | null {
  const map = controller.map;
  const AMap = controller.AMap;
  const Marker = AMap?.Marker;
  const Pixel = AMap?.Pixel;
  const Size = AMap?.Size;
  const LabelsLayer = AMap?.LabelsLayer;
  const LabelMarker = AMap?.LabelMarker;
  const MassMarks = AMap?.MassMarks;
  if (!map || !Marker || !Pixel || !Size || !LabelsLayer || !LabelMarker || !MassMarks) {
    return null;
  }

  const originalRender = controller.renderMarkers.bind(controller);
  const originalClear = controller.clearMarkers.bind(controller);
  const originalUpdate = controller.updateVisibilityByZoom?.bind(controller);
  const originalBounce = controller.bounceMarker?.bind(controller);
  const originalStopBounce = controller.stopBounceMarker?.bind(controller);
  const originalRefresh = controller.refreshBuildingData?.bind(controller);
  const originalFutureRender = controller.renderFutureMarkers?.bind(controller);
  const originalFutureClear = controller.clearFutureMarkers?.bind(controller);

  const objectTokens = new WeakMap<object, number>();
  const dotImageCache = new Map<string, string>();
  const detailImageCache = new Map<string, string>();
  const labels = new Map<string, LabelMarkerLike>();
  const baseRanks = new Map<string, number>();

  let metricCache = new WeakMap<object, any | null>();
  let tokenCounter = 1;
  let submarketMarkers: MarkerLike[] = [];
  let detailLayer: LabelsLayerLike | null = null;
  let nameLayer: LabelsLayerLike | null = null;
  let massMarks: MassMarksLike | null = null;
  let lastSignature = '';
  let lastBuildings: any[] = [];
  let lastMode: RenderMode = 'default';
  let lastGroups: any[] | undefined;
  let lastShowAreaPlaceholders = false;
  let futureSignature = '';
  let frame: number | null = null;
  let pending: {
    buildings: any[];
    mode: RenderMode;
    groups?: any[];
    signature: string;
    showAreaPlaceholders: boolean;
  } | null = null;
  let activeTier: MarkerMode | null = null;

  const applyLayerOpacity = () => {
    const zoom = map.getZoom?.() ?? 14;
    const submarketOpacity = 1 - smoothStep(11.08, 11.5, zoom);
    const dotIn = smoothStep(11.08, 11.34, zoom);
    const dotOut = 1 - smoothStep(12.84, 13.2, zoom);
    const dotOpacity = clamp(dotIn * dotOut, 0.16, 0.9);
    const detailOpacity = smoothStep(MARKER_ZOOM.detailMin, 13.16, zoom);
    const nameOpacity = smoothStep(MARKER_ZOOM.nameMin, 14.42, zoom);

    for (const marker of submarketMarkers) marker.setOpacity?.(submarketOpacity);
    massMarks?.setOpacity?.(dotOpacity);
    detailLayer?.setOpacity?.(detailOpacity);
    nameLayer?.setOpacity?.(nameOpacity);
  };

  const clearNativeLayers = () => {
    if (submarketMarkers.length > 0) {
      try { map.remove?.(submarketMarkers as unknown[]); } catch {}
    }
    submarketMarkers = [];
    controller.submarketMarkers = [];

    try { detailLayer?.clear?.(); } catch {}
    if (detailLayer) {
      try { map.remove?.(detailLayer as unknown); } catch {}
    }
    detailLayer = null;

    try { nameLayer?.clear?.(); } catch {}
    if (nameLayer) {
      try { map.remove?.(nameLayer as unknown); } catch {}
    }
    nameLayer = null;

    labels.clear();
    baseRanks.clear();

    try { massMarks?.clear?.(); } catch {}
    try { massMarks?.setMap?.(null); } catch {}
    massMarks = null;
  };

  const buildSubmarkets = (buildings: any[], mode: RenderMode, showAreaPlaceholders: boolean): MarkerLike[] => {
    const aggregateMap = new Map<string, SubmarketAggregate>();

    for (const building of buildings) {
      const name = String(building?.submarket ?? '').trim();
      if (!name || name === '其他') continue;

      let item = aggregateMap.get(name);
      if (!item) {
        item = {
          name,
          lngSum: 0,
          latSum: 0,
          coordCount: 0,
          count: 0,
          totalArea: 0,
          vacantArea: 0,
          rentWeightSum: 0,
          rentWeightAreaSum: 0,
          leedCount: 0,
        };
        aggregateMap.set(name, item);
      }

      item.count += 1;
      if (
        isFiniteCoordinate(building?.location_lng) &&
        isFiniteCoordinate(building?.location_lat)
      ) {
        item.lngSum += building.location_lng;
        item.latSum += building.location_lat;
        item.coordCount += 1;
      }

      const metric = latestMetric(building, metricCache);
      const area = Number(metric?.total_area);
      const vacantArea = Number(metric?.vacant_area);
      const rent = Number(metric?.net_effective_rent);
      if (Number.isFinite(area) && area > 0) {
        item.totalArea += area;
        if (Number.isFinite(vacantArea)) item.vacantArea += vacantArea;
      }
      if (
        Number.isFinite(area) &&
        area > 0 &&
        Number.isFinite(rent) &&
        rent > 0
      ) {
        item.rentWeightAreaSum += area;
        item.rentWeightSum += rent * area;
      }
      const leed = String(building?.leed_certification ?? '').trim().toUpperCase();
      if (leed && leed !== 'NULL' && leed !== '无' && leed !== '-') {
        item.leedCount += 1;
      }
    }

    const result: MarkerLike[] = [];
    const positionedNames = new Set<string>();
    for (const item of aggregateMap.values()) {
      if (item.coordCount === 0) continue;
      positionedNames.add(item.name);

      const center: [number, number] = [
        item.lngSum / item.coordCount,
        item.latSum / item.coordCount,
      ];
      const rent =
        item.rentWeightAreaSum > 0
          ? item.rentWeightSum / item.rentWeightAreaSum
          : 0;
      const vacancy =
        item.totalArea > 0
          ? (item.vacantArea / item.totalArea) * 100
          : Number.NaN;
      const leed = item.count > 0 ? (item.leedCount / item.count) * 100 : 0;
      const accent = submarketAccent(mode, rent, vacancy, leed);
      const size = 78 + Math.min(10, Math.round(Math.sqrt(item.count) * 1.35));

      let primary = `¥${rent > 0 ? rent.toFixed(0) : '–'}`;
      let secondary = Number.isFinite(vacancy) ? `${vacancy.toFixed(1)}%` : '–';
      let separator = '<span class="map-submarket-bubble__sep">·</span>';
      if (mode === 'rent') {
        primary = `¥${rent > 0 ? rent.toFixed(1) : '–'}`;
        secondary = '平均租金';
        separator = '';
      } else if (mode === 'vacancy') {
        primary = Number.isFinite(vacancy) ? `${vacancy.toFixed(1)}%` : '–';
        secondary = '空置率';
        separator = '';
      } else if (mode === 'leed') {
        primary = `${leed.toFixed(0)}%`;
        secondary = 'LEED';
        separator = '';
      }

      const content = `
        <div class="map-submarket-bubble" data-render-mode="${mode}"
          title="${escapeHtml(item.name)}" style="--sm-accent:${accent};--sm-size:${size}px">
          <div class="map-submarket-bubble__name">${escapeHtml(item.name)}</div>
          <div class="map-submarket-bubble__metrics">
            <span class="map-submarket-bubble__primary">${primary}</span>${separator}
            <span class="map-submarket-bubble__secondary">${secondary}</span>
          </div>
        </div>`;

      const marker = new Marker({
        position: center,
        content,
        anchor: 'center',
        zooms: [3, MARKER_ZOOM.submarketMax],
        zIndex: 92,
        topWhenClick: true,
      });
      marker.on?.('click', () => {
        map.setZoomAndCenter?.(12.15, center, false, 320);
      });
      result.push(marker);
    }

    for (const { name, center } of getAreaPlaceholders(showAreaPlaceholders, positionedNames)) {
      const content = createAreaPlaceholder(name, () => {
        if (activeTier === 'submarket') map.setZoomAndCenter?.(12.15, center, false, 320);
      });
      result.push(new Marker({ position: center, content, anchor: 'center', zooms: [3, MARKER_ZOOM.submarketMax], zIndex: 92 }));
    }
    return result;
  };

  const openAfterZoom = (building: any) => {
    if (
      !building ||
      !isFiniteCoordinate(building.location_lng) ||
      !isFiniteCoordinate(building.location_lat)
    ) return;

    const center: [number, number] = [
      building.location_lng,
      building.location_lat,
    ];
    if ((map.getZoom?.() ?? 14) >= 13.55) {
      controller.openBuildingInfoWindow?.(building.id);
      return;
    }

    let completed = false;
    let fallbackTimer: number | null = null;
    const finish = () => {
      if (completed) return;
      completed = true;
      map.off?.('zoomend', finish);
      if (fallbackTimer !== null) window.clearTimeout(fallbackTimer);
      if ((map.getZoom?.() ?? 0) >= 13.25) {
        requestAnimationFrame(() => {
          controller.openBuildingInfoWindow?.(building.id);
        });
      }
    };

    map.on?.('zoomend', finish);
    map.setZoomAndCenter?.(14, center, false, 320);
    fallbackTimer = window.setTimeout(finish, 700);
  };

  const buildMassMarks = (
    buildings: any[],
    mode: RenderMode,
    groups?: any[],
  ): MassMarksLike | null => {
    const styles: Array<Record<string, unknown>> = [];
    const styleIndices = new Map<string, number>();
    const data: Array<Record<string, unknown>> = [];

    for (const building of buildings) {
      if (
        !isFiniteCoordinate(building?.location_lng) ||
        !isFiniteCoordinate(building?.location_lat)
      ) continue;

      const visual = buildingVisual(
        building,
        mode,
        latestMetric(building, metricCache),
        groups,
      );
      const key = `${visual.background}|${visual.border}`;
      let style = styleIndices.get(key);
      if (style === undefined) {
        style = styles.length;
        styleIndices.set(key, style);
        const image =
          dotImageCache.get(key) ?? dotImage(visual.background, visual.border);
        dotImageCache.set(key, image);
        styles.push({
          url: image,
          size: new Size(12, 12),
          anchor: new Pixel(6, 6),
          zIndex: style + 1,
        });
      }
      data.push({
        lnglat: [building.location_lng, building.location_lat],
        style,
        id: building.id,
        __building: building,
      });
    }

    if (data.length === 0 || styles.length === 0) return null;

    const mass = new MassMarks(data, {
      opacity: 0.84,
      zIndex: 76,
      zooms: [MARKER_ZOOM.dotMin, MARKER_ZOOM.dotMax],
      cursor: 'pointer',
      alwaysRender: true,
      style: styles,
    });

    mass.on?.('mouseover', event => {
      const building = event?.data?.__building;
      if (!building) return;
      controller.showHoverTooltip?.(
        building,
        event?.originEvent?.clientX ?? event?.pixel?.getX?.() ?? 0,
        event?.originEvent?.clientY ?? event?.pixel?.getY?.() ?? 0,
      );
    });
    mass.on?.('mouseout', () => controller.hideHoverTooltip?.());
    mass.on?.('click', event => openAfterZoom(event?.data?.__building));
    mass.setMap?.(map);
    return mass;
  };

  const bindLabelEvents = (label: LabelMarkerLike, building: any) => {
    label.on?.('mouseover', event => {
      controller.showHoverTooltip?.(
        building,
        event?.originEvent?.clientX ?? event?.pixel?.getX?.() ?? 0,
        event?.originEvent?.clientY ?? event?.pixel?.getY?.() ?? 0,
      );
    });
    label.on?.('mouseout', () => controller.hideHoverTooltip?.());
    label.on?.('click', () => controller.openBuildingInfoWindow?.(building.id));
  };

  const buildLabels = (
    buildings: any[],
    mode: RenderMode,
    groups?: any[],
  ): { detail: LabelsLayerLike; names: LabelsLayerLike } => {
    const detail = new LabelsLayer({
      zooms: [MARKER_ZOOM.detailMin, 20],
      zIndex: 112,
      collision: true,
      allowCollision: false,
      animation: false,
      visible: true,
      opacity: 0,
    });
    const names = new LabelsLayer({
      zooms: [MARKER_ZOOM.nameMin, 20],
      zIndex: 113,
      collision: true,
      allowCollision: false,
      animation: false,
      visible: true,
      opacity: 0,
    });

    const detailItems: LabelMarkerLike[] = [];
    const nameItems: LabelMarkerLike[] = [];

    for (const building of buildings) {
      if (
        !isFiniteCoordinate(building?.location_lng) ||
        !isFiniteCoordinate(building?.location_lat)
      ) continue;

      const metric = latestMetric(building, metricCache);
      const visual = buildingVisual(building, mode, metric, groups);
      const area = Number(metric?.total_area);
      const grade = String(building?.grade ?? '').toUpperCase();
      const gradeRank =
        grade.includes('A') || grade.includes('P')
          ? 2000
          : grade.includes('BP')
            ? 1200
            : 700;
      const rank =
        gradeRank +
        (Number.isFinite(area)
          ? Math.min(999, Math.round(area / 1000))
          : 0);

      const imageKey =
        `${visual.background}|${visual.border}|${visual.textColor}|` +
        `${visual.text}|${visual.fontSize}`;
      const image =
        detailImageCache.get(imageKey) ?? detailBubbleImage(visual);
      detailImageCache.set(imageKey, image);

      const iconLabel = new LabelMarker({
        name: String(building.id ?? ''),
        position: [building.location_lng, building.location_lat],
        zooms: [MARKER_ZOOM.detailMin, 20],
        opacity: 1,
        rank,
        zIndex: rank,
        anchor: 'center',
        extData: { id: building.id },
        icon: {
          type: 'image',
          image,
          size: [34, 34],
          anchor: 'center',
        },
      });
      bindLabelEvents(iconLabel, building);
      detailItems.push(iconLabel);
      labels.set(String(building.id), iconLabel);
      baseRanks.set(String(building.id), rank);

      const buildingName = String(building?.name ?? '').trim();
      if (!buildingName) continue;
      const nameLabel = new LabelMarker({
        name: `${String(building.id ?? '')}:name`,
        position: [building.location_lng, building.location_lat],
        zooms: [MARKER_ZOOM.nameMin, 20],
        opacity: 1,
        rank: Math.max(1, rank - 1),
        zIndex: rank,
        extData: { id: building.id },
        text: {
          content: buildingName,
          direction: 'right',
          offset: [18, 0],
          style: {
            fontSize: 11,
            fontWeight: '600',
            fillColor: '#26394d',
            strokeColor: '#ffffff',
            strokeWidth: 3,
            padding: '1, 2',
            fold: true,
          },
        },
      });
      bindLabelEvents(nameLabel, building);
      nameItems.push(nameLabel);
    }

    detail.add?.(detailItems);
    names.add?.(nameItems);
    map.add?.(detail as unknown);
    map.add?.(names as unknown);
    return { detail, names };
  };

  const commit = (
    buildings: any[],
    mode: RenderMode,
    groups: any[] | undefined,
    signature: string,
    showAreaPlaceholders: boolean,
  ) => {
    clearNativeLayers();
    originalClear();
    metricCache = new WeakMap<object, any | null>();

    submarketMarkers = buildSubmarkets(buildings, mode, showAreaPlaceholders);
    controller.submarketMarkers = submarketMarkers;
    if (submarketMarkers.length > 0) {
      map.add?.(submarketMarkers as unknown[]);
    }
    massMarks = buildMassMarks(buildings, mode, groups);
    const layers = buildLabels(buildings, mode, groups);
    detailLayer = layers.detail;
    nameLayer = layers.names;

    controller.markers = [];
    controller.dotMarkers = [];
    activeTier = stableMode(map.getZoom?.() ?? 11.2, activeTier);
    controller.currentRenderMode = activeTier;
    container.dataset.markerTier = activeTier;

    lastBuildings = buildings;
    lastMode = mode;
    lastGroups = groups;
    lastShowAreaPlaceholders = showAreaPlaceholders;
    lastSignature = signature;
    applyLayerOpacity();
    container.classList.remove('map-marker-rendering');
  };

  controller.renderMarkers = ((
    input: any[],
    mode: RenderMode = 'default',
    _districtStats?: unknown,
    groups?: any[],
    showAreaPlaceholders = false,
  ) => {
    const buildings = Array.isArray(input) ? input : [];
    const signature = `${renderSignature(
      buildings,
      mode,
      groups,
      objectTokens,
      metricCache,
      () => tokenCounter++,
    )}|${showAreaPlaceholders}`;
    if (signature === lastSignature) {
      if (frame !== null) cancelAnimationFrame(frame);
      frame = null;
      pending = null;
      return;
    }
    if (signature === pending?.signature) return;

    pending = { buildings, mode, groups, signature, showAreaPlaceholders };
    container.classList.add('map-marker-rendering');
    if (frame !== null) cancelAnimationFrame(frame);
    frame = requestAnimationFrame(() => {
      frame = null;
      const next = pending;
      pending = null;
      if (next) {
        commit(next.buildings, next.mode, next.groups, next.signature, next.showAreaPlaceholders);
      }
    });
  }) as ControllerInternals['renderMarkers'];

  controller.clearMarkers = (() => {
    clearNativeLayers();
    originalClear();
    if (frame !== null) cancelAnimationFrame(frame);
    frame = null;
    pending = null;
    lastSignature = '';
    lastBuildings = [];
    activeTier = null;
    controller.currentRenderMode = null;
    container.classList.remove('map-marker-rendering');
    delete container.dataset.markerTier;
  }) as ControllerInternals['clearMarkers'];

  controller.updateVisibilityByZoom = (() => {
    const zoom = map.getZoom?.() ?? 14;
    const next = stableMode(zoom, activeTier);
    if (next !== 'building' && zoom < MARKER_ZOOM.detailMin) {
      controller.infoWindow?.close?.();
    }
    activeTier = next;
    controller.currentRenderMode = next;
    container.dataset.markerTier = next;
    applyLayerOpacity();
  }) as ControllerInternals['updateVisibilityByZoom'];

  controller.bounceMarker = ((buildingId: string) => {
    const label = labels.get(buildingId);
    if (!label) return originalBounce?.(buildingId);
    label.setOpacity?.(0.62);
    label.setzIndex?.(999999);
    requestAnimationFrame(() => label.setOpacity?.(1));
  }) as ControllerInternals['bounceMarker'];

  controller.stopBounceMarker = ((buildingId: string) => {
    const label = labels.get(buildingId);
    if (!label) return originalStopBounce?.(buildingId);
    label.setOpacity?.(1);
    const rank = baseRanks.get(buildingId);
    if (rank !== undefined) label.setzIndex?.(rank);
  }) as ControllerInternals['stopBounceMarker'];

  if (originalRefresh) {
    controller.refreshBuildingData = (async (buildingId: string) => {
      await originalRefresh(buildingId);
      const fresh = new Map(
        (controller._allBuildingsCache ?? []).map(building => [
          String(building?.id),
          building,
        ]),
      );
      const next = lastBuildings.map(
        building => fresh.get(String(building?.id)) ?? building,
      );
      lastSignature = '';
      controller.renderMarkers(next, lastMode, undefined, lastGroups, lastShowAreaPlaceholders);
    }) as ControllerInternals['refreshBuildingData'];
  }

  if (originalFutureRender) {
    controller.renderFutureMarkers = ((
      input: any[],
      mode: RenderMode = 'default',
    ) => {
      const supplies = Array.isArray(input) ? input : [];
      const signature =
        `${mode}:` + supplies.map(supply => String(supply?.id ?? '')).join('|');
      if (signature === futureSignature) return;
      futureSignature = signature;
      originalFutureRender(supplies, mode);
    }) as ControllerInternals['renderFutureMarkers'];
  }

  if (originalFutureClear) {
    controller.clearFutureMarkers = (() => {
      futureSignature = '';
      originalFutureClear();
    }) as ControllerInternals['clearFutureMarkers'];
  }

  const onZoomStart = () => container.classList.add('map-is-zooming');
  const onZoomChange = () => applyLayerOpacity();
  const onZoomEnd = () => {
    controller.updateVisibilityByZoom?.();
    requestAnimationFrame(() => container.classList.remove('map-is-zooming'));
  };
  const onMoveStart = () => container.classList.add('map-is-moving');
  const onMoveEnd = () => {
    requestAnimationFrame(() => container.classList.remove('map-is-moving'));
  };

  map.on?.('zoomstart', onZoomStart);
  map.on?.('zoomchange', onZoomChange);
  map.on?.('zoomend', onZoomEnd);
  map.on?.('movestart', onMoveStart);
  map.on?.('moveend', onMoveEnd);

  return () => {
    if (frame !== null) cancelAnimationFrame(frame);
    clearNativeLayers();
    map.off?.('zoomstart', onZoomStart);
    map.off?.('zoomchange', onZoomChange);
    map.off?.('zoomend', onZoomEnd);
    map.off?.('movestart', onMoveStart);
    map.off?.('moveend', onMoveEnd);

    controller.renderMarkers = originalRender as ControllerInternals['renderMarkers'];
    controller.clearMarkers = originalClear as ControllerInternals['clearMarkers'];
    if (originalUpdate) controller.updateVisibilityByZoom = originalUpdate;
    if (originalBounce) controller.bounceMarker = originalBounce;
    if (originalStopBounce) controller.stopBounceMarker = originalStopBounce;
    if (originalRefresh) controller.refreshBuildingData = originalRefresh;
    if (originalFutureRender) controller.renderFutureMarkers = originalFutureRender;
    if (originalFutureClear) controller.clearFutureMarkers = originalFutureClear;

    container.classList.remove(
      'map-is-zooming',
      'map-is-moving',
      'map-marker-rendering',
    );
    delete container.dataset.markerTier;
  };
}

export function controllerInternals(controller: MapController): ControllerInternals {
  return controller as unknown as ControllerInternals;
}
