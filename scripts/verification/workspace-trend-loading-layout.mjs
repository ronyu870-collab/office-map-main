import assert from 'node:assert/strict';
import { clickWorkspaceAction } from './workspace-actions.mjs';

export async function verifyTrendLoadingLayout(page, { base, width }) {
  const project = '10000000-1111-4111-8111-111111111111';
  let release, requested = false;
  const gate = new Promise(resolve => { release = resolve; });
  await page.route('**/api/map/data?*', async route => {
    if (new URL(route.request().url()).searchParams.get('mode') !== 'trend') return route.fallback();
    requested = true;
    await gate;
    return route.fulfill({ json: { metrics: [[2026, 3, 200, .12], [2025, 4, 160, .1], [2024, 4, null, null], [2023, 4, 0, 0], [2022, 4, null, null], [2021, 4, 180, .11]]
      .map(([record_year, record_quarter, net_effective_rent, vacancy_rate]) => ({ record_year, record_quarter, net_effective_rent, vacancy_rate })) } });
  });
  const geometry = () => {
    const host = document.querySelector('.workspace-project-trend-host'), source = document.querySelector('#info-chart-panel > p:last-child');
    const scroll = document.querySelector('.workspace-building-scroll'), data = document.querySelector('[data-building-trend-data]');
    return { height: host.getBoundingClientRect().height, sourceTop: source.getBoundingClientRect().top, dataHeight: data.getBoundingClientRect().height, scrollHeight: scroll.scrollHeight, scrollTop: scroll.scrollTop };
  };
  try {
    await page.goto(new URL(`/map?building=${project}`, base).href);
    const panel = page.getByRole('region', { name: 'CBD甲楼楼宇详情', exact: true });
    await panel.waitFor();
    if (width < 640 || width === 844) await clickWorkspaceAction(page, '全屏阅读工作区');
    await panel.getByRole('tab', { name: '行情', exact: true }).click();
    await panel.getByRole('button', { name: '季度趋势', exact: true }).click();
    await page.waitForFunction(() => document.querySelector('#info-chart-panel')?.style.display !== 'none');
    // Await the actual read, then keep it pending across real frames.
    const limit = Date.now() + 10000;
    while (!requested && Date.now() < limit) await page.waitForTimeout(20);
    assert.ok(requested, 'the trend request is actually held');
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const before = await page.evaluate(geometry);
    release();
    await panel.locator('#info-chart-container canvas').waitFor();
    await panel.locator('.workspace-trend-data summary').waitFor();
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const after = await page.evaluate(geometry);
    assert.ok(Math.abs(after.height - before.height) <= 1, `async trend data must retain reserved reading height: ${JSON.stringify({ before, after })}`);
    assert.ok(Math.abs(after.sourceTop - before.sourceTop) <= 1, 'source note does not move when the period entry arrives');
    assert.ok(Math.abs(after.scrollHeight - before.scrollHeight) <= 1 && Math.abs(after.scrollTop - before.scrollTop) <= 1, 'async period entry preserves the scroll range and position');
    return { width, trendLoadingLayout: { requestActuallyDelayed: true, before, after } };
  } finally { release(); }
}
