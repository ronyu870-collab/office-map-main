import { waitForVisibleProject } from './workspace-visible-map.mjs';
import { clickWorkspaceAction } from './workspace-actions.mjs';
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
  const stats = window.__workspaceSDK = { created: 0, resized: 0, centers: [], initialCameras: [], nativeOpens: 0 };
  window.AMap.Bounds = class { constructor(southwest, northeast) { this.southwest = southwest; this.northeast = northeast; } };
  window.AMap.Map = class extends BaseMap {
    constructor(id, options) { super(id, options); stats.created++; this.zoom = options.zoom; this.center = options.center; stats.initialCameras.push({ zoom: options.zoom, center: options.center }); window.__workspaceMap = this; this.host = document.getElementById(id); }
    getContainer() { return this.host; }
    setCenter(center) { this.center = Array.isArray(center) ? center : [center.getLng?.() ?? center.lng, center.getLat?.() ?? center.lat]; stats.centers.push(this.center); }
    setBounds(bounds) { this.center = bounds.southwest.map((value, index) => (value + bounds.northeast[index]) / 2); }
    resize() { stats.resized++; }
    panBy() {}
  };
  const Popup = window.AMap.InfoWindow;
  window.AMap.InfoWindow = class extends Popup { open(...args) { stats.nativeOpens++; super.open(...args); } };
}

const chainPhoto = { id: 'b04ed43e-bf3a-4d63-919e-c44d60d4fe75', caption: '任务链外观' };
const chainStock = stock.map(row => row.id === project ? { ...row, photos: [chainPhoto] } : row);
async function keyboardReach(page, target) {
  await target.waitFor({ state: 'visible' });
  for (let count = 0; count < 160; count++) {
    if (await target.evaluate(element => element === document.activeElement)) return;
    await page.keyboard.press('Tab');
  }
  throw new Error('Keyboard could not reach: ' + await target.innerText());
}
async function keyboardActivate(page, target) {
  await keyboardReach(page, target); await page.keyboard.press('Enter');
}
const observations = [];
try {
 for (const [width, reduced] of [[1536,false],[390,false],[390,true]]) {
  const context = await browser.newContext({viewport:{width,height:width===390?560:900},reducedMotion:reduced?'reduce':'no-preference',serviceWorkers:'block'});
  let stackReads=0, failRefresh=false, emptyStock=false;
  const errors=[];
  await context.routeWebSocket(/.*/, socket=>socket.close());
  await context.route('**/*', async route=>{
   const url=new URL(route.request().url());
   if(url.origin===base.origin){
    if(url.pathname==='/api/map/data')return route.fulfill({json:url.searchParams.get('mode')==='future'?{future_supplies:future}:{buildings:emptyStock?[]:chainStock,display_overrides:[]}});
    if(url.pathname===`/api/stacking-plan/${project}`){ stackReads++; if(stackReads>1)await new Promise(resolve=>setTimeout(resolve,350)); return route.fulfill({status:failRefresh?503:200,json:failRefresh?{error:'隔离测试暂时不可用'}:stacking}); }
    if(url.pathname==='/api/map/submarket')return route.fulfill({json:{submarket:'CBD',stockCount:3,profileAvailable:false,trends:{all:[],a:[],b:[]}}});
    if(url.pathname==='/api/map/building-photos') {
      assert.equal(url.searchParams.get('building_id'),project);
      assert.equal(url.searchParams.get('photo_id'),chainPhoto.id);
      return route.fulfill({json:{url:'https://synthetic.invalid/task-chain.svg',is_preview:false,can_download:true,source_url:'',source_name:''}});
    }
    if(url.pathname==='/api/map/sales-materials') {
      assert.equal(url.searchParams.get('building_id'),project);
      const material={id:'chain-material',title:'任务链项目资料',source:'隔离业主',notes:'',original_name:'owner.png',mime_type:'image/png',file_size:1,document_date:null,created_at:'2026-11-21T00:00:00Z',content_types:['brochure']};
      return route.fulfill({json:url.searchParams.has('material_id')?{details:[],project_facts:[],preview_url:'https://synthetic.invalid/task-chain.svg',download_url:'',provenance:{document_date_evidence:'',received:null,version_recorded_at:material.created_at,source_sha256:'a'.repeat(64)}}:{records:[material],count:1}});
    }
    if(url.pathname.startsWith('/api/'))return route.fulfill({status:204});
    return route.continue();
   }
   if(url.origin==='https://synthetic.invalid')return route.fulfill({contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="700"><rect width="1200" height="700" fill="#c5d4dd"/></svg>'});
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
  const filters = page.locator('.map-workspace-filter');
  if (await filters.getAttribute('aria-hidden') === 'true') await page.getByRole('button', { name: '筛选', exact: true }).click();
  await filters.getByRole('button', { name: '项目对比筛选', exact: true }).click();
  await filters.getByRole('button', { name: '添加筛选组', exact: true }).click();
  const groupToggle = filters.getByRole('button', { name: '组1', exact: true });
  const groupPanel = page.locator(`[id="${await groupToggle.getAttribute('aria-controls')}"]`);
  await groupPanel.getByRole('checkbox', { name: 'CBD', exact: true }).check();
  await page.getByText('项目对比组 1', { exact: true }).waitFor();
  await filters.getByRole('button', { name: '关闭筛选', exact: true }).click();
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
  if(width===390)await clickWorkspaceAction(page, '展开到阅读高度');
  if(width===1536)await page.getByRole('separator',{name:'调整业务工作区宽度'}).press('End');
  await page.waitForTimeout(260);
  const stackLink = page.getByRole('link',{name:'Stacking Plan',exact:true});
  await stackLink.scrollIntoViewIfNeeded(); await page.waitForTimeout(80);
  const readingScroll = await detail.locator('.workspace-scroll').evaluate(element=>element.scrollTop);
  const before={camera:await page.evaluate(()=>({zoom:window.__workspaceMap.getZoom(),center:window.__workspaceMap.center})),box:await page.locator('.map-workspace-right').boundingBox()};
  if(width===1536){
    const opened=context.waitForEvent('page');
    await stackLink.evaluate(anchor=>{ anchor.dispatchEvent(new MouseEvent('auxclick',{bubbles:true,button:1})); window.open(anchor.href,'_blank'); });
    const other=await opened; other.on('pageerror',error=>errors.push(error.message));
    await other.getByRole('link',{name:'返回项目详情',exact:true}).waitFor();
    await other.getByRole('link',{name:'返回项目详情',exact:true}).click();
    await other.getByRole('region',{name:'CBD甲楼楼宇详情'}).waitFor();
    assert.equal(await other.getByRole('tab',{name:'成交与资料'}).getAttribute('aria-selected'),'true','auxclick snapshot and new tab carry the return reading context');
    await other.close();
  }
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
  assert.equal(await page.getByText('项目对比组 1', { exact: true }).count(), 1, 'Stacking return retains the configured map comparison group');
  assert.equal(await page.getByRole('tab',{name:'成交与资料',exact:true}).getAttribute('aria-selected'),'true','return restores original detail tab');
  assert.ok(Math.abs(await detail.locator('.workspace-scroll').evaluate(element=>element.scrollTop)-readingScroll)<2,'return restores actual detail scroll on a short phone viewport');
  assert.equal(await page.getByRole('button',{name:'租金',exact:true}).getAttribute('aria-pressed'),'true');
  assert.equal(await page.locator('.map-selected-marker').count(),1);
  assert.deepEqual(await page.evaluate(()=>({zoom:window.__workspaceMap.getZoom(),center:window.__workspaceMap.center})),before.camera,'return restores camera');
  assert.deepEqual(await page.evaluate(()=>window.__workspaceSDK.initialCameras.at(-1)),before.camera,'return constructs at saved camera without rendering a default city view first');
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
    await page.getByText('项目对比组 1', { exact: true }).waitFor();
    assert.equal(await page.getByRole('tab',{name:'成交与资料',exact:true}).getAttribute('aria-selected'),'true','browser back restores tab');
    await page.waitForFunction(({top,camera})=>{
      const scroller=document.querySelector('.workspace-building-scroll');
      return scroller&&Math.abs(scroller.scrollTop-top)<2&&window.__workspaceMap.getZoom()===camera.zoom&&JSON.stringify(window.__workspaceMap.center)===JSON.stringify(camera.center);
    },{top:readingScroll,camera:before.camera});
    assert.deepEqual(await page.evaluate(()=>window.__workspaceSDK.initialCameras.at(-1)),before.camera,'history return also initializes at saved camera');
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
  await waitForVisibleProject(page,[116.46,39.91]);
  // Repeated selection while the same detail remains open must also refocus.
  await page.evaluate(()=>window.__workspaceMap.setCenter([116.2,40.1]));
  await clickWorkspaceAction(page, '定位当前项目');
  await waitForVisibleProject(page,[116.46,39.91]);
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
  // One continuous region -> keyboard search -> project -> photo -> original
  // material -> Stacking -> return -> close run, rather than isolated entrances.
  console.log('keyboard complete task chain',width,reduced);
  await page.evaluate(()=>window.dispatchEvent(new CustomEvent('map-submarket-open',{detail:{name:'CBD'}})));
  await page.getByRole('region',{name:'CBD',exact:true}).waitFor();
  const search=page.getByRole('searchbox',{name:'搜索楼宇、子市场、业主或物业'});
  await keyboardReach(page,search); await page.keyboard.type('CBD甲楼');
  const candidates=page.getByRole('region',{name:'项目搜索候选'});
  await keyboardActivate(page,candidates.getByRole('button',{name:/^CBD甲楼/}));
  await detail.waitFor();
  await keyboardReach(page,detail.locator('[role="tab"][aria-selected="true"]'));
  for(let step=0;step<3 && await detail.getByRole('tab',{name:'概览',exact:true}).getAttribute('aria-selected')!=='true';step++) await page.keyboard.press('ArrowRight');
  const photo=detail.getByRole('button',{name:/看图 · 1张/});
  await keyboardActivate(page,photo);
  const image=detail.locator('[data-building-photo]:visible');
  await image.waitFor(); await page.waitForFunction(()=>document.querySelector('[data-building-photo]:not([hidden])')?.naturalWidth>0);
  await keyboardActivate(page,detail.getByRole('button',{name:'查看大图',exact:true}));
  await detail.getByRole('dialog').waitFor();
  await page.keyboard.press('Escape');
  assert.ok(await detail.getByRole('button',{name:'查看大图',exact:true}).evaluate(el=>el===document.activeElement),'photo returns keyboard focus');
  await keyboardReach(page,detail.getByRole('tab',{name:'概览',exact:true}));
  await page.keyboard.press('ArrowRight'); await page.keyboard.press('ArrowRight');
  assert.equal(await detail.getByRole('tab',{name:'成交与资料',exact:true}).getAttribute('aria-selected'),'true');
  const materialTrigger=detail.getByRole('button',{name:'楼书与资料',exact:true});
  await keyboardActivate(page,materialTrigger);
  const materials=page.getByRole('dialog');
  await keyboardActivate(page,materials.getByRole('button',{name:'查看原件',exact:true}));
  await materials.getByAltText('任务链项目资料',{exact:true}).waitFor();
  await keyboardActivate(page,materials.getByRole('button',{name:'返回项目资料',exact:true}));
  await page.keyboard.press('Escape');
  await materials.waitFor({state:'detached'});
  assert.ok(await materialTrigger.evaluate(el=>el===document.activeElement),'materials returns keyboard focus');
  await keyboardActivate(page,detail.getByRole('link',{name:'Stacking Plan',exact:true}));
  await page.getByRole('button',{name:/A 座 60层 连续性租户599/}).waitFor();
  await keyboardActivate(page,page.getByRole('link',{name:'返回项目详情',exact:true}));
  await detail.waitFor();
  assert.equal(await detail.getByRole('tab',{name:'成交与资料',exact:true}).getAttribute('aria-selected'),'true');
  assert.equal(await detail.getAttribute('data-building-id'),project);
  assert.equal(await detail.getByRole('heading',{name:/^CBD甲楼/}).evaluate(node=>node===document.activeElement),true,'Stacking return restores the visible project reading focus');
  // Exercise native history while a real submarket filter is active, separately
  // from the comparison-group-only return earlier in this run.
  const regionReading = await detail.locator('.workspace-scroll').evaluate(element=>element.scrollTop);
  const regionCamera = await page.evaluate(()=>({zoom:window.__workspaceMap.getZoom(),center:window.__workspaceMap.center}));
  for(let round=0;round<2;round++) {
    await page.goBack();
    await page.getByRole('heading',{name:/CBD甲楼/}).waitFor();
    assert.ok(new URL(page.url()).pathname.startsWith('/stacking-plan/'), 'regional history back enters its actual Stacking layer');
    await page.goForward(); await detail.waitFor();
    assert.equal(await detail.getAttribute('data-building-id'),project);
    assert.equal(await detail.getByRole('tab',{name:'成交与资料',exact:true}).getAttribute('aria-selected'),'true');
    await page.waitForFunction(({top,camera})=>{
      const scroll=document.querySelector('.workspace-building-scroll');
      return scroll&&Math.abs(scroll.scrollTop-top)<2&&window.__workspaceMap.getZoom()===camera.zoom&&JSON.stringify(window.__workspaceMap.center)===JSON.stringify(camera.center);
    },{top:regionReading,camera:regionCamera});
    assert.deepEqual(await page.evaluate(()=>window.__workspaceSDK.initialCameras.at(-1)),regionCamera,'regional forward initializes at the saved camera');
    assert.equal(await detail.getByRole('heading',{name:/^CBD甲楼/}).evaluate(node=>node===document.activeElement),true,'history forward restores visible project focus');
  }
  await page.screenshot({path:`/tmp/map-task-chain-return-${width}-${reduced}.png`});
  await keyboardActivate(page,detail.getByRole('button',{name:'关闭楼宇详情',exact:true}));
  assert.equal(await page.locator('.map-workspace-right').getAttribute('aria-hidden'),'true');
  await keyboardReach(page,search); await page.keyboard.press('ControlOrMeta+A'); await page.keyboard.press('Backspace');
  await keyboardActivate(page,page.getByRole('button',{name:'项目列表',exact:true}));
  await list.getByRole('button',{name:/^CBD乙楼/}).waitFor();
  assert.equal(await list.getByRole('button',{name:/^中关村楼/}).count(),0,'closing the full task preserves CBD');
  await page.screenshot({path:`/tmp/map-task-chain-close-${width}-${reduced}.png`});
  await keyboardActivate(page,list.getByRole('button',{name:'关闭列表',exact:true}));
  if(width===1536){
    await page.getByRole('button',{name:'未来供应',exact:true}).click();
    await page.getByRole('button',{name:'CBD未来楼',exact:true}).click();
    await page.getByRole('region',{name:'CBD未来楼楼宇详情'}).waitFor();
    await page.getByRole('tab',{name:'项目资料'}).click();
    await page.evaluate(()=>window.dispatchEvent(new Event('map-workspace-save-return')));
    emptyStock=true;
    await page.reload();
    await page.getByRole('region',{name:'CBD未来楼楼宇详情'}).waitFor();
    assert.equal(await page.getByRole('tab',{name:'项目资料'}).getAttribute('aria-selected'),'true','future-only return retains the reading tab');
    assert.equal(await page.getByText('地图加载失败',{exact:true}).count(),0,'valid empty stock is not a data failure');
  }
  await context.close();
  observations.push({width,reduced,roundTrip:true,keyboardTaskChain:true,regionPreservedAfterChain:true,regionHistoryRoundTrips:2,regionHistoryReadingScroll:regionReading,readingScroll,sameProjectRefocus:true,refreshRetainsContent:true,dirtyCancel:true,resizeCalls:resizes,dense600ReadyMs:denseReadyMs,dense600FilterMs:denseFilterMs,motion,errors});
  assert.deepEqual(errors,[]);
 }
 console.log(JSON.stringify({environment:'production React + real controller + isolated SDK/data transport',observations}));
} finally {await browser.close();}
