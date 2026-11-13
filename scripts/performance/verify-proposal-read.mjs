import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { installSyntheticMap } from './fixtures/map-adapter.mjs';

const base = new URL(process.argv[2]);
const baseline = process.argv.includes('--baseline');
const identityBaseline = process.argv.includes('--identity-baseline');
assert.ok(['127.0.0.1', 'localhost'].includes(base.hostname), 'isolated loopback builds only');
const { chromium } = createRequire(import.meta.url)(process.env.PERF_PLAYWRIGHT_MODULE || 'playwright-core');
const browser = await chromium.launch({ ...(process.env.PERF_BROWSER_CHANNEL === 'chromium' ? {} : { channel: 'chrome' }), headless: true });
const user = { id: '12345678-1111-4111-8111-111111111111', email: 'proposal@example.test', app_metadata: {}, user_metadata: {} };
const expires_at = Math.floor(Date.now() / 1000) + 3600;
const encode = value => Buffer.from(JSON.stringify(value)).toString('base64url');
const secondUser = { ...user, id: '12345678-2222-4222-8222-222222222222', email: 'proposal-two@example.test' };
function createSession(account, loginId = account.id, revision = 1) {
  const token = `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode({ sub: account.id, exp: expires_at, aud: 'authenticated', session_id: loginId, revision })}.fixture`;
  return { user: account, expires_at, expires_in: 3600, token_type: 'bearer', refresh_token: 'synthetic', access_token: token };
}
const session = createSession(user);
const secondSession = createSession(secondUser);
const token = session.access_token;
const projects = [
  { id: 'alpha', name: '合成甲楼' }, { id: 'beta', name: '合成乙楼' },
  { id: 'gamma', name: '合成中心东座', former_names: ['合成旧楼东座'] },
  { id: 'delta', name: '合成丁楼' }, { id: 'epsilon', name: '合成戊楼' },
];
const draft = { version: 1, clientName: '', requirementFingerprint: 'fixture', updatedAt: '2026-11-10T00:00:00Z',
  requirement: { parsed: { city: '北京', locations: [], area: { minSqm: null, maxSqm: null }, rent: { minDailyRmbSqm: null, maxDailyRmbSqm: null, basis: 'unspecified' },
    moveInMonth: null, grades: [], metro: { preferred: false, maxDistanceMeters: null }, greenCertifications: [], otherPreferences: [], unresolved: [] },
    capabilities: [], appliedCapabilities: [], evaluationCapabilities: [] },
  items: projects.slice(0, 2).map(({ id, name }) => ({ buildingId: id, buildingName: name, addedAt: '2026-11-10' })),
};
const observations = [];

try {
  for (const width of [1280, 390, ...(baseline || identityBaseline ? [] : [320])]) {
    const mobile = width < 640;
    const context = await browser.newContext({ viewport: { width, height: 844 }, isMobile: mobile, hasTouch: mobile, serviceWorkers: 'block' });
    try {
      const requests = [];
      const facts = ['buildings', 'building_metrics', 'building_brochure_data'];
      let secondProfileStarted = false;
      let releaseSecondProfile;
      const secondProfile = new Promise(resolve => { releaseSecondProfile = resolve; });
      await context.routeWebSocket(/.*/, ws => ws.close());
      await context.route('**/*', async route => {
        const req = route.request(); const url = new URL(req.url());
        if (url.origin === base.origin) {
          if (url.pathname === '/api/map/data') {
            if (url.searchParams.get('mode') === 'future') return route.fulfill({ json: { future_supplies: [] } });
            return route.fulfill({ json: { display_overrides: [], buildings: projects.map((row, index) => ({ ...row,
              grade: 'A', district: '朝阳区', submarket: '其他', location_lng: 116.46 + index * 0.001, location_lat: 39.91, building_metrics: [],
            })) } });
          }
          return url.pathname.startsWith('/api/') ? route.fulfill({ status: 204 }) : route.continue();
        }
        if (url.origin === 'https://webapi.amap.com' && url.pathname === '/maps') {
          return route.fulfill({ contentType: 'application/javascript', body: `(${installSyntheticMap.toString()})();` });
        }
        if (url.origin !== 'https://example.supabase.co') return route.abort();
        const headers = { 'access-control-allow-origin': '*', 'access-control-allow-methods': 'GET, HEAD, OPTIONS, POST', 'access-control-allow-headers': '*' };
        if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers });
        const table = url.pathname.replace('/rest/v1/', '');
        if (table === 'user_roles') {
          const id = url.searchParams.get('user_id') === `eq.${secondUser.id}` ? secondUser.id : user.id;
          if (id === secondUser.id && !identityBaseline) { secondProfileStarted = true; await secondProfile; }
          return route.fulfill({ headers, json: [{ role: 'admin', user_id: id, session_id: id }] });
        }
        if (!facts.includes(table)) return route.fulfill({ headers, json: [] });
        if (table === 'buildings' && !url.searchParams.has('id')) {
          const offset = Number(url.searchParams.get('offset') ?? 0);
          return route.fulfill({ headers, json: offset ? [] : projects.map(row => ({ ...row, district: '朝阳区', submarket: 'CBD', grade: 'A' })) });
        }
        const ids = url.searchParams.get(table === 'buildings' ? 'id' : 'building_id')?.slice(4, -1).split(',') ?? [];
        requests.push({ table, ids, scoped: req.headers().authorization === `Bearer ${token}`, secondAccount: req.headers().authorization === `Bearer ${secondSession.access_token}` });
        const selected = projects.filter(row => ids.includes(row.id));
        const data = table === 'buildings' ? selected.map(row => ({ ...row, grade: 'A', submarket: 'CBD' }))
          : table === 'building_metrics' ? selected.map(row => ({ building_id: row.id, record_year: 2026, record_quarter: 3, net_effective_rent: 440, vacancy_rate: 0.15 }))
          : selected.map(row => ({ building_id: row.id, address: '合成地址' }));
        return route.fulfill({ headers, json: data });
      });
      await context.addInitScript(({ origin, session, draft, oldStorage }) => {
        if (location.origin !== origin) return;
        if (!sessionStorage.getItem('proposal-fixture-initialized')) {
          sessionStorage.setItem('proposal-fixture-initialized', 'true');
          localStorage.setItem('colliers_trusted_device_until', String(Date.now() + 86_400_000));
          localStorage.setItem('sb-example-auth-token', JSON.stringify(session));
          if (oldStorage) sessionStorage.setItem('colliers:intelligence-proposal-draft:v1', JSON.stringify(draft));
          else {
            const id = session.user.id;
            sessionStorage.setItem('colliers:intelligence-proposal-draft:v2', JSON.stringify({ scope: JSON.stringify([id, id, 'admin', id]), draft }));
          }
        }
        window.print = () => { document.documentElement.dataset.fixturePrinted = 'true'; };
      }, { origin: base.origin, session, draft, oldStorage: baseline || identityBaseline });
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
      if (!baseline && !identityBaseline) {
        const review = page.getByRole('dialog', { name: '核对打印 / PDF' });
        await review.getByText(/合成客户 · 2 个候选.*合成乙楼、合成甲楼/).waitFor();
        assert.equal(await page.locator('html').getAttribute('data-fixture-printed'), null);
        await review.getByRole('button', { name: '打开打印预览' }).click();
        await page.waitForFunction(() => document.documentElement.dataset.fixturePrinted === 'true');
        const pdf = await page.pdf({ preferCSSPageSize: true, printBackground: true });
        assert.equal(pdf.subarray(0, 4).toString(), '%PDF');
        assert.ok(pdf.length > 1000);
        if (process.env.PERF_PROPOSAL_SCREENSHOT_DIR) await writeFile(join(process.env.PERF_PROPOSAL_SCREENSHOT_DIR, `proposal-output-${width}.pdf`), pdf);
      } else {
        assert.equal(await page.locator('html').getAttribute('data-fixture-printed'), 'true');
      }
      await articles.first().getByRole('button', { name: '移除' }).click();
      await page.getByRole('heading', { name: '合成甲楼' }).waitFor();
      assert.equal(await page.getByRole('heading', { name: '合成乙楼' }).count(), 0);
      assert.equal(requests.length, baseline ? 12 : 6);
      assert.ok(requests.slice(-3).every(read => read.ids.length === 1 && read.ids[0] === 'alpha'));
      assert.ok(requests.every(read => read.scoped));
      let paginationPages;
      if (!baseline && !identityBaseline) {
        const add = async (query, buildingName) => {
          await page.getByRole('button', { name: '添加候选楼宇' }).click();
          const picker = page.getByRole('dialog', { name: '添加候选楼宇' });
          await picker.getByRole('combobox').fill(query);
          await picker.getByRole('option', { name: buildingName }).click();
          await picker.getByText(`已选：${buildingName}`, { exact: false }).waitFor();
          await picker.getByRole('button', { name: '添加到方案' }).click();
          await page.getByRole('heading', { name: buildingName }).waitFor();
        };
        await add('合成旧楼', '合成中心东座');
        if (width === 1280) {
          for (const { name: buildingName } of [projects[1], ...projects.slice(3)]) await add(buildingName, buildingName);
          await page.evaluate(() => { delete document.documentElement.dataset.fixturePrinted; });
          await page.getByRole('button', { name: '打印 / 导出 PDF' }).click();
          const review = page.getByRole('dialog', { name: '核对打印 / PDF' });
          await review.getByText(/5 个候选/).waitFor();
          await review.getByRole('button', { name: '打开打印预览' }).click();
          await page.waitForFunction(() => document.documentElement.dataset.fixturePrinted === 'true');
          const pdf = await page.pdf({ preferCSSPageSize: true, printBackground: true });
          paginationPages = (pdf.toString('latin1').match(/\/Type\s*\/Page\b/g) ?? []).length;
          assert.ok(paginationPages > 1, 'a five-candidate proposal must paginate');
          if (process.env.PERF_PROPOSAL_SCREENSHOT_DIR) await writeFile(join(process.env.PERF_PROPOSAL_SCREENSHOT_DIR, 'proposal-multipage.pdf'), pdf);
          for (const { name: buildingName } of [projects[1], ...projects.slice(3)]) {
            await articles.filter({ has: page.getByRole('heading', { name: buildingName }) }).getByRole('button', { name: '移除' }).click();
          }
        }
        await articles.filter({ hasText: '合成中心东座' }).getByRole('button', { name: '移除' }).click();
        await page.getByRole('heading', { name: '合成甲楼' }).waitFor();
      }
      let accountSwitch;
      let mapHandoff;
      if (!baseline) {
        const handoff = new URL('/map?source=intelligence&v=1&cap=grade', base);
        handoff.searchParams.append('projectType', '甲级写字楼');
        await page.goto(handoff.href, { waitUntil: 'domcontentloaded' });
        await page.locator('#map-container [data-building-id="beta"]').first().click();
        await page.getByRole('button', { name: '加入客户方案', exact: true }).click();
        await page.getByRole('button', { name: '已加入客户方案', exact: true }).waitFor();
        await page.getByRole('button', { name: '关闭楼宇详情' }).click();
        const openProposal = page.getByRole('link', { name: /查看候选方案/ });
        if (identityBaseline && mobile) assert.equal(await openProposal.isVisible(), false);
        else await openProposal.waitFor();
        if (process.env.PERF_PROPOSAL_SCREENSHOT_DIR) await page.screenshot({
          path: join(process.env.PERF_PROPOSAL_SCREENSHOT_DIR, `proposal-map-${identityBaseline ? 'before' : 'after'}-${width}.png`),
        });
        if (identityBaseline && mobile) await page.goto(new URL('/intelligence/proposal', base).href);
        else {
          if (mobile) {
            const link = await openProposal.boundingBox();
            const modes = await page.getByRole('group', { name: '移动端地图显示模式' }).boundingBox();
            assert.ok(link?.height >= 44 && modes && link.y + link.height <= modes.y, 'the proposal link must not cover the map modes');
          }
          await openProposal.click();
        }
        await page.getByRole('heading', { name: '合成乙楼' }).waitFor();
        assert.equal(await name.inputValue(), '合成客户');
        mapHandoff = { mapAddition: true, proposalLinkVisible: !identityBaseline || !mobile, reloadedSameLogin: true };

        await page.evaluate(next => {
          const key = 'sb-example-auth-token';
          localStorage.setItem(key, JSON.stringify(next));
          const channel = new BroadcastChannel(key);
          channel.postMessage({ event: 'SIGNED_IN', session: next });
          setTimeout(() => channel.close(), 100);
        }, secondSession);
        if (identityBaseline) {
          for (let i = 0; i < 100 && requests.filter(read => read.secondAccount).length < 3; i++) await delay(25);
          await firstHeading.waitFor();
          assert.equal(await name.inputValue(), '合成客户');
          assert.equal(requests.filter(read => read.secondAccount).length, 3);
        } else {
          for (let i = 0; i < 100 && !secondProfileStarted; i++) await delay(25);
          assert.equal(secondProfileStarted, true, 'the second profile is intentionally held');
          await page.getByText('正在读取客户方案').waitFor();
          assert.equal(await name.count(), 0, 'old client is hidden while the new profile is pending');
          assert.equal(await page.evaluate(() => sessionStorage.getItem('colliers:intelligence-proposal-draft:v2')), null, 'the old draft must be removed during the credential change');
          releaseSecondProfile();
          await page.getByText('还没有客户方案草稿').waitFor();
          assert.equal(await name.count(), 0);
          assert.equal(requests.filter(read => read.secondAccount).length, 0);
          await page.goto(handoff.href, { waitUntil: 'domcontentloaded' });
          await page.locator('#map-container [data-building-id="beta"]').first().click();
          await page.getByRole('button', { name: '关闭楼宇详情' }).waitFor();
          assert.equal(await page.locator('[data-map-proposal-slot] button').count(), 0, 'another account cannot add to the old draft from a handoff URL');
          assert.equal(await openProposal.count(), 0, 'another account cannot see the old basket');
        }
        accountSwitch = { previousClientVisible: identityBaseline, previousCandidateReads: requests.filter(read => read.secondAccount).length };
      }
      observations.push({ width, initialReads: 3, extraFromMetadataAndOrder, selectedSetReads: 3, printAction: 'pass', paginationPages, mapHandoff, accountSwitch });
    } finally { await context.close(); }
  }
  console.log(JSON.stringify({ status: 'pass', baseline, identityBaseline, browser: await browser.version(), environment: 'local production build with isolated data and SDK', observations }));
} finally { await browser.close(); }
