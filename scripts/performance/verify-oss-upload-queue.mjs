import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { setTimeout as delay } from 'node:timers/promises';

const base = new URL(process.argv[2]);
const baseline = process.argv.includes('--baseline');
assert.ok(['127.0.0.1', 'localhost'].includes(base.hostname), 'isolated loopback builds only');
const { chromium } = createRequire(import.meta.url)(process.env.PERF_PLAYWRIGHT_MODULE || 'playwright-core');
const browser = await chromium.launch({ ...(process.env.PERF_BROWSER_CHANNEL === 'chromium' ? {} : { channel: 'chrome' }), headless: true });
const user = { id: '87654321-1111-4111-8111-111111111111', email: 'upload@example.test', app_metadata: {}, user_metadata: {} };
const expires_at = Math.floor(Date.now() / 1000) + 3600;
const encode = value => Buffer.from(JSON.stringify(value)).toString('base64url');
const token = `${encode({ alg: 'HS256' })}.${encode({ sub: user.id, exp: expires_at, aud: 'authenticated', session_id: user.id })}.fixture`;
const session = { user, expires_at, expires_in: 3600, token_type: 'bearer', refresh_token: 'synthetic', access_token: token };
const fixtureFile = name => ({ name, mimeType: 'application/octet-stream', buffer: Buffer.from(`fixture ${name}`) });
const observations = [];

try {
  for (const [routePath, width, role] of [['/oss', 1280, 'admin'], ['/admin?section=oss', 390, 'admin'], ['/oss', 390, 'viewer']]) {
    const context = await browser.newContext({ viewport: { width, height: 900 }, isMobile: width < 640, hasTouch: width < 640, serviceWorkers: 'block' });
    try {
      const reads = [], uploadKeys = [], audits = [], violations = [];
      let releaseLate;
      const late = new Promise(resolve => { releaseLate = resolve; });
      const stored = new Set(['reports/Existing.pdf']);
      let roleReady = false, active = 0, peak = 0, signatures = 0, uploadStart = null, uploadEnd = null;
      let fail = true;
      await context.routeWebSocket(/.*/, ws => ws.close());
      await context.route('**/*', async route => {
        const req = route.request();
        const url = new URL(req.url());
        if (url.origin === base.origin) {
          if (url.pathname === '/fixture-upload') {
            const form = req.postData() ?? '';
            const key = form.match(/name="key"\r\n\r\n([^\r\n]+)/)?.[1];
            if (!key || !form.includes('synthetic-policy') || !form.includes('synthetic-signature')) violations.push('unexpected upload form');
            active++; peak = Math.max(peak, active); uploadKeys.push(key); uploadStart ??= performance.now();
            try {
              if (key === 'reports/Late.pdf') await late;
              else await delay(220);
              if (key === 'reports/Fail.pdf' && fail) return await route.fulfill({ status: 503 });
              stored.add(key);
              return await route.fulfill({ status: 200 });
            } finally { active--; uploadEnd = performance.now(); }
          }
          if (url.pathname === '/api/oss') {
            if (!roleReady || req.headers().authorization !== `Bearer ${token}`) violations.push('OSS call without the verified fixture token');
            const action = url.searchParams.get('action');
            if (action === 'get-list') {
              const prefix = url.searchParams.get('prefix'); reads.push(prefix);
              const data = prefix === '' ? [{ name: 'reports/', type: 'folder' }, { name: 'other/', type: 'folder' }]
                : [...stored].filter(key => key?.startsWith(prefix)).map(name => ({ name, type: 'file' }));
              return route.fulfill({ json: { status: 'success', data, truncated: false } });
            }
            if (action === 'get-signature') {
              signatures++;
              if (role !== 'admin') violations.push('viewer requested a write signature');
              return route.fulfill({ json: { status: 'success', host: new URL('/fixture-upload', base).href, accessid: 'synthetic-access', policy: 'synthetic-policy', signature: 'synthetic-signature' } });
            }
            violations.push(`unexpected OSS action: ${action}`);
          }
          if (url.pathname === '/api/audit-events') {
            if (req.headers().authorization !== `Bearer ${token}`) violations.push('audit credential mismatch');
            const events = req.postDataJSON().events;
            audits.push(...events.filter(event => event.action_type === 'OSS_UPLOAD'));
            return route.fulfill({ json: { accepted_event_ids: events.map(event => event.event_id) } });
          }
          return url.pathname.startsWith('/api/') ? route.fulfill({ status: 204 }) : route.continue();
        }
        if (url.origin !== 'https://example.supabase.co') return route.abort();
        const headers = { 'access-control-allow-origin': '*', 'access-control-allow-methods': 'GET, HEAD, OPTIONS, POST', 'access-control-allow-headers': '*' };
        if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers });
        if (url.pathname === '/auth/v1/user') return route.fulfill({ headers, json: user });
        if (url.pathname.endsWith('/user_roles')) {
          roleReady = true;
          return route.fulfill({ headers, json: [{ role, user_id: user.id, session_id: user.id, full_name: '隔离资料库' }] });
        }
        return route.fulfill({ headers, json: [] });
      });
      await context.addInitScript(({ origin, session }) => {
        if (location.origin !== origin) return;
        localStorage.setItem('colliers_trusted_device_until', String(Date.now() + 86_400_000));
        localStorage.setItem('sb-example-auth-token', JSON.stringify(session));
      }, { origin: base.origin, session });
      const page = await context.newPage();
      await page.goto(new URL(routePath, base).href);
      await page.getByRole('button', { name: /^reports(?:\s|$)/ }).click({ timeout: 8000 }).catch(async error => {
        throw new Error(`Cannot open ${routePath} at ${width}px: ${page.url()} ${await page.locator('main').innerText().catch(() => '')}`, { cause: error });
      });
      await page.getByRole('button', { name: /^Existing\.pdf(?:\s|$)/ }).waitFor();
      const upload = page.getByRole('button', { name: '上传文件' });
      if (role !== 'admin') {
        assert.equal(await upload.count(), 0);
        assert.equal(signatures, 0);
        assert.deepEqual(violations, []);
        observations.push({ width, routePath, role, signatures });
        continue;
      }
      const search = page.getByRole('textbox', { name: '搜索当前目录资料' });
      const input = page.locator('input[type="file"][multiple]');
      await input.setInputFiles(['Alpha.pdf', 'Fail.pdf', 'Omega.pdf', 'alpha.PDF', 'Existing.pdf', 'blocked.zip'].map(fixtureFile));
      await page.getByText('云端存储上传失败（状态码 503）').waitFor();
      await page.getByRole('button', { name: /^Omega\.pdf(?:\s|$)/ }).waitFor();
      await page.getByText('当前目录已存在同名文件').waitFor();
      await page.getByText('不支持此文件类型').waitFor();
      if (!baseline) {
        await page.getByText('本次选择中已有同名文件').waitFor();
        await page.getByText('上传队列已处理：成功 2 个，失败 1 个，未上传 3 个。').waitFor();
      }
      const failed = page.getByRole('button', { name: /^Fail\.pdf(?:\s|$)/ });
      assert.equal(await failed.count(), 0);
      const batch = { peak, durationMs: Math.round(uploadEnd - uploadStart), keys: [...uploadKeys], reads: [...reads], signatures };
      fail = false;
      await upload.waitFor();
      await input.setInputFiles(fixtureFile('Fail.pdf'));
      await failed.waitFor();
      await search.pressSequentially('Fai');
      assert.equal(await search.evaluate(el => document.activeElement === el && el.selectionStart === 3), true);
      assert.equal(await page.getByRole('button', { name: /^Omega\.pdf(?:\s|$)/ }).count(), 0);
      assert.equal(signatures, 2);
      assert.deepEqual(reads, ['', 'reports/', 'reports/', 'reports/']);
      const retriedKey = uploadKeys.at(-1);
      await page.evaluate(() => window.dispatchEvent(new Event('online')));
      for (let i = 0; i < 80 && audits.length < (baseline ? 4 : 3); i++) await delay(100);
      assert.deepEqual(audits.map(event => event.details.fileName).sort(),
        ['reports/Alpha.pdf', 'reports/Fail.pdf', 'reports/Omega.pdf', ...(baseline ? ['reports/alpha.PDF'] : [])].sort());
      assert.ok(audits.every(event => event.origin_user_id === user.id), 'each audit must retain the fixture actor');
      let stayedInNewFolder = null;
      if (width === 1280) {
        await search.fill('');
        await input.setInputFiles(fixtureFile('Late.pdf'));
        for (let i = 0; i < 80 && !uploadKeys.includes('reports/Late.pdf'); i++) await delay(25);
        assert.equal(uploadKeys.at(-1), 'reports/Late.pdf');
        await page.getByRole('button', { name: '上一级' }).click();
        await page.getByRole('button', { name: /^other(?:\s|$)/ }).click();
        await page.getByRole('navigation', { name: '资料库路径' }).getByText('other', { exact: true }).waitFor();
        releaseLate();
        await upload.waitFor();
        assert.deepEqual(reads, ['', 'reports/', 'reports/', 'reports/', '', 'other/']);
        stayedInNewFolder = true;
        await page.getByRole('button', { name: '上一级' }).click();
        await page.getByRole('button', { name: /^reports(?:\s|$)/ }).click();
        await page.getByRole('button', { name: /^Late\.pdf(?:\s|$)/ }).waitFor();
      }
      assert.deepEqual(violations, []);
      observations.push({ width, routePath, role, batch, retriedKey, auditEventsAfterRetry: baseline ? 4 : 3, searchFocus: true, stayedInNewFolder });
    } finally { await context.close(); }
  }
  console.log(JSON.stringify({ baseline, browser: await browser.version(), observations }, null, 2));
  for (const result of observations.filter(row => row.role === 'admin')) {
    assert.equal(result.batch.peak, baseline ? 1 : 2);
    assert.deepEqual(result.batch.keys.sort(), ['reports/Alpha.pdf', 'reports/Fail.pdf', 'reports/Omega.pdf', ...(baseline ? ['reports/alpha.PDF'] : [])].sort());
    assert.equal(result.batch.signatures, 1);
  }
} finally { await browser.close(); }
