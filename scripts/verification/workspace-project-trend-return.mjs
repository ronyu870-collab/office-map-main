import assert from 'node:assert/strict';
import { stock, project, stacking, user } from '../performance/fixtures/workspace-data.mjs';
import { clickWorkspaceAction } from './workspace-actions.mjs';

export async function verifyProjectTrendReturn(page,{width,base}) {
  await page.route('https://example.supabase.co/rest/v1/user_roles*',route=>route.fulfill({headers:{'access-control-allow-origin':'*','access-control-allow-headers':'*','access-control-allow-methods':'GET, OPTIONS'},json:[{role:'admin',session_id:user.id}]}));
  let trendReads=0;
  await page.route('**/api/map/data?*',async route=>{
    const mode=new URL(route.request().url()).searchParams.get('mode');
    if(mode==='trend' && ++trendReads>1)await page.waitForFunction(()=>(window.__trendReturnFrames?.length || 0)>=8);
    if(mode==='trend')return route.fulfill({json:{metrics:[[2026,3,200,.12],[2025,4,160,.1],[2024,4,null,null],[2023,4,0,0],[2022,4,null,null],[2021,4,180,.11]].map(([record_year,record_quarter,net_effective_rent,vacancy_rate])=>({record_year,record_quarter,net_effective_rent,vacancy_rate}))}});
    return mode==='future'?route.fulfill({json:{future_supplies:[]}}):mode==='map'?route.fulfill({json:{buildings:stock,display_overrides:[]}}):route.fallback();
  });
  await page.route(`**/api/stacking-plan/${project}`,route=>route.fulfill({json:stacking}));
  await page.goto(new URL(`/map?building=${project}`,base).href);
  const detail=page.getByRole('region',{name:'CBD甲楼楼宇详情',exact:true});await detail.waitFor();
  if(width<640||width===844)await clickWorkspaceAction(page,'全屏阅读工作区');
  await detail.getByRole('tab',{name:'行情',exact:true}).click();
  await detail.getByRole('button',{name:'季度趋势',exact:true}).click();
  const chart=detail.getByRole('region',{name:'项目历史趋势',exact:true});
  await chart.locator('canvas').waitFor();
  await chart.getByRole('button',{name:'空置率',exact:true}).click();
  const disclosure=chart.locator('.workspace-trend-data');await disclosure.locator('summary').click();
  await chart.getByRole('table').getByRole('row').last().scrollIntoViewIfNeeded();
  const geometry=()=>{const root=document.querySelector('.workspace-building'),scroll=root.querySelector('.workspace-scroll'),host=root.querySelector('#info-chart-panel').parentElement;return {scrollHeight:scroll.scrollHeight,clientHeight:scroll.clientHeight,hostHeight:host.getBoundingClientRect().height,busy:host.getAttribute('aria-busy'),minHeight:host.style.minHeight};};
  const beforeGeometry=await page.evaluate(geometry);
  const before={metric:await chart.getByRole('button',{name:'空置率',exact:true}).getAttribute('aria-pressed'),tableOpen:await disclosure.evaluate(node=>node.open),scroll:await detail.locator('.workspace-scroll').evaluate(node=>node.scrollTop)};
  const materialTab=detail.getByRole('tab',{name:'成交与资料',exact:true});
  const tabRect=await materialTab.boundingBox(),scrollRect=await detail.locator('.workspace-scroll').boundingBox();
  assert.ok(tabRect.y>=scrollRect.y-1 && tabRect.y+tabRect.height<=scrollRect.y+scrollRect.height+1,'tabs remain available while reading the period table');
  await materialTab.click();
  await detail.getByRole('link',{name:'Stacking Plan',exact:true}).click();
  await page.getByRole('button',{name:/A 座 60层 连续性租户599/}).waitFor();
  await page.getByRole('link',{name:'返回项目详情',exact:true}).click();await detail.waitFor();
  await page.evaluate(()=>{window.__trendReturnFrames=[];let left=45;const sample=()=>{const root=document.querySelector('.workspace-building');if(root?.querySelector('[role=tab][aria-selected=true]')?.textContent==='行情')window.__trendReturnFrames.push({scroll:root.querySelector('.workspace-scroll').scrollTop,scrollHeight:root.querySelector('.workspace-scroll').scrollHeight,clientHeight:root.querySelector('.workspace-scroll').clientHeight,hostHeight:root.querySelector('#info-chart-panel').parentElement.getBoundingClientRect().height,ready:!!root.querySelector('#info-chart-container canvas')});if(--left)requestAnimationFrame(sample);};requestAnimationFrame(sample);});
  await detail.getByRole('tab',{name:'行情',exact:true}).click();
  await chart.locator('canvas').waitFor();await disclosure.waitFor({state:'attached'});
  await page.waitForFunction(()=>!document.querySelector('.map-workspace-layout [data-exiting]'));
  await page.waitForFunction(()=>window.__trendReturnFrames?.some(frame=>frame.ready));
  const frames=await page.evaluate(()=>window.__trendReturnFrames);
  const after={metric:await chart.getByRole('button',{name:'空置率',exact:true}).getAttribute('aria-pressed'),tableOpen:await disclosure.evaluate(node=>node.open),scroll:await detail.locator('.workspace-scroll').evaluate(node=>node.scrollTop)};
  // Capture the completed chart separately from the normal-motion first-frame check.
  await page.emulateMedia({reducedMotion:'reduce'});
  await page.waitForFunction(()=>{const pixels=document.querySelector('#info-chart-container canvas')?.toDataURL(),previous=window.__returnChartPixels;if(!previous || previous.pixels!==pixels){window.__returnChartPixels={pixels,since:performance.now()};return false;}return performance.now()-previous.since>=200;});
  await page.screenshot({animations:'disabled',path:`/tmp/map-project-trend-return-${width}.png`});
  console.log('trend return observation',JSON.stringify({width,before,after,frames:frames.length,positions:[...new Set(frames.map(frame=>frame.scroll))]}));
  assert.ok(frames.length>=8 && frames.every(frame=>Math.abs(frame.scroll-before.scroll)<3),'return keeps reading position from the first market frame through async chart arrival');
  assert.equal(after.metric,'true','selected vacancy metric survives Stacking round trip');
  assert.equal(after.tableOpen,true,'expanded period table survives Stacking round trip');
  assert.ok(Math.abs(after.scroll-before.scroll)<3,'market reading position is restored with the expanded table');
  return {width,before,after,frames,beforeGeometry,afterGeometry:await page.evaluate(geometry)};
}
