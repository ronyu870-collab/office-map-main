// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { installMapInteractionHardening } from '../mapInteractionHardening';
import { installNativeMarkerRenderer } from '../mapNativeMarkerRenderer';

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
    remove = vi.fn((markers: any[] | any) => {
      const removed = Array.isArray(markers) ? markers : [markers];
      this.markers = this.markers.filter(marker => !removed.includes(marker));
    });
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
  it('shows the supplied rent for the two designated areas and keeps metrics for other markets', async () => {
    const harness = createNativeHarness();
    const controller = {
      AMap: harness.AMap, map: harness.map,
      renderMarkers: vi.fn(), clearMarkers: vi.fn(),
    };
    const cleanup = installMapInteractionHardening(controller as never, 'map-container');
    const data = [
      building('yufu', '玉渊潭', 116.294204, 39.92354, 205.8, 0.31),
      building('other', 'CBD', 116.46, 39.91, 305, 0.08),
    ];
    try {
      controller.renderMarkers(data, 'default', undefined, undefined, true);
      await flushFrames();
      const contents = harness.markerInstances.map(marker => marker.options.content as HTMLElement);
      const populated = contents.find(node => node.title === '玉渊潭');
      // The supplied rent replaces the weighted average and carries no vacancy.
      expect(populated?.textContent).toBe('玉渊潭¥150');
      expect(populated?.querySelector('.map-submarket-bubble__secondary')).toBeNull();
      expect(contents.find(node => node.title === 'CBD')?.textContent).toContain('¥305');
      const pending = contents.find(node => node.title === '四季青');
      expect(pending?.textContent).toBe('四季青¥140');
      expect(pending?.querySelector('.map-submarket-bubble__metrics')).not.toBeNull();
      pending?.click();
      expect(harness.setZoomAndCenter).toHaveBeenCalledWith(12.15, [116.274193, 39.942414], false, 320);
      expect(harness.massMarksInstances[0].data).toHaveLength(2);

      const previousMarkers = harness.markerInstances.length;
      controller.renderMarkers(data, 'default', undefined, undefined, false);
      await flushFrames();
      const filtered = harness.markerInstances.slice(previousMarkers).map(marker => marker.options.content.title);
      expect(filtered).toEqual(['玉渊潭', 'CBD']);

      const beforeEmpty = harness.markerInstances.length;
      controller.renderMarkers([], 'default', undefined, undefined, true);
      await flushFrames();
      expect(harness.markerInstances.slice(beforeEmpty).map(marker => marker.options.content.textContent)).toEqual(['玉渊潭¥150', '四季青¥140']);
    } finally { cleanup(); }
  });

  it('falls back to names only for the two designated areas in vacancy and LEED views', async () => {
    const harness = createNativeHarness();
    const controller = {
      AMap: harness.AMap, map: harness.map,
      renderMarkers: vi.fn(), clearMarkers: vi.fn(),
    };
    const cleanup = installMapInteractionHardening(controller as never, 'map-container');
    const data = [building('yufu', '玉渊潭', 116.294204, 39.92354, 205.8, 0.31)];
    try {
      for (const mode of ['vacancy', 'leed'] as const) {
        const previous = harness.markerInstances.length;
        controller.renderMarkers(data, mode, undefined, undefined, true);
        await flushFrames();
        const contents = harness.markerInstances.slice(previous).map(marker => marker.options.content as HTMLElement);
        const yuyuantan = contents.find(node => node.title === '玉渊潭');
        expect(yuyuantan?.textContent).toBe('玉渊潭');
        expect(yuyuantan?.querySelector('.map-submarket-bubble__metrics')).toBeNull();
        const sijiqing = contents.find(node => node.title === '四季青');
        expect(sijiqing?.textContent).toBe('四季青');
        expect(sijiqing?.querySelector('.map-submarket-bubble__metrics')).toBeNull();
      }
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

  it('shares stock collision layer with F and restores future supply after zoom and filter changes', async () => {
    const harness = createNativeHarness();
    const controller: any = {
      AMap: harness.AMap, map: harness.map,
      markers: [], dotMarkers: [], submarketMarkers: [],
      renderMarkers: vi.fn(), clearMarkers: vi.fn(), updateVisibilityByZoom: vi.fn(),
      renderFutureMarkers: vi.fn(), clearFutureMarkers: vi.fn(),
      openBuildingInfoWindow: vi.fn(), showHoverTooltip: vi.fn(), hideHoverTooltip: vi.fn(),
      showFutureSupplyHoverTooltip: vi.fn(), openFutureSupplyInfoWindow: vi.fn(),
    };
    const first = { id: 'future-a', location_lng: 116.4601, location_lat: 39.9101 };
    const second = { id: 'future-b', location_lng: 116.46, location_lat: 39.91 };
    const cleanup = installMapInteractionHardening(controller, 'map-container');
    const getF = () => harness.labelsLayerInstances[0]?.markers.filter(
      (marker: any) => String(marker.options.name).startsWith('future:'),
    ) ?? [];
    try {
      controller.renderFutureMarkers([first, second], 'default');
      controller.renderMarkers([building('a', 'CBD', 116.46, 39.91, 305, 0.08)], 'default');
      await flushFrames();
      const detailLayer = harness.labelsLayerInstances[0];
      expect(detailLayer.options).toMatchObject({ collision: true, allowCollision: false });
      expect(getF()).toHaveLength(0);
      expect(detailLayer.markers.some((marker: any) => marker.options.name === 'a')).toBe(true);

      harness.setZoom(14);
      harness.emitMap('zoomend');
      expect(getF()).toHaveLength(2);
      expect(detailLayer.markers.some((marker: any) => marker.options.name === 'a')).toBe(true);
      expect(getF().every((marker: any) => marker.options.rank > 2999)).toBe(true);
      const svg = decodeURIComponent(getF()[0].options.icon.image.split(',')[1]);
      expect(svg).toContain('fill="#10b981"');
      expect(svg).toContain('stroke-dasharray="3 2"');
      expect(svg).toContain('>F</text>');
      expect(getF()[0].options.icon.size).toEqual([34, 34]);
      getF()[0].handlers.emit('mouseover', { originEvent: { clientX: 71, clientY: 85 } });
      expect(controller.showFutureSupplyHoverTooltip).toHaveBeenCalledWith(first, 71, 85);
      getF()[0].handlers.emit('click');
      expect(controller.openFutureSupplyInfoWindow).toHaveBeenCalledWith(first);

      harness.setZoom(11.8);
      harness.emitMap('zoomend');
      expect(getF()).toHaveLength(0);
      harness.setZoom(14);
      harness.emitMap('zoomend');
      expect(getF()).toHaveLength(2);

      controller.renderFutureMarkers([second], 'default');
      expect(getF()).toHaveLength(1);
      expect(getF()[0].options.name).toContain('future-b');
      controller.renderFutureMarkers([second], 'rent');
      const rentSvg = decodeURIComponent(getF()[0].options.icon.image.split(',')[1]);
      expect(rentSvg).toContain('fill="#94a3b8"');
      expect(rentSvg).not.toContain('stroke-dasharray');
      controller.clearFutureMarkers();
      expect(getF()).toHaveLength(0);
      harness.setZoom(11.8);
      harness.emitMap('zoomend');
      harness.setZoom(14);
      harness.emitMap('zoomend');
      expect(getF()).toHaveLength(0);
    } finally { cleanup(); }
  });

  it('ranks BP below A/P and above B at the same location in V3 and fallback renderers', async () => {
    for (const version of ['v3', 'fallback'] as const) {
      const harness = createNativeHarness();
      const controller: any = {
        AMap: harness.AMap, map: harness.map,
        markers: [], dotMarkers: [], submarketMarkers: [],
        renderMarkers: vi.fn(), clearMarkers: vi.fn(), updateVisibilityByZoom: vi.fn(),
      };
      const cleanup = version === 'v3'
        ? installMapInteractionHardening(controller, 'map-container')
        : installNativeMarkerRenderer(controller, document.getElementById('map-container')!);
      const atSameLocation = (id: string, grade: string) => ({
        ...building(id, 'CBD', 116.46, 39.91, 200, 0.1),
        grade,
      });
      try {
        controller.renderMarkers([
          atSameLocation('grade-a', 'A'),
          atSameLocation('grade-p', 'P'),
          atSameLocation('grade-bp', 'BP'),
          atSameLocation('grade-b', 'B'),
        ], 'default');
        await flushFrames(4);
        const ranks = new Map<string, number>(
          harness.labelMarkerInstances
            .filter(marker => Boolean(marker.options.icon))
            .map(marker => [marker.options.name as string, marker.options.rank as number]),
        );
        expect(ranks.get('grade-a')).toBe(2100);
        expect(ranks.get('grade-p')).toBe(2100);
        expect(ranks.get('grade-bp')).toBe(1300);
        expect(ranks.get('grade-b')).toBe(800);
        expect(ranks.get('grade-bp')).toBeLessThan(ranks.get('grade-a')!);
        expect(ranks.get('grade-bp')).toBeGreaterThan(ranks.get('grade-b')!);
      } finally {
        cleanup?.();
      }
    }
  });

  it('shares the same hover tooltip between a round building icon and its right-hand name', async () => {
    const harness = createNativeHarness();
    harness.setZoom(14.4);
    const controller: any = {
      AMap: harness.AMap, map: harness.map,
      markers: [], dotMarkers: [], submarketMarkers: [],
      renderMarkers: vi.fn(), clearMarkers: vi.fn(), updateVisibilityByZoom: vi.fn(),
      showHoverTooltip: vi.fn(), hideHoverTooltip: vi.fn(),
      openBuildingInfoWindow: vi.fn(),
    };
    const cleanup = installMapInteractionHardening(controller, 'map-container');
    const item = building('hover-a', 'CBD', 116.46, 39.91, 305, 0.08);
    try {
      controller.renderMarkers([item], 'default');
      await flushFrames();
      controller.hideHoverTooltip.mockClear();
      const icon = harness.labelMarkerInstances.find(marker => marker.options.name === 'hover-a');
      const name = harness.labelMarkerInstances.find(marker => marker.options.name === 'hover-a:name');
      expect(icon).toBeDefined();
      expect(name).toBeDefined();
      icon.handlers.emit('mouseover', { originEvent: { clientX: 30, clientY: 40 } });
      expect(controller.showHoverTooltip).toHaveBeenLastCalledWith(item, 30, 40);
      icon.handlers.emit('mouseout');
      name.handlers.emit('mouseover', { originEvent: { clientX: 50, clientY: 60 } });
      expect(controller.showHoverTooltip).toHaveBeenLastCalledWith(item, 50, 60);
      await new Promise(resolve => window.setTimeout(resolve, 100));
      expect(controller.hideHoverTooltip).not.toHaveBeenCalled();
      name.handlers.emit('mouseout');
      await new Promise(resolve => window.setTimeout(resolve, 100));
      expect(controller.hideHoverTooltip).toHaveBeenCalledTimes(1);
      name.handlers.emit('click');
      expect(controller.openBuildingInfoWindow).toHaveBeenCalledWith('hover-a');
      name.handlers.emit('mouseover', { originEvent: { clientX: 60, clientY: 70 } });
      harness.emitMap('zoomstart');
      expect(controller.hideHoverTooltip).toHaveBeenCalledTimes(2);
    } finally { cleanup(); }
  });

  it('forgets future supply after clear and never resurrects it on zoom (V3/fallback)', async () => {
    for (const version of ['v3', 'fallback'] as const) {
      const harness = createNativeHarness();
      harness.setZoom(14);
      const renderFuture = vi.fn();
      const clearFuture = vi.fn();
      const controller: any = {
        AMap: harness.AMap, map: harness.map,
        markers: [], dotMarkers: [], submarketMarkers: [],
        renderMarkers: vi.fn(), clearMarkers: vi.fn(), updateVisibilityByZoom: vi.fn(),
        renderFutureMarkers: renderFuture, clearFutureMarkers: clearFuture,
      };
      const cleanup = version === 'v3'
        ? installMapInteractionHardening(controller, 'map-container')
        : installNativeMarkerRenderer(controller, document.getElementById('map-container')!);
      const supply = [{ id: 'future-project', location_lng: 116.46, location_lat: 39.91 }];
      const getF = () => harness.labelsLayerInstances[0]?.markers.filter(
        (marker: any) => String(marker.options.name).startsWith('future:'),
      ) ?? [];
      try {
        if (version === 'v3') {
          controller.renderMarkers([building('a', 'CBD', 116.46, 39.91, 305, 0.08)]);
          await flushFrames();
        }
        controller.renderFutureMarkers(supply, 'default');
        expect(renderFuture).toHaveBeenCalledTimes(version === 'v3' ? 0 : 1);
        if (version === 'v3') expect(getF()).toHaveLength(1);

        controller.clearFutureMarkers();
        expect(clearFuture).toHaveBeenCalled();
        if (version === 'v3') expect(getF()).toHaveLength(0);
        harness.setZoom(11.8);
        harness.emitMap('zoomstart');
        harness.emitMap('zoomend');
        harness.setZoom(14);
        harness.emitMap('zoomstart');
        harness.emitMap('zoomend');
        await flushFrames();
        expect(renderFuture).toHaveBeenCalledTimes(version === 'v3' ? 0 : 1);
        if (version === 'v3') expect(getF()).toHaveLength(0);

        controller.renderFutureMarkers(supply, 'default');
        expect(renderFuture).toHaveBeenCalledTimes(version === 'v3' ? 0 : 2);
        if (version === 'v3') expect(getF()).toHaveLength(1);
      } finally { cleanup?.(); }
    }
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
