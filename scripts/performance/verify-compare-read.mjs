import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const base = new URL(process.argv[2]);
assert.ok(['127.0.0.1', 'localhost'].includes(base.hostname), 'isolated loopback builds only');
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PERF_PLAYWRIGHT_MODULE || 'playwright-core');
const browser = await chromium.launch({
  ...(process.env.PERF_BROWSER_CHANNEL === 'chromium' ? {} : { channel: 'chrome' }), headless: true,
});

const user = { id: '12345678-1111-4111-8111-111111111111', email: 'compare@example.test', app_metadata: {}, user_metadata: {} };
const expires_at = Math.floor(Date.now() / 1000) + 3600;
const encode = value => Buffer.from(JSON.stringify(value)).toString('base64url');
const token = `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode({ sub: user.id, exp: expires_at, aud: 'authenticated', session_id: user.id })}.fixture`;
const authSession = { user, expires_at, expires_in: 3600, token_type: 'bearer', refresh_token: 'synthetic', access_token: token };
const project = (id, name) => ({ id, name, grade: 'A', submarket: 'CBD', building_metrics: [{ record_year: 2026, record_quarter: 3, vacancy_rate: 0.15 }] });
const buildings = [project('target', 'Target Tower'), project('peer', 'Peer Tower'), project('other', 'Other Plaza')];
const observations = [];

try {
  for (const width of [1280, 390]) {
    const context = await browser.newContext({ viewport: { width, height: 844 }, isMobile: width === 390, hasTouch: width === 390, serviceWorkers: 'block' });
    try {
      let requests = 0;
      let roleConfirmed = false;
      let allowFirst;
      const firstResponse = new Promise(resolve => { allowFirst = resolve; });
      let developer = 'Fixture Developer';
      let accessDenied = false;
      const violations = [];
      await context.routeWebSocket(/.*/, ws => ws.close());
      await context.route('**/*', async route => {
        const request = route.request();
        const url = new URL(request.url());
        if (url.origin === base.origin) {
          if (url.pathname === '/api/map/data' && url.searchParams.get('mode') === 'compare') {
            requests++;
            if (!roleConfirmed || request.headers().authorization !== `Bearer ${token}`) violations.push('comparison read before authorized scope');
            if (requests === 1) await firstResponse;
            if (accessDenied) return route.fulfill({ status: 403, json: { error: '合成权限已撤销' } });
            return route.fulfill({ json: { buildings, brochures: [{ building_id: 'target', developer, elevator_vip: 1 }] } });
          }
          if (url.pathname === '/api/map/data') return route.fulfill({ json: { buildings: [], display_overrides: [], future_supplies: [] } });
          if (url.pathname.startsWith('/api/')) return route.fulfill({ status: 204 });
          return route.continue();
        }
        if (url.origin === 'https://example.supabase.co') {
          const headers = { 'access-control-allow-origin': '*', 'access-control-allow-methods': 'GET, OPTIONS', 'access-control-allow-headers': '*' };
          if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers });
          if (url.pathname === '/rest/v1/user_roles') {
            roleConfirmed = true;
            return route.fulfill({ headers, json: [{ role: 'viewer', session_id: user.id, full_name: 'Fixture Viewer' }] });
          }
          return route.fulfill({ headers, json: [] });
        }
        return route.abort();
      });
      await context.addInitScript(({ origin, session }) => {
        if (location.origin !== origin || localStorage.getItem('sb-example-auth-token')) return;
        localStorage.setItem('colliers_trusted_device_until', String(Date.now() + 86_400_000));
        localStorage.setItem('sb-example-auth-token', JSON.stringify(session));
      }, { origin: base.origin, session: authSession });
      const page = await context.newPage();
      await page.goto(new URL('/compare?buildingId=target&name=Target+Tower', base).href, { waitUntil: 'domcontentloaded' });
      await page.getByRole('heading', { name: '楼宇对比' }).waitFor();
      assert.equal(await page.getByRole('table').count(), 0, 'frame must not count as business data');
      allowFirst();
      await page.getByRole('cell', { name: developer }).waitFor();
      await page.getByRole('cell', { name: '15%' }).first().waitFor();
      if (width === 390) await page.getByRole('button', { name: /选择项目与筛选/ }).click();
      const search = page.getByRole('textbox', { name: '搜索对比项目' });
      await search.pressSequentially('Peer');
      assert.equal(await search.evaluate(input => document.activeElement === input && input.selectionStart === 4), true);
      assert.equal(await page.getByRole('button', { name: /Other Plaza/ }).count(), 0);
      await search.evaluate(input => input.setSelectionRange(2, 2));
      await search.press('e');
      assert.equal(await search.inputValue(), 'Peeer');
      await search.press('Backspace');
      assert.equal(await search.inputValue(), 'Peer');
      await page.getByRole('button', { name: /Peer Tower/ }).waitFor();

      await page.evaluate(() => history.pushState(null, '', '?buildingId=other&name=Other+Plaza'));
      await page.waitForFunction(() => document.querySelectorAll('thead th')[1]?.textContent?.startsWith('Other Plaza'));
      assert.equal(requests, 1, 'changing only the target must not re-read all buildings');
      await page.getByRole('button', { name: '返回地图' }).click();
      await page.waitForURL('**/map');
      await page.goBack();
      await page.getByRole('columnheader', { name: /Other Plaza/ }).waitFor();
      assert.equal(requests, 1, 'same-scope short return must use the valid snapshot');

      const updater = await context.newPage();
      await updater.goto(new URL('/login', base).href);
      developer = 'Fresh Developer';
      await updater.evaluate(() => localStorage.setItem('colliers:compare-revision', 'browser-fixture-update'));
      await page.bringToFront();
      await page.getByRole('cell', { name: developer }).waitFor();
      assert.equal(requests, 2, 'different tab must trigger a new comparison read');
      accessDenied = true;
      await updater.evaluate(() => localStorage.setItem('colliers:compare-revision', 'browser-fixture-denied'));
      await page.getByRole('alert').filter({ hasText: '合成权限已撤销' }).waitFor();
      assert.equal(await page.getByRole('table').count(), 0, 'denied refresh must discard the old comparison data');
      assert.deepEqual(violations, []);
      observations.push({ width, requests, shortReturnRequests: 0, crossTabRefresh: 'pass', denial: 'pass', searchFocus: 'pass' });
    } finally { await context.close(); }
  }
  console.log(JSON.stringify({ status: 'pass', browser: await browser.version(), environment: 'local production build, isolated browser data', observations }));
} finally { await browser.close(); }
