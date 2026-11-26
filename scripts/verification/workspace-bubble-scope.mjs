import assert from 'node:assert/strict';

export async function verifyBubbleScope(page,{width,base}) {
  const rows=[['a','筛选甲楼',100,.1],['b','筛选乙楼',300,.3]].map(([id,name,rent,vacancy],index)=>({
    id:`scope-${id}`,name,submarket:'CBD',district:'朝阳区',grade:'A',leed_certification:'Gold',
    location_lng:116.46+index*.01,location_lat:39.91,
    building_metrics:[{id:`scope-metric-${id}`,building_id:`scope-${id}`,is_locked:true,is_draft:false,record_year:2026,record_quarter:3,
      net_effective_rent:rent,vacancy_rate:vacancy,total_area:100000,vacant_area:vacancy*100000}],
  }));
  await page.route('**/api/map/data?*',route=>{
    const mode=new URL(route.request().url()).searchParams.get('mode');
    return mode==='future'?route.fulfill({json:{future_supplies:[]}}):mode==='map'?route.fulfill({json:{buildings:rows,display_overrides:[]}}):route.fallback();
  });
  await page.goto(new URL('/map',base).href);
  await page.waitForFunction(()=>window.__workspaceMap);
  await page.evaluate(()=>{const map=window.__workspaceMap,c=map.getCenter();map.setZoomAndCenter(11,[c.lng,c.lat]);});
  const count=expected=>page.waitForFunction(value=>document.querySelectorAll('.map-live-stats .map-metric-number')[2]?.textContent===String(value),expected);
  const bubble=async(count,rent,vacancy)=>{
    await page.waitForFunction(({count,rent,vacancy})=>{
      const text=document.querySelector('#map-container')?.textContent??'';
      return text.includes(`甲乙级 ${count} 个`)&&text.includes(`¥${rent}.0`)&&text.includes(`${vacancy}.0%`);
    },{count,rent,vacancy});
  };
  await count(2);await bubble(2,200,20);
  const search=page.getByRole('searchbox',{name:'搜索楼宇、子市场、业主或物业',exact:true});
  await search.fill('筛选甲楼');await count(1);await bubble(1,100,10);
  await page.getByRole('button',{name:'项目列表',exact:true}).click();
  const list=page.getByRole('region',{name:'项目列表',exact:true});await list.waitFor();
  await list.getByRole('button',{name:/^筛选甲楼/}).waitFor();
  assert.equal(await list.getByRole('button',{name:/^筛选乙楼/}).count(),0);
  await page.waitForFunction(()=>!document.querySelector('.map-workspace-layout [data-exiting]'));
  await page.screenshot({animations:'disabled',path:`/tmp/map-bubble-scope-filtered-${width}.png`});
  await search.fill('筛选乙楼');await count(1);await bubble(1,300,30);
  if(!await list.isVisible())await page.getByRole('button',{name:'项目列表',exact:true}).click();
  await list.getByRole('button',{name:/^筛选乙楼/}).waitFor();
  assert.equal(await list.getByRole('button',{name:/^筛选甲楼/}).count(),0);
  await search.fill('完全无结果');await count(0);
  await page.waitForFunction(()=>!document.querySelector('#map-container')?.textContent?.includes('甲乙级'));
  await search.fill('');await count(2);await bubble(2,200,20);
  if(await list.isVisible())await list.getByRole('button',{name:'关闭列表',exact:true}).click();
  await page.waitForFunction(()=>!document.querySelector('.map-workspace-layout [data-exiting]'));
  await page.screenshot({animations:'disabled',path:`/tmp/map-bubble-scope-restored-${width}.png`});
  return {width,default:{count:2,rent:200,vacancy:20},filteredA:{count:1,rent:100,vacancy:10},filteredB:{count:1,rent:300,vacancy:30},emptyRemovedBubble:true,clearRestoredOverview:true,mapListTopAgree:true};
}
