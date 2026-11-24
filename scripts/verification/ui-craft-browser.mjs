import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

// The production Next pages and shared controls; all remote traffic is isolated.
const base = new URL(process.argv[2]);
assert.ok(['127.0.0.1', 'localhost'].includes(base.hostname));
const { chromium } = createRequire(import.meta.url)(process.env.PERF_PLAYWRIGHT_MODULE || 'playwright-core');
const browser = await chromium.launch({ headless: true, ...(process.env.PERF_BROWSER_CHANNEL === 'chromium' ? {} : { channel: 'chrome' }) });
const user = { id: '45678901-1111-4111-8111-111111111111', email: 'craft@example.test', app_metadata: {}, user_metadata: {} };
const encode = value => Buffer.from(JSON.stringify(value)).toString('base64url');
const expires_at = Math.floor(Date.now() / 1000) + 3600;
const session = { user, expires_at, expires_in: 3600, token_type: 'bearer', refresh_token: 'synthetic', access_token: `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode({ sub: user.id, exp: expires_at, aud: 'authenticated', session_id: user.id })}.fixture` };
const observations = [];
try {
  for (const width of [1280, 390, 320]) {
    const context = await browser.newContext({ viewport: { width, height: 844 }, reducedMotion: width === 320 ? 'reduce' : 'no-preference', serviceWorkers: 'block' });
    let releaseLogin;
    let loginRequests = 0;
    const gate = new Promise(resolve => { releaseLogin = resolve; });
    await context.routeWebSocket(/.*/, socket => socket.close());
    await context.route('**/*', async route => {
      const url = new URL(route.request().url());
      if (url.origin === base.origin) {
        if (url.pathname === '/api/lease-transactions/read') return route.fulfill({ json: { records: [], count: 0, access: { canReadHistory: true, effectiveRole: 'admin', effectiveSource: 'all', impersonating: false } } });
        if (url.pathname === '/api/intelligence/query/capabilities') return route.fulfill({ json: { enabled: false } });
        return url.pathname.startsWith('/api/') ? route.fulfill({ status: 204 }) : route.continue();
      }
      if (url.origin !== 'https://example.supabase.co') return route.abort();
      const headers = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'GET, POST, OPTIONS' };
      if (route.request().method() === 'OPTIONS') return route.fulfill({ headers, status: 204 });
      if (url.pathname === '/auth/v1/token') {
        loginRequests++;
        await gate;
        return route.fulfill({ headers, status: 400, json: { error: 'invalid_grant', error_description: 'isolated credential rejection' } });
      }
      if (url.pathname === '/auth/v1/user') return route.fulfill({ headers, json: user });
      if (url.pathname === '/rest/v1/user_roles') return route.fulfill({ headers, json: [{ role: 'admin', session_id: user.id, full_name: '合成账号' }] });
      return route.fulfill({ headers, json: [] });
    });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    try {
      await page.goto(new URL('/login', base).href);
      await page.getByLabel('企业邮箱', { exact: true }).fill('craft@example.test');
      await page.getByLabel('手机号', { exact: true }).fill('13800000000');
      await page.getByLabel('密码', { exact: true }).fill('synthetic-only');
      const visibility = page.getByRole('button', { name: '显示密码', exact: true });
      if (width < 640) {
        const field = page.getByLabel('企业邮箱', { exact: true });
        assert.ok((await field.boundingBox()).height >= 44, 'mobile input retains its touch height');
        assert.ok(await field.evaluate(node => parseFloat(getComputedStyle(node).fontSize) >= 16), 'mobile input avoids focus zoom');
        const box = await visibility.boundingBox();
        assert.ok(box.width >= 44 && box.height >= 44, 'mobile icon target is 44px');
      }
      await visibility.focus();
      const tip = page.getByRole('tooltip');
      await tip.waitFor();
      assert.equal(await tip.evaluate(node => node.matches(':popover-open')), true, 'hint uses the native top layer');
      const box = await tip.boundingBox();
      assert.ok(box.x >= 8 && box.x + box.width <= width - 7, 'hint stays in the viewport');
      await page.keyboard.press('Escape');
      await tip.waitFor({ state: 'hidden' });
      const submit = page.getByRole('button', { name: '登录', exact: true });
      const idle = await submit.boundingBox();
      await submit.click();
      const busy = page.getByRole('button', { name: '登录中…', exact: true });
      await busy.waitFor();
      assert.equal(await busy.isDisabled(), true);
      assert.equal(await busy.getAttribute('aria-busy'), 'true');
      const busyBox = await busy.boundingBox();
      assert.equal(busyBox.width, idle.width);
      assert.equal(busyBox.height, idle.height);
      await busy.evaluate(node => { node.click(); node.click(); });
      if (width === 320) assert.equal(await busy.locator('span[aria-hidden="true"]').last().evaluate(node => getComputedStyle(node).animationName), 'none', 'reduced motion keeps a static busy indication');
      releaseLogin();
      await submit.waitFor();
      assert.equal(loginRequests, 1, 'busy feedback prevents a repeated login request');
      if (width === 320) assert.equal(await submit.locator('[aria-hidden="true"]').first().evaluate(node => getComputedStyle(node).animationName), 'none');
      await page.screenshot({ path: `/tmp/craft-login-${width}.png`, fullPage: true });

      await page.evaluate(session => {
        localStorage.setItem('colliers_trusted_device_until', String(Date.now() + 86400000));
        localStorage.setItem('sb-example-auth-token', JSON.stringify(session));
      }, session);
      await page.goto(new URL('/lease-submission', base).href);
      await page.getByRole('button', { name: '新增成交', exact: true }).click();
      const input = page.locator('#enterprise_type');
      await input.click();
      const handle = await input.elementHandle();
      const list = page.getByRole('listbox');
      assert.equal(await list.evaluate(node => node.matches(':popover-open')), true, 'select escapes the form scroll clipping');
      const listBox = await list.boundingBox();
      assert.ok(listBox.x >= 7 && listBox.x + listBox.width <= width - 7);
      assert.ok(listBox.y >= 0 && listBox.y + listBox.height <= 844);
      await input.fill('其他');
      assert.equal(await handle.evaluate(node => node === document.activeElement && node.isConnected), true, 'search retains the input instance and focus');
      await page.getByRole('option', { name: '其他', exact: true }).click();
      assert.equal(await input.inputValue(), '其他');
      assert.equal(await input.evaluate(node => node === document.activeElement), true, 'selection keeps combobox focus');
      await page.keyboard.press('ArrowDown');
      await page.keyboard.press('Tab');
      assert.equal(await input.getAttribute('aria-expanded'), 'false', 'Tab exits and closes the list');
      assert.deepEqual(errors, []);
      observations.push({ width, tooltipTopLayer: true, loadingStable: true, singleRequest: true, selectTopLayer: true, inputIdentity: true, tabExit: true, reducedMotion: width === 320 });
    } finally { releaseLogin(); await context.close(); }
  }
  console.log(JSON.stringify({ status: 'pass', observations }));
} finally { await browser.close(); }
