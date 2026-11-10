import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const base = new URL(process.argv[2]);
const baseline = process.argv.includes('--baseline');
assert.ok(['127.0.0.1', 'localhost'].includes(base.hostname), 'isolated loopback builds only');
const { chromium } = createRequire(import.meta.url)(process.env.PERF_PLAYWRIGHT_MODULE || 'playwright-core');
const browser = await chromium.launch({ ...(process.env.PERF_BROWSER_CHANNEL === 'chromium' ? {} : { channel: 'chrome' }), headless: true });
const user = { id: '23456789-1111-4111-8111-111111111111', email: 'directory@example.test', app_metadata: {}, user_metadata: {} };
const expires_at = Math.floor(Date.now() / 1000) + 3600;
const encode = value => Buffer.from(JSON.stringify(value)).toString('base64url');
const token = `${encode({ alg: 'HS256' })}.${encode({ sub: user.id, exp: expires_at, aud: 'authenticated', session_id: user.id })}.fixture`;
const session = { user, expires_at, expires_in: 3600, token_type: 'bearer', refresh_token: 'synthetic', access_token: token };
const users = [
  { user_id: 'fixture-a', chinese_name: 'Alpha 用户', email: 'alpha@example.test', phone: '13000000000', role: 'editor', disabled: true },
  { user_id: 'fixture-b', chinese_name: 'Beta 用户', email: 'beta@example.test', phone: '13000000001', role: 'user', disabled: false },
];
const assignments = [{ user_id: 'fixture-a', stock_assignment_count: 3, future_assignment_count: 4 }];
const observations = [];
try {
  for (const width of [1280, 390]) {
    const context = await browser.newContext({ viewport: { width, height: 844 }, isMobile: width === 390, hasTouch: width === 390, serviceWorkers: 'block' });
    let releaseCounts;
    const heldCounts = new Promise(resolve => { releaseCounts = resolve; });
    try {
      const calls = { directory: 0, assignments: 0, combined: 0, dryRuns: 0, writes: 0 };
      await context.routeWebSocket(/.*/, ws => ws.close());
      await context.route('**/*', async route => {
        const request = route.request();
        const url = new URL(request.url());
        if (url.origin === base.origin && url.pathname === '/api/admin/users') {
          if (request.method() === 'PATCH' && request.postDataJSON()?.dryRun === true) {
            assert.deepEqual(request.postDataJSON(), {
              action: 'transfer_assignments', userId: 'fixture-a', targetUserId: 'fixture-b',
              includeStock: true, includeFuture: true, dryRun: true,
            });
            calls.dryRuns++;
            return route.fulfill({ json: { stockCount: 3, futureCount: 4, totalCount: 7 } });
          }
          if (request.method() !== 'GET') { calls.writes++; return route.fulfill({ status: 500 }); }
          const view = url.searchParams.get('view');
          if (view === 'directory') { calls.directory++; return route.fulfill({ json: { users } }); }
          if (view === 'assignments') { calls.assignments++; await heldCounts; return route.fulfill({ json: { assignments } }); }
          calls.combined++;
          await heldCounts;
          return route.fulfill({ json: { users: users.map(userRow => ({ ...userRow, stock_assignment_count: 0, future_assignment_count: 0,
            ...assignments.find(entry => entry.user_id === userRow.user_id) })) } });
        }
        if (url.origin === base.origin) return url.pathname.startsWith('/api/') ? route.fulfill({ status: 204 }) : route.continue();
        if (url.origin !== 'https://example.supabase.co') return route.abort();
        const headers = { 'access-control-allow-origin': '*', 'access-control-allow-methods': 'GET, POST, HEAD, OPTIONS', 'access-control-allow-headers': '*' };
        if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers });
        if (url.pathname === '/auth/v1/user') return route.fulfill({ headers, json: user });
        if (url.pathname === '/rest/v1/user_roles') return route.fulfill({ headers, json: [{ role: 'admin', user_id: user.id, session_id: user.id, full_name: '合成用户' }] });
        return route.fulfill({ headers, json: [] });
      });
      await context.addInitScript(({ origin, session }) => {
        if (location.origin !== origin) return;
        localStorage.setItem('colliers_trusted_device_until', String(Date.now() + 86_400_000));
        localStorage.setItem('sb-example-auth-token', JSON.stringify(session));
      }, { origin: base.origin, session });
      const page = await context.newPage();
      page.setDefaultTimeout(10_000);
      const requestStarted = page.waitForRequest(request => new URL(request.url()).pathname === '/api/admin/users');
      await page.goto(new URL('/admin?section=users', base).href);
      await requestStarted;
      const first = page.getByText('Alpha 用户', { exact: true });
      if (baseline) {
        await page.waitForTimeout(250);
        assert.equal(await first.count(), 0, 'baseline directory waits for the assignment counts');
      } else {
        await first.waitFor();
        await page.getByText('已停用', { exact: true }).waitFor();
        assert.equal(await page.getByText('0 个存量', { exact: true }).count(), 0);
        await page.getByText('统计加载中…', { exact: true }).first().waitFor();
        const row = page.getByRole('row').filter({ hasText: 'Alpha 用户' });
        await row.getByRole('button', { name: '管理', exact: true }).click();
        const dialog = page.getByRole('dialog');
        await dialog.getByLabel('接收人').selectOption('fixture-b');
        await dialog.getByRole('button', { name: '核对任务', exact: true }).click();
        await dialog.getByText('存量 3 · 未来供应 4').waitFor();
        await dialog.getByRole('button', { name: '关闭', exact: true }).click();
        await dialog.waitFor({ state: 'hidden' });
      }
      const directoryBeforeCounts = await first.count() > 0;
      const input = page.getByPlaceholder('搜索姓名、邮箱、电话或角色');
      await input.pressSequentially('Alpa');
      if (!baseline) await page.getByText('没有找到匹配的用户').waitFor();
      await input.evaluate(element => element.setSelectionRange(3, 3));
      await page.keyboard.type('h');
      releaseCounts();
      await first.waitFor();
      await page.getByText('3 个存量', { exact: true }).waitFor();
      await page.getByText('· 4 个未来', { exact: true }).waitFor();
      await page.getByText('已停用', { exact: true }).waitFor();
      assert.deepEqual(await input.evaluate(element => [element === document.activeElement, element.value, element.selectionStart]), [true, 'Alpha', 4]);
      await page.getByRole('button', { name: '管理', exact: true }).click();
      await page.getByRole('dialog').waitFor();
      assert.equal(calls.writes, 0);
      assert.equal(calls.dryRuns, baseline ? 0 : 1);
      assert.equal(calls.combined, baseline ? 1 : 0);
      assert.equal(calls.directory, baseline ? 0 : 1);
      assert.equal(calls.assignments, baseline ? 0 : 1);
      observations.push({ width, directoryBeforeCounts, ...calls });
    } finally { releaseCounts(); await context.close(); }
  }
  console.log(JSON.stringify({ status: 'pass', baseline, browser: browser.version(), observations }, null, 2));
} finally { await browser.close(); }
