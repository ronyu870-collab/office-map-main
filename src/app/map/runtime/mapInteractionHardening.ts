'use client';

import type { MapController } from '@/src/services/MapController';

type MarkerLike = {
  show?: () => void;
  hide?: () => void;
};

type MapLike = {
  add?: (overlays: unknown[] | unknown) => void;
  remove?: (overlays: unknown[] | unknown) => void;
  getZoom?: () => number;
  panBy?: (x: number, y: number, duration?: number) => void;
  on?: (eventName: string, handler: () => void) => void;
  off?: (eventName: string, handler: () => void) => void;
};

type MarkerMode = 'submarket' | 'dot' | 'building';

type ControllerInternals = {
  map?: MapLike | null;
  markers?: MarkerLike[];
  dotMarkers?: MarkerLike[];
  submarketMarkers?: MarkerLike[];
  currentRenderMode?: MarkerMode | null;
  infoWindow?: { close?: () => void } | null;
  updateVisibilityByZoom?: () => void;
  renderMarkers: (...args: any[]) => void;
  clearMarkers: () => void;
};

function intersectsHorizontally(a: DOMRect, b: DOMRect): boolean {
  return a.left < b.right && a.right > b.left;
}

function isVisibleElement(element: HTMLElement): boolean {
  const style = window.getComputedStyle(element);
  const rect = element.getBoundingClientRect();
  return style.display !== 'none' &&
    style.visibility !== 'hidden' &&
    Number(style.opacity || '1') > 0 &&
    rect.width > 0 && rect.height > 0;
}

function getSafeVerticalBand(container: HTMLElement, infoRect: DOMRect) {
  const main = container.parentElement;
  const mainRect = main?.getBoundingClientRect();
  let safeTop = (mainRect?.top ?? 0) + 12;
  let safeBottom = (mainRect?.bottom ?? window.innerHeight) - 12;

  const header = main?.previousElementSibling;
  if (header instanceof HTMLElement && isVisibleElement(header)) {
    const rect = header.getBoundingClientRect();
    if (intersectsHorizontally(infoRect, rect)) safeTop = Math.max(safeTop, rect.bottom + 12);
  }

  if (main) {
    for (const child of Array.from(main.children)) {
      if (!(child instanceof HTMLElement) || child === container || !isVisibleElement(child)) continue;
      const style = window.getComputedStyle(child);
      const position = style.position;
      if (position !== 'absolute' && position !== 'fixed' && position !== 'sticky') continue;

      const zIndex = Number.parseInt(style.zIndex || '0', 10);
      if (!Number.isFinite(zIndex) || zIndex < 250) continue;

      const rect = child.getBoundingClientRect();
      if (!intersectsHorizontally(infoRect, rect)) continue;

      const shortOverlay = rect.height <= 110;
      if (!shortOverlay) continue;

      if (mainRect && rect.top <= mainRect.top + 120) {
        safeTop = Math.max(safeTop, rect.bottom + 12);
      }
      if (mainRect && rect.bottom >= mainRect.bottom - 120) {
        safeBottom = Math.min(safeBottom, rect.top - 12);
      }
    }
  }

  return { safeTop, safeBottom };
}

function installInfoWindowAvoidance(map: MapLike, container: HTMLElement): () => void {
  let timer: number | null = null;
  let raf: number | null = null;
  let adjusting = false;

  const clearSchedule = () => {
    if (timer !== null) window.clearTimeout(timer);
    if (raf !== null) cancelAnimationFrame(raf);
    timer = null;
    raf = null;
  };

  const adjust = () => {
    if (adjusting) return;
    const info = container.querySelector<HTMLElement>('.amap-info');
    if (!info || !isVisibleElement(info)) return;

    const rect = info.getBoundingClientRect();
    const { safeTop, safeBottom } = getSafeVerticalBand(container, rect);
    let deltaY = 0;

    if (rect.top < safeTop) {
      deltaY = Math.min(260, safeTop - rect.top);
    } else if (rect.bottom > safeBottom) {
      deltaY = -Math.min(260, rect.bottom - safeBottom);
    }

    if (Math.abs(deltaY) < 2 || typeof map.panBy !== 'function') return;

    adjusting = true;
    container.classList.add('map-info-avoiding');
    map.panBy(0, deltaY, 180);
    window.setTimeout(() => {
      adjusting = false;
      container.classList.remove('map-info-avoiding');
    }, 220);
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

  const observer = new MutationObserver(schedule);
  observer.observe(container, { childList: true, subtree: true });
  map.on?.('moveend', schedule);
  window.addEventListener('resize', schedule);

  return () => {
    clearSchedule();
    observer.disconnect();
    map.off?.('moveend', schedule);
    window.removeEventListener('resize', schedule);
    container.classList.remove('map-info-avoiding');
  };
}

function installMarkerLayerHardening(controller: ControllerInternals, container: HTMLElement): () => void {
  const map = controller.map;
  if (!map || typeof map.getZoom !== 'function') return () => {};

  const originalRenderMarkers = controller.renderMarkers.bind(controller);
  const originalClearMarkers = controller.clearMarkers.bind(controller);
  const originalUpdateVisibility = controller.updateVisibilityByZoom?.bind(controller);

  const mountedModes = new Set<MarkerMode>();
  let activeMode: MarkerMode | null = null;
  let switchFrame: number | null = null;
  let settleFrame: number | null = null;
  let lastBuildingsRef: unknown = null;
  let lastMode: unknown = null;
  let lastDistrictStatsRef: unknown = null;
  let lastGroupsRef: unknown = null;

  const getMarkers = (mode: MarkerMode): MarkerLike[] => {
    if (mode === 'submarket') return controller.submarketMarkers ?? [];
    if (mode === 'dot') return controller.dotMarkers ?? [];
    return controller.markers ?? [];
  };

  const chooseMode = (): MarkerMode => {
    const buildingMarkers = controller.markers ?? [];
    const dotMarkers = controller.dotMarkers ?? [];
    const submarketMarkers = controller.submarketMarkers ?? [];

    // Competitor mode replaces the normal three-level marker set with only
    // building markers. Do not let a transient fitView zoom hide them.
    if (buildingMarkers.length > 0 && dotMarkers.length === 0 && submarketMarkers.length === 0) {
      return 'building';
    }

    const zoom = map.getZoom?.() ?? 14;
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

  const applyMode = () => {
    switchFrame = null;
    const nextMode = chooseMode();
    if (nextMode === activeMode && mountedModes.has(nextMode)) return;

    container.classList.add('map-marker-switching');
    mountOnce(nextMode);

    for (const mode of mountedModes) {
      setVisible(mode, mode === nextMode);
    }

    if (nextMode !== 'building') controller.infoWindow?.close?.();
    controller.currentRenderMode = nextMode;
    activeMode = nextMode;

    if (settleFrame !== null) cancelAnimationFrame(settleFrame);
    settleFrame = requestAnimationFrame(() => {
      settleFrame = requestAnimationFrame(() => {
        settleFrame = null;
        container.classList.remove('map-marker-switching');
      });
    });
  };

  const scheduleMode = () => {
    if (switchFrame !== null) cancelAnimationFrame(switchFrame);
    switchFrame = requestAnimationFrame(applyMode);
  };

  controller.updateVisibilityByZoom = scheduleMode;

  controller.clearMarkers = (() => {
    originalClearMarkers();
    mountedModes.clear();
    activeMode = null;
    container.classList.remove('map-marker-switching');
  }) as ControllerInternals['clearMarkers'];

  controller.renderMarkers = ((...args: any[]) => {
    const buildingsRef = args[0];
    const renderMode = args[1] ?? 'default';
    const districtStatsRef = args[2];
    const groupsRef = args[3];

    // React can revisit the same render inputs via sibling state updates. A full
    // marker rebuild is expensive, so skip only exact-reference duplicates.
    if (
      buildingsRef === lastBuildingsRef &&
      renderMode === lastMode &&
      districtStatsRef === lastDistrictStatsRef &&
      groupsRef === lastGroupsRef
    ) {
      return;
    }

    lastBuildingsRef = buildingsRef;
    lastMode = renderMode;
    lastDistrictStatsRef = districtStatsRef;
    lastGroupsRef = groupsRef;
    originalRenderMarkers(...args);
  }) as ControllerInternals['renderMarkers'];

  const onZoomStart = () => container.classList.add('map-is-zooming');
  const onZoomEnd = () => {
    scheduleMode();
    requestAnimationFrame(() => container.classList.remove('map-is-zooming'));
  };
  const onMoveStart = () => container.classList.add('map-is-moving');
  const onMoveEnd = () => requestAnimationFrame(() => container.classList.remove('map-is-moving'));

  map.on?.('zoomstart', onZoomStart);
  map.on?.('zoomend', onZoomEnd);
  map.on?.('movestart', onMoveStart);
  map.on?.('moveend', onMoveEnd);

  return () => {
    if (switchFrame !== null) cancelAnimationFrame(switchFrame);
    if (settleFrame !== null) cancelAnimationFrame(settleFrame);
    map.off?.('zoomstart', onZoomStart);
    map.off?.('zoomend', onZoomEnd);
    map.off?.('movestart', onMoveStart);
    map.off?.('moveend', onMoveEnd);
    controller.renderMarkers = originalRenderMarkers as ControllerInternals['renderMarkers'];
    controller.clearMarkers = originalClearMarkers as ControllerInternals['clearMarkers'];
    if (originalUpdateVisibility) controller.updateVisibilityByZoom = originalUpdateVisibility;
    container.classList.remove('map-is-zooming', 'map-is-moving', 'map-marker-switching');
  };
}

export function installMapInteractionHardening(
  controller: MapController,
  containerId: string,
): () => void {
  const container = document.getElementById(containerId);
  const internals = controller as unknown as ControllerInternals;
  const map = internals.map;
  if (!container || !map) return () => {};

  const cleanupMarkerLayers = installMarkerLayerHardening(internals, container);
  const cleanupInfoWindow = installInfoWindowAvoidance(map, container);

  return () => {
    cleanupInfoWindow();
    cleanupMarkerLayers();
  };
}
