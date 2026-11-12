import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PERF_PLAYWRIGHT_MODULE || 'playwright-core');
const [variant = 'after', base = 'http://127.0.0.1:3210'] = process.argv.slice(2);
assert.ok(['127.0.0.1', 'localhost'].includes(new URL(base).hostname));
assert.ok(['before', 'after'].includes(variant));
const out = new URL('../../docs/verification/home-ai-entry/', import.meta.url);
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ ...(process.env.PERF_BROWSER_CHANNEL === 'chromium' ? {} : { channel: 'chrome' }), headless: true });
const id = '12345678-1111-4111-8111-111111111111';
const encode = x => Buffer.from(JSON.stringify(x)).toString('base64url');
const expires_at = Math.floor(Date.now() / 1000) + 3600;
const saved = { user: { id, aud: 'authenticated', email: 'home-fixture@example.test', app_metadata: {}, user_metadata: {} }, expires_at, expires_in: 3600, token_type: 'bearer', refresh_token: 'synthetic', access_token: `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode({ sub: id, exp: expires_at, aud: 'authenticated', session_id: id })}.fixture` };
const notices = [
  ['地图新增楼宇列表：点击「完整列表」，就能按区域筛楼，也能按租金或空置率排序。', '2026-11-11T06:00:00Z'],
  ['楼宇照片可以放大看：在楼宇详情里点「看图」，再点照片就能看大图。', '2026-11-11T05:00:00Z'],
  ['填报成交时可以查历史：输入公司名，找到同名公司后，可以查看最近的成交记录。', '2026-11-11T04:00:00Z'],
  ['合成第四条公告，用于验证展开后完整内容仍可阅读。', '2026-11-10T04:00:00Z'],
].map(([content, updated_at], i) => ({ id: i + 1, content, updated_at, is_active: true }));
const records = [];
try {
  const cases = [1280, 390, 320].map(width => ({ width, role: 'admin', mode: 'normal' }));
  if (variant === 'after') cases.push(...[639, 640, 959, 960].map(width => ({ width, role: 'admin', mode: 'normal' })),
    { width: 390, role: 'viewer', mode: 'empty' }, { width: 390, role: 'editor', mode: 'error' }, { width: 390, role: 'admin', mode: 'long' });
  for (const { width, role, mode } of cases) {
    const key = mode === 'normal' ? String(width) : `${mode}-${role}-${width}`;
    let responsesHealthy = mode !== 'error';
    const context = await browser.newContext({ viewport: { width, height: width === 1280 ? 900 : 844 }, isMobile: width < 600, hasTouch: width < 600, serviceWorkers: 'block' });
    const calls = [];
    await context.routeWebSocket(/.*/, ws => ws.close());
    await context.route('**/*', async route => {
      const req = route.request(); const u = new URL(req.url()); calls.push({ path: u.pathname, method: req.method() });
      if (u.origin === new URL(base).origin) {
        if (u.pathname.startsWith('/api/')) return route.fulfill({ json: { issues: [], data: [] } });
        return route.continue();
      }
      const headers = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'GET, POST, OPTIONS' };
      if (u.origin === 'https://example.supabase.co') {
        if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers });
        if (u.pathname === '/rest/v1/user_roles') return route.fulfill({ headers, json: [{ role, full_name: 'Preview User', chinese_name: null, session_id: id, phone: null }] });
        if (u.pathname === '/rest/v1/notices') return responsesHealthy ? route.fulfill({ headers, json: mode === 'empty' ? [] : notices }) : route.fulfill({ headers, status: 503, json: { message: 'synthetic unavailable' } });
        if (u.pathname === '/rest/v1/messages') {
          if (!responsesHealthy) return route.fulfill({ headers, status: 503, json: { message: 'synthetic unavailable' } });
          const messages = [{ id: 'fixture-message', user_name: 'Lily Liu', user_email: 'fixture@example.test', content: '环球金融', created_at: '2026-11-11T06:09:00Z' }];
          if (mode === 'long') messages.unshift({ ...messages[0], id: 'long-message', content: '合成长消息，用来验证内部滚动和完整阅读。'.repeat(80) });
          return route.fulfill({ headers, json: mode === 'empty' ? [] : messages });
        }
        if (req.method() === 'GET') return route.fulfill({ headers, json: [] });
        return route.fulfill({ status: 204, headers });
      }
      return route.abort();
    });
    await context.addInitScript(({ saved, base }) => {
      if (location.origin !== new URL(base).origin) return;
      localStorage.setItem('colliers_trusted_device_until', String(Date.now() + 86_400_000));
      localStorage.setItem('sb-example-auth-token', JSON.stringify(saved));
    }, { saved, base });
    const page = await context.newPage();
    const errors = []; page.on('pageerror', e => errors.push(e.message));
    await page.goto(base, { waitUntil: 'networkidle' });
    await page.getByRole('link', { name: '季度数据填报', exact: true }).waitFor();
    if (mode === 'empty') await page.getByText('暂无市场交流', { exact: true }).waitFor();
    else if (mode === 'error') {
      await page.getByText('公告暂时无法加载', { exact: true }).waitFor();
      await page.getByText('市场交流暂时无法加载', { exact: true }).waitFor();
    } else {
      await page.getByText('环球金融', { exact: true }).waitFor();
      await page.getByRole('button', { name: '查看全部 4 条公告' }).waitFor();
    }
    const initialScrollTop = await page.locator('main > div').evaluate(el => el.scrollTop);
    if (variant === 'after') assert.equal(initialScrollTop, 0, 'loading team activity must not scroll the homepage');
    await page.screenshot({ path: fileURLToPath(new URL(`${variant}-${key}.png`, out)), fullPage: true });
    const metrics = await page.evaluate(() => ({ width: innerWidth, scrollWidth: document.documentElement.scrollWidth, fonts: [...new Set([...document.querySelectorAll('main h1, main h2, main h3, main p, main a')].map(e => getComputedStyle(e).fontSize))] }));
    assert.ok(metrics.scrollWidth <= width, 'no horizontal page overflow');
    if (mode === 'error') {
      responsesHealthy = true;
      await page.getByRole('region', { name: '系统公告加载失败', exact: true }).getByRole('button', { name: '重试' }).click();
      await page.getByRole('region', { name: '市场交流摘要' }).getByRole('button', { name: '重试' }).click();
      await page.getByText('环球金融', { exact: true }).waitFor();
    }
    if (mode !== 'empty') {
      await page.getByRole('button', { name: '查看全部 4 条公告' }).click();
      await page.getByText('合成第四条公告，用于验证展开后完整内容仍可阅读。', { exact: true }).waitFor();
      await page.getByRole('button', { name: '收起公告' }).click();
    }
    if (mode === 'long') {
      const box = await page.getByRole('region', { name: '市场交流摘要' }).locator('.overflow-y-auto').evaluate(el => ({ height: el.clientHeight, content: el.scrollHeight }));
      assert.ok(box.content > box.height && box.height > 0 && box.height <= 188, 'long messages stay in a bounded scrolling viewport');
    }
    await page.getByRole('button', { name: '打开市场交流（最近 50 条）' }).click();
    await page.getByRole('dialog').waitFor();
    await page.getByRole('button', { name: '退出市场交流' }).click();
    await page.getByRole('button', { name: '用户菜单' }).click();
    if (role === 'admin') await page.getByRole('menuitem', { name: '系统管理' }).waitFor();
    else assert.equal(await page.getByRole('menuitem', { name: '系统管理' }).count(), 0);
    await page.keyboard.press('Escape');
    assert.equal(await page.getByRole('button', { name: '用户菜单' }).evaluate(e => e === document.activeElement), true);
    if (variant === 'after') {
      assert.equal(await page.getByRole('textbox', { name: '对话查询' }).isDisabled(), true);
      assert.equal(await page.getByRole('button', { name: '发送问题' }).isDisabled(), true);
      assert.ok(!calls.some(c => /\/api\/(ai|intelligence\/chat)/.test(c.path)), 'no new AI request');
    }
    if (variant === 'after') {
      await page.getByRole('complementary', { name: '团队动态' }).scrollIntoViewIfNeeded();
      await page.screenshot({ path: fileURLToPath(new URL(`${variant}-activity-${key}.png`, out)), fullPage: true });
      if (role === 'admin') {
        await page.getByRole('link', { name: '企业选址洞察报告', exact: true }).click();
        await page.waitForURL('**/occupier-insights');
        await page.goBack();
        await page.getByRole('link', { name: '季度数据填报', exact: true }).waitFor();
      } else {
        assert.equal(await page.getByRole('link', { name: '企业选址洞察报告' }).count(), 0);
        assert.equal(await page.getByRole('link', { name: '业务智能 Intelligence' }).count(), 0);
      }
    }
    assert.equal(errors.length, 0, errors.join('\n'));
    records.push({ width, role, mode, initialScrollTop, browser: browser.version(), metrics, checks: [...(mode === 'empty' ? ['empty activity state'] : ['notice expand/collapse']), ...(mode === 'error' ? ['notice and communication failure recovery'] : []), ...(mode === 'long' ? ['bounded internal message scrolling'] : []), 'communication open/close', 'account menu escape focus', 'no horizontal overflow', ...(variant === 'after' ? ['query unavailable and disabled', 'no new AI request', 'initial page scroll remains zero', ...(role === 'admin' ? ['report navigation and browser back'] : ['restricted entries absent'])] : [])], errors });
    await context.close();
  }
  await writeFile(new URL(`${variant}-browser.json`, out), JSON.stringify(records, null, 2));
  console.log(JSON.stringify(records));
} finally { await browser.close(); }
