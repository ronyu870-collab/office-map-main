import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { installSyntheticMap } from './fixtures/map-adapter.mjs';

const base = new URL(process.argv[2]);
assert.ok(['127.0.0.1', 'localhost'].includes(base.hostname), 'isolated loopback builds only');
const { chromium } = createRequire(import.meta.url)(process.env.PERF_PLAYWRIGHT_MODULE || 'playwright-core');
const browser = await chromium.launch(process.env.PERF_BROWSER_CHANNEL === 'chromium' ? {} : { channel: 'chrome' });
const user = { id: '45678901-1111-4111-8111-111111111111', email: 'map@example.test', app_metadata: {}, user_metadata: {} };
const expires_at = Math.floor(Date.now() / 1000) + 3600;
const encode = value => Buffer.from(JSON.stringify(value)).toString('base64url');
const token = `${encode({ alg: 'HS256' })}.${encode({ sub: user.id, exp: expires_at, aud: 'authenticated', session_id: user.id })}.fixture`;
const session = { user, expires_at, expires_in: 3600, token_type: 'bearer', refresh_token: 'synthetic', access_token: token };
const observations = [];
const compareOnly = process.argv.includes('--compare-return-only');
try {
  for (const width of [1280, 390]) {
    const context = await browser.newContext({ viewport: { width, height: 844 }, isMobile: width === 390, hasTouch: width === 390, serviceWorkers: 'block' });
    let release;
    const hold = new Promise(resolve => { release = resolve; });
    try {
      let attempts = 0;
      await context.routeWebSocket(/.*/, ws => ws.close());
      await context.route('**/*', async route => {
        const request = route.request();
        const url = new URL(request.url());
        if (url.origin === base.origin) {
          if (url.pathname === '/api/map/data') return route.fulfill({ json: { display_overrides: [], future_supplies: [], buildings: [{ id: '9ee3e3ff-4845-41a1-a78f-390c11b1917a', name: '隔离楼宇', grade: 'A', district: '朝阳区', submarket: '其他', location_lng: 116.46, location_lat: 39.91, building_metrics: [] }] } });
          if (url.pathname === '/api/lease-transactions/read') {
            assert.equal(url.searchParams.get('building_id'), '9ee3e3ff-4845-41a1-a78f-390c11b1917a');
            assert.equal(request.headers().authorization, `Bearer ${token}`);
            attempts++;
            if (attempts === 1) { await hold; return route.fulfill({ status: 403, json: { error: '合成权限拒绝' } }); }
            if (attempts === 2) return route.fulfill({ status: 502, json: { error: '合成服务故障' } });
            return route.fulfill({ json: { count: 0, records: [] } });
          }
          return url.pathname.startsWith('/api/') ? route.fulfill({ status: 204 }) : route.continue();
        }
        if (url.origin === 'https://example.supabase.co') {
          const headers = { 'access-control-allow-origin': '*', 'access-control-allow-methods': 'GET, OPTIONS', 'access-control-allow-headers': '*' };
          if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers });
          if (url.pathname === '/rest/v1/user_roles') return route.fulfill({ headers, json: [{ role: 'viewer', session_id: user.id, full_name: '隔离账号' }] });
          if (url.pathname === '/auth/v1/user') return route.fulfill({ headers, json: user });
          return route.fulfill({ headers, json: [] });
        }
        if (url.origin === 'https://webapi.amap.com' && url.pathname === '/maps') return route.fulfill({ contentType: 'application/javascript', body: `(${installSyntheticMap.toString()})();const OriginalMap = window.AMap.Map; window.AMap.Map = class extends OriginalMap { constructor(...args) { super(...args); this.zoom = args[1]?.zoom; this.center = args[1]?.center; window.__relatedMap = this; } };` });
        return route.abort();
      });
      await context.addInitScript(({ origin, session }) => {
        if (location.origin !== origin) return;
        localStorage.setItem('colliers_trusted_device_until', String(Date.now() + 86_400_000));
        localStorage.setItem('sb-example-auth-token', JSON.stringify(session));
      }, { origin: base.origin, session });
      const page = await context.newPage();
      page.setDefaultTimeout(6500);
      await page.goto(new URL('/map?building=9ee3e3ff-4845-41a1-a78f-390c11b1917a', base).href);
      const detail = page.getByRole('region', { name: '隔离楼宇楼宇详情' });
      await detail.waitFor();
      const verifyCompareReturn = async () => {
        const search = page.getByRole('searchbox', { name: '搜索楼宇、子市场、业主或物业' });
        await search.fill('隔离楼宇');
        await page.getByRole('group', { name: '已生效筛选条件' }).getByText(/隔离楼宇/).waitFor();
        await page.getByRole('region', { name: '项目搜索候选' }).locator('[data-map-search-choice]').first().click();
        await detail.waitFor();
        for (const browserBack of [false, true]) {
          await page.getByRole('tab', { name: '行情', exact: true }).click();
          const camera = await page.evaluate(() => [window.__relatedMap.getZoom(), window.__relatedMap.getCenter().getLng(), window.__relatedMap.getCenter().getLat()]);
          await page.getByRole('button', { name: '楼宇对比', exact: true }).click();
          await page.waitForURL('**/compare?**');
          if (browserBack) await page.goBack();
          else await page.getByRole('link', { name: '返回地图' }).click();
          await page.waitForURL(url => url.pathname === '/map');
          await search.waitFor();
          assert.equal(await search.inputValue(), '隔离楼宇', 'returning from comparison preserves the map search');
          await detail.waitFor();
          assert.deepEqual(await page.evaluate(() => [window.__relatedMap.getZoom(), window.__relatedMap.getCenter().getLng(), window.__relatedMap.getCenter().getLat()]), camera, 'comparison return restores the captured camera');
        }
      };
      if (compareOnly) { await verifyCompareReturn(); continue; }
      await page.getByRole('tab', { name: '成交与资料', exact: true }).click();
      const trigger = page.locator('.building-popup button[data-map-action="related-leases"]');
      await (width === 390 ? trigger.tap() : trigger.click());
      const panel = page.getByRole('dialog', { name: '隔离楼宇关联成交' });
      await panel.locator('[aria-label="正在读取关联成交"]').waitFor();
      assert.doesNotMatch(await panel.innerText(), /0 条成交|暂无已关联成交/, 'an unfinished read is not a zero result');
      release();
      await panel.getByRole('alert').getByText('没有权限读取关联成交').waitFor();
      assert.doesNotMatch(await panel.innerText(), /0 条成交|暂无已关联成交/);
      await panel.getByRole('button', { name: '重新加载' }).click();
      await panel.getByRole('alert').getByText('关联成交暂时无法读取').waitFor();
      await panel.getByRole('button', { name: '重新加载' }).click();
      await panel.getByText('暂无已关联成交').waitFor();
      assert.match(await panel.innerText(), /0 条成交/);
      assert.equal(attempts, 3);
      if (process.env.PERF_RELATED_SCREENSHOT_DIR) await page.screenshot({ path: `${process.env.PERF_RELATED_SCREENSHOT_DIR}/related-${width}.png` });
      await panel.getByRole('button', { name: '关闭关联成交' }).click();
      await panel.waitFor({ state: 'hidden' });
      assert.equal(await trigger.isVisible(), true, 'closing related records preserves the selected map building');
      await verifyCompareReturn();
      observations.push({ width, attempts, states: ['loading', 'forbidden', 'query error', 'empty'], selectedBuildingPreserved: true, compareReturn: true });
    } finally { release(); await context.close(); }
  }
  console.log(JSON.stringify({ status: 'pass', browser: await browser.version(), observations }));
} finally { await browser.close(); }
