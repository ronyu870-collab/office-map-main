import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { setTimeout as delay } from 'node:timers/promises';
import { installSyntheticMap } from './fixtures/map-adapter.mjs';
import { mapStartupStages, observeNavigation } from './readiness.mjs';

const base = new URL(process.argv[2]);
assert.ok(['127.0.0.1', 'localhost'].includes(base.hostname), 'isolated loopback builds only');
const { chromium } = createRequire(import.meta.url)(process.env.PERF_PLAYWRIGHT_MODULE || 'playwright-core');
const browser = await chromium.launch({ ...(process.env.PERF_BROWSER_CHANNEL === 'chromium' ? {} : { channel: 'chrome' }), headless: true });
const user = { id: '45678901-1111-4111-8111-111111111111', email: 'map@example.test', app_metadata: {}, user_metadata: {} };
const expires_at = Math.floor(Date.now() / 1000) + 3600;
const encode = value => Buffer.from(JSON.stringify(value)).toString('base64url');
const token = `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode({ sub: user.id, exp: expires_at, aud: 'authenticated', session_id: user.id })}.fixture`;
const session = { user, expires_at, expires_in: 3600, token_type: 'bearer', refresh_token: 'synthetic', access_token: token };


const observations = [];
const lifecycle = [];
function countLifecycle() {
  const BaseMap = window.AMap.Map;
  const stats = window.__colliersMapLifecycle = { created: 0, destroyed: 0, active: 0 };
  window.AMap.Map = class extends BaseMap {
    constructor(...args) { super(...args); stats.created++; stats.active++; }
    destroy() { super.destroy(); stats.destroyed++; stats.active--; }
  };
}
try {
  for (const [label, sdkDelay, dataDelay, width, cycles] of [
    ['sdk-delayed', 450, 15, 1280, 0], ['data-delayed', 15, 450, 1280, 0],
    ['reentry-desktop', 0, 0, 1280, 20], ['reentry-narrow', 0, 0, 390, 20],
  ]) {
    const context = await browser.newContext({ viewport: { width, height: 900 }, isMobile: width < 640, hasTouch: width < 640, serviceWorkers: 'block' });
    try {
      let roleConfirmed = false;
      const violations = [];
      const requests = { stock: 0, future: 0, sdk: 0, role: 0 };
      await context.routeWebSocket(/.*/, ws => ws.close());
      await context.route('**/*', async route => {
        const request = route.request();
        const url = new URL(request.url());
        if (url.origin === base.origin) {
          if (url.pathname === '/api/map/data') {
            if (!roleConfirmed || request.headers().authorization !== `Bearer ${token}`) violations.push('map read before authorization');
            if (url.searchParams.get('mode') === 'future') {
              requests.future++;
              return route.fulfill({ json: { future_supplies: [] } });
            }
            requests.stock++;
            await delay(dataDelay);
            return route.fulfill({ json: { display_overrides: [], buildings: [{ id: 'fixture-tower', name: 'Fixture Tower', grade: 'A', district: '朝阳区', submarket: '其他', location_lng: 116.46, location_lat: 39.91, building_metrics: [] }] } });
          }
          if (url.pathname.startsWith('/api/')) return route.fulfill({ status: 204 });
          return route.continue();
        }
        if (url.origin === 'https://example.supabase.co') {
          const headers = { 'access-control-allow-origin': '*', 'access-control-allow-methods': 'GET, OPTIONS', 'access-control-allow-headers': '*' };
          if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers });
          if (url.pathname === '/rest/v1/user_roles') {
            requests.role++;
            roleConfirmed = true;
            return route.fulfill({ headers, json: [{ role: 'viewer', session_id: user.id, full_name: 'Fixture Map Viewer' }] });
          }
          return route.fulfill({ headers, json: [] });
        }
        if (url.origin === 'https://webapi.amap.com' && url.pathname === '/maps') {
          if (!roleConfirmed || url.searchParams.get('key') !== 'syntheticfixture') violations.push('unexpected SDK configuration or early request');
          requests.sdk++;
          await delay(sdkDelay);
          return route.fulfill({ contentType: 'application/javascript', body: `(${installSyntheticMap.toString()})();${cycles ? `(${countLifecycle.toString()})();` : ''}` });
        }
        return route.abort();
      });
      await context.addInitScript(({ origin, session }) => {
        if (location.origin !== origin || localStorage.getItem('sb-example-auth-token')) return;
        localStorage.setItem('colliers_trusted_device_until', String(Date.now() + 86_400_000));
        localStorage.setItem('sb-example-auth-token', JSON.stringify(session));
      }, { origin: base.origin, session });
      const page = await context.newPage();
      if (cycles) {
        const pageErrors = [];
        const visits = [];
        page.on('pageerror', error => pageErrors.push(error.message));
        await page.goto(base.href);
        const mapLink = page.getByRole('link', { name: /北京办公楼市场地图/ });
        const marker = page.locator('#map-container [data-building-id="fixture-tower"]').first();
        for (let visit = 1; visit <= cycles; visit++) {
          const started = performance.now();
          await mapLink.click();
          await page.waitForURL('**/map');
          await marker.waitFor();
          visits.push(Math.round(performance.now() - started));
          assert.deepEqual(await page.evaluate(() => window.__colliersMapLifecycle), { created: visit, destroyed: visit - 1, active: 1 });
          if (visit === 1 || visit === cycles) {
            await marker.click();
            await page.getByRole('button', { name: '关闭楼宇详情' }).click();
          }
          await page.goBack();
          await page.waitForURL(base.href);
          await mapLink.waitFor();
          await page.waitForFunction(count => window.__colliersMapLifecycle?.destroyed === count && window.__colliersMapLifecycle?.active === 0, visit);
          assert.equal(await page.locator('.amap-maps').count(), 0, 'no map root may survive navigation away');
        }
        assert.deepEqual([...pageErrors, ...violations], []);
        assert.equal(requests.sdk, 1, 'same-document visits reuse the SDK');
        lifecycle.push({ label, width, visits, requests, ...await page.evaluate(() => window.__colliersMapLifecycle) });
        continue;
      }
      await page.addInitScript(observeNavigation, { action: 'open', destination_origin: base.origin, destination_pathname: '/map',
        shell: '#map-container', content: '#map-container [data-building-id="fixture-tower"]',
        map_tiles: '.fixture-tile-ready', map_stage_names: mapStartupStages, timeout_ms: 8000 });
      await page.goto(new URL('/map', base).href);
      await page.waitForFunction(() => window.__colliersNavigationProbe.result.status !== 'running');
      const result = await page.evaluate(() => window.__colliersNavigationProbe.result);
      assert.equal(result.status, 'success', `fixture map must reach a real stock overlay: ${JSON.stringify(result)}`);
      const stage = result.map_stages_ms;
      assert.ok(Object.values(stage).every(value => Number.isFinite(value) && value >= 0), `all stages must be measured: ${JSON.stringify(stage)}`);
      assert.ok(stage.authorized <= stage.controller_ready && stage.controller_ready <= stage.stock_read_start);
      assert.ok(stage.sdk_start <= stage.sdk_ready && stage.sdk_ready <= stage.tiles_complete && stage.tiles_complete <= stage.visual_ready);
      assert.ok(Math.max(stage.visual_ready, stage.stock_data_ready) <= stage.stock_render_start);
      assert.ok(stage.stock_render_start <= stage.stock_render_returned && stage.stock_render_returned <= result.content_usable_ms);
      if (label === 'sdk-delayed') assert.ok(stage.stock_data_ready < stage.sdk_ready, 'stock data can finish while SDK is delayed');
      else assert.ok(stage.tiles_complete < stage.stock_data_ready, 'tiles can finish while stock data is delayed');
      assert.deepEqual(violations, []);
      observations.push({ label, stage, fixtureOverlayMs: result.content_usable_ms });
    } finally { await context.close(); }
  }
  console.log(JSON.stringify({ status: 'pass', browser: await browser.version(), environment: 'isolated AMap SDK and data adapter, not live tiles or GPU', observations, lifecycle }));
} finally { await browser.close(); }
