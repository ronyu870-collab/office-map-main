import assert from 'node:assert/strict';

export async function verifyFullListReading(page, width) {
  const desktopAction = page.locator('.map-header-navigation').getByRole('button', { name: '完整列表', exact: true });
  if (await desktopAction.isVisible()) await desktopAction.click();
  else {
    await page.locator('.map-header-navigation-mobile > details > summary').click();
    // MapDisclosure portals its open menu out of the mobile navigation wrapper.
    await page.getByRole('button', { name: '完整列表', exact: true }).click();
  }
  const list = page.getByRole('region', { name: '完整楼宇列表', exact: true });
  await list.getByRole('button', { name: 'CBD甲楼', exact: true }).waitFor();
  const originalCount = await list.locator('article').count();
  const first = list.locator('article').first();
  for (const label of ['区位', '等级', '统计面积', '净有效租金', '空置率']) {
    assert.equal(await first.locator('dt').getByText(label, { exact: true }).count(), 1);
  }
  assert.ok((await first.innerText()).includes('146.1 元/㎡/月'));
  assert.ok((await list.locator('article').filter({ hasText: 'CBD乙楼' }).innerText()).includes('—'), 'unknown values remain unknown');
  const search = list.getByLabel('搜索楼宇、子市场、业主或物业', { exact: true });
  await search.fill('C');
  await page.waitForTimeout(350);
  await search.pressSequentially('BD');
  assert.equal(await search.inputValue(), 'CBD');
  assert.ok(await search.evaluate(node => document.activeElement === node && node.selectionStart === 3 && node.selectionEnd === 3));
  await search.fill('');
  await page.waitForFunction(count => document.querySelectorAll('[aria-label="完整楼宇列表"] article').length === count, originalCount);
  const sort = list.getByRole('combobox', { name: '楼宇排序', exact: true });
  await sort.selectOption('rent-desc');
  await sort.selectOption('default');
  const geometry = await list.evaluate(node => ({ width: node.clientWidth, content: node.scrollWidth,
    rows: [...node.querySelectorAll('article')].map(row => ({ width: row.clientWidth, content: row.scrollWidth })) }));
  assert.ok(geometry.content <= geometry.width + 1 && geometry.rows.every(row => row.content <= row.width + 1), 'complete fields and long names fit the list');
  await page.screenshot({ path: `/tmp/map-full-list-reading-${width}.png` });
  await list.getByRole('button', { name: '返回地图', exact: true }).click();
  await page.locator('#map-container').waitFor({ state: 'visible' });
  assert.equal(await page.locator('[aria-label="完整楼宇列表"]:visible').count(), 0);
  return { fullListReading: true, continuousSearch: true, originalCount, geometry };
}
