import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { installSyntheticMap } from '../performance/fixtures/map-adapter.mjs';

const base = new URL(process.argv[2]);
assert.ok(['127.0.0.1', 'localhost'].includes(base.hostname), 'isolated loopback builds only');
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PERF_PLAYWRIGHT_MODULE || 'playwright-core');
const XLSX = require('xlsx');
const browser = await chromium.launch({ ...(process.env.PERF_BROWSER_CHANNEL === 'chromium' ? {} : { channel: 'chrome' }), headless: true });
const user = { id: '12345678-1111-4111-8111-111111111111', email: 'broker@example.test', app_metadata: {}, user_metadata: {} };
const expires_at = Math.floor(Date.now() / 1000) + 3600;
const encode = value => Buffer.from(JSON.stringify(value)).toString('base64url');
const token = `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode({ sub: user.id, exp: expires_at, aud: 'authenticated', session_id: user.id })}.fixture`;
const session = { user, expires_at, expires_in: 3600, token_type: 'bearer', refresh_token: 'synthetic', access_token: token };
const tower = { id: '23456789-1111-4111-8111-111111111111', name: '合成中心东座', former_names: ['合成旧楼东座'], grade: 'A',
  submarket: 'CBD', district: '朝阳区', location_lng: 116.46, location_lat: 39.91, leasable_area: 1100, building_metrics: [] };
const future = { id: '23456789-2222-4222-8222-222222222222', name: '待入市演示项目',
  location_lng: 116.47, location_lat: 39.915, district: '朝阳区', submarket: 'CBD', building_grade: 'A' };
const company = '合成精确企业';
const industry = '合成行业';
const rows = [
  { read_id: 'live:1', company, record_source: 'live', new_building: tower.name, building_id: tower.id, building_match_scope: 'exact', quality_status: 'OPERATIONAL', industry, sub_market: 'CBD', effective_rent: 123.456789, area_sqm: 200, transaction_year: 2026, transaction_quarter: 'Q3', transaction_period: '2026 Q3' },
  { read_id: 'live:2', company, record_source: 'live', new_building: tower.name, building_id: tower.id, building_match_scope: 'exact', quality_status: 'OPERATIONAL', industry, sub_market: 'CBD', effective_rent: 0, area_sqm: 201, transaction_year: 2025, transaction_quarter: 'Q2', transaction_period: '2025 Q2' },
  { read_id: 'live:3', company: company + '分公司', record_source: 'live', new_building: tower.name, building_id: null, building_match_scope: 'project', transaction_year: 2026, transaction_quarter: 'Q2', transaction_period: '2026 Q2' },
];
const results = [];
try {
  for (const [width, role] of [[1280, 'admin'], [390, 'editor'], [320, 'editor']]) {
    const context = await browser.newContext({ viewport: { width, height: 844 }, isMobile: width < 640, hasTouch: width < 640, serviceWorkers: 'block', acceptDownloads: true });
    const calls = [];
    const errors = [];
    try {
      await context.addInitScript(({ origin, session }) => {
        if (location.origin !== origin || localStorage.getItem('sb-example-auth-token')) return;
        localStorage.setItem('colliers_trusted_device_until', String(Date.now() + 86_400_000));
        localStorage.setItem('sb-example-auth-token', JSON.stringify(session));
      }, { origin: base.origin, session });
      await context.routeWebSocket(/.*/, ws => ws.close());
      await context.route('**/*', async route => {
        const request = route.request();
        const url = new URL(request.url());
        const params = url.searchParams;
        if (url.origin === base.origin) {
          if (url.pathname === '/api/lease-transactions/read' || url.pathname === '/api/map/data' || url.pathname === '/api/map/sales-materials' || url.pathname === '/api/lease-submission/export') {
            assert.equal(request.headers().authorization, `Bearer ${token}`);
          }
          if (url.pathname === '/api/lease-transactions/read') {
            calls.push(Object.fromEntries(params));
            if (params.get('company_lookup') === 'suggestions') {
              const query = params.get('company');
              return route.fulfill({ json: { suggestions: company.includes(query) ? [{ company }] : [], hasRecentDeals: company === query } });
            }
            if (params.get('company_lookup') === 'recent') {
              return route.fulfill({ json: { records: rows.filter(row => row.company === params.get('company')) } });
            }
            const subset = rows.filter(row => {
              if (params.has('company_exact')) return row.company === params.get('company_exact');
              if (params.has('company')) return row.company.includes(params.get('company'));
              return !params.has('building_id') || params.get('building_id') === tower.id;
            });
            const offset = Number(params.get('offset') ?? 0);
            return route.fulfill({ json: {
              records: params.has('count_only') ? [] : subset.slice(offset, offset + Number(params.get('limit') || 50)),
              count: subset.length,
              access: { canReadHistory: role === 'admin', effectiveRole: role, effectiveSource: role === 'admin' ? 'all' : 'live', impersonating: false },
            } });
          }
          if (url.pathname === '/api/map/data') return route.fulfill({ json: { display_overrides: [], buildings: [tower], future_supplies: [future] } });
          if (url.pathname === '/api/lease-submission/export') {
            assert.equal(role, 'admin');
            return route.fulfill({ json: { records: rows, count: rows.length } });
          }
          if (url.pathname === '/api/map/sales-materials') {
            assert.equal(params.get('building_id'), tower.id);
            return route.fulfill({ json: { records: [], count: 0, total: 0, page: 1 } });
          }
          return url.pathname.startsWith('/api/') ? route.fulfill({ status: 204 }) : route.continue();
        }
        if (url.origin === 'https://webapi.amap.com' && url.pathname === '/maps') {
          return route.fulfill({ contentType: 'application/javascript', body: `(${installSyntheticMap.toString()})();` });
        }
        if (url.origin !== 'https://example.supabase.co') return route.abort();
        const headers = { 'access-control-allow-origin': '*', 'access-control-allow-methods': 'GET, HEAD, OPTIONS, POST', 'access-control-allow-headers': '*' };
        if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers });
        if (url.pathname === '/auth/v1/user') return route.fulfill({ headers, json: user });
        if (url.pathname === '/rest/v1/user_roles') return route.fulfill({ headers, json: [{ role, session_id: user.id, full_name: '合成账号' }] });
        if (url.pathname === '/rest/v1/industry_classification') return route.fulfill({ headers, json: [{ industry_level1: industry, sub_industry: '合成子行业' }] });
        if (url.pathname === '/rest/v1/buildings') return route.fulfill({ headers, json: Number(params.get('offset') ?? 0) === 0 ? [tower] : [] });
        return route.fulfill({ headers, json: [] });
      });
      const page = await context.newPage();
      try {
        page.setDefaultTimeout(12000);
        page.on('pageerror', error => errors.push(error.message));
        await page.goto(base.href);
        await page.getByRole('link', { name: '统一搜索' }).click();
        const input = page.getByRole('textbox', { name: '楼宇、项目或企业' });
        await input.fill('待入市');
        const futureLink = page.getByRole('link', { name: '地图详情' });
        await futureLink.waitFor();
        assert.ok((await futureLink.getAttribute('href'))?.includes('future=' + future.id));
        await futureLink.click();
        await page.locator('.amap-info').getByText(future.name, { exact: true }).waitFor();
        await page.getByRole('link', { name: '返回来源' }).click();
        await input.waitFor();
        assert.equal(await input.inputValue(), '待入市');
        await input.fill('');
        await input.click();
        const cdp = await context.newCDPSession(page);
        await cdp.send('Input.imeSetComposition', { text: 'he', selectionStart: 2, selectionEnd: 2 });
        await cdp.send('Input.insertText', { text: '合' });
        await page.getByRole('link', { name: '地图详情' }).waitFor();
        await page.getByRole('link', { name: `${company} · 查看成交` }).waitFor();
        assert.equal(await input.evaluate(node => node === document.activeElement && node.selectionStart === 1), true);
        if (process.env.BROKER_EVIDENCE_DIR) await page.screenshot({ path: join(process.env.BROKER_EVIDENCE_DIR, `search-${width}.png`) });
        await cdp.send('Input.insertText', { text: '旧楼' });
        await input.press('Home');
        await input.press('ArrowRight');
        await cdp.send('Input.insertText', { text: '成' });
        await page.getByRole('link', { name: '地图详情' }).waitFor();
        assert.equal(await input.inputValue(), '合成旧楼');
        assert.equal(await input.evaluate(node => node === document.activeElement && node.selectionStart === 2), true);
        await page.getByRole('link', { name: '楼书与资料' }).click();
        await page.getByText('暂无项目资料').waitFor();
        await page.getByRole('button', { name: '关闭销控' }).click();
        await page.getByRole('button', { name: '季度趋势' }).waitFor();
        await page.getByRole('button', { name: '关联成交', exact: true }).click();
        await page.getByRole('link', { name: '在成交库查看' }).click();
        await page.getByRole('textbox', { name: '搜索楼宇名称' }).waitFor();
        const openRecord = () => page.getByText(company, { exact: true }).filter({ visible: true }).first().click();
        await openRecord();
        const detail = page.getByRole('dialog', { name: '成交详情' });
        await detail.getByRole('link', { name: '查看同名企业成交' }).click();
        await page.getByText('同名企业 ' + company, { exact: false }).first().waitFor();
        await page.getByText(company, { exact: true }).filter({ visible: true }).first().waitFor();
        assert.equal(await page.getByText(company + '分公司', { exact: true }).count(), 0);
        if (role === 'admin') {
          const exportButton = page.getByRole('button', { name: '导出筛选结果' });
          await exportButton.click();
          const review = page.getByRole('dialog', { name: '核对成交导出' });
          await review.getByText(/共 2 笔/).waitFor();
          const downloadPromise = page.waitForEvent('download');
          await review.getByRole('button', { name: '下载 Excel' }).click();
          const download = await downloadPromise;
          const path = await download.path();
          const book = XLSX.readFile(path);
          assert.equal(book.Sheets['筛选成交'].O2.v, 123.456789);
          assert.equal(book.Sheets['筛选成交'].O3.v, 0);
          assert.equal(book.Sheets['导出范围'].B2.v, 2);
          if (process.env.BROKER_EVIDENCE_DIR) await download.saveAs(join(process.env.BROKER_EVIDENCE_DIR, 'filtered-deals.xlsx'));
        } else {
          assert.equal(await page.getByRole('button', { name: '导出筛选结果' }).count(), 0);
        }
        await page.getByRole('link', { name: '返回来源' }).click();
        await detail.getByRole('link', { name: '打开地图楼宇' }).click();
        await page.getByRole('button', { name: '季度趋势' }).waitFor();
        await page.getByRole('link', { name: '返回来源' }).click();
        await detail.waitFor();
        if (process.env.BROKER_EVIDENCE_DIR) await page.screenshot({ path: join(process.env.BROKER_EVIDENCE_DIR, `deal-${width}.png`) });
        await detail.getByRole('button', { name: '关闭', exact: true }).click();
        await page.getByText('常用视图', { exact: true }).click();
        await page.getByRole('button', { name: '保存到 1' }).click();
        await page.getByText('已保存到常用视图 1').waitFor();
        const companyFilter = page.getByRole('textbox', { name: '搜索公司名称' });
        await companyFilter.fill('分公司');
        await page.getByRole('button', { name: '查询', exact: true }).click();
        await page.getByText(company + '分公司', { exact: true }).filter({ visible: true }).first().waitFor();
        await page.goto(new URL('/lease-submission/history', base).href);
        await companyFilter.waitFor();
        await page.waitForFunction(() => document.querySelector('[aria-label="搜索公司名称"]')?.value === '分公司');
        await page.getByText('常用视图', { exact: true }).click();
        await page.getByRole('button', { name: '视图 1' }).click();
        await page.getByText('楼宇 ' + tower.name, { exact: true }).waitFor();
        assert.equal(await companyFilter.inputValue(), '');
        await page.goto(new URL('/lease-submission', base).href);
        if (role === 'admin') {
          await page.getByRole('button', { name: '导出数据', exact: true }).click();
          const allReview = page.getByRole('dialog', { name: '核对成交导出' });
          await allReview.getByText(/全部系统成交/).waitFor();
          const downloadPromise = page.waitForEvent('download');
          await allReview.getByRole('button', { name: '下载 Excel' }).click();
          const download = await downloadPromise;
          const allBook = XLSX.readFile(await download.path(), { cellStyles: true });
          assert.equal(allBook.Sheets['租赁成交'].X2.v, 123.456789);
          assert.equal(allBook.Sheets['租赁成交'].X3.v, 0);
          assert.equal(allBook.Sheets['租赁成交']['!ref'], 'A1:AK4');
          assert.equal(allBook.Sheets['租赁成交']['!cols'].length, 37);
          if (process.env.BROKER_EVIDENCE_DIR) await download.saveAs(join(process.env.BROKER_EVIDENCE_DIR, 'all-deals.xlsx'));
        }
        await page.getByRole('button', { name: '新增成交' }).click();
        await page.getByPlaceholder('请输入企业名称').fill(company);
        await page.getByRole('button', { name: '查看近期成交' }).click();
        const suggestion = page.getByRole('button', { name: new RegExp('采用行业：' + industry) });
        await suggestion.waitFor();
        const industryInput = page.locator('#industry');
        assert.equal(await industryInput.inputValue(), '');
        await suggestion.click();
        assert.equal(await industryInput.inputValue(), industry);
        const towerInput = page.locator('#new_building');
        await towerInput.fill('合成旧楼');
        const match = page.getByRole('option', { name: tower.name });
        assert.match(await match.getAttribute('aria-describedby') ?? '', /detail/);
        await match.click();
        const lockedTower = page.getByText('交易楼宇 *', { exact: true }).locator('..').getByText(tower.name, { exact: true });
        await lockedTower.waitFor();
        assert.equal(await page.locator('#sub_market').inputValue(), 'CBD');
        assert.equal(await page.getByRole('button', { name: /采用子市场/ }).count(), 0);
        await page.goto(new URL('/map', base).href);
        const mapSearch = page.getByRole('searchbox', { name: '搜索楼宇、子市场、业主或物业' });
        await mapSearch.fill('合成中心');
        await page.waitForFunction(() => Object.entries(sessionStorage).some(([key, value]) => key.startsWith('broker-map:v1:') && JSON.parse(value).input === '合成中心'));
        await page.goto(base.href);
        await page.goto(new URL('/map', base).href);
        await mapSearch.waitFor();
        assert.equal(await mapSearch.inputValue(), '合成中心');
        assert.ok(calls.some(item => item.building_id === tower.id));
        assert.ok(calls.some(item => item.company_exact === company && item.count_only === '1'));
        assert.deepEqual(errors, []);
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
        results.push({ width, role, searchCompositionAndCaret: true, futureProject: true, brochure: true, mapHistoryRoundTrip: true, exactCompany: true, commonViews: true, mapRecentSearch: true, confirmedSuggestionAndAlias: true, excel: role === 'admin' });
      } catch (error) {
        console.error(JSON.stringify({ width, url: page.url(), visible: (await page.locator('body').innerText()).slice(0, 3000), errors, calls }));
        throw error;
      }
    } finally { await context.close(); }
  }
  console.log(JSON.stringify({ status: 'pass', browser: await browser.version(), fixtures: 'isolated Auth, map adapter and synthetic rows', results }));
} finally { await browser.close(); }
