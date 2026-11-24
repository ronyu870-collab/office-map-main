import assert from 'node:assert/strict';
import { clickWorkspaceAction } from './workspace-actions.mjs';

export async function verifyContentHeight(page, { base, width }) {
  // Keep this layout read independent from the shared suite's one-shot 403
  // gallery recovery scenario; do not consume that scenario's read counter.
  await page.route('**/api/map/building-photos?*', route => {
    assert.equal(new URL(route.request().url()).searchParams.get('building_id'), '10000000-1111-4111-8111-111111111111');
    return route.fulfill({ json: { url: 'https://synthetic.invalid/content-height.svg', is_preview: false, can_download: true, source_url: '', source_name: '' } });
  });
  await page.goto(new URL('/map?building=10000000-1111-4111-8111-111111111111', base).href);
  const panel = page.getByRole('region', { name: 'CBD甲楼楼宇详情', exact: true });
  await panel.waitFor();
  const compact = await page.locator('.map-workspace-layout').getAttribute('data-compact') !== null;
  if (compact) await clickWorkspaceAction(page, '全屏阅读工作区');
  await panel.getByRole('tab', { name: '成交与资料', exact: true }).click();
  const measure = () => {
    const pane = document.querySelector('.workspace-building'), scroll = document.querySelector('.workspace-building-scroll');
    const group = document.querySelector('.workspace-resource-group:last-child');
    return { paneHeight: pane.getBoundingClientRect().height, emptyTail: pane.getBoundingClientRect().bottom - group.getBoundingClientRect().bottom,
      scrollClient: scroll.clientHeight, scrollHeight: scroll.scrollHeight, scrollTop: scroll.scrollTop };
  };
  const canvasBefore = await page.locator('#map-container').boundingBox();
  const short = await page.evaluate(measure);
  await page.screenshot({ animations: 'disabled', path: `/tmp/map-content-height-short-${width}.png` });
  if (!compact) assert.ok(short.emptyTail <= 32, `short material tasks leave no full-height empty panel: ${short.emptyTail}px`);
  const mapReachableBelowShortContent = await page.evaluate(() => {
    const card = document.querySelector('.workspace-building').getBoundingClientRect();
    const map = document.querySelector('#map-container').getBoundingClientRect();
    if (card.bottom + 48 >= map.bottom) return null;
    return Boolean(document.elementFromPoint((card.left + card.right) / 2, card.bottom + 24)?.closest('#map-container'));
  });
  if (!compact && mapReachableBelowShortContent !== null) assert.equal(mapReachableBelowShortContent, true, 'map below the short card receives pointer input');
  await panel.getByRole('tab', { name: '概览', exact: true }).click();
  await panel.getByRole('button', { name: /看图/ }).click();
  await page.waitForFunction(() => document.querySelector('[data-building-photo]:not([hidden])')?.naturalWidth > 0);
  await panel.getByRole('button', { name: '查看大图', exact: true }).scrollIntoViewIfNeeded();
  await panel.getByRole('tab', { name: '行情', exact: true }).click();
  await panel.getByRole('button', { name: '季度趋势', exact: true }).click();
  await panel.locator('#info-chart-container canvas').waitFor();
  await panel.locator('.workspace-trend-data > summary').click();
  const table = panel.getByRole('table', { name: '项目期间租金与空置率', exact: true });
  await table.getByRole('row').last().scrollIntoViewIfNeeded();
  const long = await page.evaluate(() => {
    const pane = document.querySelector('.workspace-building'), stage = document.querySelector('.map-workspace-layout');
    const scroll = document.querySelector('.workspace-building-scroll');
    return { paneHeight: pane.getBoundingClientRect().height, stageHeight: stage.getBoundingClientRect().height,
      headerTop: pane.querySelector('.workspace-panel-header').getBoundingClientRect().top, paneTop: pane.getBoundingClientRect().top,
      scrollHeight: scroll.scrollHeight, scrollClient: scroll.clientHeight, scrollTop: scroll.scrollTop };
  });
  assert.ok(long.paneHeight <= long.stageHeight, 'rich content stays inside the workspace');
  assert.ok(long.scrollHeight > long.scrollClient && long.scrollTop > 0, 'rich history remains scrollable to its final period');
  assert.ok(Math.abs(long.headerTop - long.paneTop) <= 2, 'scrolling content does not displace the project header');
  await page.screenshot({ animations: 'disabled', path: `/tmp/map-content-height-long-${width}.png` });
  await panel.getByRole('tab', { name: '成交与资料', exact: true }).click();
  const returned = await page.evaluate(measure);
  assert.ok(Math.abs(short.paneHeight - returned.paneHeight) <= 1, 'returning to short tasks restores their content height');
  const canvasAfter = await page.locator('#map-container').boundingBox();
  assert.deepEqual(canvasAfter, canvasBefore, 'content changes leave the SDK canvas stable');
  return { width, contentHeight: { compact, short, long, returned, sdkCanvasStable: true, headerRetained: true, mapReachableBelowShortContent } };
}
