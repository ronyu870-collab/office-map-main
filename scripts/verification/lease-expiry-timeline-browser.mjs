// Actual production routes with isolated synthetic HTTP fixtures. Never targets production.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
const base = new URL(process.argv[2]);
assert.ok(['127.0.0.1', 'localhost'].includes(base.hostname));
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PERF_PLAYWRIGHT_MODULE || 'playwright-core');
const browser = await chromium.launch({ headless: true, ...(process.env.PERF_BROWSER_CHANNEL === 'chromium' ? {} : { channel: 'chrome' }) });
const baseline = process.argv.includes('--baseline');
const contextBefore = process.argv.includes('--context-before');
const output = contextBefore ? 'verification/lease-expiry-context-before' : baseline ? 'verification/lease-expiry-timeline-before' : 'verification/lease-expiry-timeline';
await mkdir(output, { recursive: true });
const user = { id: '12345678-1111-4111-8111-111111111111', email: 'expiry@example.test', app_metadata: {}, user_metadata: {} };
const expires_at = Math.floor(Date.now() / 1000) + 3600;
const encode = value => Buffer.from(JSON.stringify(value)).toString('base64url');
const token = `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode({ sub: user.id, exp: expires_at, aud: 'authenticated', session_id: user.id })}.fixture`;
const session = { user, expires_at, expires_in: 3600, token_type: 'bearer', refresh_token: 'synthetic', access_token: token };
const rows = [
  ['合成科技企业', '合成中心 A 座', '2026-10-01', '2026-12-31', true],
  ['合成长名称国际企业管理服务有限公司北京分公司', '合成商务中心北区二期 A 座', '2026-12-01', '2026-12-31', false],
  ['合成咨询企业', '合成广场', '2027-01-01', '2027-03-31', false],
  ['合成信息企业', '合成大厦', '2027-02-15', '2027-02-15', false],
  ['合成服务企业', '合成金融中心', '2027-03-01', '2027-05-31', false],
];
const items = rows.map(([company, building, proxy_start, proxy_end, has_later_name_match], i) => ({ source_kind: 'history', source_available: true, source: { id: `synthetic-${i}`, company, building, period_start: '2021-10-01', period_end: '2021-12-31', precision: 'quarter', period_source: i === 4 ? 'info_date_inferred_same_year' : 'quarter', lease_term_months: 60 }, details: { area_sqm: i === 4 ? null : [1250.5, 3200, 850, 100, 0][i], industry: i === 4 ? null : ['信息技术', '专业服务', '专业服务', '信息技术'][i], sub_industry: i === 0 ? '软件与互联网' : null, sub_market: i === 4 ? null : ['合成核心商务区', '合成新兴商务区', '合成核心商务区', '合成商务区'][i] }, proxy_start, proxy_end, has_later_name_match, source_fingerprint: 'a'.repeat(32), review: null }));
const results = [];
const scopeOnly = process.argv.includes('--admin-scope-only');
const scopeBefore = process.argv.includes('--admin-scope-before');

async function checkAdminScope() {
  for (const width of [1280, 390]) {
    for (const scenario of ['admin', 'editor', 'viewer', 'simulated']) {
      const role = scenario === 'simulated' ? 'admin' : scenario;
      const canUseExpiry = scenario === 'admin';
      const context = await browser.newContext({ viewport: { width, height: 900 }, serviceWorkers: 'block' });
      try {
        let reads = 0;
        await context.routeWebSocket(/.*/, ws => ws.close());
        await context.route('**/*', async route => {
          const req = route.request(), url = new URL(req.url());
          if (url.origin === base.origin) {
            if (url.pathname === '/api/lease-transactions/expiry') {
              reads++;
              return route.fulfill(canUseExpiry ? { json: { items, total: items.length, page: 1, page_size: 25, as_of: '2026-11-13', window_end: '2027-05-13' } } : { status: 403, json: { error: '无权访问' } });
            }
            if (url.pathname === '/api/lease-transactions/read') return route.fulfill({ json: { records: [], count: 0, access: { effectiveRole: scenario === 'simulated' ? 'editor' : role, effectiveSource: canUseExpiry ? 'all' : 'live', canReadHistory: canUseExpiry, impersonating: scenario === 'simulated' } } });
            if (url.pathname.startsWith('/api/')) return route.fulfill({ json: { submissions: [], data: [], total: 0 } });
            return route.continue();
          }
          if (url.origin !== 'https://example.supabase.co') return route.abort();
          const headers = { 'access-control-allow-origin': '*', 'access-control-allow-methods': 'GET, HEAD, OPTIONS', 'access-control-allow-headers': '*', 'access-control-expose-headers': 'content-range' };
          if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers });
          if (url.pathname === '/rest/v1/user_roles') return route.fulfill({ headers, json: [{ role, session_id: user.id, full_name: '合成验收账号' }] });
          if (url.pathname === '/auth/v1/user') return route.fulfill({ headers, json: user });
          return route.fulfill({ headers: { ...headers, 'content-range': '*/0' }, json: [] });
        });
        await context.addInitScript(({ origin, session, scenario }) => {
          if (location.origin !== origin) return;
          localStorage.setItem('colliers_trusted_device_until', String(Date.now() + 86_400_000));
          if (!localStorage.getItem('sb-example-auth-token')) localStorage.setItem('sb-example-auth-token', JSON.stringify(session));
          if (scenario === 'simulated') sessionStorage.setItem('__impersonation_state', JSON.stringify({ targetUserId: '22345678-1111-4111-8111-111111111111', targetEmail: 'simulated@example.test', targetRole: 'editor', adminUserId: session.user.id, adminEmail: session.user.email, startedAt: Date.now() }));
        }, { origin: base.origin, session, scenario });
        const page = await context.newPage();
        const link = page.getByRole('link', { name: '租约到期', exact: true });
        for (const [entry, target, heading] of [['workspace', '/lease-submission', '租赁成交填报'], ['history', '/lease-submission/history', '成交数据库']]) {
          await page.goto(new URL(target, base).href);
          await page.getByRole('heading', { name: heading }).waitFor();
          if (entry === 'history' && canUseExpiry) await page.getByRole('button', { name: '导出筛选结果' }).waitFor();
          if (canUseExpiry) await link.waitFor();
          assert.equal(await link.count(), Number(canUseExpiry), `${scenario} ${entry} expiry entry`);
          assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
          if (scenario === 'admin' || scenario === 'editor') await page.screenshot({ path: `${output}/scope-${scopeBefore ? 'before' : 'after'}-${scenario}-${entry}-${width}.png`, fullPage: true });
        }
        for (const target of ['/lease-submission/expiry', '/intelligence/lease-expiry']) {
          await page.goto(new URL(target, base).href);
          if (canUseExpiry) {
            await page.getByText('合成科技企业', { exact: true }).waitFor();
          } else if (scopeBefore) {
            await page.getByRole('heading', { name: '租约到期', exact: true }).waitFor();
            if (scenario === 'editor') await page.screenshot({ path: `${output}/scope-before-editor-direct-${width}.png`, fullPage: true });
            assert.equal(await page.getByRole('heading', { name: '租约到期', exact: true }).count(), 1, 'baseline shows the restricted feature shell');
          } else {
            await page.waitForURL(new URL('/lease-submission', base).href);
            await page.getByRole('heading', { name: '租赁成交填报' }).waitFor();
            assert.equal(await page.getByRole('heading', { name: '租约到期', exact: true }).count(), 0);
            assert.equal(await link.count(), 0);
            if (scenario === 'editor') await page.screenshot({ path: `${output}/scope-after-editor-direct-${width}.png`, fullPage: true });
          }
        }
        assert.equal(reads > 0, canUseExpiry);
        results.push({ width, scenario, expiryEntry: canUseExpiry, expiryReads: reads, directAccess: canUseExpiry ? 'allowed' : scopeBefore ? 'restricted feature shell' : 'returned to leasing' });
      } finally { await context.close(); }
    }
  }
}

try {
  if (!scopeOnly && !scopeBefore) for (const width of (baseline ? [1280, 390, 320] : [1280, 1024, 1023, 480, 479, 390, 320])) {
    const context = await browser.newContext({ viewport: { width, height: 900 }, serviceWorkers: 'block' });
    let mode = 'normal', pageErrors = [], reads = 0;
    await context.routeWebSocket(/.*/, ws => ws.close());
    await context.route('**/*', async route => {
      const req = route.request(), url = new URL(req.url());
      if (url.origin === base.origin) {
        if (['/api/lease-transactions/expiry', '/api/intelligence/lease-expiry'].includes(url.pathname)) {
          assert.equal(req.method(), 'GET'); assert.equal(req.headers().authorization, `Bearer ${token}`); reads++;
          if (mode === 'denied') return route.fulfill({ status: 403, json: { error: '当前账号无权访问' } });
          if (mode === 'error') return route.fulfill({ status: 503, json: { error: '读取失败，请重试' } });
          const page = Number(url.searchParams.get('page') || 1);
          return route.fulfill({ json: { items: mode === 'empty' ? [] : page === 1 ? items : [{ ...items[0], source: { ...items[0].source, id: 'last', company: '合成末页企业' } }], total: mode === 'empty' ? 0 : 6, page, page_size: 5, as_of: mode === 'boundary' ? '2026-12-31' : '2026-11-13', window_end: mode === 'boundary' ? '2027-06-30' : '2027-05-13' } });
        }
        if (url.pathname === '/api/lease-transactions/read') return route.fulfill({ json: { records: [], count: 0, access: { effectiveRole: 'admin', effectiveSource: 'all', canReadHistory: true, impersonating: false } } });
        if (url.pathname.startsWith('/api/')) return route.fulfill({ json: { submissions: [], data: [], total: 0 } });
        return route.continue();
      }
      if (url.origin !== 'https://example.supabase.co') return route.abort();
      const headers = { 'access-control-allow-origin': '*', 'access-control-allow-methods': 'GET, HEAD, OPTIONS', 'access-control-allow-headers': '*', 'access-control-expose-headers': 'content-range' };
      if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers });
      if (url.pathname === '/rest/v1/user_roles') return route.fulfill({ headers, json: [{ role: 'admin', session_id: user.id, full_name: '合成验收账号' }] });
      if (url.pathname === '/auth/v1/user') return route.fulfill({ headers, json: user });
      return route.fulfill({ headers: { ...headers, 'content-range': '*/0' }, json: [] });
    });
    await context.addInitScript(({ origin, session }) => {
      if (location.origin !== origin || localStorage.getItem('sb-example-auth-token')) return;
      localStorage.setItem('colliers_trusted_device_until', String(Date.now() + 86_400_000));
      localStorage.setItem('sb-example-auth-token', JSON.stringify(session));
    }, { origin: base.origin, session });
    const page = await context.newPage();
    page.on('pageerror', e => pageErrors.push(e.message));
    await page.goto(new URL('/lease-submission', base).href);
    const entry = page.getByRole('link', { name: '租约到期', exact: true });
    if (baseline) {
      await page.getByRole('button', { name: '新增成交', exact: true }).waitFor();
      await page.locator('#nprogress').waitFor({ state: 'detached' });
      await page.screenshot({ path: `${output}/entry-${width}.png`, fullPage: true });
      assert.equal(await entry.count(), 0);
      await page.goto(new URL('/intelligence/lease-expiry', base).href);
      await page.getByRole('button').filter({ hasText: '合成科技企业' }).waitFor();
      await page.locator('#nprogress').waitFor({ state: 'detached' });
      await page.locator('#nprogress').waitFor({ state: 'detached' });
    await page.screenshot({ path: `${output}/timeline-${width}.png`, fullPage: true });
      results.push({ width, baseline: true, noLeasingEntry: true });
      await context.close(); continue;
    }
    await entry.waitFor();
    await page.locator('#nprogress').waitFor({ state: 'detached' });
    await page.screenshot({ path: `${output}/entry-${width}.png`, fullPage: true });
    await entry.click();
    await page.waitForURL(new URL('/lease-submission/expiry', base).href);
    await page.getByText('合成科技企业', { exact: true }).waitFor();
    assert.equal(await page.locator('form').count(), 0);
    if (!contextBefore) { await page.getByText('1,250.5 ㎡', {exact:true}).waitFor(); await page.getByText('信息技术 / 软件与互联网', {exact:true}).waitFor(); assert.equal(await page.getByRole('button', {name:'联网补充'}).count(),0); }
    // Narrow screens use a list, avoiding a visually redistributed month axis.
    assert.equal(await page.getByRole('columnheader', { name: '预计到期时间', exact: true }).count(), width >= 1024 ? 1 : 0);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
    await page.locator('#nprogress').waitFor({ state: 'detached' });
    await page.screenshot({ path: `${output}/timeline-${width}.png`, fullPage: true });
    if (!contextBefore && width >= 1024) {
      mode = 'boundary'; await page.evaluate(() => window.dispatchEvent(new Event('focus')));
      await page.getByText('2026-12-31 — 2027-06-30（不含结束日）', {exact:true}).waitFor();
      await page.screenshot({path:`${output}/year-boundary-${width}.png`,fullPage:true});
      const labels=await page.getByRole('columnheader',{name:'预计到期时间',exact:true}).locator('span').evaluateAll(elements=>elements.map(el=>({text:el.textContent,left:el.getBoundingClientRect().left,right:el.getBoundingClientRect().right})));
      for(let i=1;i<labels.length;i++)assert.ok(labels[i].left>=labels[i-1].right+2,`axis label overlap at ${width}: ${JSON.stringify(labels)}`);
      mode='normal';await page.evaluate(()=>window.dispatchEvent(new Event('focus')));await page.getByText('2026-11-13 — 2027-05-13（不含结束日）',{exact:true}).waitFor();
    }
    await page.getByRole('button', { name: '下一页', exact: true }).click();
    await page.getByText('合成末页企业', { exact: true }).waitFor();
    assert.equal(await page.getByRole('button', { name: '下一页', exact: true }).isDisabled(), true);
    await page.getByRole('button', { name: '上一页', exact: true }).click();
    await page.getByText('合成科技企业', { exact: true }).waitFor();
    mode = 'error'; await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await page.getByRole('alert').filter({ has: page.getByRole('button', { name: '重新读取', exact: true }) }).waitFor();
    assert.equal(await page.getByRole('table').count(), 0);
    await page.screenshot({ path: `${output}/error-${width}.png`, fullPage: true });
    mode = 'empty'; await page.getByRole('button', { name: '重新读取', exact: true }).click();
    await page.getByText('未来六个月暂无可估算的到期记录。', { exact: true }).waitFor();
    await page.screenshot({ path: `${output}/empty-${width}.png`, fullPage: true });
    mode = 'normal'; await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await page.getByText('合成科技企业', { exact: true }).waitFor();
    mode = 'denied'; await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await page.getByRole('alert').filter({ has: page.getByRole('button', { name: '重新读取', exact: true }) }).waitFor(); assert.equal(await page.getByRole('table').count(), 0);
    await page.screenshot({ path: `${output}/denied-${width}.png`, fullPage: true });
    mode = 'normal'; await page.goto(new URL('/intelligence/lease-expiry', base).href);
    await page.waitForURL(new URL('/lease-submission/expiry', base).href);
    await page.getByText('合成科技企业', { exact: true }).waitFor();
    await page.getByRole('link', { name: '返回租赁成交', exact: true }).click();
    await entry.waitFor();
    await page.goto(new URL('/lease-submission/history', base).href);
    await entry.waitFor(); await page.screenshot({ path: `${output}/database-entry-${width}.png`, fullPage: true });
    assert.deepEqual(pageErrors, []);
    results.push({ width, navigation: true, legacyRedirect: true, databaseEntry: true, readonly: true, pagination: true, errorRecovery: true, empty: true, revocationClearsData: true, noOverflow: true, reads, pageErrors });
    await context.close();
  }
  if (!baseline && !contextBefore) await checkAdminScope();
  const record = { environment: 'actual local Next production routes, synthetic HTTP data and identity; no production reads', browser: await browser.version(), results };
  await writeFile(`${output}/${scopeBefore ? 'scope-before' : scopeOnly ? 'scope-after' : 'results'}.json`, JSON.stringify(record, null, 2));
  console.log(JSON.stringify(record));
} finally { await browser.close(); }
