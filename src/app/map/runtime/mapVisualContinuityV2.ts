'use client';

import type { MapController } from '@/src/services/MapController';
import { controllerInternals, type ControllerInternals } from './mapNativeMarkerRenderer';

type RenderMode = 'default' | 'rent' | 'vacancy' | 'leed';
type MarkerMode = 'submarket' | 'dot' | 'building';
type LayerSet = {
  submarkets: any[];
  mass: any | null;
  detail: any | null;
  names: any | null;
  labels: Map<string, any>;
  baseRanks: Map<string, number>;
};

const ZOOM = {
  submarketFadeStart: 10.98,
  submarketFadeEnd: 11.58,
  dotFadeInStart: 10.98,
  dotFadeInEnd: 11.34,
  dotFadeOutStart: 12.78,
  dotFadeOutEnd: 13.28,
  detailFadeInStart: 12.56,
  detailFadeInEnd: 13.12,
  nameFadeInStart: 13.78,
  nameFadeInEnd: 14.28,
} as const;

const PALETTE = {
  brand: '#245b78', gradeA: '#245b78', gradeB: '#4f7968', gradeBP: '#9b6948', neutral: '#8794a4',
  low: '#4f7968', medium: '#967a43', high: '#a56142', extreme: '#97515a',
} as const;

function clamp(value: number, min = 0, max = 1): number {
  return Math.min(max, Math.max(min, value));
}

function smoothStep(start: number, end: number, value: number): number {
  if (end <= start) return value >= end ? 1 : 0;
  const t = clamp((value - start) / (end - start));
  return t * t * (3 - 2 * t);
}

function escapeHtml(value: unknown): string {
  return String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function finite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function latestMetric(building: any): any | null {
  let latest: any | null = null;
  let order = Number.NEGATIVE_INFINITY;
  for (const metric of Array.isArray(building?.metrics) ? building.metrics : []) {
    const next = (Number(metric?.record_year) || 0) * 10 + (Number(metric?.record_quarter) || 0);
    if (next > order) { latest = metric; order = next; }
  }
  return latest;
}

function groupColor(building: any, groups?: any[]): string | undefined {
  if (!Array.isArray(groups)) return undefined;
  for (let i = groups.length - 1; i >= 0; i -= 1) {
    const group = groups[i];
    if (group?.submarkets?.length && (!building?.submarket || !group.submarkets.includes(building.submarket))) continue;
    const grade = String(building?.grade ?? '').toUpperCase();
    if (group?.grades?.length) {
      const match = group.grades.some((wanted: string) =>
        wanted === '产业园' ? grade.includes('BP') :
        wanted === '甲级' ? ((grade.includes('A') || grade.includes('P')) && !grade.includes('BP')) :
        wanted === '乙级' ? (grade.includes('B') && !grade.includes('BP')) : false,
      );
      if (!match) continue;
    }
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
    if (grade.includes('BP')) { background = PALETTE.gradeBP; text = 'BP'; fontSize = 9; }
    else if (grade.includes('A') || grade.includes('P')) { background = PALETTE.gradeA; text = 'A'; }
    else if (grade.includes('B')) { background = PALETTE.gradeB; text = 'B'; }
    else { background = PALETTE.neutral; text = '·'; }
  } else if (mode === 'rent') {
    const rent = Number(metric?.net_effective_rent);
    const has = Number.isFinite(rent) && rent > 0;
    text = has ? String(Math.round(rent)) : '–'; fontSize = text.length >= 3 ? 9.5 : 10.5;
    background = !has ? PALETTE.neutral : rent >= 300 ? PALETTE.extreme : rent >= 200 ? PALETTE.high : rent >= 100 ? PALETTE.medium : PALETTE.low;
  } else if (mode === 'vacancy') {
    const vacancy = Number(metric?.vacancy_rate);
    const has = Number.isFinite(vacancy);
    const pct = has ? (vacancy <= 1 ? vacancy * 100 : vacancy) : 0;
    text = has ? `${Math.round(pct)}%` : '–'; fontSize = text.length >= 3 ? 9 : 10;
    background = !has ? PALETTE.neutral : pct >= 30 ? PALETTE.extreme : pct >= 20 ? PALETTE.high : pct >= 10 ? PALETTE.medium : PALETTE.low;
  } else {
    const leed = String(building?.leed_certification ?? '').toUpperCase();
    if (leed.includes('PLATINUM')) { background = '#d9edf3'; border = '#68aebf'; textColor = '#225a68'; text = 'P'; }
    else if (leed.includes('GOLD')) { background = '#eadfbd'; border = '#b69a52'; textColor = '#6f5a25'; text = 'G'; }
    else if (leed.includes('SILVER')) { background = '#e7ebef'; border = '#9ca8b3'; textColor = '#52606d'; text = 'S'; }
    else { background = '#eef1f4'; border = '#bdc6ce'; textColor = '#6f7c89'; text = 'N'; }
  }
  const override = mode === 'default' ? groupColor(building, groups) : undefined;
  if (override) { background = override; border = '#ffffff'; textColor = '#ffffff'; }
  return { background, border, textColor, text, fontSize };
}

function dataUri(svg: string): string { return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`; }
function dotImage(background: string, border: string): string {
  return dataUri(`<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 14 14"><circle cx="7" cy="7" r="6" fill="#fff" fill-opacity=".94"/><circle cx="7" cy="7" r="4.8" fill="${background}" stroke="${border}" stroke-width=".8"/></svg>`);
}
function detailImage(v: ReturnType<typeof visualFor>): string {
  return dataUri(`<svg xmlns="http://www.w3.org/2000/svg" width="36" height="36" viewBox="0 0 36 36"><circle cx="18" cy="18" r="17" fill="#fff" fill-opacity=".97"/><circle cx="18" cy="18" r="14.6" fill="${v.background}" stroke="${v.border}" stroke-width="1.4"/><text x="18" y="18.5" text-anchor="middle" dominant-baseline="middle" font-family="Arial,PingFang SC,Microsoft YaHei,sans-serif" font-size="${v.fontSize}" font-weight="800" fill="${v.textColor}">${escapeHtml(v.text)}</text></svg>`);
}

function modeFor(zoom: number, active: MarkerMode | null): MarkerMode {
  if (active === 'submarket' && zoom < 11.5) return 'submarket';
  if (active === 'dot' && zoom >= 11.12 && zoom < 13.16) return 'dot';
  if (active === 'building' && zoom >= 12.82) return 'building';
  return zoom < 11.32 ? 'submarket' : zoom < 13 ? 'dot' : 'building';
}

function setOpacity(set: LayerSet | null, zoom: number, multiplier = 1): void {
  if (!set) return;
  const sub = (1 - smoothStep(ZOOM.submarketFadeStart, ZOOM.submarketFadeEnd, zoom)) * multiplier;
  const dot = clamp(smoothStep(ZOOM.dotFadeInStart, ZOOM.dotFadeInEnd, zoom) * (1 - smoothStep(ZOOM.dotFadeOutStart, ZOOM.dotFadeOutEnd, zoom))) * multiplier;
  const detail = smoothStep(ZOOM.detailFadeInStart, ZOOM.detailFadeInEnd, zoom) * multiplier;
  const names = smoothStep(ZOOM.nameFadeInStart, ZOOM.nameFadeInEnd, zoom) * multiplier;
  set.submarkets.forEach(marker => marker.setOpacity?.(sub));
  set.mass?.setOpacity?.(dot);
  set.detail?.setOpacity?.(detail);
  set.names?.setOpacity?.(names);
}

function removeSet(map: any, set: LayerSet | null): void {
  if (!set) return;
  try { if (set.submarkets.length) map.remove?.(set.submarkets); } catch {}
  try { set.mass?.clear?.(); set.mass?.setMap?.(null); } catch {}
  try { set.detail?.clear?.(); map.remove?.(set.detail); } catch {}
  try { set.names?.clear?.(); map.remove?.(set.names); } catch {}
}

function signature(buildings: any[], mode: RenderMode, groups?: any[]): string {
  let value = `${mode}|${buildings.length}|`;
  for (const b of buildings) {
    const metric = latestMetric(b);
    value += [
      b?.id ?? '',
      b?.name ?? '',
      b?.grade ?? '',
      b?.submarket ?? '',
      b?.district ?? '',
      b?.leed_certification ?? '',
      b?.location_lng ?? '',
      b?.location_lat ?? '',
      metric?.record_year ?? '',
      metric?.record_quarter ?? '',
      metric?.net_effective_rent ?? '',
      metric?.vacancy_rate ?? '',
      metric?.total_area ?? '',
      metric?.vacant_area ?? '',
    ].join(':') + '|';
  }
  if (groups) for (const g of groups) value += `${g?.id ?? ''}:${g?.color ?? ''}:${(g?.submarkets ?? []).join(',')}:${(g?.grades ?? []).join(',')}:${(g?.districts ?? []).join(',')}|`;
  return value;
}

export function installMapVisualContinuityV2(controller: MapController, container: HTMLElement): (() => void) | null {
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
  let activeTier: MarkerMode | null = null;
  let lastSignature = '';
  let lastBuildings: any[] = [];
  let lastMode: RenderMode = 'default';
  let lastGroups: any[] | undefined;
  let pendingFrame: number | null = null;
  let disposeTimer: number | null = null;
  let selectedMarker: any | null = null;
  let selectedId: string | null = null;
  let suppressMapClearUntil = 0;
  let navigationToken = 0;
  let futureSignature = '';

  const clearSelection = () => {
    if (selectedMarker) { try { map.remove?.(selectedMarker); } catch {} }
    selectedMarker = null; selectedId = null;
    container.removeAttribute('data-selected-building');
  };

  const showSelection = (building: any) => {
    clearSelection();
    if (!building || !finite(building.location_lng) || !finite(building.location_lat)) return;
    const el = document.createElement('div');
    el.className = 'map-selected-marker';
    el.innerHTML = '<span class="map-selected-marker__core"></span><span class="map-selected-marker__ring"></span>';
    selectedMarker = new Marker({ position: [building.location_lng, building.location_lat], content: el, anchor: 'center', zIndex: 999999, bubble: true });
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
    const zoom = map.getZoom?.() ?? 14;
    if (zoom >= 13.55) { finish(); return; }
    let done = false;
    let timer: number | null = null;
    const onProgress = () => {
      if (done || token !== navigationToken) return;
      if ((map.getZoom?.() ?? 0) >= 13.35) {
        done = true; map.off?.('zoomchange', onProgress); map.off?.('zoomend', onEnd);
        if (timer !== null) window.clearTimeout(timer); finish();
      }
    };
    const onEnd = () => { if (!done) { done = true; map.off?.('zoomchange', onProgress); map.off?.('zoomend', onEnd); if (timer !== null) window.clearTimeout(timer); finish(); } };
    map.on?.('zoomchange', onProgress); map.on?.('zoomend', onEnd);
    map.setZoomAndCenter?.(14, center, false, 340);
    timer = window.setTimeout(onEnd, 620);
  };

  const build = (buildings: any[], mode: RenderMode, groups?: any[]): LayerSet => {
    const labels = new Map<string, any>();
    const baseRanks = new Map<string, number>();
    const submarketMap = new Map<string, any>();
    for (const b of buildings) {
      const sub = String(b?.submarket ?? '').trim();
      if (!sub || sub === '其他') continue;
      let agg = submarketMap.get(sub);
      if (!agg) { agg = { name: sub, count: 0, lng: 0, lat: 0, coords: 0, area: 0, vacant: 0, rentSum: 0, rentArea: 0, leed: 0 }; submarketMap.set(sub, agg); }
      agg.count += 1;
      if (finite(b.location_lng) && finite(b.location_lat)) { agg.lng += b.location_lng; agg.lat += b.location_lat; agg.coords += 1; }
      const m = latestMetric(b); const area = Number(m?.total_area); const vacant = Number(m?.vacant_area); const rent = Number(m?.net_effective_rent);
      if (Number.isFinite(area) && area > 0) { agg.area += area; if (Number.isFinite(vacant)) agg.vacant += vacant; }
      if (Number.isFinite(area) && area > 0 && Number.isFinite(rent) && rent > 0) { agg.rentSum += rent * area; agg.rentArea += area; }
      const leed = String(b?.leed_certification ?? '').trim().toUpperCase(); if (leed && leed !== 'NULL' && leed !== '无' && leed !== '-') agg.leed += 1;
    }

    const submarkets: any[] = [];
    for (const agg of submarketMap.values()) {
      if (!agg.coords) continue;
      const center: [number, number] = [agg.lng / agg.coords, agg.lat / agg.coords];
      const rent = agg.rentArea > 0 ? agg.rentSum / agg.rentArea : 0;
      const vacancy = agg.area > 0 ? (agg.vacant / agg.area) * 100 : Number.NaN;
      const leedPct = agg.count > 0 ? (agg.leed / agg.count) * 100 : 0;
      let accent: string = PALETTE.brand;
      if (mode === 'rent') accent = rent <= 0 ? PALETTE.neutral : rent >= 300 ? PALETTE.extreme : rent >= 200 ? PALETTE.high : rent >= 100 ? PALETTE.medium : PALETTE.low;
      else if (mode === 'vacancy') accent = !Number.isFinite(vacancy) ? PALETTE.neutral : vacancy >= 30 ? PALETTE.extreme : vacancy >= 20 ? PALETTE.high : vacancy >= 10 ? PALETTE.medium : PALETTE.low;
      else if (mode === 'leed') accent = leedPct >= 60 ? '#3f715f' : leedPct >= 40 ? '#537f6c' : leedPct >= 20 ? '#6f927f' : leedPct > 0 ? '#88a493' : PALETTE.neutral;
      const size = 76 + Math.min(14, Math.round(Math.sqrt(agg.count) * 1.6));
      let primary = `¥${rent > 0 ? rent.toFixed(0) : '–'}`; let secondary = Number.isFinite(vacancy) ? `${vacancy.toFixed(1)}%` : '–';
      if (mode === 'rent') { primary = `¥${rent > 0 ? rent.toFixed(1) : '–'}`; secondary = '平均租金'; }
      else if (mode === 'vacancy') { primary = Number.isFinite(vacancy) ? `${vacancy.toFixed(1)}%` : '–'; secondary = '空置率'; }
      else if (mode === 'leed') { primary = `${leedPct.toFixed(0)}%`; secondary = 'LEED'; }
      const separator = mode === 'default' ? '<span class="map-submarket-bubble__sep">·</span>' : '';
      const el = document.createElement('div');
      el.className = 'map-submarket-bubble'; el.dataset.renderMode = mode; el.title = agg.name;
      el.style.setProperty('--sm-accent', accent); el.style.setProperty('--sm-size', `${size}px`);
      el.innerHTML = `<div class="map-submarket-bubble__name">${escapeHtml(agg.name)}</div><div class="map-submarket-bubble__metrics"><span class="map-submarket-bubble__primary">${primary}</span>${separator}<span class="map-submarket-bubble__secondary">${secondary}</span></div>`;
      const marker = new Marker({ position: center, content: el, anchor: 'center', zooms: [3, 20], zIndex: 92, topWhenClick: true, opacity: 0 });
      marker.on?.('click', () => { el.classList.add('is-expanding'); map.setZoomAndCenter?.(12.15, center, false, 340); window.setTimeout(() => el.classList.remove('is-expanding'), 420); });
      submarkets.push(marker);
    }
    if (submarkets.length) map.add?.(submarkets);

    const styles: any[] = []; const styleIndex = new Map<string, number>(); const massData: any[] = [];
    for (const b of buildings) {
      if (!finite(b?.location_lng) || !finite(b?.location_lat)) continue;
      const v = visualFor(b, mode, groups); const key = `${v.background}|${v.border}`;
      let idx = styleIndex.get(key); if (idx === undefined) { idx = styles.length; styleIndex.set(key, idx); styles.push({ url: dotImage(v.background, v.border), size: new Size(14, 14), anchor: new Pixel(7, 7), zIndex: idx + 1 }); }
      massData.push({ lnglat: [b.location_lng, b.location_lat], style: idx, id: b.id, __building: b });
    }
    let mass: any | null = null;
    if (massData.length && styles.length) {
      mass = new MassMarks(massData, { opacity: 0, zIndex: 76, zooms: [10.4, 14], cursor: 'pointer', alwaysRender: true, style: styles });
      mass.on?.('mouseover', (event: any) => { const b = event?.data?.__building; if (b) c.showHoverTooltip?.(b, event?.originEvent?.clientX ?? event?.pixel?.getX?.() ?? 0, event?.originEvent?.clientY ?? event?.pixel?.getY?.() ?? 0); });
      mass.on?.('mouseout', () => c.hideHoverTooltip?.()); mass.on?.('click', (event: any) => openAfterZoom(event?.data?.__building)); mass.setMap?.(map);
    }

    const detail = new LabelsLayer({ zooms: [12.2, 20], zIndex: 112, collision: true, allowCollision: false, animation: false, visible: true, opacity: 0 });
    const names = new LabelsLayer({ zooms: [13.55, 20], zIndex: 113, collision: true, allowCollision: false, animation: false, visible: true, opacity: 0 });
    const detailItems: any[] = []; const nameItems: any[] = [];
    for (const b of buildings) {
      if (!finite(b?.location_lng) || !finite(b?.location_lat)) continue;
      const v = visualFor(b, mode, groups); const m = latestMetric(b); const area = Number(m?.total_area); const grade = String(b?.grade ?? '').toUpperCase();
      const rank = (grade.includes('A') || grade.includes('P') ? 2000 : grade.includes('BP') ? 1200 : 700) + (Number.isFinite(area) ? Math.min(999, Math.round(area / 1000)) : 0);
      const icon = new LabelMarker({ name: String(b.id ?? ''), position: [b.location_lng, b.location_lat], zooms: [12.2, 20], opacity: 1, rank, zIndex: rank, anchor: 'center', extData: { id: b.id }, icon: { type: 'image', image: detailImage(v), size: [36, 36], anchor: 'center' } });
      icon.on?.('mouseover', (event: any) => { icon.setOpacity?.(1); icon.setzIndex?.(999999); c.showHoverTooltip?.(b, event?.originEvent?.clientX ?? event?.pixel?.getX?.() ?? 0, event?.originEvent?.clientY ?? event?.pixel?.getY?.() ?? 0); });
      icon.on?.('mouseout', () => { icon.setOpacity?.(1); icon.setzIndex?.(rank); c.hideHoverTooltip?.(); }); icon.on?.('click', () => { showSelection(b); c.openBuildingInfoWindow?.(b.id); });
      detailItems.push(icon); labels.set(String(b.id), icon); baseRanks.set(String(b.id), rank);
      const name = String(b?.name ?? '').trim(); if (!name) continue;
      const label = new LabelMarker({ name: `${b.id}:name`, position: [b.location_lng, b.location_lat], zooms: [13.55, 20], opacity: 1, rank: Math.max(1, rank - 1), zIndex: rank, extData: { id: b.id }, text: { content: name, direction: 'right', offset: [19, 0], style: { fontSize: 11, fontWeight: '600', fillColor: '#26394d', strokeColor: '#ffffff', strokeWidth: 3, padding: '1, 2', fold: true } } });
      label.on?.('click', () => { showSelection(b); c.openBuildingInfoWindow?.(b.id); }); nameItems.push(label);
    }
    detail.add?.(detailItems); names.add?.(nameItems); map.add?.(detail); map.add?.(names);
    return { submarkets, mass, detail, names, labels, baseRanks };
  };

  const apply = () => {
    const zoom = map.getZoom?.() ?? 14;
    activeTier = modeFor(zoom, activeTier); c.currentRenderMode = activeTier; container.dataset.markerTier = activeTier;
    setOpacity(current, zoom, 1); setOpacity(outgoing, zoom, 0.12);
    if (activeTier !== 'building' && zoom < 12.5) { c.infoWindow?.close?.(); clearSelection(); }
  };

  const swap = (next: LayerSet, sig: string, buildings: any[], mode: RenderMode, groups?: any[]) => {
    if (disposeTimer !== null) window.clearTimeout(disposeTimer);
    if (outgoing) removeSet(map, outgoing);
    outgoing = current; current = next;
    lastSignature = sig; lastBuildings = buildings; lastMode = mode; lastGroups = groups;
    container.classList.add('map-marker-swapping');
    requestAnimationFrame(() => {
      apply();
      if (outgoing) setOpacity(outgoing, map.getZoom?.() ?? 14, 0.08);
      disposeTimer = window.setTimeout(() => {
        removeSet(map, outgoing); outgoing = null; container.classList.remove('map-marker-swapping');
      }, 110);
    });
  };

  c.renderMarkers = ((input: any[], mode: RenderMode = 'default', _stats?: unknown, groups?: any[]) => {
    const buildings = Array.isArray(input) ? input : [];
    const sig = signature(buildings, mode, groups);
    if (sig === lastSignature) {
      if (pendingFrame !== null) {
        cancelAnimationFrame(pendingFrame);
        pendingFrame = null;
      }
      apply();
      return;
    }
    if (pendingFrame !== null) cancelAnimationFrame(pendingFrame);
    container.classList.add('map-marker-rendering');
    pendingFrame = requestAnimationFrame(() => {
      pendingFrame = null;
      const next = build(buildings, mode, groups);
      swap(next, sig, buildings, mode, groups);
      container.classList.remove('map-marker-rendering');
    });
  }) as ControllerInternals['renderMarkers'];

  c.clearMarkers = (() => {
    if (pendingFrame !== null) cancelAnimationFrame(pendingFrame); pendingFrame = null;
    if (disposeTimer !== null) window.clearTimeout(disposeTimer); disposeTimer = null;
    removeSet(map, outgoing); outgoing = null; removeSet(map, current); current = null; clearSelection();
    originalClear(); lastSignature = ''; lastBuildings = []; activeTier = null; c.currentRenderMode = null;
    container.classList.remove('map-marker-rendering', 'map-marker-swapping'); delete container.dataset.markerTier;
  }) as ControllerInternals['clearMarkers'];

  c.updateVisibilityByZoom = (() => apply()) as ControllerInternals['updateVisibilityByZoom'];
  c.bounceMarker = ((id: string) => { const label = current?.labels.get(id); if (!label) return originalBounce?.(id); label.setOpacity?.(.72); label.setzIndex?.(999999); requestAnimationFrame(() => label.setOpacity?.(1)); }) as ControllerInternals['bounceMarker'];
  c.stopBounceMarker = ((id: string) => { const label = current?.labels.get(id); if (!label) return originalStop?.(id); label.setOpacity?.(1); const rank = current?.baseRanks.get(id); if (rank !== undefined) label.setzIndex?.(rank); }) as ControllerInternals['stopBounceMarker'];

  if (originalRefresh) c.refreshBuildingData = (async (id: string) => { await originalRefresh(id); const fresh = new Map((c._allBuildingsCache ?? []).map(b => [String(b?.id), b])); lastSignature = ''; c.renderMarkers(lastBuildings.map(b => fresh.get(String(b?.id)) ?? b), lastMode, undefined, lastGroups); }) as ControllerInternals['refreshBuildingData'];
  if (originalFutureRender) c.renderFutureMarkers = ((input: any[], mode: RenderMode = 'default') => { const supplies = Array.isArray(input) ? input : []; const sig = `${mode}:${supplies.map(s => String(s?.id ?? '')).join('|')}`; if (sig === futureSignature) return; futureSignature = sig; originalFutureRender(supplies, mode); }) as ControllerInternals['renderFutureMarkers'];
  if (originalFutureClear) c.clearFutureMarkers = (() => { futureSignature = ''; originalFutureClear(); }) as ControllerInternals['clearFutureMarkers'];

  const onZoomStart = () => container.classList.add('map-is-zooming');
  const onZoomChange = () => apply();
  const onZoomEnd = () => { apply(); requestAnimationFrame(() => container.classList.remove('map-is-zooming')); };
  const onMoveStart = () => container.classList.add('map-is-moving');
  const onMoveEnd = () => requestAnimationFrame(() => container.classList.remove('map-is-moving'));
  const onMapClick = () => { if (selectedId && performance.now() > suppressMapClearUntil) clearSelection(); };
  map.on?.('zoomstart', onZoomStart); map.on?.('zoomchange', onZoomChange); map.on?.('zoomend', onZoomEnd); map.on?.('movestart', onMoveStart); map.on?.('moveend', onMoveEnd); map.on?.('click', onMapClick);

  return () => {
    if (pendingFrame !== null) cancelAnimationFrame(pendingFrame);
    if (disposeTimer !== null) window.clearTimeout(disposeTimer);
    removeSet(map, outgoing); removeSet(map, current); clearSelection();
    map.off?.('zoomstart', onZoomStart); map.off?.('zoomchange', onZoomChange); map.off?.('zoomend', onZoomEnd); map.off?.('movestart', onMoveStart); map.off?.('moveend', onMoveEnd); map.off?.('click', onMapClick);
    c.renderMarkers = originalRender as ControllerInternals['renderMarkers']; c.clearMarkers = originalClear as ControllerInternals['clearMarkers'];
    if (originalUpdate) c.updateVisibilityByZoom = originalUpdate; if (originalBounce) c.bounceMarker = originalBounce; if (originalStop) c.stopBounceMarker = originalStop; if (originalRefresh) c.refreshBuildingData = originalRefresh; if (originalFutureRender) c.renderFutureMarkers = originalFutureRender; if (originalFutureClear) c.clearFutureMarkers = originalFutureClear;
    container.classList.remove('map-is-zooming', 'map-is-moving', 'map-marker-rendering', 'map-marker-swapping'); delete container.dataset.markerTier; delete container.dataset.selectedBuilding;
  };
}
