import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { setTimeout as delay } from 'node:timers/promises';

const base = new URL(process.argv[2]);
assert.ok(['127.0.0.1', 'localhost'].includes(base.hostname), 'isolated loopback builds only');
const { chromium } = createRequire(import.meta.url)(process.env.PERF_PLAYWRIGHT_MODULE || 'playwright-core');
const browser = await chromium.launch({ ...(process.env.PERF_BROWSER_CHANNEL === 'chromium' ? {} : { channel: 'chrome' }), headless: true });
const user = { id: '23456789-1111-4111-8111-111111111111', email: 'auditor@example.test', app_metadata: {}, user_metadata: {} };
const expires_at = Math.floor(Date.now() / 1000) + 3600;
const encode = value => Buffer.from(JSON.stringify(value)).toString('base64url');
const token = `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode({ sub: user.id, exp: expires_at, aud: 'authenticated', session_id: user.id })}.fixture`;
const session = { user, expires_at, expires_in: 3600, token_type: 'bearer', refresh_token: 'synthetic', access_token: token };
const data = ['Alpha 东楼', 'Alpha 西楼', 'Alps 楼'].map((target_name, index) => ({
  id: index + 1, user_id: user.id, actor_kind: 'user', actor_name: '合成管理员',
  action_type: 'BUILDING_PHOTO_IMPORT', target_name, created_at: '2026-11-10T08:00:00Z', details: { photo_count: 1 },
}));
const observations = [];

try {
  for (const spec of [{ width: 1280, role: 'admin' }, { width: 390, role: 'admin' }, { width: 1280, role: 'viewer' }]) {
    const { width, role } = spec;
    const context = await browser.newContext({ viewport: { width, height: 844 }, isMobile: width === 390, hasTouch: width === 390, serviceWorkers: 'block' });
    try {
      const queries = [];
      let roleConfirmed = false;
      let unblockAlps;
      const alpsBlocked = new Promise(resolve => { unblockAlps = resolve; });
      await context.routeWebSocket(/.*/, ws => ws.close());
      await context.route('**/*', async route => {
        const request = route.request();
        const url = new URL(request.url());
        if (url.origin === base.origin) return url.pathname.startsWith('/api/') ? route.fulfill({ status: 204 }) : route.continue();
        if (url.origin !== 'https://example.supabase.co') return route.abort();
        const headers = { 'access-control-allow-origin': '*', 'access-control-allow-methods': 'GET, HEAD, OPTIONS',
          'access-control-allow-headers': '*', 'access-control-expose-headers': 'content-range' };
        if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers });
        if (url.pathname === '/rest/v1/user_roles') {
          roleConfirmed = true;
          return route.fulfill({ headers, json: [{ role, user_id: user.id, session_id: user.id, full_name: 'Fixture Admin' }] });
        }
        if (url.pathname === '/rest/v1/audit_logs') {
          const term = url.searchParams.get('target_name')?.slice(7, -1) ?? '';
          const method = request.method();
          queries.push({ method, term, authorized: roleConfirmed && role === 'admin' && request.headers().authorization === `Bearer ${token}` });
          if (term === 'Alps' && method === 'GET') await alpsBlocked;
          const rows = data.filter(row => row.target_name.includes(term));
          const responseHeaders = { ...headers, 'content-range': rows.length ? `0-${rows.length - 1}/${rows.length}` : '*/0' };
          return route.fulfill(method === 'HEAD' ? { headers: responseHeaders } : { headers: responseHeaders, json: rows }).catch(() => undefined);
        }
        return route.fulfill({ headers, json: [] });
      });
      await context.addInitScript(({ origin, session }) => {
        if (location.origin !== origin || localStorage.getItem('sb-example-auth-token')) return;
        localStorage.setItem('colliers_trusted_device_until', String(Date.now() + 86_400_000));
        localStorage.setItem('sb-example-auth-token', JSON.stringify(session));
      }, { origin: base.origin, session });
      const page = await context.newPage();
      page.setDefaultTimeout(8000);
      await page.goto(new URL('/admin?section=logs', base).href);
      if (role === 'viewer') {
        await page.waitForURL(base.href);
        assert.deepEqual(queries, [], 'viewers must not fetch protected audit data');
        observations.push({ width, role, protectedRequests: 0 });
        continue;
      }
      const row = (name) => page.locator('article').filter({ hasText: name });
      await row('Alpha 东楼').waitFor();
      const input = page.getByPlaceholder('搜索对象 / 文件名');
      await input.pressSequentially('Alpha', { delay: 25 });
      await page.getByText('2 条', { exact: true }).waitFor();
      const rapid = queries.filter(query => query.term);
      assert.deepEqual(rapid.filter(query => query.method === 'GET').map(query => query.term), ['Alpha'], 'one row request for a rapid five-character search');
      assert.deepEqual(rapid.filter(query => query.method === 'HEAD').map(query => query.term), Array(6).fill('Alpha'), 'one pass of exact tab counts');
      assert.equal(await input.evaluate(element => document.activeElement === element && element.selectionStart === 5), true);
      assert.equal(await row('Alps 楼').count(), 0);

      try {
        const pending = page.waitForRequest(request => request.method() === 'GET' && new URL(request.url()).searchParams.get('target_name') === 'ilike.%Alps%');
        await input.fill('Alps');
        await pending;
        const newer = page.waitForResponse(response => response.request().method() === 'GET' && new URL(response.url()).searchParams.get('target_name') === 'ilike.%Alpha%');
        await input.fill('Alpha');
        await newer;
        await row('Alpha 西楼').waitFor();
        await page.getByText('2 条', { exact: true }).waitFor();
      } finally { unblockAlps(); }
      await delay(80);
      assert.equal(await row('Alps 楼').count(), 0, 'an older response cannot overwrite the current search');
      await row('Alpha 东楼').getByRole('button').first().click();
      await row('Alpha 东楼').getByText('操作对象：').waitFor();
      assert.ok(queries.every(query => query.authorized));
      observations.push({ width, role, rapidRowRequests: 1, rapidExactCountRequests: 6, lateResponse: 'discarded', focus: 'preserved' });
    } finally { await context.close(); }
  }
  console.log(JSON.stringify({ status: 'pass', browser: await browser.version(), environment: 'local production build with isolated REST responses', observations }));
} finally { await browser.close(); }
