import assert from 'node:assert/strict';

// Actual legend control and public SDK state; never write SDK/private DOM state.
export async function verifyBaseMapPlaces(page, { width, evidencePrefix = 'map-base-places', leaveVisible = false }) {
  const snapshot = () => page.evaluate(() => {
    const map = window.__workspaceMap, center = map.getCenter();
    return {
      features: map.getFeatures().slice().sort(), camera: [map.getZoom(), center.lng, center.lat],
      stats: document.querySelector('.map-live-stats')?.textContent,
      selected: document.querySelectorAll('.map-selected-marker').length,
      identity: document.querySelector('[data-building-id][role="region"]')?.getAttribute('data-building-id') ?? null,
    };
  });
  const before = await snapshot();
  assert.deepEqual(before.features, ['bg', 'building', 'road'], 'base POIs are quiet by default while roads/buildings remain');
  await page.evaluate(() => { window.__placesMapReference = window.__workspaceMap; });
  const legend = page.locator('.map-workspace-legend');
  const trigger = legend.locator('summary');
  const popup = page.locator(`[id=${JSON.stringify(await trigger.getAttribute('aria-controls'))}]`);
  await trigger.click();
  const toggle = popup.getByRole('checkbox', { name: '底图地点标注', exact: true });
  await toggle.waitFor(); assert.equal(await toggle.isChecked(), false);
  await toggle.focus(); await page.keyboard.press('Space');
  await page.waitForFunction(() => window.__workspaceMap.getFeatures().includes('point'));
  const enabled = await snapshot();
  assert.deepEqual(enabled.features, ['bg', 'building', 'point', 'road']);
  for (const key of ['camera', 'stats', 'selected', 'identity']) assert.deepEqual(enabled[key], before[key], `enabling reference POIs preserves ${key}`);
  await toggle.focus(); await page.keyboard.press('Space');
  await page.waitForFunction(() => !window.__workspaceMap.getFeatures().includes('point'));
  const disabled = await snapshot();
  assert.deepEqual(disabled, before, 'returning to quiet base preserves the complete project/map context');
  assert.equal(await page.evaluate(() => window.__placesMapReference === window.__workspaceMap), true, 'toggle does not recreate the map');
  if (leaveVisible) { await toggle.check(); await page.waitForFunction(() => window.__workspaceMap.getFeatures().includes('point')); }
  await page.screenshot({animations:'disabled',path:`/tmp/${evidencePrefix}-${width}.png`});
  await page.keyboard.press('Escape');
  await popup.waitFor({state:'detached'});
  await page.evaluate(() => { delete window.__placesMapReference; });
  return {name:'base places via keyboard legend control',width,quietDefault:true,roadsAndBuildingsRemain:true,enabledFeatures:enabled.features,cameraAndProjectContextUnchanged:true,mapInstanceRetained:true,leaveVisible};
}
