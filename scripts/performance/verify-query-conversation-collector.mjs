// Calibrates collector semantics only. Its synthetic delays are never product
// performance evidence. The real benchmark uses the separate Auth/PG/Next harness.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { observeQueryConversation, nearestRank, summarizeQueryPerformance } from './query-conversation-probe.mjs';

assert.equal(nearestRank([30, 10, 20], 0.9), 30);
assert.equal(nearestRank([null, undefined], 0.5), null);
const common = { variant: 'after', profile: 'desktop', cache_state: 'new_context_first_dialogue', step: 'single_market',
  status: 'success', feedback_ms: 40, result_painted_ms: 150, content_usable_ms: 200, source_open_ms: 30, browser_validation_and_render_ms: 20 };
const all = Array.from({ length: 20 }, () => ({ ...common }));
const first = rows => summarizeQueryPerformance(rows, ['after']).find(group => group.profile === common.profile && group.cache_state === common.cache_state && group.step === common.step);
assert.equal(first(all).budgetsMet, true);
assert.equal(first(all.slice(0, 19)).budgetsMet, false);
assert.equal(first([...all.slice(0, 19), { ...common, status: 'timeout', content_usable_ms: null }]).failed, 1);
assert.equal(first([...all.slice(0, 19), { ...common, content_usable_ms: null }]).measurementComplete, false);

if (process.argv.includes('--summary-only')) {
  console.log('PASS query performance summaries: nearest-rank, retained failure, missing metric and missing sample');
  process.exit(0);
}

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PERF_PLAYWRIGHT_MODULE || 'playwright-core');
const browser = await chromium.launch({ headless: true,
  ...(process.env.PERF_BROWSER_EXECUTABLE_PATH ? { executablePath: process.env.PERF_BROWSER_EXECUTABLE_PATH } : {}),
  ...(process.env.PERF_BROWSER_CHANNEL ? { channel: process.env.PERF_BROWSER_CHANNEL } : {}) });
try {
  for (const chartRequired of [false, true]) {
    const page = await browser.newPage();
    await page.setContent('<button aria-label="发送问题">发送</button><section aria-label="查询结果"><button aria-label="查看来源：面积加权净有效租金 1">1</button></section>');
    await page.evaluate(() => {
      const source = value => `<button aria-label="查看来源：面积加权净有效租金 ${value}">${value}</button>`;
      document.querySelector('button[aria-label="发送问题"]').addEventListener('click', () => {
        const stop = document.createElement('button'); stop.setAttribute('aria-label', '停止等待'); stop.textContent = '正在查询'; document.body.appendChild(stop);
        setTimeout(() => {
          document.querySelector('section[aria-label="查询结果"]').remove();
          const result = document.createElement('section'); result.setAttribute('aria-label', '查询结果'); result.innerHTML = source(2); document.body.appendChild(result); stop.remove();
          result.querySelector('button').addEventListener('click', () => {
            const panel = document.createElement('section'); panel.setAttribute('aria-label', '来源详情'); panel.textContent = 'building_metrics'; document.body.appendChild(panel);
          });
          setTimeout(() => { const figure = document.createElement('figure'); figure.setAttribute('aria-label', '同源查询图表'); figure.textContent = 'chart'; result.appendChild(figure); }, 150);
        }, 150);
      });
    });
    await page.evaluate(observeQueryConversation, { chartRequired, timeoutMs: 3000 });
    await page.getByRole('button', { name: '发送问题', exact: true }).click();
    await page.waitForFunction(() => window.__colliersQueryPerformance.state.status === 'ready');
    let measured = await page.evaluate(() => window.__colliersQueryPerformance.read());
    assert.ok(measured.result_painted_ms >= 140, 'preexisting result must not count as the new result');
    if (chartRequired) assert.ok(measured.content_usable_ms >= 290, 'table paint must not substitute for the required chart');
    assert.ok(measured.feedback_ms < measured.content_usable_ms);
    await page.getByRole('button', { name: '查看来源：面积加权净有效租金 2', exact: true }).click();
    await page.waitForFunction(() => window.__colliersQueryPerformance.state.source_open_ms.length === 1);
    measured = await page.evaluate(() => { const probe = window.__colliersQueryPerformance; const result = probe.read(); probe.stop(); return result; });
    assert.ok(measured.source_open_ms[0] > 0); await page.close();
  }
  const page = await browser.newPage(); await page.setContent('<button aria-label="发送问题">发送</button>');
  await page.evaluate(observeQueryConversation, { chartRequired: false, timeoutMs: 50 });
  await page.getByRole('button', { name: '发送问题', exact: true }).click();
  await page.waitForFunction(() => window.__colliersQueryPerformance.state.status === 'timeout');
  const timed = await page.evaluate(() => { const probe = window.__colliersQueryPerformance; const value = probe.read(); probe.stop(); return value; });
  assert.equal(timed.content_usable_ms, null); assert.equal(timed.feedback_ms, null);
  console.log('PASS query collector: fresh-result, chart, source interaction, timeout and missing/failed sample semantics');
} finally { await browser.close(); }
