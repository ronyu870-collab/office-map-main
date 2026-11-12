import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const base = new URL(process.argv[2]);
const baseline = process.argv.includes('--baseline');
assert.ok(['127.0.0.1', 'localhost'].includes(base.hostname), 'isolated loopback builds only');
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PERF_PLAYWRIGHT_MODULE || 'playwright-core');
const browser = await chromium.launch({
  ...(process.env.PERF_BROWSER_CHANNEL === 'chromium' ? {} : { channel: 'chrome' }), headless: true,
});
const account = { id: '12345678-1111-4111-8111-111111111111', email: 'team@example.test', app_metadata: {}, user_metadata: {} };
const expires_at = Math.floor(Date.now() / 1000) + 3600;
const encode = value => Buffer.from(JSON.stringify(value)).toString('base64url');
const token = `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode({ sub: account.id, exp: expires_at, aud: 'authenticated', session_id: account.id })}.fixture`;
const session = { user: account, expires_at, expires_in: 3600, token_type: 'bearer', refresh_token: 'synthetic', access_token: token };
const names = ['合成顾问甲', '合成顾问乙', '演示账号', '合成离职顾问'];
const ids = names.map((_, i) => `2222222${i}-2222-4222-8222-222222222222`);
const brokers = names.slice(0, 3).map((name, i) => ({ name, user_id: ids[i] }));
const submissions = Array.from({ length: 26 }, (_, i) => {
  const owner = i === 25 ? 2 : i === 24 ? 3 : i === 23 ? 1 : 0;
  return { id: String(i), company: `合成团队企业 ${String(i + 1).padStart(2, '0')}`, new_building: '合成楼宇',
    submitter_id: ids[owner], submitter_name: names[owner], submitter_active: owner !== 3,
    transaction_year: 2026, transaction_quarter: 'Q2', area_sqm: 100 + i, remarks: `合成备注 ${i + 1}`, created_at: '2026-05-04T12:00:00Z' };
});

try {
  const observations = [];
  for (const { width, role, simulated = false } of [
    { width: 1280, role: 'admin' }, { width: 390, role: 'admin' },
    { width: 390, role: 'viewer' }, { width: 390, role: 'viewer', simulated: true },
  ]) {
    const context = await browser.newContext({ viewport: { width, height: 844 }, isMobile: width === 390, hasTouch: width === 390, serviceWorkers: 'block' });
    let release;
    const gate = new Promise(resolve => { release = resolve; });
    const requests = { directory: 0, detail: 0 };
    try {
      await context.routeWebSocket(/.*/, ws => ws.close());
      await context.route('**/*', async route => {
        const req = route.request();
        const url = new URL(req.url());
        if (url.origin === base.origin) {
          if (url.pathname === '/api/brokers') {
            assert.equal(req.headers().authorization, `Bearer ${token}`);
            if (++requests.directory === 1) {
              await gate;
              if (!baseline) return route.fulfill({ status: 503, json: { error: '隔离人员目录失败' } });
            }
            return route.fulfill({ json: { brokers } });
          }
          if (url.pathname === '/api/lease-submission/team-submissions') {
            assert.equal(req.headers().authorization, `Bearer ${token}`);
            requests.detail++;
            return route.fulfill({ json: { submissions } });
          }
          if (url.pathname.startsWith('/api/')) return route.fulfill({ status: 204 });
          return route.continue();
        }
        if (url.origin !== 'https://example.supabase.co') return route.abort();
        const headers = { 'access-control-allow-origin': '*', 'access-control-allow-methods': 'GET, HEAD, OPTIONS', 'access-control-allow-headers': '*' };
        if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers });
        if (url.pathname === '/auth/v1/user') return route.fulfill({ headers, json: account });
        if (url.pathname === '/rest/v1/user_roles') return route.fulfill({ headers, json: [{ role: simulated ? 'admin' : role, session_id: account.id, full_name: '合成账号' }] });
        return route.fulfill({ headers, json: [] });
      });
      await context.addInitScript(({ origin, session, simulated, target }) => {
        if (location.origin !== origin || localStorage.getItem('sb-example-auth-token')) return;
        localStorage.setItem('colliers_trusted_device_until', String(Date.now() + 86_400_000));
        localStorage.setItem('sb-example-auth-token', JSON.stringify(session));
        if (simulated) sessionStorage.setItem('__impersonation_state', JSON.stringify({
          targetUserId: target, targetEmail: 'simulated@example.test', targetDisplayName: '合成模拟账号', targetRole: 'viewer',
          adminUserId: session.user.id, adminEmail: session.user.email, startedAt: Date.now(),
        }));
      }, { origin: base.origin, session, simulated, target: ids[0] });
      const page = await context.newPage();
      const detailResponse = role === 'admin' ? page.waitForResponse(response => new URL(response.url()).pathname === '/api/lease-submission/team-submissions') : null;
      await page.goto(new URL('/lease-submission/monitoring', base).href, { waitUntil: 'domcontentloaded' });
      if (role !== 'admin') {
        await page.waitForURL(url => url.pathname === '/');
        if (!baseline) {
          assert.deepEqual(requests, { directory: 0, detail: 0 });
          if (simulated) {
            const activeRole = await page.evaluate(() => JSON.parse(sessionStorage.getItem('__impersonation_state'))?.targetRole);
            assert.equal(activeRole, 'viewer', 'the fixture must still be in simulated viewer mode after denial');
          }
        }
        observations.push({ width, role, simulated, requests });
        continue;
      }
      await detailResponse;
      const all = page.getByRole('heading', { name: '团队全量明细' });
      const brokerA = page.getByRole('button', { name: names[0], exact: true });
      const first = page.locator('tbody').getByText(submissions[0].company, { exact: true });
      if (baseline) {
        await page.getByText('正在加载团队数据…').waitFor();
        assert.equal(await all.count(), 0, 'old build holds completed detail until the directory returns');
      } else {
        await all.waitFor();
        await first.click();
        await page.getByText(submissions[0].remarks, { exact: true }).waitFor();
        assert.equal(await brokerA.count(), 0, 'weekly stats cannot be computed before the directory returns');
      }
      release();
      if (!baseline) {
        const retry = page.getByRole('button', { name: '重试人员目录' });
        await retry.waitFor();
        assert.ok(await first.isVisible(), 'directory failure leaves authorized detail usable');
        await retry.click();
      }
      await brokerA.waitFor();
      await all.waitFor();
      await page.getByText('共 25 条', { exact: true }).waitFor();
      const statistics = page.getByRole('table').first();
      const brokerRow = statistics.getByRole('row').filter({ has: brokerA });
      assert.equal(await brokerRow.getByRole('cell').nth(2).innerText(), '23');
      const firstWeek = statistics.getByRole('columnheader', { name: /^第 1 周(?:\s|$)/ });
      const allWeeks = page.getByRole('button', { name: '全部周次' });
      const compactWeeks = !baseline && width === 390;
      if (compactWeeks) {
        assert.equal(await firstWeek.count(), 0, 'mobile starts with only the current week');
        await allWeeks.click();
      }
      await firstWeek.waitFor();
      const firstWeekIndex = await firstWeek.evaluate(cell => cell.cellIndex);
      assert.equal(await brokerRow.getByRole('cell').nth(firstWeekIndex).innerText(), '23');
      if (compactWeeks) {
        await page.getByRole('button', { name: '收起各周' }).click();
        assert.equal(await allWeeks.getAttribute('aria-expanded'), 'false');
        assert.equal(await firstWeek.count(), 0, 'closing all weeks restores the compact table');
      }
      assert.equal(await statistics.getByRole('button', { name: names[2], exact: true }).count(), 0);
      assert.equal(await page.getByRole('link', { name: '成交数据库' }).getAttribute('href'), '/lease-submission/history');
      // A real click catches controls obscured by the previous floating database link.
      await page.getByRole('button', { name: '2', exact: true }).click();
      await page.getByText(submissions[24].company, { exact: true }).waitFor();
      assert.equal(await page.getByText(submissions[25].company, { exact: true }).count(), 0);
      await page.getByRole('button', { name: '公司名称筛选和排序' }).click();
      const menu = page.getByRole('dialog', { name: '公司名称筛选菜单' });
      const search = menu.getByRole('searchbox');
      await search.fill('2x5');
      await search.evaluate(input => input.setSelectionRange(1, 2));
      await search.press('Backspace');
      assert.deepEqual(await search.evaluate(input => [input.value, input.selectionStart, input === document.activeElement]), ['25', 1, true]);
      await menu.getByRole('button', { name: '取消全选' }).click();
      await menu.getByRole('checkbox', { name: submissions[24].company }).check();
      await menu.getByRole('button', { name: '应用筛选' }).click();
      await page.getByText(/^共 1 条\s*·/).waitFor();
      await page.getByText(submissions[24].company, { exact: true }).first().waitFor();
      await page.getByRole('button', { name: '重置筛选和排序' }).click();
      await brokerA.click();
      await page.getByRole('heading', { name: `${names[0]} 的成交填报明细` }).waitFor();
      await page.getByText('共 23 条', { exact: true }).waitFor();
      await page.getByRole('button', { name: '全屏显示团队成交汇总' }).click();
      await page.getByRole('button', { name: '退出全屏显示' }).click();
      await page.getByRole('button', { name: '显示全部' }).click();
      await all.waitFor();
      assert.equal(await page.getByRole('button', { name: '管理记录' }).count(), 0);
      assert.deepEqual(requests, { directory: baseline ? 1 : 2, detail: 1 });
      const monitorRequests = { ...requests };
      await page.getByRole('link', { name: '返回填报' }).click();
      await page.waitForURL(url => url.pathname === '/lease-submission');
      observations.push({ width, role, detailBeforeDirectory: !baseline, requests: monitorRequests, visibleRecords: 25, selectedBrokerRecords: 23, returnToWorkspace: true });
    } finally { release(); await context.close(); }
  }
  console.log(JSON.stringify({ status: 'pass', baseline, browser: await browser.version(), environment: 'isolated production build with held broker response', observations }, null, 2));
} finally { await browser.close(); }
