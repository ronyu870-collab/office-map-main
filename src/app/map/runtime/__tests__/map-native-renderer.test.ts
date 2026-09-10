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

  return { map, AMap: { Marker, Pixel, Size, LabelMarker, LabelsLayer, MassMarks }, markerInstances, labelMarkerInstances, labelsLayerInstances, massMarksInstances, add, remove, panBy, setZoomAndCenter, emitMap: mapEvents.emit };
}

function building(id: string, submarket: string, lng: number, lat: number, rent: number, vacancy: number) {
  return {
    id, name: `项目${id}`, submarket, district: '朝阳区', grade: 'A', leed_certification: id === 'a' ? 'Gold' : '',
    location_lng: lng, location_lat: lat,
    metrics: [{ id: `m-${id}`, building_id: id, record_year: 2026, record_quarter: 2, net_effective_rent: rent, vacancy_rate: vacancy, total_area: 100000, vacant_area: 100000 * vacancy }],
  };
}

async function flushFrames(count = 3) {
  for (let index = 0; index < count; index += 1) await new Promise<void>(resolve => window.setTimeout(resolve, 4));
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

describe('native high-volume map renderer', () => {
  it('uses broad native layer ranges so opacity owns tier continuity', async () => {
    const harness = createNativeHarness();
    const originalRender = vi.fn();
    const originalClear = vi.fn();
    const controller: any = {
      AMap: harness.AMap, map: harness.map, markers: [], dotMarkers: [], submarketMarkers: [], currentRenderMode: null,
      infoWindow: { close: vi.fn() }, renderMarkers: originalRender, clearMarkers: originalClear, updateVisibilityByZoom() {},
      openBuildingInfoWindow: vi.fn(), showHoverTooltip: vi.fn(), hideHoverTooltip: vi.fn(), bounceMarker: vi.fn(), stopBounceMarker: vi.fn(),
    };
    const cleanup = installMapInteractionHardening(controller, 'map-container');
    const buildings = [building('a', 'CBD', 116.46, 39.91, 305, 0.08), building('b', 'CBD', 116.47, 39.92, 280, 0.12), building('c', '金融街', 116.36, 39.91, 320, 0.07), building('d', '望京', 116.48, 40.00, 180, 0.20)];

    controller.renderMarkers(buildings, 'default', new Map(), undefined);
    await flushFrames();

    expect(originalRender).not.toHaveBeenCalled();
    expect(harness.markerInstances).toHaveLength(3);
    expect(harness.markerInstances.every(marker => marker.options.zooms[1] === 20)).toBe(true);
    expect(harness.massMarksInstances).toHaveLength(1);
    expect(harness.massMarksInstances[0].data).toHaveLength(4);
    expect(harness.massMarksInstances[0].options.zooms).toEqual([10.4, 14]);
    expect(harness.labelsLayerInstances).toHaveLength(2);
    expect(harness.labelsLayerInstances.every(layer => layer.options.collision === true)).toBe(true);

    const detailMarkers = harness.labelMarkerInstances.filter(marker => marker.options.icon);
    const nameMarkers = harness.labelMarkerInstances.filter(marker => marker.options.text);
    expect(detailMarkers).toHaveLength(4);
    expect(nameMarkers).toHaveLength(4);
    expect(detailMarkers.every(marker => marker.options.zooms[0] === 12.2)).toBe(true);
    expect(detailMarkers.every(marker => marker.options.icon.size[0] === 36 && marker.options.icon.size[1] === 36)).toBe(true);
    expect(nameMarkers.every(marker => marker.options.zooms[0] === 13.55)).toBe(true);

    cleanup();
  });

  it('deduplicates identical renders and mounts a replacement before disposing the old layer', async () => {
    const harness = createNativeHarness();
    const controller: any = { AMap: harness.AMap, map: harness.map, markers: [], dotMarkers: [], submarketMarkers: [], renderMarkers() {}, clearMarkers() {}, updateVisibilityByZoom() {}, openBuildingInfoWindow: vi.fn(), showHoverTooltip: vi.fn(), hideHoverTooltip: vi.fn() };
    const cleanup = installMapInteractionHardening(controller, 'map-container');
    const a = building('a', 'CBD', 116.46, 39.91, 305, 0.08);
    const b = building('b', '金融街', 116.36, 39.91, 320, 0.07);

    controller.renderMarkers([a, b], 'default', new Map(), undefined);
    await flushFrames();
    expect(harness.massMarksInstances).toHaveLength(1);
    expect(harness.labelsLayerInstances).toHaveLength(2);

    controller.renderMarkers([a, b], 'default', new Map(), undefined);
    await flushFrames();
    expect(harness.massMarksInstances).toHaveLength(1);

    controller.renderMarkers([a, b], 'rent', new Map(), undefined);
    await flushFrames();
    expect(harness.massMarksInstances).toHaveLength(2);
    expect(harness.labelsLayerInstances).toHaveLength(4);
    expect(document.getElementById('map-container')?.classList.contains('map-marker-swapping')).toBe(true);

    cleanup();
  });

  it('gives a clicked submarket an outgoing state while zooming progressively', async () => {
    const harness = createNativeHarness();
    const controller: any = { AMap: harness.AMap, map: harness.map, markers: [], dotMarkers: [], submarketMarkers: [], renderMarkers() {}, clearMarkers() {}, updateVisibilityByZoom() {}, openBuildingInfoWindow: vi.fn(), showHoverTooltip: vi.fn(), hideHoverTooltip: vi.fn() };
    const cleanup = installMapInteractionHardening(controller, 'map-container');
    controller.renderMarkers([building('a', 'CBD', 116.46, 39.91, 305, 0.08)], 'default');
    await flushFrames();

    harness.markerInstances[0].handlers.emit('click');
    expect(harness.setZoomAndCenter).toHaveBeenCalledWith(12.15, [116.46, 39.91], false, 340);
    expect((harness.markerInstances[0].options.content as HTMLElement).classList.contains('is-expanding')).toBe(true);

    cleanup();
  });

  it('keeps a selected marker visible while a dot click zooms toward detail view', async () => {
    const harness = createNativeHarness();
    const open = vi.fn();
    const controller: any = { AMap: harness.AMap, map: harness.map, markers: [], dotMarkers: [], submarketMarkers: [], renderMarkers() {}, clearMarkers() {}, updateVisibilityByZoom() {}, openBuildingInfoWindow: open, showHoverTooltip: vi.fn(), hideHoverTooltip: vi.fn() };
    const cleanup = installMapInteractionHardening(controller, 'map-container');
    controller.renderMarkers([building('a', 'CBD', 116.46, 39.91, 305, 0.08)], 'default');
    await flushFrames();

    harness.massMarksInstances[0].handlers.emit('click', { data: harness.massMarksInstances[0].data[0] });
    expect(document.getElementById('map-container')?.dataset.selectedBuilding).toBe('a');
    expect(harness.setZoomAndCenter).toHaveBeenCalledWith(14, [116.46, 39.91], false, 340);

    cleanup();
  });
});
