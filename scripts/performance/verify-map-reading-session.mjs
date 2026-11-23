import { sanitizeCpuProfile, sanitizeMainThreadTrace, summarizeLongTasks } from './fixtures/long-task-profile.mjs';
import { clickWorkspaceAction } from '../verification/workspace-actions.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { user, session, stock, future, project, stacking } from './fixtures/workspace-data.mjs';
import { installLiveAmapProbe, waitForLiveAmapTiles } from './fixtures/live-amap-probe.mjs';

// Real public SDK, camera projection and tiles; isolated business/auth records.
const base = new URL(process.argv[2]);
assert.ok(['127.0.0.1', 'localhost'].includes(base.hostname));
const output = process.argv[3] || '/tmp/map-reading-session.json';
const evidenceStem=output.replace(/\.json$/,'');
const { chromium } = createRequire(import.meta.url)(process.env.PERF_PLAYWRIGHT_MODULE || 'playwright-core');
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const provider = host => /(^|\.)(amap\.com|amap\.cn|autonavi\.com|autonavi\.cn|gaode\.com)$/.test(host);
const extra = [
  ['long-west', '望京', 116.35, 40.01], ['long-east', '望京', 116.57, 40.015],
  ['single', '丽泽', 116.35, 39.87], ['same', '丽泽', 116.35, 39.87],
  ['no-coordinate', '石景山', null, null],
].map(([id, submarket, location_lng, location_lat]) => ({ ...stock[0], id, name: id, submarket, location_lng, location_lat }));
const previewBytes=fs.readFileSync(new URL('../../public/occupier-insights/office-green.webp',import.meta.url));
const previewMetadata=Buffer.from(JSON.stringify({can_download:true,source_url:'',source_name:''})).toString('base64url');
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
    const futureReady = new Promise(resolve => { releaseFuture = resolve; });
    if(width!==1536) releaseFuture();
    try {
      await context.routeWebSocket(/.*/, socket => socket.close());
      await context.route('**/*', async route => {
        const url = new URL(route.request().url());
        if (url.origin === base.origin) {
          if (url.pathname === '/api/map/data') {
            if(url.searchParams.get('mode') === 'trend') return route.fulfill({json:{metrics:Array.from({length:6},(_,i)=>({record_year:2026-i,record_quarter:i?4:3,net_effective_rent:140+i*5,vacancy_rate:.1+i*.01}))}});
            if(url.searchParams.get('mode') === 'future') {await futureReady;return route.fulfill({json:{future_supplies:regionFuture}});}
            return route.fulfill({json:{buildings,display_overrides:[]}});
          }
          if (url.pathname === '/api/map/submarket') return route.fulfill({json:{submarket:url.searchParams.get('name'),stockCount:2,profileAvailable:false,trends:{all:[],a:[],b:[]}}});
          if (url.pathname === `/api/stacking-plan/${project}`) return route.fulfill({json:stacking});
          if (url.pathname === '/api/map/building-photos') {
            assert.equal(url.searchParams.get('building_id'),project);
            if(url.searchParams.has('preview'))return route.fulfill({headers:{'content-type':'image/webp','x-building-photo-metadata':previewMetadata},body:previewBytes});
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
      await context.addInitScript(()=>{
        window.__readingTasks=[];window.__readingBlobs=new Set();window.__readingBlobCounts={created:0,revoked:0};
        new PerformanceObserver(list=>window.__readingTasks.push(...list.getEntries().map(e=>({startTime:e.startTime,duration:e.duration})))).observe({type:'longtask',buffered:true});
        const create=URL.createObjectURL.bind(URL),revoke=URL.revokeObjectURL.bind(URL);
        URL.createObjectURL=blob=>{const url=create(blob);if(/^(image\/|application\/pdf)/.test(blob.type)){window.__readingBlobs.add(url);window.__readingBlobCounts.created++;}return url;};
        URL.revokeObjectURL=url=>{if(window.__readingBlobs.delete(url))window.__readingBlobCounts.revoked++;return revoke(url);};
      });
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
      releaseFuture();
      await page.waitForFunction(()=>document.querySelector('.map-live-stats')?.getAttribute('aria-busy')==='false');
      const cdp=await context.newCDPSession(page);
      await cdp.send('Performance.enable');await cdp.send('Profiler.enable');await cdp.send('Profiler.setSamplingInterval',{interval:1000});
      const metrics=Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map(v=>[v.name,v.value]));
      const trace=[];cdp.on('Tracing.dataCollected',e=>trace.push(...e.value));
      const apiInFlight=new Set(),apiCounts={};
      page.on('request',request=>{const u=new URL(request.url());if(u.origin===base.origin&&u.pathname.startsWith('/api/')){apiInFlight.add(request);const key=u.pathname+(u.searchParams.has('mode')?'?mode='+u.searchParams.get('mode'):'');apiCounts[key]=(apiCounts[key]??0)+1;}});
      const finished=request=>apiInFlight.delete(request);page.on('requestfinished',finished);page.on('requestfailed',finished);
      const checkpoints=[],actions=[],tasks=[];
      const scriptSources=new Map();cdp.on('Debugger.scriptParsed',event=>{let source='runtime';try{const u=new URL(event.url);source=u.origin===base.origin?'application:'+u.pathname:provider(u.hostname)?'amap:'+u.hostname+u.pathname:'external:'+u.hostname;}catch{}scriptSources.set(event.scriptId,source);});
      if(process.env.MAP_READING_SOURCES==='1')await cdp.send('Debugger.enable',{maxScriptsCacheSize:0});
      const listenerCensus=async()=>{
        const census={};const handles=new Set();
        for(const expression of ['window','document','document.documentElement']){
          const {result}=await cdp.send('Runtime.evaluate',{expression,objectGroup:'reading-census'});
          if(!result.objectId)continue;
          const {listeners}=await cdp.send('DOMDebugger.getEventListeners',{objectId:result.objectId,depth:expression==='document.documentElement'?-1:1,pierce:true});
          const counts={};for(const listener of listeners){const key=[listener.type,scriptSources.get(listener.scriptId)||'unknown',listener.lineNumber+1].join('|');counts[key]=(counts[key]??0)+1;for(const field of ['handler','originalHandler'])if(listener[field]?.objectId)handles.add(listener[field].objectId);}
          census[expression]=counts;
        }
        for(const objectId of handles)await cdp.send('Runtime.releaseObject',{objectId});
        await cdp.send('Runtime.releaseObjectGroup',{objectGroup:'reading-census'});return census;
      };
      const checkpoint=async cycle=>{
        tasks.push(...await page.evaluate(()=>window.__readingTasks.splice(0)));
        await page.evaluate(()=>{const p=window.__liveAmapProbe;for(const key of ['events','calls','markerCalls','initialCameras','stages'])p[key].length=0;});
        const start=await page.evaluate(()=>performance.now());
        await cdp.send('HeapProfiler.collectGarbage');
        const heap=await cdp.send('Runtime.getHeapUsage'),dom=await cdp.send('Memory.getDOMCounters');
        const end=await page.evaluate(()=>performance.now());actions.push({name:'instrumented forced GC checkpoint '+cycle,startTime:start,endTime:end});
        const state=await page.evaluate(()=>({mapInstances:window.__liveAmapProbe.created,mapRoots:document.querySelectorAll('#map-container .amap-maps').length,selectedMarkers:document.querySelectorAll('.map-selected-marker').length,chartCanvases:document.querySelectorAll('.workspace-project-trend-host canvas').length,openModals:document.querySelectorAll('dialog[open], [aria-modal="true"]').length,photoImages:document.querySelectorAll('[data-building-photo]').length,imageBlobs:window.__readingBlobs.size,imageBlobCounts:{...window.__readingBlobCounts}}));
        for(const key of ['selectedMarkers','chartCanvases','openModals','photoImages','imageBlobs'])assert.equal(state[key],0,key+' is released after returning to the map');
        assert.equal(state.mapInstances,1);assert.equal(state.mapRoots,1);
        assert.equal(state.imageBlobCounts.created,state.imageBlobCounts.revoked,'every allocated preview Blob URL is released');
        if(cycle>0)assert.ok(state.imageBlobCounts.created>checkpoints.at(-1).state.imageBlobCounts.created,'each reading cycle exercises a real decoded preview Blob');
        checkpoints.push({cycle,heap,dom,state,listenerCensus:await listenerCensus(),apiInFlight:apiInFlight.size,apiCounts:{...apiCounts}});
      };
      await page.evaluate(()=>window.__readingTasks.length=0);
      await cdp.send('Profiler.start');await cdp.send('Tracing.start',{categories:'devtools.timeline,v8,disabled-by-default-v8.gc',transferMode:'ReportEvents'});
      await checkpoint(0);
      const detail=page.getByRole('region',{name:'CBD甲楼楼宇详情',exact:true});
      const cycleCount=Number(process.env.MAP_READING_CYCLES||12);assert.ok(Number.isInteger(cycleCount)&&cycleCount>=1&&cycleCount<=100,'reading cycle count 1–100');
      for(let cycle=1;cycle<=cycleCount;cycle++){
        const startTime=await page.evaluate(()=>performance.now());
        await page.evaluate(()=>window.dispatchEvent(new CustomEvent('map-submarket-open',{detail:{name:'CBD'}})));
        await page.getByRole('region',{name:'CBD',exact:true}).waitFor();
        await page.getByRole('button',{name:'查看全部项目',exact:true}).click();
        await page.getByRole('region',{name:'项目列表',exact:true}).getByRole('button',{name:/^CBD甲楼/}).click();await detail.waitFor();
        await detail.getByRole('tab',{name:'概览',exact:true}).click();
        const photoToggle=detail.getByRole('button',{name:/看图 · 1张/});
        if(await photoToggle.getAttribute('aria-expanded')!=='true')await photoToggle.click();
        await detail.locator('[data-building-photo]:visible').waitFor();
        await detail.locator('[data-building-photo]:visible').evaluate(image=>{if(!image.complete||!image.naturalWidth)throw new Error('preview image not decoded');});
        await detail.getByRole('button',{name:'查看大图',exact:true}).click();await detail.getByRole('dialog').waitFor();await page.keyboard.press('Escape');
        await detail.getByRole('tab',{name:'行情',exact:true}).click();
        const trendToggle=detail.getByRole('button',{name:'季度趋势',exact:true});
        if(await trendToggle.getAttribute('aria-expanded')!=='true')await trendToggle.click();
        await detail.locator('#info-chart-container canvas').waitFor();
        await detail.getByRole('button',{name:'空置率',exact:true}).click();
        if(!await detail.getByRole('table',{name:'项目期间租金与空置率',exact:true}).isVisible())await detail.getByText('查看期间数据',{exact:true}).click();
        await detail.getByRole('table',{name:'项目期间租金与空置率',exact:true}).waitFor();
        if(cycle%3===0){await clickWorkspaceAction(page,'全屏阅读工作区');await clickWorkspaceAction(page,'返回地图分屏');}
        await detail.getByRole('tab',{name:'成交与资料',exact:true}).click();
        await detail.getByRole('button',{name:'楼书与资料',exact:true}).click();
        const material=page.getByRole('dialog');await material.getByRole('button',{name:'查看原件',exact:true}).click();
        await material.getByAltText('任务链项目资料',{exact:true}).waitFor();
        await material.getByRole('button',{name:'返回项目资料',exact:true}).click();
        await material.getByRole('button',{name:'关闭销控',exact:true}).click();await material.waitFor({state:'detached'});
        await page.getByRole('button',{name:'返回项目列表',exact:true}).click();
        await page.getByRole('button',{name:'返回子市场研究',exact:true}).click();
        await page.getByRole('button',{name:'关闭子市场介绍',exact:true}).click();
        await page.waitForFunction(()=>!document.querySelector('.map-workspace-layout [data-exiting]'));
        const endTime=await page.evaluate(()=>performance.now());actions.push({name:'reading cycle '+cycle,startTime,endTime});
        await checkpoint(cycle);console.log('reading resource cycle',cycle,checkpoints.at(-1).dom);
      }
      tasks.push(...await page.evaluate(()=>window.__readingTasks.splice(0)));
      const complete=new Promise(resolve=>cdp.once('Tracing.tracingComplete',resolve));await cdp.send('Tracing.end');await complete;
      const profile=(await cdp.send('Profiler.stop')).profile;
      const details=summarizeLongTasks({tasks,profile,trace,navigationStart:metrics.NavigationStart,origin:base.origin});
      const scoped=details.map(task=>({...task,actions:actions.filter(action=>task.startTime<action.endTime&&task.startTime+task.duration>action.startTime).map(action=>action.name)}));
      fs.writeFileSync(evidenceStem+'-'+width+'.cpuprofile',JSON.stringify(sanitizeCpuProfile(profile)));
      fs.writeFileSync(evidenceStem+'-'+width+'.trace.json',JSON.stringify({traceEvents:sanitizeMainThreadTrace(trace),navigationStart:metrics.NavigationStart,tasks,actions}));
      results.viewports.push({width,height,network,checkpoints,cycles:cycleCount,longTasks:scoped,profiling:'diagnostic CPU sampling and trace with explicit forced GC checkpoints; debugger source cache disabled by default; no unprofiled performance benchmark',limits:['Real SDK/tiles; business and identity fixtures',`${width}x${height} viewport SPA session; no native phone or multi-hour/production claim`,'SDK public observation arrays are cleared each checkpoint to avoid measuring probe accumulation']});
    } finally {releaseFuture();await context.close();}
  }
  results.status='pass';
} catch(error){results.status='fail';results.error=String(error).replace(/https?:\/\/\S+/g,'[url]');throw error;}
finally{fs.writeFileSync(output,JSON.stringify(results,null,2));await browser.close();}
