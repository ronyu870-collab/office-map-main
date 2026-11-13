import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { setTimeout as delay } from 'node:timers/promises';

const base = new URL(process.argv[2]);
const baseline = process.argv.includes('--baseline');
assert.ok(['127.0.0.1', 'localhost'].includes(base.hostname), 'isolated loopback builds only');
const { chromium } = createRequire(import.meta.url)(process.env.PERF_PLAYWRIGHT_MODULE || 'playwright-core');
const browser = await chromium.launch({ ...(process.env.PERF_BROWSER_CHANNEL === 'chromium' ? {} : { channel: 'chrome' }), headless: true });
const activity = '2026-11-01T04:00:00Z';
const issueIds = ['11111111-2222-4222-8222-222222222221', '11111111-2222-4222-8222-222222222222'];
const titles = ['隔离反馈甲', '隔离反馈乙'];
const contents = ['甲的沟通记录', '乙的沟通记录'];
const observations = [];

try {
  for (const [width, admin, legacy = false] of [[1280, false], [390, false], [1280, true], [390, true], ...(!baseline ? [[390, false, true]] : [])]) {
    const user = { id: '23456789-1111-4111-8111-111111111111', email: 'fixture@example.test', app_metadata: {}, user_metadata: {} };
    const expires_at = Math.floor(Date.now() / 1000) + 3600;
    const encode = value => Buffer.from(JSON.stringify(value)).toString('base64url');
    const token = `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode({ sub: user.id, exp: expires_at, aud: 'authenticated', session_id: user.id })}.fixture`;
    const session = { user, expires_at, expires_in: 3600, token_type: 'bearer', refresh_token: 'synthetic', access_token: token };
    const issues = issueIds.map((id, i) => ({ id, title: titles[i], description: `合成说明${i}`, status: 'open', priority: 'medium', category: 'bug', module: 'general', source: 'user_feedback', images: [], created_at: activity, created_by: user.email,
      last_activity_at: activity, last_admin_activity_at: activity, last_user_activity_at: activity }));
    const comments = issueIds.map((id, i) => ({ id, issue_id: id, content: contents[i], images: [], created_by: user.email, is_admin: !admin, created_at: activity, kind: 'comment', metadata: {} }));
    const context = await browser.newContext({ viewport: { width, height: 844 }, isMobile: width === 390, hasTouch: width === 390, serviceWorkers: 'block' });
    let release;
    let heldRequest;
    const gate = new Promise(resolve => { release = resolve; });
    const held = new Promise(resolve => { heldRequest = resolve; });
    const calls = [];
    let holdAlpha = false;
    let failBeta = !baseline && !legacy;
    try {
      await context.routeWebSocket(/.*/, ws => ws.close());
      await context.route('**/*', async route => {
        const request = route.request();
        const url = new URL(request.url());
        if (url.origin === base.origin) return url.pathname.startsWith('/api/') ? route.fulfill({ status: 204 }) : route.continue();
        if (url.origin !== 'https://example.supabase.co') return route.abort();
        const headers = { 'access-control-allow-origin': '*', 'access-control-allow-methods': 'GET, POST, HEAD, OPTIONS', 'access-control-allow-headers': '*' };
        if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers });
        if (url.pathname === '/auth/v1/user') return route.fulfill({ headers, json: user });
        if (url.pathname === '/rest/v1/user_roles') return route.fulfill({ headers, json: [{ role: admin ? 'admin' : 'viewer', user_id: user.id, session_id: user.id, full_name: '隔离账号' }] });
        if (url.pathname === '/rest/v1/admin_issues') return route.fulfill({ headers, json: issues });
        const mode = url.pathname.split('/').at(-1);
        if (!['feedback_open_thread', 'feedback_mark_read', 'admin_issue_comments'].includes(mode)) return route.fulfill({ headers, json: [] });
        assert.equal(request.headers().authorization, `Bearer ${token}`);
        const id = request.method() === 'POST' ? request.postDataJSON().p_issue_id : url.searchParams.get('issue_id')?.replace(/^eq\./, '');
        const i = issueIds.indexOf(id);
        assert.ok(i >= 0);
        calls.push(mode);
        if (mode === 'feedback_open_thread' && legacy) return route.fulfill({ headers, status: 404, json: { code: 'PGRST202', message: 'isolated migration not applied' } });
        if (i === 0 && holdAlpha && mode !== 'feedback_mark_read') { heldRequest(); await gate; }
        if (i === 1 && failBeta && mode === 'feedback_open_thread') {
          failBeta = false;
          return route.fulfill({ headers, status: 503, json: { code: 'XX000', message: '隔离沟通读取失败' } });
        }
        await delay(120);
        if (mode === 'feedback_mark_read') return route.fulfill({ headers, status: 204 });
        const json = mode === 'feedback_open_thread' ? [{ read_at: new Date().toISOString(), comment: comments[i], comment_created_at: activity }] : [comments[i]];
        return route.fulfill({ headers, json }).catch(error => {
          if (!/closed|handled|Invalid InterceptionId/i.test(error.message)) throw error;
        });
      });
      await context.addInitScript(({ origin, session }) => {
        if (location.origin !== origin) return;
        localStorage.setItem('colliers_trusted_device_until', String(Date.now() + 86_400_000));
        localStorage.setItem('sb-example-auth-token', JSON.stringify(session));
      }, { origin: base.origin, session });
      const page = await context.newPage();
      await page.goto(new URL(admin ? '/admin?section=issues' : '/', base).href);
      if (!admin) {
        await page.getByLabel('2 条新动态').waitFor();
        await page.getByRole('button', { name: /问题与建议/ }).click();
      }
      const issueButton = index => page.getByRole('button', { name: new RegExp(titles[index]) });
      const choose = index => issueButton(index).click();
      const message = index => page.getByText(contents[index], { exact: true });
      const back = async () => { if (!admin) await page.getByRole('button', { name: '返回', exact: true }).click(); };
      await issueButton(0).waitFor();
      const start = performance.now();
      await choose(0);
      await message(0).waitFor();
      const openMs = Math.round(performance.now() - start);
      assert.deepEqual(calls, baseline ? ['feedback_mark_read', 'admin_issue_comments'] : legacy ? ['feedback_open_thread', 'feedback_mark_read', 'admin_issue_comments'] : ['feedback_open_thread']);
      const initial = [...calls];
      await back();
      holdAlpha = true;
      await choose(0);
      await held;
      await back();
      await choose(1);
      if (!baseline && !legacy) {
        await page.getByText(/隔离沟通读取失败/).waitFor();
        assert.equal(await message(0).count(), 0);
        if (admin) assert.ok(await page.getByRole('button', { name: new RegExp(`${titles[1]}.*用户有新动态`) }).isVisible());
        else await page.getByLabel('1 条新动态').waitFor();
        await page.getByRole('button', { name: '重试沟通记录' }).click();
      }
      await message(1).waitFor();
      release();
      if (baseline) await message(0).waitFor();
      else {
        await delay(180);
        assert.ok(await message(1).isVisible());
        assert.equal(await message(0).count(), 0, 'late timeline must not replace the selected issue');
        if (legacy) assert.equal(calls.filter(call => call === 'feedback_open_thread').length, 1, 'known missing migration is probed only once');
      }
      if (admin && !baseline) {
        const source = page.locator('select').filter({ has: page.locator('option').filter({ hasText: '全部来源' }) });
        await source.selectOption('user_feedback');
        const search = page.getByPlaceholder('搜索反馈');
        await search.click();
        await page.keyboard.insertText('隔');
        await issueButton(0).waitFor();
        await page.keyboard.insertText('反');
        await page.getByText('暂无匹配反馈').waitFor();
        await search.evaluate(input => input.setSelectionRange(1, 1));
        await page.keyboard.insertText('离');
        await issueButton(0).waitFor();
        assert.deepEqual(await search.evaluate(input => [input.value, input.selectionStart, input === document.activeElement]), ['隔离反', 2, true]);
      }
      observations.push({ width, entry: admin ? 'admin' : 'home', legacy, firstOpenMs: openMs, firstRequests: initial, lateCommentOverwroteSelection: baseline });
    } finally { release(); await context.close(); }
  }
  console.log(JSON.stringify({ baseline, browser: await browser.version(), perRequestDelayMs: 120, observations }, null, 2));
} finally { await browser.close(); }
