import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { join } from 'node:path';

const base = new URL(process.argv[2]);
assert.ok(['127.0.0.1', 'localhost'].includes(base.hostname), 'loopback only');
const engine = process.env.PERF_LEDGER_ENGINE || 'chromium';
const diagnostic = process.argv.includes('--diagnostic');
const playwright = createRequire(import.meta.url)(process.env.PERF_PLAYWRIGHT_MODULE || 'playwright-core');
const browser = await playwright[engine].launch(engine === 'chromium' && process.env.PERF_BROWSER_CHANNEL !== 'chromium' ? { channel: 'chrome' } : {});
const user = { id: '12345678-1111-4111-8111-111111111111', email: 'database@example.test', app_metadata: {}, user_metadata: {} };
const expires_at = Math.floor(Date.now() / 1000) + 3600;
const encode = value => Buffer.from(JSON.stringify(value)).toString('base64url');
const access_token = `${encode({ alg: 'HS256' })}.${encode({ sub: user.id, exp: expires_at, aud: 'authenticated', session_id: user.id })}.fixture`;
const session = { user, expires_at, expires_in: 3600, token_type: 'bearer', refresh_token: 'synthetic', access_token };
const buildings = Array.from({length: 622}, (_, i) => ({
  id: `fixture-building-${i}`, name: i === 0 ? '隔离首开项目' : `隔离台账 ${i}`, grade: 'A', submarket: 'CBD',
  is_active: true, tracking_scope: 'tracked', project_type: 'stock', former_names: [],
}));
const metrics = Array.from({ length: 1388 }, (_, i) => ({id: i + 1, building_id: buildings[i % buildings.length].id,
  record_year: 2026, record_quarter: 3, net_effective_rent: 55}));
const live = buildings.map(({id}) => ({building_id:id, updated_at:'2026-11-01T09:00:00Z', net_effective_rent:60}));
const observations = [];
const details = [];
try {
  for (const scenario of [
    {width: 1280, warm: false}, {width: 1440, warm: true, offscreen: true},
    {width: 390, warm: false}, {width: 390, warm: true}, {width: 390, role: 'viewer'},
  ]) {
    const {width, warm = false, offscreen = false, role = 'admin'} = scenario;
    const context = await browser.newContext({viewport:{width, height:900}, isMobile: width < 640, hasTouch:width < 640, serviceWorkers:'block'});
    try {
      const calls = { metrics: 0, current: 0, mutations: 0 };
      await context.routeWebSocket(/.*/, ws => ws.close());
      await context.route('**/*', async route => {
        const req = route.request(), url = new URL(req.url());
        if (url.origin === base.origin) return url.pathname.startsWith('/api/') ? route.fulfill({status:204}) : route.continue();
        if (url.origin !== 'https://example.supabase.co') return route.abort();
        const headers = {'access-control-allow-origin':'*','access-control-allow-methods':'GET, POST, HEAD, OPTIONS','access-control-allow-headers':'*'};
        if (req.method() === 'OPTIONS') return route.fulfill({status:204,headers});
        if (url.pathname === '/auth/v1/user') return route.fulfill({headers, json:user});
        const table = url.pathname.split('/').at(-1);
        let rows = [];
        if (table === 'user_roles') rows = [{role, user_id:user.id, session_id:user.id, full_name:'隔离管理员'}];
        if (table === 'buildings') rows = buildings;
        if (table === 'building_metrics') { calls.metrics++; rows = metrics; }
        if (table === 'building_current_data') { calls.current++; rows = live; }
        if (!['GET','HEAD'].includes(req.method()) && !url.pathname.startsWith('/rest/v1/rpc/')) calls.mutations++;
        const offset = Number(url.searchParams.get('offset') ?? 0);
        const limit = Number(url.searchParams.get('limit') ?? 1000);
        return route.fulfill({headers,json:rows.slice(offset,offset+Math.min(limit,1000))});
      });
      await context.addInitScript(({origin,session,warm,cache,offscreen}) => {
        if (location.origin !== origin) return;
        localStorage.setItem('colliers_trusted_device_until', String(Date.now()+86400000));
        localStorage.setItem('sb-example-auth-token', JSON.stringify(session));
        if (offscreen) {
          // Simulate a grid mounted outside the visible area while its panel is entering.
          // A transform keeps its measured host box stable when we reveal it.
          window.__ledgerAutoSkip = [];
          document.addEventListener('contentvisibilityautostatechange', event => {
            if (event.target instanceof Element && event.target.matches('.grid-panel-container .ag-root-wrapper')) {
              window.__ledgerAutoSkip.push(event.skipped);
            }
          }, true);
          const hold = () => {
            if (!document.head) return;
            const style = document.createElement('style');
            style.id = 'isolated-ledger-offscreen';
            style.textContent = '.grid-panel-container { transform: translateX(300vw) }';
            document.head.append(style);
            watch.disconnect();
          };
          const watch = new MutationObserver(hold);
          watch.observe(document, {childList:true,subtree:true});
          hold();
        }
        if (warm) {
          sessionStorage.setItem('__db_manager_dicts', JSON.stringify({timestamp:Date.now(), dicts:{}}));
          sessionStorage.setItem('__project_ledger_cache_v4', JSON.stringify({t:Date.now(), d:cache}));
        }
      }, {origin:base.origin, session, warm, offscreen, cache:[...live.map((row,i)=>({...row, id:`cd_${row.building_id}`, name:buildings[i].name, source_type:'最新动态', data_period:'2026-11-01'})), ...metrics.map(row=>({...row,name:buildings[(row.id-1)%buildings.length].name,source_type:'季度填报',data_period:'2026Q3'}))]});
      const page = await context.newPage();
      page.on('pageerror', error => details.push(String(error).slice(0,300)));
      page.on('console', msg => {if (['error','warning'].includes(msg.type()) && /AG Grid|exception|TypeError/i.test(msg.text())) details.push(msg.text().slice(0,300));});
      await page.goto(new URL(offscreen ? '/admin?section=logs' : '/admin?section=database',base).href);
      if (offscreen) {
        await page.getByRole('button',{name:'数据库管理',exact:true}).click();
        await page.waitForURL('**/admin?section=database');
      }
      if (role === 'viewer') {
        await page.waitForURL(base.href);
        assert.deepEqual(calls, {metrics:0,current:0,mutations:0});
        observations.push({width, role, calls});
        continue;
      }
      await page.getByText('2010 条',{exact:true}).waitFor({timeout:10000});
      const root = page.locator('.grid-panel-container .ag-root-wrapper').first();
      await root.waitFor({state:'attached'});
      const contentVisibility = await root.evaluate(node => getComputedStyle(node).contentVisibility);
      let startupSkip = null;
      let rowsLaidOutDuringStartup = null;
      if (offscreen) {
        if (!diagnostic) await root.locator('.ag-row').first().waitFor({state:'attached',timeout:6000});
        if (diagnostic && contentVisibility === 'auto') {
          await page.waitForFunction(() => window.__ledgerAutoSkip.includes(true), null, {timeout:3000}).catch(() => {});
        }
        [startupSkip, rowsLaidOutDuringStartup] = await root.evaluate(node => new Promise(resolve => {
          requestAnimationFrame(() => requestAnimationFrame(() => {
            const row = node.querySelector('.ag-row');
            const layout = !!row?.checkVisibility({contentVisibilityAuto:true});
            const skipped = window.__ledgerAutoSkip.includes(true);
            document.getElementById('isolated-ledger-offscreen').remove();
            resolve([skipped, layout]);
          }));
        }));
      }
      const desktopCell = page.locator('.ag-cell[col-id="name"]').filter({hasText:'隔离首开项目'}).first();
      const firstRow = width < 640 ? page.getByText('隔离首开项目',{exact:true}).filter({visible:true}).first() : desktopCell;
      const visibleBeforeSwitch = await firstRow.waitFor({timeout:2200}).then(()=>true,()=>false);
      const geometry = await page.locator('.grid-panel-container').first().evaluate(root => Object.fromEntries(
        ['.ag-root-wrapper','.ag-header','.ag-center-cols-viewport','.ag-center-cols-container','.ag-row','.ag-cell'].map(key=>{
          const node=root.querySelector(key); if(!node)return[key,null]; const rect=node.getBoundingClientRect(); const s=getComputedStyle(node);
          return[key,[Math.round(rect.width),Math.round(rect.height),s.display,s.visibility]];
        })));
      if (process.env.PERF_LEDGER_SCREENSHOT_DIR && !warm) {
        await page.screenshot({path:join(process.env.PERF_LEDGER_SCREENSHOT_DIR, `ledger-${diagnostic ? 'before' : 'after'}-${width}.png`)});
      }
      const beforeChange = {...calls};
      if (visibleBeforeSwitch) {
        const search = page.locator('input[placeholder="搜索"]:visible');
        await search.focus();
        await search.pressSequentially('隔离首');
        await page.getByText('4 / 2010 条', {exact:true}).waitFor({timeout:6000});
        await search.pressSequentially('开');
        assert.deepEqual(await search.evaluate(el => [el.value, el.selectionStart, document.activeElement === el]), ['隔离首开',4,true]);
        await search.fill('');
        await page.getByText('2010 条',{exact:true}).waitFor();
        if (width < 640) {
          await page.getByRole('button',{name:'隔离首开项目',exact:true}).first().click();
          const detail = page.getByRole('dialog',{name:'完整详情'});
          await detail.waitFor();
          await detail.getByText('隔离首开项目',{exact:true}).waitFor();
          await detail.getByLabel('关闭',{exact:true}).click();
          await detail.waitFor({state:'hidden'});
        } else {
          await page.locator('.ag-header-cell[col-id="source_type"]').first().click();
          await page.locator('.ag-header-cell[col-id="source_type"][aria-sort="ascending"]').first().waitFor();
        }
      }
      const navigation = page.getByRole('combobox',{name:'选择数据表'});
      if (width < 640) { await navigation.selectOption('core:1'); await navigation.selectOption('core:0'); }
      else { await page.getByRole('button',{name:'存量项目基础信息',exact:true}).click(); await page.getByRole('button',{name:'项目台账',exact:true}).click(); }
      const visibleAfterSwitch = await firstRow.waitFor({timeout:2200}).then(()=>true,()=>false);
      observations.push({width,warm,offscreen,contentVisibility,startupSkip,rowsLaidOutDuringStartup,visibleBeforeSwitch,visibleAfterSwitch,geometry,beforeChange,calls});
    } finally {await context.close();}
  }
  console.log(JSON.stringify({browser:browser.version(), observations,details},null,2));
  if (!diagnostic) {
    for (const row of observations.filter(row => row.role !== 'viewer')) {
      assert.equal(row.visibleBeforeSwitch, true, 'initial ledger rows must be usable without changing tables');
      assert.equal(row.visibleAfterSwitch, true);
      assert.equal(row.calls.mutations, 0);
      assert.deepEqual(row.calls, row.beforeChange, 'switching tables must preserve the fetched ledger');
    }
    const transition = observations.find(row => row.offscreen);
    assert.equal(transition.startupSkip, false, 'the browser skipped initial ledger layout during the transition');
    assert.equal(transition.rowsLaidOutDuringStartup, true, 'ledger rows must be laid out even before the route settles');
  }
} finally {await browser.close();}
