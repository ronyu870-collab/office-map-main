import { afterEach, describe, expect, it, vi } from 'vitest';
import { MapController } from '@/src/services/MapController';
import { mercatorPoint } from '@/src/app/map/runtime/mapExtent';

const examples = [
  { id: 'western', name: '西部项目', location_lng: 116.16, location_lat: 39.82 },
  { id: 'eastern', name: '东部项目', location_lng: 116.51, location_lat: 39.99 },
];
afterEach(() => { document.body.replaceChildren(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
function setup(width = 800, height = 600) {
  const host = document.createElement('div'); document.body.append(host);
  host.getBoundingClientRect = () => new DOMRect(0, 0, width, height);
  const map = { getContainer: () => host, setZoomAndCenter: vi.fn() };
  const controller = new MapController(); Object.assign(controller, { map, AMap: {} });
  return { controller, map };
}
describe('MapController geographic extent', () => {
  it.each([[800,600], [320,160], [1200,220], [844,84]])('contains the actual extreme coordinates with marker room on %sx%s', (width, height) => {
    vi.useFakeTimers();
    const { controller, map } = setup(width, height);
    controller.fitToBuildings(examples as never);
    const [zoom, center] = map.setZoomAndCenter.mock.calls[0];
    const c = mercatorPoint(...center as [number,number]);
    for (const b of examples) {
      const p = mercatorPoint(b.location_lng, b.location_lat);
      const x = (p[0]-c[0])*256*2**zoom + width/2, y = (p[1]-c[1])*256*2**zoom + height/2;
      expect(x).toBeGreaterThan(30); expect(x).toBeLessThan(width-30);
      expect(y).toBeGreaterThan(25); expect(y).toBeLessThan(height-25);
    }
    vi.advanceTimersByTime(1000);
    expect(map.setZoomAndCenter).toHaveBeenCalledOnce();
  });
  it('caps single or identical coordinates and never relocates an empty region', () => {
    const { controller, map } = setup();
    controller.fitToBuildings([examples[0], examples[0]] as never);
    expect(map.setZoomAndCenter.mock.lastCall?.[0]).toBe(16);
    expect(map.setZoomAndCenter.mock.lastCall?.[1][0]).toBeCloseTo(116.16, 8);
    controller.fitToBuildings([]); expect(map.setZoomAndCenter).toHaveBeenCalledOnce();
  });
  it('honors reduced motion without a later pan or zoom', () => {
    vi.stubGlobal('matchMedia', () => ({ matches: true }));
    const { controller, map } = setup(); controller.fitToBuildings(examples as never);
    expect(map.setZoomAndCenter.mock.lastCall?.slice(2)).toEqual([true, 0]);
    controller.resetToDefaultView(); expect(map.setZoomAndCenter.mock.lastCall?.slice(2)).toEqual([true, 0]);
  });
});
it('keeps radius filtering meaningful when SDK geometry is unavailable', () => {
  const value = new MapController();
  expect(value.calculateDistance([116, 40], [116, 40])).toBe(0);
  expect(value.calculateDistance([116, 40], [116, 40.01])).toBeCloseTo(1113.195, 1);
});
