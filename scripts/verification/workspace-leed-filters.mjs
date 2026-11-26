import assert from 'node:assert/strict';

export async function verifyLeedFilters(page,{width,base}) {
  const rows=['Gold','N','未认证','','  ','UNKNOWN'].map((leed_certification,index)=>({id:`leed-filter-${index}`,name:['已认证项目','明确未认证项目','中文未认证项目','缺失认证项目','空白认证项目','未知认证项目'][index],leed_certification,grade:'A',district:'朝阳区',submarket:'CBD',location_lng:116.46+index*.001,location_lat:39.91,building_metrics:[{id:`leed-metric-${index}`,building_id:`leed-filter-${index}`,is_locked:true,is_draft:false,record_year:2026,record_quarter:3,net_effective_rent:146,vacancy_rate:.1,total_area:80000}]}));
  await page.route('**/api/map/data?*',route=>{
    const mode=new URL(route.request().url()).searchParams.get('mode');
    return mode==='future'?route.fulfill({json:{future_supplies:[]}}):mode==='map'?route.fulfill({json:{buildings:rows,display_overrides:[]}}):route.fallback();
  });
  const enterMap=async()=>{
    await page.goto(new URL('/map',base).href);
    await page.waitForFunction(()=>window.__workspaceMap);
    await page.evaluate(()=>{const map=window.__workspaceMap,c=map.getCenter();map.setZoomAndCenter(11,[c.lng,c.lat]);});
  };
  const count=async expected=>{
    await page.waitForFunction(value=>document.querySelectorAll('.map-live-stats .map-metric-number')[2]?.textContent===String(value),expected);
    await page.waitForFunction(value=>document.querySelector('#map-container')?.textContent?.includes(`甲乙级 ${value} 个`),expected);
  };
  const open=async()=>{
    const toggle=page.getByRole('button',{name:'筛选',exact:true});
    if(await toggle.getAttribute('aria-pressed')!=='true')await toggle.click();
    const tools=page.locator('.map-workspace-left .workspace-mobile-tools > summary');
    if(await tools.isVisible()){
      await tools.click();
      const expand=page.getByRole('button',{name:'展开到阅读高度',exact:true});
      if(await expand.isVisible())await expand.click();else await page.keyboard.press('Escape');
    }
    const group=page.getByRole('button',{name:'LEED 认证',exact:true});
    if(await group.getAttribute('aria-expanded')!=='true')await group.click();
    return page.locator(`[id="${await group.getAttribute('aria-controls')}"]`);
  };
  await enterMap();
  let options=await open();await count(6);
  await options.getByRole('checkbox',{name:'全选',exact:true}).uncheck();
  const negative=options.getByRole('checkbox',{name:'未认证（N）',exact:true});
  await negative.focus();await page.keyboard.press('Space');await count(2);
  await page.getByRole('button',{name:'项目列表',exact:true}).click();
  const list=page.getByRole('region',{name:'项目列表',exact:true});await list.waitFor();
  await list.getByText('明确未认证项目',{exact:true}).waitFor();
  await list.getByText('中文未认证项目',{exact:true}).waitFor();
  assert.equal(await list.getByText('已认证项目',{exact:true}).count(),0);
  await page.waitForFunction(()=>!document.querySelector('.map-workspace-layout [data-exiting]'));
  await page.screenshot({animations:'disabled',path:`/tmp/map-leed-negative-${width}.png`});
  await list.getByRole('button',{name:'关闭列表',exact:true}).click();
  options=await open();
  await options.getByRole('checkbox',{name:'未认证（N）',exact:true}).uncheck();
  await options.getByRole('checkbox',{name:'未提供认证',exact:true}).check();await count(3);
  await options.getByRole('checkbox',{name:'全选',exact:true}).check();await count(6);
  await options.getByRole('checkbox',{name:'未认证（N）',exact:true}).uncheck();await count(4);
  // New-version explicit exclusion must survive a fresh map entry.
  await enterMap();options=await open();await count(4);
  assert.equal(await options.getByRole('checkbox',{name:'未认证（N）',exact:true}).isChecked(),false);
  await page.evaluate(()=>{
    const key=Object.keys(sessionStorage).find(key=>key.startsWith('broker-map:v1:'));
    const saved=JSON.parse(sessionStorage.getItem(key));
    assertVersion(saved);
    function assertVersion(value){if(value.leedCatalogVersion!==2)throw new Error('current filter catalog version not saved');}
    delete saved.leedCatalogVersion;
    sessionStorage.setItem(key,JSON.stringify(saved));
  });
  // The same four values in an old unversioned full catalog meant all options.
  await enterMap();options=await open();await count(6);
  assert.equal(await options.getByRole('checkbox',{name:'未认证（N）',exact:true}).isChecked(),true);
  await page.waitForFunction(()=>!document.querySelector('.map-workspace-layout [data-exiting]'));
  await page.screenshot({animations:'disabled',path:`/tmp/map-leed-restored-${width}.png`});
  return {width,defaultIncludesUncertified:true,negativeOnly:2,unavailableOnly:3,currentExclusionRetained:4,legacyFullCatalogUpgraded:6};
}
