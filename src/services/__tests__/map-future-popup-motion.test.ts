import { expect, it, vi } from 'vitest';
import { MapController } from '../MapController';

it('opens a future supply card without invoking high-dependency InfoWindow autoMove', () => {
  let received: { autoMove?: boolean; content?: HTMLElement } | null = null;
  class InfoWindow {
    constructor(options: { autoMove?: boolean; content?: HTMLElement }) { received = options; }
    on() {}
    open() {}
    close() {}
  }
  const controller = new MapController();
  Object.assign(controller, { map: {}, AMap: { InfoWindow, Pixel: class {} } });
  controller.openFutureSupplyInfoWindow({
    id: 'fixture-supply', name: '未来供应实例', district: '朝阳区', submarket: 'CBD',
    location_lng: 116.48, location_lat: 39.91, launch_year: 2027, launch_quarter: 'Q2',
  });
  expect(received).not.toBeNull();
  expect((received as { autoMove?: boolean } | null)?.autoMove).toBe(false);
  expect((received as { content?: HTMLElement } | null)?.content?.querySelector('.map-future-popup')).not.toBeNull();
});
