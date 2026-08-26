'use client';

import type { MapController } from '@/src/services/MapController';

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
};

type MassMarksLike = {
  setMap?: (map: MapLike | null) => void;
  clear?: () => void;
  on?: (eventName: string, handler: EventHandler) => void;
};

export type MapLike = {
  add?: (overlays: unknown[] | unknown) => void;
  remove?: (overlays: unknown[] | unknown) => void;
  getZoom?: () => number;
  setZoomAndCenter?: (zoom: number, center: [number, number], immediately?: boolean, duration?: number) => void;
  on?: (eventName: string, handler: EventHandler) => void;
  off?: (eventName: string, handler: EventHandler) => void;
};

type AMapToolkit = {
  Marker?: new (options: Record<string, unknown>) => MarkerLike;
  Pixel?: new (x: number, y: number) => unknown;
  Size?: new (width: number, height: number) => unknown;
  LabelsLayer?: new (options: Record<string, unknown>) => LabelsLayerLike;
  LabelMarker?: new (options: Record<string, unknown>) => LabelMarkerLike;
  MassMarks?: new (data: Array<Record<string, unknown>>, options: Record<string, unknown>) => MassMarksLike;
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

function latestMetric(building: any, cache: WeakMap<object, any | null>): any | null {
  if (!building || typeof building !== 'object') return null;
  if (cache.has(building)) return cache.get(building) ?? null;

  let latest: any | null = null;
  let order = Number.NEGATIVE_INFINITY;
  for (const metric of Array.isArray(building.metrics) ? building.metrics : []) {
    const nextOrder = (Number(metric?.record_year) || 0) * 10 + (Number(metric?.record_quarter) || 0);
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
    if (filterGrade === '甲级') return (normalized.includes('A') || normalized.includes('P')) && !normalized.includes('BP');
    if (filterGrade === '乙级') return normalized.includes('B') && !normalized.includes('BP');
    return false;
  });
}

function comparisonColor(building: any, groups?: any[]): string | undefined {
  if (!Array.isArray(groups)) return undefined;
  for (let index = groups.length - 1; index >= 0; index -= 1) {
    const group = groups[index];
    if (group?.submarkets?.length > 0 && building.submarket && !group.submarkets.includes(building.submarket)) continue;
    if (group?.grades?.length > 0 && !matchesGroupGrades(building.grade, group.grades)) continue;
    if (group?.districts?.length > 0 && building.district && !group.districts.includes(building.district)) continue;
    if (typeof group?.color === 'string' && group.color) return group.color;
  }
  return undefined;
}

function buildingVisual(building: any, mode: RenderMode, metric: any | null, groups?: any[]): BuildingVisual {
  let background = '#003e7e';
  let border = '#ffffff';
  let textColor = '#ffffff';
  let text = 'A';
  let fontSize = 10;

  if (mode === 'default') {
    const grade = String(building?.grade ?? '').toUpperCase();
    if (grade.includes('BP')) {
      background = '#64748b'; text = 'BP'; fontSize = 8;
    } else if (grade.includes('A') || grade.includes('P')) {
      background = '#003e7e'; text = 'A';
    } else if (grade.includes('B')) {
      background = '#64748b'; text = 'B';
    } else {
      background = '#94a3b8'; text = '·';
    }
  } else if (mode === 'rent') {
    const rent = Number(metric?.net_effective_rent);
    fontSize = 8;
    if (!Number.isFinite(rent) || rent <= 0) {
      background = '#94a3b8'; text = '–';
    } else {
      text = String(Math.round(rent));
      background = rent >= 300 ? '#b45353' : rent >= 200 ? '#c26b3d' : rent >= 100 ? '#b68a36' : '#4e8a72';
    }
  } else if (mode === 'vacancy') {
    const vacancy = Number(metric?.vacancy_rate);
    fontSize = 8;
    if (!Number.isFinite(vacancy)) {
      background = '#94a3b8'; text = '–';
    } else {
      const pct = vacancy <= 1 ? vacancy * 100 : vacancy;
      text = `${Math.round(pct)}%`;
      background = pct >= 30 ? '#b45353' : pct >= 20 ? '#c26b3d' : pct >= 10 ? '#b68a36' : '#4e8a72';
    }
  } else {
    const leed = String(building?.leed_certification ?? '').toUpperCase();
    if (leed.includes('PLATINUM')) {
      background = '#e0f2fe'; border = '#38bdf8'; textColor = '#075985'; text = 'P';
    } else if (leed.includes('GOLD')) {
      background = '#fef3c7'; border = '#d6a82a'; textColor = '#8a5a0a'; text = 'G';
    } else if (leed.includes('SILVER')) {
      background = '#f1f5f9'; border = '#94a3b8'; textColor = '#475569'; text = 'S';
    } else {
      background = '#f8fafc'; border = '#cbd5e1'; textColor = '#64748b'; text = 'N';
    }
  }

  const groupColor = comparisonColor(building, groups);
  if (groupColor) {
    background = groupColor;
    border = '#ffffff';
    textColor = '#ffffff';
  }
  return { background, border, textColor, text, fontSize };
}

function submarketAccent(mode: RenderMode, rent: number, vacancy: number, leed: number): string {
  if (mode === 'default') return '#003e7e';
  if (mode === 'rent') return rent <= 0 ? '#94a3b8' : rent >= 300 ? '#b45353' : rent >= 200 ? '#c26b3d' : rent >= 100 ? '#b68a36' : '#4e8a72';
  if (mode === 'vacancy') return vacancy >= 30 ? '#b45353' : vacancy >= 20 ? '#c26b3d' : vacancy >= 10 ? '#b68a36' : '#4e8a72';
  return leed >= 60 ? '#397d66' : leed >= 40 ? '#4e8a72' : leed >= 20 ? '#6b9c85' : leed > 0 ? '#8aaf9d' : '#94a3b8';
}

function svgDataUri(svg: string): string {
  return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`;
}

function dotImage(background: string, border: string): string {
  return svgDataUri(`<svg xmlns="http://www.w3.org/2000/svg" width="8" height="8" viewBox="0 0 8 8"><circle cx="4" cy="4" r="3.25" fill="${background}" stroke="${border}" stroke-width="1"/></svg>`);
}

function currentMode(zoom: number): MarkerMode {
  return zoom < 11.3 ? 'submarket' : zoom < 13 ? 'dot' : 'building';
}

function renderSignature(buildings: any[], mode: RenderMode, groups: any[] | undefined, objectTokens: WeakMap<object, number>, nextToken: () => number): string {
  let hash = 2166136261;
  const feed = (value: string) => {
    for (let i = 0; i < value.length; i += 1) {
      hash ^= value.charCodeAt(i);
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
    feed(`${building?.id ?? ''}:${token}|`);
  }
  if (Array.isArray(groups)) {
    for (const group of groups) {
      feed(`${group?.id ?? ''}:${group?.color ?? ''}:${(group?.submarkets ?? []).join(',')}:${(group?.grades ?? []).join(',')}:${(group?.districts ?? []).join(',')}|`);
    }
  }
  return `${buildings.length}:${hash >>> 0}`;
}

export function installFallbackMarkerHardening(controller: ControllerInternals, container: HTMLElement): () => void {
  const map = controller.map;
  if (!map || typeof map.getZoom !== 'function') return () => {};

  const originalUpdate = controller.updateVisibilityByZoom?.bind(controller);
  const mounted = new Set<MarkerMode>();
  let active: MarkerMode | null = null;
  let frame: number | null = null;

  const markersFor = (mode: MarkerMode) => mode === 'submarket' ? controller.submarketMarkers ?? [] : mode === 'dot' ? controller.dotMarkers ?? [] : controller.markers ?? [];
  const choose = (): MarkerMode => {
    const building = controller.markers ?? [];
    const dots = controller.dotMarkers ?? [];
    const submarkets = controller.submarketMarkers ?? [];
    if (building.length > 0 && dots.length === 0 && submarkets.length === 0) return 'building';
    const zoom = map.getZoom?.() ?? 14;
    if (active === 'submarket' && zoom < 11.45) return 'submarket';
    if (active === 'building' && zoom >= 12.85) return 'building';
    return currentMode(zoom);
  };
  const visibility = (mode: MarkerMode, visible: boolean) => {
    for (const marker of markersFor(mode)) visible ? marker.show?.() : marker.hide?.();
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
  };
}

export function installNativeMarkerRenderer(controller: ControllerInternals, container: HTMLElement): (() => void) | null {
  const map = controller.map;
  const AMap = controller.AMap;
  const Marker = AMap?.Marker;
  const Pixel = AMap?.Pixel;
  const Size = AMap?.Size;
  const LabelsLayer = AMap?.LabelsLayer;
  const LabelMarker = AMap?.LabelMarker;
  const MassMarks = AMap?.MassMarks;
  if (!map || !Marker || !Pixel || !Size || !LabelsLayer || !LabelMarker || !MassMarks) return null;

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
  const labels = new Map<string, LabelMarkerLike>();
  const baseRanks = new Map<string, number>();
  let metricCache = new WeakMap<object, any | null>();
  let tokenCounter = 1;
  let submarketMarkers: MarkerLike[] = [];
  let labelsLayer: LabelsLayerLike | null = null;
  let massMarks: MassMarksLike | null = null;
  let lastSignature = '';
  let lastBuildings: any[] = [];
  let lastMode: RenderMode = 'default';
  let lastGroups: any[] | undefined;
  let futureSignature = '';
  let frame: number | null = null;
  let pending: { buildings: any[]; mode: RenderMode; groups?: any[]; signature: string } | null = null;

  const clearNativeLayers = () => {
    if (submarketMarkers.length > 0) {
      try { map.remove?.(submarketMarkers as unknown[]); } catch {}
    }
    submarketMarkers = [];
    controller.submarketMarkers = [];

    try { labelsLayer?.clear?.(); } catch {}
    if (labelsLayer) {
      try { map.remove?.(labelsLayer as unknown); } catch {}
    }
    labelsLayer = null;
    labels.clear();
    baseRanks.clear();

    try { massMarks?.clear?.(); } catch {}
    try { massMarks?.setMap?.(null); } catch {}
    massMarks = null;
  };

  const buildSubmarkets = (buildings: any[], mode: RenderMode): MarkerLike[] => {
    const aggregateMap = new Map<string, SubmarketAggregate>();
    for (const building of buildings) {
      const name = String(building?.submarket ?? '').trim();
      if (!name || name === '其他') continue;
      let item = aggregateMap.get(name);
      if (!item) {
        item = { name, lngSum: 0, latSum: 0, coordCount: 0, count: 0, totalArea: 0, vacantArea: 0, rentWeightSum: 0, rentWeightAreaSum: 0, leedCount: 0 };
        aggregateMap.set(name, item);
      }
      item.count += 1;
      if (isFiniteCoordinate(building?.location_lng) && isFiniteCoordinate(building?.location_lat)) {
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
      if (Number.isFinite(area) && area > 0 && Number.isFinite(rent) && rent > 0) {
        item.rentWeightAreaSum += area;
        item.rentWeightSum += rent * area;
      }
      const leed = String(building?.leed_certification ?? '').trim().toUpperCase();
      if (leed && leed !== 'NULL' && leed !== '无' && leed !== '-') item.leedCount += 1;
    }

    const result: MarkerLike[] = [];
    for (const item of aggregateMap.values()) {
      if (item.coordCount === 0) continue;
      const center: [number, number] = [item.lngSum / item.coordCount, item.latSum / item.coordCount];
      const rent = item.rentWeightAreaSum > 0 ? item.rentWeightSum / item.rentWeightAreaSum : 0;
      const vacancy = item.totalArea > 0 ? (item.vacantArea / item.totalArea) * 100 : 0;
      const leed = item.count > 0 ? (item.leedCount / item.count) * 100 : 0;
      const accent = submarketAccent(mode, rent, vacancy, leed);
      let metrics = `<span class="map-submarket-card__primary">¥${rent > 0 ? rent.toFixed(0) : '–'}</span><span class="map-submarket-card__sep">·</span><span>${vacancy.toFixed(1)}%</span>`;
      if (mode === 'rent') metrics = `<span class="map-submarket-card__primary">¥${rent > 0 ? rent.toFixed(1) : '–'}</span><span>平均租金</span>`;
      if (mode === 'vacancy') metrics = `<span class="map-submarket-card__primary">${vacancy.toFixed(1)}%</span><span>空置率</span>`;
      if (mode === 'leed') metrics = `<span class="map-submarket-card__primary">${leed.toFixed(0)}%</span><span>LEED</span>`;
      const content = `<div class="map-submarket-card" data-render-mode="${mode}" title="${escapeHtml(item.name)}" style="--sm-accent:${accent}"><div class="map-submarket-card__name">${escapeHtml(item.name)}</div><div class="map-submarket-card__metrics">${metrics}</div></div>`;
      const marker = new Marker({ position: center, content, anchor: 'center', zooms: [3, 11.29], zIndex: 90, topWhenClick: true });
      marker.on?.('click', () => map.setZoomAndCenter?.(12.2, center, false, 260));
      result.push(marker);
    }
    return result;
  };

  const buildMassMarks = (buildings: any[], mode: RenderMode, groups?: any[]): MassMarksLike | null => {
    const styles: Array<Record<string, unknown>> = [];
    const styleIndices = new Map<string, number>();
    const data: Array<Record<string, unknown>> = [];

    for (const building of buildings) {
      if (!isFiniteCoordinate(building?.location_lng) || !isFiniteCoordinate(building?.location_lat)) continue;
      const visual = buildingVisual(building, mode, latestMetric(building, metricCache), groups);
      const key = `${visual.background}|${visual.border}`;
      let style = styleIndices.get(key);
      if (style === undefined) {
        style = styles.length;
        styleIndices.set(key, style);
        const image = dotImageCache.get(key) ?? dotImage(visual.background, visual.border);
        dotImageCache.set(key, image);
        styles.push({ url: image, size: new Size(8, 8), anchor: new Pixel(4, 4), zIndex: style + 1 });
      }
      data.push({ lnglat: [building.location_lng, building.location_lat], style, id: building.id, __building: building });
    }

    if (data.length === 0 || styles.length === 0) return null;
    const mass = new MassMarks(data, { opacity: 0.94, zIndex: 75, zooms: [11.3, 12.99], cursor: 'pointer', alwaysRender: true, style: styles });
    mass.on?.('mouseover', event => {
      const building = event?.data?.__building;
      if (!building) return;
      controller.showHoverTooltip?.(building, event?.originEvent?.clientX ?? event?.pixel?.getX?.() ?? 0, event?.originEvent?.clientY ?? event?.pixel?.getY?.() ?? 0);
    });
    mass.on?.('mouseout', () => controller.hideHoverTooltip?.());
    mass.on?.('click', event => {
      const building = event?.data?.__building;
      if (!building || !isFiniteCoordinate(building.location_lng) || !isFiniteCoordinate(building.location_lat)) return;
      map.setZoomAndCenter?.(14, [building.location_lng, building.location_lat], false, 250);
      window.setTimeout(() => controller.openBuildingInfoWindow?.(building.id), 285);
    });
    mass.setMap?.(map);
    return mass;
  };

  const buildLabels = (buildings: any[], mode: RenderMode, groups?: any[]): LabelsLayerLike => {
    const layer = new LabelsLayer({ zooms: [13, 20], zIndex: 110, collision: true, allowCollision: false, animation: false, visible: true });
    const items: LabelMarkerLike[] = [];

    for (const building of buildings) {
      if (!isFiniteCoordinate(building?.location_lng) || !isFiniteCoordinate(building?.location_lat)) continue;
      const metric = latestMetric(building, metricCache);
      const visual = buildingVisual(building, mode, metric, groups);
      const area = Number(metric?.total_area);
      const grade = String(building?.grade ?? '').toUpperCase();
      const gradeRank = grade.includes('A') || grade.includes('P') ? 2000 : grade.includes('BP') ? 1200 : 600;
      const rank = gradeRank + (Number.isFinite(area) ? Math.min(999, Math.round(area / 1000)) : 0);
      const label = new LabelMarker({
        name: String(building.id ?? ''),
        position: [building.location_lng, building.location_lat],
        zooms: [13, 20],
        opacity: 1,
        rank,
        zIndex: rank,
        anchor: 'center',
        extData: { id: building.id },
        text: {
          content: visual.text,
          direction: 'center',
          offset: [0, 0],
          style: {
            fontSize: visual.fontSize,
            fillColor: visual.textColor,
            padding: mode === 'rent' || mode === 'vacancy' ? [4, 6, 4, 6] : [4, 7, 4, 7],
            backgroundColor: visual.background,
            borderColor: visual.border,
            borderWidth: 1,
          },
        },
      });
      label.on?.('mouseover', event => controller.showHoverTooltip?.(building, event?.originEvent?.clientX ?? event?.pixel?.getX?.() ?? 0, event?.originEvent?.clientY ?? event?.pixel?.getY?.() ?? 0));
      label.on?.('mouseout', () => controller.hideHoverTooltip?.());
      label.on?.('click', () => controller.openBuildingInfoWindow?.(building.id));
      items.push(label);
      labels.set(String(building.id), label);
      baseRanks.set(String(building.id), rank);
    }
    layer.add?.(items);
    map.add?.(layer as unknown);
    return layer;
  };

  const commit = (buildings: any[], mode: RenderMode, groups: any[] | undefined, signature: string) => {
    clearNativeLayers();
    originalClear();
    metricCache = new WeakMap<object, any | null>();

    submarketMarkers = buildSubmarkets(buildings, mode);
    controller.submarketMarkers = submarketMarkers;
    if (submarketMarkers.length > 0) map.add?.(submarketMarkers as unknown[]);
    massMarks = buildMassMarks(buildings, mode, groups);
    labelsLayer = buildLabels(buildings, mode, groups);

    controller.markers = [];
    controller.dotMarkers = [];
    controller.currentRenderMode = currentMode(map.getZoom?.() ?? 11.2);
    lastBuildings = buildings;
    lastMode = mode;
    lastGroups = groups;
    lastSignature = signature;
    container.classList.remove('map-marker-rendering');
  };

  controller.renderMarkers = ((input: any[], mode: RenderMode = 'default', _districtStats?: unknown, groups?: any[]) => {
    const buildings = Array.isArray(input) ? input : [];
    const signature = renderSignature(buildings, mode, groups, objectTokens, () => tokenCounter++);
    if (signature === lastSignature || signature === pending?.signature) return;
    pending = { buildings, mode, groups, signature };
    container.classList.add('map-marker-rendering');
    if (frame !== null) cancelAnimationFrame(frame);
    frame = requestAnimationFrame(() => {
      frame = null;
      const next = pending;
      pending = null;
      if (next) commit(next.buildings, next.mode, next.groups, next.signature);
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
    controller.currentRenderMode = null;
    container.classList.remove('map-marker-rendering');
  }) as ControllerInternals['clearMarkers'];

  controller.updateVisibilityByZoom = (() => {
    const next = currentMode(map.getZoom?.() ?? 14);
    if (next !== 'building') controller.infoWindow?.close?.();
    controller.currentRenderMode = next;
  }) as ControllerInternals['updateVisibilityByZoom'];

  controller.bounceMarker = ((buildingId: string) => {
    const label = labels.get(buildingId);
    if (!label) return originalBounce?.(buildingId);
    label.setOpacity?.(0.55);
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
      const fresh = new Map((controller._allBuildingsCache ?? []).map(building => [String(building?.id), building]));
      const next = lastBuildings.map(building => fresh.get(String(building?.id)) ?? building);
      lastSignature = '';
      controller.renderMarkers(next, lastMode, undefined, lastGroups);
    }) as ControllerInternals['refreshBuildingData'];
  }

  if (originalFutureRender) {
    controller.renderFutureMarkers = ((input: any[], mode: RenderMode = 'default') => {
      const supplies = Array.isArray(input) ? input : [];
      const signature = `${mode}:${supplies.map(supply => String(supply?.id ?? '')).join('|')}`;
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
  const onZoomEnd = () => {
    controller.updateVisibilityByZoom?.();
    requestAnimationFrame(() => container.classList.remove('map-is-zooming'));
  };
  const onMoveStart = () => container.classList.add('map-is-moving');
  const onMoveEnd = () => requestAnimationFrame(() => container.classList.remove('map-is-moving'));
  map.on?.('zoomstart', onZoomStart);
  map.on?.('zoomend', onZoomEnd);
  map.on?.('movestart', onMoveStart);
  map.on?.('moveend', onMoveEnd);

  return () => {
    if (frame !== null) cancelAnimationFrame(frame);
    clearNativeLayers();
    map.off?.('zoomstart', onZoomStart);
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
    container.classList.remove('map-is-zooming', 'map-is-moving', 'map-marker-rendering');
  };
}

export function controllerInternals(controller: MapController): ControllerInternals {
  return controller as unknown as ControllerInternals;
}
