import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const base = new URL(process.argv[2]);
const baseline = process.argv.includes('--baseline');
assert.ok(['127.0.0.1', 'localhost'].includes(base.hostname), 'isolated loopback builds only');
const { chromium } = createRequire(import.meta.url)(process.env.PERF_PLAYWRIGHT_MODULE || 'playwright-core');
const browser = await chromium.launch({ ...(process.env.PERF_BROWSER_CHANNEL === 'chromium' ? {} : { channel: 'chrome' }), headless: true });
const user = { id: '23456789-1111-4111-8111-111111111111', email: 'actual-admin@example.test', app_metadata: {}, user_metadata: {} };
const expires_at = Math.floor(Date.now() / 1000) + 3600;
const encode = value => Buffer.from(JSON.stringify(value)).toString('base64url');
const token = `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode({ sub: user.id, exp: expires_at, aud: 'authenticated', session_id: user.id })}.fixture`;
const session = { user, expires_at, expires_in: 3600, token_type: 'bearer', refresh_token: 'synthetic', access_token: token };
const observations = [];
try {
  for (const { width, role, simulated } of [
    { width: 1280, role: 'admin' }, { width: 390, role: 'admin' },
    { width: 1280, role: 'viewer' }, { width: 390, role: 'admin', simulated: true },
  ]) {
    const context = await browser.newContext({ viewport: { width, height: 844 }, isMobile: width === 390, hasTouch: width === 390, serviceWorkers: 'block' });
    try {
      const calls = { roles: 0, issues: 0 };
      let createdBy;
      await context.routeWebSocket(/.*/, ws => ws.close());
      await context.route('**/*', async route => {
        const req = route.request(); const url = new URL(req.url());
        if (url.origin === base.origin) return url.pathname.startsWith('/api/') ? route.fulfill({ status: 204 }) : route.continue();
        if (url.origin !== 'https://example.supabase.co') return route.abort();
        const headers = { 'access-control-allow-origin': '*', 'access-control-allow-methods': 'GET, POST, HEAD, OPTIONS', 'access-control-allow-headers': '*' };
        if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers });
        if (url.pathname === '/auth/v1/user') return route.fulfill({ headers, json: user });
        if (url.pathname === '/rest/v1/user_roles') { calls.roles++; return route.fulfill({ headers, json: [{ role, user_id: user.id, session_id: user.id, full_name: '合成账号' }] }); }
        if (url.pathname === '/rest/v1/admin_issues') {
          calls.issues++;
          assert.equal(req.headers().authorization, `Bearer ${token}`);
          if (req.method() === 'POST') {
            createdBy = req.postDataJSON()?.created_by;
            return route.fulfill({ headers, status: 201 });
          }
          return route.fulfill({ headers, json: [{ id: 'demo', title: '合成问题列表已就绪', description: 'Demo', status: 'open', priority: 'medium', category: 'bug', module: 'general', source: 'admin', created_at: '2026-11-10T00:00:00Z', created_by: user.email, images: [] }] });
        }
        return route.fulfill({ headers, json: [] });
      });
      await context.addInitScript(({ origin, session, simulated }) => {
        if (location.origin !== origin) return;
        localStorage.setItem('colliers_trusted_device_until', String(Date.now() + 86_400_000));
        localStorage.setItem('sb-example-auth-token', JSON.stringify(session));
        if (simulated) sessionStorage.setItem('__impersonation_state', JSON.stringify({
          targetUserId: '12345678-1111-4111-8111-111111111111', targetEmail: 'simulated-viewer@example.test', targetDisplayName: '模拟账号', targetRole: 'viewer',
          adminUserId: session.user.id, adminEmail: session.user.email, startedAt: Date.now(),
        }));
      }, { origin: base.origin, session, simulated });
      const page = await context.newPage();
      await page.goto(new URL('/admin?section=issues', base).href);
      if (role !== 'admin' || simulated) {
        await page.waitForURL(base.href);
        assert.equal(calls.issues, 0, 'viewer and simulated identities cannot read the protected column');
        observations.push({ width, role, simulated: Boolean(simulated), protectedRequests: 0 });
        continue;
      }
      await page.getByText('合成问题列表已就绪').waitFor({ timeout: 7000 });
      const initialReads = { ...calls };
      assert.deepEqual(initialReads, { roles: baseline ? 2 : 1, issues: 1 }, 'initial role lookup is only needed at the real admin gate');
      await page.getByRole('button', { name: '新建内部问题' }).click();
      await page.getByPlaceholder('一句话说明事项').fill('隔离测试问题');
      await page.getByRole('button', { name: '创建', exact: true }).click();
      await page.getByPlaceholder('一句话说明事项').waitFor({ state: 'hidden' });
      assert.equal(createdBy, user.email, 'a permitted column receives the real verified operator email');
      observations.push({ width, role, ...initialReads, verifiedOperator: true });
    } finally { await context.close(); }
  }
  console.log(JSON.stringify({ status: 'pass', baseline, browser: await browser.version(), environment: 'local production build with isolated data', observations }));
} finally { await browser.close(); }
