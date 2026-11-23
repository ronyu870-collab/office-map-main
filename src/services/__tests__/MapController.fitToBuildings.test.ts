import { afterEach, describe, expect, it, vi } from 'vitest';
import { MapController } from '@/src/services/MapController';

const examples = [
  { id: 'western', name: '西部项目', location_lng: 116.16, location_lat: 39.82 },
  { id: 'eastern', name: '东部项目', location_lng: 116.51, location_lat: 39.99 },
];

afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('MapController search extent', () => {
  it('fits widely dispersed matches without overriding the SDK bounds after a delay', () => {
    vi.useFakeTimers();
    const map = { setBounds: vi.fn(), setZoom: vi.fn(), setZoomAndCenter: vi.fn(), getZoom: vi.fn(() => 11) };
    const controller = new MapController();
    Object.assign(controller, {
      map,
      AMap: { Bounds: class { constructor(public southwest: number[], public northeast: number[]) {} } },
    });
    vi.spyOn(controller as any, 'clearCompetitorElements').mockImplementation(() => {});
    controller.fitToBuildings(examples as unknown as Parameters<MapController['fitToBuildings']>[0]);
    expect(map.setBounds).toHaveBeenCalledTimes(1);
    expect(map.setBounds.mock.calls[0]?.[0]).toMatchObject({ southwest: [116.16, 39.82], northeast: [116.51, 39.99] });
    vi.advanceTimersByTime(250);
    expect(map.setZoom).not.toHaveBeenCalled();
  });

  it('still centers a single matching building at zoom 16', () => {
    const map = { setBounds: vi.fn(), setZoom: vi.fn(), setZoomAndCenter: vi.fn(), getZoom: vi.fn(() => 11) };
    const controller = new MapController();
    Object.assign(controller, { map, AMap: { Bounds: class {} } });
    vi.spyOn(controller as any, 'clearCompetitorElements').mockImplementation(() => {});
    controller.fitToBuildings(examples.slice(0, 1) as unknown as Parameters<MapController['fitToBuildings']>[0]);
    expect(map.setZoomAndCenter).toHaveBeenCalledWith(16, [116.16, 39.82], false, 240);
    expect(map.setBounds).not.toHaveBeenCalled();
  });
});


it('keeps radius filtering meaningful when SDK geometry is unavailable', () => {
  const value = new MapController();
  expect(value.calculateDistance([116, 40], [116, 40])).toBe(0);
  expect(value.calculateDistance([116, 40], [116, 40.01])).toBeCloseTo(1113.195, 1);
});


it('honors reduced motion for single-result, result-extent and reset camera entries', () => {
  vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: true })));
  const map = { setBounds: vi.fn(), setZoomAndCenter: vi.fn() };
  const value = new MapController();
  Object.assign(value, { map, AMap: { Bounds: class {} } });
  value.fitToBuildings(examples.slice(0, 1) as unknown as Parameters<MapController['fitToBuildings']>[0]);
  expect(map.setZoomAndCenter).toHaveBeenLastCalledWith(16, [116.16, 39.82], true, 0);
  value.fitToBuildings(examples as unknown as Parameters<MapController['fitToBuildings']>[0]);
  expect(map.setBounds).toHaveBeenLastCalledWith(expect.anything(), true);
  value.resetToDefaultView();
  expect(map.setZoomAndCenter.mock.lastCall?.slice(2)).toEqual([true, 0]);
});
