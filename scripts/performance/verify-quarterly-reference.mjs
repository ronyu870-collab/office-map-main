import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const base = new URL(process.argv[2]);
const baseline = process.argv.includes('--baseline');
assert.ok(['127.0.0.1', 'localhost'].includes(base.hostname), 'isolated loopback builds only');
const { chromium } = createRequire(import.meta.url)(process.env.PERF_PLAYWRIGHT_MODULE || 'playwright-core');
const browser = await chromium.launch({ ...(process.env.PERF_BROWSER_CHANNEL === 'chromium' ? {} : { channel: 'chrome' }), headless: true });
const user = { id: '12345678-1111-4111-8111-111111111111', email: 'quarterly@example.test', app_metadata: {}, user_metadata: { full_name: '合成编辑者' } };
const building = { id: '23456789-1111-4111-8111-111111111111', name: '合成季度楼宇', grade: 'A', submarket: 'CBD', leasable_area: 1000 };
const expires_at = Math.floor(Date.now() / 1000) + 3600;
const encode = value => Buffer.from(JSON.stringify(value)).toString('base64url');
const token = `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode({ sub: user.id, exp: expires_at, aud: 'authenticated', session_id: user.id })}.fixture`;
const session = { user, expires_at, expires_in: 3600, token_type: 'bearer', refresh_token: 'synthetic', access_token: token };
const observations = [];

try {
  for (const width of [1280, 390]) {
    const context = await browser.newContext({ viewport: { width, height: 844 }, isMobile: width === 390, hasTouch: width === 390, serviceWorkers: 'block' });
    let release;
    const gate = new Promise(resolve => { release = resolve; });
    try {
      let draftReads = 0;
      let writes = 0;
      const violations = [];
      await context.routeWebSocket(/.*/, ws => ws.close());
      await context.route('**/*', async route => {
        const req = route.request();
        const url = new URL(req.url());
        if (url.origin === base.origin) return url.pathname.startsWith('/api/') ? route.fulfill({ status: 204 }) : route.continue();
        if (url.origin !== 'https://example.supabase.co') return route.abort();
        const headers = { 'access-control-allow-origin': '*', 'access-control-allow-methods': 'GET, HEAD, OPTIONS, POST', 'access-control-allow-headers': '*' };
        if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers });
        if (url.pathname === '/auth/v1/user') return route.fulfill({ headers, json: user });
        const table = url.pathname.replace('/rest/v1/', '');
        if (table.startsWith('rpc/')) { writes++; return route.fulfill({ status: 403, headers, json: { error: 'unexpected write' } }); }
        if (req.headers().authorization !== `Bearer ${token}`) violations.push(table);
        const offset = Number(url.searchParams.get('offset') ?? req.headers().range?.split('-')[0] ?? 0);
        let data = [];
        if (table === 'user_roles') {
          const row = { role: 'editor', user_id: user.id, session_id: user.id, full_name: '合成编辑者' };
          data = url.searchParams.get('select') === 'role' ? row : [row];
        } else if (table === 'app_settings') {
          data = [{ key: 'current_submission_year', value: '2026' }, { key: 'current_submission_quarter', value: '4' }];
        } else if (table === 'building_assignments' && offset === 0) {
          data = [{ building_id: building.id }];
        } else if (table === 'buildings') {
          data = [building];
        } else if (table === 'building_metrics' && offset === 0) {
          await gate;
          data = [{ building_id: building.id, record_year: 2026, record_quarter: 3, asking_rent: 444, total_area: 1100 }];
        } else if (table === 'update_drafts') {
          draftReads++;
          if (url.searchParams.get('user_id') !== `eq.${user.id}`) violations.push('draft owner');
          data = [{ draft_data: { [building.id]: { qQuote: '321' }, __quarterly_meta__: { version: 2, year: 2026, quarter: 4, revision: 1 } },
            record_year: 2026, record_quarter: 4, revision: 1, updated_at: '2026-11-10T00:00:00Z' }];
        }
        return route.fulfill({ headers, json: data });
      });
      await context.addInitScript(({ origin, session }) => {
        if (location.origin !== origin) return;
        localStorage.setItem('colliers_trusted_device_until', String(Date.now() + 86_400_000));
        localStorage.setItem('sb-example-auth-token', JSON.stringify(session));
        localStorage.setItem(`quarterly-client-ack:20261008-v2:${session.user.id}`, 'saved-closed-legacy-pages');
      }, { origin: base.origin, session });
      const page = await context.newPage();
      page.setDefaultTimeout(8000);
      const metricPending = page.waitForRequest(req => new URL(req.url()).pathname === '/rest/v1/building_metrics' && req.method() === 'GET');
      await page.goto(new URL('/update', base).href, { waitUntil: 'domcontentloaded' });
      await metricPending;
      const quote = page.locator('input[data-quarterly-field="qQuote"]:visible');
      const save = page.getByRole('button', { name: '保存草稿', exact: true });
      if (baseline) {
        await page.getByText('正在加载季度填报任务').first().waitFor();
        assert.equal(draftReads, 0);
        assert.equal(await quote.count(), 0);
      } else {
        await page.getByText('正在读取历史参考，暂时只读。').waitFor();
        await page.waitForFunction(() => Array.from(document.querySelectorAll('input[data-quarterly-field="qQuote"]')).some(input => input.value === '321'));
        assert.equal(await quote.evaluate(input => input.value === '321' && input.readOnly), true);
        assert.equal(await save.count(), 0);
        assert.equal(await page.getByRole('button', { name: '提交当前分类' }).count(), 0);
      }
      const draftReadsWhileMetricsHeld = draftReads;
      release();
      await save.waitFor();
      await page.waitForFunction(() => Array.from(document.querySelectorAll('input[data-quarterly-field="qQuote"]')).some(input => input.value === '321'));
      assert.equal(await quote.evaluate(input => input.value === '321' && !input.readOnly), true);
      const historicalPeriod = width === 390
        ? page.getByRole('columnheader', { name: '历史参考 2026 Q3' })
        : page.getByText('参考期 2026 Q3');
      await historicalPeriod.waitFor();
      assert.equal(writes, 0);
      assert.deepEqual(violations, []);
      observations.push({ width, draftReadsWhileMetricsHeld, draftVisibleBeforeHistoricalReference: !baseline, protectedWrites: writes });
    } finally { release(); await context.close(); }
  }
  console.log(JSON.stringify({ status: 'pass', baseline, browser: await browser.version(), environment: 'local production build with isolated data', observations }));
} finally { await browser.close(); }
