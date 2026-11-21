import { afterEach, expect, it } from 'vitest';
import { installLiveAmapProbe } from './fixtures/live-amap-probe.mjs';

afterEach(() => {
  for (const key of ['AMap', '__workspaceMap', '__liveAmapProbe', '__colliersNavigationProbe']) delete window[key];
});
it('observes late SDK assignment while preserving real construction, method arguments, receiver and results', () => {
  installLiveAmapProbe();
  window.AMap = {};
  const received = [];
  class SDKMap {
    static version = '2.0';
    constructor(host, options) { this.host = host; this.options = options; this.listeners = new Map(); }
    on(name, callback) { this.listeners.set(name, callback); }
    setZoomAndCenter(...args) { received.push({ receiver: this, args }); return this.options; }
    destroy() { throw new TypeError('SDK failure'); }
  }
  window.AMap.Map = SDKMap;
  const options = { zoom: 10 };
  const map = new window.AMap.Map('host', options);
  const center = [116.46,39.91];
  expect(map).toBeInstanceOf(SDKMap);
  expect(window.AMap.Map.version).toBe('2.0');
  expect(map.host).toBe('host');
  expect(map.setZoomAndCenter(14, center, false, 240)).toBe(options);
  expect(received).toEqual([{ receiver: map, args: [14,center,false,240] }]);
  expect(received[0].args[1]).toBe(center);
  expect(map.resize).toBeUndefined();
  expect(() => map.destroy()).toThrow('SDK failure');
  map.listeners.get('complete')();
  expect(window.__workspaceMap).toBe(map);
  expect(window.__liveAmapProbe.created).toBe(1);
  expect(window.__liveAmapProbe.events.map(x=>x.name)).toEqual(['complete']);
});
