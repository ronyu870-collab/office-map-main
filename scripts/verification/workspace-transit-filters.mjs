import assert from 'node:assert/strict';

// Explicitly synthetic long content; the production distance and filter engines
// still execute. This is not evidence about a real station or native select UI.
export const transitStation = { id: 'long-transit-station', name: '国际商务中心城市更新与综合交通换乘枢纽站 InternationalBusinessDistrictInterchangeStation', center: [116.46, 39.91] };
export const transitMapData = { districts: [], subways: [{ name: '地铁1号线', path: [[116.45, 39.91], [116.49, 39.92]], stations: [transitStation] }] };

export async function verifyTransitFilters(page, { width, height, stock }) {
  console.log(`transit filters ${width}: starting`);
  const pane = page.locator('.map-workspace-filter');
  const capture = async path => {
    await page.waitForFunction(() => !document.querySelector('.map-workspace-layout [data-exiting]'), null, { timeout: 10000 });
    await page.locator('.map-workspace-layout').evaluate(async el => {
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      await Promise.all(el.getAnimations({ subtree: true }).map(animation => animation.finished.catch(() => {})));
    });
    await page.screenshot({ path, animations: 'disabled' });
  };
  const count = async expected => {
    try {
      await page.waitForFunction(value => document.querySelectorAll('.map-live-stats .map-metric-number')[2]?.textContent === String(value), expected, { timeout: 10000 });
    } catch (error) {
      console.log('transit mismatch', { width, expected, actual: await page.locator('.map-live-stats .map-metric-number').allTextContents(), stock: await page.locator('#map-container [data-building-id]').evaluateAll(els => els.map(el => el.getAttribute('data-building-id'))) });
      throw error;
    }
  };
  const toggleSection = async (name, open = true) => {
    const button = pane.getByRole('button', { name, exact: true });
    if (await button.getAttribute('aria-expanded') !== String(open)) await button.click();
    return page.locator(`[id="${await button.getAttribute('aria-controls')}"]`);
  };
  const showFilters = async () => {
    const toggle = page.getByRole('button', { name: '筛选', exact: true });
    if (await toggle.getAttribute('aria-pressed') !== 'true') await toggle.click();
    if (width < 1000) {
      await page.locator('.map-workspace-left .workspace-mobile-tools > summary').click();
      const expand = page.getByRole('button', { name: '展开到阅读高度', exact: true });
      if (await expand.isVisible()) await expand.click(); else await page.keyboard.press('Escape');
    }
  };
  await showFilters();
  await page.evaluate(() => window.__workspaceMap.setZoomAndCenter(15, [116.46, 39.91]));
  await toggleSection('地铁通勤辐射圈');
  await pane.getByRole('combobox', { name: '地铁线路', exact: true }).selectOption('地铁1号线');
  const station = pane.getByRole('combobox', { name: '地铁站点', exact: true });
  await station.selectOption({ label: transitStation.name });
  console.log(`transit filters ${width}: selected station`);
  await count(2);
  await pane.getByRole('button', { name: '5km', exact: true }).click();
  await count(4);
  console.log(`transit filters ${width}: radius broadened`);
  const subwayLabel = `地铁：地铁1号线 · ${transitStation.name} · 5km`;
  const conditions = page.locator('.map-disclosure > summary').filter({ hasText: /^全部 \d+ 项条件$/ });
  await conditions.click();
  const popup = page.locator('.map-disclosure-content').filter({ has: page.getByRole('heading', { name: '生效条件 · 点选移除', exact: true }) });
  const removeSubway = popup.getByRole('button', { name: `移除条件：${subwayLabel}`, exact: true });
  await removeSubway.waitFor();
  const box = await popup.boundingBox();
  assert.ok(box.x >= 0 && box.y >= 0 && box.x + box.width <= width + 1 && box.y + box.height <= height + 1);
  assert.equal(await removeSubway.evaluate(el => el.scrollWidth <= el.clientWidth + 1 && el.scrollHeight <= el.clientHeight + 1), true, 'complete long station condition wraps without clipping');
  await capture(`/tmp/map-transit-condition-${width}.png`);
  await popup.getByRole('button', { name: '关闭条件列表', exact: true }).click();

  const region = await toggleSection('子市场');
  await region.getByRole('checkbox', { name: '全选', exact: true }).uncheck();
  await region.getByRole('checkbox', { name: 'CBD', exact: true }).check();
  await count(4);
  const types = await toggleSection('项目类型');
  await types.getByRole('checkbox', { name: '显示未来新增供应', exact: true }).uncheck();
  await count(2);
  await pane.getByRole('button', { name: '项目对比筛选', exact: true }).click();
  await pane.getByRole('button', { name: '添加筛选组', exact: true }).click();
  const groupToggle = pane.getByRole('button', { name: '组1', exact: true });
  const group = page.locator(`[id="${await groupToggle.getAttribute('aria-controls')}"]`);
  await group.getByRole('checkbox', { name: 'CBD', exact: true }).check();
  await group.getByRole('checkbox', { name: '乙级', exact: true }).check();
  await count(0);
  await group.getByRole('checkbox', { name: '乙级', exact: true }).uncheck();
  await group.getByRole('checkbox', { name: '甲级', exact: true }).check();
  await count(2);
  await pane.getByRole('button', { name: '添加筛选组', exact: true }).click();
  const search = page.getByRole('searchbox', { name: '搜索楼宇、子市场、业主或物业', exact: true });
  await search.fill(stock[0].name);
  await count(1);
  await page.waitForFunction(expected => {
    const ids = [...new Set([...document.querySelectorAll('#map-container [data-building-id]')].map(el => el.getAttribute('data-building-id')))];
    return ids.length === 1 && ids[0] === expected && document.querySelectorAll('#map-container .map-future-supply-marker').length === 0;
  }, stock[0].id);
  assert.deepEqual(await page.locator('.map-live-stats .map-metric-number').allTextContents(), ['146.1', '21.1', '1', '901.9']);
  await page.getByRole('button', { name: '项目列表', exact: true }).click();
  const list = page.getByRole('region', { name: '项目列表', exact: true });
  await list.getByRole('button', { name: new RegExp('^' + stock[0].name) }).waitFor();
  assert.equal(await list.getByRole('button', { name: new RegExp('^' + stock[1].name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')) }).count(), 0);
  await capture(`/tmp/map-transit-combination-${width}.png`);
  await list.getByRole('button', { name: '关闭列表', exact: true }).click();
  await showFilters();
  assert.equal(await pane.getByRole('button', { name: '组1', exact: true }).count(), 1, 'opening and closing list preserves comparison controls');
  assert.equal(await pane.getByRole('button', { name: '组2', exact: true }).count(), 1, 'unfinished comparison group also survives the list surface');
  await search.fill('');
  await count(2);
  await conditions.click();
  await removeSubway.focus(); await removeSubway.press('Enter');
  await popup.waitFor({ state: 'detached' });
  await station.waitFor({ state: 'detached' });
  await count(2);
  assert.equal(await station.count(), 0, 'removing subway condition clears current line and station');
  for (const name of ['行政区划', '子市场', 'LEED 认证']) {
    const section = await toggleSection(name);
    const all = section.getByRole('checkbox', { name: '全选', exact: true });
    await all.check(); await all.uncheck();
    await count(0);
    await page.getByRole('button', { name: '项目列表', exact: true }).click();
    await list.getByText('当前地图筛选无匹配项目', { exact: true }).waitFor();
    await list.getByRole('button', { name: '调整地图筛选', exact: true }).waitFor();
    await list.getByRole('button', { name: '关闭列表', exact: true }).click();
    await showFilters(); await all.check(); await count(2);
    if (name !== '子市场') await toggleSection(name, false);
  }
  const allRegions = region.getByRole('checkbox', { name: '全选', exact: true });
  await allRegions.uncheck();
  const longRegion = region.getByRole('checkbox', { name: '通惠河传媒走廊', exact: true });
  await longRegion.check(); await count(0);
  assert.equal(await longRegion.locator('..').evaluate(el => el.scrollWidth <= el.clientWidth + 1), true);
  await region.getByRole('checkbox', { name: 'CBD', exact: true }).check(); await count(2);
  await pane.getByRole('button', { name: '移除组1', exact: true }).click();
  await pane.getByRole('button', { name: '移除组2', exact: true }).click();
  await page.getByRole('button', { name: '清空', exact: true }).click();
  await count(5);
  await toggleSection('子市场', false);
  await toggleSection('项目类型', false);
  await toggleSection('地铁通勤辐射圈', false);
  await pane.getByRole('button', { name: '项目对比筛选', exact: true }).click();
  if (width < 1000) {
    await page.locator('.map-workspace-left .workspace-mobile-tools > summary').click();
    await page.getByRole('button', { name: '收起为摘要', exact: true }).click();
  }
  return { width, longStationFullyReadableAndRemovable: true, longSubmarketSelectableWithoutClipping: true, distanceNarrowsStockAndFuture: [2, 4], regionAndStockGradeGroup: [2, 0, 2], keywordMapListCountAndMetricsAgree: true, listReturnKeepsComparisonControls: true, emptyGlobalCategoriesReturnNoResults: true, reselectAllRestoresTwo: true, clearRestoresFive: true };
}
