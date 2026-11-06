/**
 * Production Next/webpack auth flow with real pages, SDK, storage and HTTP route.
 * Auth and PostgREST are local synthetic fixtures; never use production credentials.
 * PLAYWRIGHT_MODULE=/path/to/playwright/index.mjs CHROME_PATH=/path/to/chrome
 *   node --experimental-strip-types scripts/check-password-change-browser.mjs
 */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { mkdtemp, mkdir, writeFile, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createPasswordChangeFixture } from '../src/test-support/passwordChangeFixture.ts';

const root = process.cwd();
const require = createRequire(path.join(root, 'package.json'));
if (!process.env.PLAYWRIGHT_MODULE) throw new Error('Set PLAYWRIGHT_MODULE to an installed playwright/index.mjs');
const { chromium } = await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE).href);
const { WebSocketServer } = require('next/dist/compiled/ws');
const evidence = process.env.PASSWORD_BROWSER_ARTIFACT_DIR || path.join(tmpdir(), 'password-change-browser-evidence');
await mkdir(evidence, { recursive: true });
const harness = await mkdtemp(path.join(tmpdir(), 'password-change-browser-'));
const appPort = 3490;
const authPort = 3489;
let fixture = createPasswordChangeFixture();
let appServer, browser;
const results = [], pageErrors = [], externalRequests = [], unknownRequests = [];
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const fixtureServer = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://127.0.0.1:${authPort}`);
    const chunks = []; for await (const chunk of req) chunks.push(chunk);
    const body = Buffer.concat(chunks);
    const request = new Request(url, { method: req.method, headers: req.headers, ...(body.length ? { body, duplex: 'half' } : {}) });
    let response;
    if (req.method === 'OPTIONS') response = new Response(null, { status: 204 });
    else if (url.pathname === '/_fixture/reset') {
      fixture = createPasswordChangeFixture(); fixture.setRequired(url.searchParams.get('required') !== '0');
      response = json({ ok: true });
    } else if (url.pathname === '/_fixture/fail-sign-in') {
      fixture.faults.signIn = true; fixture.faults.logout = true; response = json({ ok: true });
    } else if (req.method === 'GET' && ['/rest/v1/notices', '/rest/v1/messages', '/rest/v1/admin_issues', '/rest/v1/admin_issue_reads'].includes(url.pathname)) {
      response = json([]);
    } else response = await fixture.handle(request);
    res.writeHead(response.status, {
      ...Object.fromEntries(response.headers), 'Access-Control-Allow-Origin': `http://127.0.0.1:${appPort}`,
      'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
    });
    res.end(Buffer.from(await response.arrayBuffer()));
  } catch (error) {
    unknownRequests.push(String(error)); res.writeHead(500); res.end('Unexpected fixture request blocked');
  }
});
const sockets = new WebSocketServer({ server: fixtureServer });
sockets.on('connection', socket => socket.on('message', raw => {
  const payload = JSON.parse(String(raw));
  // Phoenix/Supabase Realtime handshake for the unrelated empty message board.
  const reply = { status: 'ok', response: { postgres_changes: [] } };
  if (Array.isArray(payload)) {
    const [joinRef, ref, topic] = payload;
    socket.send(JSON.stringify([joinRef, ref, topic, 'phx_reply', reply]));
  } else {
    socket.send(JSON.stringify({ topic: payload.topic, event: 'phx_reply', payload: reply, ref: payload.ref, join_ref: payload.join_ref }));
  }
}));

async function run(command, args, env, logPath) {
  const child = spawn(command, args, { cwd: harness, env, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = ''; child.stdout.on('data', b => { output += b; }); child.stderr.on('data', b => { output += b; });
  const status = await new Promise((resolve, reject) => { child.on('exit', resolve); child.on('error', reject); });
  await writeFile(logPath, output); assert.equal(status, 0, output.slice(-5000));
}
async function login(page, password, trusted) {
  await page.getByLabel('企业邮箱').fill(fixture.email);
  await page.getByLabel('手机号', { exact: true }).fill(fixture.phone);
  await page.getByLabel('密码', { exact: true }).fill(password);
  await page.getByLabel('信任此设备 14 天').setChecked(trusted);
  await page.getByRole('button', { name: '登录', exact: true }).click();
}
async function home(page) {
  await page.waitForURL(`http://127.0.0.1:${appPort}/`);
  await page.getByRole('button', { name: '用户菜单', exact: true }).waitFor();
  await page.getByRole('link', { name: '北京办公楼市场地图', exact: true }).waitFor();
  await page.waitForTimeout(300);
  assert.equal(new URL(page.url()).pathname, '/');
}

try {
  await new Promise((resolve, reject) => { fixtureServer.once('error', reject); fixtureServer.listen(authPort, '127.0.0.1', resolve); });
  await symlink(path.join(root, 'node_modules'), path.join(harness, 'node_modules'), 'dir');
  await writeFile(path.join(harness, 'package.json'), JSON.stringify({ name: 'isolated-password-change-browser', private: true }));
  await writeFile(path.join(harness, 'tsconfig.json'), JSON.stringify({ compilerOptions: {
    target: 'ES2020', lib: ['dom', 'esnext'], allowJs: true, skipLibCheck: true, esModuleInterop: true,
    module: 'esnext', moduleResolution: 'bundler', jsx: 'preserve', baseUrl: root, paths: { '@/*': ['./*'] },
  }, include: ['app/**/*.tsx'], exclude: ['node_modules'] }));
  await writeFile(path.join(harness, 'next.config.mjs'), `export default { serverExternalPackages: ['ali-oss'], typescript: { ignoreBuildErrors: true }, webpack(config) { config.resolve.alias['@'] = ${JSON.stringify(root)}; return config; } };`);
  await writeFile(path.join(harness, 'postcss.config.mjs'), `export default { plugins: { '@tailwindcss/postcss': { base: ${JSON.stringify(root)} } } };`);
  for (const route of ['', 'login', 'settings', 'api/auth/complete-password-change', 'api/audit-events']) await mkdir(path.join(harness, 'app', route), { recursive: true });
  await writeFile(path.join(harness, 'app/layout.tsx'), `export { default, metadata, viewport } from ${JSON.stringify(path.join(root, 'src/app/layout'))};`);
  for (const route of ['', 'login', 'settings']) await writeFile(path.join(harness, 'app', route, 'page.tsx'), `export { default } from ${JSON.stringify(path.join(root, 'src/app', route, 'page'))};`);
  for (const route of ['api/auth/complete-password-change', 'api/audit-events']) await writeFile(path.join(harness, 'app', route, 'route.ts'), `export { POST, dynamic } from ${JSON.stringify(path.join(root, 'src/app', route, 'route'))};`);
  const env = {
    PATH: process.env.PATH, HOME: process.env.HOME, NODE_ENV: 'production', NEXT_TELEMETRY_DISABLED: '1',
    NEXT_PUBLIC_SUPABASE_URL: `http://127.0.0.1:${authPort}`, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'synthetic-publishable',
    SUPABASE_SECRET_KEY: 'synthetic-service-key',
  };
  const next = path.join(root, 'node_modules/next/dist/bin/next');
  await run(process.execPath, [next, 'build', harness, '--webpack'], env, path.join(evidence, 'build.log'));
  appServer = spawn(process.execPath, [next, 'start', harness, '-p', String(appPort), '-H', '127.0.0.1'], { cwd: harness, env, stdio: ['ignore', 'pipe', 'pipe'] });
  let serverLog = ''; appServer.stdout.on('data', b => { serverLog += b; }); appServer.stderr.on('data', b => { serverLog += b; });
  for (let i = 0; i < 100; i += 1) { try { if ((await fetch(`http://127.0.0.1:${appPort}/login`)).ok) break; } catch {} await new Promise(resolve => setTimeout(resolve, 100)); }
  browser = await chromium.launch({ headless: true, ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}), args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  for (const width of [1280, 390]) {
    for (const trusted of [false, true]) {
      for (const required of [true, false]) {
        console.log('Starting browser case', { width, trusted, required });
        await fetch(`http://127.0.0.1:${authPort}/_fixture/reset?required=${required ? 1 : 0}`);
        const context = await browser.newContext({ viewport: { width, height: 900 }, isMobile: width === 390, hasTouch: width === 390 });
        context.setDefaultTimeout(15000); context.setDefaultNavigationTimeout(20000);
        await context.route('**/*', route => {
          const url = route.request().url();
          if ([`http://127.0.0.1:${appPort}`, `http://127.0.0.1:${authPort}`].includes(new URL(url).origin)) return route.continue();
          externalRequests.push(url); return route.abort();
        });
        const page = await context.newPage(); page.on('pageerror', error => pageErrors.push(error.message));
        await page.goto(`http://127.0.0.1:${appPort}/login`);
        await login(page, fixture.temporaryPassword, trusted);
        if (!required) { await home(page); await page.goto(`http://127.0.0.1:${appPort}/settings`); }
        await page.getByLabel('新密码', { exact: true }).fill(fixture.newPassword);
        await page.getByLabel('确认新密码').fill(fixture.newPassword);
        await page.getByRole('button', { name: '确认修改' }).click();
        await home(page);
        const key = `w${width}-trusted${trusted}-required${required}`;
        await page.screenshot({ path: path.join(evidence, `${key}-home.png`), fullPage: true });
        await page.reload(); await home(page);
        await page.getByRole('button', { name: '用户菜单', exact: true }).click();
        await page.getByRole('menuitem', { name: '退出登录' }).click();
        await page.waitForURL(`http://127.0.0.1:${appPort}/login`);
        await page.reload(); await page.getByLabel('企业邮箱').waitFor();
        await login(page, fixture.temporaryPassword, trusted);
        await page.getByRole('alert').filter({ hasText: '登录失败' }).waitFor();
        await login(page, fixture.newPassword, trusted); await home(page);
        assert.equal(fixture.required, false);
        assert.equal(fixture.audits.filter(audit => audit.action_type === 'CHANGE_PASSWORD').length, 1);
        results.push({ width, trusted, required, saveAndHome: true, reload: true, logoutAndReload: true, oldPasswordRejected: true, newPasswordLogin: true });
        console.log('Passed browser case', { width, trusted, required });
        await context.close();
      }
    }
  }
  await fetch(`http://127.0.0.1:${authPort}/_fixture/reset`);
  const context = await browser.newContext({ viewport: { width: 390, height: 900 } });
  context.setDefaultTimeout(15000); context.setDefaultNavigationTimeout(20000);
  const page = await context.newPage(); page.on('pageerror', error => pageErrors.push(error.message));
  await page.goto(`http://127.0.0.1:${appPort}/login`); await login(page, fixture.temporaryPassword, false);
  await page.getByLabel('新密码', { exact: true }).fill(fixture.newPassword);
  await page.getByLabel('确认新密码').fill(fixture.newPassword);
  await fetch(`http://127.0.0.1:${authPort}/_fixture/fail-sign-in`);
  await page.getByRole('button', { name: '确认修改' }).click();
  await page.waitForURL(`http://127.0.0.1:${appPort}/login`);
  await page.getByRole('status').filter({ hasText: '密码已修改，请使用新密码重新登录' }).waitFor();
  await page.reload();
  await page.getByRole('status').filter({ hasText: '密码已修改，请使用新密码重新登录' }).waitFor();
  await page.screenshot({ path: path.join(evidence, 'reauth-failure.png'), fullPage: true });
  assert.equal(fixture.required, false);
  await context.close();
  assert.deepEqual(pageErrors, []); assert.deepEqual(externalRequests, []); assert.deepEqual(unknownRequests, []);
  await writeFile(path.join(evidence, 'server.log'), serverLog);
  await writeFile(path.join(evidence, 'results.json'), JSON.stringify({ browser: await browser.version(), build: 'Next production/webpack, actual root layout, login/settings/home, API route, SDK and storage', fixture: 'Synthetic local Auth/PostgREST; production Auth issuance and physical phones not tested', results, recovery: true, pageErrors, externalRequests, unknownRequests }, null, 2));
  console.log(JSON.stringify({ evidence, passed: results.length, recovery: true }));
} catch (error) {
  const pages = browser?.contexts().flatMap(context => context.pages()) || [];
  for (let index = 0; index < pages.length; index += 1) {
    await pages[index].screenshot({ path: path.join(evidence, `failure-${index}.png`), fullPage: true }).catch(() => undefined);
    await writeFile(path.join(evidence, `failure-${index}.html`), await pages[index].content().catch(() => ''));
  }
  await writeFile(path.join(evidence, 'failure.json'), JSON.stringify({ error: String(error), pages: pages.map(page => page.url()), requests: fixture.requests, unknownRequests, externalRequests, pageErrors, results }, null, 2));
  throw error;
} finally {
  await browser?.close(); appServer?.kill();
  sockets.close(); for (const client of sockets.clients) client.terminate();
  await new Promise(resolve => fixtureServer.close(resolve));
}
