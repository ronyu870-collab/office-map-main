import { afterEach, expect, it, vi } from 'vitest';
import { installLiveAmapProbe, waitForLiveAmapTiles, beginLiveAmapSample, finishLiveAmapSample } from './fixtures/live-amap-probe.mjs';

afterEach(() => {
  vi.unstubAllGlobals();
  for (const key of ['AMap', '__workspaceMap', '__liveAmapProbe', '__colliersNavigationProbe']) delete window[key];
});

it('ends a sample frame loop even when its queued callback arrives after the next sample starts', () => {
  let sequence = 0;
  const callbacks = new Map();
  vi.stubGlobal('requestAnimationFrame', vi.fn(callback => { callbacks.set(++sequence, callback); return sequence; }));
  vi.stubGlobal('cancelAnimationFrame', vi.fn());
  vi.stubGlobal('PerformanceObserver', class { observe() {} disconnect() {} takeRecords() { return []; } });
  window.__liveAmapProbe = { calls: [], events: [], created: 1 };
  beginLiveAmapSample();
  const lateFrame = callbacks.get(1);
  finishLiveAmapSample();
  beginLiveAmapSample();
  const current = window.__liveAmapProbe.sample;
  const scheduled = sequence;
  lateFrame(100);
  lateFrame(116);
  expect(sequence).toBe(scheduled);
  expect(current.intervals).toEqual([]);
  callbacks.get(scheduled)(132);
  expect(sequence).toBe(scheduled + 1);
  finishLiveAmapSample();
});

it('waits for actual provider tiles after early SDK completion and rejects unrelated responses', async () => {
  let accept;
  let emit;
  const page = { waitForResponse: vi.fn(predicate => new Promise(resolve => {
    accept = predicate;
    emit = response => { if (predicate(response)) resolve(response); };
  })) };
  let ready = false;
  const response = (url, ok = true) => ({ url: () => url, ok: () => ok });
  const waiting = waitForLiveAmapTiles(page, { tileOK: 0 }).then(() => { ready = true; });
  await Promise.resolve();
  expect(ready).toBe(false);
  expect(accept(response('https://webapi.amap.com/maps'))).toBe(false);
  expect(accept(response('https://example.com/tile/1'))).toBe(false);
  expect(accept(response('https://webapi.amap.com/tile/1', false))).toBe(false);
  emit(response('https://webapi.amap.com/tile/1'));
  await waiting;
  expect(ready).toBe(true);
  expect(page.waitForResponse.mock.calls[0][1]).toEqual({ timeout: 15000 });
});

it('reuses already observed tiles and propagates a real transport timeout', async () => {
  const page = { waitForResponse: vi.fn().mockRejectedValue(new Error('tile timeout')) };
  await waitForLiveAmapTiles(page, { tileOK: 1 });
  expect(page.waitForResponse).not.toHaveBeenCalled();
  await expect(waitForLiveAmapTiles(page, { tileOK: 0 })).rejects.toThrow('tile timeout');
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
  const options = { zoom: 10, center: [116.46, 39.91] };
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
  expect(window.__liveAmapProbe.initialCameras).toEqual([{ zoom: 10, center: [116.46, 39.91] }]);
  expect(map.options).toBe(options);
  expect(window.__liveAmapProbe.events.map(x=>x.name)).toEqual(['complete']);
});
