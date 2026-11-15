// Calibrates collector semantics only. Its synthetic delays are never product
// performance evidence. The real benchmark uses the separate Auth/PG/Next harness.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { observeQueryConversation, nearestRank, summarizeQueryPerformance, queryPerformanceErrorCode,
  queryPerformanceFailureDiagnostics, checkpointQueryPerformancePair, queryPerformanceRevision } from './query-conversation-probe.mjs';
import './verify-query-conversation-network.mjs';
import { observeMetricSwitch, summarizeMultiMetricPerformance } from './verify-query-multi-metric.mjs';

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
assert.equal(queryPerformanceErrorCode(new Error('QUERY_NOT_READY\n\n429 !== 200')), 'QUERY_NOT_READY');
assert.equal(queryPerformanceErrorCode(new Error('ACCESS_TOKEN_VALUE')), 'operation_failed');
const mergeSha = 'a'.repeat(40), headSha = 'b'.repeat(40);
const revision = queryPerformanceRevision({ GITHUB_SHA: mergeSha, GITHUB_REF: 'refs/pull/200/merge' }, { pull_request: { head: { sha: headSha } } });
assert.equal(revision.testedCommit, mergeSha); assert.equal(revision.testedMergeSha, mergeSha); assert.equal(revision.headSha, headSha);
assert.equal(queryPerformanceRevision({ GITHUB_SHA: mergeSha, GITHUB_REF: 'refs/pull/200/merge' }, null).headSha, null, 'unknown PR head must not be replaced by merge SHA');
const rejected = { ...common, round: 1, phase: 'login_or_browser', status: 'setup_failed', error: 'LOGIN_HTTP_FAILURE', httpStatus: 429,
  password: 'must-not-log', body: 'must-not-log', headers: { Authorization: 'must-not-log' }, email: 'must-not-log',
  networkFailures: [{ kind: 'receipt', method: 'POST', attribution: 'started_in_sample', critical: true, error: 'net::ERR_ABORTED', httpStatus: null, token: 'must-not-log', url: 'must-not-log' }] };
const diagnostic = queryPerformanceFailureDiagnostics([rejected]);
assert.equal(diagnostic.length, 1); assert.equal(diagnostic[0].httpStatus, 429);
assert.deepEqual(diagnostic[0].viewport, { name: 'desktop', width: 1280, height: 900 });
assert.equal(diagnostic[0].networkFailures[0].error, 'net::ERR_ABORTED');
assert.equal(JSON.stringify(diagnostic).includes('must-not-log'), false);
const order = [];
await assert.rejects(checkpointQueryPerformancePair([rejected], {
  checkpoint: async failures => { order.push('saved'); assert.equal(failures.length, 1);
    const summary = first([rejected]); assert.equal(summary.failed, 1); assert.equal(summary.missing_samples, 19); assert.equal(summary.measurementComplete, false); },
  onFailure: failure => { order.push('logged'); assert.equal(failure.error, 'LOGIN_HTTP_FAILURE'); },
}), /QUERY_PERFORMANCE_PAIR_FAILED/);
assert.deepEqual(order, ['saved', 'logged']);
assert.equal(rejected.status, 'setup_failed');
assert.equal(queryPerformanceFailureDiagnostics([{ ...common, content_usable_ms: 9000 }]).length, 0, 'a timing budget exceedance is not a functional failure');
assert.equal(queryPerformanceFailureDiagnostics([{ ...common, source_open_ms: null }])[0].error, 'MISSING_REQUIRED_MEASUREMENT');
assert.equal(queryPerformanceFailureDiagnostics([{ ...common, step: 'four_quarter_trend', source_reopen_ms: null }])[0].error, 'MISSING_REQUIRED_MEASUREMENT');
await checkpointQueryPerformancePair([common], { checkpoint: async failures => assert.equal(failures.length, 0), onFailure: () => assert.fail('healthy pair stopped') });
const multiCommon = { ...common, step: 'multi_quarter', oracleVerified: true, sourceVerified: true,
  metricSwitchVerified: true, source_reopen_ms: 30, metric_switch_ms: 150 };
const multiRows = Array.from({ length: 20 }, () => ({ ...multiCommon }));
const multiSummary = rows => summarizeMultiMetricPerformance(rows).find(group => group.profile === 'desktop' && group.scenario === 'multi_quarter');
assert.equal(multiSummary(multiRows).budgetsMet, true);
assert.equal(multiSummary(multiRows.slice(0, 19)).measurementComplete, false);
assert.equal(multiSummary([...multiRows.slice(0, 19), { ...multiCommon, oracleVerified: false }]).measurementComplete, false);
assert.equal(multiSummary(multiRows.map(row => ({ ...row, metricSwitchVerified: false }))).measurementComplete, false);
assert.equal(multiSummary(multiRows.map(row => ({ ...row, metric_switch_ms: 2600 }))).budgetsMet, false);
assert.equal(multiSummary(multiRows.map(row => ({ ...row, source_reopen_ms: 501 }))).budgetsMet, false);

if (process.argv.includes('--summary-only')) {
  console.log('PASS query performance summaries: retained failures/missing, safe HTTP diagnostics, checkpoint-before-stop, multi-metric oracle/switch completeness and timing budgets');
  process.exit(0);
}

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PERF_PLAYWRIGHT_MODULE || 'playwright-core');
const browser = await chromium.launch({ headless: true,
  ...(process.env.PERF_BROWSER_EXECUTABLE_PATH ? { executablePath: process.env.PERF_BROWSER_EXECUTABLE_PATH } : {}),
  ...(process.env.PERF_BROWSER_CHANNEL ? { channel: process.env.PERF_BROWSER_CHANNEL } : {}) });
try {
  const metricPage = await browser.newPage();
  await metricPage.setContent('<label>图表指标<select><option value="rent">净有效租金</option><option value="vacancy">空置率</option></select></label><figure aria-label="同源查询图表"><figcaption>净有效租金</figcaption></figure>');
  await metricPage.evaluate(() => {
    const select = document.querySelector('select');
    select.addEventListener('change', () => {
      select.disabled = true;
      setTimeout(() => { document.querySelector('figcaption').textContent = '空置率'; }, 150);
      setTimeout(() => { select.disabled = false; }, 300);
    });
  });
  await metricPage.evaluate(observeMetricSwitch);
  assert.equal(await metricPage.evaluate(() => window.__colliersMetricSwitch.state.elapsed_ms), null);
  await metricPage.getByRole('combobox', { name: '图表指标' }).selectOption('vacancy');
  await metricPage.waitForFunction(() => window.__colliersMetricSwitch.state.elapsed_ms !== null);
  assert.ok(await metricPage.evaluate(() => window.__colliersMetricSwitch.state.elapsed_ms) >= 285, 'Correct metric paint while the control is busy is not yet usable');
  await metricPage.evaluate(() => window.__colliersMetricSwitch.stop()); await metricPage.close();
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
