import assert from 'node:assert/strict';

export async function verifySupplyLoading(page,{base,width,role=width===1024?'admin':'viewer'}) {
  let releaseFuture,mode='empty';
  const gate=new Promise(resolve=>{releaseFuture=resolve;});
  await page.route('**/api/map/data?*',async route=>{
    if(new URL(route.request().url()).searchParams.get('mode')!=='future')return route.fallback();
    await gate;
    if(mode==='success')return route.fallback();
    return mode==='error'?route.fulfill({status:503,json:{error:'isolated future read failure'}}):route.fulfill({json:{future_supplies:[]}});
  });
  await page.route('https://example.supabase.co/rest/v1/user_roles*',route=>route.fulfill({headers:{'access-control-allow-origin':'*','access-control-allow-headers':'*','access-control-allow-methods':'GET, OPTIONS'},json:[{role,session_id:'45678901-1111-4111-8111-111111111111'}]}));
  const supply=page.getByRole('region',{name:'未来供应',exact:true});
  const open=async()=>{
    await page.goto(new URL('/map',base).href);
    await page.locator('#map-container [data-building-id]').first().waitFor();
    if(!await supply.isVisible())await page.getByRole('button',{name:'未来供应',exact:true}).click();
    await supply.waitFor();
  };
  try {
    await open();
    assert.equal(await supply.getAttribute('aria-busy'),'true','pending supply read is not an empty calendar');
    await supply.getByRole('status').filter({hasText:'正在读取未来供应'}).waitFor();
    assert.equal(await supply.getByText(/暂无已确认供应/).count(),0);
    assert.equal(await supply.getByText(/0 个项目/).count(),0);
    assert.equal(await supply.getByText(/查看无项目年份/).count(),0);
    releaseFuture();
    await supply.getByRole('status').filter({hasText:'暂无已确认供应'}).waitFor();
    assert.equal(await supply.getAttribute('aria-busy'),'false');
    assert.equal(await supply.getByRole('alert').count(),0,'authorized empty response is not an error');
    mode='error';await open();
    await supply.getByRole('alert').filter({hasText:'未来供应暂时无法读取'}).waitFor();
    assert.equal(await supply.getByText(/暂无已确认供应/).count(),0,'failed read is not presented as an empty result');
    assert.ok(await page.locator('#map-container [data-building-id]').count()>0,'stock map remains readable');
    mode='success';await open();
    await supply.getByRole('button',{name:'CBD未来楼',exact:true}).waitFor();
    assert.equal(await supply.getByRole('alert').count(),0,'fresh successful read clears the prior error');
    assert.equal(await supply.getAttribute('aria-busy'),'false');
    return {width,role,supplyReadStates:{initialLoading:true,authorizedEmpty:true,readErrorDistinct:true,stockStillReadable:true,freshReadRecovered:true}};
  } finally { releaseFuture(); }
}
