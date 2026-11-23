import assert from 'node:assert/strict';

export async function verifySelectedRecenter(page, { width, id, name, lng, lat, evidencePrefix = 'map-selected-recenter' }) {
  const detail = page.getByRole('region', {name:name+'楼宇详情',exact:true});
  await page.waitForTimeout(600);
  const identity = await detail.getAttribute('data-building-id');
  const tab = await detail.getByRole('tab',{selected:true}).textContent();
  const camera = () => page.evaluate(() => {const c=window.__workspaceMap.getCenter();return[c.lng,c.lat];});
  const canvas = await page.locator('#map-container').boundingBox();assert.ok(canvas);
  const dragAway = async () => {
    await page.mouse.move(canvas.x+canvas.width*.25,canvas.y+canvas.height*.3);
    await page.mouse.down();await page.mouse.move(canvas.x+canvas.width*.30,canvas.y+canvas.height*.33,{steps:10});await page.mouse.up();
    await page.waitForFunction(({lng,lat})=>{const c=window.__workspaceMap.getCenter();return Math.abs(c.lng-lng)>.0001||Math.abs(c.lat-lat)>.0001;},{lng,lat});
    await page.waitForTimeout(600);
    return camera();
  };
  const moved = await dragAway();
  const marker = page.locator('.map-selected-marker');
  const badge = await marker.boundingBox();assert.ok(badge);
  assert.ok(badge.x>=canvas.x&&badge.x+badge.width<=canvas.x+canvas.width&&badge.y>=canvas.y&&badge.y+badge.height<=canvas.y+canvas.height,'reselection target is fully within the visible canvas');
  await page.mouse.click(badge.x+badge.width/2,badge.y+badge.height/2);
  try {
    await page.waitForFunction(({lng,lat})=>{const c=window.__workspaceMap.getCenter();return Math.abs(c.lng-lng)<.00001&&Math.abs(c.lat-lat)<.00001;},{lng,lat},{timeout:4000});
    assert.equal(await detail.getAttribute('data-building-id'),identity,'clicking the current badge retains its own identity even at shared coordinates');
    assert.equal(await detail.getByRole('tab',{selected:true}).textContent(),tab,'recenter preserves the reading tab');
    assert.equal(await marker.count(),1);
  } catch(error) {
    console.log('selected marker action failure',{width,id,moved,after:await camera(),visibleDetail:await page.locator('.workspace-building').getAttribute('data-building-id').catch(()=>null)});
    await page.screenshot({animations:'disabled',path:`/tmp/${evidencePrefix}-failure-${width}.png`});
    throw error;
  }
  const button = marker.getByRole('button',{name:'定位当前项目：'+name,exact:true});
  const keyboardMoved = await dragAway();
  await button.focus();await page.keyboard.press('Enter');
  await page.waitForFunction(({lng,lat})=>{const c=window.__workspaceMap.getCenter();return Math.abs(c.lng-lng)<.00001&&Math.abs(c.lat-lat)<.00001;},{lng,lat});
  assert.equal(await detail.getAttribute('data-building-id'),identity);
  assert.equal(await detail.getByRole('tab',{selected:true}).textContent(),tab);
  await page.screenshot({animations:'disabled',path:`/tmp/${evidencePrefix}-${width}-${id}.png`});
  return {name:'current marker recenter after real pointer drag',width,id,moved,keyboardMoved,recentered:[lng,lat],sharedCoordinateIdentityRetained:true,readingTabRetained:tab,keyboardAction:true,nativeTouch:false};
}
