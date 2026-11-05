import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../supabaseClient', () => ({ supabase: {} }));
vi.mock('../Auth', () => ({ getSessionFast: vi.fn() }));

import { MapController, type RenderMode } from '../MapController';

const workbenchCss = readFileSync(resolve(process.cwd(), 'src/app/map/map-workbench.css'), 'utf8');

function supply(overrides: Record<string, unknown> = {}) {
  return {
    id: 'future-project',
    name: '测试未来项目',
    type: '办公',
    location_lng: 116.46,
    location_lat: 39.91,
    launch_year: 2027,
    launch_quarter: 'Q3',
    ...overrides,
  };
}

function createHarness() {
  const host = document.createElement('div');
  host.id = 'map-container';
  host.dataset.markerTier = 'building';
  document.body.append(host);
  const created: Marker[] = [];

  class Marker {
    element: HTMLElement;
    wrapper = document.createElement('div');
    handlers = new Map<string, (event?: unknown) => void>();

    constructor(public options: { content: string | HTMLElement; position: [number, number] }) {
      this.wrapper.className = 'amap-marker';
      if (typeof options.content === 'string') {
        this.wrapper.innerHTML = options.content;
        this.element = this.wrapper.firstElementChild as HTMLElement;
      } else {
        this.element = options.content;
        this.wrapper.append(this.element);
      }
      // The SDK owns pointer clicks on custom content. Keyboard activation
      // must not dispatch another native click into this same SDK path.
      this.wrapper.addEventListener('click', (event) => this.emit('click', { originEvent: event }));
      created.push(this);
    }

    on(name: string, callback: (event?: unknown) => void) { this.handlers.set(name, callback); }
    emit(name: string, event?: unknown) { this.handlers.get(name)?.(event); }
  }

  class Pixel { constructor(public x: number, public y: number) {} }
  const map = {
    add: vi.fn((markers: Marker[]) => markers.forEach((marker) => host.append(marker.wrapper))),
    remove: vi.fn((markers: Marker[]) => markers.forEach((marker) => marker.wrapper.remove())),
  };
  const controller = Object.create(MapController.prototype);
  Object.assign(controller, {
    AMap: { Marker, Pixel },
    map,
    _destroyed: false,
    futureMarkers: [],
    hoverTimeout: null,
    openFutureSupplyInfoWindow: vi.fn(),
    showFutureSupplyHoverTooltip: vi.fn(),
    hideHoverTooltip: vi.fn(),
  });
  return { controller, host, map, created };
}

let stylesheet: HTMLStyleElement;
beforeEach(() => {
  stylesheet = document.createElement('style');
  stylesheet.textContent = workbenchCss;
  document.head.append(stylesheet);
});

afterEach(() => {
  stylesheet.remove();
  vi.useRealTimers();
});

describe('future supply markers through MapController', () => {
  it.each<RenderMode>(['default', 'rent', 'vacancy', 'leed'])(
    'keeps future identity and expected time in %s mode, including without operating metrics',
    (mode) => {
      const { controller, host, created } = createHarness();
      controller.renderFutureMarkers([supply()], mode);

      const marker = host.querySelector('button');
      expect(marker).toHaveAccessibleName('查看测试未来项目，未来供应，预计 2027 Q3');
      expect(marker?.textContent).toContain('预计 2027 Q3');
      expect(marker?.textContent).not.toBe('-');
      const core = marker!.querySelector<HTMLElement>('.map-future-marker__core')!;
      expect(getComputedStyle(core).borderTopStyle).toBe('dashed');
      expect(getComputedStyle(core).borderRadius).not.toBe('50%');
      expect(created[0].options.position).toEqual([116.46, 39.91]);
    },
  );

  it('keeps LEED certification inside the future outline', () => {
    const { controller, host } = createHarness();
    controller.renderFutureMarkers([supply({ leed_certification: 'Gold' })], 'leed');
    const core = host.querySelector<HTMLElement>('.map-future-marker__core')!;
    expect(core.textContent).toBe('G');
    expect(getComputedStyle(core).borderTopStyle).toBe('dashed');
    expect(host.querySelector('button')).toHaveAccessibleName(/未来供应.*2027 Q3/);
  });

  it('uses the existing map tier to reveal time without expanding the compact middle tier', () => {
    const { controller, host } = createHarness();
    controller.renderFutureMarkers([supply()]);
    const label = host.querySelector<HTMLElement>('.map-future-marker__time')!;
    host.dataset.markerTier = 'dot';
    expect(getComputedStyle(label).display).toBe('none');
    host.dataset.markerTier = 'building';
    expect(getComputedStyle(label).display).not.toBe('none');
  });

  it.each([
    [{ launch_quarter: 'H1' }, '预计 2027 H1'],
    [{ launch_quarter: 'H2' }, '预计 2027 H2'],
    [{ launch_quarter: 'Q6' }, '预计 2027年'],
    [{ launch_quarter: null }, '预计 2027年'],
    [{ launch_year: null }, '时间待定'],
    [{ launch_year: 'unknown' }, '时间待定'],
    [{ launch_year: 2200 }, '时间待定'],
    [{ launch_year: 2027.5 }, '时间待定'],
    [{ status: 'pending' }, '待核实'],
  ])('preserves date precision and uncertainty for %j', (fields, expected) => {
    const { controller, host } = createHarness();
    controller.renderFutureMarkers([supply(fields)]);
    expect(host.querySelector('.map-future-marker__time')?.textContent).toBe(expected);
    if (expected === '待核实') {
      expect(host.querySelector('button')).toHaveAccessibleName('查看测试未来项目，待核实项目');
      expect(host.textContent).not.toContain('2027');
    }
  });

  it('treats project metadata and invalid date suffixes as text rather than executable markup', () => {
    const { controller, host } = createHarness();
    const name = '<img src=x onerror="alert(1)">项目';
    const id = 'future" onclick="alert(1)';
    controller.renderFutureMarkers([supply({ name, id, launch_quarter: 'Q3<script>alert(1)</script>' })]);

    const marker = host.querySelector('button')!;
    expect(marker.dataset.futureSupplyId).toBe(id);
    expect(marker.getAttribute('aria-label')).toContain(name);
    expect(host.querySelector('.map-future-marker__time')?.textContent).toBe('预计 2027年');
    expect(host.querySelector('script, img, [onclick], [onerror], [onmouseover], [onmouseout]')).toBeNull();
  });

  it('opens the same project once for pointer, Enter, and Space activation', async () => {
    const user = userEvent.setup();
    const { controller, host } = createHarness();
    const project = supply();
    controller.renderFutureMarkers([project]);
    const marker = host.querySelector('button')!;

    await user.click(marker);
    expect(controller.openFutureSupplyInfoWindow).toHaveBeenCalledTimes(1);
    await user.keyboard('{Enter}');
    expect(controller.openFutureSupplyInfoWindow).toHaveBeenCalledTimes(2);
    await user.keyboard(' ');
    expect(controller.openFutureSupplyInfoWindow).toHaveBeenCalledTimes(3);
    expect(controller.openFutureSupplyInfoWindow).toHaveBeenLastCalledWith(project);

    marker.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', repeat: true, bubbles: true, cancelable: true }));
    expect(controller.openFutureSupplyInfoWindow).toHaveBeenCalledTimes(3);
  });

  it('preserves hover callbacks and removes old markers when the filtered set changes', () => {
    vi.useFakeTimers();
    const { controller, host, map, created } = createHarness();
    const project = supply();
    controller.renderFutureMarkers([project, supply({ id: 'invalid', location_lng: 'invalid' })]);
    expect(created).toHaveLength(1);
    created[0].emit('mouseover', { originEvent: { clientX: 120, clientY: 80 } });
    expect(controller.showFutureSupplyHoverTooltip).toHaveBeenCalledWith(project, 120, 80);
    created[0].emit('mouseout');
    vi.advanceTimersByTime(80);
    expect(controller.hideHoverTooltip).toHaveBeenCalledTimes(1);

    controller.renderFutureMarkers([supply({ id: 'next-project' })], 'vacancy');
    expect(map.remove).toHaveBeenCalledWith([created[0]]);
    expect(host.querySelectorAll('button')).toHaveLength(1);
    expect(host.querySelector('button')?.dataset.futureSupplyId).toBe('next-project');
    controller.renderFutureMarkers([]);
    expect(host.childElementCount).toBe(0);
  });
});
