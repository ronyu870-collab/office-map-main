import { verifySelectedRecenter } from './workspace-selected-recenter.mjs';
import assert from 'node:assert/strict';
import { waitForVisibleProject } from './workspace-visible-map.mjs';

export async function verifySupplyMarkers(page, { width, openRegion, supplies, evidencePrefix, live = false }) {
  await openRegion('CBD');
  await page.getByRole('button', { name: '查看全部项目', exact: true }).click();
  const list = page.getByRole('region', { name: '项目列表', exact: true });
  const results=[];
  for (const supply of supplies) {
    console.log(`supply identity ${evidencePrefix} ${width}: ${supply.name}`);
    const row=list.getByRole('button', { name: new RegExp('^' + supply.name) });
    if(live&&width===1536){
      await page.evaluate(()=>window.__liveAmapProbe.markerCalls.length=0);
      await row.hover();
      await page.waitForFunction(id=>window.__liveAmapProbe.markerCalls.some(call=>call.name?.startsWith('future:'+id+':')&&call.method==='setzIndex'&&call.values[0]===999999),supply.id);
      assert.equal(await page.evaluate(()=>window.__liveAmapProbe.markerCalls.some(call=>!call.name?.startsWith('future:')&&call.method==='setzIndex'&&call.values[0]===999999)),false,'future list hover does not highlight a stock label');
      await page.mouse.move(2,2);
      await page.waitForFunction(id=>window.__liveAmapProbe.markerCalls.some(call=>call.name?.startsWith('future:'+id+':')&&call.method==='setzIndex'&&call.values[0]===3100),supply.id);
    }
    await row.click();
    const detail=page.getByRole('region', {name:supply.name+'楼宇详情',exact:true});await detail.waitFor();
    assert.equal(await detail.getAttribute('data-building-id'),supply.building_id??'', 'material identity stays bound to the associated master building');
    await waitForVisibleProject(page,[supply.location_lng,supply.location_lat]);
    if(live) await page.waitForFunction(()=>{
      const box=document.querySelector('.map-selected-marker')?.getBoundingClientRect();
      const map=document.querySelector('#map-container')?.getBoundingClientRect();
      return box&&map&&box.left>=map.left&&box.right<=map.right&&box.top>=map.top&&box.bottom<=map.bottom;
    },null,{timeout:10000});

    for (const [mode,label] of [['default','项目'],['rent','租金'],['vacancy','空置'],['leed','LEED']]) {
      const button=page.getByRole('button',{name:label,exact:true});
      if(await button.isVisible()) await button.click();
      else await page.getByRole('combobox',{name:'地图显示模式',exact:true}).selectOption(mode);
      const glyph=mode==='default'?(supply.status==='pending'?'?':'F'):'–';
      await page.waitForFunction(({glyph,pending})=>{
        const image=document.querySelector('.map-selected-marker__badge');
        const svg=decodeURIComponent(image?.getAttribute('src')??'');
        return image?.complete&&image.naturalWidth===34&&svg.includes('>'+glyph+'</text>')&&svg.includes(pending?'17,2 32,17 17,32 2,17':'17,3 29,10 29,24 17,31 5,24 5,10');
      },{glyph,pending:supply.status==='pending'},{timeout:10000});
      assert.equal(await page.locator('.map-selected-marker').count(),1);
      const currentAction=page.locator('.map-selected-marker').getByRole('button',{name:'定位当前项目：'+supply.name,exact:true});
      const hit=await currentAction.boundingBox();assert.ok(hit?.width>=44&&hit.height>=44,'current marker has a full touch target');
      const originalTab=await detail.getByRole('tab',{selected:true}).textContent();
      await currentAction.focus();await page.keyboard.press('Enter');
      await waitForVisibleProject(page,[supply.location_lng,supply.location_lat]);
      assert.equal(await detail.getByRole('tab',{selected:true}).textContent(),originalTab);
      assert.equal(await detail.getAttribute('data-building-id'),supply.building_id??'');
      if(live) await page.waitForTimeout(350); // Let the SDK commit its normal LabelsLayer canvas too.
      results.push({id:supply.id,mode,glyph,shape:supply.status==='pending'?'diamond':'hexagon',browserDecoded:true,selectedCenterVerified:true,selectedWithinCanvas:live,listHoverPublicSDKVerified:live&&width===1536});
      if(mode==='default'||(width===1536&&mode==='leed')) await page.screenshot({path:`/tmp/${evidencePrefix}-${supply.status==='pending'?'pending':'future'}-${mode}-${width}.png`});
    }
    const modes=page.getByRole('combobox',{name:'地图显示模式',exact:true});
    if(await modes.isVisible()) await modes.selectOption('default');else await page.getByRole('button',{name:'项目',exact:true}).click();
    if(live) results.push(await verifySelectedRecenter(page,{width,id:supply.id,name:supply.name,lng:supply.location_lng,lat:supply.location_lat,evidencePrefix:'map-selected-supply'}));
    await page.getByRole('button',{name:'返回项目列表',exact:true}).click();await list.waitFor();
  }
  await openRegion('CBD');
  if(live) await page.waitForTimeout(800);
  await page.locator('.map-workspace-legend > summary').click();
  const legend=page.locator('.map-disclosure-content');await legend.getByText('待核实项目',{exact:true}).waitFor();
  assert.equal(await legend.getByText('未来供应',{exact:true}).count(),1);
  assert.equal(await legend.getByText('当前项目',{exact:true}).count(),1);
  assert.equal(await legend.evaluate(el=>el.scrollWidth<=el.clientWidth+1),true);
  await page.screenshot({path:`/tmp/${evidencePrefix}-legend-${width}.png`});
  await page.keyboard.press('Escape');
  await legend.waitFor({state:'detached'});
  return {name:'distinct supply identity in all four modes',results,legendMatches:true};
}
