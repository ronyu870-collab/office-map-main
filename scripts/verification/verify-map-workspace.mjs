import { verifySubmarketDesign } from './workspace-submarket-design.mjs';
import { verifySupplyLoading } from './workspace-supply-loading.mjs';
import { verifyShortViewport } from './workspace-short-viewport.mjs';
import { verifyRouteFocus } from './workspace-route-focus.mjs';
import { verifyAsyncReading } from './workspace-async-reading.mjs';
import { verifyControlSemantics } from './workspace-control-semantics.mjs';
import { verifyPerformanceListeners } from './workspace-performance-listeners.mjs';
import { verifyBaseMapPlaces } from './workspace-base-places.mjs';
import { verifyRegionCamera } from './workspace-region-camera.mjs';
import { verifySurfaceContinuity } from './workspace-surface-continuity.mjs';
import { verifyRelatedReading } from './workspace-related-reading.mjs';
import { verifyContactReading } from './workspace-contact-reading.mjs';
import { verifyMaterialReading } from './workspace-material-reading.mjs';
import { verifyProjectTrendReturn } from './workspace-project-trend-return.mjs';
import { verifyBubbleScope } from './workspace-bubble-scope.mjs';
import { verifyLeedFilters } from './workspace-leed-filters.mjs';
import { verifyListReading } from './workspace-list-reading.mjs';
import { verifyProjectTrendReading } from './workspace-project-trend.mjs';
import { verifySubmarketReading } from './workspace-submarket-reading.mjs';
import { verifyProfileDraftNavigation } from './workspace-profile-draft-navigation.mjs';
import { verifyMetricsDraftNavigation } from './workspace-metrics-draft-navigation.mjs';
import { verifyDragReading } from './workspace-drag-reading.mjs';
import { verifyTrendLoadingLayout } from './workspace-trend-loading-layout.mjs';
import { verifyTrendRecovery } from './workspace-trend-recovery.mjs';
import { verifyContentHeight } from './workspace-content-height.mjs';
import { verifySupplyMarkers } from './workspace-supply-markers.mjs';
import { verifyFutureConditions } from './workspace-future-filters.mjs';
import { verifyWorkspaceFilters } from './workspace-filters.mjs';
import { verifyTransitFilters, transitMapData } from './workspace-transit-filters.mjs';
import { clickWorkspaceAction } from './workspace-actions.mjs';
import { verifyFullListReading } from './workspace-full-list-reading.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
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
  { id: '10000000-1111-4111-8111-111111111111', name: 'CBD甲楼', submarket: 'CBD', location_lng: 116.46, location_lat: 39.91 },
  { id: 'cbd-b', name: 'CBD乙楼 · International Financial Centre and Metropolitan Business Headquarters Tower B', submarket: 'CBD', location_lng: 116.48, location_lat: 39.92 },
  { id: 'other', name: '中关村楼·' + '超长项目名称及楼座信息'.repeat(6), submarket: '中关村', location_lng: 116.32, location_lat: 39.98 },
  { id: 'missing', name: '未定位楼', submarket: 'CBD', location_lng: null, location_lat: null },
  { id: 'invalid', name: '坐标越界楼', submarket: 'CBD', location_lng: 40, location_lat: 116 },
].map(building => ({ ...building, grade: 'A', district: '朝阳区', building_metrics: [{ id: `m-${building.id}`, building_id: building.id, is_locked: true, is_draft: false, record_year: 2026, record_quarter: 3, total_area: 9019486, net_effective_rent: 146.1, vacancy_rate: .211 }] }));
// Unknown financial fields and an older period exercise reading/export semantics.
Object.assign(stock[1].building_metrics[0], { total_area: null, net_effective_rent: null, face_rent: null,
  management_fee: null, record_year: 2025, record_quarter: 4 });
stock[0].owner = '北京国际商务中心资产管理与城市更新投资集团有限公司';
stock[0].property_management = 'InternationalCommercialPropertyManagementAndBuildingServicesCompanyLimited';
stock[0].photos = [
  {id:'20000000-1111-4111-8111-111111111111',caption:'横向外观'},
  {id:'20000000-2222-4222-8222-222222222222',caption:'竖向大堂'},
];
const future = [{ id: 'future-cbd', building_id: 'master-cbd', name: 'CBD未来楼', grade:'A', type: '办公', district: '朝阳区', submarket: 'CBD', launch_year: 2027, launch_quarter: 'Q2', total_area: 80000, location_lng: 116.47, location_lat: 39.92 }, { id: 'future-pending', name: '待核实未来楼', status: 'pending', district:'朝阳区', type: '办公', submarket: 'CBD', total_area: 50000, location_lng: 116.465, location_lat: 39.915 }];
function instrumentMap() {
  const BaseMap = window.AMap.Map;
  const stats = window.__workspaceSDK = { created: 0, resized: 0, centers: [], nativeOpens: 0 };
  window.AMap.Bounds = class { constructor(southwest, northeast) { this.southwest = southwest; this.northeast = northeast; } };
  window.AMap.Polyline = class { constructor(options) { this.options = options; } };
  window.AMap.Circle = class { constructor(options) { this.options = options; } };
  window.AMap.Map = class extends BaseMap {
    constructor(id, options) { super(id, options); stats.created++; window.__workspaceMap = this; this.host = document.getElementById(id); }
    getContainer() { return this.host; }
    setZoomAndCenter(zoom,center) { super.setZoomAndCenter(zoom,center); this.emit('zoomend'); }
    setCenter(center) { this.center = Array.isArray(center) ? center : [center.getLng?.() ?? center.lng, center.getLat?.() ?? center.lat]; stats.centers.push(this.center); }
    setBounds(bounds) { this.center = bounds.southwest.map((value, index) => (value + bounds.northeast[index]) / 2); }
    resize() { stats.resized++; }
    panBy() {}
  };
  const Popup = window.AMap.InfoWindow;
  window.AMap.InfoWindow = class extends Popup { open(...args) { stats.nativeOpens++; super.open(...args); } };
}
const observations = [];
const widths = process.env.MAP_WORKSPACE_WIDTHS ? process.env.MAP_WORKSPACE_WIDTHS.split(',').map(Number) : [1536,1280,1024,900,820,768,844,390,320];
assert.ok(widths.length && widths.every(width=>[1536,1280,1024,900,820,768,844,390,320].includes(width)));
try {
  for (const width of widths) {
    const height = width === 844 ? 390 : width === 1280 ? 720 : width === 768 ? 640 : width < 640 ? 844 : 1000;
    const context = await browser.newContext({ viewport: { width, height }, isMobile: width < 640 || width === 844, hasTouch: width < 640 || width === 844, serviceWorkers: 'block' });
    const errors = [];
    let stockReads = 0, failSDK = false, photoReads = 0;
    let dataRows = stock, futureRows = future, dataGate = null, releaseData = () => {};
    const auditEvents = new Map();
    let auditFailures = 0;
    let page;
    try {
      await context.routeWebSocket(/.*/, socket => socket.close());
      await context.route('**/*', async route => {
        const url = new URL(route.request().url());
        if (url.origin === base.origin) {
          if (url.pathname === '/data/beijing_map_data.json') return route.fulfill({ json: transitMapData });
          if (url.pathname === '/api/intelligence/query/capabilities') return route.fulfill({json:{enabled:width===1024,examples:[]}});
          if (url.pathname === '/api/map/building-photos') {
            assert.equal(url.searchParams.get('building_id'),stock[0].id, 'photo lookup must use its owning fixture building');
            assert.ok(stock[0].photos.some(photo => photo.id === url.searchParams.get('photo_id')), 'photo ID must belong to the requested building');
            if(width===1024 && !photoReads++) return route.fulfill({status:403,json:{error:'isolated permission denial'}});
            return route.fulfill({json:{url:`https://synthetic.invalid/${url.searchParams.get('photo_id')}.svg`,is_preview:false,can_download:true,source_url:'',source_name:''}});
          }
          if (url.pathname === '/api/audit-events/critical') return route.fulfill({ json: { authorized: true } });
          if (url.pathname === '/api/audit-events') {
            if (!auditFailures++) return route.fulfill({status:503,json:{error:'isolated audit outage'}});
            const { events } = route.request().postDataJSON();
            for (const event of events) auditEvents.set(event.event_id, event);
            return route.fulfill({ json: { accepted_event_ids: events.map(event => event.event_id), discarded_event_ids: [] } });
          }
          if (url.pathname === '/api/map/sales-materials') {
            const material = { id:'material-a',title:'测试项目资料',source:'测试业主',notes:'',original_name:'owner.png',mime_type:'image/png',file_size:1,document_date:null,created_at:'2026-11-21T00:00:00Z',content_types:['availability','brochure'] };
            return route.fulfill({ json: url.searchParams.has('material_id') ? { details:[],project_facts:[],preview_url:'https://synthetic.invalid/original.png?signature=private',download_url:'https://synthetic.invalid/download',provenance:{document_date_evidence:'',received:null,version_recorded_at:material.created_at,source_sha256:'a'.repeat(64)} } : { records:[material],count:1 } });
          }
          if (url.pathname === '/api/map/data') {
            assert.equal(route.request().headers().authorization, `Bearer ${token}`);
            if (url.searchParams.get('mode') === 'trend') return route.fulfill({ json: { metrics: [
              [2026,3,200,.12],[2025,4,160,.1],[2025,3,999,.99],
              [2024,4,null,null],[2023,4,0,0],[2022,4,null,null],[2021,4,180,.11],
            ].map(([record_year,record_quarter,net_effective_rent,vacancy_rate])=>({record_year,record_quarter,net_effective_rent,vacancy_rate})) } });
            if (url.searchParams.get('mode') === 'future') return route.fulfill({ json: { future_supplies: futureRows } });
            stockReads++;
            if (dataGate) await dataGate;
            return route.fulfill({ json: { buildings: dataRows, display_overrides: [] } });
          }
          if (url.pathname === '/api/map/submarket') return route.fulfill({ json: {
            submarket: 'CBD', stockCount: 3, profileAvailable: true, profilePublished: true,
            profile: { submarket: 'CBD', headline: '国际商务集聚区', overview: '测试区域介绍', industries: '', transport: '', demographics: [], policies: [], insights: [], updatedAt: '2026-11-18T00:00:00Z', updatedBy: null },
            trends: { all: [], a: [], b: [] }, trendError: false, quarterMethod: 'same quarter', source: 'building_metrics',
          } });
          if (url.pathname.startsWith('/api/')) return route.fulfill({ status: 204 });
          return route.continue();
        }
        if (url.origin === 'https://synthetic.invalid') {
          if(url.pathname.endsWith('.svg')) {const portrait=url.pathname.includes('2222');return route.fulfill({contentType:'image/svg+xml',body:`<svg xmlns="http://www.w3.org/2000/svg" width="${portrait?600:1200}" height="${portrait?1000:600}"><rect width="100%" height="100%" fill="#c5d4dd"/></svg>`});}
          return route.fulfill({contentType:'image/png',body:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII=','base64')});
        }
        if (url.origin === 'https://example.supabase.co') {
          const headers = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'GET, OPTIONS' };
          if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers });
          return route.fulfill({ headers, json: url.pathname === '/rest/v1/user_roles' ? [{ role: width === 1024 ? 'admin' : 'viewer', session_id: user.id }] : [] });
        }
        if (url.origin === 'https://webapi.amap.com' && url.pathname === '/maps' && failSDK) return route.abort();
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
      await page.locator('#map-container [data-building-id="10000000-1111-4111-8111-111111111111"]').first().waitFor();
      assert.equal(await page.locator('.map-workspace-right').getAttribute('aria-hidden'), 'true');
      const liveStats = page.getByRole('region', { name: '市场实时指标', exact: true });
      await liveStats.getByText('有坐标项目', { exact: true }).waitFor();
      assert.equal(await liveStats.locator('summary').count(), 0, 'metric values are directly readable');
      const methodsTrigger = page.locator('.map-context-disclosure > summary');
      await methodsTrigger.press('Enter');
      const methodsPanel = page.getByRole('region', { name: '数据与统计口径', exact: true });
      await methodsPanel.getByText('已知存量面积 36,077,944 ㎡', { exact: true }).waitFor();
      const methodsBounds = await methodsPanel.boundingBox();
      assert.ok(methodsBounds.x >= 0 && methodsBounds.x + methodsBounds.width <= width &&
        methodsBounds.y >= 0 && methodsBounds.y + methodsBounds.height <= height, 'statistical details fit the viewport');
      assert.ok(await methodsPanel.evaluate(el => el === document.activeElement), 'keyboard opens the portal at its content');
      await page.keyboard.press('Escape');
      await page.locator('.map-disclosure-content').waitFor({ state: 'detached' });
      assert.ok(await methodsTrigger.evaluate(el => el === document.activeElement), 'statistical details return keyboard focus');
      const metricBounds = await liveStats.boundingBox();
      assert.ok(metricBounds.x >= 0 && metricBounds.x + metricBounds.width <= width, 'metrics fit the viewport');
      if (width > 1100) assert.ok(metricBounds.width <= 520, `content-sized metrics width ${metricBounds.width}`);
      const modeGroup = await page.locator('.map-toolbar-mode-group').boundingBox();
      const toolbarActions = await page.locator('.map-toolbar-actions').boundingBox();
      assert.ok(modeGroup.x + modeGroup.width + 6 <= toolbarActions.x, 'mode/legend and project actions remain separate without overlapping');
      assert.ok((await page.locator('.map-toolbar-search').boundingBox()).width >= 200, 'project search retains useful reading width');
      for (const name of ['未来供应','项目列表']) {
        const action=page.getByRole('button',{name,exact:true});
        assert.ok((await action.innerText()).trim().length>0,'supply and list have visible action labels');
        if(width<640||width===844){const box=await action.boundingBox();assert.ok(box.height>=44 && box.width>=44,'mobile project actions retain touch targets');}
      }
      if(width<640||width===844)for(const mode of await page.locator('.map-workspace-modes button:visible').all()){
        const box=await mode.boundingBox();assert.ok(box.width>=44 && box.height>=44,'mobile mode options retain touch targets');
      }
      const statsBeforeMove = await liveStats.locator('dl').innerText();
      await page.evaluate(() => { window.__workspaceMap.emit('moveend'); });
      assert.equal(await liveStats.locator('dl').innerText(), statsBeforeMove);
      const legend = page.locator('.map-workspace-legend > summary');
      await legend.focus();
      await legend.press('Enter');
      const menu = page.locator('.map-disclosure-content');
      await menu.waitFor();
      const popup = await menu.boundingBox();
      assert.ok(popup.x >= 0 && popup.x + popup.width <= width && popup.y >= 0 && popup.y + popup.height <= height, 'legend fits the visible viewport');
      await page.keyboard.press('Escape');
      await menu.waitFor({ state: 'detached' });
      assert.ok(await legend.evaluate(el => el === document.activeElement), 'disclosure returns focus');
      await page.getByRole('button', { name: '筛选', exact: true }).click();
      await page.waitForFunction(()=>document.querySelectorAll('.map-live-stats .map-metric-number')[2]?.textContent==='5');
      await page.locator('.map-workspace-filter').getByText('项目类型',{exact:true}).click();
      const futureLayer = page.getByRole('checkbox',{name:'显示未来新增供应',exact:true});
      await futureLayer.uncheck();
      await page.waitForFunction(()=>document.querySelectorAll('.map-live-stats .map-metric-number')[2]?.textContent==='3');
      await futureLayer.check();
      await page.waitForFunction(()=>document.querySelectorAll('.map-live-stats .map-metric-number')[2]?.textContent==='5');
      await page.locator('.map-workspace-filter').getByText('项目类型',{exact:true}).click();
      observations.push({width,validDisplayedProjects:5,stockOnlyProjects:3,invalidOrMissingStockReadable:2,futureLayerCountFollowsVisibility:true});
      if ([1536,390,320].includes(width)) {
        observations.push(await verifyWorkspaceFilters(page, { width, height, stock }));
        observations.push(await verifyTransitFilters(page, { width, height, stock }));
        observations.push(await verifyFutureConditions(page, {width,stock,future}));
      }
      await page.getByRole('button', { name: '项目列表', exact: true }).click();
      const list = page.getByRole('region', { name: '项目列表', exact: true });
      await list.waitFor();
      await page.waitForTimeout(300);
      const canvas = await page.locator('#map-container').boundingBox();
      if (width < 1000) assert.ok(canvas.height >= 140, `compact canvas height ${canvas.height}`);
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
        assert.equal(await page.locator('.map-workspace-right').evaluate(el => el.getAnimations().some(animation => animation.playState === 'running' || animation.pending)), false, 'dragging follows the pointer without a competing pane transition');
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
        if (width === 1536) {
          await list.getByRole('checkbox', { name: '选择' + stock[1].name, exact: true }).check();
          await list.getByRole('checkbox', { name: '选择' + stock[2].name, exact: true }).check();
        }
        const exportTrigger = list.getByRole('button', { name: '导出对比图 PNG', exact: true });
        await exportTrigger.click();
        const dialog = page.getByRole('dialog', { name: '导出楼宇参数对比', exact: true });
        await dialog.waitFor();
        const rect = await dialog.boundingBox();
        assert.ok(rect.x >= 0 && rect.y >= 0 && rect.x + rect.width <= width && rect.y + rect.height <= height, 'export modal fits the viewport');
        if (width === 1536) assert.ok(rect.width > rightBox.width, 'export modal escapes narrow sidebar containment');
        if (width === 1536) {
          const downloading = page.waitForEvent('download');
          await dialog.getByRole('button', { name: '下载 PNG', exact: true }).click();
          const download = await downloading;
          const destination = '/tmp/map-comparison-1536.png';
          await download.saveAs(destination);
          const bytes = fs.readFileSync(destination);
          assert.equal(bytes.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
          assert.ok(bytes.readUInt32BE(16) >= 1000 && bytes.readUInt32BE(20) >= 100, 'comparison downloads an actual readable PNG');
          await dialog.waitFor({ state: 'detached' });
          await exportTrigger.click(); await dialog.waitFor();
        }
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
        await clickWorkspaceAction(page, '展开到阅读高度');
        await page.waitForTimeout(200);
        const readingHeight = (await page.locator('.map-workspace-right').boundingBox()).height;
        await clickWorkspaceAction(page, '全屏阅读工作区');
        await page.keyboard.press('Escape');
        await page.waitForTimeout(200);
        assert.ok(Math.abs((await page.locator('.map-workspace-right').boundingBox()).height - readingHeight) <= 1, 'fullscreen Escape restores prior reading height');
      }
      await list.getByRole('combobox', { name: '项目列表排序' }).selectOption('name');
      await list.getByRole('button', { name: /^CBD甲楼/ }).click();
      await page.getByRole('region', { name: 'CBD甲楼楼宇详情' }).waitFor();
      await page.waitForTimeout(350);
      if (width === 1536) assert.equal(Math.round((await page.locator('.map-workspace-right').boundingBox()).width), 376, 'building has a distinct default width');
      assert.match(await page.getByRole('region', { name: 'CBD甲楼楼宇详情' }).locator('.workspace-rent-metric dd').innerText(), /146\.1\s*元\/㎡\/月/);
      await page.screenshot({ path: `/tmp/map-layout-building-${width}.png` });
      if ([1536, 390, 320].includes(width)) {
        const facts = page.getByRole('region', { name: 'CBD甲楼楼宇详情' }).locator('.workspace-building-facts');
        if (width < 900) await clickWorkspaceAction(page, '展开到阅读高度');
        await facts.last().scrollIntoViewIfNeeded();
        assert.ok(await facts.evaluateAll(groups => groups.every(group => group.scrollWidth <= group.clientWidth + 1)), 'long owner and unbroken English company remain within the value column');
        await page.screenshot({ path: `/tmp/map-reading-long-facts-${width}.png` });
        await page.getByRole('region', { name: 'CBD甲楼楼宇详情' }).locator('.workspace-scroll').evaluate(el => { el.scrollTop = 0; });
        if (width < 900) await clickWorkspaceAction(page, '收起为摘要');
      }
      if (width === 1536) {
        await page.getByRole('button', { name: 'LEED', exact: true }).click();
        await page.waitForFunction(() => decodeURIComponent(document.querySelector('.map-selected-marker__badge')?.getAttribute('src') ?? '').includes('>–</text>'));
        await page.locator('.map-workspace-legend > summary').click();
        await page.getByText('未提供（–）', { exact: true }).waitFor();
        await page.getByText('未认证（N）', { exact: true }).waitFor();
        await page.screenshot({ path: '/tmp/map-leed-missing-1536.png' });
        await page.locator('.map-workspace-legend > summary').click();
        await page.getByRole('button', { name: '项目', exact: true }).click();
      }
      if(width===1024) {
        const detail=page.getByRole('region',{name:'CBD甲楼楼宇详情'});
        const photo=detail.getByRole('button',{name:/看图 · 2张/});
        await photo.click();await detail.getByText('当前身份无权查看此图片',{exact:true}).waitFor();
        await detail.getByRole('button',{name:'重试',exact:true}).click();
        await detail.locator('[data-building-photo]:visible').waitFor();
        await clickWorkspaceAction(page, '全屏阅读工作区');
        await clickWorkspaceAction(page, '返回地图分屏');
        await photo.click();assert.equal(await photo.getAttribute('aria-expanded'),'false');
        await photo.click();assert.equal(await photo.getAttribute('aria-expanded'),'true');
        await detail.getByRole('button',{name:'查看大图',exact:true}).click();
        await detail.getByRole('dialog').waitFor();
        await page.keyboard.press('ArrowRight');
        await detail.locator('[data-building-photo]:visible').waitFor();
        assert.match(await detail.locator('[data-building-photo-caption]').innerText(),/竖向大堂/);
        await page.keyboard.press('Escape');
        assert.ok(await detail.getByRole('button',{name:'查看大图',exact:true}).evaluate(el=>el===document.activeElement));
        await page.screenshot({path:'/tmp/map-layout-photo-1024.png'});

      }
      assert.equal(await page.locator('.workspace-building').count(), 1);
      assert.equal(await page.locator('.map-selected-marker').count(), 1);
      const highlight = await page.locator('.map-selected-marker').evaluate(el => {
        const style = getComputedStyle(el), box = el.getBoundingClientRect();
        return { width: box.width, height: box.height, background: style.backgroundColor,
          animation: style.animationName, decorations: el.querySelectorAll('span').length, badge: Boolean(el.querySelector('img')?.naturalWidth), pointerEvents: style.pointerEvents };
      });
      assert.ok(highlight.width <= 40 && highlight.height <= 40, 'selection stays compact');
      assert.equal(highlight.background, 'rgba(0, 0, 0, 0)', 'data badge remains visible');
      assert.equal(highlight.decorations, 0, 'no inner rings may cover badge text');
      assert.equal(highlight.badge, true, 'selection owns a visible data badge independent of layer collision');
      assert.equal(highlight.animation, 'none', 'selection does not pulse or reset to a halo');
      assert.equal(highlight.pointerEvents, 'none', 'selection decoration does not capture marker input');
      await page.evaluate(() => { window.__workspaceMap.emit('click'); window.__workspaceMap.emit('zoomend'); window.__workspaceMap.emit('moveend'); });
      assert.equal(await page.getByRole('region', { name: 'CBD甲楼楼宇详情' }).count(), 1);
      // Repeat the same opening through the actual map marker after the list entry.
      await page.locator('#map-container [data-building-id="10000000-1111-4111-8111-111111111111"]').first().evaluate(el => el.click());
      await page.getByRole('tab', { name: '行情', exact: true }).click();
      await page.getByRole('button', { name: '季度趋势', exact: true }).click();
      await page.locator('#info-chart-container canvas').waitFor();
      await page.locator('#chart-btn-vac').click();
      assert.equal(await page.locator('#chart-btn-vac').getAttribute('aria-pressed'),'true');
      await page.locator('#chart-btn-vac').click();
      await page.locator('#chart-btn-rent').click();
      assert.equal(await page.locator('#chart-btn-rent').getAttribute('aria-pressed'),'true');
      observations.push(await verifyProjectTrendReading(page,width));
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
      if ([1536,390,320].includes(width)) {
        if (width < 640) await clickWorkspaceAction(page,'展开到阅读高度');
        await page.waitForTimeout(250);
        await page.screenshot({path:`/tmp/map-material-groups-${width}.png`});
        if (width < 640) await clickWorkspaceAction(page,'收起为摘要');
      }
      await page.getByRole('button', { name: '联系方式', exact: true }).click();
      await page.getByRole('dialog', { name: 'CBD甲楼', exact: true }).waitFor();
      await page.keyboard.press('Escape');
      assert.equal(await page.getByRole('region', { name: 'CBD甲楼楼宇详情' }).count(), 1, 'Escape in a business modal must not close its workspace');
      await page.getByRole('dialog', { name: 'CBD甲楼', exact: true }).waitFor({state:'detached'});
      assert.equal(await page.getByRole('button',{name:'联系方式',exact:true}).evaluate(node=>node===document.activeElement),true,'closing contacts restores its visible trigger');
      await page.getByRole('button', { name: '楼书与资料', exact: true }).click();
      const materials = page.getByRole('dialog');
      await materials.getByRole('button', { name: '查看原件', exact: true }).click();
      await materials.getByAltText('测试项目资料', { exact: true }).waitFor();
      await materials.getByRole('button', { name: '返回项目资料', exact: true }).click();
      await materials.getByRole('button', { name: '关闭销控', exact: true }).click();
      await page.waitForFunction(() => !document.querySelector('[data-sales-materials]'));
      // The existing queue sends a batch later; no synchronous log request is awaited by any UI action.
      await page.waitForTimeout(3500);
      const reading = [...auditEvents.values()];
      const eventsOf = action => reading.filter(event => event.action_type === action);
      assert.equal(eventsOf('VIEW_BUILDING').filter(event => event.target_id === '10000000-1111-4111-8111-111111111111').length, 1, 'list and direct marker share one deduplicated observation');
      assert.equal(eventsOf('VIEW_BUILDING_CONTACT').length, 1);
      assert.deepEqual(eventsOf('VIEW_BUILDING_TREND').map(event => event.details.metric).sort(), ['rent','vac']);
      assert.equal(eventsOf('VIEW_BUILDING_MATERIALS').length, 1, 'return from original is deduplicated');
      assert.equal(eventsOf('VIEW_MATERIAL_ORIGINAL').length, 1);
      assert.equal(eventsOf('VIEW_MATERIAL_ORIGINAL')[0].target_id, 'material-a');
      assert.ok(reading.every(event => event.origin_user_id === user.id && event.request_source === 'frontend'));
      assert.ok(!JSON.stringify(reading).includes('signature=private'));
      assert.ok(reading.filter(event => event.action_type.startsWith('VIEW_')).every(event => !('contact_phone' in event.details)));

      await page.getByRole('button', { name: '返回项目列表', exact: true }).click();
      assert.equal(await list.getByRole('combobox', { name: '项目列表排序' }).inputValue(), 'name');
      if (width === 1536) {
        await page.waitForTimeout(300);
        assert.equal(Math.round((await page.locator('.map-workspace-right').boundingBox()).width), 380, 'return restores list width without using the building width');
      }
      if (width === 1536) {
        await list.getByRole('button', { name: /^坐标越界楼/ }).click();
        const invalid = page.getByRole('region', { name: '坐标越界楼楼宇详情' });
        await invalid.getByText('此项目坐标超出地图范围，暂不能定位；可继续查看资料。', { exact: true }).waitFor();
        assert.equal(await invalid.getByRole('button', { name: '定位当前项目' }).count(), 0);
        assert.equal(await page.locator('.map-selected-marker').count(), 0, 'invalid record cannot inherit a previous selection');
        await page.screenshot({ path: '/tmp/map-coordinate-invalid-1536.png' });
        await invalid.getByRole('tab', { name: '成交与资料', exact: true }).click();
        assert.equal(await invalid.getByRole('button', { name: '楼书与资料', exact: true }).getAttribute('data-building-id'), 'invalid');
        await page.getByRole('button', { name: '返回项目列表', exact: true }).click();
      }
      await list.getByRole('button', { name: /^未定位楼/ }).click();
      await page.getByRole('region', { name: '未定位楼楼宇详情' }).waitFor();
      await page.getByRole('region', { name: '未定位楼楼宇详情' }).getByText('此项目未提供有效坐标，可继续查看资料。', { exact: true }).waitFor();
      assert.equal(await page.locator('.map-selected-marker').count(), 0);
      await page.getByRole('button', { name: '关闭楼宇详情' }).click();
      // Trigger the exact event emitted by SDK area bubbles; the production reducer,
      // filters, controller renderers and sidebar synchronization all remain real.
      await page.evaluate(() => window.dispatchEvent(new CustomEvent('map-submarket-open', { detail: { name: 'CBD' } })));
      await page.getByRole('region', { name: 'CBD', exact: true }).waitFor();
      let resizedResearchWidth;
      if (width === 1536) {
        const separator = page.getByRole('separator', { name: '调整业务工作区宽度' });
        const initialResearchWidth = Number(await separator.getAttribute('aria-valuenow'));
        assert.ok(initialResearchWidth > 520, 'research gets the wider adaptive desktop split by default');
        resizedResearchWidth = Number(await separator.getAttribute('aria-valuemax'));
        assert.ok(resizedResearchWidth > initialResearchWidth, 'research can be widened beyond its default');
        await separator.press('End');
        await page.locator(`.map-workspace-right[data-open] [aria-valuenow="${resizedResearchWidth}"]`).waitFor();
        const split = await page.locator('.map-workspace-layout').evaluate(el => {
          const right = el.querySelector('.map-workspace-right[data-open]');
          const left = el.querySelector('.map-workspace-left[data-open]');
          return { width: el.clientWidth, right: right.offsetWidth, exposedMap: right.offsetLeft - (left ? left.offsetLeft + left.offsetWidth : 0) };
        });
        assert.equal(split.right, resizedResearchWidth);
        assert.ok(split.exposedMap >= split.width * .5 - 1, 'wide research preserves half the stage as uncovered map');
      }
      if (width === 320 || width === 390) assert.ok((await page.getByRole('region', { name: 'CBD', exact: true }).locator('.workspace-scroll').boundingBox()).height >= 80, 'compact research retains a usable reading area');
      await page.screenshot({ path: `/tmp/map-layout-research-${width}.png` });
      await page.getByRole('button', { name: '查看全部项目', exact: true }).click();
      await list.waitFor();
      await page.waitForTimeout(400);
      await page.locator('#map-container [data-building-id="10000000-1111-4111-8111-111111111111"]').first().waitFor({ state: 'attached' });
      assert.equal(await page.locator('#map-container [data-building-id="other"]').count(), 0);
      assert.equal(await list.getByRole('button', { name: /^中关村楼/ }).count(), 0);
      await list.getByRole('button', { name: /^CBD乙楼/ }).click();
      await page.getByRole('region', { name: stock[1].name + '楼宇详情' }).waitFor();
      if ([1536,390,320].includes(width)) {
        const english = page.getByRole('region', { name: stock[1].name + '楼宇详情' });
        await english.getByTitle('展开完整名称', { exact: true }).click();
        await page.waitForTimeout(300);
        assert.ok((await english.locator('.workspace-scroll').boundingBox()).height >= 80, 'expanded English titles keep a usable detail reading area');
        await page.screenshot({ path: `/tmp/map-reading-long-english-${width}.png` });
        assert.equal(await english.getByRole('heading').innerText(), stock[1].name);
        await english.getByTitle('收起完整名称', { exact: true }).click();
      }
      if (width === 1536) {
        const unknown = page.getByRole('region', { name: stock[1].name + '楼宇详情' });
        assert.match(await unknown.locator('.workspace-rent-metric dd').innerText(), /^—/);
        await unknown.getByRole('tab', { name: '行情', exact: true }).click();
        assert.ok((await unknown.locator('.workspace-market-facts dd').allInnerTexts()).every(value => value.trim().startsWith('—')), 'missing fees cannot read as a real zero');
      }
      await page.getByRole('button', { name: '返回项目列表', exact: true }).click();
      await page.getByRole('button', { name: '返回子市场研究', exact: true }).click();
      if (width === 1536) {
        await page.getByRole('region', { name: 'CBD', exact: true }).waitFor();
        assert.equal(await page.locator('.map-workspace-right[data-open]').evaluate(el => el.offsetWidth), resizedResearchWidth, 'return restores the chosen research width');
      }
      await page.getByRole('button', { name: '关闭子市场介绍' }).click();
      assert.equal(await page.getByRole('button', { name: '保留该区域筛选', exact: true }).count(), 0, 'region is retained by default');
      await page.getByRole('button', { name: '项目列表', exact: true }).click();
      await list.getByRole('button', { name: /^CBD甲楼/ }).waitFor();
      assert.equal(await list.getByRole('button', { name: /^中关村楼/ }).count(), 0, 'close retains CBD results');
      await page.evaluate(() => window.dispatchEvent(new CustomEvent('map-submarket-open', { detail: { name: 'CBD' } })));
      await page.getByRole('region', { name: 'CBD', exact: true }).waitFor();
      await page.getByRole('button', { name: '未来供应', exact: true }).click();
      await page.getByRole('button', { name: '未来供应', exact: true }).click();
      assert.equal(await page.locator('.map-workspace-right').getAttribute('aria-hidden'), 'true');
      await page.getByRole('button', { name: '项目列表', exact: true }).click();
      await list.getByRole('button', { name: /^CBD甲楼/ }).waitFor();
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
      const futureBadge = page.locator('.map-selected-marker__badge');
      await futureBadge.waitFor();
      await page.waitForFunction(() => document.querySelector('.map-selected-marker__badge')?.naturalWidth > 0);
      assert.ok(decodeURIComponent(await futureBadge.getAttribute('src')).includes('>F</text>'), 'selected future has a visible identity badge');
      assert.equal(await page.getByRole('tab',{name:'行情',exact:true}).count(),0);
      assert.equal(await page.getByRole('region',{name:'市场实时指标',exact:true}).getByText('净有效租金',{exact:true}).count(),1,'only the global market metric remains, not a future project rent');
      assert.match(await page.getByRole('region',{name:'规划指标'}).locator('dd').innerText(),/^80,000\s*㎡$/);
      await page.getByRole('tab', { name: '概览',exact:true }).press('ArrowLeft');
      assert.equal(await page.getByRole('tab', { name: '项目资料' }).getAttribute('aria-selected'),'true');
      await page.getByRole('tab', { name: '项目资料' }).press('ArrowRight');
      assert.equal(await page.getByRole('tab', { name: '概览',exact:true }).getAttribute('aria-selected'),'true');
      await page.getByRole('tab', { name: '项目资料' }).click();
      assert.equal(await page.getByRole('button', { name: '销控与佣金' }).getAttribute('data-building-id'), 'master-cbd');
      assert.equal(await page.getByRole('button',{name:'编辑指标',exact:true}).count(),0);
      if ([1536,390,320].includes(width)) {
        if (width < 640) await clickWorkspaceAction(page,'展开到阅读高度');
        await page.waitForTimeout(250);
        await page.screenshot({path:`/tmp/map-future-materials-${width}.png`});
        if (width < 640) await clickWorkspaceAction(page,'收起为摘要');
      }
      if (width === 390) {
        await clickWorkspaceAction(page, '全屏阅读工作区');
        assert.equal(await page.locator('.map-workspace-layout').getAttribute('data-expanded'), 'true');
        await clickWorkspaceAction(page, '返回地图分屏');
      }
      await page.getByRole('button', { name: '关闭楼宇详情' }).click();
      await page.getByRole('button', { name: '未来供应', exact: true }).click();
      await page.getByText('待核实项目（1）',{exact:true}).click();
      await page.getByRole('button',{name:'待核实未来楼',exact:true}).click();
      await page.getByRole('region',{name:'待核实未来楼楼宇详情'}).waitFor();
      assert.equal(await page.getByRole('tab',{name:'行情',exact:true}).count(),0);
      await page.getByRole('tab',{name:'项目资料',exact:true}).click();
      await page.getByText('待核实项目暂无关联原件',{exact:true}).waitFor();
      assert.equal(await page.getByRole('button',{name:'销控与佣金',exact:true}).count(),0);
      if ([1536,390,320].includes(width)) {
        if (width < 640) await clickWorkspaceAction(page,'展开到阅读高度');
        await page.waitForTimeout(250);
        await page.screenshot({path:`/tmp/map-pending-materials-${width}.png`});
        if (width < 640) await clickWorkspaceAction(page,'收起为摘要');
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
        await search.fill('');
        await page.evaluate(() => window.dispatchEvent(new CustomEvent('map-submarket-open', { detail: { name: 'CBD' } })));
        assert.equal(await page.getByRole('button', { name: '保留该区域筛选', exact: true }).count(), 0);
        await page.evaluate(() => window.dispatchEvent(new CustomEvent('map-submarket-open', { detail: { name: '中关村' } })));
        await page.getByRole('region', { name: '中关村', exact: true }).waitFor();

        await page.getByRole('button', { name: '关闭子市场介绍' }).click();
        await page.getByRole('button', { name: '项目列表', exact: true }).click();
        await list.getByRole('button', { name: /^中关村楼/ }).waitFor();
        assert.equal(await list.getByRole('button', { name: /^CBD甲楼/ }).count(), 0, 'switching and closing keeps the latest region');
      }
      if (width === 390 || width === 1536) {
        await page.setViewportSize({ width: width === 1536 ? 768 : width, height: 420 });
        await page.waitForTimeout(350);
        const search = page.getByRole('searchbox', { name: '搜索楼宇、子市场、业主或物业' });
        await search.fill('不存在的项目');
        const choices = page.getByRole('region', { name: '项目搜索候选' });
        await choices.getByRole('button', { name: '清空关键词', exact: true }).waitFor();
        await clickWorkspaceAction(page, '全屏阅读工作区');
        await choices.getByRole('button', { name: '清空关键词', exact: true }).click();
        assert.equal(await search.inputValue(), '');
        assert.ok(await search.evaluate(el => el === document.activeElement));
        await liveStats.getByText('有坐标项目', { exact: true }).waitFor();
        await page.keyboard.press('Escape');
        await page.setViewportSize({ width, height });
        await page.waitForTimeout(350);
      }
      if (width === 320) {
        await search.fill('');
        await page.evaluate(() => window.dispatchEvent(new CustomEvent('map-submarket-open', { detail: { name: '中关村' } })));
        await page.getByRole('button', { name: '查看全部项目', exact: true }).click();
        if (!await list.isVisible()) await page.getByRole('button', { name: '项目列表', exact: true }).click();
        await list.getByRole('button', { name: /^中关村楼/ }).click();
        const longDetail = page.getByRole('region', { name: stock[2].name + '楼宇详情', exact: true });
        await longDetail.waitFor();
        await page.waitForTimeout(300);
        assert.ok((await longDetail.locator('.workspace-scroll').boundingBox()).height >= 80, 'a long title cannot consume the detail reading area');
        assert.equal(await longDetail.getByRole('heading').innerText(), stock[2].name, 'the complete project name remains readable');
        const nameToggle = longDetail.getByTitle('展开完整名称', { exact: true });
        assert.ok((await longDetail.getByRole('heading').boundingBox()).width >= 140, 'navigation controls leave enough room to identify the long project');
        assert.ok((await longDetail.locator('.workspace-panel-header').boundingBox()).height < 100, 'long name and reading controls must not monopolize the short sheet');
        await nameToggle.click();
        assert.equal(await longDetail.getByTitle('收起完整名称', { exact: true }).getAttribute('aria-expanded'), 'true');
        await longDetail.getByTitle('收起完整名称', { exact: true }).click();
        assert.equal(await nameToggle.getAttribute('aria-expanded'), 'false');
        await page.setViewportSize({ width, height: 560 }); await page.waitForTimeout(350);
        const identityReading=await page.locator('.map-workspace-layout[data-header-only]').count()>0;
        if(identityReading){
          assert.equal(await longDetail.locator('.workspace-building-metrics dd').first().isVisible(),false,'identity summary hides the clipped metric body');
          await nameToggle.click();
          const expandedHeader=await longDetail.locator('.workspace-panel-header').boundingBox(),identityPane=await longDetail.boundingBox();
          assert.ok(expandedHeader.y+expandedHeader.height<=identityPane.y+identityPane.height+1,'expanded long name preserves all identity-bar controls');
          await longDetail.getByTitle('收起完整名称',{exact:true}).click();
          await clickWorkspaceAction(page,'全屏阅读工作区');
          await longDetail.locator('.workspace-building-metrics dd').first().waitFor();
        }
        const valueBox = await longDetail.locator('.workspace-building-metrics dd').first().boundingBox();
        const readingBox = await longDetail.locator('.workspace-scroll').boundingBox();
        assert.ok(valueBox.y + valueBox.height <= readingBox.y + readingBox.height + 1, 'short-phone reading shows metric values below a long project title');
        const lastValueBox = await longDetail.locator('.workspace-building-metrics dd').last().boundingBox();
        assert.ok(lastValueBox.y + lastValueBox.height <= readingBox.y + readingBox.height + 1, 'the whole metric summary remains visible in short-phone reading');
        await page.screenshot({path:'/tmp/map-layout-short-phone-320.png'});
        if(identityReading)await clickWorkspaceAction(page,'返回地图分屏');
        await page.setViewportSize({ width, height }); await page.waitForTimeout(250);
      }
      await search.fill('');
      if (await page.locator('.map-workspace-right').getAttribute('data-open')) {
        await page.keyboard.press('Escape');
      }
      const listOpener = page.getByRole('button', { name: '项目列表', exact: true });
      await listOpener.focus(); await listOpener.press('Enter'); await list.waitFor();
      const listClose = list.getByRole('button', { name: '关闭列表', exact: true });
      await listClose.focus(); await listClose.press('Enter');
      assert.ok(await listOpener.evaluate(el => el === document.activeElement), 'keyboard closure returns to the panel opener');
      const sdk = await page.evaluate(() => window.__workspaceSDK);
      assert.equal(sdk.created, 1);
      assert.ok(sdk.resized > 0);
      assert.equal(sdk.nativeOpens, 0);
      assert.equal(stockReads, 1);
      assert.deepEqual(errors, []);
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'no document overflow');
      await page.screenshot({ path: `/tmp/map-workspace-${width}.png` });
      observations.push({ width, metricWidth: metricBounds.width, canvasWidth: canvas.width, mapInstances: sdk.created, stockReads, nativeOpens: sdk.nativeOpens, typography });
      if (width === 1536) {
        const shortViewportPage = await context.newPage();
        try { observations.push(await verifyShortViewport(shortViewportPage, { base })); }
        finally { await shortViewportPage.close(); }
      }
      if ([1536,1024,390,320,844].includes(width)) {
        const routeFocusPage=await context.newPage();
        try { observations.push(await verifyRouteFocus(routeFocusPage,{base,width})); }
        finally { await routeFocusPage.close(); }
      }
      if ([1536,1024,390,320,844].includes(width)) {
        for (const role of width===390 ? ['viewer','admin'] : [width===1024?'admin':'viewer']) {
          const supplyStatePage=await context.newPage();
          try { observations.push(await verifySupplyLoading(supplyStatePage,{base,width,role})); }
          finally { await supplyStatePage.close(); }
          const semanticsPage=await context.newPage();
          try { observations.push(await verifyControlSemantics(semanticsPage,{base,width,role})); }
          finally { await semanticsPage.close(); }
        }
      }
      if ([1536,1280,1024,390,320,844].includes(width)) {
        const contentHeightPage=await context.newPage();
        try { observations.push(await verifyContentHeight(contentHeightPage,{base,width})); }
        finally { await contentHeightPage.close(); }
      }
      if ([1536,390,320,844].includes(width)) {
        const asyncPage=await context.newPage();
        try { observations.push(await verifyAsyncReading(asyncPage,{base,width})); }
        finally { await asyncPage.close(); }
      }
      if ([1536,390,320,844].includes(width)) {
        const regionCameraPage=await context.newPage();
        try { observations.push(await verifyRegionCamera(regionCameraPage,{width,base})); }
        finally { await regionCameraPage.close(); }
        const surfacePage=await context.newPage();
        try { observations.push(await verifySurfaceContinuity(surfacePage,{width,base,readingPaths:true})); }
        finally { await surfacePage.close(); }
        const contactPage=await context.newPage();
        try { observations.push(await verifyContactReading(contactPage,{width,base})); }
        finally { await contactPage.close(); }
        const materialReadingPage=await context.newPage();
        try { observations.push(await verifyMaterialReading(materialReadingPage,{width,base})); }
        finally { await materialReadingPage.close(); }
        const relatedPage=await context.newPage();
        try { observations.push(await verifyRelatedReading(relatedPage,{width,base})); }
        finally { await relatedPage.close(); }
        const trendReturnPage=await context.newPage();
        try { observations.push(await verifyProjectTrendReturn(trendReturnPage,{width,base})); }
        finally { await trendReturnPage.close(); }
        const bubbleScopePage=await context.newPage();
        try { observations.push(await verifyBubbleScope(bubbleScopePage,{width,base})); }
        finally { await bubbleScopePage.close(); }
        const leedPage=await context.newPage();
        try { observations.push(await verifyLeedFilters(leedPage,{width,base})); }
        finally { await leedPage.close(); }
        const listReadingPage=await context.newPage();
        try { observations.push(await verifyListReading(listReadingPage,{width,base})); }
        finally { await listReadingPage.close(); }
        const researchPage=await context.newPage();
        try { observations.push(await verifySubmarketReading(researchPage,{width,base})); }
        finally { await researchPage.close(); }
        const profileDraftPage=await context.newPage();
        try { observations.push(await verifyProfileDraftNavigation(profileDraftPage,{width,base,userId:user.id})); }
        finally { await profileDraftPage.close(); }
        const metricsDraftPage=await context.newPage();
        try { observations.push(await verifyMetricsDraftNavigation(metricsDraftPage,{width,base,userId:user.id,projectId:stock[0].id})); }
        finally { await metricsDraftPage.close(); }
        const trendLoadingPage=await context.newPage();
        try { observations.push(await verifyTrendLoadingLayout(trendLoadingPage,{base,width})); }
        finally { await trendLoadingPage.close(); }
        const trendRecoveryPage=await context.newPage();
        try { observations.push(await verifyTrendRecovery(trendRecoveryPage,{base,width})); }
        finally { await trendRecoveryPage.close(); }
        if(width===1536){
          const dragReadingPage=await context.newPage();
          try { observations.push(await verifyDragReading(dragReadingPage,{base})); }
          finally { await dragReadingPage.close(); }
        }
        if(width===320){
          const shortPage=await context.newPage();
          try { await shortPage.setViewportSize({width:320,height:560});observations.push(await verifySubmarketReading(shortPage,{width,base,evidencePrefix:'map-submarket-short'})); }
          finally { await shortPage.close(); }
        }
      }
      if ([1536,390,320].includes(width)) {
        // Keep marker selection isolated from the main page's saved region and SDK-failure checks.
        const markerPage=await context.newPage();
        try {
          await markerPage.goto(new URL('/map',base).href);
          await markerPage.waitForFunction(()=>window.__workspaceMap?.getCenter());
          observations.push(await verifySupplyMarkers(markerPage,{width,supplies:future,evidencePrefix:'map-marker-fixture',openRegion:async name=>{
            await markerPage.evaluate(name=>window.dispatchEvent(new CustomEvent('map-submarket-open',{detail:{name}})),name);
            await markerPage.getByRole('region',{name,exact:true}).waitFor();
          }}));
          observations.push(await verifyBaseMapPlaces(markerPage,{width,evidencePrefix:'map-base-places-fixture'}));
          observations.push(await verifyPerformanceListeners(markerPage,width));
        } finally {await markerPage.close();}
      }
      if (width === 1536) {
        failSDK = true;
        await page.reload();
        await page.getByText('地图加载失败', { exact: true }).waitFor();
        await page.getByRole('button', { name: '项目列表', exact: true }).click();
        await list.getByRole('button', { name: /^中关村楼/ }).click();
        await page.getByRole('region', { name: stock[2].name + '楼宇详情', exact: true }).waitFor();
        await page.getByRole('tab', { name: '成交与资料' }).click();
        await page.getByRole('button', { name: '销控与佣金' }).click();
        await page.getByRole('dialog').waitFor();
        assert.deepEqual(errors, [], 'SDK failure cannot break project reading');
      }

      if(width===1024) {
        await page.getByRole('button',{name:'项目列表',exact:true}).click();
        await list.getByRole('button',{name:/^CBD甲楼/}).click();
        const detail=page.getByRole('region',{name:'CBD甲楼楼宇详情'});
        await detail.getByRole('tab',{name:'行情',exact:true}).click();
        const ai=detail.getByRole('button',{name:'AI 分析',exact:true});
        await ai.waitFor();
        assert.ok(await ai.evaluate(el=>el.closest('.workspace-business-actions') && getComputedStyle(el).borderTopStyle==='solid'),'AI has the same real action styling');
        await page.screenshot({path:'/tmp/map-layout-ai-1024.png'});
        await ai.click();await page.waitForURL(u=>u.searchParams.get('aiBuilding')===stock[0].id && u.hash==='#colliers-ai');
        await page.goBack();await detail.waitFor();
        assert.equal(await detail.getByRole('tab',{name:'行情',exact:true}).getAttribute('aria-selected'),'true');
        await detail.getByRole('tab',{name:'概览',exact:true}).click();
      }

      if ([1536,320].includes(width)) {
        failSDK = false; futureRows = [];
        const variants = [
          // Density fixtures reuse numeric facts, not the original building's photo identities.
          ['three-digits', Array.from({length:128},(_,index)=>({...stock[0],id:`scale-${index}`,name:`规模项目${index}`,photos:[],building_metrics:stock[0].building_metrics.map((metric,i)=>({...metric,id:`scale-metric-${index}-${i}`,building_id:`scale-${index}`}))})), '128'],
          ['zero', [], '0'],
          ['missing', [{...stock[0],building_metrics:[]}], '1'],
        ];
        for (const [label,rows,count] of variants) {
          dataRows = rows;
          dataGate = new Promise(resolve => { releaseData = resolve; });
          await page.evaluate(()=>sessionStorage.clear());
          await page.goto(new URL('/map',base).href);
          await liveStats.getByText('更新中',{exact:true}).waitFor();
          assert.equal(await liveStats.getAttribute('aria-busy'),'true');
          const updatingBox=await liveStats.getByText('更新中',{exact:true}).boundingBox();
          const statsBox=await liveStats.boundingBox();
          assert.ok(updatingBox.y+updatingBox.height<=statsBox.y+statsBox.height,'loading feedback stays inside the metrics rather than covering the search row');
          await page.screenshot({path:`/tmp/map-metric-loading-${width}.png`});
          releaseData(); dataGate = null;
          await page.waitForFunction(count=>document.querySelector('.map-live-stats')?.getAttribute('aria-busy')==='false' && document.querySelectorAll('.map-live-stats .map-metric-number')[2]?.textContent===count,count);
          const values=await liveStats.locator('.map-metric-number').allTextContents();
          assert.equal(values[2],count);
          if (label==='three-digits') assert.equal(values[3],'115,449.4');
          else assert.deepEqual([values[0],values[1],values[3]],['—','—','—']);
          assert.ok(await liveStats.evaluate(element=>element.scrollWidth<=element.clientWidth+1),'metric edge content fits its frame');
          const gaps=await liveStats.locator('dd').evaluateAll(elements=>elements.map(element=>{
            const number=element.querySelector('b').getBoundingClientRect(),unit=element.querySelector('span').getBoundingClientRect();return unit.left-number.right;
          }));
          assert.ok(gaps.every(gap=>gap>=0 && gap<=5),'units stay grouped with the real number width');
          await page.screenshot({path:`/tmp/map-metric-${label}-${width}.png`});
          observations.push({width,metricVariant:label,values,numberUnitGaps:gaps});
        }
      }

      if ([1536,390].includes(width)) observations.push(await verifySubmarketDesign(context, { base, width, stock }));

      // Use a fresh map page: the full list deliberately remains mounted after
      // closing, while earlier assertions inspect the map's entire DOM text.
      dataRows = stock; futureRows = future;
      await page.goto(new URL('/map', base).href);
      await page.locator('#map-container [data-building-id="10000000-1111-4111-8111-111111111111"]').first().waitFor();
      observations.push({ width, ...await verifyFullListReading(page, width) });
    } catch (error) {
      console.error('workspace regression failure', error);
      await page?.screenshot({ path: `/tmp/map-workspace-failure-${width}.png` }).catch(() => {});
      console.error('workspace failure state', width, await page?.evaluate(() => ({
        right: document.querySelector('.map-workspace-right')?.textContent?.slice(0, 1500),
        hidden: document.querySelector('.map-workspace-right')?.getAttribute('aria-hidden'),
        left: document.querySelector('.map-workspace-left')?.getAttribute('data-open'),
        sdk: window.__workspaceSDK,
      })));
      throw error;
    } finally { releaseData(); await context.close(); }
  }
  console.log(JSON.stringify({ status: 'pass', environment: 'production app, isolated SDK and authorized data fixtures', observations }));
} finally { await browser.close(); }
