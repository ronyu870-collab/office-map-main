import assert from 'node:assert/strict';
import { clickWorkspaceAction } from './workspace-actions.mjs';

// Production detail/controller; only read transport and identity are isolated.
export async function verifyTrendRecovery(page, { base, width }) {
  const project = '10000000-1111-4111-8111-111111111111';
  let response = 'empty', reads = 0;
  await page.route('**/api/map/data?*', route => {
    if (new URL(route.request().url()).searchParams.get('mode') !== 'trend') return route.fallback();
    reads++;
    return response === 'error' ? route.fulfill({ status: 503, json: { error: 'isolated trend read failure' } })
      : route.fulfill({ json: { metrics: response === 'empty' ? [] : [{ record_year: 2026, record_quarter: 3, net_effective_rent: 200, vacancy_rate: .12 }] } });
  });
  await page.goto(new URL(`/map?building=${project}`, base).href);
  const panel = page.getByRole('region', { name: 'CBD甲楼楼宇详情', exact: true });
  await panel.waitFor();
  if (width < 640 || width === 844) await clickWorkspaceAction(page, '全屏阅读工作区');
  await panel.getByRole('tab', { name: '行情', exact: true }).click();
  const toggle = panel.getByRole('button', { name: '季度趋势', exact: true });
  await toggle.click();
  await panel.getByText('暂无历史数据', { exact: true }).waitFor();
  const emptyHeight = (await panel.locator('#info-chart-container').boundingBox()).height;
  assert.ok(emptyHeight <= 100, `empty history uses a compact status instead of an empty chart: ${emptyHeight}px`);
  assert.equal(await panel.getByRole('button', { name: '净有效租金', exact: true }).count(), 0, 'empty history has no ineffective metric switches');
  await panel.getByText('暂无历史数据', { exact: true }).scrollIntoViewIfNeeded();
  await page.screenshot({ animations: 'disabled', path: `/tmp/map-trend-empty-${width}.png` });
  await toggle.click();
  response = 'error';
  await toggle.click();
  await panel.getByText('历史数据读取失败，请稍后重试', { exact: true }).waitFor();
  const retry = panel.getByRole('button', { name: '重试读取历史数据', exact: true });
  await retry.waitFor();
  const errorHeight = (await panel.locator('#info-chart-container').boundingBox()).height;
  assert.ok(errorHeight <= 120, 'read failure remains compact');
  await retry.scrollIntoViewIfNeeded();
  await page.screenshot({ animations: 'disabled', path: `/tmp/map-trend-error-${width}.png` });
  const beforeRetry = reads;
  response = 'data';
  await retry.focus();
  await page.keyboard.press('Enter');
  await panel.locator('#info-chart-container canvas').waitFor();
  await panel.locator('.workspace-trend-data summary').waitFor();
  assert.equal(reads, beforeRetry + 1, 'one keyboard retry performs exactly one read');
  assert.equal(await toggle.getAttribute('aria-expanded'), 'true', 'retry preserves the open panel');
  assert.equal(await panel.getByRole('tab', { name: '行情', exact: true }).getAttribute('aria-selected'), 'true');
  await page.waitForFunction(() => document.activeElement?.id === 'chart-btn-rent', undefined, { timeout: 3000 });
  const dataHeight = (await panel.locator('#info-chart-container').boundingBox()).height;
  assert.ok(dataHeight >= 250, 'successful retry restores the chart reading height');
  await panel.getByRole('tab', { name: '概览', exact: true }).click();
  assert.equal(await panel.getByRole('tab', { name: '概览', exact: true }).getAttribute('aria-selected'), 'true');
  return { width, trendRecovery: { emptyHeight, errorHeight, dataHeight, reads, exactSingleKeyboardRetry: true, projectAndTabPreserved: true, recoveredMetricFocus: true } };
}
