import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { setTimeout as delay } from 'node:timers/promises';
import { createPasswordChangeFixture } from '../../src/test-support/passwordChangeFixture.ts';

const baseline = process.argv.includes('--baseline');
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PERF_PLAYWRIGHT_MODULE || 'playwright-core');
const supabaseOrigin = 'https://example.supabase.co';
const lags = { profile: 210, credential: 90, device: 140, metadata: 140, save: 150 };
let fixture;
let stages;
let roleReads;
let start;
const unexpected = [];

async function dispatch(request, source) {
  const activeFixture = fixture;
  const { pathname, searchParams } = new URL(request.url);
  const method = request.method;
  let stage;
  if (pathname === '/rest/v1/user_roles') {
    stage = method === 'PATCH' ? 'device' : source === 'server' ? 'serverRole' : 'profile';
  } else if (pathname === '/auth/v1/token') {
    stage = searchParams.get('grant_type') === 'password' ? 'credential' : 'refresh';
  } else if (pathname === '/auth/v1/user' && method === 'PUT') stage = 'metadata';
  else if (pathname === '/auth/v1/user') stage = 'serverUser';
  else if (pathname.startsWith('/auth/v1/admin/users/')) stage = 'save';
  else if (pathname === '/rest/v1/audit_logs') stage = 'audit';
  else if (pathname === '/auth/v1/logout') stage = 'logout';
  if (stage) {
    const row = { stage, started: Math.round(performance.now() - start) };
    stages.push(row);
    if (stage === 'profile') roleReads++;
    await delay(lags[stage] ?? 0);
    const response = await activeFixture.handle(request);
    row.ended = Math.round(performance.now() - start);
    return response;
  }
  if (pathname.startsWith('/rest/v1/') && method === 'GET') return Response.json([]);
  unexpected.push(`${source} ${method} ${pathname}`);
  return Response.json({}, { status: 404 });
}
async function listen(server) {
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  return server.address().port;
}
const upstream = createServer(async (req, res) => {
  try {
    const parts = [];
    for await (const chunk of req) parts.push(chunk);
    const response = await dispatch(new Request('http://127.0.0.1' + req.url, {
      method: req.method, headers: req.headers, body: parts.length ? Buffer.concat(parts) : undefined,
    }), 'server');
    res.writeHead(response.status, Object.fromEntries(response.headers));
    res.end(Buffer.from(await response.arrayBuffer()));
  } catch (error) {
    unexpected.push(String(error));
    res.writeHead(500).end();
  }
});
let child;
let browser;
try {
  const upstreamPort = await listen(upstream);
  const reservation = createServer();
  const port = await listen(reservation);
  await new Promise(resolve => reservation.close(resolve));
  const origin = `http://127.0.0.1:${port}`;
  child = spawn(process.execPath, [require.resolve('next/dist/bin/next'), 'start', '--hostname', '127.0.0.1', '--port', String(port)], {
    env: { ...process.env, NEXT_PUBLIC_SUPABASE_URL: `http://127.0.0.1:${upstreamPort}`, SUPABASE_SECRET_KEY: 'synthetic-service-key' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  const record = chunk => { output = (output + chunk).slice(-4000); };
  child.stdout.on('data', record);
  child.stderr.on('data', record);
  let ready;
  for (let i = 0; i < 40 && child.exitCode === null; i++) {
    ready = await fetch(origin + '/login', { signal: AbortSignal.timeout(1500) }).catch(() => undefined);
    if (ready?.ok) break;
    await delay(250);
  }
  assert.ok(ready?.ok, output);
  browser = await chromium.launch({ ...(process.env.PERF_BROWSER_CHANNEL === 'chromium' ? {} : { channel: 'chrome' }), headless: true });
  const observations = [];
  for (const width of [1280, 390]) for (const mode of ['login', 'force', 'wrong-phone', 'password']) {
    fixture = createPasswordChangeFixture();
    fixture.setRequired(mode !== 'login');
    roleReads = 0;
    stages = [];
    start = performance.now();
    const context = await browser.newContext({ viewport: { width, height: 900 }, serviceWorkers: 'block', hasTouch: width === 390 });
    try {
      await context.routeWebSocket(/.*/, ws => ws.close());
      await context.route('**/*', async route => {
        const req = route.request();
        const u = new URL(req.url());
        if (u.origin === origin) {
          if (u.pathname.startsWith('/api/') && u.pathname !== '/api/auth/complete-password-change') return route.fulfill({ status: 204 });
          return route.continue();
        }
        if (u.origin !== supabaseOrigin) return route.abort();
        const cors = { 'access-control-allow-origin': '*', 'access-control-allow-methods': 'GET, POST, PUT, PATCH, OPTIONS', 'access-control-allow-headers': '*' };
        if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
        const response = await dispatch(new Request(req.url(), { method: req.method(), headers: await req.allHeaders(), body: req.postDataBuffer() ?? undefined }), 'browser');
        return route.fulfill({ status: response.status, headers: { ...Object.fromEntries(response.headers), ...cors }, body: Buffer.from(await response.arrayBuffer()) });
      });
      const trusted = width === 1280;
      if (mode === 'password') await context.addInitScript(({ session, trusted }) => {
        if (sessionStorage.getItem('auth-test-seeded')) return;
        sessionStorage.setItem('auth-test-seeded', '1');
        if (trusted) localStorage.setItem('colliers_trusted_device_until', String(Date.now() + 86_400_000));
        (trusted ? localStorage : sessionStorage).setItem('sb-example-auth-token', JSON.stringify(session));
      }, { session: fixture.issueSession(), trusted });
      const page = await context.newPage();
      await page.goto(origin + (mode === 'password' ? '/settings?required=1' : '/login'));
      const visited = [];
      let settingsAtMs = null;
      page.on('framenavigated', f => {
        if (f !== page.mainFrame()) return;
        const path = new URL(f.url()).pathname;
        visited.push(path);
        if (path === '/settings') settingsAtMs ??= Math.round(performance.now() - start);
      });
      if (mode === 'password') {
        await page.getByLabel('新密码', { exact: true }).fill(fixture.newPassword);
        await page.getByLabel('确认新密码').fill(fixture.newPassword);
      } else {
        // A real click proves that React has bound the login page before submitting.
        await page.getByRole('button', { name: '显示密码' }).click();
        await page.locator('#password[type="text"]').waitFor();
        await page.getByRole('button', { name: '隐藏密码' }).click();
        await page.getByLabel('企业邮箱').fill(fixture.email);
        await page.getByLabel('手机号', { exact: true }).fill(mode === 'wrong-phone' ? '13999999999' : fixture.phone);
        await page.getByLabel('密码', { exact: true }).fill(fixture.temporaryPassword);
        if (trusted) await page.getByLabel('信任此设备 14 天').check();
      }
      stages = [];
      roleReads = 0;
      start = performance.now();
      await page.getByRole('button', { name: mode === 'password' ? '确认修改' : '登录', exact: true }).click();
      if (mode === 'wrong-phone') {
        const alert = page.getByRole('alert').filter({ hasText: '邮箱、手机号或密码不匹配' });
        await Promise.race([alert.waitFor(), page.waitForURL('**/settings?required=1')]);
        if (new URL(page.url()).pathname === '/login') await alert.waitFor();
      } else if (mode === 'force') {
        await page.waitForURL('**/settings?required=1');
        await page.getByLabel('新密码', { exact: true }).waitFor();
      } else {
        await page.waitForURL(origin + '/');
        await page.getByRole('button', { name: '用户菜单' }).waitFor();
      }
      const firstReadyMs = Math.round(performance.now() - start);
      await delay(lags.profile + 100);
      const saved = await page.evaluate(() => ({
        temporary: !!sessionStorage.getItem('sb-example-auth-token'),
        persistent: !!localStorage.getItem('sb-example-auth-token'),
      }));
      const row = { width, mode, firstReadyMs, roleReads, visited: [...visited], saved, settingsAtMs, stages: [...stages] };
      observations.push(row);
      if (mode === 'password') {
        assert.equal(fixture.required, false);
        assert.equal(fixture.audits.filter(row => row.action_type === 'CHANGE_PASSWORD').length, 1);
        assert.equal(stages.filter(s => s.stage === 'refresh').length, 0);
      }
      if (mode !== 'wrong-phone') {
        assert.deepEqual(saved, { temporary: !trusted, persistent: trusted });
      }
      if (!baseline && mode === 'wrong-phone') {
        const phone = page.getByLabel('手机号', { exact: true });
        assert.equal(await page.getByLabel('企业邮箱').inputValue(), fixture.email);
        assert.equal(await phone.inputValue(), '13999999999');
        await phone.fill(fixture.phone);
        await page.getByRole('button', { name: '登录', exact: true }).click();
        await page.waitForURL('**/settings?required=1');
        await page.getByLabel('新密码', { exact: true }).waitFor();
        row.correctedPhoneCanContinue = true;
      }
    } finally {
      await context.close();
    }
  }
  assert.deepEqual(unexpected, []);
  console.log(JSON.stringify({ baseline, browser: browser.version(), lags, observations }, null, 2));
  if (!baseline) for (const row of observations) {
    assert.equal(row.roleReads, 1, `expected one browser profile read after ${row.mode} at ${row.width}px`);
    if (row.mode === 'force') {
      assert.ok(row.stages.filter(s => s.stage === 'device' || s.stage === 'metadata')
        .every(s => s.ended <= row.settingsAtMs), 'settings must wait for the verified login to finish');
    }
    if (row.mode === 'wrong-phone') {
      assert.deepEqual(row.saved, { temporary: false, persistent: false });
      assert.ok(!row.visited.includes('/settings') && !row.visited.includes('/'));
      assert.ok(!row.stages.some(s => s.stage === 'device' || s.stage === 'metadata'));
    }
  }
} finally {
  await browser?.close();
  if (child && child.exitCode === null) { child.kill(); await once(child, 'exit'); }
  await new Promise(resolve => upstream.close(resolve));
}
