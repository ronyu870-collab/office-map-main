// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { installMapInteractionHardening } from '../mapInteractionHardening';

type HandlerMap = Map<string, Set<(event?: any) => void>>;

function eventTarget() {
  const handlers: HandlerMap = new Map();
  return {
    on(eventName: string, handler: (event?: any) => void) {
      if (!handlers.has(eventName)) handlers.set(eventName, new Set());
      handlers.get(eventName)!.add(handler);
    },
    off(eventName: string, handler: (event?: any) => void) {
      handlers.get(eventName)?.delete(handler);
    },
    emit(eventName: string, event?: any) {
      for (const handler of handlers.get(eventName) ?? []) handler(event);
    },
  };
}

function createNativeHarness() {
  const mapEvents = eventTarget();
  let zoom = 11.2;
  const add = vi.fn();
  const remove = vi.fn();
  const panBy = vi.fn();
  const setZoomAndCenter = vi.fn((nextZoom: number) => { zoom = nextZoom; });

  const map = { add, remove, panBy, setZoomAndCenter, getZoom: () => zoom, on: mapEvents.on, off: mapEvents.off };
  const markerInstances: any[] = [];
  const labelMarkerInstances: any[] = [];
  const labelsLayerInstances: any[] = [];
  const massMarksInstances: any[] = [];

  class Marker {
    options: any;
    handlers = eventTarget();
    constructor(options: any) { this.options = options; markerInstances.push(this); }
    on = this.handlers.on;
    off = this.handlers.off;
    show = vi.fn();
    hide = vi.fn();
    setOpacity = vi.fn();
  }
  class Pixel { constructor(public x: number, public y: number) {} }
  class Size { constructor(public width: number, public height: number) {} }
  class LabelMarker {
    options: any;
    handlers = eventTarget();
    constructor(options: any) { this.options = options; labelMarkerInstances.push(this); }
    on = this.handlers.on;
    off = this.handlers.off;
    setOpacity = vi.fn();
    setzIndex = vi.fn();
  }
  class LabelsLayer {
    options: any;
    markers: any[] = [];
    constructor(options: any) { this.options = options; labelsLayerInstances.push(this); }
    add = vi.fn((markers: any[] | any) => { this.markers.push(...(Array.isArray(markers) ? markers : [markers])); });
    clear = vi.fn(() => { this.markers = []; });
    setOpacity = vi.fn();
  }
  class MassMarks {
    data: any[];
    options: any;
    handlers = eventTarget();
    constructor(data: any[], options: any) { this.data = data; this.options = options; massMarksInstances.push(this); }
    setMap = vi.fn();
    clear = vi.fn();
    setOpacity = vi.fn();
    on = this.handlers.on;
    off = this.handlers.off;
  }

  return {
    map,
    AMap: { Marker, Pixel, Size, LabelMarker, LabelsLayer, MassMarks },
    markerInstances,
    labelMarkerInstances,
    labelsLayerInstances,
    massMarksInstances,
    add,
    remove,
    panBy,
    setZoomAndCenter,
    setZoom(next: number) { zoom = next; },
    emitMap: mapEvents.emit,
  };
}

function building(id: string, submarket: string, lng: number, lat: number, rent: number, vacancy: number) {
  return {
    id,
    name: `项目${id}`,
    submarket,
    district: '朝阳区',
    grade: 'A',
    leed_certification: id === 'a' ? 'Gold' : '',
    location_lng: lng,
    location_lat: lat,
    metrics: [{
      id: `m-${id}`,
      building_id: id,
      record_year: 2026,
      record_quarter: 2,
      net_effective_rent: rent,
      vacancy_rate: vacancy,
      total_area: 100000,
      vacant_area: 100000 * vacancy,
    }],
  };
}

async function flushFrames(count = 3) {
  for (let index = 0; index < count; index += 1) {
    await new Promise<void>(resolve => window.setTimeout(resolve, 4));
  }
}

beforeEach(() => {
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => window.setTimeout(() => callback(performance.now()), 1) as unknown as number);
  vi.stubGlobal('cancelAnimationFrame', (id: number) => window.clearTimeout(id));
  document.body.innerHTML = '<div id="shell"><header></header><main><div id="map-container"></div></main></div>';
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  document.body.innerHTML = '';
});

describe('native map visual hierarchy', () => {
  it('shows both area bubbles in the overview, without counting or retaining a placeholder in filtered renders', async () => {
    const harness = createNativeHarness();
    const controller = {
      AMap: harness.AMap, map: harness.map,
      renderMarkers: vi.fn(), clearMarkers: vi.fn(),
    };
    const cleanup = installMapInteractionHardening(controller as never, 'map-container');
    const data = [building('yufu', '玉渊潭', 116.294204, 39.92354, 205.8, 0.31)];
    try {
      controller.renderMarkers(data, 'default', undefined, undefined, true);
      await flushFrames();
      const contents = harness.markerInstances.map(marker => marker.options.content as HTMLElement);
      const populated = contents.find(node => node.title === '玉渊潭');
      expect(populated?.textContent).toContain('¥206');
      const pending = contents.find(node => node.title === '四季青');
      expect(pending?.textContent).toContain('资料待补');
      expect(pending?.textContent).not.toMatch(/¥|%/);
      pending?.click();
      expect(harness.setZoomAndCenter).toHaveBeenCalledWith(12.15, [116.274193, 39.942414], false, 320);
      expect(harness.massMarksInstances[0].data).toHaveLength(1);

      const previousMarkers = harness.markerInstances.length;
      controller.renderMarkers(data, 'default', undefined, undefined, false);
      await flushFrames();
      const filtered = harness.markerInstances.slice(previousMarkers).map(marker => marker.options.content.title);
      expect(filtered).toEqual(['玉渊潭']);

      const beforeEmpty = harness.markerInstances.length;
      controller.renderMarkers([], 'default', undefined, undefined, true);
      await flushFrames();
      expect(harness.markerInstances.slice(beforeEmpty).map(marker => marker.options.content.title)).toEqual(['玉渊潭', '四季青']);
    } finally { cleanup(); }
  });


  it('clears legacy markers once and keeps only the submarket tier visible at overview zoom', async () => {
    const harness = createNativeHarness();
    const originalRender = vi.fn();
    const originalClear = vi.fn();
    const controller: any = {
      AMap: harness.AMap,
      map: harness.map,
      markers: [], dotMarkers: [], submarketMarkers: [], currentRenderMode: null,
      infoWindow: { close: vi.fn() },
      renderMarkers: originalRender,
      clearMarkers: originalClear,
      updateVisibilityByZoom() {},
      openBuildingInfoWindow: vi.fn(),
      showHoverTooltip: vi.fn(), hideHoverTooltip: vi.fn(), bounceMarker: vi.fn(), stopBounceMarker: vi.fn(),
    };

    const cleanup = installMapInteractionHardening(controller, 'map-container');
    expect(originalClear).toHaveBeenCalledTimes(1);

    const buildings = [
      building('a', 'CBD', 116.46, 39.91, 305, 0.08),
      building('b', 'CBD', 116.47, 39.92, 280, 0.12),
      building('c', '金融街', 116.36, 39.91, 320, 0.07),
      building('d', '望京', 116.48, 40.00, 180, 0.20),
    ];
    controller.renderMarkers(buildings, 'default', new Map(), undefined);
    await flushFrames();

    expect(originalRender).not.toHaveBeenCalled();
    expect(harness.markerInstances).toHaveLength(3);
    expect(harness.massMarksInstances).toHaveLength(1);
    expect(harness.labelsLayerInstances).toHaveLength(2);
    expect(harness.markerInstances.every(marker => marker.setOpacity.mock.lastCall?.[0] === 1)).toBe(true);
    expect(harness.massMarksInstances[0].setOpacity.mock.lastCall?.[0]).toBe(0);
    expect(harness.labelsLayerInstances[0].setOpacity.mock.lastCall?.[0]).toBe(0);
    expect(harness.labelsLayerInstances[1].setOpacity.mock.lastCall?.[0]).toBe(0);
    expect(document.getElementById('map-container')?.dataset.markerTier).toBe('submarket');

    cleanup();
  });

  it('allows adjacent tiers to overlap only during zoom, then settles to one idle tier', async () => {
    const harness = createNativeHarness();
    const controller: any = {
      AMap: harness.AMap, map: harness.map,
      markers: [], dotMarkers: [], submarketMarkers: [],
      renderMarkers() {}, clearMarkers() {}, updateVisibilityByZoom() {},
      openBuildingInfoWindow: vi.fn(), showHoverTooltip: vi.fn(), hideHoverTooltip: vi.fn(),
    };
    const cleanup = installMapInteractionHardening(controller, 'map-container');
    controller.renderMarkers([building('a', 'CBD', 116.46, 39.91, 305, 0.08)], 'default');
    await flushFrames();

    harness.emitMap('zoomstart');
    harness.setZoom(11.54);
    harness.emitMap('zoomchange');
    const subDuring = harness.markerInstances[0].setOpacity.mock.lastCall?.[0] as number;
    const dotDuring = harness.massMarksInstances[0].setOpacity.mock.lastCall?.[0] as number;
    expect(subDuring).toBeGreaterThan(0);
    expect(dotDuring).toBeGreaterThan(0);

    harness.setZoom(11.7);
    harness.emitMap('zoomend');
    expect(harness.markerInstances[0].setOpacity.mock.lastCall?.[0]).toBe(0);
    expect(harness.massMarksInstances[0].setOpacity.mock.lastCall?.[0]).toBe(0.9);
    expect(harness.labelsLayerInstances[0].setOpacity.mock.lastCall?.[0]).toBe(0);
    expect(document.getElementById('map-container')?.dataset.markerTier).toBe('dot');

    harness.emitMap('zoomstart');
    harness.setZoom(13.16);
    harness.emitMap('zoomchange');
    expect(harness.massMarksInstances[0].setOpacity.mock.lastCall?.[0]).toBeGreaterThan(0);
    expect(harness.labelsLayerInstances[0].setOpacity.mock.lastCall?.[0]).toBeGreaterThan(0);

    harness.setZoom(13.35);
    harness.emitMap('zoomend');
    expect(harness.massMarksInstances[0].setOpacity.mock.lastCall?.[0]).toBe(0);
    expect(harness.labelsLayerInstances[0].setOpacity.mock.lastCall?.[0]).toBe(1);
    expect(document.getElementById('map-container')?.dataset.markerTier).toBe('building');

    cleanup();
  });

  it('hides future-supply markers at overview zoom and restores them from the dot tier onward', async () => {
    const harness = createNativeHarness();
    const renderFuture = vi.fn();
    const clearFuture = vi.fn();
    const controller: any = {
      AMap: harness.AMap, map: harness.map,
      markers: [], dotMarkers: [], submarketMarkers: [],
      renderMarkers() {}, clearMarkers() {}, updateVisibilityByZoom() {},
      renderFutureMarkers: renderFuture, clearFutureMarkers: clearFuture,
      openBuildingInfoWindow: vi.fn(), showHoverTooltip: vi.fn(), hideHoverTooltip: vi.fn(),
    };
    const cleanup = installMapInteractionHardening(controller, 'map-container');
    controller.renderMarkers([building('a', 'CBD', 116.46, 39.91, 305, 0.08)], 'default');
    await flushFrames();

    controller.renderFutureMarkers([{ id: 'future-a' }], 'default');
    expect(renderFuture).not.toHaveBeenCalled();
    expect(clearFuture).toHaveBeenCalled();

    harness.setZoom(11.8);
    harness.emitMap('zoomend');
    expect(renderFuture).toHaveBeenCalledWith([{ id: 'future-a' }], 'default');

    cleanup();
  });

  it('deduplicates identical renders and swaps data without exposing two visual tiers', async () => {
    const harness = createNativeHarness();
    const controller: any = {
      AMap: harness.AMap, map: harness.map,
      markers: [], dotMarkers: [], submarketMarkers: [],
      renderMarkers() {}, clearMarkers() {}, updateVisibilityByZoom() {},
      openBuildingInfoWindow: vi.fn(), showHoverTooltip: vi.fn(), hideHoverTooltip: vi.fn(),
    };
    const cleanup = installMapInteractionHardening(controller, 'map-container');
    const a = building('a', 'CBD', 116.46, 39.91, 305, 0.08);
    const b = building('b', '金融街', 116.36, 39.91, 320, 0.07);

    controller.renderMarkers([a, b], 'default', new Map(), undefined);
    await flushFrames();
    expect(harness.massMarksInstances).toHaveLength(1);

    controller.renderMarkers([a, b], 'default', new Map(), undefined);
    await flushFrames();
    expect(harness.massMarksInstances).toHaveLength(1);

    controller.renderMarkers([a, b], 'rent', new Map(), undefined);
    await flushFrames();
    expect(harness.massMarksInstances).toHaveLength(2);
    expect(document.getElementById('map-container')?.classList.contains('map-marker-swapping')).toBe(true);
    expect(harness.massMarksInstances[1].setOpacity.mock.lastCall?.[0]).toBe(0);
    expect(harness.markerInstances.slice(-2).every(marker => marker.setOpacity.mock.lastCall?.[0] === 1)).toBe(true);

    cleanup();
  });

  it('keeps click navigation coherent from submarket to dot to detail', async () => {
    const harness = createNativeHarness();
    const open = vi.fn();
    const controller: any = {
      AMap: harness.AMap, map: harness.map,
      markers: [], dotMarkers: [], submarketMarkers: [],
      renderMarkers() {}, clearMarkers() {}, updateVisibilityByZoom() {},
      openBuildingInfoWindow: open, showHoverTooltip: vi.fn(), hideHoverTooltip: vi.fn(),
    };
    const cleanup = installMapInteractionHardening(controller, 'map-container');
    controller.renderMarkers([building('a', 'CBD', 116.46, 39.91, 305, 0.08)], 'default');
    await flushFrames();

    harness.markerInstances[0].handlers.emit('click');
    expect(harness.setZoomAndCenter).toHaveBeenCalledWith(12.15, [116.46, 39.91], false, 320);

    harness.setZoom(11.8);
    harness.emitMap('zoomend');
    harness.massMarksInstances[0].handlers.emit('click', { data: harness.massMarksInstances[0].data[0] });
    expect(document.getElementById('map-container')?.dataset.selectedBuilding).toBe('a');
    expect(harness.setZoomAndCenter).toHaveBeenLastCalledWith(14, [116.46, 39.91], false, 320);

    cleanup();
  });
});
