import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { assertLeaseActionTargets } from './assert-lease-action-targets.mjs';

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
const records = Array.from({ length: 53 }, (_, index) => ({
  read_id: 'fixture-' + index, company: index === 52 ? 'Beta Fixture' : 'Alpha Fixture ' + index,
  building_id: null, related_building_ids: ['project-member'], building_match_scope: 'project', record_source: 'history',
  new_building: '测试项目', area_sqm: 120, transaction_year: 2025, transaction_quarter: 'Q3',
}));
const access = { effectiveRole: 'admin', effectiveSource: 'all', impersonating: false, canReadHistory: true };
const observations = [];
try {
  for (const [width, hasTouch] of [[1280, false], [920, false], [390, true], [320, false], [920, true]]) {
    const context = await browser.newContext({ viewport: { width, height: 844 }, isMobile: width < 640 && hasTouch, hasTouch, serviceWorkers: 'block' });
    const calls = [];
    let release;
    const held = new Promise(resolve => { release = resolve; });
    try {
      await context.routeWebSocket(/.*/, ws => ws.close());
      await context.route('**/*', async route => {
        const request = route.request();
        const url = new URL(request.url());
        if (url.origin === base.origin && url.pathname === '/api/lease-transactions/read') {
          assert.equal(request.method(), 'GET');
          const params = url.searchParams;
          const company = params.get('company') || '';
          const offset = Number(params.get('offset') || 0);
          const mode = params.get('count_only') === '1' ? 'count' : params.get('include_count') === '0' ? 'rows' : 'combined';
          calls.push({ mode, company, offset });
          const filtered = records.filter(row => row.company.includes(company));
          if (mode !== 'rows' && !company && offset === 0) await held;
          return route.fulfill({ json: { records: mode === 'count' ? [] : filtered.slice(offset, offset + 50),
            count: mode === 'rows' ? null : filtered.length, access } });
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
      const initial = page.waitForRequest(request => new URL(request.url()).pathname === '/api/lease-transactions/read');
      await page.goto(new URL('/lease-submission/history', base).href);
      await initial;
      const row = page.locator('tbody tr').filter({ hasText: /Alpha Fixture 0/ });
      const next = page.getByRole('button', { name: '下一页' });
      if (baseline) {
        await page.waitForTimeout(250);
        assert.equal(await row.count(), 0);
      } else {
        await row.waitFor();
        const dimensions = await row.evaluate(element => {
          const table = element.closest('table');
          return { available: table.parentElement.clientWidth, table: table.scrollWidth, page: document.documentElement.scrollWidth };
        });
        if (process.env.PERF_HISTORY_SCREENSHOT_DIR) await page.screenshot({ path: `${process.env.PERF_HISTORY_SCREENSHOT_DIR}/history-${width}${hasTouch && width >= 640 ? '-touch' : ''}.png` });
        assert.ok(dimensions.table <= dimensions.available + 1 && dimensions.page <= width + 1,
          `all primary fields and the detail trigger must fit ${width}px: ${JSON.stringify(dimensions)}`);
        await page.getByText('正在统计总数…', { exact: true }).waitFor();
        assert.equal(await page.getByText('0 条', { exact: true }).count(), 0);
        assert.equal(await next.isDisabled(), true);
        await (hasTouch ? row.tap() : row.click());
        const drawer = page.getByRole('dialog', { name: '成交详情' });
        await drawer.getByText(/仅确认到项目，未指定具体塔楼/).waitFor();
        if (hasTouch) await drawer.getByRole('button', { name: '关闭', exact: true }).tap();
        else await page.keyboard.press('Escape');
        await drawer.waitFor({ state: 'hidden' });
      }
      const rowsBeforeCount = await row.count() === 1;
      release();
      await page.getByText('53 条', { exact: true }).waitFor();
      await next.click();
      await page.locator('tbody tr').filter({ hasText: 'Beta Fixture' }).waitFor();
      await page.getByText('51–53 / 53', { exact: true }).waitFor();
      const input = page.getByRole('textbox', { name: '搜索公司名称' });
      await input.pressSequentially('Bta');
      await input.evaluate(element => element.setSelectionRange(1, 1));
      await page.keyboard.type('e');
      await input.press('Enter');
      await page.getByText('1 条', { exact: true }).waitFor();
      assert.deepEqual(await input.evaluate(element => [element === document.activeElement, element.value, element.selectionStart]), [true, 'Beta', 2]);
      assert.equal(await page.locator('tbody tr').filter({ hasText: 'Beta Fixture' }).count(), 1);
      assert.deepEqual(calls.map(entry => entry.mode), baseline ? ['combined', 'rows', 'combined'] : ['rows', 'count', 'rows', 'rows', 'count']);
      let actions;
      if (!baseline) {
        assert.equal(await page.evaluate(() => matchMedia('(pointer: coarse)').matches), hasTouch);
        const form = page.locator('main form');
        actions = await assertLeaseActionTargets(page, form, ['全部', '实时', '历史', '筛选', '查询'],
          width < 640 || hasTouch, `history ${width}px${hasTouch ? ' touch' : ''}`);
        const activate = (name) => {
          const action = form.getByRole('button', { name, exact: true });
          return hasTouch ? action.tap() : action.click();
        };
        await activate('筛选');
        await form.getByRole('textbox', { name: '起始年份' }).fill('2025');
        await activate('历史');
        const read = page.waitForRequest(request => new URL(request.url()).pathname === '/api/lease-transactions/read');
        await activate('查询');
        const params = new URL((await read).url()).searchParams;
        assert.equal(params.get('record_source'), 'history');
        assert.equal(params.get('year_from'), '2025');
        await page.getByText('1 条', { exact: true }).waitFor();
        await activate('筛选');
        await form.getByRole('textbox', { name: '起始年份' }).waitFor({ state: 'hidden' });
      }
      observations.push({ width, hasTouch, rowsBeforeCount, calls, actions });
    } finally { release(); await context.close(); }
  }
  console.log(JSON.stringify({ mode: baseline ? 'baseline' : 'candidate', browser: browser.version(), observations }, null, 2));
} finally { await browser.close(); }
