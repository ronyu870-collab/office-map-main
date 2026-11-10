import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';

const base = new URL(process.argv[2]);
assert.ok(['127.0.0.1', 'localhost'].includes(base.hostname), 'isolated loopback builds only');
const baseline = process.argv.includes('--baseline');
const { chromium } = createRequire(import.meta.url)(process.env.PERF_PLAYWRIGHT_MODULE || 'playwright-core');
const browser = await chromium.launch({ ...(process.env.PERF_BROWSER_CHANNEL === 'chromium' ? {} : { channel: 'chrome' }), headless: true });
const user = { id: '23456789-1111-4111-8111-111111111111', email: 'dictionary@example.test', app_metadata: {}, user_metadata: {} };
const expires_at = Math.floor(Date.now() / 1000) + 3600;
const encode = value => Buffer.from(JSON.stringify(value)).toString('base64url');
const token = `${encode({ alg: 'HS256' })}.${encode({ sub: user.id, exp: expires_at, aud: 'authenticated', session_id: user.id })}.fixture`;
const session = { user, expires_at, expires_in: 3600, token_type: 'bearer', refresh_token: 'synthetic', access_token: token };
const snapshot = process.env.PERF_SCHEMA_SCREENSHOT_DIR;
const results = [];
const detailTitle = '楼宇基础信息';
const changeNote = '导出时P合并到A组';

function identify(code) {
  if (code.includes('搜索表名或字段...')) return 'catalog';
  if (code.includes(changeNote)) return 'building';
  if (code.includes('楼宇名称，如') && code.includes('关联companies.uscc')) return 'search';
  if (code.includes('重复删除') || (code.includes('通知文字') && code.includes('管理员内部的问题反馈和需求记录'))) return 'system';
  if (code.includes('企业基础核心数据池') && code.includes('天眼查')) return 'company';
  return null;
}

try {
  for (const [width, role] of [[1280, 'admin'], [390, 'admin'], ...baseline ? [] : [[320, 'admin'], [390, 'viewer']]]) {
    const desktop = width >= 768;
    const context = await browser.newContext({ viewport: { width, height: 840 }, hasTouch: !desktop, serviceWorkers: 'block' });
    const chunks = [];
    let delaySearch = !baseline;
    let failSystem = !baseline;
    let releaseSearch = () => {};
    try {
      await context.routeWebSocket(/.*/, socket => socket.close());
      await context.route('**/*', async route => {
        const url = new URL(route.request().url());
        if (url.origin === base.origin) {
          if (url.pathname.startsWith('/api/')) return route.fulfill({ status: 204 });
          if (!url.pathname.startsWith('/_next/static/') || !url.pathname.endsWith('.js')) return route.continue();
          const response = await route.fetch();
          const body = await response.body();
          const kind = identify(body.toString());
          if (kind) chunks.push({ kind, bytes: body.length, gzipBytes: gzipSync(body).length });
          if (kind === 'search' && delaySearch) {
            delaySearch = false;
            await new Promise(resolve => { releaseSearch = resolve; });
          }
          if (kind === 'system' && failSystem) {
            failSystem = false;
            return route.fulfill({ status: 503, contentType: 'text/plain', body: 'fixture chunk unavailable' });
          }
          return route.fulfill({ status: response.status(), contentType: 'application/javascript', body });
        }
        if (url.origin !== 'https://example.supabase.co') return route.abort();
        const headers = { 'access-control-allow-origin': '*', 'access-control-allow-methods': 'GET, OPTIONS', 'access-control-allow-headers': '*' };
        if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers });
        if (url.pathname === '/auth/v1/user') return route.fulfill({ headers, json: user });
        if (url.pathname === '/rest/v1/user_roles') return route.fulfill({ headers, json: [{ role, user_id: user.id, full_name: '隔离用户' }] });
        return route.fulfill({ headers, json: [] });
      });
      await context.addInitScript(({ origin, session }) => {
        if (location.origin !== origin) return;
        localStorage.setItem('colliers_trusted_device_until', String(Date.now() + 86_400_000));
        localStorage.setItem('sb-example-auth-token', JSON.stringify(session));
      }, { origin: base.origin, session });

      const page = await context.newPage();
      page.setDefaultTimeout(9000);
      await page.goto(new URL('/admin?section=schema', base).href);
      const input = page.getByPlaceholder('搜索表名或字段...');
      if (role === 'viewer') {
        await page.waitForURL(new URL('/', base).href);
        assert.equal(await input.count(), 0);
        assert.equal(chunks.length, 0, 'no schema assets when the admin gate rejects the role');
        results.push({ width, role, schemaChunks: chunks });
        continue;
      }
      await input.waitFor();
      await page.getByText('25 张表 / 298 个字段', { exact: true }).waitFor();
      const title = page.getByRole('heading', { name: detailTitle, exact: true });
      if (desktop || baseline) {
        await title.waitFor();
        await page.getByText(/经纬度为空或is_active/).waitFor();
      }
      const initial = chunks.slice();
      const initialBytes = initial.reduce((sum, chunk) => sum + chunk.gzipBytes, 0);
      if (snapshot) await page.screenshot({ path: join(snapshot, `schema-${baseline ? 'before' : 'after'}-${width}.png`) });
      if (baseline) {
        const detailWidth = await title.evaluate(node => node.parentElement.parentElement.clientWidth);
        assert.equal(initial.length, 1);
        assert.equal(initial[0].kind, 'catalog');
        assert.ok(desktop || detailWidth < 160, 'old narrow layout must reproduce the compressed detail pane');
        results.push({ width, role, detailWidth, initialGzipBytes: initialBytes, initial });
        continue;
      }
      assert.deepEqual(initial.map(chunk => chunk.kind).sort(), desktop ? ['building', 'catalog'] : ['catalog']);
      assert.ok(initialBytes < 7600, 'unselected schema groups must stay off the first view');

      const catalog = page.getByRole('complementary', { name: '数据字典目录' });
      await input.focus();
      await page.keyboard.type('b');
      await catalog.getByText('正在准备字段搜索…', { exact: true }).waitFor();
      await page.keyboard.type('uildngs');
      assert.equal(await input.inputValue(), 'buildngs');
      await page.waitForFunction(() => document.activeElement?.getAttribute('aria-label') === '搜索表名或字段');
      for (let i = 0; i < 40 && !chunks.some(chunk => chunk.kind === 'search'); i++) await page.waitForTimeout(25);
      assert.ok(chunks.some(chunk => chunk.kind === 'search'));
      releaseSearch();
      await catalog.getByText('未找到匹配的表或字段', { exact: true }).waitFor();
      await page.keyboard.press('Home');
      for (let i = 0; i < 5; i++) await page.keyboard.press('ArrowRight');
      await page.keyboard.type('i');
      assert.equal(await input.inputValue(), 'buildings');
      assert.deepEqual(await input.evaluate(node => ({ focused: node === document.activeElement, start: node.selectionStart, end: node.selectionEnd })),
        { focused: true, start: 6, end: 6 }, 'inserting in the middle keeps the corrected caret');
      const building = catalog.getByRole('button', { name: /楼宇基础信息/ });
      await building.waitFor();
      await building.click();
      await title.waitFor();
      const details = page.getByRole('region', { name: '表详情' });
      const detailWidth = await details.evaluate(node => node.clientWidth);
      assert.ok(desktop || detailWidth >= width - 2);
      const grade = details.getByRole('button', { name: '展开字段 grade' });
      await grade.click();
      await details.getByText('备注：' + changeNote, { exact: true }).waitFor();
      assert.equal(await details.getByRole('button', { name: '收起字段 grade' }).getAttribute('aria-expanded'), 'true');
      if (snapshot) await page.screenshot({ path: join(snapshot, `schema-detail-${width}.png`) });
      if (!desktop) {
        await page.getByRole('button', { name: '返回数据字典' }).click();
        assert.equal(await input.inputValue(), 'buildings');
      }

      await input.fill('');
      await input.focus();
      const cdp = await context.newCDPSession(page);
      await cdp.send('Input.imeSetComposition', { text: 'kongzhi', selectionStart: 7, selectionEnd: 7 });
      assert.equal(await input.evaluate(node => node === document.activeElement), true);
      await cdp.send('Input.insertText', { text: '控制是否显示' });
      assert.equal(await input.inputValue(), '控制是否显示');
      assert.deepEqual(await input.evaluate(node => ({ focused: node === document.activeElement, start: node.selectionStart, end: node.selectionEnd })),
        { focused: true, start: 6, end: 6 }, 'committing an IME candidate retains the input and caret');
      await page.keyboard.type('x');
      assert.equal(await input.inputValue(), '控制是否显示x');
      await catalog.getByText('未找到匹配的表或字段', { exact: true }).waitFor();
      await page.keyboard.press('Backspace');
      assert.equal(await input.inputValue(), '控制是否显示');
      const system = catalog.getByRole('button', { name: /^系统管理/ });
      await system.click();
      await catalog.getByRole('button', { name: /^通知\s*5$/ }).click();
      await page.getByRole('button', { name: '重试表详情' }).click();
      await details.getByText('控制是否显示', { exact: true }).waitFor();
      assert.equal(await details.getByRole('heading', { name: '通知', exact: true }).count(), 1);
      assert.equal(await details.getByText(changeNote, { exact: false }).count(), 0);
      assert.equal(chunks.filter(chunk => chunk.kind === 'search').length, 1);
      assert.equal(chunks.filter(chunk => chunk.kind === 'system').length, 2, 'only failed group is retried');
      assert.equal(chunks.filter(chunk => chunk.kind === 'company').length, 0);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      results.push({ width, role, detailWidth, initialGzipBytes: initialBytes, initial, schemaChunks: chunks });
    } finally { releaseSearch(); await context.close(); }
  }
  console.log(JSON.stringify({ status: 'pass', baseline, browser: browser.version(), results }, null, 2));
} finally { await browser.close(); }
