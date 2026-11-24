import assert from 'node:assert/strict';
import { clickWorkspaceAction } from './workspace-actions.mjs';

// CSS viewport equivalents protect the layout found with real Chrome zoom.
// This does not simulate browser zoom, a phone keyboard, or system gestures.
export async function verifyShortViewport(page, { base }) {
  const results = [];
  for (const viewport of [{ width: 626, height: 328 }, { width: 600, height: 328 }, { width: 540, height: 360 }, { width: 320, height: 360 }]) {
    await page.setViewportSize(viewport);
    await page.goto(new URL('/map?building=10000000-1111-4111-8111-111111111111', base).href);
    const panel = page.getByRole('region', { name: 'CBD甲楼楼宇详情', exact: true });
    await panel.waitFor();
    await page.waitForFunction(() => window.__workspaceMap?.getCenter());
    const cameraBefore = await page.evaluate(() => {
      const c = window.__workspaceMap.getCenter(); return [c.getLng?.() ?? c.lng, c.getLat?.() ?? c.lat];
    });
    await page.evaluate(() => window.dispatchEvent(new CustomEvent('map-submarket-open', { detail: { name: 'CBD' } })));
    await page.getByRole('region', { name: 'CBD', exact: true }).waitFor();
    await page.waitForFunction(before => {
      const c = window.__workspaceMap.getCenter(), lng = c.getLng?.() ?? c.lng, lat = c.getLat?.() ?? c.lat;
      return Math.abs(lng - before[0]) > .000001 || Math.abs(lat - before[1]) > .000001;
    }, cameraBefore);
    const mapStrip = await page.evaluate(() => document.querySelector('.map-workspace-right[data-open]').getBoundingClientRect().top - document.querySelector('#map-container').getBoundingClientRect().top);
    assert.ok(mapStrip >= 82, `region keeps real map room below short tools: ${mapStrip}`);
    await page.screenshot({ path: `/tmp/map-short-region-${viewport.width}.png`, animations: 'disabled' });
    await page.getByRole('searchbox', { name: '搜索楼宇、子市场、业主或物业', exact: true }).fill('CBD');
    await page.getByRole('button', { name: '搜索：CBD', exact: true }).waitFor();
    const stage = await page.locator('.map-workspace-layout').boundingBox();
    assert.ok(stage.height >= viewport.height * .4, `short viewport ${viewport.width}×${viewport.height} retains at least 40% for map and reading: ${stage.height}`);
    assert.ok(await page.locator('.map-workspace-toolbar').evaluate(el => el.scrollWidth <= el.clientWidth + 1), 'short tools do not overflow horizontally');
    const stats = page.getByRole('region', { name: '市场实时指标', exact: true });
    assert.equal(await stats.locator('dd').count(), 4, 'all metrics stay directly visible without a disclosure');
    const header = page.locator('.map-workbench-tools');
    await header.evaluate(el => { el.scrollTop = 0; });
    const bounds = await stats.boundingBox(), headerBounds = await header.boundingBox();
    assert.ok(bounds.y >= headerBounds.y && bounds.y + bounds.height <= headerBounds.y + headerBounds.height, 'all metric values are directly inside the initial tools viewport');
    assert.equal(await page.getByText('市场指标', { exact: true }).count(), 0, 'no folded market summary replaces the live metrics');
    for (const control of [page.getByRole('searchbox', { name: '搜索楼宇、子市场、业主或物业', exact: true }), page.getByRole('button', { name: '筛选', exact: true }), page.locator('.map-workspace-legend > summary'), page.getByRole('button', { name: '未来供应', exact: true }), page.getByRole('button', { name: '项目列表', exact: true })]) {
      await control.scrollIntoViewIfNeeded();
      const box = await control.boundingBox();
      assert.ok(box.y >= headerBounds.y && box.y + box.height <= headerBounds.y + headerBounds.height + 1, 'scrolling tools brings the whole control into view');
    }
    await page.setViewportSize({ width: viewport.width, height: 700 });
    assert.ok(await stats.isVisible(), 'taller windows retain the same live statistics');
    await page.setViewportSize(viewport);
    // Search results can take over the panel; select the same project again.
    await page.getByRole('button', { name: /^CBD甲楼 CBD/ }).click();
    await panel.waitFor();
    await clickWorkspaceAction(page, '全屏阅读工作区');
    await panel.getByRole('tab', { name: '成交与资料', exact: true }).click();
    const scroll = await panel.locator('.workspace-scroll').boundingBox();
    assert.ok(scroll.height >= 80, `expanded short viewport retains real reading space: ${scroll.height}`);
    const materials = panel.getByRole('button', { name: '楼书与资料', exact: true });
    await materials.scrollIntoViewIfNeeded();
    await page.screenshot({ path: `/tmp/map-short-viewport-${viewport.width}.png`, animations: 'disabled' });
    await materials.click({ timeout: 5000 });
    const dialog = page.getByRole('dialog');
    await dialog.getByRole('heading', { name: 'CBD甲楼', exact: true }).waitFor();
    await page.keyboard.press('Escape');
    await dialog.waitFor({ state: 'detached' });
    results.push({ ...viewport, stageHeight: stage.height, readingHeight: scroll.height, mapStrip, regionCameraIssued: true, allMetricsDirectlyVisible: true, materialActionReachable: true, toolsScrollReachable: true });
  }
  return { shortViewport: results };
}
