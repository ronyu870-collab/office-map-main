import assert from 'node:assert/strict';

// Production workspace; the caller owns isolated business/auth/SDK transports.
export async function verifyWorkspaceFilters(page, { width, height, stock }) {
  const pane = page.locator('.map-workspace-filter');
  const count = async value => page.waitForFunction(expected => document.querySelectorAll('.map-live-stats .map-metric-number')[2]?.textContent === expected, String(value), { timeout: 10000 });
  const expand = async () => {
    if (width >= 1000) return;
    await page.locator('.map-workspace-left .workspace-mobile-tools > summary').click();
    await page.getByRole('button', { name: '展开到阅读高度', exact: true }).click();
  };
  console.log(`filters ${width}: opening`);
  await expand();
  await pane.getByRole('button', { name: '项目类型', exact: true }).click();
  await pane.getByRole('checkbox', { name: '显示未来新增供应', exact: true }).uncheck();
  await pane.getByRole('button', { name: '项目类型', exact: true }).click();
  await count(3);
  const numeric = pane.getByRole('button', { name: '多重筛选', exact: true });
  await numeric.focus(); await numeric.press('Enter');
  assert.equal(await numeric.getAttribute('aria-expanded'), 'true');
  const add = pane.getByRole('button', { name: '添加条件', exact: true });
  await add.click();
  await pane.getByRole('combobox', { name: '第1项筛选字段', exact: true }).selectOption('owner');
  const owner = pane.getByRole('textbox', { name: '第1项筛选文字', exact: true });
  await owner.fill(stock[0].owner);
  await owner.evaluate(el => el.setSelectionRange(3, 7));
  console.log(`filters ${width}: waiting for one`);
  await count(1);
  assert.deepEqual(await owner.evaluate(el => [el === document.activeElement, el.selectionStart, el.selectionEnd, el.value]), [true, 3, 7, stock[0].owner]);
  await add.click();
  await pane.getByRole('combobox', { name: '第2项筛选字段', exact: true }).selectOption('property_management');
  await pane.getByRole('textbox', { name: '第2项筛选文字', exact: true }).fill(stock[0].property_management);
  console.log(`filters ${width}: waiting for one`);
  await count(1);
  const summary = page.locator('.map-disclosure > summary').filter({ hasText: /^全部 \d+ 项条件$/ });
  await summary.click();
  const popup = page.locator('.map-disclosure-content').filter({ has: page.getByRole('heading', { name: '生效条件 · 点选移除', exact: true }) });
  await popup.waitFor();
  const box = await popup.boundingBox();
  assert.ok(box.x >= 0 && box.y >= 0 && box.x + box.width <= width && box.y + box.height <= height, 'long filter popup stays in viewport');
  assert.equal(await popup.evaluate(el => el.scrollWidth <= el.clientWidth + 1), true, 'long Chinese and English conditions wrap inside popup');
  await page.screenshot({ path: `/tmp/map-filter-conditions-${width}.png` });
  await popup.getByRole('button', { name: '关闭条件列表', exact: true }).click();
  await popup.waitFor({ state: 'detached' });
  assert.equal(await summary.evaluate(el => el === document.activeElement), true);
  console.log(`filters ${width}: waiting for one`);
  await count(1);
  await summary.click();
  const removeOwner = popup.getByRole('button', { name: `移除条件：项目业主 含 ${stock[0].owner}`, exact: true });
  await removeOwner.focus(); await removeOwner.press('Enter');
  await removeOwner.waitFor({ state: 'detached' });
  await page.waitForFunction(() => document.activeElement?.getAttribute('aria-label') === '关闭条件列表', null, { timeout: 10000 });
  console.log(`filters ${width}: waiting for one`);
  await count(1);
  const removeProperty = popup.getByRole('button', { name: `移除条件：物业公司 含 ${stock[0].property_management}`, exact: true });
  await removeProperty.focus(); await removeProperty.press('Enter');
  await popup.waitFor({ state: 'detached' });
  await page.waitForFunction(() => document.activeElement?.getAttribute('aria-label') === '筛选', null, { timeout: 10000 });
  await count(3);

  // Close/reopen keeps the expanded group and its reading position.
  await add.scrollIntoViewIfNeeded();
  const scroll = pane.locator('.workspace-scroll');
  const scrollBefore = await scroll.evaluate(el => el.scrollTop);
  await pane.getByRole('button', { name: '关闭筛选', exact: true }).click();
  await page.getByRole('button', { name: '筛选', exact: true }).click();
  await page.waitForTimeout(250);
  assert.equal(await numeric.getAttribute('aria-expanded'), 'true');
  const scrollAfter = await scroll.evaluate(el => el.scrollTop);
  assert.ok(Math.abs(scrollBefore - scrollAfter) < 2, `filter scroll restored: ${scrollBefore} -> ${scrollAfter}`);

  await add.click();
  await pane.getByRole('spinbutton', { name: '第1项筛选数值', exact: true }).fill('200');
  await count(0);
  await page.getByRole('button', { name: '项目列表', exact: true }).click();
  const list = page.getByRole('region', { name: '项目列表', exact: true });
  await list.getByRole('button', { name: '调整地图筛选', exact: true }).click();
  await pane.getByRole('button', { name: '关闭筛选', exact: true }).waitFor();
  await pane.getByRole('button', { name: '移除第1项筛选条件', exact: true }).click();
  assert.equal(await add.evaluate(el => el === document.activeElement), true);
  await count(3);
  await page.screenshot({ path: `/tmp/map-filter-reading-${width}.png` });
  await add.click();
  await pane.getByRole('spinbutton', { name: '第1项筛选数值', exact: true }).fill('200');
  await count(0);
  const clearAll = page.getByRole('button', { name: '清空', exact: true });
  await clearAll.focus(); await clearAll.press('Enter');
  await count(5);
  assert.equal(await pane.getByRole('spinbutton').count(), 0, 'clear all removes every condition');
  await page.waitForFunction(() => document.activeElement?.getAttribute('aria-label') === '筛选', null, { timeout: 10000 });
  await numeric.click();
  assert.equal(await numeric.getAttribute('aria-expanded'), 'false');
  assert.equal(await scroll.evaluate(el => el.scrollTop <= el.scrollHeight - el.clientHeight + 1), true, 'collapsed content clamps scroll');
  await pane.getByRole('button', { name: '项目类型', exact: true }).click();
  await pane.getByRole('checkbox', { name: '显示未来新增供应', exact: true }).check();
  await pane.getByRole('button', { name: '项目类型', exact: true }).click();
  await count(5);
  if (width < 1000) {
    await page.locator('.map-workspace-left .workspace-mobile-tools > summary').click();
    await page.getByRole('button', { name: '收起为摘要', exact: true }).click();
  }
  await pane.getByRole('button', { name: '关闭筛选', exact: true }).click();
  if (await list.isVisible()) await list.getByRole('button', { name: '关闭列表', exact: true }).click();
  await page.getByRole('button', { name: '筛选', exact: true }).click();
  return { width, longConditionsWrap: true, explicitClosePreservesFilters: true, clearAllResetsConditions: true, singleAndFinalRemovalFocus: true, inputCaretPreserved: true, emptyListAdjustFilters: true, filterScrollBefore: scrollBefore, filterScrollAfter: scrollAfter };
}
