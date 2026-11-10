import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const base = new URL(process.argv[2]);
const baseline = process.argv.includes('--baseline');
assert.ok(['127.0.0.1', 'localhost'].includes(base.hostname), 'isolated loopback builds only');
const { chromium } = createRequire(import.meta.url)(process.env.PERF_PLAYWRIGHT_MODULE || 'playwright-core');
const browser = await chromium.launch({ ...(process.env.PERF_BROWSER_CHANNEL === 'chromium' ? {} : { channel: 'chrome' }), headless: true });
const user = { id: '23456789-1111-4111-8111-111111111111', email: 'directory@example.test', app_metadata: {}, user_metadata: {} };
const expires_at = Math.floor(Date.now() / 1000) + 3600;
const encode = value => Buffer.from(JSON.stringify(value)).toString('base64url');
const token = `${encode({ alg: 'HS256' })}.${encode({ sub: user.id, exp: expires_at, aud: 'authenticated', session_id: user.id })}.fixture`;
const session = { user, expires_at, expires_in: 3600, token_type: 'bearer', refresh_token: 'synthetic', access_token: token };
const name = '历史 Alpha 楼宇';
const active = { id: 'b', name: '在跟 Beta 楼宇' };
const historical = { id: 'a', name };
const rows = [{ id: 'r', building_id: 'a', field_name: 'grade', display_label: '市场分类', display_value: '甲级展示', created_at: '2026-10-01T00:00:00Z', updated_at: '2026-10-02T00:00:00Z' }];
const observations = [];
try {
  for (const width of [1280, 390]) {
    const context = await browser.newContext({ viewport: { width, height: 844 }, isMobile: width === 390, hasTouch: width === 390, serviceWorkers: 'block' });
    let release;
    const held = new Promise(resolve => { release = resolve; });
    const overrides = rows.map(row => ({ ...row }));
    const calls = { list: 0, picker: 0, names: 0, writes: 0 };
    const auditEvents = new Set();
    try {
      await context.routeWebSocket(/.*/, ws => ws.close());
      await context.route('**/*', async route => {
        const request = route.request();
        const url = new URL(request.url());
        if (url.origin === base.origin && url.pathname === '/api/audit-events') {
          for (const event of request.postDataJSON().events) {
            if (event.target_table === 'building_display_overrides') auditEvents.add(event.action_type);
          }
          return route.fulfill({ json: {} });
        }
        if (url.origin === base.origin) return url.pathname.startsWith('/api/') ? route.fulfill({ status: 204 }) : route.continue();
        if (url.origin !== 'https://example.supabase.co') return route.abort();
        const headers = { 'access-control-allow-origin': '*', 'access-control-allow-methods': 'GET, POST, PATCH, DELETE, HEAD, OPTIONS', 'access-control-allow-headers': '*' };
        const json = data => route.fulfill({ headers, json: data });
        if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers });
        if (url.pathname === '/auth/v1/user') return json(user);
        if (url.pathname === '/rest/v1/user_roles') return json([{ role: 'admin', user_id: user.id, session_id: user.id, full_name: '合成用户' }]);
        if (url.pathname === '/rest/v1/buildings') {
          if (url.searchParams.has('is_active')) {
            calls.picker++;
            assert.equal(url.searchParams.get('tracking_scope'), 'eq.tracked');
            await held;
            return json([active]);
          }
          calls.names++;
          return json([historical]);
        }
        if (url.pathname === '/rest/v1/building_display_overrides') {
          if (request.method() === 'PATCH') {
            assert.equal(url.searchParams.get('id'), 'eq.r');
            const change = request.postDataJSON();
            assert.deepEqual(change, { field_name: 'grade', display_label: '市场分类', display_value: '更新后的展示值' });
            Object.assign(overrides[0], change);
            calls.writes++;
            return route.fulfill({ status: 204, headers });
          }
          if (request.method() === 'POST') {
            const change = request.postDataJSON();
            assert.deepEqual(change, { building_id: 'b', field_name: 'submarket', display_label: '行政区', display_value: '测试展示值' });
            overrides.unshift({ ...change, id: 'new', created_at: '2026-10-03T00:00:00Z' });
            calls.writes++;
            return route.fulfill({ status: 201, headers });
          }
          if (request.method() === 'DELETE') {
            assert.equal(url.searchParams.get('id'), 'eq.new');
            assert.equal(overrides.shift().id, 'new');
            calls.writes++;
            return route.fulfill({ status: 204, headers });
          }
          assert.equal(request.method(), 'GET');
          calls.list++;
          if (url.searchParams.get('select') === '*') return json(overrides);
          assert.match(url.searchParams.get('select'), /building:buildings!building_display_overrides_building_id_fkey\(name\)/);
          return json(overrides.map(row => {
            const projected = { ...row };
            delete projected.updated_at;
            return { ...projected, building: { name: row.building_id === 'a' ? name : active.name } };
          }));
        }
        return json([]);
      });
      await context.addInitScript(({ origin, session }) => {
        if (location.origin !== origin) return;
        localStorage.setItem('colliers_trusted_device_until', String(Date.now() + 86_400_000));
        localStorage.setItem('sb-example-auth-token', JSON.stringify(session));
      }, { origin: base.origin, session });
      const page = await context.newPage();
      page.setDefaultTimeout(10_000);
      await page.goto(new URL('/admin/display-overrides', base).href);
      const row = page.getByRole('row').filter({ hasText: name });
      const input = page.getByPlaceholder('搜索楼宇名称、字段、标签或值');
      await input.pressSequentially('Alpa');
      await input.evaluate(element => element.setSelectionRange(3, 3));
      await page.keyboard.type('h');
      let initialRequests;
      if (baseline) {
        await page.waitForTimeout(250);
        assert.equal(await row.count(), 0);
      } else {
        await row.waitFor();
        assert.equal(calls.picker, 0);
        initialRequests = calls.list + calls.picker + calls.names;
        await row.getByRole('button', { name: '编辑' }).click();
        const dialog = page.getByRole('dialog');
        assert.equal(await dialog.getByRole('combobox').first().inputValue(), 'a');
        assert.equal(await dialog.getByRole('combobox').first().isDisabled(), true);
        assert.equal(await dialog.getByRole('combobox').nth(1).isDisabled(), true);
        await dialog.getByPlaceholder('例如：朝阳区-双井、产业园').fill('更新后的展示值');
        await dialog.getByRole('button', { name: '保存', exact: true }).click();
        await row.getByText('更新后的展示值', { exact: true }).waitFor();
        assert.equal(calls.writes, 1);
        assert.equal(calls.picker, 0);
        await page.getByRole('button', { name: '新增规则', exact: true }).click();
        await dialog.getByText('正在加载可选楼宇').waitFor();
        assert.equal(await dialog.getByRole('button', { name: '新增', exact: true }).isDisabled(), true);
      }
      const listBeforePicker = await row.count() === 1;
      release();
      await row.waitFor();
      if (baseline) {
        initialRequests = calls.list + calls.picker + calls.names;
        assert.deepEqual(await input.evaluate(element => [element === document.activeElement, element.value, element.selectionStart]), [true, 'Alpha', 4]);
      } else {
        const dialog = page.getByRole('dialog');
        await dialog.getByRole('option', { name: active.name }).waitFor({ state: 'attached' });
        assert.equal(await dialog.getByRole('option', { name }).count(), 0);
        await dialog.getByRole('button', { name: '取消', exact: true }).click();
        await dialog.waitFor({ state: 'hidden' });
        assert.equal(calls.writes, 1);
        await input.fill('');
        await page.getByRole('button', { name: '新增规则', exact: true }).click();
        await dialog.getByRole('option', { name: active.name }).waitFor({ state: 'attached' });
        await dialog.getByRole('combobox').first().selectOption(active.id);
        await dialog.getByPlaceholder('例如：行政区、市场分类').fill('行政区');
        await dialog.getByPlaceholder('例如：朝阳区-双井、产业园').fill('测试展示值');
        await dialog.getByRole('button', { name: '新增', exact: true }).click();
        const created = page.getByRole('row').filter({ hasText: active.name });
        await created.getByText('测试展示值', { exact: true }).waitFor();
        const deleteAudit = page.waitForRequest(request => {
          if (new URL(request.url()).pathname !== '/api/audit-events') return false;
          return request.postDataJSON().events.some(event => event.target_table === 'building_display_overrides' && event.action_type === 'DB_DELETE');
        });
        page.once('dialog', confirm => confirm.accept());
        await created.getByRole('button', { name: '删除' }).click();
        await created.waitFor({ state: 'hidden' });
        await row.getByText('更新后的展示值', { exact: true }).waitFor();
        await (await deleteAudit).response();
        assert.deepEqual([...auditEvents].sort(), ['DB_DELETE', 'DB_INSERT', 'DB_UPDATE']);
      }
      assert.deepEqual(calls, baseline ? { list: 1, picker: 1, names: 1, writes: 0 } : { list: 4, picker: 2, names: 0, writes: 3 });
      observations.push({ width, listBeforePicker, initialRequests, ...calls, auditEvents: [...auditEvents].sort() });
    } finally { release(); await context.close(); }
  }
  console.log(JSON.stringify({ mode: baseline ? 'baseline' : 'candidate', browser: browser.version(), observations }, null, 2));
} finally { await browser.close(); }
