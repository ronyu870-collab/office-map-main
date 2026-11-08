'use client';

import type { MapController } from '@/src/services/MapController';
import { MAP_BUILDING_TIER_MIN_ZOOM } from './mapMarkerZoom';
import { mapOptionalNumber, observedVacantArea } from '../model/vacancyMetrics';
import { controllerInternals, type ControllerInternals } from './mapNativeMarkerRenderer';
import { createAreaPlaceholder, getAreaFixedRent, getAreaPlaceholders, isNameOnlyArea, NAME_ONLY_BUBBLE_CLASS } from './mapSubmarketOverview';

type RenderMode = 'default' | 'rent' | 'vacancy' | 'leed';
type MarkerTier = 'submarket' | 'dot' | 'building';

type LayerSet = {
  submarkets: any[];
  mass: any | null;
  detail: any | null;
  names: any | null;
  labels: Map<string, any>;
  ranks: Map<string, number>;
};

type OpacityState = {
  submarket: number;
  dot: number;
  detail: number;
  names: number;
};

const BREAKPOINTS = {
  submarketToDot: 11.55,
  dotToBuilding: MAP_BUILDING_TIER_MIN_ZOOM,
  submarketGestureStart: 11.42,
  submarketGestureEnd: 11.66,
  buildingGestureStart: 13.02,
  buildingGestureEnd: 13.30,
  namesStart: 13.92,
  namesFull: 14.28,
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
} as const;

function clamp(value: number, min = 0, max = 1): number {
  return Math.min(max, Math.max(min, value));
}

function smoothStep(start: number, end: number, value: number): number {
  const t = clamp((value - start) / (end - start));
  return t * t * (3 - 2 * t);
}

function finite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function latestMetric(building: any): any | null {
  let latest: any | null = null;
  let order = Number.NEGATIVE_INFINITY;
  for (const metric of Array.isArray(building?.metrics) ? building.metrics : []) {
    const next = (Number(metric?.record_year) || 0) * 10 + (Number(metric?.record_quarter) || 0);
    if (next > order) {
      latest = metric;
      order = next;
    }
  }
  return latest;
}

function matchesGroupGrades(gradeValue: unknown, wantedGrades: string[]): boolean {
  if (!wantedGrades.length) return true;
  const grade = String(gradeValue ?? '').toUpperCase();
  return wantedGrades.some(wanted => {
    if (wanted === '产业园') return grade.includes('BP');
    if (wanted === '甲级') return (grade.includes('A') || grade.includes('P')) && !grade.includes('BP');
    if (wanted === '乙级') return grade.includes('B') && !grade.includes('BP');
    return false;
  });
}

function groupColor(building: any, groups?: any[]): string | undefined {
  if (!Array.isArray(groups)) return undefined;
  for (let index = groups.length - 1; index >= 0; index -= 1) {
    const group = groups[index];
    if (group?.submarkets?.length && (!building?.submarket || !group.submarkets.includes(building.submarket))) continue;
    if (group?.grades?.length && !matchesGroupGrades(building?.grade, group.grades)) continue;
    if (group?.districts?.length && (!building?.district || !group.districts.includes(building.district))) continue;
    if (typeof group?.color === 'string' && group.color) return group.color;
  }
  return undefined;
}

function visualFor(building: any, mode: RenderMode, groups?: any[]) {
  const metric = latestMetric(building);
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
    } else if (grade.includes('B')) {
      background = PALETTE.gradeB;
      text = 'B';
    } else {
      background = PALETTE.neutral;
      text = '·';
    }
  } else if (mode === 'rent') {
    const rent = Number(metric?.net_effective_rent);
    const hasValue = Number.isFinite(rent) && rent > 0;
    text = hasValue ? String(Math.round(rent)) : '–';
    fontSize = text.length >= 3 ? 9.5 : 10.5;
    background = !hasValue ? PALETTE.neutral : rent >= 300 ? PALETTE.extreme : rent >= 200 ? PALETTE.high : rent >= 100 ? PALETTE.medium : PALETTE.low;
  } else if (mode === 'vacancy') {
    const vacancy = mapOptionalNumber(metric?.vacancy_rate);
    const hasValue = Number.isFinite(vacancy);
    const percent = hasValue ? (vacancy <= 1 ? vacancy * 100 : vacancy) : 0;
    text = hasValue ? `${Math.round(percent)}%` : '–';
    fontSize = text.length >= 3 ? 9 : 10;
    background = !hasValue ? PALETTE.neutral : percent >= 30 ? PALETTE.extreme : percent >= 20 ? PALETTE.high : percent >= 10 ? PALETTE.medium : PALETTE.low;
  } else {
    const leed = String(building?.leed_certification ?? '').toUpperCase();
    if (leed.includes('PLATINUM')) {
      background = '#d9edf3'; border = '#68aebf'; textColor = '#225a68'; text = 'P';
    } else if (leed.includes('GOLD')) {
      background = '#eadfbd'; border = '#b69a52'; textColor = '#6f5a25'; text = 'G';
    } else if (leed.includes('SILVER')) {
      background = '#e7ebef'; border = '#9ca8b3'; textColor = '#52606d'; text = 'S';
    } else {
      background = '#eef1f4'; border = '#bdc6ce'; textColor = '#6f7c89'; text = 'N';
    }
  }

  const override = mode === 'default' ? groupColor(building, groups) : undefined;
  if (override) {
    background = override;
    border = '#ffffff';
    textColor = '#ffffff';
  }
  return { background, border, textColor, text, fontSize };
}

function dataUri(svg: string): string {
  return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`;
}

function dotImage(background: string, border: string): string {
  return dataUri(`<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 12 12"><circle cx="6" cy="6" r="5.1" fill="#fff" fill-opacity=".95"/><circle cx="6" cy="6" r="4" fill="${background}" stroke="${border}" stroke-width=".7"/></svg>`);
}

function detailImage(visual: ReturnType<typeof visualFor>): string {
  return dataUri(`<svg xmlns="http://www.w3.org/2000/svg" width="34" height="34" viewBox="0 0 34 34"><circle cx="17" cy="17" r="16" fill="#fff" fill-opacity=".97"/><circle cx="17" cy="17" r="13.7" fill="${visual.background}" stroke="${visual.border}" stroke-width="1.3"/><text x="17" y="17.4" text-anchor="middle" dominant-baseline="middle" font-family="Arial,PingFang SC,Microsoft YaHei,sans-serif" font-size="${visual.fontSize}" font-weight="800" fill="${visual.textColor}">${escapeHtml(visual.text)}</text></svg>`);
}

function tierForZoom(zoom: number): MarkerTier {
  if (zoom < BREAKPOINTS.submarketToDot) return 'submarket';
  if (zoom < BREAKPOINTS.dotToBuilding) return 'dot';
  return 'building';
}

function idleOpacity(tier: MarkerTier, zoom: number): OpacityState {
  if (tier === 'submarket') return { submarket: 1, dot: 0, detail: 0, names: 0 };
  if (tier === 'dot') return { submarket: 0, dot: 0.9, detail: 0, names: 0 };
  return {
    submarket: 0,
    dot: 0,
    detail: 1,
    names: smoothStep(BREAKPOINTS.namesStart, BREAKPOINTS.namesFull, zoom),
  };
}

function gestureOpacity(zoom: number): OpacityState {
  if (zoom < BREAKPOINTS.submarketGestureEnd) {
    const progress = smoothStep(BREAKPOINTS.submarketGestureStart, BREAKPOINTS.submarketGestureEnd, zoom);
    return { submarket: 1 - progress, dot: 0.9 * progress, detail: 0, names: 0 };
  }
  if (zoom < BREAKPOINTS.buildingGestureStart) {
    return { submarket: 0, dot: 0.9, detail: 0, names: 0 };
  }
  const progress = smoothStep(BREAKPOINTS.buildingGestureStart, BREAKPOINTS.buildingGestureEnd, zoom);
  return {
    submarket: 0,
    dot: 0.9 * (1 - progress),
    detail: progress,
    names: progress * smoothStep(BREAKPOINTS.namesStart, BREAKPOINTS.namesFull, zoom),
  };
}

function applyOpacity(set: LayerSet | null, state: OpacityState, multiplier = 1): void {
  if (!set) return;
  const sub = state.submarket * multiplier;
  const dot = state.dot * multiplier;
  const detail = state.detail * multiplier;
  const names = state.names * multiplier;
  for (const marker of set.submarkets) marker.setOpacity?.(sub);
  set.mass?.setOpacity?.(dot);
  set.detail?.setOpacity?.(detail);
  set.names?.setOpacity?.(names);
}

function removeLayerSet(map: any, set: LayerSet | null): void {
  if (!set) return;
  try { if (set.submarkets.length) map.remove?.(set.submarkets); } catch {}
  try { set.mass?.clear?.(); set.mass?.setMap?.(null); } catch {}
  try { set.detail?.clear?.(); map.remove?.(set.detail); } catch {}
  try { set.names?.clear?.(); map.remove?.(set.names); } catch {}
}

function renderSignature(buildings: any[], mode: RenderMode, groups?: any[]): string {
  let value = `${mode}|${buildings.length}|`;
  for (const building of buildings) {
    const metric = latestMetric(building);
    value += [
      building?.id ?? '',
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
    ].join(':') + '|';
  }
  if (Array.isArray(groups)) {
    for (const group of groups) {
      value += `${group?.id ?? ''}:${group?.color ?? ''}:${(group?.submarkets ?? []).join(',')}:${(group?.grades ?? []).join(',')}:${(group?.districts ?? []).join(',')}|`;
    }
  }
  return value;
}

export function installMapVisualHierarchyV3(
  controller: MapController,
  container: HTMLElement,
): (() => void) | null {
  const c = controllerInternals(controller) as ControllerInternals;
  const map: any = c.map;
  const AMap: any = c.AMap;
  const Marker = AMap?.Marker;
  const Pixel = AMap?.Pixel;
  const Size = AMap?.Size;
  const LabelsLayer = AMap?.LabelsLayer;
  const LabelMarker = AMap?.LabelMarker;
  const MassMarks = AMap?.MassMarks;
  if (!map || !Marker || !Pixel || !Size || !LabelsLayer || !LabelMarker || !MassMarks) return null;

  const originalRender = c.renderMarkers.bind(c);
  const originalClear = c.clearMarkers.bind(c);
  const originalUpdate = c.updateVisibilityByZoom?.bind(c);
  const originalBounce = c.bounceMarker?.bind(c);
  const originalStop = c.stopBounceMarker?.bind(c);
  const originalRefresh = c.refreshBuildingData?.bind(c);
  const originalFutureRender = c.renderFutureMarkers?.bind(c);
  const originalFutureClear = c.clearFutureMarkers?.bind(c);

  let current: LayerSet | null = null;
  let outgoing: LayerSet | null = null;
  let currentTier: MarkerTier = tierForZoom(map.getZoom?.() ?? 11);
  let zooming = false;
  let lastSignature = '';
  let lastBuildings: any[] = [];
  let lastMode: RenderMode = 'default';
  let lastGroups: any[] | undefined;
  let lastShowAreaPlaceholders = false;
  let pendingFrame: number | null = null;
  let disposeTimer: number | null = null;
  let selectedMarker: any | null = null;
  let selectedId: string | null = null;
  let suppressMapClearUntil = 0;
  let navigationToken = 0;
  let futureArgs: { supplies: any[]; mode: RenderMode } | null = null;
  let futureVisible = false;

  const syncFutureVisibility = () => {
    if (!originalFutureRender || !originalFutureClear || !futureArgs) return;
    const shouldShow = tierForZoom(map.getZoom?.() ?? 11) === 'building';
    if (shouldShow === futureVisible) return;
    futureVisible = shouldShow;
    if (shouldShow) originalFutureRender(futureArgs.supplies, futureArgs.mode);
    else originalFutureClear();
  };

  const clearSelection = () => {
    if (selectedMarker) {
      try { map.remove?.(selectedMarker); } catch {}
    }
    selectedMarker = null;
    selectedId = null;
    container.removeAttribute('data-selected-building');
  };

  const showSelection = (building: any) => {
    clearSelection();
    if (!building || !finite(building.location_lng) || !finite(building.location_lat)) return;
    const element = document.createElement('div');
    element.className = 'map-selected-marker';
    element.innerHTML = '<span class="map-selected-marker__core"></span><span class="map-selected-marker__ring"></span>';
    selectedMarker = new Marker({
      position: [building.location_lng, building.location_lat],
      content: element,
      anchor: 'center',
      zIndex: 999999,
      bubble: true,
    });
    map.add?.(selectedMarker);
    selectedId = String(building.id ?? '');
    suppressMapClearUntil = performance.now() + 180;
    container.dataset.selectedBuilding = selectedId;
  };

  const openAfterZoom = (building: any) => {
    if (!building || !finite(building.location_lng) || !finite(building.location_lat)) return;
    const token = ++navigationToken;
    const center: [number, number] = [building.location_lng, building.location_lat];
    showSelection(building);

    const finish = () => {
      if (token !== navigationToken) return;
      requestAnimationFrame(() => {
        if (token === navigationToken) c.openBuildingInfoWindow?.(building.id);
      });
    };

    if ((map.getZoom?.() ?? 14) >= BREAKPOINTS.dotToBuilding + 0.15) {
      finish();
      return;
    }

    let done = false;
    let timer: number | null = null;
    const finishOnce = () => {
      if (done) return;
      done = true;
      map.off?.('zoomchange', onProgress);
      map.off?.('zoomend', finishOnce);
      if (timer !== null) window.clearTimeout(timer);
      finish();
    };
    const onProgress = () => {
      if ((map.getZoom?.() ?? 0) >= BREAKPOINTS.dotToBuilding + 0.08) finishOnce();
    };

    map.on?.('zoomchange', onProgress);
    map.on?.('zoomend', finishOnce);
    map.setZoomAndCenter?.(14, center, false, 320);
    timer = window.setTimeout(finishOnce, 600);
  };

  const build = (buildings: any[], mode: RenderMode, groups: any[] | undefined, showAreaPlaceholders: boolean): LayerSet => {
    const labels = new Map<string, any>();
    const ranks = new Map<string, number>();
    const aggregates = new Map<string, any>();

    for (const building of buildings) {
      const name = String(building?.submarket ?? '').trim();
      if (!name || name === '其他') continue;
      let aggregate = aggregates.get(name);
      if (!aggregate) {
        aggregate = { name, count: 0, lng: 0, lat: 0, coords: 0, area: 0, vacant: 0, rentSum: 0, rentArea: 0, leed: 0 };
        aggregates.set(name, aggregate);
      }
      aggregate.count += 1;
      if (finite(building.location_lng) && finite(building.location_lat)) {
        aggregate.lng += building.location_lng;
        aggregate.lat += building.location_lat;
        aggregate.coords += 1;
      }
      const metric = latestMetric(building);
      const area = Number(metric?.total_area);
      const vacant = observedVacantArea(metric);
      const rent = Number(metric?.net_effective_rent);
      if (Number.isFinite(area) && area > 0 && Number.isFinite(vacant)) {
        aggregate.area += area;
        aggregate.vacant += vacant;
      }
      if (Number.isFinite(area) && area > 0 && Number.isFinite(rent) && rent > 0) {
        aggregate.rentSum += rent * area;
        aggregate.rentArea += area;
      }
      const leed = String(building?.leed_certification ?? '').trim().toUpperCase();
      if (leed && leed !== 'NULL' && leed !== '无' && leed !== '-') aggregate.leed += 1;
    }

    const submarkets: any[] = [];
    const positionedNames = new Set<string>();
    for (const aggregate of aggregates.values()) {
      if (!aggregate.coords) continue;
      positionedNames.add(aggregate.name);
      const center: [number, number] = [aggregate.lng / aggregate.coords, aggregate.lat / aggregate.coords];
      const rent = aggregate.rentArea > 0 ? aggregate.rentSum / aggregate.rentArea : 0;
      const vacancy = aggregate.area > 0 ? (aggregate.vacant / aggregate.area) * 100 : Number.NaN;
      const leedPercent = aggregate.count > 0 ? (aggregate.leed / aggregate.count) * 100 : 0;
      const fixedRent = getAreaFixedRent(aggregate.name);
      const accentRent = fixedRent ?? rent;
      let accent: string = PALETTE.brand;
      if (mode === 'rent') accent = accentRent <= 0 ? PALETTE.neutral : accentRent >= 300 ? PALETTE.extreme : accentRent >= 200 ? PALETTE.high : accentRent >= 100 ? PALETTE.medium : PALETTE.low;
      else if (mode === 'vacancy') accent = !Number.isFinite(vacancy) ? PALETTE.neutral : vacancy >= 30 ? PALETTE.extreme : vacancy >= 20 ? PALETTE.high : vacancy >= 10 ? PALETTE.medium : PALETTE.low;
      else if (mode === 'leed') accent = leedPercent >= 60 ? '#3f715f' : leedPercent >= 40 ? '#537f6c' : leedPercent >= 20 ? '#6f927f' : leedPercent > 0 ? '#88a493' : PALETTE.neutral;

      const size = 74 + Math.min(12, Math.round(Math.sqrt(aggregate.count) * 1.45));
      let primary = `¥${rent > 0 ? rent.toFixed(0) : '–'}`;
      let secondary = Number.isFinite(vacancy) ? `${vacancy.toFixed(1)}%` : '–';
      if (mode === 'rent') { primary = `¥${rent > 0 ? rent.toFixed(1) : '–'}`; secondary = '平均租金'; }
      else if (mode === 'vacancy') { primary = Number.isFinite(vacancy) ? `${vacancy.toFixed(1)}%` : '–'; secondary = '空置率'; }
      else if (mode === 'leed') { primary = `${leedPercent.toFixed(0)}%`; secondary = 'LEED'; }
      const separator = mode === 'default' ? '<span class="map-submarket-bubble__sep">·</span>' : '';

      const element = document.createElement('div');
      const nameOnly = isNameOnlyArea(aggregate.name, mode);
      element.className = nameOnly ? NAME_ONLY_BUBBLE_CLASS : 'map-submarket-bubble';
      element.dataset.renderMode = mode;
      element.title = aggregate.name;
      if (!nameOnly) element.style.setProperty('--sm-accent', accent);
      element.style.setProperty('--sm-size', `${size}px`);
      // A fixed rent has no vacancy figure, so the bubble shows the rent alone.
      const metrics = nameOnly ? '' : fixedRent !== null
        ? `<div class="map-submarket-bubble__metrics"><span class="map-submarket-bubble__primary">¥${fixedRent}</span></div>`
        : `<div class="map-submarket-bubble__metrics"><span class="map-submarket-bubble__primary">${primary}</span>${separator}<span class="map-submarket-bubble__secondary">${secondary}</span></div>`;
      element.innerHTML = `<div class="map-submarket-bubble__name">${escapeHtml(aggregate.name)}</div>${metrics}`;

      const marker = new Marker({
        position: center,
        content: element,
        anchor: 'center',
        zooms: [3, 20],
        zIndex: 92,
        topWhenClick: true,
        opacity: 0,
      });
      marker.on?.('click', () => {
        if (currentTier !== 'submarket' || zooming) return;
        element.classList.add('is-expanding');
        map.setZoomAndCenter?.(12.15, center, false, 320);
        window.setTimeout(() => element.classList.remove('is-expanding'), 380);
      });
      submarkets.push(marker);
    }
    for (const { name, center } of getAreaPlaceholders(showAreaPlaceholders, positionedNames)) {
      const content = createAreaPlaceholder(name, () => {
        if (currentTier === 'submarket' && !zooming) map.setZoomAndCenter?.(12.15, center, false, 320);
      }, mode);
      submarkets.push(new Marker({ position: center, content, anchor: 'center', zooms: [3, 20], zIndex: 92, opacity: 0 }));
    }
    if (submarkets.length) map.add?.(submarkets);

    const styles: any[] = [];
    const styleIndices = new Map<string, number>();
    const massData: any[] = [];
    for (const building of buildings) {
      if (!finite(building?.location_lng) || !finite(building?.location_lat)) continue;
      const visual = visualFor(building, mode, groups);
      const key = `${visual.background}|${visual.border}`;
      let styleIndex = styleIndices.get(key);
      if (styleIndex === undefined) {
        styleIndex = styles.length;
        styleIndices.set(key, styleIndex);
        styles.push({
          url: dotImage(visual.background, visual.border),
          size: new Size(12, 12),
          anchor: new Pixel(6, 6),
          zIndex: styleIndex + 1,
        });
      }
      massData.push({
        lnglat: [building.location_lng, building.location_lat],
        style: styleIndex,
        id: building.id,
        __building: building,
      });
    }

    let mass: any | null = null;
    if (massData.length && styles.length) {
      mass = new MassMarks(massData, {
        opacity: 0,
        zIndex: 76,
        zooms: [10.6, 13.6],
        cursor: 'pointer',
        alwaysRender: true,
        style: styles,
      });
      mass.on?.('mouseover', (event: any) => {
        if (currentTier !== 'dot' && !zooming) return;
        const building = event?.data?.__building;
        if (!building) return;
        c.showHoverTooltip?.(
          building,
          event?.originEvent?.clientX ?? event?.pixel?.getX?.() ?? 0,
          event?.originEvent?.clientY ?? event?.pixel?.getY?.() ?? 0,
        );
      });
      mass.on?.('mouseout', () => c.hideHoverTooltip?.());
      mass.on?.('click', (event: any) => {
        if (currentTier === 'submarket' && !zooming) return;
        openAfterZoom(event?.data?.__building);
      });
      mass.setMap?.(map);
    }

    const detail = new LabelsLayer({
      zooms: [12.8, 20],
      zIndex: 112,
      collision: true,
      allowCollision: false,
      animation: false,
      visible: true,
      opacity: 0,
    });
    const names = new LabelsLayer({
      zooms: [13.8, 20],
      zIndex: 113,
      collision: true,
      allowCollision: false,
      animation: false,
      visible: true,
      opacity: 0,
    });

    const detailItems: any[] = [];
    const nameItems: any[] = [];
    for (const building of buildings) {
      if (!finite(building?.location_lng) || !finite(building?.location_lat)) continue;
      const visual = visualFor(building, mode, groups);
      const metric = latestMetric(building);
      const area = Number(metric?.total_area);
      const grade = String(building?.grade ?? '').toUpperCase();
      const rank = (grade.includes('A') || grade.includes('P') ? 2000 : grade.includes('BP') ? 1200 : 700) +
        (Number.isFinite(area) ? Math.min(999, Math.round(area / 1000)) : 0);

      const icon = new LabelMarker({
        name: String(building.id ?? ''),
        position: [building.location_lng, building.location_lat],
        zooms: [12.8, 20],
        opacity: 1,
        rank,
        zIndex: rank,
        anchor: 'center',
        extData: { id: building.id },
        icon: { type: 'image', image: detailImage(visual), size: [34, 34], anchor: 'center' },
      });
      icon.on?.('mouseover', (event: any) => {
        if (currentTier !== 'building' && !zooming) return;
        icon.setzIndex?.(999999);
        c.showHoverTooltip?.(
          building,
          event?.originEvent?.clientX ?? event?.pixel?.getX?.() ?? 0,
          event?.originEvent?.clientY ?? event?.pixel?.getY?.() ?? 0,
        );
      });
      icon.on?.('mouseout', () => {
        icon.setzIndex?.(rank);
        c.hideHoverTooltip?.();
      });
      icon.on?.('click', () => {
        if (currentTier !== 'building' && !zooming) return;
        showSelection(building);
        c.openBuildingInfoWindow?.(building.id);
      });
      detailItems.push(icon);
      labels.set(String(building.id), icon);
      ranks.set(String(building.id), rank);

      const buildingName = String(building?.name ?? '').trim();
      if (!buildingName) continue;
      const nameLabel = new LabelMarker({
        name: `${building.id}:name`,
        position: [building.location_lng, building.location_lat],
        zooms: [13.8, 20],
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
      nameLabel.on?.('click', () => {
        if (currentTier !== 'building' && !zooming) return;
        showSelection(building);
        c.openBuildingInfoWindow?.(building.id);
      });
      nameItems.push(nameLabel);
    }

    detail.add?.(detailItems);
    names.add?.(nameItems);
    map.add?.(detail);
    map.add?.(names);
    return { submarkets, mass, detail, names, labels, ranks };
  };

  const apply = () => {
    const zoom = map.getZoom?.() ?? 14;
    if (!zooming) currentTier = tierForZoom(zoom);
    c.currentRenderMode = currentTier;
    container.dataset.markerTier = currentTier;

    const state = zooming ? gestureOpacity(zoom) : idleOpacity(currentTier, zoom);
    applyOpacity(current, state, 1);
    applyOpacity(outgoing, state, 0);

    if (currentTier !== 'building' && !zooming) {
      c.infoWindow?.close?.();
      clearSelection();
    }
    syncFutureVisibility();
  };

  const swap = (next: LayerSet, signature: string, buildings: any[], mode: RenderMode, groups: any[] | undefined, showAreaPlaceholders: boolean) => {
    if (disposeTimer !== null) window.clearTimeout(disposeTimer);
    if (outgoing) removeLayerSet(map, outgoing);
    outgoing = current;
    current = next;
    lastSignature = signature;
    lastBuildings = buildings;
    lastMode = mode;
    lastGroups = groups;
    lastShowAreaPlaceholders = showAreaPlaceholders;
    container.classList.add('map-marker-swapping');

    requestAnimationFrame(() => {
      apply();
      disposeTimer = window.setTimeout(() => {
        removeLayerSet(map, outgoing);
        outgoing = null;
        container.classList.remove('map-marker-swapping');
      }, 80);
    });
  };

  c.renderMarkers = ((input: any[], mode: RenderMode = 'default', _stats?: unknown, groups?: any[], showAreaPlaceholders = false) => {
    const buildings = Array.isArray(input) ? input : [];
    if (selectedId && !buildings.some(building => String(building?.id ?? '') === selectedId)) {
      c.infoWindow?.close?.();
      clearSelection();
    }
    const signature = `${renderSignature(buildings, mode, groups)}|${showAreaPlaceholders}`;
    if (signature === lastSignature) {
      if (pendingFrame !== null) {
        cancelAnimationFrame(pendingFrame);
        pendingFrame = null;
      }
      apply();
      return;
    }
    if (pendingFrame !== null) cancelAnimationFrame(pendingFrame);
    pendingFrame = requestAnimationFrame(() => {
      pendingFrame = null;
      const next = build(buildings, mode, groups, showAreaPlaceholders);
      swap(next, signature, buildings, mode, groups, showAreaPlaceholders);
    });
  }) as ControllerInternals['renderMarkers'];

  c.clearMarkers = (() => {
    if (pendingFrame !== null) cancelAnimationFrame(pendingFrame);
    pendingFrame = null;
    if (disposeTimer !== null) window.clearTimeout(disposeTimer);
    disposeTimer = null;
    removeLayerSet(map, outgoing);
    removeLayerSet(map, current);
    outgoing = null;
    current = null;
    clearSelection();
    originalClear();
    lastSignature = '';
    lastBuildings = [];
    currentTier = tierForZoom(map.getZoom?.() ?? 11);
    c.currentRenderMode = currentTier;
    container.classList.remove('map-marker-swapping');
  }) as ControllerInternals['clearMarkers'];

  c.updateVisibilityByZoom = (() => apply()) as ControllerInternals['updateVisibilityByZoom'];

  c.bounceMarker = ((id: string) => {
    const label = current?.labels.get(id);
    if (!label || currentTier !== 'building') return originalBounce?.(id);
    label.setOpacity?.(0.72);
    label.setzIndex?.(999999);
    requestAnimationFrame(() => label.setOpacity?.(1));
  }) as ControllerInternals['bounceMarker'];

  c.stopBounceMarker = ((id: string) => {
    const label = current?.labels.get(id);
    if (!label) return originalStop?.(id);
    label.setOpacity?.(1);
    const rank = current?.ranks.get(id);
    if (rank !== undefined) label.setzIndex?.(rank);
  }) as ControllerInternals['stopBounceMarker'];

  if (originalRefresh) {
    c.refreshBuildingData = (async (id: string) => {
      await originalRefresh(id);
      const fresh = new Map((c._allBuildingsCache ?? []).map(building => [String(building?.id), building]));
      lastSignature = '';
      c.renderMarkers(
        lastBuildings.map(building => fresh.get(String(building?.id)) ?? building),
        lastMode,
        undefined,
        lastGroups,
        lastShowAreaPlaceholders,
      );
    }) as ControllerInternals['refreshBuildingData'];
  }

  if (originalFutureRender && originalFutureClear) {
    c.renderFutureMarkers = ((input: any[], mode: RenderMode = 'default') => {
      futureArgs = { supplies: Array.isArray(input) ? input : [], mode };
      const shouldShow = tierForZoom(map.getZoom?.() ?? 11) === 'building';
      futureVisible = shouldShow;
      if (shouldShow) originalFutureRender(futureArgs.supplies, mode);
      else originalFutureClear();
    }) as ControllerInternals['renderFutureMarkers'];
    c.clearFutureMarkers = (() => {
      futureArgs = null;
      futureVisible = false;
      originalFutureClear();
    }) as ControllerInternals['clearFutureMarkers'];
  }

  const onZoomStart = () => {
    zooming = true;
    container.classList.add('map-is-zooming');
  };
  const onZoomChange = () => apply();
  const onZoomEnd = () => {
    zooming = false;
    currentTier = tierForZoom(map.getZoom?.() ?? 14);
    apply();
    requestAnimationFrame(() => container.classList.remove('map-is-zooming'));
  };
  const onMoveStart = () => container.classList.add('map-is-moving');
  const onMoveEnd = () => requestAnimationFrame(() => container.classList.remove('map-is-moving'));
  const onMapClick = () => {
    if (performance.now() < suppressMapClearUntil) return;
    if (selectedId) clearSelection();
  };

  map.on?.('zoomstart', onZoomStart);
  map.on?.('zoomchange', onZoomChange);
  map.on?.('zoomend', onZoomEnd);
  map.on?.('movestart', onMoveStart);
  map.on?.('moveend', onMoveEnd);
  map.on?.('click', onMapClick);

  return () => {
    if (pendingFrame !== null) cancelAnimationFrame(pendingFrame);
    if (disposeTimer !== null) window.clearTimeout(disposeTimer);
    removeLayerSet(map, outgoing);
    removeLayerSet(map, current);
    clearSelection();
    map.off?.('zoomstart', onZoomStart);
    map.off?.('zoomchange', onZoomChange);
    map.off?.('zoomend', onZoomEnd);
    map.off?.('movestart', onMoveStart);
    map.off?.('moveend', onMoveEnd);
    map.off?.('click', onMapClick);

    c.renderMarkers = originalRender as ControllerInternals['renderMarkers'];
    c.clearMarkers = originalClear as ControllerInternals['clearMarkers'];
    if (originalUpdate) c.updateVisibilityByZoom = originalUpdate;
    if (originalBounce) c.bounceMarker = originalBounce;
    if (originalStop) c.stopBounceMarker = originalStop;
    if (originalRefresh) c.refreshBuildingData = originalRefresh;
    if (originalFutureRender) c.renderFutureMarkers = originalFutureRender;
    if (originalFutureClear) c.clearFutureMarkers = originalFutureClear;
    container.classList.remove('map-is-zooming', 'map-is-moving', 'map-marker-swapping');
    delete container.dataset.markerTier;
    delete container.dataset.selectedBuilding;
  };
}
