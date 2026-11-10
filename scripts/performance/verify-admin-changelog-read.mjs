import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const base = new URL(process.argv[2]);
assert.ok(['127.0.0.1', 'localhost'].includes(base.hostname), 'isolated loopback builds only');
const baseline = process.argv.includes('--baseline');
const { chromium } = createRequire(import.meta.url)(process.env.PERF_PLAYWRIGHT_MODULE || 'playwright-core');
const browser = await chromium.launch({ ...(process.env.PERF_BROWSER_CHANNEL === 'chromium' ? {} : { channel: 'chrome' }), headless: true });
const user = { id: '23456789-1111-4111-8111-111111111111', email: 'changelog@example.test', app_metadata: {}, user_metadata: {} };
const expires_at = Math.floor(Date.now() / 1000) + 3600;
const encode = value => Buffer.from(JSON.stringify(value)).toString('base64url');
const token = `${encode({ alg: 'HS256' })}.${encode({ sub: user.id, exp: expires_at, aud: 'authenticated', session_id: user.id })}.fixture`;
const session = { user, expires_at, expires_in: 3600, token_type: 'bearer', refresh_token: 'synthetic', access_token: token };
const samples = Array.from({ length: 80 }, (_, i) => ({
  id: String(i + 1), code: `CL-${String(i + 1).padStart(3, '0')}`, title: i === 0 ? '首条更新' : i === 1 ? '第二条更新' : `更新 ${i + 1}`,
  description: `合成摘要 ${i + 1} ` + '日志正文😀。'.repeat(360) + ` 正文末尾 ${i + 1}`,
  status: i % 3 === 2 ? 'released' : 'planned', module: i % 2 ? 'database' : 'map', category: 'feature',
  version: 'v2.1', released_at: i % 3 === 2 ? '2026-10-01' : null, sort_order: 80 - i,
  created_at: '2026-10-01T00:00:00Z', updated_at: '2026-10-01T00:00:00Z',
}));
const previewColumn = 'description_preview:changelog_description_preview';
const results = [];
try {
  for (const [width, mode] of [[1280, 'summary'], [390, 'summary'], ...baseline ? [] : [[390, 'fallback'], [1280, 'viewer']]]) {
    const records = samples.map(row => ({ ...row }));
    const calls = { list: 0, detail: 0, writes: 0, missingPreview: 0, listBytes: 0 };
    const actions = [];
    const context = await browser.newContext({ viewport: { width, height: 850 }, hasTouch: width === 390, serviceWorkers: 'block' });
    let releaseDetail = () => {};
    let holdFirst = !baseline && mode === 'summary';
    let failSecond = !baseline && mode === 'summary';
    let failList = false;
    try {
      await context.routeWebSocket(/.*/, ws => ws.close());
      await context.route('**/*', async route => {
        const request = route.request();
        const url = new URL(request.url());
        if (url.origin === base.origin) return url.pathname.startsWith('/api/') ? route.fulfill({ status: 204 }) : route.continue();
        if (url.origin !== 'https://example.supabase.co') return route.abort();
        const headers = { 'access-control-allow-origin': '*', 'access-control-allow-methods': 'GET, POST, PATCH, DELETE, OPTIONS', 'access-control-allow-headers': '*' };
        const method = request.method();
        const reply = (status, json) => route.fulfill({ headers, status, json });
        if (method === 'OPTIONS') return route.fulfill({ status: 204, headers });
        if (url.pathname === '/auth/v1/user') return reply(200, user);
        if (url.pathname === '/rest/v1/user_roles') return reply(200, [{ role: mode === 'viewer' ? 'viewer' : 'admin', user_id: user.id, full_name: '隔离管理员' }]);
        if (url.pathname !== '/rest/v1/changelog') return reply(200, []);
        const id = url.searchParams.get('id')?.replace(/^eq\./, '');
        const columns = url.searchParams.get('select')?.split(',') ?? [];
        if (method !== 'GET') {
          calls.writes++;
          const item = records.find(row => row.id === id);
          const payload = method === 'DELETE' ? undefined : request.postDataJSON();
          actions.push({ method, id, payload });
          if (method === 'PATCH') Object.assign(item, payload);
          else if (method === 'POST') records.push({ ...payload, id: 'created', created_at: '2026-11-01T00:00:00Z' });
          else if (method === 'DELETE') records.splice(records.indexOf(item), 1);
          return route.fulfill({ headers, status: method === 'POST' ? 201 : 204 });
        }
        if (id) {
          calls.detail++;
          const row = records.find(entry => entry.id === id);
          if (id === '1' && holdFirst) {
            holdFirst = false;
            await new Promise(resolve => { releaseDetail = resolve; });
          }
          if (id === '2' && failSecond) {
            failSecond = false;
            return reply(500, { code: 'XX000', message: 'fixture detail read failed' });
          }
          const body = columns.includes('*') ? row : Object.fromEntries(columns.map(key => [key, row[key]]));
          return reply(200, body);
        }
        if (mode === 'fallback' && columns.includes(previewColumn)) {
          calls.missingPreview++;
          return reply(400, { code: '42703', message: 'column changelog.changelog_description_preview does not exist' });
        }
        if (failList) {
          failList = false;
          return reply(500, { code: 'XX000', message: 'fixture list read failed' });
        }
        calls.list++;
        const rows = records.slice().sort((a, b) => b.sort_order - a.sort_order);
        const payload = JSON.stringify(columns.includes('*') ? rows : rows.map(row => Object.fromEntries(columns.map(key =>
          key === previewColumn ? ['description_preview', Array.from(row.description ?? '').slice(0, 160).join('')] : [key, row[key]],
        ))));
        if (calls.list === 1) calls.listBytes = Buffer.byteLength(payload);
        return route.fulfill({ headers: { ...headers, 'content-type': 'application/json' }, body: payload });
      });
      await context.addInitScript(({ origin, session }) => {
        if (location.origin !== origin) return;
        localStorage.setItem('colliers_trusted_device_until', String(Date.now() + 86_400_000));
        localStorage.setItem('sb-example-auth-token', JSON.stringify(session));
      }, { origin: base.origin, session });
      const page = await context.newPage();
      page.setDefaultTimeout(8000);
      const start = Date.now();
      await page.goto(new URL('/admin?section=changelog', base).href);
      if (mode === 'viewer') {
        await page.waitForURL(new URL('/', base).href);
        assert.equal(calls.list + calls.detail + calls.writes, 0);
        results.push({ width, mode, ...calls });
        continue;
      }
      const first = page.getByRole('button', { name: /首条更新/ }).first();
      const second = page.getByRole('button', { name: /第二条更新/ }).first();
      await first.waitFor();
      const listReadyMs = Date.now() - start;
      assert.equal(calls.detail, 0);
      const moduleFilter = page.locator('select').filter({ has: page.getByRole('option', { name: /地图系统/ }) }).first();
      await moduleFilter.focus();
      await moduleFilter.selectOption('map');
      assert.equal(await moduleFilter.evaluate(node => node === document.activeElement), true);
      await second.waitFor({ state: 'hidden' });
      await moduleFilter.selectOption('all');
      await second.waitFor();
      const editor = page.getByPlaceholder('详细描述更新内容…');
      await first.click();
      if (baseline) {
        assert.equal(await editor.inputValue(), samples[0].description);
        const box = await editor.boundingBox();
        assert.ok(box);
        results.push({ width, mode, ...calls, listReadyMs, editorFits: box.x >= 0 && box.x + box.width <= width });
        continue;
      }
      if (mode === 'summary') {
        await page.getByText('正在读取记录…', { exact: true }).waitFor();
        assert.equal(await editor.count(), 0, 'summary must never become editable body');
        await page.getByRole('button', { name: '关闭编辑面板' }).click();
        await second.click();
        await page.getByRole('button', { name: '重试读取记录' }).waitFor();
        await page.getByRole('button', { name: '重试读取记录' }).click();
        await editor.waitFor();
        releaseDetail();
        await page.waitForTimeout(100);
        assert.equal(await editor.inputValue(), samples[1].description, 'cancelled read must not replace current record');
        const box = await editor.boundingBox();
        assert.ok(box && box.x >= 0 && box.x + box.width <= width, 'editor must fit at both widths');
        await editor.fill('修改后全文，不截断。' + '长段落。'.repeat(150));
        const expected = await editor.inputValue();
        failList = true;
        await page.getByRole('button', { name: '保存', exact: true }).click();
        await page.getByRole('button', { name: '重试加载列表' }).click();
        await second.click();
        await editor.waitFor();
        assert.equal(await editor.inputValue(), expected);
        assert.equal(calls.writes, 1, 'retry of successful save must only re-read');
        await page.getByRole('button', { name: '取消', exact: true }).click();
        const secondCard = page.locator('[data-changelog-id="2"]');
        await secondCard.getByRole('combobox').selectOption('released');
        await second.waitFor({ state: 'hidden' });
        assert.match(actions[1].payload.released_at, /^\d{4}-\d{2}-\d{2}$/);
        await page.getByRole('button', { name: /^已上线\s*\d+$/ }).click();
        await second.waitFor();
        page.once('dialog', dialog => dialog.accept());
        await secondCard.getByRole('button', { name: '删除记录' }).click();
        await second.waitFor({ state: 'hidden' });
        assert.equal(actions[2].method, 'DELETE');
        await page.getByRole('button', { name: /^即将更新\s*\d+$/ }).click();
        await page.getByRole('button', { name: '新增', exact: true }).click();
        assert.equal(await page.getByLabel('编号').inputValue(), 'CL-081');
        await page.getByPlaceholder('如：新增楼宇对比功能').fill('新建隔离记录');
        await page.getByRole('button', { name: '保存', exact: true }).click();
        await page.getByRole('button', { name: /新建隔离记录/ }).waitFor();
        assert.equal(actions[3].method, 'POST');
        assert.ok(calls.listBytes < 75_000, 'first list must carry summaries rather than full bodies');
      } else {
        await editor.waitFor();
        assert.equal(await editor.inputValue(), samples[0].description);
        assert.equal(calls.missingPreview, 1);
      }
      results.push({ width, mode, ...calls, listReadyMs, editorFits: true });
    } finally { releaseDetail(); await context.close(); }
  }
  console.log(JSON.stringify({ status: 'pass', baseline, browser: browser.version(), records: samples.length, results }, null, 2));
} finally { await browser.close(); }
