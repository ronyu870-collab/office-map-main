import assert from 'node:assert/strict';

export async function verifyFutureConditions(page,{width,stock,future}) {
  const pane=page.locator('.map-workspace-filter');
  const count=expected=>page.waitForFunction(value=>document.querySelectorAll('.map-live-stats .map-metric-number')[2]?.textContent===String(value),expected);
  const capture=async path=>{
    await page.waitForFunction(()=>!document.querySelector('.map-workspace-layout [data-exiting]'));
    await page.screenshot({animations:'disabled',path});
  };
  const mapSupplies=expected=>page.waitForFunction(value=>document.querySelectorAll('#map-container .map-future-supply-marker').length===value,expected);
  const showFilters=async()=>{
    const filterToggle=page.getByRole('button',{name:'筛选',exact:true});
    if(await filterToggle.getAttribute('aria-pressed')!=='true') await filterToggle.click();
    if(width<1000){
      await page.locator('.map-workspace-left .workspace-mobile-tools > summary').click();
      const expand=page.getByRole('button',{name:'展开到阅读高度',exact:true});
      if(await expand.isVisible()) await expand.click();else await page.keyboard.press('Escape');
    }
  };
  const checkCalendar=async total=>{
    const filterToggle=page.getByRole('button',{name:'筛选',exact:true});
    if(await filterToggle.getAttribute('aria-pressed')==='true') await pane.getByRole('button',{name:'关闭筛选',exact:true}).click();
    const calendar=page.getByRole('region',{name:'未来供应',exact:true});
    const toggle=page.getByRole('button',{name:'未来供应',exact:true});
    if(await toggle.getAttribute('aria-pressed')!=='true') await toggle.click();
    await calendar.locator('.workspace-panel-subtitle').filter({hasText:new RegExp(`^${total} 个项目$`)}).waitFor();
    if(!total) assert.equal(await calendar.getByRole('button',{name:new RegExp('^'+future[0].name)}).count(),0);
  };
  console.log(`future conditions ${width}: starting`);
  await showFilters();
  const group=pane.getByRole('button',{name:'多重筛选',exact:true});
  if(await group.getAttribute('aria-expanded')!=='true') await group.click();
  const add=pane.getByRole('button',{name:'添加条件',exact:true});
  await add.click();
  await pane.getByRole('combobox',{name:'第1项筛选字段',exact:true}).selectOption('total_area');
  await pane.getByRole('combobox',{name:'第1项比较方式',exact:true}).selectOption('<=');
  const area=pane.getByRole('spinbutton',{name:'第1项筛选数值',exact:true});
  await area.fill('80000');await count(2);await mapSupplies(2);
  await page.getByRole('button',{name:'项目列表',exact:true}).click();
  const list=page.getByRole('region',{name:'项目列表',exact:true});await list.waitFor();
  for(const row of future) assert.equal(await list.getByRole('button',{name:new RegExp('^'+row.name)}).count(),1);
  assert.equal(await list.getByRole('button',{name:new RegExp('^'+stock[0].name)}).count(),0);
  await capture(`/tmp/map-future-filter-area-${width}.png`);
  await checkCalendar(1);console.log(`future conditions ${width}: area and calendar match`);
  await showFilters();
  await add.click();
  await pane.getByRole('spinbutton',{name:'第2项筛选数值',exact:true}).fill('0');
  await count(0);await mapSupplies(0);
  await checkCalendar(0);console.log(`future conditions ${width}: missing rent excluded`);
  await page.getByRole('button',{name:'项目列表',exact:true}).click();
  await list.getByText('当前地图筛选无匹配项目',{exact:true}).waitFor();
  await list.getByRole('button', { name: '调整地图筛选', exact: true }).waitFor();
  await capture(`/tmp/map-future-filter-missing-${width}.png`);
  await showFilters();
  await pane.getByRole('button',{name:'移除第2项筛选条件',exact:true}).click();
  await count(2);await mapSupplies(2);
  await pane.getByRole('combobox',{name:'第1项比较方式',exact:true}).selectOption('=');
  await area.fill('0');await count(0);await mapSupplies(0);
  await pane.getByRole('combobox',{name:'第1项比较方式',exact:true}).selectOption('<=');
  await area.fill('80000');await count(2);await mapSupplies(2);
  await add.click();
  await pane.getByRole('combobox',{name:'第2项筛选字段',exact:true}).selectOption('owner');
  await pane.getByRole('textbox',{name:'第2项筛选文字',exact:true}).fill(stock[0].owner);
  await count(0);await mapSupplies(0);
  await pane.getByRole('button',{name:'移除第1项筛选条件',exact:true}).click();
  await count(1);await mapSupplies(0);
  await add.click();
  await pane.getByRole('combobox',{name:'第2项筛选字段',exact:true}).selectOption('property_management');
  await pane.getByRole('textbox',{name:'第2项筛选文字',exact:true}).fill(stock[0].property_management);
  await count(1);await mapSupplies(0);
  await page.getByRole('button',{name:'清空',exact:true}).click();
  await count(5);await mapSupplies(2);
  if(await list.isVisible()) await list.getByRole('button',{name:'关闭列表',exact:true}).click();
  if(await group.getAttribute('aria-expanded')==='true') await group.click();
  if(width<1000){
    await page.locator('.map-workspace-left .workspace-mobile-tools > summary').click();
    await page.getByRole('button',{name:'收起为摘要',exact:true}).click();
  }
  return {width,plannedAreaMatchesTwoSupplies:true,missingRentDoesNotMatchZero:true,ownerAndPropertyConstrainSupplies:true,mapListCountAgree:true,supplyCalendarMatchesConditions:true,clearAllRestoresFive:true};
}
