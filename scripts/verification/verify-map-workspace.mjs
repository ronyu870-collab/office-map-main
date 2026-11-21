import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { installSyntheticMap } from '../performance/fixtures/map-adapter.mjs';

// Exercise the production React workspace and real MapController with isolated
// authorized data and SDK transport. No live database or tile service is used.
const base = new URL(process.argv[2]);
assert.ok(['127.0.0.1', 'localhost'].includes(base.hostname));
const { chromium } = createRequire(import.meta.url)(process.env.PERF_PLAYWRIGHT_MODULE || 'playwright-core');
const browser = await chromium.launch({ ...(process.env.PERF_BROWSER_CHANNEL === 'chromium' ? {} : { channel: 'chrome' }), headless: true });
const user = { id: '45678901-1111-4111-8111-111111111111', email: 'workspace@example.test', app_metadata: {}, user_metadata: {} };
const expires_at = Math.floor(Date.now() / 1000) + 3600;
const encode = value => Buffer.from(JSON.stringify(value)).toString('base64url');
const token = `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode({ sub: user.id, exp: expires_at, aud: 'authenticated', session_id: user.id })}.fixture`;
const session = { user, expires_at, expires_in: 3600, token_type: 'bearer', refresh_token: 'synthetic', access_token: token };
const stock = [
  { id: 'cbd-a', name: 'CBD甲楼', submarket: 'CBD', location_lng: 116.46, location_lat: 39.91 },
  { id: 'cbd-b', name: 'CBD乙楼', submarket: 'CBD', location_lng: 116.48, location_lat: 39.92 },
  { id: 'other', name: '中关村楼·' + '超长项目名称及楼座信息'.repeat(6), submarket: '中关村', location_lng: 116.32, location_lat: 39.98 },
  { id: 'missing', name: '未定位楼', submarket: 'CBD', location_lng: null, location_lat: null },
].map(building => ({ ...building, grade: 'A', district: '朝阳区', building_metrics: [{ id: `m-${building.id}`, building_id: building.id, record_year: 2026, record_quarter: 3, total_area: 10000, net_effective_rent: 200, vacancy_rate: .12 }] }));
const future = [{ id: 'future-cbd', building_id: 'master-cbd', name: 'CBD未来楼', type: '办公', district: '朝阳区', submarket: 'CBD', launch_year: 2027, launch_quarter: 'Q2', total_area: 80000, location_lng: 116.47, location_lat: 39.92 }];
function instrumentMap() {
  const BaseMap = window.AMap.Map;
  const stats = window.__workspaceSDK = { created: 0, resized: 0, centers: [], nativeOpens: 0 };
  window.AMap.Bounds = class { constructor(southwest, northeast) { this.southwest = southwest; this.northeast = northeast; } };
  window.AMap.Map = class extends BaseMap {
    constructor(id, options) { super(id, options); stats.created++; window.__workspaceMap = this; this.host = document.getElementById(id); }
    getContainer() { return this.host; }
    setCenter(center) { this.center = Array.isArray(center) ? center : [center.getLng?.() ?? center.lng, center.getLat?.() ?? center.lat]; stats.centers.push(this.center); }
    setBounds(bounds) { this.center = bounds.southwest.map((value, index) => (value + bounds.northeast[index]) / 2); }
    resize() { stats.resized++; }
    panBy() {}
  };
  const Popup = window.AMap.InfoWindow;
  window.AMap.InfoWindow = class extends Popup { open(...args) { stats.nativeOpens++; super.open(...args); } };
}
const observations = [];
try {
  for (const width of [1536, 1280, 1024, 768, 390, 320]) {
    const height = width === 1280 ? 720 : width === 768 ? 640 : width < 640 ? 844 : 1000;
    const context = await browser.newContext({ viewport: { width, height }, isMobile: width < 640, hasTouch: width < 640, serviceWorkers: 'block' });
    const errors = [];
    let stockReads = 0;
    let page;
    try {
      await context.routeWebSocket(/.*/, socket => socket.close());
      await context.route('**/*', route => {
        const url = new URL(route.request().url());
        if (url.origin === base.origin) {
          if (url.pathname === '/api/map/data') {
            assert.equal(route.request().headers().authorization, `Bearer ${token}`);
            if (url.searchParams.get('mode') === 'trend') return route.fulfill({ json: { metrics: [2026, 2025].map(year => ({ record_year: year, record_quarter: year === 2026 ? 3 : 4, net_effective_rent: 200, vacancy_rate: .12 })) } });
            if (url.searchParams.get('mode') === 'future') return route.fulfill({ json: { future_supplies: future } });
            stockReads++;
            return route.fulfill({ json: { buildings: stock, display_overrides: [] } });
          }
          if (url.pathname === '/api/map/submarket') return route.fulfill({ json: {
            submarket: 'CBD', stockCount: 3, profileAvailable: true, profilePublished: true,
            profile: { submarket: 'CBD', headline: '国际商务集聚区', overview: '测试区域介绍', industries: '', transport: '', demographics: [], policies: [], insights: [], updatedAt: '2026-11-18T00:00:00Z', updatedBy: null },
            trends: { all: [], a: [], b: [] }, trendError: false, quarterMethod: 'same quarter', source: 'building_metrics',
          } });
          if (url.pathname.startsWith('/api/')) return route.fulfill({ status: 204 });
          return route.continue();
        }
        if (url.origin === 'https://example.supabase.co') {
          const headers = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'GET, OPTIONS' };
          if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers });
          return route.fulfill({ headers, json: url.pathname === '/rest/v1/user_roles' ? [{ role: width === 1024 ? 'admin' : 'viewer', session_id: user.id }] : [] });
        }
        if (url.origin === 'https://webapi.amap.com' && url.pathname === '/maps') return route.fulfill({ contentType: 'application/javascript', body: `(${installSyntheticMap.toString()})();(${instrumentMap.toString()})();` });
        return route.abort();
      });
      await context.addInitScript(({ origin, session }) => {
        if (location.origin !== origin) return;
        localStorage.setItem('colliers_trusted_device_until', String(Date.now() + 86400000));
        localStorage.setItem('sb-example-auth-token', JSON.stringify(session));
      }, { origin: base.origin, session });
      page = await context.newPage();
      console.log("viewport", width);
      page.on('pageerror', error => errors.push(error.message));
      await page.goto(new URL('/map', base).href);
      await page.locator('#map-container [data-building-id="cbd-a"]').first().waitFor();
      assert.equal(await page.locator('.map-workspace-right').getAttribute('aria-hidden'), 'true');
      const overview = page.locator('.map-market-overview > summary');
      await overview.focus();
      await overview.press('Enter');
      const menu = page.locator('.map-disclosure-content');
      await menu.getByText('有坐标项目', { exact: true }).waitFor();
      await menu.getByText(/按筛选结果统计，不随地图移动变化/).waitFor();
      const statsBeforeMove = await menu.locator('dl').innerText();
      await page.evaluate(() => { window.__workspaceMap.emit('moveend'); });
      assert.equal(await menu.locator('dl').innerText(), statsBeforeMove);
      const popup = await menu.boundingBox();
      assert.ok(popup.x >= 0 && popup.x + popup.width <= width && popup.y >= 0 && popup.y + popup.height <= height, 'statistics fit the visible viewport');
      await page.keyboard.press('Escape');
      await menu.waitFor({ state: 'detached' });
      assert.ok(await overview.evaluate(el => el === document.activeElement), 'disclosure returns focus');
      await page.locator('.map-workspace-legend > summary').click();
      await menu.waitFor();
      await overview.click();
      assert.equal(await page.locator('.map-disclosure[open]').count(), 1, 'statistics and legend do not stack');
      await page.keyboard.press('Escape');
      await page.getByRole('button', { name: '筛选', exact: true }).click();
      await page.getByRole('button', { name: '项目列表', exact: true }).click();
      const list = page.getByRole('region', { name: '项目列表', exact: true });
      await list.waitFor();
      await page.waitForTimeout(300);
      const canvas = await page.locator('#map-container').boundingBox();
      if (width < 1000) assert.ok(canvas.height < 700 && canvas.height >= 180, `compact canvas height ${canvas.height}`);
      if (width >= 1000) assert.ok(canvas.width >= 560, `canvas width ${canvas.width} at viewport ${width}`);
      const rightBox = await page.locator('.map-workspace-right').boundingBox();
      const typography = await page.evaluate(() => {
        const sizes = new Set(), weights = new Set();
        const walker = document.createTreeWalker(document.querySelector('.map-workbench'), NodeFilter.SHOW_TEXT);
        while (walker.nextNode()) {
          const node = walker.currentNode, el = node.parentElement;
          if (!node.textContent.trim() || !el || el.closest('#map-container, [hidden], [aria-hidden="true"], .sr-only')) continue;
          const box = el.getBoundingClientRect(), style = getComputedStyle(el);
          if (!box.width || !box.height || style.visibility === 'hidden' || style.display === 'none') continue;
          sizes.add(style.fontSize); weights.add(style.fontWeight);
        }
        return { sizes: [...sizes].sort(), weights: [...weights].sort() };
      });
      assert.ok(typography.sizes.every(size => ['14px', '16px'].includes(size)), `workspace typography ${JSON.stringify(typography)}`);
      assert.ok(typography.weights.every(weight => ['400', '600'].includes(weight)), `workspace weights ${JSON.stringify(typography)}`);
      if (width >= 1000) {
        assert.equal(Math.round(rightBox.width), 320, 'list gets its own compact width');
        const leftVisible = await page.locator('.map-workspace-left').getAttribute('data-open');
        assert.ok(canvas.width >= width * (leftVisible ? .52 : .6) - 1, 'map keeps a proportion, not only a pixel minimum');
      } else {
        assert.ok((await list.locator('.workspace-scroll').boundingBox()).height >= 100, 'compact list must leave real, scrollable result space');
      }
      await page.screenshot({ path: `/tmp/map-layout-list-${width}.png` });
      if (width === 1536) assert.equal(await page.locator('.map-workspace-left').getAttribute('data-open'), 'true');
      if (width === 1024) assert.equal(await page.locator('.map-workspace-left').getAttribute('aria-hidden'), 'true');
      if (width === 1536) {
        const separator = page.getByRole('separator', { name: '调整业务工作区宽度' });
        await separator.press('End');
        await page.waitForTimeout(300);
        assert.equal(await separator.getAttribute('aria-valuenow'), '400');
        await separator.press('Home');
        await page.waitForTimeout(300);
        const edge = await separator.boundingBox();
        await page.mouse.move(edge.x + 3, edge.y + 100);
        await page.mouse.down();
        await page.mouse.move(edge.x - 77, edge.y + 100);
        await page.mouse.up();
        await page.waitForTimeout(300);
        assert.equal(await separator.getAttribute('aria-valuenow'), '380');
        await page.getByRole('button', { name: '地图专注', exact: true }).click();
        await page.waitForTimeout(300);
        assert.equal(Math.round((await page.locator('#map-container').boundingBox()).width), width);
        await page.getByRole('button', { name: '恢复工作区', exact: true }).click();
        await list.waitFor();
      }
      if (width === 1536 || width === 390) {
        await list.getByRole('button', { name: '选择项目', exact: true }).click();
        await list.getByRole('checkbox', { name: '选择CBD甲楼', exact: true }).check();
        const exportTrigger = list.getByRole('button', { name: '导出对比图 PNG', exact: true });
        await exportTrigger.click();
        const dialog = page.getByRole('dialog', { name: '导出楼宇参数对比', exact: true });
        await dialog.waitFor();
        const rect = await dialog.boundingBox();
        assert.ok(rect.x >= 0 && rect.y >= 0 && rect.x + rect.width <= width && rect.y + rect.height <= height, 'export modal fits the viewport');
        if (width === 1536) assert.ok(rect.width > rightBox.width, 'export modal escapes narrow sidebar containment');
        await page.keyboard.press('Escape');
        await dialog.waitFor({ state: 'detached' });
        assert.ok(await exportTrigger.evaluate(el => el === document.activeElement), 'closing export returns focus');
        assert.ok(await list.getByRole('checkbox', { name: '选择CBD甲楼', exact: true }).isChecked());
        await list.getByRole('button', { name: '完成选择', exact: true }).click();
      }
      if (width === 1536) {
        await page.setViewportSize({ width: 1024, height });
        await page.waitForTimeout(350);
        assert.equal(await page.locator('.map-workspace-left').getAttribute('aria-hidden'), 'true');
        await page.getByRole('button', { name: '恢复筛选', exact: true }).click();
        await page.getByRole('button', { name: '返回业务工作区', exact: true }).click();
        await page.setViewportSize({ width, height });
        await page.waitForTimeout(350);
        assert.equal(await page.locator('.map-workspace-left').getAttribute('data-open'), 'true', 'automatic yielding preserves the filter intent');
        assert.equal(Math.round((await page.locator('.map-workspace-right').boundingBox()).width), 380, 'list width survives resize and focus mode');
      }
      if (width === 390) {
        await list.getByRole('button', { name: '阅读', exact: true }).click();
        await page.waitForTimeout(200);
        const readingHeight = (await page.locator('.map-workspace-right').boundingBox()).height;
        await list.getByRole('button', { name: '全屏阅读工作区', exact: true }).click();
        await page.keyboard.press('Escape');
        await page.waitForTimeout(200);
        assert.ok(Math.abs((await page.locator('.map-workspace-right').boundingBox()).height - readingHeight) <= 1, 'fullscreen Escape restores prior reading height');
      }
      await list.getByRole('combobox', { name: '项目列表排序' }).selectOption('name');
      await list.getByRole('button', { name: /^CBD甲楼/ }).click();
      await page.getByRole('region', { name: 'CBD甲楼楼宇详情' }).waitFor();
      await page.waitForTimeout(350);
      if (width === 1536) assert.equal(Math.round((await page.locator('.map-workspace-right').boundingBox()).width), 376, 'building has a distinct default width');
      await page.getByRole('region', { name: 'CBD甲楼楼宇详情' }).getByText('200', { exact: true }).waitFor();
      await page.screenshot({ path: `/tmp/map-layout-building-${width}.png` });
      assert.equal(await page.locator('.workspace-building').count(), 1);
      assert.equal(await page.locator('.map-selected-marker').count(), 1);
      const highlight = await page.locator('.map-selected-marker__ring').evaluate(el => ({ color: getComputedStyle(el).borderColor, count: getComputedStyle(el).animationIterationCount }));
      assert.notEqual(highlight.count, 'infinite');
      assert.ok(highlight.color.includes('242, 140, 92'), highlight.color);
      await page.evaluate(() => { window.__workspaceMap.emit('click'); window.__workspaceMap.emit('zoomend'); window.__workspaceMap.emit('moveend'); });
      assert.equal(await page.getByRole('region', { name: 'CBD甲楼楼宇详情' }).count(), 1);
      await page.getByRole('tab', { name: '行情', exact: true }).click();
      await page.getByRole('button', { name: '季度趋势', exact: true }).click();
      await page.locator('#info-chart-container canvas').waitFor();
      if (width === 1536) {
        await page.getByRole('separator', { name: '调整业务工作区宽度' }).press('End');
        await page.waitForTimeout(450);
        const chartSize = await page.locator('#info-chart-container').evaluate(el => ({ host: el.clientWidth, canvas: el.querySelector('canvas').getBoundingClientRect().width }));
        assert.ok(Math.abs(chartSize.host - chartSize.canvas) <= 2, `chart must resize with workspace: ${JSON.stringify(chartSize)}`);
      }
      await page.getByRole('tab', { name: '概览', exact: true }).click();
      assert.equal(await page.locator('#info-chart-container canvas').isVisible(), false, 'trend belongs only to the market tab');
      await page.getByRole('tab', { name: '行情', exact: true }).click();
      await page.getByRole('button', { name: '季度趋势', exact: true }).click();
      assert.equal(await page.locator('#info-chart-container canvas').count(), 0);
      await page.getByRole('tab', { name: '成交与资料', exact: true }).click();
      await page.getByRole('button', { name: '联系方式', exact: true }).click();
      await page.locator('#__colliers_contact_modal_overlay').waitFor();
      await page.keyboard.press('Escape');
      assert.equal(await page.getByRole('region', { name: 'CBD甲楼楼宇详情' }).count(), 1, 'Escape in a business modal must not close its workspace');
      await page.locator('#__colliers_contact_modal_overlay button').first().click();
      await page.getByRole('button', { name: '返回项目列表', exact: true }).click();
      assert.equal(await list.getByRole('combobox', { name: '项目列表排序' }).inputValue(), 'name');
      if (width === 1536) {
        await page.waitForTimeout(300);
        assert.equal(Math.round((await page.locator('.map-workspace-right').boundingBox()).width), 380, 'return restores list width without using the building width');
      }
      await list.getByRole('button', { name: /^未定位楼/ }).click();
      await page.getByRole('region', { name: '未定位楼楼宇详情' }).waitFor();
      await page.getByText('此项目未提供有效坐标，可继续查看资料。').waitFor();
      assert.equal(await page.locator('.map-selected-marker').count(), 0);
      await page.getByRole('button', { name: '关闭楼宇详情' }).click();
      // Trigger the exact event emitted by SDK area bubbles; the production reducer,
      // filters, controller renderers and sidebar synchronization all remain real.
      const researchViewport = await page.evaluate(() => ({ zoom: window.__workspaceMap.getZoom(), lng: window.__workspaceMap.getCenter().lng, lat: window.__workspaceMap.getCenter().lat }));
      await page.evaluate(() => window.dispatchEvent(new CustomEvent('map-submarket-open', { detail: { name: 'CBD' } })));
      await page.getByRole('region', { name: 'CBD', exact: true }).waitFor();
      if (width === 1536) {
        await page.waitForTimeout(300);
        assert.equal(Math.round((await page.locator('.map-workspace-right').boundingBox()).width), 400, 'research has its own reading width');
        await page.getByRole('separator', { name: '调整业务工作区宽度' }).press('End');
        await page.waitForTimeout(300);
        assert.equal(Math.round((await page.locator('.map-workspace-right').boundingBox()).width), 520);
        assert.equal(await page.locator('.map-workspace-left').getAttribute('aria-hidden'), 'true', 'wide research yields the filter temporarily');
      }
      await page.screenshot({ path: `/tmp/map-layout-research-${width}.png` });
      await page.getByRole('button', { name: '查看全部项目', exact: true }).click();
      await list.waitFor();
      await page.waitForTimeout(400);
      await page.locator('#map-container [data-building-id="cbd-a"]').first().waitFor({ state: 'attached' });
      assert.equal(await page.locator('#map-container [data-building-id="other"]').count(), 0);
      assert.equal(await list.getByRole('button', { name: /^中关村楼/ }).count(), 0);
      await list.getByRole('button', { name: /^CBD乙楼/ }).click();
      await page.getByRole('region', { name: 'CBD乙楼楼宇详情' }).waitFor();
      await page.getByRole('button', { name: '返回项目列表', exact: true }).click();
      await page.getByRole('button', { name: '返回子市场研究', exact: true }).click();
      if (width === 1536) {
        await page.waitForTimeout(300);
        assert.equal(Math.round((await page.locator('.map-workspace-right').boundingBox()).width), 520, 'return restores research width');
      }
      await page.getByRole('button', { name: '关闭子市场介绍' }).click();
      assert.deepEqual(await page.evaluate(() => ({ zoom: window.__workspaceMap.getZoom(), lng: window.__workspaceMap.getCenter().lng, lat: window.__workspaceMap.getCenter().lat })), researchViewport);
      await page.getByRole('button', { name: '项目列表', exact: true }).click();
      await list.getByRole('button', { name: /^中关村楼/ }).waitFor();
      await page.locator('#map-container [data-building-id="other"]').first().waitFor({ state: 'attached' });
      await page.evaluate(() => window.dispatchEvent(new CustomEvent('map-submarket-open', { detail: { name: 'CBD' } })));
      await page.getByRole('region', { name: 'CBD', exact: true }).waitFor();
      await page.getByRole('button', { name: '未来供应', exact: true }).click();
      await page.getByRole('button', { name: '未来供应', exact: true }).click();
      assert.equal(await page.locator('.map-workspace-right').getAttribute('aria-hidden'), 'true');
      await page.getByRole('button', { name: '项目列表', exact: true }).click();
      await list.getByRole('button', { name: /^中关村楼/ }).waitFor();
      if (width === 1024) {
        await page.evaluate(() => window.dispatchEvent(new CustomEvent('map-submarket-open', { detail: { name: 'CBD' } })));
        await page.getByRole('button', { name: '维护资料', exact: true }).click();
        await page.getByRole('textbox', { name: '一句话定位', exact: true }).fill('尚未保存的资料');
        let confirmations = 0;
        const rejectExit = dialog => { confirmations++; void dialog.dismiss(); };
        page.on('dialog', rejectExit);
        await page.evaluate(() => window.dispatchEvent(new CustomEvent('map-submarket-open', { detail: { name: '中关村' } })));
        await page.getByRole('textbox', { name: '一句话定位', exact: true }).waitFor();
        await page.getByRole('button', { name: '完整列表', exact: true }).click();
        await page.getByRole('textbox', { name: '一句话定位', exact: true }).waitFor();
        await page.getByRole('button', { name: '未来供应', exact: true }).click();
        await page.getByRole('button', { name: '未来供应', exact: true }).click();
        await page.getByRole('button', { name: '返回子市场研究', exact: true }).click();
        assert.equal(await page.getByRole('textbox', { name: '一句话定位', exact: true }).inputValue(), '尚未保存的资料');
        await page.getByRole('button', { name: '项目列表', exact: true }).click();
        await page.keyboard.press('Escape');
        await page.getByRole('button', { name: '返回子市场研究', exact: true }).click();
        await page.getByRole('button', { name: '关闭子市场介绍' }).click();
        assert.equal(confirmations, 5, 'every exit path guards unsaved edits exactly once');
        page.off('dialog', rejectExit);
        page.once('dialog', dialog => void dialog.accept());
        await page.getByRole('button', { name: '关闭子市场介绍' }).click();
      }
      await page.getByRole('button', { name: '未来供应', exact: true }).click();
      await page.getByRole('button', { name: /CBD未来楼/ }).click();
      await page.getByRole('region', { name: 'CBD未来楼楼宇详情' }).waitFor();
      await page.getByRole('tab', { name: '成交与资料' }).click();
      assert.equal(await page.getByRole('button', { name: '销控与佣金' }).getAttribute('data-building-id'), 'master-cbd');
      if (width === 390) {
        await page.getByRole('button', { name: '全屏阅读工作区' }).click();
        assert.equal(await page.locator('.map-workspace-layout').getAttribute('data-expanded'), 'true');
        await page.getByRole('button', { name: '返回地图分屏' }).click();
      }
      await page.getByRole('button', { name: '关闭楼宇详情' }).click();
      const search = page.getByRole('searchbox', { name: '搜索楼宇、子市场、业主或物业' });
      await search.fill('CBD');
      await search.evaluate(el => { el.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true })); el.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true, data: '甲' })); });
      await search.press('End');
      assert.equal(await search.evaluate(el => el === document.activeElement), true);
      await page.getByRole('region', { name: '项目搜索候选' }).waitFor();
      await page.getByRole('region', { name: '项目搜索候选' }).getByRole('button', { name: /^CBD甲楼/ }).click();
      await page.getByRole('region', { name: 'CBD甲楼楼宇详情' }).waitFor();
      await page.getByRole('button', { name: '返回搜索结果', exact: true }).click();
      await page.getByRole('region', { name: '项目搜索候选' }).waitFor();
      assert.equal(await search.inputValue(), 'CBD');
      await search.fill('');
      assert.equal(await page.locator('.map-workspace-right').getAttribute('aria-hidden'), 'true', 'clearing restored search must not leave an empty workspace');
      await search.fill('CBD');
      await page.getByRole('button', { name: '收起', exact: true }).click();
      assert.equal(await page.locator('.map-workspace-right').getAttribute('aria-hidden'), 'true');
      if (width === 1536) {
        await page.evaluate(() => window.dispatchEvent(new CustomEvent('map-submarket-open', { detail: { name: 'CBD' } })));
        await page.getByRole('button', { name: '保留该区域筛选', exact: true }).click();
        await page.evaluate(() => window.dispatchEvent(new CustomEvent('map-submarket-open', { detail: { name: '中关村' } })));
        await page.getByRole('region', { name: '中关村', exact: true }).waitFor();
        await page.getByRole('button', { name: '保留该区域筛选', exact: true }).waitFor();
        await page.getByRole('button', { name: '关闭子市场介绍' }).click();
        await page.getByRole('button', { name: '项目列表', exact: true }).click();
        await list.getByRole('button', { name: /^CBD甲楼/ }).waitFor();
        assert.equal(await list.getByRole('button', { name: /^中关村楼/ }).count(), 0, 'a later temporary area restores the explicitly retained CBD filter');
      }
      if (width === 390 || width === 1536) {
        await page.setViewportSize({ width: width === 1536 ? 768 : width, height: 420 });
        await page.waitForTimeout(350);
        const search = page.getByRole('searchbox', { name: '搜索楼宇、子市场、业主或物业' });
        await search.fill('不存在的项目');
        const choices = page.getByRole('region', { name: '项目搜索候选' });
        await choices.getByRole('button', { name: '清空关键词', exact: true }).waitFor();
        await choices.getByRole('button', { name: '全屏阅读工作区' }).click();
        await choices.getByRole('button', { name: '清空关键词', exact: true }).click();
        assert.equal(await search.inputValue(), '');
        assert.ok(await search.evaluate(el => el === document.activeElement));
        await page.setViewportSize({ width, height });
        await page.waitForTimeout(350);
      }
      if (width === 320) {
        await search.fill('');
        if (!await list.isVisible()) await page.getByRole('button', { name: '项目列表', exact: true }).click();
        await list.getByRole('button', { name: /^中关村楼/ }).click();
        const longDetail = page.getByRole('region', { name: stock[2].name + '楼宇详情', exact: true });
        await longDetail.waitFor();
        await page.waitForTimeout(300);
        assert.ok((await longDetail.locator('.workspace-scroll').boundingBox()).height >= 80, 'a long title cannot consume the detail reading area');
        assert.equal(await longDetail.getByRole('heading').innerText(), stock[2].name, 'the complete project name remains readable');
      }
      const sdk = await page.evaluate(() => window.__workspaceSDK);
      assert.equal(sdk.created, 1);
      assert.ok(sdk.resized > 0);
      assert.equal(sdk.nativeOpens, 0);
      assert.equal(stockReads, 1);
      assert.deepEqual(errors, []);
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'no document overflow');
      await page.screenshot({ path: `/tmp/map-workspace-${width}.png` });
      observations.push({ width, canvasWidth: canvas.width, mapInstances: sdk.created, stockReads, nativeOpens: sdk.nativeOpens, typography });
    } catch (error) {
      await page?.screenshot({ path: `/tmp/map-workspace-failure-${width}.png` }).catch(() => {});
      console.error('workspace failure state', width, await page?.evaluate(() => ({
        right: document.querySelector('.map-workspace-right')?.textContent?.slice(0, 1500),
        hidden: document.querySelector('.map-workspace-right')?.getAttribute('aria-hidden'),
        left: document.querySelector('.map-workspace-left')?.getAttribute('data-open'),
        sdk: window.__workspaceSDK,
      })));
      throw error;
    } finally { await context.close(); }
  }
  console.log(JSON.stringify({ status: 'pass', environment: 'production app, isolated SDK and authorized data fixtures', observations }));
} finally { await browser.close(); }
