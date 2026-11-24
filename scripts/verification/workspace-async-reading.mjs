import assert from 'node:assert/strict';
import {clickWorkspaceAction} from './workspace-actions.mjs';
export async function verifyAsyncReading(page,{base,width}){
 let releasePhoto;let photoGate=new Promise(resolve=>{releasePhoto=resolve;});let photoNumber=0;
 await page.route('**/api/map/building-photos?*',async route=>{await photoGate;return route.fulfill({json:{url:`https://synthetic.invalid/async-${photoNumber++?'2222':'landscape'}.svg`,is_preview:false,can_download:true,source_url:'',source_name:''}});});
 let releaseMaterial,releaseDetails;const materialGate=new Promise(resolve=>{releaseMaterial=resolve;});const detailsGate=new Promise(resolve=>{releaseDetails=resolve;});
 await page.route('**/api/map/sales-materials?*',async route=>{await (new URL(route.request().url()).searchParams.has('material_id')?detailsGate:materialGate);return route.fallback();});
 await page.goto(new URL('/map?building=10000000-1111-4111-8111-111111111111',base).href);
 const detail=page.getByRole('region',{name:'CBD甲楼楼宇详情',exact:true});await detail.waitFor();
 if(width<640||width===844)await clickWorkspaceAction(page,'全屏阅读工作区');
 const begin=async()=>page.evaluate(()=>{
  const frames=[];let raf=0,active=true;
  const sample=()=>{if(!active)return;const selectors=['.workspace-building','.workspace-building .workspace-panel-header','#map-container','.workspace-building-scroll','.building-pilot-photo-stage','[role="dialog"]'];frames.push({at:performance.now(),geometry:selectors.map(selector=>{const el=document.querySelector(selector);if(!el||!el.getClientRects().length)return null;const r=el.getBoundingClientRect();return {selector,x:Math.round(r.x*10)/10,y:Math.round(r.y*10)/10,w:Math.round(r.width*10)/10,h:Math.round(r.height*10)/10,scroll:el.scrollTop};})});raf=requestAnimationFrame(sample);};raf=requestAnimationFrame(sample);window.__asyncReadingStop=()=>{active=false;cancelAnimationFrame(raf);return frames;};
 });
 const finish=async()=>{await page.evaluate(()=>new Promise(resolve=>{const until=performance.now()+600;const check=()=>performance.now()>=until?resolve():requestAnimationFrame(check);requestAnimationFrame(check);}));return page.evaluate(()=>window.__asyncReadingStop());};
 await detail.getByRole('button',{name:/看图/}).click();await detail.getByRole('status').filter({hasText:'加载'}).waitFor();
 await detail.locator('.building-pilot-photo-stage').scrollIntoViewIfNeeded();await begin();
 await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));releasePhoto();
 await page.waitForFunction(()=>document.querySelector('[data-building-photo]:not([hidden])')?.naturalWidth>0);
 await detail.getByRole('button',{name:'查看大图',exact:true}).waitFor();const photoFrames=await finish();
 photoGate=new Promise(resolve=>{releasePhoto=resolve;});
 await detail.getByRole('button',{name:'下一张',exact:true}).click();await detail.getByRole('status').filter({hasText:'加载'}).waitFor();await begin();
 await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));releasePhoto();
 await page.waitForFunction(()=>document.querySelector('[data-building-photo]:not([hidden])')?.naturalHeight>document.querySelector('[data-building-photo]:not([hidden])')?.naturalWidth);
 await detail.getByRole('button',{name:'查看大图',exact:true}).waitFor();const portraitFrames=await finish();
 await detail.getByRole('tab',{name:'成交与资料',exact:true}).click();await detail.getByRole('button',{name:'楼书与资料',exact:true}).click();
 await page.getByRole('dialog').getByRole('status').waitFor();await begin();
 await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));releaseMaterial();
 await page.waitForRequest(request=>{const url=new URL(request.url());return url.pathname==='/api/map/sales-materials'&&url.searchParams.has('material_id');});
 const materialIndexFrames=await finish();await begin();releaseDetails();
 await page.getByRole('button',{name:'查看原件',exact:true}).waitFor();const materialFrames=await finish();
 const summarize=frames=>{const changes=[];for(const frame of frames){const previous=changes.at(-1);if(!previous||JSON.stringify(frame.geometry)!==JSON.stringify(previous.geometry))changes.push(frame);}return {frames:frames.length,geometryStates:changes,stableTail:frames.at(-1).at-changes.at(-1).at};};
 const result={width,photo:summarize(photoFrames),portrait:summarize(portraitFrames),materialIndex:summarize(materialIndexFrames),materialDetails:summarize(materialFrames)};
 for(const [name,segment] of Object.entries(result)){
  if(name==='width')continue;
  assert.ok(segment.frames>=2,`${name}: observe actual frame delivery across asynchronous content`);
  assert.ok(segment.geometryStates.length<=2,`${name}: one content arrival causes at most one geometry adjustment`);
  assert.ok(segment.stableTail>=500,`${name}: content does not keep stretching after arrival`);
  const maps=segment.geometryStates.map(frame=>frame.geometry.find(rect=>rect?.selector==='#map-container'));
  assert.ok(maps.every(rect=>JSON.stringify(rect)===JSON.stringify(maps[0])),`${name}: SDK canvas remains stable`);
  const headers=segment.geometryStates.map(frame=>frame.geometry.find(rect=>rect?.selector==='.workspace-building .workspace-panel-header'));
  assert.ok(headers.every(rect=>JSON.stringify(rect)===JSON.stringify(headers[0])),`${name}: project title does not jump`);
 }
 return result;
}
