import assert from 'node:assert/strict';
import { waitForVisibleProject } from './workspace-visible-map.mjs';

export async function verifySelectedRecenter(page, { width, id, name, lng, lat, evidencePrefix = 'map-selected-recenter' }) {
  const detail = page.getByRole('region', {name:name+'楼宇详情',exact:true});
  await page.waitForTimeout(600);
  const identity = await detail.getAttribute('data-building-id');
  const tab = await detail.getByRole('tab',{selected:true}).textContent();
  const camera = () => page.evaluate(() => {const c=window.__workspaceMap.getCenter();return[c.lng,c.lat];});
  const canvas = await page.locator('#map-container').boundingBox();assert.ok(canvas);
  const focused=await waitForVisibleProject(page,[lng,lat]);
  const visible=focused.visible;
  const dragAway = async () => {
    const before=await camera();
    await page.mouse.move(visible.left+visible.width*.25,visible.top+visible.height*.3);
    await page.mouse.down();await page.mouse.move(visible.left+visible.width*.30,visible.top+visible.height*.33,{steps:10});await page.mouse.up();
    await page.waitForFunction(before=>{const c=window.__workspaceMap.getCenter();return Math.abs(c.lng-before[0])>.000001||Math.abs(c.lat-before[1])>.000001;},before);
    await page.waitForTimeout(600);
    return camera();
  };
  const moved = await dragAway();
  const marker = page.locator('.map-selected-marker');
  const badge = await marker.boundingBox();assert.ok(badge);
  assert.ok(badge.x>=visible.left&&badge.x+badge.width<=visible.right&&badge.y>=visible.top&&badge.y+badge.height<=visible.bottom,'reselection target is fully within the unobstructed canvas');
  await page.mouse.click(badge.x+badge.width/2,badge.y+badge.height/2);
  try {
    await waitForVisibleProject(page,[lng,lat],4000);
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
  const projection=await waitForVisibleProject(page,[lng,lat]);
  assert.equal(await detail.getAttribute('data-building-id'),identity);
  assert.equal(await detail.getByRole('tab',{selected:true}).textContent(),tab);
  await page.screenshot({animations:'disabled',path:`/tmp/${evidencePrefix}-${width}-${id}.png`});
  return {name:'current marker recenter after real pointer drag',width,id,moved,keyboardMoved,target:[lng,lat],recentered:await camera(),projection,sharedCoordinateIdentityRetained:true,readingTabRetained:tab,keyboardAction:true,nativeTouch:false};
}
