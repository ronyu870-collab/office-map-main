import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const base = new URL(process.argv[2]);
assert.ok(['127.0.0.1', 'localhost'].includes(base.hostname), 'isolated loopback builds only');
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PERF_PLAYWRIGHT_MODULE || 'playwright-core');
const browser = await chromium.launch({
  ...(process.env.PERF_BROWSER_CHANNEL === 'chromium' ? {} : { channel: 'chrome' }), headless: true,
});
const user = { id: '87654321-1111-4111-8111-111111111111', email: 'reader@example.test', app_metadata: {}, user_metadata: {} };
const expires_at = Math.floor(Date.now() / 1000) + 3600;
const encode = value => Buffer.from(JSON.stringify(value)).toString('base64url');
const token = `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode({ sub: user.id, exp: expires_at, aud: 'authenticated', session_id: user.id })}.fixture`;
const session = { user, expires_at, expires_in: 3600, token_type: 'bearer', refresh_token: 'synthetic', access_token: token };
const file = name => ({ name, type: 'file' });
const observations = [];

try {
  for (const width of [1280, 390]) {
    const context = await browser.newContext({ viewport: { width, height: 844 }, isMobile: width === 390, hasTouch: width === 390, serviceWorkers: 'block' });
    try {
      let phase = 'complete';
      let roleConfirmed = false;
      const reads = [];
      const access = [];
      const violations = [];
      let releaseSecond;
      const second = new Promise(resolve => { releaseSecond = resolve; });
      await context.routeWebSocket(/.*/, ws => ws.close());
      await context.route('**/*', async route => {
        const request = route.request();
        const url = new URL(request.url());
        if (url.origin === base.origin) {
          if (url.pathname === '/api/oss') {
            if (!roleConfirmed || request.headers().authorization !== `Bearer ${token}`) violations.push('OSS request before verified role or without current credential');
            const action = url.searchParams.get('action');
            if (action === 'get-list') {
              const marker = url.searchParams.get('marker');
              reads.push(marker);
              if (marker) await second;
              return route.fulfill({ json: phase === 'complete'
                ? { status: 'success', data: [file('Initial report.pdf')], truncated: false }
                : marker ? { status: 'success', data: [file('Second report.pdf')], truncated: false }
                : { status: 'success', data: [file('First report.pdf')], truncated: true, nextMarker: 'First report.pdf' } });
            }
            if (action === 'access') {
              if (request.method() !== 'POST') violations.push('access must use POST');
              access.push(request.postDataJSON());
              return phase === 'denied' ? route.fulfill({ status: 403, json: { message: '合成访问已撤销' } })
                : route.fulfill({ json: { status: 'success', url: new URL('/isolated-signed-report', base).href } });
            }
            violations.push(`unexpected OSS action: ${action}`);
          }
          if (url.pathname === '/isolated-signed-report') return route.fulfill({ body: 'fixture report', contentType: 'text/plain' });
          if (url.pathname.startsWith('/api/')) return route.fulfill({ status: 204 });
          return route.continue();
        }
        if (url.origin === 'https://example.supabase.co') {
          const headers = { 'access-control-allow-origin': '*', 'access-control-allow-methods': 'GET, OPTIONS', 'access-control-allow-headers': '*' };
          if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers });
          if (url.pathname === '/rest/v1/user_roles') {
            roleConfirmed = true;
            return route.fulfill({ headers, json: [{ role: 'viewer', session_id: user.id, full_name: 'Fixture Reader' }] });
          }
          return route.fulfill({ headers, json: [] });
        }
        return route.abort();
      });
      await context.addInitScript(({ origin, session }) => {
        if (location.origin !== origin || localStorage.getItem('sb-example-auth-token')) return;
        localStorage.setItem('colliers_trusted_device_until', String(Date.now() + 86_400_000));
        localStorage.setItem('sb-example-auth-token', JSON.stringify(session));
      }, { origin: base.origin, session });
      const page = await context.newPage();
      await page.goto(new URL('/oss', base).href);
      const initial = page.getByRole('button', { name: 'Initial report.pdf' });
      await initial.waitFor();
      assert.equal(await page.getByRole('button', { name: '上传文件' }).count(), 0);
      const search = page.getByRole('textbox', { name: '搜索当前目录资料' });
      const fileType = page.locator('select').filter({ has: page.getByRole('option', { name: 'PDF 文档' }) });
      await search.fill('Initial');
      await fileType.selectOption('pdf');
      await page.locator('header a[href="/"]').click();
      await page.waitForURL(base.href);
      await page.goBack();
      await initial.waitFor();
      assert.deepEqual(reads, [null], 'a reader returning immediately must not list the same directory twice');
      assert.equal(await search.inputValue(), 'Initial');
      assert.equal(await fileType.inputValue(), 'pdf');
      await search.fill('');
      await fileType.selectOption('all');

      const updater = await context.newPage();
      await updater.goto(new URL('/login', base).href);
      phase = 'paged';
      await updater.evaluate(() => localStorage.setItem('colliers:research-directory-revision', 'fixture-update'));
      await page.bringToFront();
      const more = page.getByRole('button', { name: '加载更多' });
      await more.waitFor();
      assert.equal(await initial.count(), 0);
      await search.pressSequentially('Second');
      await more.click();
      await search.focus();
      releaseSecond();
      const result = page.getByRole('button', { name: 'Second report.pdf' });
      await result.waitFor();
      assert.equal(await search.evaluate(input => document.activeElement === input && input.selectionStart === 6), true);
      assert.deepEqual(reads, [null, null, 'First report.pdf']);
      assert.equal(access.length, 0, 'listing must not pre-sign the documents');
      const popup = page.waitForEvent('popup');
      await result.click();
      const preview = await popup;
      await preview.waitForURL('**/isolated-signed-report');
      await preview.close();
      assert.equal(access[0]?.file_name, 'Second report.pdf');
      assert.equal(access[0]?.access_method, 'preview');
      phase = 'denied';
      await result.click();
      await page.getByText('合成访问已撤销', { exact: true }).first().waitFor();
      assert.equal(access.length, 2, 'each file open needs a new authorized access request');
      assert.equal(await result.count(), 0);
      assert.deepEqual(violations, []);
      observations.push({ width, shortReturnRequests: 0, crossTabRefresh: 'pass', continuation: 'pass', accessRequestPerOpen: 'pass', denial: 'pass', searchFocus: 'pass', recentFilter: 'pass' });
    } finally { await context.close(); }
  }
  console.log(JSON.stringify({ status: 'pass', browser: await browser.version(), environment: 'local production build, isolated browser data', observations }));
} finally { await browser.close(); }
