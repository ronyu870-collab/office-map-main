import { verifySupplyMarkers } from './workspace-supply-markers.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { user, session, stock, future, project, stacking } from '../performance/fixtures/workspace-data.mjs';
import { installLiveAmapProbe, waitForLiveAmapTiles } from '../performance/fixtures/live-amap-probe.mjs';

// Real public SDK, camera projection and tiles; isolated business/auth records.
const base = new URL(process.argv[2]);
assert.ok(['127.0.0.1', 'localhost'].includes(base.hostname));
const output = process.argv[3] || '/tmp/map-region-live.json';
const { chromium } = createRequire(import.meta.url)(process.env.PERF_PLAYWRIGHT_MODULE || 'playwright-core');
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const provider = host => /(^|\.)(amap\.com|amap\.cn|autonavi\.com|autonavi\.cn|gaode\.com)$/.test(host);
const extra = [
  ['long-west', '望京', 116.35, 40.01], ['long-east', '望京', 116.57, 40.015],
  ['single', '丽泽', 116.35, 39.87], ['same', '丽泽', 116.35, 39.87],
  ['no-coordinate', '石景山', null, null],
].map(([id, submarket, location_lng, location_lat]) => ({ ...stock[0], id, name: id, submarket, location_lng, location_lat }));
const chainPhoto = {id:'b04ed43e-bf3a-4d63-919e-c44d60d4fe75',caption:'任务链外观'};
const buildings = [...stock.map(row=>row.id===project?{...row,photos:[chainPhoto]}:row), ...extra];
// Put visible future supply outside the stock envelope, so forgetting it cannot
// accidentally pass the real SDK pixel assertions.
const regionFuture = [...future.map(row => ({...row,grade:'A',location_lng:116.53,location_lat:39.95})), {id:'pending-map-project',name:'待核实标记项目',status:'pending',district:'朝阳区',submarket:'CBD',location_lng:116.50,location_lat:39.935}];
const selectedWidths = process.env.MAP_LIVE_WIDTHS?.split(',').map(Number);
assert.ok(!selectedWidths || selectedWidths.every(width => [1536,390,844].includes(width)), 'supported live widths');
const results = { environment: 'real AMap SDK/tiles; isolated business and administrator identity', viewports: [] };
try {
  for (const [width,height] of [[1536,900],[390,844],[844,390]].filter(([width]) => !selectedWidths || selectedWidths.includes(width))) {
    const context = await browser.newContext({ viewport: {width,height}, serviceWorkers:'block' });
    const network = { sdkOK:0, tileOK:0 };
    let releaseFuture;
    let futureRequests = 0;
    const futureReady = new Promise(resolve => { releaseFuture = resolve; });
    if(width!==1536) releaseFuture();
    try {
      await context.routeWebSocket(/.*/, socket => socket.close());
      await context.route('**/*', async route => {
        const url = new URL(route.request().url());
        if (url.origin === base.origin) {
          if (url.pathname === '/api/map/data') {
            if(url.searchParams.get('mode') === 'future') {futureRequests++;await futureReady;return route.fulfill({json:{future_supplies:regionFuture}});}
            return route.fulfill({json:{buildings,display_overrides:[]}});
          }
          if (url.pathname === '/api/map/submarket') return route.fulfill({json:{submarket:url.searchParams.get('name'),stockCount:2,profileAvailable:false,trends:{all:[],a:[],b:[]}}});
          if (url.pathname === `/api/stacking-plan/${project}`) return route.fulfill({json:stacking});
          if (url.pathname === '/api/map/building-photos') {
            assert.equal(url.searchParams.get('building_id'),project);
            return route.fulfill({json:{url:'https://synthetic.invalid/task-chain.svg',is_preview:false,can_download:true,source_url:'',source_name:''}});
          }
          if (url.pathname === '/api/map/sales-materials') {
            assert.equal(url.searchParams.get('building_id'),project);
            const material={id:'chain-material',title:'任务链项目资料',source:'隔离业主',notes:'',original_name:'owner.png',mime_type:'image/png',file_size:1,document_date:null,created_at:'2026-11-21T00:00:00Z',content_types:['brochure']};
            return route.fulfill({json:url.searchParams.has('material_id')?{details:[],project_facts:[],preview_url:'https://synthetic.invalid/task-chain.svg',download_url:'',provenance:{document_date_evidence:'',received:null,version_recorded_at:material.created_at,source_sha256:'a'.repeat(64)}}:{records:[material],count:1}});
          }
          if (url.pathname.startsWith('/api/')) return route.fulfill({status:204});
          return route.continue();
        }
        if (url.origin === 'https://example.supabase.co') return route.fulfill({headers:{'access-control-allow-origin':'*','access-control-allow-headers':'*','access-control-allow-methods':'GET, OPTIONS'},json:url.pathname === '/rest/v1/user_roles' ? [{role:'admin',session_id:user.id}] : []});
        if (url.origin==='https://synthetic.invalid') return route.fulfill({contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="700"><rect width="1200" height="700" fill="#c5d4dd"/></svg>'});
        if (provider(url.hostname)) return route.continue();
        return route.abort();
      });
      await context.addInitScript(({origin,session}) => { if(location.origin===origin){localStorage.setItem('colliers_trusted_device_until',String(Date.now()+86400000));localStorage.setItem('sb-example-auth-token',JSON.stringify(session));} },{origin:base.origin,session});
      await context.addInitScript(installLiveAmapProbe);
      const page = await context.newPage();
      page.setDefaultTimeout(15000);
      page.on('response', response => { const u=new URL(response.url()); if(response.ok()&&provider(u.hostname)){if(u.pathname==='/maps')network.sdkOK++;if(/\/tile\/|\/get_tile$/.test(u.pathname))network.tileOK++;} });
      await page.goto(new URL('/map',base).href);
      try { await page.waitForFunction(() => window.__workspaceMap?.getCenter()); }
      catch (error) {
        await page.screenshot({path:`/tmp/map-sdk-init-failure-${width}.png`});
        results.initializationFailure = {width,network,visibleText:(await page.locator('body').innerText()).slice(0,2000)};
        throw error;
      }
      await waitForLiveAmapTiles(page,network);
      const open = async name => {
        console.log(`real ${width}: opening ${name}`);
        await page.evaluate(name => window.dispatchEvent(new CustomEvent('map-submarket-open',{detail:{name}})),name);
        await page.getByRole('region',{name,exact:true}).waitFor();
      };
      const inspect = async (name, data, label=name) => {
        // Wait for layout/camera to settle, then check actual public SDK projection.
        await page.waitForTimeout(800);
        const result = await page.evaluate(rows => {
          const map=window.__workspaceMap, host=map.getContainer(), rect=host.getBoundingClientRect();
          const points=rows.map(row => { const p=map.lngLatToContainer([row.location_lng,row.location_lat]);return {id:row.id,x:p.getX(),y:p.getY(),edge:Math.min(p.getX(),rect.width-p.getX(),p.getY(),rect.height-p.getY())}; });
          const center=map.getCenter();return {width:rect.width,height:rect.height,zoom:map.getZoom(),center:[center.lng,center.lat],points,cameraCalls:window.__liveAmapProbe.calls.filter(x=>['setZoomAndCenter','setBounds','setCenter'].includes(x.name)).length};
        },data.filter(row => row.location_lng != null && row.location_lat != null));
        assert.ok(result.points.every(p=>p.edge>=24),`${label} ${width} cropped: ${JSON.stringify(result)}`);
        await page.waitForTimeout(400);
        const after=await page.evaluate(()=>{const m=window.__workspaceMap,c=m.getCenter();return {zoom:m.getZoom(),center:[c.lng,c.lat]};});
        assert.ok(Math.abs(after.zoom-result.zoom)<.01 && after.center.every((v,i)=>Math.abs(v-result.center[i])<.000001),`${label}: settled camera has no delayed correction/resize loop`);
        return {name:label,...result};
      };
      const scenes=[];
      if(width===1536) {
        await open('CBD');await page.waitForTimeout(300);
        assert.ok(futureRequests>0,'the pending future transport must actually be requested');
        const canvas=await page.locator('#map-container').boundingBox();
        const camera=()=>page.evaluate(()=>{const m=window.__workspaceMap,c=m.getCenter();return [m.getZoom(),c.lng,c.lat];});
        const before=await camera();
        await page.mouse.move(canvas.x+canvas.width*.5,canvas.y+canvas.height*.5);
        await page.mouse.down();await page.mouse.move(canvas.x+canvas.width*.7,canvas.y+canvas.height*.6,{steps:12});await page.mouse.up();
        await page.waitForTimeout(700);const dragged=await camera();
        assert.ok(Math.abs(dragged[1]-before[1])>.0001,'real SDK drag changes the camera');
        releaseFuture();await page.waitForTimeout(900);
        const after=await camera();
        assert.ok(after.every((v,i)=>Math.abs(v-dragged[i])<.00001),'late future data cannot reclaim a real user drag');
        scenes.push({name:'real drag then delayed future response',before,dragged,after});
      }
      await open('CBD'); scenes.push(await inspect('CBD',[...buildings,...regionFuture].filter(x=>x.submarket==='CBD')));
      if(width===1536){await page.getByRole('separator',{name:'调整业务工作区宽度'}).press('End');scenes.push(await inspect('CBD',[...buildings,...regionFuture].filter(x=>x.submarket==='CBD'),'CBD wide pane'));}
      await open('望京'); scenes.push(await inspect('望京',extra.filter(x=>x.submarket==='望京')));
      await open('丽泽'); const identical=await inspect('丽泽',extra.filter(x=>x.submarket==='丽泽'));assert.ok(identical.zoom<=16);scenes.push(identical);
      await page.getByRole('button',{name:'查看全部项目',exact:true}).click();
      const overlapList=page.getByRole('region',{name:'项目列表',exact:true});
      const overlapSelections=[];
      for(const id of ['single','same']) {
        await overlapList.getByRole('button',{name:new RegExp('^'+id+'(?:\\s|$)')}).click();
        const selected=page.getByRole('region',{name:id+'楼宇详情',exact:true});await selected.waitFor();
        assert.equal(await selected.getAttribute('data-building-id'),id,'same-coordinate list selections keep independent identities');
        await page.waitForTimeout(600);
        assert.equal(await page.locator('.map-selected-marker').count(),1,'one selected marker remains for the current project');
        const center=await page.evaluate(()=>{const c=window.__workspaceMap.getCenter();return[c.lng,c.lat];});
        assert.ok(Math.abs(center[0]-116.35)<.00001&&Math.abs(center[1]-39.87)<.00001,'the selected same-coordinate project has its own correct camera');
        overlapSelections.push({id,center});
        await page.getByRole('button',{name:'返回项目列表',exact:true}).click();await overlapList.waitFor();
      }
      scenes.push({name:'independent list selection for same-coordinate buildings',selections:overlapSelections});

      await page.evaluate(()=>{for(const name of ['CBD','望京','中关村'])window.dispatchEvent(new CustomEvent('map-submarket-open',{detail:{name}}));});
      await page.getByRole('region',{name:'中关村',exact:true}).waitFor();scenes.push(await inspect('中关村',stock.filter(x=>x.submarket==='中关村'),'rapid A B C'));
      await page.getByRole('button',{name:'关闭子市场介绍'}).click();
      await page.getByRole('button',{name:'项目列表',exact:true}).click();
      await page.getByRole('region',{name:'项目列表',exact:true}).getByRole('button',{name:/^中关村楼/}).waitFor();
      assert.equal(await page.getByRole('region',{name:'项目列表',exact:true}).getByRole('button',{name:/^CBD甲楼/}).count(),0);
      await open('石景山');await page.getByText(/当前筛选下暂无可定位项目/).waitFor();
      const before=await page.evaluate(()=>{const m=window.__workspaceMap,c=m.getCenter();return [m.getZoom(),c.lng,c.lat];});
      await page.waitForTimeout(500);
      assert.deepEqual(await page.evaluate(()=>{const m=window.__workspaceMap,c=m.getCenter();return [m.getZoom(),c.lng,c.lat];}),before,'empty region does not relocate');
      if (width===1536) {
        await open('CBD'); await page.getByRole('button',{name:'查看全部项目',exact:true}).click();
        const list=page.getByRole('region',{name:'项目列表',exact:true});
        await list.getByRole('button',{name:/^CBD甲楼/}).click();
        const detail=page.getByRole('region',{name:'CBD甲楼楼宇详情'}); await detail.waitFor();
        for (const [mode,glyph] of [['项目','A'],['租金','146'],['空置','21%'],['LEED','–']]) {
          await page.getByRole('button',{name:mode,exact:true}).click();
          await page.waitForFunction(glyph=>decodeURIComponent(document.querySelector('.map-selected-marker__badge')?.getAttribute('src')??'').includes('>'+glyph+'</text>'),glyph);
          await page.waitForTimeout(250);
          await page.screenshot({path:`/tmp/map-task-chain-mode-${mode}.png`});
        }
        await page.getByRole('button',{name:'项目',exact:true}).click();
        await detail.getByRole('button',{name:/看图 · 1张/}).click();
        await detail.locator('[data-building-photo]:visible').waitFor();
        await detail.getByRole('button',{name:'查看大图',exact:true}).click(); await detail.getByRole('dialog').waitFor();
        await page.keyboard.press('Escape');
        await detail.getByRole('tab',{name:'成交与资料',exact:true}).click();
        await detail.getByRole('button',{name:'楼书与资料',exact:true}).click();
        const material=page.getByRole('dialog');
        await material.getByRole('button',{name:'查看原件',exact:true}).click();
        await material.getByAltText('任务链项目资料',{exact:true}).waitFor();
        await material.getByRole('button',{name:'返回项目资料',exact:true}).click();
        await material.getByRole('button',{name:'关闭销控',exact:true}).click(); await material.waitFor({state:'detached'});
        await page.waitForTimeout(500);
        const camera=()=>page.evaluate(()=>{const m=window.__workspaceMap,c=m.getCenter();return [m.getZoom(),c.lng,c.lat];});
        const beforeStack=await camera();
        await detail.getByRole('link',{name:'Stacking Plan',exact:true}).click();
        await page.getByRole('button',{name:/A 座 60层 连续性租户599/}).waitFor();
        await page.getByRole('link',{name:'返回项目详情',exact:true}).click(); await detail.waitFor(); await page.waitForTimeout(900);
        const afterStack=await camera();
        assert.ok(afterStack.every((value,index)=>Math.abs(value-beforeStack[index])<.00001),'real SDK return restores the actual saved camera without a delayed region takeover');
        assert.equal(await detail.getByRole('tab',{name:'成交与资料',exact:true}).getAttribute('aria-selected'),'true');
        await page.screenshot({path:'/tmp/map-task-chain-real-return.png'});
        await detail.getByRole('button',{name:'关闭楼宇详情',exact:true}).click();
        await page.getByRole('button',{name:'项目列表',exact:true}).click();
        await list.getByRole('button',{name:/^CBD乙楼/}).waitFor();
        assert.equal(await list.getByRole('button',{name:/^中关村楼/}).count(),0);
        scenes.push({name:'complete photo, material and Stacking round trip',beforeStack,afterStack,regionPreserved:true,selectedModes:4});
      }
      scenes.push(await verifySupplyMarkers(page,{width,openRegion:open,supplies:regionFuture,evidencePrefix:'map-marker-real',live:true}));
      await page.screenshot({path:`/tmp/map-region-live-${width}.png`});
      results.viewports.push({width,height,network,scenes,emptyAndClose:'pass'});
      console.log('passed real region',width);
    } finally {releaseFuture();await context.close();}
  }
  results.status='pass';
} catch(error){results.status='fail';results.error=String(error).replace(/https?:\/\/\S+/g,'[url]');throw error;}
finally{fs.writeFileSync(output,JSON.stringify(results,null,2));await browser.close();}
