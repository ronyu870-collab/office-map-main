import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { installSyntheticMap } from '../performance/fixtures/map-adapter.mjs';
import { user, session, stock, future, project, stacking } from '../performance/fixtures/workspace-data.mjs';

// Exercise the production React workspace and real MapController with isolated
// authorized data and SDK transport. No live database or tile service is used.
const base = new URL(process.argv[2]);
assert.ok(['127.0.0.1', 'localhost'].includes(base.hostname));
const { chromium } = createRequire(import.meta.url)(process.env.PERF_PLAYWRIGHT_MODULE || 'playwright-core');
const browser = await chromium.launch({ ...(process.env.PERF_BROWSER_CHANNEL === 'chromium' ? {} : { channel: 'chrome' }), headless: true });
function instrumentMap() {
  const BaseMap = window.AMap.Map;
  const stats = window.__workspaceSDK = { created: 0, resized: 0, centers: [], nativeOpens: 0 };
  window.AMap.Bounds = class { constructor(southwest, northeast) { this.southwest = southwest; this.northeast = northeast; } };
  window.AMap.Map = class extends BaseMap {
    constructor(id, options) { super(id, options); stats.created++; this.zoom = 10; window.__workspaceMap = this; this.host = document.getElementById(id); }
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
 for (const [width, reduced] of [[1536,false],[390,false],[390,true]]) {
  const context = await browser.newContext({viewport:{width,height:width===390?560:900},reducedMotion:reduced?'reduce':'no-preference',serviceWorkers:'block'});
  let stackReads=0, failRefresh=false;
  const errors=[];
  await context.routeWebSocket(/.*/, socket=>socket.close());
  await context.route('**/*', async route=>{
   const url=new URL(route.request().url());
   if(url.origin===base.origin){
    if(url.pathname==='/api/map/data')return route.fulfill({json:url.searchParams.get('mode')==='future'?{future_supplies:future}:{buildings:stock,display_overrides:[]}});
    if(url.pathname===`/api/stacking-plan/${project}`){ stackReads++; if(stackReads>1)await new Promise(resolve=>setTimeout(resolve,350)); return route.fulfill({status:failRefresh?503:200,json:failRefresh?{error:'隔离测试暂时不可用'}:stacking}); }
    if(url.pathname.startsWith('/api/'))return route.fulfill({status:204});
    return route.continue();
   }
   if(url.origin==='https://example.supabase.co')return route.fulfill({headers:{'access-control-allow-origin':'*','access-control-allow-headers':'*','access-control-allow-methods':'GET, OPTIONS'},json:url.pathname==='/rest/v1/user_roles'?[{role:'admin',session_id:user.id}]:[]});
   if(url.origin==='https://webapi.amap.com'&&url.pathname==='/maps')return route.fulfill({contentType:'application/javascript',body:`(${installSyntheticMap.toString()})();(${instrumentMap.toString()})();`});
   return route.abort();
  });
  await context.addInitScript(({origin,session})=>{
   if(location.origin!==origin)return;
   localStorage.setItem('colliers_trusted_device_until',String(Date.now()+86400000));localStorage.setItem('sb-example-auth-token',JSON.stringify(session));
  },{origin:base.origin,session});
  const page=await context.newPage();page.setDefaultTimeout(10000);page.on('pageerror',e=>errors.push(e.message));
  console.log('continuity viewport',width);
  await page.goto(new URL(`/map?building=${project}`,base).href);
  const detail=page.getByRole('region',{name:'CBD甲楼楼宇详情'});
  await detail.waitFor();await page.waitForTimeout(350);
  assert.ok(await page.evaluate(()=>window.__workspaceMap.getZoom()>=14),'project return must focus at project scale');
  await page.getByRole('button',{name:'租金',exact:true}).click();
  await page.getByRole('button',{name:'项目列表',exact:true}).click();
  const list=page.getByRole('region',{name:'项目列表',exact:true});await list.waitFor();
  await list.getByRole('searchbox',{name:'搜索当前项目列表'}).fill('CBD');
  await list.getByRole('combobox',{name:'项目列表排序'}).selectOption('name');
  await list.getByRole('button',{name:/^选择项目/}).click();
  await list.getByRole('checkbox',{name:'选择CBD乙楼',exact:true}).check().catch(async error=>{
    console.log('short viewport geometry',await page.locator('.map-workspace-layout, .map-workspace-right, .workspace-building-list, .workspace-panel-header, .workspace-list-tools, .workspace-scroll').evaluateAll(elements=>elements.map(element=>({name:element.className,box:element.getBoundingClientRect().toJSON(),scrollTop:element.scrollTop,scrollHeight:element.scrollHeight}))));
    await page.screenshot({path:'/tmp/continuity-short-phone.png'});throw error;
  });
  await list.getByRole('button',{name:'完成选择',exact:true}).click();
  await list.getByRole('button',{name:/^CBD甲楼/}).click();await detail.waitFor();
  await page.getByRole('tab',{name:'成交与资料',exact:true}).click();
  if(width===390)await detail.getByRole('button',{name:'阅读',exact:true}).click();
  if(width===1536)await page.getByRole('separator',{name:'调整业务工作区宽度'}).press('End');
  await page.waitForTimeout(260);
  const stackLink = page.getByRole('link',{name:'Stacking Plan',exact:true});
  await stackLink.scrollIntoViewIfNeeded(); await page.waitForTimeout(80);
  const readingScroll = await detail.locator('.workspace-scroll').evaluate(element=>element.scrollTop);
  const before={camera:await page.evaluate(()=>({zoom:window.__workspaceMap.getZoom(),center:window.__workspaceMap.center})),box:await page.locator('.map-workspace-right').boundingBox()};
  console.log('enter stacking',width);
  const denseStarted=Date.now();
  await page.getByRole('link',{name:'Stacking Plan',exact:true}).click();
  await page.getByRole('heading',{name:/CBD甲楼/}).waitFor();
  await page.getByRole('button',{name:/A 座 60层 连续性租户599/}).waitFor();
  const denseReadyMs=Date.now()-denseStarted;
  const denseSearch=page.getByRole('searchbox',{name:'搜索租户、楼层或单元'});
  const filterStarted=Date.now(); await denseSearch.fill('连续性租户59');
  await page.getByRole('status').filter({hasText:'匹配 11 个单元'}).waitFor();
  const denseFilterMs=Date.now()-filterStarted; await denseSearch.fill('');
  await page.getByRole('button',{name:'刷新数据',exact:true}).click();
  await page.getByRole('status').filter({hasText:'正在刷新'}).waitFor();
  assert.equal(await page.getByRole('button',{name:/A 座 60层 连续性租户599/}).count(),1,'refresh retains readable content');
  await page.getByRole('status').filter({hasText:'正在刷新'}).waitFor({state:'detached'});
  failRefresh=true;await page.getByRole('button',{name:'刷新数据',exact:true}).click();
  await page.getByRole('alert').filter({hasText:'隔离测试暂时不可用'}).waitFor();
  assert.equal(await page.getByRole('button',{name:/A 座 60层 连续性租户599/}).count(),1,'refresh error retains content');
  failRefresh=false;
  console.log('edit drawer',width);
  await page.getByRole('button',{name:/A 座 60层 连续性租户599/}).click();
  const drawer=page.getByLabel('租赁单元详情',{exact:true});
  await page.getByRole('button',{name:'编辑信息',exact:true}).click();
  await page.getByLabel('租户 / 用途').fill('未保存回归修改');
  page.once('dialog',dialog=>dialog.dismiss());
  if(width===390) await page.getByRole('button',{name:'关闭详情',exact:true}).click();
  else await page.getByRole('link',{name:'返回项目详情',exact:true}).click();
  assert.ok(page.url().includes('/stacking-plan/'),'cancel keeps edited stacking route');
  assert.equal(await page.getByLabel('租户 / 用途').inputValue(),'未保存回归修改');
  page.once('dialog',dialog=>dialog.dismiss());
  await page.goBack({timeout:1500,waitUntil:'commit'}).catch(error=>{if(!/ERR_ABORTED|Timeout|interrupted|canceled/i.test(error.message))throw error;});
  assert.ok(page.url().includes('/stacking-plan/'),'browser back cancellation keeps draft route');
  assert.equal(await page.getByLabel('租户 / 用途').inputValue(),'未保存回归修改');
  page.once('dialog',dialog=>dialog.accept());
  if(width===390){await page.getByRole('button',{name:'关闭详情',exact:true}).click();await page.waitForTimeout(250);}
  await page.getByRole('link',{name:'返回项目详情',exact:true}).click();
  console.log('return project',width);
  await detail.waitFor();await page.waitForTimeout(400);
  assert.equal(await page.getByRole('tab',{name:'成交与资料',exact:true}).getAttribute('aria-selected'),'true','return restores original detail tab');
  assert.ok(Math.abs(await detail.locator('.workspace-scroll').evaluate(element=>element.scrollTop)-readingScroll)<2,'return restores actual detail scroll on a short phone viewport');
  assert.equal(await page.getByRole('button',{name:'租金',exact:true}).getAttribute('aria-pressed'),'true');
  assert.equal(await page.locator('.map-selected-marker').count(),1);
  assert.deepEqual(await page.evaluate(()=>({zoom:window.__workspaceMap.getZoom(),center:window.__workspaceMap.center})),before.camera,'return restores camera');
  const box=await page.locator('.map-workspace-right').boundingBox();
  assert.ok(Math.abs(box.width-before.box.width)<2&&Math.abs(box.height-before.box.height)<3,'return restores pane width and mobile reading height');
  await page.getByRole('link',{name:'Stacking Plan',exact:true}).click();
  await page.getByRole('heading',{name:/CBD甲楼/}).waitFor();
  // Clear any cached draft after explicitly confirming the previous departure.
  page.on('dialog', dialog => dialog.accept());
  if(width===390 && await page.getByRole('button',{name:'关闭详情',exact:true}).isVisible()) {
    await page.getByRole('button',{name:'关闭详情',exact:true}).click(); await page.waitForTimeout(220);
  }
  await page.getByRole('button',{name:'刷新数据',exact:true}).click();
  for(let round=0;round<2;round++) {
    await page.goBack(); console.log('history back',round,page.url()); await detail.waitFor();
    assert.equal(await page.getByRole('tab',{name:'成交与资料',exact:true}).getAttribute('aria-selected'),'true','browser back restores tab');
    await page.waitForFunction(({top,camera})=>{
      const scroller=document.querySelector('.workspace-building-scroll');
      return scroller&&Math.abs(scroller.scrollTop-top)<2&&window.__workspaceMap.getZoom()===camera.zoom&&JSON.stringify(window.__workspaceMap.center)===JSON.stringify(camera.center);
    },{top:readingScroll,camera:before.camera});
    await page.goForward(); console.log('history forward',round,page.url()); await page.getByRole('heading',{name:/CBD甲楼/}).waitFor();
  }
  await page.goBack(); await detail.waitFor();
  await page.getByRole('button',{name:'返回项目列表',exact:true}).click();
  assert.equal(await list.getByRole('combobox',{name:'项目列表排序'}).inputValue(),'name','return restores source list sorting');
  assert.equal(await list.getByRole('searchbox',{name:'搜索当前项目列表'}).inputValue(),'CBD','return restores source list query');
  await list.getByRole('button',{name:/^选择项目/}).click();
  assert.equal(await list.getByRole('checkbox',{name:'选择CBD乙楼',exact:true}).isChecked(),true,'return restores comparison selection');
  await list.getByRole('button',{name:'完成选择',exact:true}).click();
  // Reopening the same project must refocus after the user has panned in a list.
  await list.getByRole('button',{name:/^CBD甲楼/}).click(); await detail.waitFor();
  await page.getByRole('button',{name:'项目列表',exact:true}).click(); await list.waitFor();
  await page.evaluate(()=>window.__workspaceMap.setCenter([116.2,40.1]));
  await list.getByRole('button',{name:/^CBD甲楼/}).click(); await detail.waitFor(); await page.waitForTimeout(280);
  assert.deepEqual(await page.evaluate(()=>window.__workspaceMap.center),[116.46,39.91],'same project refocuses after a list and manual pan');
  await page.getByRole('button',{name:'项目列表',exact:true}).click(); await list.waitFor();
  // Rapid reversals must settle on the final project without queued camera callbacks.
  await list.getByRole('button',{name:/^CBD乙楼/}).click();
  await page.getByRole('button',{name:'关闭楼宇详情'}).click();
  await page.getByRole('button',{name:'项目列表',exact:true}).click();
  await list.getByRole('button',{name:/^CBD甲楼/}).click();await detail.waitFor();await page.waitForTimeout(300);
  assert.equal(await page.locator('.workspace-building').count(),1);
  await page.evaluate(()=>{
    window.__continuityFrames=[];window.__continuityLongTasks=[];
    if(PerformanceObserver.supportedEntryTypes.includes('longtask')) {
      window.__continuityObserver=new PerformanceObserver(list=>window.__continuityLongTasks.push(...list.getEntries().map(entry=>entry.duration)));
      window.__continuityObserver.observe({type:'longtask'});
    }
    const start=performance.now();let previous=start;
    const frame=now=>{window.__continuityFrames.push(now-previous);previous=now;if(now-start<350)requestAnimationFrame(frame);};requestAnimationFrame(frame);
  });
  const resizeStart=await page.evaluate(()=>window.__workspaceSDK.resized);
  await page.getByRole('button',{name:'关闭楼宇详情'}).click();await page.waitForTimeout(300);
  const resizes=await page.evaluate(start=>window.__workspaceSDK.resized-start,resizeStart);
  assert.ok(resizes<=2,`one panel transition must not resize SDK each animation frame: ${resizes}`);
  await page.waitForTimeout(100);
  const motion=await page.evaluate(()=>{window.__continuityObserver?.disconnect();const frames=window.__continuityFrames.slice(1).sort((a,b)=>a-b);return {frameP95Ms:frames[Math.floor(frames.length*.95)]??null,longTasks:window.__continuityLongTasks};});
  await context.close();
  observations.push({width,reduced,roundTrip:true,readingScroll,sameProjectRefocus:true,refreshRetainsContent:true,dirtyCancel:true,resizeCalls:resizes,dense600ReadyMs:denseReadyMs,dense600FilterMs:denseFilterMs,motion,errors});
  assert.deepEqual(errors,[]);
 }
 console.log(JSON.stringify({environment:'production React + real controller + isolated SDK/data transport',observations}));
} finally {await browser.close();}
