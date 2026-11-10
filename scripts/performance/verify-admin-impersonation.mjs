import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { join } from 'node:path';

const base = new URL(process.argv[2]);
assert.ok(['127.0.0.1', 'localhost'].includes(base.hostname), 'isolated loopback builds only');
const baseline = process.argv.includes('--baseline');
const { chromium } = createRequire(import.meta.url)(process.env.PERF_PLAYWRIGHT_MODULE || 'playwright-core');
const browser = await chromium.launch({ ...(process.env.PERF_BROWSER_CHANNEL === 'chromium' ? {} : { channel: 'chrome' }), headless: true });
const user = { id: '23456789-1111-4111-8111-111111111111', email: 'operator@example.test', app_metadata: {}, user_metadata: {} };
const expires_at = Math.floor(Date.now() / 1000) + 3600;
const encode = value => Buffer.from(JSON.stringify(value)).toString('base64url');
const token = `${encode({ alg: 'HS256' })}.${encode({ sub: user.id, exp: expires_at, aud: 'authenticated', session_id: user.id })}.fixture`;
const session = { user, expires_at, expires_in: 3600, token_type: 'bearer', refresh_token: 'synthetic', access_token: token };
const rows = [
  { user_id: user.id, chinese_name: '陈管理员', email: user.email, role: 'admin' },
  { user_id: '34567890-1111-4111-8111-111111111111', chinese_name: '陈明', email: 'first@example.test', role: 'viewer' },
  { user_id: '45678901-1111-4111-8111-111111111111', chinese_name: '陈丽', email: 'second@example.test', role: 'editor' },
  { user_id: '56789012-1111-4111-8111-111111111111', chinese_name: '陈立', email: 'later-page-very-long-business-email@example.test', role: 'viewer' },
];
const snapshot = process.env.PERF_IMPERSONATION_SCREENSHOT_DIR;
const results = [];

try {
  const scenarios = [[1280, 'admin', false], [390, 'admin', false], [390, 'admin', true, true],
    ...baseline ? [] : [[390, 'viewer', false], [390, 'admin', true]]];
  for (const [width, role, simulated, stale = false] of scenarios) {
    const context = await browser.newContext({ viewport: { width, height: 844 }, hasTouch: width === 390, serviceWorkers: 'block' });
    let release;
    const gate = new Promise(resolve => { release = resolve; });
    const calls = { auth: 0, directory: [], profile: 0, audit: [], authAtFirstAudit: null };
    const violation = [];
    let failDirectory = !baseline;
    let denyProfile = !baseline;
    let failAudit = !baseline;
    try {
      await context.routeWebSocket(/.*/, socket => socket.close());
      await context.route('**/*', async route => {
        const req = route.request();
        const url = new URL(req.url());
        if (url.origin === base.origin) {
          if (url.pathname === '/api/admin/impersonate') {
            if (req.headers().authorization !== `Bearer ${token}`) violation.push('unexpected actor credential');
            if (req.method() === 'GET') {
              calls.profile++;
              const target = rows.find(row => row.user_id === url.searchParams.get('user_id') && row.user_id !== user.id);
              if (!target) return route.fulfill({ status: 404, json: { error: '目标不存在' } });
              if (denyProfile) {
                denyProfile = false;
                return route.fulfill({ status: 403, json: { error: '目标校验失败' } });
              }
              return route.fulfill({ json: { ...target, displayName: target.chinese_name } });
            }
            const body = req.postDataJSON();
            calls.audit.push(body);
            calls.authAtFirstAudit ??= calls.auth;
            if (body.action === 'impersonate_start' && failAudit) {
              failAudit = false;
              return route.fulfill({ status: 500, json: { error: '审计不可用' } });
            }
            return route.fulfill({ json: { success: true } });
          }
          return url.pathname.startsWith('/api/') ? route.fulfill({ status: 204 }) : route.continue();
        }
        if (url.origin !== 'https://example.supabase.co') return route.abort();
        const headers = { 'access-control-allow-origin': '*', 'access-control-allow-methods': 'GET, POST, OPTIONS',
          'access-control-allow-headers': '*', 'access-control-expose-headers': 'Content-Range' };
        if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers });
        if (url.pathname === '/auth/v1/user') { calls.auth++; return route.fulfill({ headers, json: user }); }
        if (url.pathname === '/rest/v1/user_roles') {
          const params = url.searchParams;
          if (params.get('select')?.replaceAll(' ', '') === 'user_id,email,chinese_name,full_name,role') {
            if (req.headers().authorization !== `Bearer ${token}`) violation.push('unexpected directory credential');
            const offset = Number(params.get('offset') ?? 0);
            const excluded = params.get('user_id');
            calls.directory.push({ offset, excluded });
            await gate;
            if (failDirectory) {
              failDirectory = false;
              return route.fulfill({ headers, status: 500, json: { message: 'fixture unavailable' } });
            }
            const permitted = rows.filter(row => excluded !== `neq.${row.user_id}`);
            const page = permitted.slice(offset, offset + 2);
            return route.fulfill({ headers: { ...headers, 'content-range': `${offset}-${offset + page.length - 1}/${permitted.length}` }, json: page });
          }
          const profile = { user_id: user.id, role, session_id: user.id, full_name: '隔离管理员' };
          return route.fulfill({ headers, json: req.headers().accept?.includes('vnd.pgrst.object') ? profile : [profile] });
        }
        return route.fulfill({ headers, json: [] });
      });
      await context.addInitScript(({ origin, session, simulated, stale, target }) => {
        if (location.origin !== origin) return;
        localStorage.setItem('colliers_trusted_device_until', String(Date.now() + 86_400_000));
        localStorage.setItem('sb-example-auth-token', JSON.stringify(session));
        if (simulated) sessionStorage.setItem('__impersonation_state', JSON.stringify({
          targetUserId: target.user_id, targetEmail: target.email, targetDisplayName: target.chinese_name, targetRole: target.role,
          adminUserId: stale ? '65432100-1111-4111-8111-111111111111' : session.user.id, adminEmail: session.user.email, startedAt: Date.now(),
        }));
      }, { origin: base.origin, session, simulated, stale, target: rows[1] });

      const page = await context.newPage();
      page.setDefaultTimeout(8500);
      page.on('dialog', async dialog => { await dialog.accept(); });
      await page.goto(new URL(stale ? '/' : '/admin?section=impersonate', base).href, { waitUntil: 'domcontentloaded' });
      if (stale) {
        const exit = page.getByRole('button', { name: '退出模拟' });
        if (baseline) {
          await exit.waitFor();
          assert.notEqual(await page.evaluate(() => sessionStorage.getItem('__impersonation_state')), null);
        } else {
          await page.waitForFunction(() => !sessionStorage.getItem('__impersonation_state'));
          await exit.waitFor({ state: 'hidden' });
        }
        results.push({ width, role, staleSimulationRemains: baseline });
        continue;
      }
      const input = page.getByPlaceholder('搜索姓名或邮箱...');
      if (role !== 'admin' || simulated) {
        await page.waitForURL(base.href);
        assert.equal(await input.count(), 0);
        assert.equal(calls.directory.length + calls.profile + calls.audit.length, 0);
        results.push({ width, role, simulated, protectedReads: 0 });
        continue;
      }
      await input.focus();
      await page.keyboard.type('late');
      await page.keyboard.press('Home');
      await page.keyboard.press('ArrowRight');
      await page.keyboard.press('ArrowRight');
      assert.equal(await input.inputValue(), 'late');
      release();
      if (baseline) {
        await page.getByText('没有找到匹配的用户', { exact: true }).waitFor();
        assert.equal(await page.getByText('陈立', { exact: true }).count(), 0);
      } else {
        await page.getByText('用户目录读取失败，请重试。').waitFor();
        await page.getByRole('button', { name: '重试目录' }).click();
        await page.getByText('陈立', { exact: true }).waitFor();
        await input.focus();
        const cdp = await context.newCDPSession(page);
        await page.keyboard.press('ControlOrMeta+a');
        await cdp.send('Input.imeSetComposition', { text: 'chen', selectionStart: 4, selectionEnd: 4 });
        await cdp.send('Input.insertText', { text: '陈' });
        assert.equal(await input.inputValue(), '陈');
        await page.keyboard.type('x');
        await page.getByText('没有找到匹配的用户').waitFor();
        await page.keyboard.press('Backspace');
        await page.getByText('陈立', { exact: true }).waitFor();
        assert.equal(await input.evaluate(node => document.activeElement === node), true);
      }
      await input.fill('');
      await page.getByText('陈明', { exact: true }).waitFor();
      assert.equal(await page.getByText('陈管理员', { exact: true }).count(), 0);
      const directoryAuthReads = calls.auth;
      const target = baseline ? rows[1] : rows[3];
      const row = (baseline ? page.getByRole('row') : page.getByRole('listitem')).filter({ has: page.getByText(target.chinese_name, { exact: true }) });
      const action = row.getByRole('button', { name: '模拟此用户' });
      if (snapshot) await page.screenshot({ path: join(snapshot, `impersonation-directory-${baseline ? 'before' : 'after'}-${width}.png`) });
      assert.equal(directoryAuthReads, baseline ? 1 : 0);
      assert.deepEqual(calls.directory.map(call => call.offset), baseline ? [0] : [0, 0, 2]);

      if (!baseline) {
        await action.click();
        await page.getByRole('alert').filter({ hasText: '目标校验失败' }).waitFor();
        assert.equal(calls.audit.length, 0);
        await action.click();
        await page.getByRole('alert').filter({ hasText: '无法记录模拟操作' }).waitFor();
        assert.equal(await page.evaluate(() => sessionStorage.getItem('__impersonation_state')), null);
        assert.match(page.url(), /section=impersonate/);
      }

      await action.click();
      await page.waitForURL(new URL(`/?impersonate=${target.user_id}`, base).href);
      await page.getByText('只读模式', { exact: baseline }).first().waitFor();
      const stored = await page.evaluate(() => JSON.parse(sessionStorage.getItem('__impersonation_state')));
      assert.equal(stored.adminUserId, user.id);
      assert.equal(stored.targetUserId, target.user_id);
      assert.equal(calls.authAtFirstAudit, baseline ? 2 : 0);
      const exit = page.getByRole('button', { name: '退出模拟' });
      if (!baseline && width === 390) {
        assert.ok((await exit.boundingBox()).height >= 44);
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      }
      if (snapshot) await page.screenshot({ path: join(snapshot, `impersonation-active-${baseline ? 'before' : 'after'}-${width}.png`) });
      await exit.click();
      await page.waitForURL(new URL('/admin', base).href);
      assert.equal(await page.evaluate(() => sessionStorage.getItem('__impersonation_state')), null);
      assert.deepEqual(calls.audit, (baseline ? ['impersonate_start', 'impersonate_end'] : ['impersonate_start', 'impersonate_start', 'impersonate_end']).map(action => ({
        action, target_user_id: target.user_id, target_email: target.email,
      })));
      assert.deepEqual(violation, []);
      results.push({ width, role, directoryAuthReads, authThroughFirstAudit: calls.authAtFirstAudit, profileRequests: calls.profile,
        pagedDirectoryOffsets: calls.directory.map(call => call.offset), laterPageTargetAvailable: !baseline, returnedToAdmin: true });
    } finally { release(); await context.close(); }
  }
  console.log(JSON.stringify({ status: 'pass', baseline, browser: browser.version(), results }, null, 2));
} finally { await browser.close(); }
