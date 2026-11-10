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
const user = { id: '12345678-1111-4111-8111-111111111111', email: 'lease@example.test', app_metadata: {}, user_metadata: {} };
const expires_at = Math.floor(Date.now() / 1000) + 3600;
const encode = value => Buffer.from(JSON.stringify(value)).toString('base64url');
const token = `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode({ sub: user.id, exp: expires_at, aud: 'authenticated', session_id: user.id })}.fixture`;
const session = { user, expires_at, expires_in: 3600, token_type: 'bearer', refresh_token: 'synthetic', access_token: token };
const company = '合成成交公司';
const observations = [];

try {
  for (const { width, delayed, role } of [
    { width: 1280, delayed: 'progress', role: 'editor' }, { width: 390, delayed: 'history', role: 'viewer' },
  ]) {
    const context = await browser.newContext({ viewport: { width, height: 844 }, isMobile: width === 390, hasTouch: width === 390, serviceWorkers: 'block' });
    let release;
    const gate = new Promise(resolve => { release = resolve; });
    try {
      const requests = { progress: 0, history: 0, team: 0 };
      const violations = [];
      await context.routeWebSocket(/.*/, ws => ws.close());
      await context.route('**/*', async route => {
        const req = route.request();
        const url = new URL(req.url());
        if (url.origin === base.origin) {
          if (url.pathname === '/api/lease-submission/team-submissions') {
            requests.team++;
            if (req.headers().authorization !== `Bearer ${token}`) violations.push('team read without scoped credentials');
            return route.fulfill({ json: { submissions: [] } });
          }
          if (url.pathname.startsWith('/api/')) return route.fulfill({ status: 204 });
          return route.continue();
        }
        if (url.origin !== 'https://example.supabase.co') return route.abort();
        const headers = { 'access-control-allow-origin': '*', 'access-control-allow-methods': 'GET, HEAD, OPTIONS', 'access-control-allow-headers': '*', 'access-control-expose-headers': 'content-range' };
        if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers });
        if (url.pathname === '/rest/v1/user_roles') return route.fulfill({ headers, json: [{ role, session_id: user.id, full_name: '合成账号' }] });
        if (url.pathname !== '/rest/v1/lease_transactions') return route.fulfill({ headers, json: [] });
        const resource = req.method() === 'HEAD' ? 'progress' : 'history';
        requests[resource]++;
        if (req.headers().authorization !== `Bearer ${token}` || url.searchParams.get('submitter_id') !== `eq.${user.id}`) violations.push(`${resource} read without current account scope`);
        if (resource === delayed) await gate;
        return resource === 'progress' ? route.fulfill({ status: 200, headers: { ...headers, 'content-range': '0-1/2' } })
          : route.fulfill({ headers, json: [{ id: user.id, company, new_building: '合成大楼', area_sqm: 175 }] });
      });
      await context.addInitScript(({ origin, session }) => {
        if (location.origin !== origin || localStorage.getItem('sb-example-auth-token')) return;
        localStorage.setItem('colliers_trusted_device_until', String(Date.now() + 86_400_000));
        localStorage.setItem('sb-example-auth-token', JSON.stringify(session));
      }, { origin: base.origin, session });
      const page = await context.newPage();
      const independentResponse = page.waitForResponse(response => new URL(response.url()).pathname === '/rest/v1/lease_transactions'
        && response.request().method() === (delayed === 'progress' ? 'GET' : 'HEAD'));
      await page.goto(new URL('/lease-submission', base).href, { waitUntil: 'domcontentloaded' });
      const history = page.getByRole('region', { name: '我的提交记录' });
      const record = history.getByText(company);
      const progress = page.getByText('本周已完成', { exact: true });
      await independentResponse;
      if (baseline) {
        await history.getByText('暂无提交记录').waitFor();
        assert.equal(await record.count(), 0, 'old build still holds a returned history');
        assert.equal(await progress.count(), 0, 'old build still holds returned progress');
      } else if (delayed === 'progress') {
        await record.waitFor({ timeout: 7000 });
        assert.equal(await progress.count(), 0, 'progress response is still held');
        assert.equal(await history.getByRole('button', { name: '编辑' }).count(), 1);
      } else {
        await progress.waitFor({ timeout: 7000 });
        await history.getByText('正在加载提交记录…').waitFor();
        assert.equal(await history.getByText('暂无提交记录').count(), 0);
      }
      release();
      await record.waitFor();
      await progress.waitFor();
      await page.getByText('数据已就绪').waitFor();
      if (role === 'viewer') {
        assert.equal(await history.getByRole('button', { name: '编辑' }).count(), 0);
        assert.equal(await page.getByRole('button', { name: '新增成交' }).count(), 0);
      }
      assert.deepEqual(requests, { progress: 1, history: 1, team: 1 });
      assert.deepEqual(violations, []);
      observations.push({ width, delayed, role, requests, independentDisplay: !baseline });
    } finally { release(); await context.close(); }
  }
  console.log(JSON.stringify({ status: 'pass', baseline, browser: await browser.version(), environment: 'local production build with isolated data', observations }));
} finally { await browser.close(); }
