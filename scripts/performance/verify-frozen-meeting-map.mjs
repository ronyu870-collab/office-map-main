import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const base = new URL(process.argv[2]);
assert.ok(['127.0.0.1', 'localhost'].includes(base.hostname), 'isolated loopback builds only');
const { chromium } = createRequire(import.meta.url)(process.env.PERF_PLAYWRIGHT_MODULE || 'playwright-core');
const browser = await chromium.launch(process.env.PERF_BROWSER_CHANNEL === 'chromium' ? {} : { channel: 'chrome' });
function mapFixture() {
  class MapView {
    constructor(host) { this.host = host; this.host.dataset.fixtureMap = 'ready'; }
    addControl() {}
    add(markers) { this.host.append(...markers.map(marker => marker.node)); }
    remove(markers) { for (const marker of markers) marker.node.remove(); }
    setFitView() {}
    setZoomAndCenter(zoom) { this.host.dataset.fixtureZoom = String(zoom); }
    destroy() { this.host.replaceChildren(); }
  }
  class Marker {
    constructor(options) { this.node = document.createElement('div'); this.node.innerHTML = options.content; this.node.style.display = 'inline-block'; }
    on(name, callback) { this.node.addEventListener(name, callback); }
  }
  class InfoWindow {
    constructor(options) { this.node = document.createElement('aside'); this.node.innerHTML = options.content; }
    open(map) { map.host.append(this.node); }
    close() { this.node.remove(); }
  }
  window.AMap = { Map: MapView, Marker, InfoWindow, Pixel: class {}, Scale: class {}, plugin: (_names, done) => done() };
  window.___onAPILoaded();
}
const results = [];
try {
  for (const width of [1280, 390]) {
    const context = await browser.newContext({ viewport: { width, height: 844 }, isMobile: width < 640, hasTouch: width < 640, serviceWorkers: 'block' });
    try {
      await context.routeWebSocket(/.*/, socket => socket.close());
      const dataRequests = [];
      let sdk = 0;
      await context.route('**/*', async route => {
        const url = new URL(route.request().url());
        if (url.origin === base.origin) {
          if (url.pathname === '/isolated-meeting-parent') return route.fulfill({ contentType: 'text/html', body: '<script>window.events=[];window.addEventListener("message",event=>{if(event.origin===location.origin)events.push(event.data)})</script><iframe title="合成会议宿主" style="width:100%;height:90vh;border:0" src="/md-20260928/map"></iframe>' });
          if (url.pathname.startsWith('/api/')) { if (url.pathname.startsWith('/api/map/')) dataRequests.push(url.pathname); return route.fulfill({ status: 204 }); }
          return route.continue();
        }
        if (url.origin === 'https://webapi.amap.com' && url.pathname === '/maps') {
          sdk++;
          return route.fulfill({ contentType: 'application/javascript', body: `(${mapFixture.toString()})();` });
        }
        return route.abort();
      });
      const page = await context.newPage();
      await page.goto(new URL('/isolated-meeting-parent', base).href);
      const frame = page.frameLocator('iframe');
      await frame.getByText('MD Meeting · 冻结业务数据', { exact: true }).waitFor();
      await page.waitForFunction(() => window.events.some(event => event?.type === 'colliers-map-ready'));
      const markers = frame.locator('[data-md-building]');
      const child = page.frames().find(item => new URL(item.url()).pathname === '/md-20260928/map');
      assert.ok(child, 'the actual meeting map must be embedded');
      const waitCount = count => child.waitForFunction(expected => document.querySelectorAll('[data-md-building]').length === expected, count, { timeout: 6000 });
      const send = (command, value) => page.evaluate(({ command, value }) => {
        document.querySelector('iframe').contentWindow.postMessage({ type:'colliers-map-command', command, value }, location.origin);
      }, { command, value });
      await waitCount(21);
      const initialNames = await markers.evaluateAll(nodes => nodes.map(node => node.dataset.mdBuilding));
      assert.equal(new Set(initialNames).size, 21);
      await send('search', '嘉里中心');
      await waitCount(1);
      await send('mode', 'rent');
      await frame.locator('[data-md-building="嘉里中心"]').getByText('204', { exact: true }).waitFor();
      await markers.first().click();
      await frame.getByText('冻结快照', { exact: true }).waitFor();
      await frame.getByText('204.44', { exact: true }).waitFor();
      await frame.getByText('6.34%', { exact: true }).waitFor();
      await page.waitForFunction(() => window.events.some(event => event?.type === 'colliers-map-selected' && event.building === '嘉里中心'));
      await send('focus', '嘉里中心');
      await frame.locator('[data-fixture-zoom="16"]').waitFor();
      await send('reset');
      await waitCount(21);
      await send('filter', { grades:['__fixture_no_match__'] });
      await waitCount(0);
      await send('reset');
      await waitCount(21);
      assert.deepEqual(await markers.evaluateAll(nodes => nodes.map(node => node.dataset.mdBuilding)), initialNames);
      assert.equal(sdk, 1);
      assert.deepEqual(dataRequests, []);
      results.push({ width, frozenMarkers:21, sdkRequests:sdk, liveMapRequests:dataRequests.length, search:true, rentMode:true, selectionMessage:true, focus:true, filterAndReset:true });
    } finally { await context.close(); }
  }
  console.log(JSON.stringify({ browser:await browser.version(), scope:'frozen page in isolated iframe with synthetic AMap; does not verify live proxy or actual display equipment', results }, null, 2));
} finally { await browser.close(); }
