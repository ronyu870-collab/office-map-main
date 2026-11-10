import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { writeFile } from 'node:fs/promises';

const args = process.argv.slice(2);
const benchmark = args[0] === '--benchmark';
const variants = benchmark ? [['before', args[1]], ['after', args[2]]] : [['after', args[0]]];
for (const [, base] of variants) {
  assert.ok(['127.0.0.1', 'localhost'].includes(new URL(base).hostname), 'isolated loopback builds only');
}
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PERF_PLAYWRIGHT_MODULE || 'playwright-core');
const browser = await chromium.launch({
  ...(process.env.PERF_BROWSER_CHANNEL === 'chromium' ? {} : { channel: 'chrome' }), headless: true,
});
const fixtureOrigin = 'https://example.supabase.co'; // Both builds use the repo's credential-free default.
const id = '12345678-1111-4111-8111-111111111111';
const encode = value => Buffer.from(JSON.stringify(value)).toString('base64url');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const rows = [];

function session(required, expiresIn) {
  const user = { id, aud: 'authenticated', email: 'home-fixture@example.test', app_metadata: { must_change_password: required }, user_metadata: {} };
  const expires_at = Math.floor(Date.now() / 1000) + expiresIn;
  return { user, expires_at, expires_in: expiresIn, token_type: 'bearer', refresh_token: 'synthetic',
    access_token: encode({ alg: 'HS256', typ: 'JWT' }) + '.' + encode({ sub: id, exp: expires_at, aud: 'authenticated', session_id: id }) + '.fixture' };
}

async function measure([variant, base], spec, round) {
  const origin = new URL(base).origin;
  const mobile = spec.network === 'mobile';
  const context = await browser.newContext({ viewport: mobile ? { width: 390, height: 844 } : { width: 1280, height: 900 },
    isMobile: mobile, hasTouch: mobile, serviceWorkers: 'block' });
  const row = { variant, scenario: spec.name, round, network: spec.network, roleDelay: spec.roleMs, refreshDelay: spec.refreshMs,
    roleRequests: 0, refreshRequests: 0, homeDocuments: 0, loginDocuments: 0, mapDataRequests: 0,
    mapSdkRequests: 0, activityRequests: 0, earlyProtectedRequests: 0, roleComplete: false };
  const localEpoch = Date.now();
  let profileMs = null;
  try {
    const saved = session(spec.mode === 'required', spec.mode === 'expired' || spec.mode === 'rejected' ? -10 : 3600);
    const refreshed = session(false, 3600);
    await context.routeWebSocket(/.*/, ws => ws.close());
    await context.route('**/*', async route => {
      const request = route.request();
      const u = new URL(request.url());
      const method = request.method();
      if (u.origin === origin) {
        if (u.pathname === '/api/map/data') {
          row.mapDataRequests++;
          if (!row.roleComplete) row.earlyProtectedRequests++;
          return route.fulfill({ status: 503, json: { error: 'synthetic map stop after guard' } });
        }
        if (u.pathname.startsWith('/api/')) return route.fulfill({ status: 204 });
        if (request.resourceType() === 'document') {
          if (u.pathname === '/') row.homeDocuments++;
          if (u.pathname === '/login') row.loginDocuments++;
        }
        return route.continue();
      }
      if (u.origin === fixtureOrigin) {
        const headers = { 'access-control-allow-origin': '*', 'access-control-allow-methods': 'GET, POST, OPTIONS',
          'access-control-allow-headers': '*' };
        if (method === 'OPTIONS') return route.fulfill({ status: 204, headers });
        if (u.pathname === '/rest/v1/user_roles' && method === 'GET') {
          row.roleRequests++;
          await delay(spec.roleMs);
          row.roleComplete = true;
          profileMs ??= Date.now() - localEpoch;
          return route.fulfill({ headers, json: [{ role: 'viewer', full_name: 'Synthetic Viewer', chinese_name: null, session_id: id, phone: null }] });
        }
        if (u.pathname === '/auth/v1/token' && method === 'POST') {
          row.refreshRequests++;
          await delay(spec.refreshMs);
          if (spec.mode === 'rejected') return route.fulfill({ headers, status: 400, json: { error_code: 'refresh_token_not_found', message: 'Fixture rejection' } });
          return route.fulfill({ headers, json: refreshed });
        }
        if (u.pathname.startsWith('/rest/v1/') && method === 'GET') {
          if (/messages|notice|admin_issue/.test(u.pathname)) row.activityRequests++;
          return route.fulfill({ headers, json: [] });
        }
      }
      if (/(^|\.)amap\.com$/.test(u.hostname)) {
        row.mapSdkRequests++;
        if (!row.roleComplete) row.earlyProtectedRequests++;
      }
      return route.abort();
    });
    await context.addInitScript(({ origin, mode, saved }) => {
      if (location.origin !== origin) return;
      const marker = '__colliers_perf_home_document_start';
      if (location.pathname === '/' && !sessionStorage.getItem(marker)) {
        sessionStorage.setItem(marker, String(performance.timeOrigin));
        if (mode !== 'anonymous') {
          localStorage.setItem('colliers_trusted_device_until', String(Date.now() + 86_400_000));
          localStorage.setItem('sb-example-auth-token', JSON.stringify(saved));
        }
      }
      const from = Number(sessionStorage.getItem(marker)) || performance.timeOrigin;
      const marks = window.__homeColdMarks = { timeOrigin: performance.timeOrigin };
      const frameMark = (name, element) => {
        if (!element || marks[name] !== undefined) return;
        marks[name] = null;
        requestAnimationFrame(() => requestAnimationFrame(() => {
          marks[name] = element.isConnected ? Math.round(performance.timeOrigin + performance.now() - from) : undefined;
        }));
      };
      const inspect = () => {
        frameMark('mapLink', document.querySelector('a[href="/map"]:not([aria-disabled="true"]) #home-heading'));
        frameMark('fullHome', document.querySelector('button[aria-label="用户菜单"]'));
        frameMark('loginForm', document.querySelector('form input#password'));
      };
      new MutationObserver(inspect).observe(document, { childList: true, subtree: true });
      document.addEventListener('DOMContentLoaded', inspect, { once: true });
    }, { origin, mode: spec.mode, saved });
    const page = await context.newPage();
    if (mobile) {
      const cdp = await context.newCDPSession(page);
      await cdp.send('Network.enable');
      await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 150, downloadThroughput: 10_000_000 / 8, uploadThroughput: 5_000_000 / 8 });
      await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
    }
    await page.goto(origin + '/', { waitUntil: 'commit', timeout: 10_000 }).catch(error => {
      // A parser-time location.replace can supersede goto before its commit reply.
      if (!String(error).includes('ERR_ABORTED')) throw error;
    });
    const mark = name => page.waitForFunction(key => Number.isFinite(window.__homeColdMarks?.[key]), name, { timeout: 10_000 });
    if (spec.mode === 'anonymous' || spec.mode === 'rejected') {
      await page.waitForURL('**/login', { timeout: 10_000 });
      await mark('loginForm');
      if (spec.behavior) {
        const toggle = page.getByRole('button', { name: '显示密码' });
        await toggle.waitFor();
        await page.waitForLoadState('load');
        await toggle.click();
        assert.equal(await page.locator('#password').getAttribute('type'), 'text', 'login form must accept a real click');
      }
    } else if (spec.mode === 'required') {
      await page.waitForURL('**/settings?required=1', { timeout: 10_000 });
    } else {
      await mark('mapLink');
      row.roleCompleteAtMapLink = row.roleComplete;
      if (spec.click) {
        const map = page.getByRole('link', { name: '北京办公楼市场地图', exact: true });
        const protectedRead = spec.behavior ? page.waitForRequest(request =>
          new URL(request.url()).pathname === '/api/map/data', { timeout: 10_000 }).catch(() => null) : null;
        await map.click({ timeout: 6_000 });
        row.roleCompleteAtClick = row.roleComplete;
        await page.waitForURL('**/map', { timeout: 8_000 });
        await page.locator('header h1').filter({ hasText: '北京办公楼市场地图' }).waitFor({ timeout: 6_000 });
        row.mapPath = '/map';
        row.roleCompleteAtMapNavigation = row.roleComplete;
        row.mapNavigation = await page.evaluate(() => Math.round(performance.timeOrigin + performance.now() -
          Number(sessionStorage.getItem('__colliers_perf_home_document_start'))));
        if (protectedRead) {
          assert.ok(await protectedRead, 'the authenticated map must start its real data path after recovery');
          assert.equal(row.roleComplete, true);
        }
      } else {
        await mark('fullHome');
        if (spec.behavior) {
          const menu = page.getByRole('button', { name: '用户菜单', exact: true });
          await menu.click();
          await page.getByRole('menuitem', { name: '修改密码' }).waitFor();
          assert.equal(await page.getByRole('menuitem', { name: '系统管理' }).count(), 0, 'viewer must not see admin');
          await page.keyboard.press('Escape');
          const feedback = page.getByRole('button', { name: '问题与建议' });
          await feedback.waitFor();
          if (!spec.snapshot) {
            await feedback.click();
            await page.getByRole('dialog', { name: '问题与建议' }).waitFor();
            await page.getByRole('button', { name: '关闭反馈窗口' }).click();
          }
        }
      }
    }
    row.path = new URL(page.url()).pathname;
    Object.assign(row, await page.evaluate(() => {
      const m = window.__homeColdMarks;
      return { mapLink: m?.mapLink ?? null, fullHome: m?.fullHome ?? null, loginForm: m?.loginForm ?? null };
    }));
    if (spec.snapshot) {
      const dir = process.env.PERF_HOME_SCREENSHOTS;
      if (dir) await page.screenshot({ path: dir + '/' + variant + '-' + spec.network + '.png', animations: 'disabled' });
    }
    row.profileResponseFromTestStart = profileMs;
  } catch (error) {
    row.failure = String(error).slice(0, 350);
  } finally {
    await context.close();
  }
  return row;
}

const desktop = { network: 'desktop', roleMs: 700, refreshMs: 400, mode: 'valid' };
try {
  if (benchmark) {
    const samples = Number(args[4] || 20);
    const configs = [
      { ...desktop, name: 'reopen-desktop', count: samples },
      { ...desktop, name: 'reopen-mobile', network: 'mobile', count: samples },
      { ...desktop, name: 'refresh-mobile', network: 'mobile', mode: 'expired', count: Math.max(6, samples / 2) },
      { ...desktop, name: 'anonymous-mobile', network: 'mobile', mode: 'anonymous', count: Math.max(6, samples / 2) },
      { ...desktop, name: 'click-before-profile', roleMs: 1800, click: true, count: 3 },
    ];
    for (const spec of configs) for (let round = 1; round <= spec.count; round++) {
      for (const v of (round % 2 ? variants : [...variants].reverse())) rows.push(await measure(v, spec, round));
      if (round === spec.count || round % 5 === 0) console.log(spec.name, round, rows.filter(x => x.failure).length, 'failures so far');
    }
    const screenshots = process.env.PERF_HOME_SCREENSHOTS;
    if (screenshots) for (const network of ['desktop', 'mobile']) for (const v of variants) {
      rows.push(await measure(v, { ...desktop, network, name: 'layout-review', behavior: true, snapshot: true }, 1));
    }
  } else {
    const cases = [
      { ...desktop, name: 'anonymous', mode: 'anonymous', behavior: true },
      { ...desktop, name: 'reopen', behavior: true },
      { ...desktop, name: 'refresh', mode: 'expired' },
      { ...desktop, name: 'click', roleMs: 1800, click: true, behavior: true },
      { ...desktop, name: 'force-password', mode: 'required' },
      { ...desktop, name: 'rejected-refresh', mode: 'rejected', behavior: true },
    ];
    for (const spec of cases) rows.push(await measure(variants[0], spec, 1));
  }
  const result = { browser: browser.version(), environment: 'isolated production builds; no external requests; synthetic browser session and upstream delays',
    notes: ['Times use navigation clock including anonymous document replacement.', 'Mobile profile: 390×844, CDP 150ms latency, 10Mbps down, 4x CPU throttle.', 'Map route entry is measured separately from map data and tiles.'], rows };
  if (benchmark) await writeFile(args[3], JSON.stringify(result, null, 2) + '\n');
  else console.log(JSON.stringify(result));
  assert.equal(rows.filter(row => row.failure).length, 0, 'sample failures are retained and must be investigated');
  if (!benchmark) {
    const [anonymous, reopen, refresh, click, required, rejected] = rows;
    assert.equal(anonymous.loginDocuments, 1, 'cold anonymous request must take the parser-time login path');
    assert.equal(anonymous.roleRequests, 0);
    assert.equal(reopen.roleCompleteAtMapLink, false, 'map link waits behind profile');
    assert.equal(reopen.roleRequests, 1, 'same-credential startup issued duplicate profile requests');
    assert.equal(refresh.refreshRequests, 1);
    assert.equal(refresh.roleRequests, 1);
    assert.equal(click.mapPath, '/map');
    assert.equal(click.roleCompleteAtClick, false, 'map could not be clicked while the profile was pending');
    assert.equal(click.roleCompleteAtMapNavigation, false, 'the map route loading view still waited for the profile');
    assert.equal(required.mapLink, null, 'force-password session must never expose the early map link');
    assert.equal(required.path, '/settings');
    assert.equal(rejected.mapLink, null, 'rejected session must never expose the early map link');
    assert.equal(rejected.path, '/login');
    assert.ok(rows.every(row => row.earlyProtectedRequests === 0), 'protected map reads fired before profile resolution');
  }
} finally {
  await browser.close();
}
