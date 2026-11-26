import assert from 'node:assert/strict';
import { stock, project } from '../performance/fixtures/workspace-data.mjs';
import { clickWorkspaceAction } from './workspace-actions.mjs';

export async function verifyRelatedReading(page,{width,base}) {
  const name='国际商务中心长项目名称与楼座信息'.repeat(3);
  const company='国际科技与专业服务集团（北京）有限公司'.repeat(3);
  const row={read_id:'history-one',record_source:'history',building_match_scope:'project',company,industry:'专业服务',sub_industry:'商业咨询',demand_type:'新租',area_sqm:2000,face_rent:100,effective_rent:0,lease_term_months:36,transaction_year:2025,transaction_quarter:'Q4',remarks:'历史成交条件；不得当作当前报价。'.repeat(4),agency_company:'隔离经纪公司',agency_person:'隔离人员'};
  const missing={...row,read_id:'live-missing',record_source:'live',building_match_scope:'exact',company:null,area_sqm:null,face_rent:null,effective_rent:null,transaction_year:null,transaction_quarter:null,remarks:null};
  let reads=0;
  await page.route('**/api/map/data?*',route=>new URL(route.request().url()).searchParams.get('mode')==='future'?route.fulfill({json:{future_supplies:[]}}):route.fulfill({json:{buildings:stock.map(item=>item.id===project?{...item,name}:item),display_overrides:[]}}));
  await page.route('**/api/lease-transactions/read?*',route=>{
    const url=new URL(route.request().url());assert.equal(url.searchParams.get('building_id'),project);assert.equal(url.searchParams.get('limit'),'50');reads++;
    const next=url.searchParams.get('offset')==='50';if(next)assert.equal(url.searchParams.get('include_count'),'0');
    return route.fulfill({json:{count:next?undefined:51,records:next?[{...row,read_id:'last',company:'第二页成交'}]:[row,missing,...Array.from({length:48},(_,index)=>({...row,read_id:`other-${index}`,company:`隔离成交 ${index+3}`}))]}});
  });
  await page.goto(new URL(`/map?building=${project}`,base).href);
  const detail=page.getByRole('region',{name:`${name}楼宇详情`,exact:true});await detail.waitFor();
  if(width<640||width===844)await clickWorkspaceAction(page,'全屏阅读工作区');
  await detail.getByRole('tab',{name:'成交与资料',exact:true}).click();
  const trigger=detail.getByRole('button',{name:'关联成交',exact:true});await trigger.click();
  const dialog=page.getByRole('dialog',{name:`${name}关联成交`,exact:true});await dialog.waitFor();
  await dialog.getByText(company,{exact:true}).waitFor();
  assert.equal(await dialog.getByRole('article').count(),50);
  assert.equal(await dialog.getByRole('button',{name:'关闭关联成交'}).evaluate(node=>node===document.activeElement),true);
  await dialog.getByText(name,{exact:true}).waitFor();
  const history=dialog.getByRole('article').filter({hasText:company});await history.getByRole('button').focus();await page.keyboard.press('Enter');
  await history.getByText('来源：历史成交库',{exact:true}).waitFor();
  await history.getByText('项目级关联，历史记录无法精确到具体塔楼',{exact:true}).waitFor();
  await history.getByText('净有效 ¥0/㎡/月',{exact:true}).first().waitFor();
  assert.ok(await dialog.evaluate(node=>node.scrollWidth<=node.clientWidth+1));
  await page.screenshot({animations:'disabled',path:`/tmp/map-related-history-${width}.png`});
  const current=dialog.getByRole('article').filter({hasText:'未标注公司'});await current.getByRole('button').click();
  await current.getByText('租金',{exact:true}).waitFor();await current.getByText('未记录',{exact:true}).waitFor();
  await page.screenshot({animations:'disabled',path:`/tmp/map-related-${width}.png`});
  await dialog.getByRole('button',{name:'下一页关联成交',exact:true}).click();await dialog.getByText('第二页成交',{exact:true}).waitFor();
  await dialog.getByRole('button',{name:'上一页关联成交',exact:true}).click();await history.waitFor();
  assert.equal(reads,2,'returning to page 1 uses the same-scope short cache');
  const link=dialog.getByRole('link',{name:'在成交库查看',exact:true});assert.ok((await link.getAttribute('href')).includes(encodeURIComponent(project)));
  const expanded=await page.locator('.map-workspace-layout').getAttribute('data-expanded');
  await page.keyboard.press('Escape');await dialog.waitFor({state:'detached'});
  assert.equal(await page.locator('.map-workspace-layout').getAttribute('data-expanded'),expanded,'Escape preserves parent reading mode');
  assert.ok(await dialog.count()===0);
  assert.equal(await detail.isVisible(),true,'Escape must close only associated transactions');
  assert.equal(await trigger.evaluate(node=>node===document.activeElement),true,'closing returns focus to the associated transaction entry');
  return {width,sourceAndScopePreserved:true,zeroAndMissingDistinct:true,pagingCountReused:true,fiftyRowsThenLastPage:true,keyboardExpansion:true,escapeClosesOnlyRelated:true,focusReturned:true,reads};
}
