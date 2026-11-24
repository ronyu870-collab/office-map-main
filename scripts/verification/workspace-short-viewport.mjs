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
    await page.getByRole('searchbox', { name: '搜索楼宇、子市场、业主或物业', exact: true }).fill('CBD');
    await page.getByRole('button', { name: '搜索：CBD', exact: true }).waitFor();
    const stage = await page.locator('.map-workspace-layout').boundingBox();
    assert.ok(stage.height >= viewport.height * .4, `short viewport ${viewport.width}×${viewport.height} retains at least 40% for map and reading: ${stage.height}`);
    assert.ok(await page.locator('.map-workspace-toolbar').evaluate(el => el.scrollWidth <= el.clientWidth + 1), 'short tools do not overflow horizontally');
    const metrics = page.locator('.map-compact-metrics > summary');
    await metrics.click();
    const stats = page.getByRole('region', { name: '市场实时指标', exact: true });
    await stats.waitFor();
    assert.equal(await stats.locator('dd').count(), 4, 'all four metrics remain available');
    const popover = await page.locator('.map-disclosure-content').boundingBox();
    assert.ok(popover.x >= 0 && popover.y >= 0 && popover.x + popover.width <= viewport.width && popover.y + popover.height <= viewport.height, 'statistics stay inside the short viewport');
    assert.ok(await stats.evaluate(el => el.scrollWidth <= el.clientWidth + 1), 'metric units remain inside the disclosure');
    await page.keyboard.press('Escape');
    assert.ok(await metrics.evaluate(el => el === document.activeElement), 'closing statistics restores its visible trigger');
    await metrics.click();
    await stats.waitFor();
    await page.setViewportSize({ width: viewport.width, height: 700 });
    await page.locator('.map-disclosure-content').waitFor({ state: 'detached' });
    assert.ok(await page.locator('.map-page-header > .map-live-stats').isVisible(), 'taller windows restore inline statistics without an orphaned popover');
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
    results.push({ ...viewport, stageHeight: stage.height, readingHeight: scroll.height, allMetricsReachable: true, materialActionReachable: true });
  }
  return { shortViewport: results };
}
