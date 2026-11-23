// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { installMapVisualContinuityV2 } from '../mapVisualContinuityV2';
import { installMapInteractionHardening } from '../mapInteractionHardening';
import { installFallbackMarkerHardening, installNativeMarkerRenderer } from '../mapNativeMarkerRenderer';

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

it.each(['v3', 'v2', 'native'] as const)('%s excludes invalid coordinates from point layers while retaining legal distant projects', async version => {
  const harness = createNativeHarness(); harness.setZoom(14.4);
  const controller: any = { AMap: harness.AMap, map: harness.map, markers: [], dotMarkers: [], submarketMarkers: [],
    renderMarkers: vi.fn(), clearMarkers: vi.fn(), updateVisibilityByZoom: vi.fn(),
    renderFutureMarkers: vi.fn(), clearFutureMarkers: vi.fn(), setWorkspaceSelectionRenderer: vi.fn(), refreshWorkspaceSelection: vi.fn() };
  const cleanup = version === 'v3' ? installMapInteractionHardening(controller, 'map-container')
    : version === 'v2' ? installMapVisualContinuityV2(controller, document.getElementById('map-container')!)
    : installNativeMarkerRenderer(controller, document.getElementById('map-container')!);
  try {
    const items = [[116.4,39.9],[121.4,31.2],[0,0],[40,116],[181,39],[116,86]].map(([lng,lat],i) => building(String(i),'CBD',lng,lat,146,.15));
    controller.renderMarkers(items, 'default'); await flushFrames();
    const names = harness.labelMarkerInstances.filter(marker => marker.options.icon).map(marker => marker.options.name);
    expect(names.sort()).toEqual(['0','1']);
    const positions = harness.massMarksInstances.flatMap(layer => layer.data.map((point: any) => point.lnglat));
    expect(positions).not.toContainEqual([0,0]); expect(positions).not.toContainEqual([40,116]);
    if (version === 'v3') {
      controller.renderFutureMarkers(items.map(item => ({ ...item, id: `future-${item.id}` })), 'default'); await flushFrames();
      const future = harness.labelMarkerInstances.filter(marker => marker.options.name?.startsWith('future:'));
      expect(future.map(marker => marker.options.position)).toEqual([[116.4,39.9],[121.4,31.2]]);
    }
  } finally { cleanup?.(); }
});

it.each(['v3', 'v2', 'native'] as const)('%s does not label a missing LEED observation as explicitly uncertified', async version => {
  const harness = createNativeHarness(); harness.setZoom(14.4);
  const controller: any = { AMap: harness.AMap, map: harness.map, markers: [], dotMarkers: [], submarketMarkers: [],
    renderMarkers: vi.fn(), clearMarkers: vi.fn(), updateVisibilityByZoom: vi.fn(),
    renderFutureMarkers: vi.fn(), clearFutureMarkers: vi.fn(), setWorkspaceSelectionRenderer: vi.fn(), refreshWorkspaceSelection: vi.fn() };
  const cleanup = version === 'v3' ? installMapInteractionHardening(controller, 'map-container')
    : version === 'v2' ? installMapVisualContinuityV2(controller, document.getElementById('map-container')!)
    : installNativeMarkerRenderer(controller, document.getElementById('map-container')!);
  try {
    controller.renderMarkers([
      { ...building('missing','CBD',116.4,39.9,146,.15), leed_certification: '' },
      { ...building('negative','CBD',116.41,39.9,146,.15), leed_certification: '未认证' },
    ], 'leed'); await flushFrames();
    const icons = harness.labelMarkerInstances.filter(marker => marker.options.icon);
    const text = (id: string) => new DOMParser().parseFromString(decodeURIComponent(icons.find(marker => marker.options.name === id).options.icon.image.split(',')[1]),'image/svg+xml').querySelector('text')?.textContent;
    expect(text('missing')).toBe('–'); expect(text('negative')).toBe('N');
  } finally { cleanup?.(); }
});

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
      const populated = contents.find(node => node.title.startsWith('玉渊潭'));
      // Complete office observations retain weighted rent, vacant percentage and office count.
      expect(populated?.textContent).toContain('¥205.8');
      expect(populated?.textContent).toContain('31.0%');
      expect(populated?.textContent).toContain('甲乙级 1 个');
      expect(populated?.querySelector('.map-submarket-bubble__secondary')).not.toBeNull();
      expect(contents.find(node => node.title.startsWith('CBD'))?.textContent).toContain('¥305');
      const pending = contents.find(node => node.title.startsWith('四季青'));
      expect(pending?.textContent).toBe('四季青¥140*');
      expect(pending?.querySelector('.map-submarket-bubble__metrics')).not.toBeNull();
      const onAreaOpen = vi.fn();
      window.addEventListener('map-submarket-open', onAreaOpen);
      pending?.click();
      expect((onAreaOpen.mock.calls[0]?.[0] as CustomEvent)?.detail).toEqual({ name: '四季青' });
      expect(harness.setZoomAndCenter).not.toHaveBeenCalled();
      window.removeEventListener('map-submarket-open', onAreaOpen);
      expect(harness.massMarksInstances[0].data).toHaveLength(2);

      const previousMarkers = harness.markerInstances.length;
      controller.renderMarkers(data, 'default', undefined, undefined, false);
      await flushFrames();
      const filtered = harness.markerInstances.slice(previousMarkers).map(marker => marker.options.content.title);
      expect(filtered.map(name => name.split(' · ')[0])).toEqual(['玉渊潭', 'CBD']);

      const beforeEmpty = harness.markerInstances.length;
      controller.renderMarkers([], 'default', undefined, undefined, true);
      await flushFrames();
      expect(harness.markerInstances.slice(beforeEmpty).map(marker => marker.options.content.textContent)).toEqual(['玉渊潭¥150*', '四季青¥140*']);
    } finally { cleanup?.(); }
  });

  it('keeps A/B indicators where observed and names-only markers for unobserved areas', async () => {
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
        const yuyuantan = contents.find(node => node.title.startsWith('玉渊潭'));
        expect(yuyuantan?.textContent).toContain('甲乙级 1 个');
        expect(yuyuantan?.querySelector('.map-submarket-bubble__metrics')).not.toBeNull();
        const sijiqing = contents.find(node => node.title.startsWith('四季青'));
        expect(sijiqing?.textContent).toBe('四季青');
        expect(sijiqing?.querySelector('.map-submarket-bubble__metrics')).toBeNull();
      }
    } finally { cleanup?.(); }
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
      expect(svg).toContain('fill="#4f7968"');
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
    } finally { cleanup?.(); }
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

  it('keeps data badge text readable across metric, missing, LEED and light comparison states', async () => {
    const luminance = (hex: string) => {
      const rgb = hex.slice(1).match(/../g)!.map(value => {
        const channel = parseInt(value, 16) / 255;
        return channel <= .04045 ? channel / 12.92 : ((channel + .055) / 1.055) ** 2.4;
      });
      return rgb[0] * .2126 + rgb[1] * .7152 + rgb[2] * .0722;
    };
    const checkBadge = (image: string) => {
      const svg = new DOMParser().parseFromString(decodeURIComponent(image.split(',')[1]), 'image/svg+xml');
      const foreground = luminance(svg.querySelector('text')!.getAttribute('fill')!);
      const background = luminance(svg.querySelectorAll('circle')[1]?.getAttribute('fill') ?? svg.querySelector('circle')!.getAttribute('fill')!);
      expect((Math.max(foreground, background) + .05) / (Math.min(foreground, background) + .05)).toBeGreaterThanOrEqual(4.5);
    };
    for (const version of ['v3', 'v2', 'fallback'] as const) {
      const harness = createNativeHarness();
      harness.setZoom(14.4);
      const controller: any = {
        AMap: harness.AMap, map: harness.map,
        markers: [], dotMarkers: [], submarketMarkers: [],
        renderMarkers: vi.fn(), clearMarkers: vi.fn(), updateVisibilityByZoom: vi.fn(),
        renderFutureMarkers: vi.fn(), clearFutureMarkers: vi.fn(),
        setWorkspaceSelectionRenderer: vi.fn(), refreshWorkspaceSelection: vi.fn(),
      };
      const cleanup = version === 'v3'
        ? installMapInteractionHardening(controller, 'map-container')
        : version === 'v2' ? installMapVisualContinuityV2(controller, document.getElementById('map-container')!)
        : installNativeMarkerRenderer(controller, document.getElementById('map-container')!);
      try {
        const items = [building('a', 'CBD', 116.46, 39.91, 146, .15),
          { ...building('missing', 'CBD', 116.47, 39.91, 0, 0), grade: '', metrics: [] },
          { ...building('platinum', 'CBD', 116.48, 39.91, 310, .35), leed_certification: 'Platinum' },
          { ...building('silver', 'CBD', 116.49, 39.91, 210, .25), leed_certification: 'Silver' }];
        for (const mode of ['default', 'rent', 'vacancy', 'leed'] as const) {
          const start = harness.labelMarkerInstances.length;
          controller.renderMarkers(items, mode, new Map(), mode === 'default' ? [{ color: '#fef3c7' }] : undefined);
          if (version === 'v3') controller.renderFutureMarkers([{ id: 'future', location_lng: 116.48, location_lat: 39.91 },
            { id: 'future-gold', location_lng: 116.49, location_lat: 39.91, leed_certification: 'Gold' }], mode);
          await flushFrames();
          const icons = harness.labelMarkerInstances.slice(start).filter(marker => marker.options.icon);
          expect(icons.length).toBeGreaterThanOrEqual(2);
          icons.forEach(marker => checkBadge(marker.options.icon.image));
          const selectionImage = controller.setWorkspaceSelectionRenderer.mock.lastCall[0];
          const pinnedFuture = selectionImage({ _dataType: 'future' });
          checkBadge(pinnedFuture);
          expect(decodeURIComponent(pinnedFuture)).toContain(mode === 'default' ? '>F</text>' : '>–</text>');
          expect(controller.refreshWorkspaceSelection).toHaveBeenCalled();
          for (const { options } of harness.markerInstances) {
            const element = options.content as HTMLElement;
            if (!element?.classList.contains('map-submarket-bubble')) continue;
            const foreground = luminance(element.style.getPropertyValue('--sm-foreground') || '#ffffff');
            const background = luminance(element.style.getPropertyValue('--sm-accent') || '#245b78');
            expect((Math.max(foreground, background) + .05) / (Math.min(foreground, background) + .05)).toBeGreaterThanOrEqual(4.5);
          }
          if (version === 'v3' && mode === 'leed') {
            const stockGold = icons.find(marker => marker.options.name === 'a')!;
            const futureGold = icons.find(marker => marker.options.name.startsWith('future:future-gold:'))!;
            const fill = (image: string) => new DOMParser().parseFromString(decodeURIComponent(image.split(',')[1]), 'image/svg+xml').querySelector('text')!.getAttribute('fill');
            expect(fill(futureGold.options.icon.image)).toBe(fill(stockGold.options.icon.image));
          }
        }
      } finally { cleanup?.(); }
    }
  });

  it('bounds long map names while retaining the full project and click identity in every renderer', async () => {
    for (const version of ['v3', 'v2', 'fallback'] as const) {
      const harness = createNativeHarness();
      harness.setZoom(14.4);
      const controller: any = { AMap: harness.AMap, map: harness.map,
        markers: [], dotMarkers: [], submarketMarkers: [],
        renderMarkers: vi.fn(), clearMarkers: vi.fn(), updateVisibilityByZoom: vi.fn(), openBuildingInfoWindow: vi.fn() };
      const cleanup = version === 'v3' ? installMapInteractionHardening(controller, 'map-container')
        : version === 'v2' ? installMapVisualContinuityV2(controller, document.getElementById('map-container')!)
        : installNativeMarkerRenderer(controller, document.getElementById('map-container')!);
      const item = { ...building('long', 'CBD', 116.46, 39.91, 146, .15), name: '中关村楼·' + '超长项目名称及楼座信息'.repeat(6) };
      try {
        controller.renderMarkers([item], 'default');
        await flushFrames();
        const name = harness.labelMarkerInstances.find(marker => marker.options.name === 'long:name');
        expect(name.options.text.style.fold).toBe(false);
        expect(Array.from(name.options.text.content).length).toBeLessThanOrEqual(12);
        expect(name.options.text.content).toMatch(/…$/);
        name.handlers.emit('click');
        expect(controller.openBuildingInfoWindow).toHaveBeenCalledWith(item.id);
        expect(item.name).toContain('超长项目名称及楼座信息'.repeat(6));
      } finally { cleanup?.(); }
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
    } finally { cleanup?.(); }
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

  it('opens an area introduction first and leaves dot-to-building navigation working', async () => {
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

    const onAreaOpen = vi.fn();
    window.addEventListener('map-submarket-open', onAreaOpen);
    harness.markerInstances[0].handlers.emit('click');
    expect((onAreaOpen.mock.calls[0]?.[0] as CustomEvent)?.detail).toEqual({ name: 'CBD' });
    expect(harness.setZoomAndCenter).not.toHaveBeenCalled();
    window.removeEventListener('map-submarket-open', onAreaOpen);

    harness.setZoom(11.8);
    harness.emitMap('zoomend');
    harness.massMarksInstances[0].handlers.emit('click', { data: harness.massMarksInstances[0].data[0] });
    expect(open).toHaveBeenLastCalledWith('a');
    expect(harness.setZoomAndCenter).not.toHaveBeenCalled();

    cleanup();
  });
});

it('remounts replacement DOM markers after filtering within the same zoom tier', async () => {
  const add = vi.fn();
  const first = { show: vi.fn(), hide: vi.fn() };
  const second = { show: vi.fn(), hide: vi.fn() };
  const controller: any = { map: { getZoom: () => 15, add }, markers: [first], dotMarkers: [], submarketMarkers: [], updateVisibilityByZoom: vi.fn() };
  const cleanup = installFallbackMarkerHardening(controller, document.getElementById('map-container')!);
  controller.updateVisibilityByZoom();
  await flushFrames();
  expect(add).toHaveBeenLastCalledWith([first]);
  controller.markers = [second];
  controller.updateVisibilityByZoom();
  await flushFrames();
  expect(add).toHaveBeenLastCalledWith([second]);
  cleanup();
});
