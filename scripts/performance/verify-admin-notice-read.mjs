import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { join } from 'node:path';

const base = new URL(process.argv[2]);
assert.ok(['127.0.0.1', 'localhost'].includes(base.hostname), 'isolated loopback builds only');
const baseline = process.argv.includes('--baseline');
const { chromium } = createRequire(import.meta.url)(process.env.PERF_PLAYWRIGHT_MODULE || 'playwright-core');
const browser = await chromium.launch({ ...(process.env.PERF_BROWSER_CHANNEL === 'chromium' ? {} : { channel: 'chrome' }), headless: true });
const user = { id: '23456789-1111-4111-8111-111111111111', email: 'notice@example.test', app_metadata: {}, user_metadata: {} };
const expires_at = Math.floor(Date.now() / 1000) + 3600;
const encode = value => Buffer.from(JSON.stringify(value)).toString('base64url');
const token = `${encode({ alg: 'HS256' })}.${encode({ sub: user.id, exp: expires_at, aud: 'authenticated', session_id: user.id })}.fixture`;
const session = { user, expires_at, expires_in: 3600, token_type: 'bearer', refresh_token: 'synthetic', access_token: token };
const sample = (id, label, active = true) => ({
  id: String(id), content: label + '公告示例😀'.repeat(350) + '完整正文结尾' + id,
  is_active: active, updated_at: `2026-10-0${id}T00:00:00Z`, updated_by: user.email,
});
const samples = [sample(1, '第一条'), sample(2, '第二条'), sample(3, '已撤回', false)];
const previewField = 'content_preview:notice_content_preview';
const results = [];
try {
  for (const [width, mode] of [[1280, 'summary'], [390, 'summary'], ...baseline ? [] : [[390, 'fallback'], [390, 'viewer']]]) {
    const rows = samples.map(row => ({ ...row }));
    const calls = { list: 0, detail: 0, writes: 0, missingPreview: 0, listBytes: 0 };
    let failList = false;
    let failDetail = mode === 'summary' && !baseline;
    let holdList = null;
    let releaseList = () => {};
    let holdDetail = !baseline && mode === 'summary';
    let releaseDetail = () => {};
    const context = await browser.newContext({ viewport: { width, height: 850 }, hasTouch: width === 390, serviceWorkers: 'block' });
    try {
      await context.routeWebSocket(/.*/, ws => ws.close());
      await context.route('**/*', async route => {
        const request = route.request();
        const url = new URL(request.url());
        if (url.origin === base.origin) return url.pathname.startsWith('/api/') ? route.fulfill({ status: 204 }) : route.continue();
        if (url.origin !== 'https://example.supabase.co') return route.abort();
        const headers = { 'access-control-allow-origin': '*', 'access-control-allow-methods': 'GET, POST, PATCH, OPTIONS', 'access-control-allow-headers': '*' };
        const method = request.method();
        const reply = (status, json) => route.fulfill({ headers, status, json });
        if (method === 'OPTIONS') return route.fulfill({ status: 204, headers });
        if (url.pathname === '/auth/v1/user') return reply(200, user);
        if (url.pathname === '/rest/v1/user_roles') return reply(200, [{ role: mode === 'viewer' ? 'viewer' : 'admin', user_id: user.id, full_name: '隔离管理员' }]);
        if (url.pathname !== '/rest/v1/notices') return reply(200, []);
        const id = url.searchParams.get('id')?.replace(/^eq\./, '');
        const columns = url.searchParams.get('select')?.split(',') ?? [];
        if (method !== 'GET') {
          assert.notEqual(mode, 'viewer');
          calls.writes++;
          const payload = request.postDataJSON();
          if (method === 'PATCH') {
            assert.deepEqual(payload, { is_active: false });
            assert.equal(url.searchParams.get('is_active'), 'eq.true');
            const updated = rows.find(row => row.id === id && row.is_active);
            assert.ok(updated);
            updated.is_active = false;
            return reply(200, { id });
          }
          assert.equal(method, 'POST');
          assert.ok(rows.filter(row => row.is_active).length < 3);
          assert.equal(payload.updated_by, user.email);
          const created = { ...payload, id: '4', updated_at: '2026-10-04T00:00:00Z' };
          rows.push(created);
          return reply(201, created);
        }
        assert.equal(url.searchParams.get('is_active'), 'eq.true');
        if (id) {
          calls.detail++;
          if (id === '1' && holdDetail) {
            holdDetail = false;
            await new Promise(resolve => { releaseDetail = resolve; });
          }
          if (id === '2' && failDetail) {
            failDetail = false;
            return reply(500, { code: 'XX000', message: 'fixture detail unavailable' });
          }
          const row = rows.find(item => item.id === id && item.is_active);
          return reply(200, row && { content: row.content });
        }
        if (mode === 'fallback' && columns.includes(previewField)) {
          calls.missingPreview++;
          return reply(400, { code: '42703', message: 'column notices.notice_content_preview does not exist' });
        }
        if (holdList) {
          const waiting = holdList;
          holdList = null;
          await waiting;
        }
        if (failList) {
          failList = false;
          return reply(500, { code: 'XX000', message: 'fixture list unavailable' });
        }
        calls.list++;
        assert.equal(url.searchParams.get('limit'), '3');
        assert.equal(url.searchParams.get('order'), 'updated_at.asc');
        const active = rows.filter(row => row.is_active).slice(0, 3);
        const body = JSON.stringify(columns.includes('*') ? active : active.map(row => Object.fromEntries(columns.map(key =>
          key === previewField ? ['content_preview', Array.from(row.content).slice(0, 161).join('')] : [key, row[key]],
        ))));
        if (calls.list === 1) calls.listBytes = Buffer.byteLength(body);
        return route.fulfill({ headers: { ...headers, 'content-type': 'application/json' }, body });
      });
      await context.addInitScript(({ origin, session }) => {
        if (location.origin !== origin) return;
        localStorage.setItem('colliers_trusted_device_until', String(Date.now() + 86_400_000));
        localStorage.setItem('sb-example-auth-token', JSON.stringify(session));
      }, { origin: base.origin, session });
      const page = await context.newPage();
      page.setDefaultTimeout(9000);
      const adminUrl = new URL('/admin?section=notice', base).href;
      const homeUrl = new URL('/', base).href;
      await page.goto(adminUrl);
      if (mode === 'viewer') {
        await page.waitForURL(homeUrl);
        const home = page.getByRole('region', { name: '系统公告', exact: true });
        await home.getByText(samples[0].content, { exact: true }).waitFor();
        await home.getByText(samples[1].content, { exact: true }).waitFor();
        assert.equal(await home.getByText(/已撤回/).count(), 0);
        assert.equal(calls.list, 1);
        assert.equal(calls.detail + calls.writes, 0);
        failList = true;
        await page.reload();
        const error = page.getByRole('region', { name: '系统公告加载失败' });
        await error.getByRole('button', { name: '重试' }).click();
        await home.getByText(samples[0].content, { exact: true }).waitFor();
        results.push({ width, mode, ...calls });
        continue;
      }
      await page.getByText('2 / 3 条生效中', { exact: true }).waitFor();
      assert.equal(calls.detail, 0);
      const firstListBytes = calls.listBytes;
      if (process.env.PERF_NOTICE_SCREENSHOT_DIR && mode === 'summary') {
        await page.screenshot({ path: join(process.env.PERF_NOTICE_SCREENSHOT_DIR, `notice-${baseline ? 'before' : 'after'}-${width}.png`) });
      }
      if (baseline) {
        await page.getByText(samples[0].content, { exact: true }).waitFor();
        failList = true;
        await page.reload();
        await page.getByRole('textbox').first().fill('故障误判为空');
        assert.equal(await page.getByRole('button', { name: '发布公告' }).first().isEnabled(), true);
        results.push({ width, mode, firstListBytes, listFailureShowsPublish: true });
        continue;
      }
      assert.equal(await page.getByText(samples[0].content, { exact: true }).count(), 0);
      await page.getByRole('button', { name: '查看公告 1 全文' }).click();
      if (mode === 'fallback') {
        await page.getByText(samples[0].content, { exact: true }).waitFor();
        assert.equal(calls.missingPreview, 1);
        results.push({ width, mode, firstListBytes, ...calls });
        continue;
      }
      await page.getByText('正在读取正文…', { exact: true }).waitFor();
      await page.getByRole('button', { name: '查看公告 2 全文' }).click();
      await page.getByRole('button', { name: '重试读取正文' }).click();
      await page.getByText(samples[1].content, { exact: true }).waitFor();
      releaseDetail();
      assert.equal(await page.getByText(samples[0].content, { exact: true }).count(), 0);
      assert.ok(firstListBytes < 3000);

      failList = true;
      await page.reload();
      const retry = page.getByRole('button', { name: '重试加载列表' });
      await retry.waitFor();
      assert.equal(await page.getByRole('button', { name: '发布公告' }).count(), 0);
      await retry.click();
      await page.getByRole('textbox').fill('新发布的隔离公告');
      holdList = new Promise(resolve => { releaseList = resolve; });
      failList = true;
      await page.getByRole('button', { name: '发布公告' }).click();
      await page.getByText('公告已发布', { exact: true }).waitFor();
      releaseList();
      await retry.waitFor();
      assert.equal(calls.writes, 1);
      await retry.click();
      await page.getByText('3 / 3 条生效中', { exact: true }).waitFor();
      assert.equal(calls.writes, 1);

      page.once('dialog', dialog => dialog.accept());
      await page.getByRole('button', { name: '删除此条' }).first().click();
      await page.getByText('2 / 3 条生效中', { exact: true }).waitFor();
      assert.equal(calls.writes, 2);
      await page.goto(homeUrl);
      const home = page.getByRole('region', { name: '系统公告', exact: true });
      await home.getByText('新发布的隔离公告', { exact: true }).waitFor();
      await home.getByText(samples[1].content, { exact: true }).waitFor();
      assert.equal(await home.getByText(samples[0].content, { exact: true }).count(), 0);
      results.push({ width, mode, firstListBytes, ...calls, listFailureShowsPublish: false });
    } finally { releaseDetail(); releaseList(); await context.close(); }
  }
  console.log(JSON.stringify({ status: 'pass', baseline, browser: browser.version(), results }, null, 2));
} finally { await browser.close(); }
