import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const base = new URL(process.argv[2]);
const baseline = process.argv.includes('--baseline');
assert.ok(['127.0.0.1', 'localhost'].includes(base.hostname), 'isolated loopback builds only');
const { chromium } = createRequire(import.meta.url)(process.env.PERF_PLAYWRIGHT_MODULE || 'playwright-core');
const browser = await chromium.launch({ ...(process.env.PERF_BROWSER_CHANNEL === 'chromium' ? {} : { channel: 'chrome' }), headless: true });
const user = { id: '12345678-1111-4111-8111-111111111111', email: 'proposal@example.test', app_metadata: {}, user_metadata: {} };
const expires_at = Math.floor(Date.now() / 1000) + 3600;
const encode = value => Buffer.from(JSON.stringify(value)).toString('base64url');
const token = `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode({ sub: user.id, exp: expires_at, aud: 'authenticated', session_id: user.id })}.fixture`;
const session = { user, expires_at, expires_in: 3600, token_type: 'bearer', refresh_token: 'synthetic', access_token: token };
const projects = [{ id: 'alpha', name: '合成甲楼' }, { id: 'beta', name: '合成乙楼' }];
const draft = { version: 1, clientName: '', requirementFingerprint: 'fixture', updatedAt: '2026-11-10T00:00:00Z',
  requirement: { parsed: { city: '北京', locations: [], area: { minSqm: null, maxSqm: null }, rent: { minDailyRmbSqm: null, maxDailyRmbSqm: null, basis: 'unspecified' },
    moveInMonth: null, grades: [], metro: { preferred: false, maxDistanceMeters: null }, greenCertifications: [], otherPreferences: [], unresolved: [] },
    capabilities: [], appliedCapabilities: [], evaluationCapabilities: [] },
  items: projects.map(({ id, name }) => ({ buildingId: id, buildingName: name, addedAt: '2026-11-10' })),
};
const observations = [];

try {
  for (const width of [1280, 390]) {
    const context = await browser.newContext({ viewport: { width, height: 844 }, isMobile: width === 390, hasTouch: width === 390, serviceWorkers: 'block' });
    try {
      const requests = [];
      const facts = ['buildings', 'building_metrics', 'building_brochure_data'];
      await context.routeWebSocket(/.*/, ws => ws.close());
      await context.route('**/*', async route => {
        const req = route.request(); const url = new URL(req.url());
        if (url.origin === base.origin) return url.pathname.startsWith('/api/') ? route.fulfill({ status: 204 }) : route.continue();
        if (url.origin !== 'https://example.supabase.co') return route.abort();
        const headers = { 'access-control-allow-origin': '*', 'access-control-allow-methods': 'GET, HEAD, OPTIONS, POST', 'access-control-allow-headers': '*' };
        if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers });
        const table = url.pathname.replace('/rest/v1/', '');
        if (table === 'user_roles') return route.fulfill({ headers, json: [{ role: 'admin', user_id: user.id, session_id: user.id }] });
        if (!facts.includes(table)) return route.fulfill({ headers, json: [] });
        const ids = url.searchParams.get(table === 'buildings' ? 'id' : 'building_id')?.slice(4, -1).split(',') ?? [];
        requests.push({ table, ids, scoped: req.headers().authorization === `Bearer ${token}` });
        const selected = projects.filter(row => ids.includes(row.id));
        const data = table === 'buildings' ? selected.map(row => ({ ...row, grade: 'A', submarket: 'CBD' }))
          : table === 'building_metrics' ? selected.map(row => ({ building_id: row.id, record_year: 2026, record_quarter: 3, net_effective_rent: 440, vacancy_rate: 0.15 }))
          : selected.map(row => ({ building_id: row.id, address: '合成地址' }));
        return route.fulfill({ headers, json: data });
      });
      await context.addInitScript(({ origin, session, draft }) => {
        if (location.origin !== origin) return;
        localStorage.setItem('colliers_trusted_device_until', String(Date.now() + 86_400_000));
        localStorage.setItem('sb-example-auth-token', JSON.stringify(session));
        sessionStorage.setItem('colliers:intelligence-proposal-draft:v1', JSON.stringify(draft));
        window.print = () => { document.documentElement.dataset.fixturePrinted = 'true'; };
      }, { origin: base.origin, session, draft });
      const page = await context.newPage();
      await page.goto(new URL('/intelligence/proposal', base).href, { waitUntil: 'domcontentloaded' });
      const articles = page.getByRole('article');
      const firstHeading = page.getByRole('heading', { name: '合成甲楼' });
      await firstHeading.waitFor();
      assert.equal(requests.length, 3);
      const name = page.getByPlaceholder('例如：XX科技有限公司');
      await name.fill('合成客户');
      await name.press('Tab');
      await firstHeading.waitFor();
      await articles.first().getByRole('button', { name: '下移' }).click();
      await articles.first().getByRole('heading', { name: '合成乙楼' }).waitFor();
      assert.equal(await name.inputValue(), '合成客户');
      const extraFromMetadataAndOrder = requests.length - 3;
      assert.equal(extraFromMetadataAndOrder, baseline ? 6 : 0);
      await page.getByRole('button', { name: '打印 / 导出 PDF' }).click();
      assert.equal(await page.locator('html').getAttribute('data-fixture-printed'), 'true');
      await articles.first().getByRole('button', { name: '移除' }).click();
      await page.getByRole('heading', { name: '合成甲楼' }).waitFor();
      assert.equal(await page.getByRole('heading', { name: '合成乙楼' }).count(), 0);
      assert.equal(requests.length, baseline ? 12 : 6);
      assert.ok(requests.slice(-3).every(read => read.ids.length === 1 && read.ids[0] === 'alpha'));
      assert.ok(requests.every(read => read.scoped));
      observations.push({ width, initialReads: 3, extraFromMetadataAndOrder, selectedSetReads: 3, printAction: 'pass' });
    } finally { await context.close(); }
  }
  console.log(JSON.stringify({ status: 'pass', baseline, browser: await browser.version(), environment: 'local production build with isolated data', observations }));
} finally { await browser.close(); }
