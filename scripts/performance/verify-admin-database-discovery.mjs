import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const base = new URL(process.argv[2]);
const baseline = process.argv.includes('--baseline');
assert.ok(['127.0.0.1', 'localhost'].includes(base.hostname), 'isolated loopback builds only');
const { chromium } = createRequire(import.meta.url)(process.env.PERF_PLAYWRIGHT_MODULE || 'playwright-core');
const browser = await chromium.launch({ ...(process.env.PERF_BROWSER_CHANNEL === 'chromium' ? {} : { channel: 'chrome' }), headless: true });
const user = { id: '12345678-1111-4111-8111-111111111111', email: 'database@example.test', app_metadata: {}, user_metadata: {} };
const expires_at = Math.floor(Date.now() / 1000) + 3600;
const encode = value => Buffer.from(JSON.stringify(value)).toString('base64url');
const token = `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode({ sub: user.id, exp: expires_at, aud: 'authenticated', session_id: user.id })}.fixture`;
const session = { user, expires_at, expires_in: 3600, token_type: 'bearer', refresh_token: 'synthetic', access_token: token };
const observations = [];

try {
  for (const { width, role, discoveryFails } of [{ width: 1280, role: 'admin' }, { width: 390, role: 'admin' },
    { width: 390, role: 'viewer' }, { width: 390, role: 'admin', discoveryFails: true }]) {
    const context = await browser.newContext({ viewport: { width, height: 844 }, isMobile: width === 390, hasTouch: width === 390, serviceWorkers: 'block' });
    let release;
    const held = new Promise(resolve => { release = resolve; });
    try {
      const calls = { dictionary: 0, discovery: 0, metrics: 0, extra: 0, mutations: 0 };
      await context.routeWebSocket(/.*/, ws => ws.close());
      await context.route('**/*', async route => {
        const req = route.request(); const url = new URL(req.url());
        if (url.origin === base.origin) return url.pathname.startsWith('/api/') ? route.fulfill({ status: 204 }) : route.continue();
        if (url.origin !== 'https://example.supabase.co') return route.abort();
        const headers = { 'access-control-allow-origin': '*', 'access-control-allow-methods': 'GET, POST, HEAD, OPTIONS', 'access-control-allow-headers': '*' };
        if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers });
        if (url.pathname === '/auth/v1/user') return route.fulfill({ headers, json: user });
        const table = url.pathname.replace('/rest/v1/', '');
        let data = [];
        if (table === 'user_roles') data = [{ role, user_id: user.id, session_id: user.id, full_name: '合成账号' }];
        if (table === 'buildings') {
          if (url.searchParams.get('select')?.includes('is_active,former_names')) calls.dictionary++;
          data = [{ id: 'fixture-building', name: '隔离台账项目', grade: 'A', submarket: 'CBD', is_active: true, tracking_scope: 'tracked' }];
        }
        if (table === 'building_metrics') {
          calls.metrics++;
          data = [{ id: 'fixture-metric', building_id: 'fixture-building', record_year: 2026, record_quarter: 3, net_effective_rent: 55 }];
        }
        if (table === 'rpc/get_all_tables') {
          calls.discovery++;
          await held;
          if (discoveryFails) return route.fulfill({ status: 500, headers, json: { message: 'isolated discovery failure' } });
          data = [{ table_name: 'fixture_extra', table_comment: '合成扩展表' }];
        }
        if (table === 'rpc/get_table_columns') data = [{ column_name: 'id', data_type: 'uuid' }, { column_name: 'name', data_type: 'text', column_comment: '名称' }];
        if (table === 'fixture_extra') { calls.extra++; data = [{ id: 'fixture-extra', name: '扩展表记录' }]; }
        if (!['GET', 'HEAD'].includes(req.method()) && !table.startsWith('rpc/')) calls.mutations++;
        return route.fulfill({ headers, json: data });
      });
      await context.addInitScript(({ origin, session }) => {
        if (location.origin !== origin) return;
        localStorage.setItem('colliers_trusted_device_until', String(Date.now() + 86_400_000));
        localStorage.setItem('sb-example-auth-token', JSON.stringify(session));
      }, { origin: base.origin, session });
      const page = await context.newPage();
      const dictionary = page.waitForResponse(res => {
        const url = new URL(res.url());
        return url.pathname === '/rest/v1/buildings' && url.searchParams.get('select')?.includes('is_active,former_names') && res.ok();
      }, { timeout: 8000 }).catch(() => null);
      await page.goto(new URL('/admin?section=database', base).href);
      if (role !== 'admin') {
        await page.waitForURL(base.href);
        assert.deepEqual(calls, { dictionary: 0, discovery: 0, metrics: 0, extra: 0, mutations: 0 });
        observations.push({ width, role, protectedRequests: 0 });
        continue;
      }
      assert.ok(await dictionary, 'administrator reached the actual database dictionary read');
      const count = page.getByText('1 条', { exact: true });
      if (baseline) {
        await page.waitForTimeout(250);
        assert.equal(calls.discovery, 1);
        assert.equal(calls.metrics, 0, 'baseline ledger waits for optional table discovery');
      } else {
        await count.waitFor({ timeout: 7000 });
        assert.equal(calls.discovery, 1);
        assert.equal(calls.metrics, 1, 'ledger can load while table discovery is unresolved');
      }
      const ledgerReadsBeforeDiscovery = calls.metrics;
      const search = page.locator('input[placeholder="搜索"]:visible');
      if (!baseline && !discoveryFails) {
        await search.focus();
        await search.pressSequentially('z');
        await page.getByText('0 / 1 条', { exact: true }).waitFor({ timeout: 7000 });
      }
      if (discoveryFails) {
        const failed = page.waitForResponse(res => new URL(res.url()).pathname === '/rest/v1/rpc/get_all_tables' && res.status() === 500);
        release();
        await failed;
        await count.waitFor({ timeout: 7000 });
        assert.equal(calls.extra, 0);
        assert.equal(calls.mutations, 0);
        observations.push({ width, role, ledgerReadsBeforeDiscovery, ledgerReady: true, discoveryFails: true });
        continue;
      }
      release();
      if (width === 390) await page.locator('option[value="auto:fixture_extra"]').waitFor({ state: 'attached' });
      else await page.getByRole('button', { name: '更多表 (1)' }).waitFor();
      if (!baseline) {
        assert.equal(await search.evaluate(element => element === document.activeElement), true);
        await search.pressSequentially('x');
        await search.press('Home');
        await search.pressSequentially('y');
        assert.deepEqual(await search.evaluate(element => [element.value, element.selectionStart]), ['yzx', 1]);
        await search.fill('');
      }
      await count.waitFor({ timeout: 7000 });
      if (width === 390) await page.getByRole('combobox', { name: '选择数据表' }).selectOption('auto:fixture_extra');
      else {
        await page.getByRole('button', { name: '更多表 (1)' }).click();
        await page.getByRole('button', { name: /合成扩展表/ }).click();
      }
      await page.getByText('扩展表记录', { exact: true }).filter({ visible: true }).waitFor({ timeout: 7000 });
      assert.equal(calls.extra, 1);
      assert.equal(calls.mutations, 0);
      observations.push({ width, role, ledgerReadsBeforeDiscovery, ledgerReady: true, extraReady: true });
    } finally { release(); await context.close(); }
  }
  console.log(JSON.stringify({ status: 'pass', baseline, browser: browser.version(), observations }));
} finally { await browser.close(); }
