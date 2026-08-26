// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { installMapInteractionHardening } from '../mapInteractionHardening';

type HandlerMap = Map<string, Set<() => void>>;

function createMapHarness(initialZoom = 11) {
  let zoom = initialZoom;
  const handlers: HandlerMap = new Map();
  const add = vi.fn();
  const remove = vi.fn();
  const panBy = vi.fn();

  const map = {
    add,
    remove,
    panBy,
    getZoom: () => zoom,
    on: (eventName: string, handler: () => void) => {
      if (!handlers.has(eventName)) handlers.set(eventName, new Set());
      handlers.get(eventName)!.add(handler);
    },
    off: (eventName: string, handler: () => void) => {
      handlers.get(eventName)?.delete(handler);
    },
  };

  return {
    map,
    add,
    remove,
    panBy,
    setZoom(next: number) { zoom = next; },
    emit(eventName: string) {
      for (const handler of handlers.get(eventName) ?? []) handler();
    },
  };
}

function marker() {
  return { show: vi.fn(), hide: vi.fn() };
}

function flushFrames() {
  return new Promise<void>(resolve => window.setTimeout(resolve, 0));
}

beforeEach(() => {
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    callback(0);
    return 1;
  });
  vi.stubGlobal('cancelAnimationFrame', vi.fn());
  document.body.innerHTML = `
    <div id="shell">
      <header id="header"></header>
      <main id="main">
        <div id="map-container"></div>
      </main>
    </div>
  `;
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  document.body.innerHTML = '';
});

describe('map interaction hardening', () => {
  it('reuses already-mounted fallback tiers on repeated zoom transitions', async () => {
    const harness = createMapHarness(11);

    const controller: any = {
      map: harness.map,
      markers: [],
      dotMarkers: [],
      submarketMarkers: [],
      currentRenderMode: null,
      infoWindow: { close: vi.fn() },
      updateVisibilityByZoom() {},
      clearMarkers() {
        harness.remove(this.markers);
        harness.remove(this.dotMarkers);
        harness.remove(this.submarketMarkers);
        this.markers = [];
        this.dotMarkers = [];
        this.submarketMarkers = [];
      },
      renderMarkers() {
        this.clearMarkers();
        this.markers = [marker(), marker()];
        this.dotMarkers = [marker(), marker()];
        this.submarketMarkers = [marker()];
        this.currentRenderMode = null;
        this.updateVisibilityByZoom();
      },
    };

    const cleanup = installMapInteractionHardening(controller, 'map-container');
    controller.renderMarkers([{ id: 'a' }, { id: 'b' }], 'default', new Map(), undefined);
    await flushFrames();
    expect(harness.add).toHaveBeenCalledTimes(1);
    expect(harness.add.mock.calls[0]?.[0]).toBe(controller.submarketMarkers);

    harness.setZoom(12);
    harness.emit('zoomend');
    await flushFrames();
    expect(harness.add).toHaveBeenCalledTimes(2);
    expect(harness.add.mock.calls[1]?.[0]).toBe(controller.dotMarkers);

    harness.setZoom(14);
    harness.emit('zoomend');
    await flushFrames();
    expect(harness.add).toHaveBeenCalledTimes(3);
    expect(harness.add.mock.calls[2]?.[0]).toBe(controller.markers);

    harness.setZoom(11);
    harness.emit('zoomend');
    await flushFrames();
    expect(harness.add).toHaveBeenCalledTimes(3);
    expect(controller.submarketMarkers[0].show).toHaveBeenCalled();
    expect(controller.markers[0].hide).toHaveBeenCalled();

    cleanup();
  });

  it('pans the map downward when an InfoWindow overlaps the workbench top safe area', async () => {
    const harness = createMapHarness(14);
    const header = document.getElementById('header') as HTMLElement;
    const main = document.getElementById('main') as HTMLElement;
    const container = document.getElementById('map-container') as HTMLElement;

    header.getBoundingClientRect = () => ({
      x: 0, y: 0, left: 0, top: 0, right: 1280, bottom: 58,
      width: 1280, height: 58, toJSON() {},
    } as DOMRect);
    main.getBoundingClientRect = () => ({
      x: 0, y: 58, left: 0, top: 58, right: 1280, bottom: 800,
      width: 1280, height: 742, toJSON() {},
    } as DOMRect);
    container.getBoundingClientRect = main.getBoundingClientRect;

    const toolbar = document.createElement('div');
    toolbar.style.position = 'absolute';
    toolbar.style.zIndex = '330';
    toolbar.getBoundingClientRect = () => ({
      x: 12, y: 70, left: 12, top: 70, right: 1268, bottom: 112,
      width: 1256, height: 42, toJSON() {},
    } as DOMRect);
    main.appendChild(toolbar);

    const controller: any = {
      map: harness.map,
      markers: [],
      dotMarkers: [],
      submarketMarkers: [],
      updateVisibilityByZoom() {},
      renderMarkers() {},
      clearMarkers() {},
    };

    const cleanup = installMapInteractionHardening(controller, 'map-container');

    const info = document.createElement('div');
    info.className = 'amap-info';
    info.getBoundingClientRect = () => ({
      x: 400, y: 78, left: 400, top: 78, right: 720, bottom: 258,
      width: 320, height: 180, toJSON() {},
    } as DOMRect);
    container.appendChild(info);

    await flushFrames();
    await flushFrames();

    expect(harness.panBy).toHaveBeenCalled();
    const [, deltaY] = harness.panBy.mock.calls[0]!;
    expect(deltaY).toBeGreaterThan(0);

    cleanup();
  });

  it('rechecks InfoWindow geometry after its content grows', async () => {
    if (typeof ResizeObserver === 'undefined') return;
    const harness = createMapHarness(14);
    const main = document.getElementById('main') as HTMLElement;
    const container = document.getElementById('map-container') as HTMLElement;
    main.getBoundingClientRect = () => ({
      x: 0, y: 58, left: 0, top: 58, right: 1280, bottom: 800,
      width: 1280, height: 742, toJSON() {},
    } as DOMRect);
    container.getBoundingClientRect = main.getBoundingClientRect;

    const controller: any = {
      map: harness.map,
      markers: [], dotMarkers: [], submarketMarkers: [],
      updateVisibilityByZoom() {}, renderMarkers() {}, clearMarkers() {},
    };
    const cleanup = installMapInteractionHardening(controller, 'map-container');
    const info = document.createElement('div');
    info.className = 'amap-info';
    info.getBoundingClientRect = () => ({
      x: 400, y: 600, left: 400, top: 600, right: 720, bottom: 850,
      width: 320, height: 250, toJSON() {},
    } as DOMRect);
    container.appendChild(info);
    await flushFrames();
    await flushFrames();
    expect(harness.panBy).toHaveBeenCalled();
    cleanup();
  });
});
