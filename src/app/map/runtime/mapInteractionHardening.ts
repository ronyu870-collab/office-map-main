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
  setRank?: (rank: number) => void;
};

type LabelsLayerLike = {
  add?: (markers: LabelMarkerLike[] | LabelMarkerLike) => void;
  clear?: () => void;
  show?: () => void;
  hide?: () => void;
};

type MassMarksLike = {
  setMap?: (map: MapLike | null) => void;
  show?: () => void;
  hide?: () => void;
  clear?: () => void;
  on?: (eventName: string, handler: EventHandler) => void;
  off?: (eventName: string, handler: EventHandler) => void;
};

type MapLike = {
  add?: (overlays: unknown[] | unknown) => void;
  remove?: (overlays: unknown[] | unknown) => void;
  getZoom?: () => number;
  panBy?: (x: number, y: number, duration?: number) => void;
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

type ControllerInternals = {
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

  const metrics = Array.isArray(building.metrics) ? building.metrics : [];
  let latest: any | null = null;
  let latestOrder = Number.NEGATIVE_INFINITY;
  for (const metric of metrics) {
    const year = Number(metric?.record_year) || 0;
    const quarter = Number(metric?.record_quarter) || 0;
    const order = year * 10 + quarter;
    if (order > latestOrder) {
      latestOrder = order;
      latest = metric;
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
      return (normalized.includes('A') || normalized.includes('P')) && !normalized.includes('BP');
    }
    if (filterGrade === '乙级') return normalized.includes('B') && !normalized.includes('BP');
    return false;
  });
}

function comparisonColor(building: any, groups: any[] | undefined): string | undefined {
  if (!Array.isArray(groups) || groups.length === 0) return undefined;
  for (let index = groups.length - 1; index >= 0; index -= 1) {
    const group = groups[index];
    if (Array.isArray(group?.submarkets) && group.submarkets.length > 0 && building.submarket && !group.submarkets.includes(building.submarket)) continue;
    if (Array.isArray(group?.grades) && group.grades.length > 0 && !matchesGroupGrades(building.grade, group.grades)) continue;
    if (Array.isArray(group?.districts) && group.districts.length > 0 && building.district && !group.districts.includes(building.district)) continue;
    if (typeof group?.color === 'string' && group.color) return group.color;
  }
  return undefined;
}

function getBuildingVisual(building: any, mode: RenderMode, metric: any | null, groups?: any[]): BuildingVisual {
  let background = '#003e7e';
  let border = '#ffffff';
  let textColor = '#ffffff';
  let text = 'A';
  let fontSize = 10;

  if (mode === 'default') {
    const grade = String(building?.grade ?? '').toUpperCase();
    if (grade.includes('BP')) {
      background = '#64748b';
      text = 'BP';
      fontSize = 8;
    } else if (grade.includes('A') || grade.includes('P')) {
      background = '#003e7e';
      text = 'A';
    } else if (grade.includes('B')) {
      background = '#64748b';
      text = 'B';
    } else {
      background = '#94a3b8';
      text = '·';
    }
  } else if (mode === 'rent') {
    const rent = Number(metric?.net_effective_rent);
    fontSize = 8;
    if (!Number.isFinite(rent) || rent <= 0) {
      background = '#94a3b8';
      text = '–';
    } else {
      text = String(Math.round(rent));
      if (rent >= 300) background = '#b45353';
      else if (rent >= 200) background = '#c26b3d';
      else if (rent >= 100) background = '#b68a36';
      else background = '#4e8a72';
    }
  } else if (mode === 'vacancy') {
    const vacancy = Number(metric?.vacancy_rate);
    fontSize = 8;
    if (!Number.isFinite(vacancy)) {
      background = '#94a3b8';
      text = '–';
    } else {
      const pct = vacancy <= 1 ? vacancy * 100 : vacancy;
      text = `${Math.round(pct)}%`;
      if (pct >= 30) background = '#b45353';
      else if (pct >= 20) background = '#c26b3d';
      else if (pct >= 10) background = '#b68a36';
      else background = '#4e8a72';
    }
  } else {
    const leed = String(building?.leed_certification ?? '').toUpperCase();
    if (leed.includes('PLATINUM')) {
      background = '#e0f2fe';
      border = '#38bdf8';
      textColor = '#075985';
      text = 'P';
    } else if (leed.includes('GOLD')) {
      background = '#fef3c7';
      border = '#d6a82a';
      textColor = '#8a5a0a';
      text = 'G';
    } else if (leed.includes('SILVER')) {
      background = '#f1f5f9';
      border = '#94a3b8';
      textColor = '#475569';
      text = 'S';
    } else {
      background = '#f8fafc';
      border = '#cbd5e1';
      textColor = '#64748b';
      text = 'N';
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

function getSubmarketAccent(mode: RenderMode, avgRent: number, vacancyPct: number, leedPct: number): string {
  if (mode === 'default') return '#003e7e';
  if (mode === 'rent') {
    if (avgRent <= 0) return '#94a3b8';
    if (avgRent >= 300) return '#b45353';
    if (avgRent >= 200) return '#c26b3d';
    if (avgRent >= 100) return '#b68a36';
    return '#4e8a72';
  }
  if (mode === 'vacancy') {
    if (vacancyPct >= 30) return '#b45353';
    if (vacancyPct >= 20) return '#c26b3d';
    if (vacancyPct >= 10) return '#b68a36';
    return '#4e8a72';
  }
  if (leedPct >= 60) return '#397d66';
  if (leedPct >= 40) return '#4e8a72';
  if (leedPct >= 20) return '#6b9c85';
  if (leedPct > 0) return '#8aaf9d';
  return '#94a3b8';
}

function makeSvgDataUri(svg: string): string {
  return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`;
}

function makeRoundedMarkerImage(background: string, border: string, width: number, height: number): string {
  return makeSvgDataUri(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><rect x="0.75" y="0.75" width="${width - 1.5}" height="${height - 1.5}" rx="4" fill="${background}" stroke="${border}" stroke-width="1.5"/></svg>`);
}

function makeDotImage(background: string, border: string): string {
  return makeSvgDataUri(`<svg xmlns="http://www.w3.org/2000/svg" width="8" height="8" viewBox="0 0 8 8"><circle cx="4" cy="4" r="3.25" fill="${background}" stroke="${border}" stroke-width="1"/></svg>`);
}

function currentModeForZoom(zoom: number): MarkerMode {
  if (zoom < 11.3) return 'submarket';
  if (zoom < 13) return 'dot';
  return 'building';
}

function isVisibleElement(element: HTMLElement): boolean {
  const style = window.getComputedStyle(element);
  const rect = element.getBoundingClientRect();
  return style.display !== 'none' && style.visibility !== 'hidden' && Number(style.opacity || '1') > 0 && rect.width > 0 && rect.height > 0;
}

function rectsIntersect(a: DOMRect, b: DOMRect): boolean {
  return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
}

function getWorkbenchBlockers(container: HTMLElement): DOMRect[] {
  const main = container.parentElement;
  if (!main) return [];
  const mainRect = main.getBoundingClientRect();
  const blockers: DOMRect[] = [];

  const header = main.previousElementSibling;
  if (header instanceof HTMLElement && isVisibleElement(header)) blockers.push(header.getBoundingClientRect());

  for (const child of Array.from(main.children)) {
    if (!(child instanceof HTMLElement) || child === container || !isVisibleElement(child)) continue;
    const style = window.getComputedStyle(child);
    if (!['absolute', 'fixed', 'sticky'].includes(style.position)) continue;
    const zIndex = Number.parseInt(style.zIndex || '0', 10);
    if (!Number.isFinite(zIndex) || zIndex < 250) continue;
    const rect = child.getBoundingClientRect();

    const attachedToEdge = rect.top <= mainRect.top + 130 || rect.bottom >= mainRect.bottom - 130 || rect.left <= mainRect.left + 390 || rect.right >= mainRect.right - 390;
    if (attachedToEdge) blockers.push(rect);
  }
  return blockers;
}

function computeInfoPan(container: HTMLElement, infoRect: DOMRect): { x: number; y: number } {
  const main = container.parentElement;
  const viewport = main?.getBoundingClientRect();
  if (!viewport) return { x: 0, y: 0 };

  const margin = 12;
  let x = 0;
  let y = 0;

  if (infoRect.left < viewport.left + margin) x += viewport.left + margin - infoRect.left;
  if (infoRect.right > viewport.right - margin) x -= infoRect.right - (viewport.right - margin);
  if (infoRect.top < viewport.top + margin) y += viewport.top + margin - infoRect.top;
  if (infoRect.bottom > viewport.bottom - margin) y -= infoRect.bottom - (viewport.bottom - margin);

  const shifted = () => ({
    left: infoRect.left + x,
    right: infoRect.right + x,
    top: infoRect.top + y,
    bottom: infoRect.bottom + y,
    width: infoRect.width,
    height: infoRect.height,
    x: infoRect.x + x,
    y: infoRect.y + y,
    toJSON: infoRect.toJSON?.bind(infoRect) ?? (() => ({})),
  } as DOMRect);

  for (const blocker of getWorkbenchBlockers(container)) {
    const rect = shifted();
    if (!rectsIntersect(rect, blocker)) continue;

    const pushDown = blocker.bottom + margin - rect.top;
    const pushUp = blocker.top - margin - rect.bottom;
    const pushRight = blocker.right + margin - rect.left;
    const pushLeft = blocker.left - margin - rect.right;

    const nearTop = blocker.top <= viewport.top + 150;
    const nearBottom = blocker.bottom >= viewport.bottom - 150;
    const nearLeft = blocker.left <= viewport.left + 390 && blocker.width < viewport.width * 0.55;
    const nearRight = blocker.right >= viewport.right - 390 && blocker.width < viewport.width * 0.55;

    if (nearTop) y += pushDown;
    else if (nearBottom) y += pushUp;
    else if (nearLeft) x += pushRight;
    else if (nearRight) x += pushLeft;
    else {
      const candidates = [
        { axis: 'y' as const, value: pushDown, magnitude: Math.abs(pushDown) },
        { axis: 'y' as const, value: pushUp, magnitude: Math.abs(pushUp) },
        { axis: 'x' as const, value: pushRight, magnitude: Math.abs(pushRight) },
        { axis: 'x' as const, value: pushLeft, magnitude: Math.abs(pushLeft) },
      ].sort((a, b) => a.magnitude - b.magnitude);
      const best = candidates[0];
      if (best?.axis === 'x') x += best.value;
      else if (best) y += best.value;
    }
  }

  return {
    x: Math.max(-320, Math.min(320, x)),
    y: Math.max(-320, Math.min(320, y)),
  };
}

function mutationTouchesInfo(mutations: MutationRecord[]): boolean {
  for (const mutation of mutations) {
    const target = mutation.target;
    if (target instanceof Element && target.closest('.amap-info')) return true;
    for (const node of Array.from(mutation.addedNodes)) {
      if (!(node instanceof Element)) continue;
      if (node.matches('.amap-info') || node.querySelector('.amap-info')) return true;
    }
    for (const node of Array.from(mutation.removedNodes)) {
      if (node instanceof Element && (node.matches('.amap-info') || node.querySelector('.amap-info'))) return true;
    }
  }
  return false;
}

function installInfoWindowAvoidance(map: MapLike, container: HTMLElement): () => void {
  let timer: number | null = null;
  let raf: number | null = null;
  let adjusting = false;
  let resizeObserver: ResizeObserver | null = null;
  let observedInfo: HTMLElement | null = null;

  const clearSchedule = () => {
    if (timer !== null) window.clearTimeout(timer);
    if (raf !== null) cancelAnimationFrame(raf);
    timer = null;
    raf = null;
  };

  const attachResizeObserver = (info: HTMLElement | null) => {
    if (info === observedInfo) return;
    resizeObserver?.disconnect();
    resizeObserver = null;
    observedInfo = info;
    if (!info || typeof ResizeObserver === 'undefined') return;
    resizeObserver = new ResizeObserver(() => schedule());
    resizeObserver.observe(info);
  };

  const adjust = () => {
    if (adjusting) return;
    const info = container.querySelector<HTMLElement>('.amap-info');
    attachResizeObserver(info);
    if (!info || !isVisibleElement(info)) return;

    const rect = info.getBoundingClientRect();
    const pan = computeInfoPan(container, rect);
    if ((Math.abs(pan.x) < 2 && Math.abs(pan.y) < 2) || typeof map.panBy !== 'function') return;

    adjusting = true;
    container.classList.add('map-info-avoiding');
    map.panBy(pan.x, pan.y, 170);
    window.setTimeout(() => {
      adjusting = false;
      container.classList.remove('map-info-avoiding');
    }, 210);
  };

  const schedule = () => {
    clearSchedule();
    timer = window.setTimeout(() => {
      raf = requestAnimationFrame(() => {
        raf = requestAnimationFrame(() => {
          raf = null;
          adjust();
        });
      });
    }, 0);
  };

  const observer = new MutationObserver(mutations => {
    if (mutationTouchesInfo(mutations)) schedule();
  });
  observer.observe(container, { childList: true, subtree: true });

  const onMoveEnd = () => {
    if (container.querySelector('.amap-info')) schedule();
  };
  map.on?.('moveend', onMoveEnd);
  window.addEventListener('resize', schedule);

  return () => {
    clearSchedule();
    observer.disconnect();
    resizeObserver?.disconnect();
    map.off?.('moveend', onMoveEnd);
    window.removeEventListener('resize', schedule);
    container.classList.remove('map-info-avoiding');
  };
}

function installFallbackMarkerHardening(controller: ControllerInternals, container: HTMLElement): () => void {
  const map = controller.map;
  if (!map || typeof map.getZoom !== 'function') return () => {};

  const originalUpdateVisibility = controller.updateVisibilityByZoom?.bind(controller);
  const mountedModes = new Set<MarkerMode>();
  let activeMode: MarkerMode | null = null;
  let frame: number | null = null;

  const getMarkers = (mode: MarkerMode): MarkerLike[] => {
    if (mode === 'submarket') return controller.submarketMarkers ?? [];
    if (mode === 'dot') return controller.dotMarkers ?? [];
    return controller.markers ?? [];
  };

  const chooseMode = (): MarkerMode => {
    const buildingMarkers = controller.markers ?? [];
    const dotMarkers = controller.dotMarkers ?? [];
    const submarketMarkers = controller.submarketMarkers ?? [];
    if (buildingMarkers.length > 0 && dotMarkers.length === 0 && submarketMarkers.length === 0) return 'building';
    const zoom = map.getZoom?.() ?? 14;
    if (activeMode === 'submarket' && zoom < 11.45) return 'submarket';
    if (activeMode === 'building' && zoom >= 12.85) return 'building';
    if (zoom < 11.3) return 'submarket';
    if (zoom < 13) return 'dot';
    return 'building';
  };

  const mountOnce = (mode: MarkerMode) => {
    if (mountedModes.has(mode)) return;
    const markers = getMarkers(mode);
    if (markers.length > 0) map.add?.(markers as unknown[]);
    mountedModes.add(mode);
  };

  const setVisible = (mode: MarkerMode, visible: boolean) => {
    for (const marker of getMarkers(mode)) {
      if (visible) marker.show?.();
      else marker.hide?.();
    }
  };

  const apply = () => {
    frame = null;
    const next = chooseMode();
    if (next === activeMode && mountedModes.has(next)) return;
    container.classList.add('map-marker-switching');
    if (activeMode && activeMode !== next) setVisible(activeMode, false);
    mountOnce(next);
    setVisible(next, true);
    if (next !== 'building') controller.infoWindow?.close?.();
    controller.currentRenderMode = next;
    activeMode = next;
    requestAnimationFrame(() => container.classList.remove('map-marker-switching'));
  };

  const schedule = () => {
    if (frame !== null) cancelAnimationFrame(frame);
    frame = requestAnimationFrame(apply);
  };

  controller.updateVisibilityByZoom = schedule;
  return () => {
    if (frame !== null) cancelAnimationFrame(frame);
    if (originalUpdateVisibility) controller.updateVisibilityByZoom = originalUpdateVisibility;
    container.classList.remove('map-marker-switching');
  };
}

function installOptimizedMarkerRenderer(controller: ControllerInternals, container: HTMLElement): (() => void) | null {
  const map = controller.map;
  const AMap = controller.AMap;
  if (!map || !AMap?.Marker || !AMap.Pixel || !AMap.Size || !AMap.LabelsLayer || !AMap.LabelMarker || !AMap.MassMarks) return null;

  const originalRenderMarkers = controller.renderMarkers.bind(controller);
  const originalClearMarkers = controller.clearMarkers.bind(controller);
  const originalUpdateVisibility = controller.updateVisibilityByZoom?.bind(controller);
  const originalBounceMarker = controller.bounceMarker?.bind(controller);
  const originalStopBounceMarker = controller.stopBounceMarker?.bind(controller);
  const originalRefreshBuildingData = controller.refreshBuildingData?.bind(controller);
  const originalRenderFutureMarkers = controller.renderFutureMarkers?.bind(controller);
  const originalClearFutureMarkers = controller.clearFutureMarkers?.bind(controller);

  const objectTokens = new WeakMap<object, number>();
  const metricCache = new WeakMap<object, any | null>();
  const imageCache = new Map<string, string>();
  const labelByBuildingId = new Map<string, LabelMarkerLike>();
  const labelBaseRank = new Map<string, number>();

  let nextObjectToken = 1;
  let submarketMarkers: MarkerLike[] = [];
  let labelsLayer: LabelsLayerLike | null = null;
  let massMarks: MassMarksLike | null = null;
  let lastRenderSignature = '';
  let lastBuildings: any[] = [];
  let lastMode: RenderMode = 'default';
  let lastGroups: any[] | undefined;
  let renderFrame: number | null = null;
  let pendingRender: { buildings: any[]; mode: RenderMode; groups?: any[]; signature: string } | null = null;
  let futureSignature = '';

  const tokenFor = (object: unknown): number => {
    if (!object || typeof object !== 'object') return 0;
    const existing = objectTokens.get(object);
    if (existing) return existing;
    const token = nextObjectToken++;
    objectTokens.set(object, token);
    return token;
  };

  const buildRenderSignature = (buildings: any[], mode: RenderMode, groups?: any[]): string => {
    let hash = 2166136261;
    const feed = (value: string) => {
      for (let i = 0; i < value.length; i += 1) {
        hash ^= value.charCodeAt(i);
        hash = Math.imul(hash, 16777619);
      }
    };
    feed(mode);
    for (const building of buildings) feed(`${building?.id ?? ''}:${tokenFor(building)}|`);
    if (Array.isArray(groups)) {
      for (const group of groups) {
        feed(`${group?.id ?? ''}:${group?.color ?? ''}:${(group?.submarkets ?? []).join(',')}:${(group?.grades ?? []).join(',')}:${(group?.districts ?? []).join(',')}|`);
      }
    }
    return `${buildings.length}:${hash >>> 0}`;
  };

  const getCachedImage = (key: string, factory: () => string): string => {
    const existing = imageCache.get(key);
    if (existing) return existing;
    const value = factory();
    imageCache.set(key, value);
    return value;
  };

  const clearOptimizedLayers = () => {
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
    labelByBuildingId.clear();
    labelBaseRank.clear();

    try { massMarks?.clear?.(); } catch {}
    try { massMarks?.setMap?.(null); } catch {}
    massMarks = null;
  };

  const clearAllMarkers = () => {
    clearOptimizedLayers();
    originalClearMarkers();
    lastRenderSignature = '';
    lastBuildings = [];
    pendingRender = null;
    if (renderFrame !== null) cancelAnimationFrame(renderFrame);
    renderFrame = null;
    controller.currentRenderMode = null;
  };

  const buildSubmarketMarkers = (buildings: any[], mode: RenderMode) => {
    const aggregates = new Map<string, SubmarketAggregate>();

    for (const building of buildings) {
      const name = String(building?.submarket ?? '').trim();
      if (!name || name === '其他') continue;
      let aggregate = aggregates.get(name);
      if (!aggregate) {
        aggregate = {
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
        aggregates.set(name, aggregate);
      }
      aggregate.count += 1;
      if (isFiniteCoordinate(building?.location_lng) && isFiniteCoordinate(building?.location_lat)) {
        aggregate.lngSum += building.location_lng;
        aggregate.latSum += building.location_lat;
        aggregate.coordCount += 1;
      }

      const metric = latestMetric(building, metricCache);
      const area = Number(metric?.total_area);
      const vacantArea = Number(metric?.vacant_area);
      const rent = Number(metric?.net_effective_rent);
      if (Number.isFinite(area) && area > 0) {
        aggregate.totalArea += area;
        if (Number.isFinite(vacantArea)) aggregate.vacantArea += vacantArea;
      }
      if (Number.isFinite(area) && area > 0 && Number.isFinite(rent) && rent > 0) {
        aggregate.rentWeightAreaSum += area;
        aggregate.rentWeightSum += rent * area;
      }
      const leed = String(building?.leed_certification ?? '').trim().toUpperCase();
      if (leed && leed !== 'NULL' && leed !== '无' && leed !== '-') aggregate.leedCount += 1;
    }

    const markers: MarkerLike[] = [];
    for (const aggregate of aggregates.values()) {
      if (aggregate.coordCount === 0) continue;
      const center: [number, number] = [aggregate.lngSum / aggregate.coordCount, aggregate.latSum / aggregate.coordCount];
      const avgRent = aggregate.rentWeightAreaSum > 0 ? aggregate.rentWeightSum / aggregate.rentWeightAreaSum : 0;
      const vacancyPct = aggregate.totalArea > 0 ? (aggregate.vacantArea / aggregate.totalArea) * 100 : 0;
      const leedPct = aggregate.count > 0 ? (aggregate.leedCount / aggregate.count) * 100 : 0;
      const accent = getSubmarketAccent(mode, avgRent, vacancyPct, leedPct);

      let metricHtml = `<span class="map-submarket-card__primary">¥${avgRent > 0 ? avgRent.toFixed(0) : '–'}</span><span class="map-submarket-card__sep">·</span><span>${vacancyPct.toFixed(1)}%</span>`;
      if (mode === 'rent') metricHtml = `<span class="map-submarket-card__primary">¥${avgRent > 0 ? avgRent.toFixed(1) : '–'}</span><span>平均租金</span>`;
      if (mode === 'vacancy') metricHtml = `<span class="map-submarket-card__primary">${vacancyPct.toFixed(1)}%</span><span>空置率</span>`;
      if (mode === 'leed') metricHtml = `<span class="map-submarket-card__primary">${leedPct.toFixed(0)}%</span><span>LEED</span>`;

      const content = `<div class="map-submarket-card" data-render-mode="${mode}" title="${escapeHtml(aggregate.name)}" style="--sm-accent:${accent}"><div class="map-submarket-card__name">${escapeHtml(aggregate.name)}</div><div class="map-submarket-card__metrics">${metricHtml}</div></div>`;
      const marker = new AMap.Marker!({
        position: center,
        content,
        anchor: 'center',
        zooms: [3, 11.29],
        zIndex: 90,
        topWhenClick: true,
      });
      marker.on?.('click', () => map.setZoomAndCenter?.(12.2, center, false, 260));
      markers.push(marker);
    }
    return markers;
  };

  const buildMassMarks = (buildings: any[], mode: RenderMode, groups?: any[]): MassMarksLike | null => {
    const styles: Array<Record<string, unknown>> = [];
    const styleIndex = new Map<string, number>();
    const data: Array<Record<string, unknown>> = [];

    for (const building of buildings) {
      if (!isFiniteCoordinate(building?.location_lng) || !isFiniteCoordinate(building?.location_lat)) continue;
      const metric = latestMetric(building, metricCache);
      const visual = getBuildingVisual(building, mode, metric, groups);
      const key = `${visual.background}|${visual.border}`;
      let index = styleIndex.get(key);
      if (index === undefined) {
        index = styles.length;
        styleIndex.set(key, index);
        const image = getCachedImage(`dot:${key}`, () => makeDotImage(visual.background, visual.border));
        styles.push({
          url: image,
          size: new AMap.Size!(8, 8),
          anchor: new AMap.Pixel!(4, 4),
          zIndex: index + 1,
        });
      }
      data.push({
        lnglat: [building.location_lng, building.location_lat],
        style: index,
        id: building.id,
        name: building.name,
        __building: building,
      });
    }

    if (data.length === 0 || styles.length === 0) return null;
    const mass = new AMap.MassMarks!(data, {
      opacity: 0.94,
      zIndex: 75,
      zooms: [11.3, 12.99],
      cursor: 'pointer',
      alwaysRender: true,
      style: styles,
    });

    mass.on?.('mouseover', event => {
      const building = event?.data?.__building;
      if (!building) return;
      const x = event?.originEvent?.clientX ?? event?.pixel?.getX?.() ?? 0;
      const y = event?.originEvent?.clientY ?? event?.pixel?.getY?.() ?? 0;
      controller.showHoverTooltip?.(building, x, y);
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

  const buildLabelsLayer = (buildings: any[], mode: RenderMode, groups?: any[]) => {
    const layer = new AMap.LabelsLayer!({
      zooms: [13, 20],
      zIndex: 110,
      collision: true,
      allowCollision: false,
      animation: false,
      visible: true,
    });
    const labels: LabelMarkerLike[] = [];

    for (const building of buildings) {
      if (!isFiniteCoordinate(building?.location_lng) || !isFiniteCoordinate(building?.location_lat)) continue;
      const metric = latestMetric(building, metricCache);
      const visual = getBuildingVisual(building, mode, metric, groups);
      const width = mode === 'rent' ? 30 : mode === 'vacancy' ? 28 : 22;
      const height = 20;
      const imageKey = `label:${visual.background}|${visual.border}|${width}|${height}`;
      const image = getCachedImage(imageKey, () => makeRoundedMarkerImage(visual.background, visual.border, width, height));
      const area = Number(metric?.total_area);
      const grade = String(building?.grade ?? '').toUpperCase();
      const gradeRank = grade.includes('A') || grade.includes('P') ? 2000 : grade.includes('BP') ? 1200 : 600;
      const rank = gradeRank + (Number.isFinite(area) ? Math.min(999, Math.round(area / 1000)) : 0);
      const label = new AMap.LabelMarker!({
        name: String(building.id ?? ''),
        position: [building.location_lng, building.location_lat],
        zooms: [13, 20],
        opacity: 1,
        rank,
        zIndex: rank,
        anchor: 'center',
        extData: { id: building.id },
        icon: {
          type: 'image',
          image,
          size: [width, height],
          anchor: 'center',
        },
        text: {
          content: visual.text,
          direction: 'center',
          offset: [0, 0],
          style: {
            fontSize: visual.fontSize,
            fontWeight: '600',
            fillColor: visual.textColor,
            strokeWidth: 0,
            padding: [0, 0, 0, 0],
          },
        },
      });
      label.on?.('mouseover', event => {
        const x = event?.originEvent?.clientX ?? event?.pixel?.getX?.() ?? 0;
        const y = event?.originEvent?.clientY ?? event?.pixel?.getY?.() ?? 0;
        controller.showHoverTooltip?.(building, x, y);
      });
      label.on?.('mouseout', () => controller.hideHoverTooltip?.());
      label.on?.('click', () => controller.openBuildingInfoWindow?.(building.id));
      labels.push(label);
      labelByBuildingId.set(String(building.id), label);
      labelBaseRank.set(String(building.id), rank);
    }
    layer.add?.(labels);
    map.add?.(layer as unknown);
    return layer;
  };

  const commitRender = (buildings: any[], mode: RenderMode, groups: any[] | undefined, signature: string) => {
    clearOptimizedLayers();
    originalClearMarkers();
    metricCache.clear?.();

    submarketMarkers = buildSubmarketMarkers(buildings, mode);
    controller.submarketMarkers = submarketMarkers;
    if (submarketMarkers.length > 0) map.add?.(submarketMarkers as unknown[]);

    massMarks = buildMassMarks(buildings, mode, groups);
    labelsLayer = buildLabelsLayer(buildings, mode, groups);

    controller.markers = [];
    controller.dotMarkers = [];
    controller.currentRenderMode = currentModeForZoom(map.getZoom?.() ?? 11.2);
    lastBuildings = buildings;
    lastMode = mode;
    lastGroups = groups;
    lastRenderSignature = signature;
    container.classList.remove('map-marker-rendering');
  };

  controller.renderMarkers = ((buildingsInput: any[], modeInput: RenderMode = 'default', _districtStats?: unknown, groups?: any[]) => {
    const buildings = Array.isArray(buildingsInput) ? buildingsInput : [];
    const mode = modeInput ?? 'default';
    const signature = buildRenderSignature(buildings, mode, groups);
    if (signature === lastRenderSignature || signature === pendingRender?.signature) return;

    pendingRender = { buildings, mode, groups, signature };
    container.classList.add('map-marker-rendering');
    if (renderFrame !== null) cancelAnimationFrame(renderFrame);
    renderFrame = requestAnimationFrame(() => {
      renderFrame = null;
      const next = pendingRender;
      pendingRender = null;
      if (!next) return;
      commitRender(next.buildings, next.mode, next.groups, next.signature);
    });
  }) as ControllerInternals['renderMarkers'];

  controller.clearMarkers = (() => {
    clearAllMarkers();
    container.classList.remove('map-marker-rendering');
  }) as ControllerInternals['clearMarkers'];

  controller.updateVisibilityByZoom = (() => {
    const next = currentModeForZoom(map.getZoom?.() ?? 14);
    if (next !== 'building') controller.infoWindow?.close?.();
    controller.currentRenderMode = next;
  }) as ControllerInternals['updateVisibilityByZoom'];

  controller.bounceMarker = ((buildingId: string) => {
    const label = labelByBuildingId.get(buildingId);
    if (!label) {
      originalBounceMarker?.(buildingId);
      return;
    }
    label.setOpacity?.(0.55);
    label.setzIndex?.(999999);
    requestAnimationFrame(() => label.setOpacity?.(1));
  }) as ControllerInternals['bounceMarker'];

  controller.stopBounceMarker = ((buildingId: string) => {
    const label = labelByBuildingId.get(buildingId);
    if (!label) {
      originalStopBounceMarker?.(buildingId);
      return;
    }
    label.setOpacity?.(1);
    const rank = labelBaseRank.get(buildingId);
    if (rank !== undefined) label.setzIndex?.(rank);
  }) as ControllerInternals['stopBounceMarker'];

  if (originalRefreshBuildingData) {
    controller.refreshBuildingData = (async (buildingId: string) => {
      await originalRefreshBuildingData(buildingId);
      if (lastBuildings.length === 0) return;
      const freshCache = Array.isArray(controller._allBuildingsCache) ? controller._allBuildingsCache : [];
      const freshById = new Map(freshCache.map(building => [String(building?.id), building]));
      const refreshed = lastBuildings.map(building => freshById.get(String(building?.id)) ?? building);
      lastRenderSignature = '';
      controller.renderMarkers(refreshed, lastMode, undefined, lastGroups);
    }) as ControllerInternals['refreshBuildingData'];
  }

  if (originalRenderFutureMarkers) {
    controller.renderFutureMarkers = ((suppliesInput: any[], mode: RenderMode = 'default') => {
      const supplies = Array.isArray(suppliesInput) ? suppliesInput : [];
      const signature = `${mode}:${supplies.map(supply => String(supply?.id ?? '')).join('|')}`;
      if (signature === futureSignature) return;
      futureSignature = signature;
      originalRenderFutureMarkers(supplies, mode);
    }) as ControllerInternals['renderFutureMarkers'];
  }
  if (originalClearFutureMarkers) {
    controller.clearFutureMarkers = (() => {
      futureSignature = '';
      originalClearFutureMarkers();
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
    if (renderFrame !== null) cancelAnimationFrame(renderFrame);
    clearOptimizedLayers();
    map.off?.('zoomstart', onZoomStart);
    map.off?.('zoomend', onZoomEnd);
    map.off?.('movestart', onMoveStart);
    map.off?.('moveend', onMoveEnd);
    controller.renderMarkers = originalRenderMarkers as ControllerInternals['renderMarkers'];
    controller.clearMarkers = originalClearMarkers as ControllerInternals['clearMarkers'];
    if (originalUpdateVisibility) controller.updateVisibilityByZoom = originalUpdateVisibility;
    if (originalBounceMarker) controller.bounceMarker = originalBounceMarker;
    if (originalStopBounceMarker) controller.stopBounceMarker = originalStopBounceMarker;
    if (originalRefreshBuildingData) controller.refreshBuildingData = originalRefreshBuildingData;
    if (originalRenderFutureMarkers) controller.renderFutureMarkers = originalRenderFutureMarkers;
    if (originalClearFutureMarkers) controller.clearFutureMarkers = originalClearFutureMarkers;
    container.classList.remove('map-is-zooming', 'map-is-moving', 'map-marker-rendering');
  };
}

export function installMapInteractionHardening(controller: MapController, containerId: string): () => void {
  const container = document.getElementById(containerId);
  const internals = controller as unknown as ControllerInternals;
  const map = internals.map;
  if (!container || !map) return () => {};

  const optimizedCleanup = installOptimizedMarkerRenderer(internals, container);
  const fallbackCleanup = optimizedCleanup ? null : installFallbackMarkerHardening(internals, container);
  const cleanupInfoWindow = installInfoWindowAvoidance(map, container);

  return () => {
    cleanupInfoWindow();
    optimizedCleanup?.();
    fallbackCleanup?.();
  };
}
