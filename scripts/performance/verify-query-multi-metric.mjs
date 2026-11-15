import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { nearestRank, QUERY_PERFORMANCE_PROFILES, queryPerformanceErrorCode, queryPerformanceRevision } from './query-conversation-probe.mjs';

const SAMPLES = 20;
const scenarios = [
  { id: 'multi_quarter', operation: 'group_aggregate', chart: true, reopenSource: true,
    after: '2026Q3 CBD、金融街净有效租金和空置率按子市场比较', periods: ['2026-Q3'] },
  { id: 'multi_trend', operation: 'group_trend', chart: true, reopenSource: true,
    after: 'CBD、金融街净有效租金和空置率2025Q4至2026Q3按子市场趋势各期样本', periods: ['2025-Q4', '2026-Q1', '2026-Q2', '2026-Q3'] },
].map(step => ({ ...step, sourceLabelPrefix: '查看来源：净有效租金 · 面积加权净有效租金 ' }));

function matchesFraction(cell, numerator, denominator = '1') {
  const exact = cell?.value?.exact;
  return cell?.kind === 'number' && /^-?\d+$/.test(exact?.numerator) && /^\d+$/.test(exact?.denominator)
    && BigInt(exact.denominator) > 0n && BigInt(exact.numerator) * BigInt(denominator)
      === BigInt(numerator) * BigInt(exact.denominator);
}

/** Independent SQL oracle over the synthetic fixture only. Does not import the
 * application's planner, numerical engine or result builder. */
export async function multiMetricOracle(db, ids) {
  const rows = (await db.query(`select b.submarket, m.record_year || '-Q' || m.record_quarter period,
    count(*) filter (where m.total_area > 0 and m.net_effective_rent > 0)::int rent_count,
    sum(m.total_area::numeric * m.net_effective_rent::numeric) filter (where m.total_area > 0 and m.net_effective_rent > 0)::numeric(40,0)::text rent_numerator,
    sum(m.total_area::numeric) filter (where m.total_area > 0 and m.net_effective_rent > 0)::numeric(40,0)::text rent_denominator,
    count(*) filter (where m.total_area > 0 and m.vacant_area >= 0 and m.vacant_area <= m.total_area)::int vacancy_count,
    sum(m.vacant_area::numeric) filter (where m.total_area > 0 and m.vacant_area >= 0 and m.vacant_area <= m.total_area)::numeric(40,0)::text vacancy_numerator,
    sum(m.total_area::numeric) filter (where m.total_area > 0 and m.vacant_area >= 0 and m.vacant_area <= m.total_area)::numeric(40,0)::text vacancy_denominator
    from public.buildings b join public.building_metrics m on m.building_id=b.id
    where b.id=any($1::uuid[]) and not m.is_draft group by b.submarket,m.record_year,m.record_quarter`, [ids])).rows;
  assert.equal(rows.length, 8, 'MULTI_METRIC_ORACLE_FIXTURE_INVALID');
  assert.equal(rows.filter(row => row.period === '2026-Q3' && row.rent_count === 11 && row.vacancy_count === 12).length, 2, 'MULTI_METRIC_ORACLE_FIXTURE_INVALID');
  return result => {
    assert.deepEqual(result.parameters.metrics, ['rent', 'vacancy'], 'MULTI_METRIC_ORACLE_METRICS_MISMATCH');
    const periods = result.operation === 'group_aggregate' ? scenarios[0].periods : scenarios[1].periods;
    const expected = rows.filter(row => periods.includes(row.period));
    assert.equal(result.table.rows.length, expected.length, 'MULTI_METRIC_ORACLE_ROW_COUNT_MISMATCH');
    const seen = new Set();
    for (const row of result.table.rows) {
      const independent = expected.find(value => row.cells.name?.value === value.submarket && row.cells.period?.value === value.period);
      assert.ok(independent && !seen.has(independent), 'MULTI_METRIC_ORACLE_DIMENSION_MISMATCH');
      seen.add(independent);
      for (const metric of ['rent', 'vacancy']) {
        const columns = result.parameters.metricColumns?.[metric];
        assert.ok(columns, 'MULTI_METRIC_ORACLE_METRICS_MISMATCH');
        assert.ok(matchesFraction(row.cells[columns.value], independent[metric + '_numerator'], independent[metric + '_denominator']), 'MULTI_METRIC_ORACLE_VALUE_MISMATCH');
        assert.ok(matchesFraction(row.cells[columns.usedCount], String(independent[metric + '_count'])), 'MULTI_METRIC_ORACLE_COUNT_MISMATCH');
        assert.ok(matchesFraction(row.cells[columns.denominator], independent[metric + '_denominator']), 'MULTI_METRIC_ORACLE_DENOMINATOR_MISMATCH');
      }
    }
  };
}

// Paint endpoint starts at the actual native select change event. API response
// arrival alone cannot satisfy it; the correct metric chart must be visible and
// the selector usable on a subsequent animation frame.
export function observeMetricSwitch() {
  window.__colliersMetricSwitch?.stop();
  let started = null, frame, stopped = false;
  const state = { elapsed_ms: null };
  const visible = node => node?.isConnected && node.getBoundingClientRect().width > 0 && node.getBoundingClientRect().height > 0;
  const ready = () => {
    const select = [...document.querySelectorAll('label')].find(label => label.textContent?.startsWith('图表指标'))?.querySelector('select');
    const figure = document.querySelector('figure[aria-label="同源查询图表"]');
    return select?.value === 'vacancy' && !select.disabled && visible(figure) && figure.querySelector('figcaption')?.textContent?.includes('空置率');
  };
  const change = event => { if (event.target?.tagName === 'SELECT' && event.target.value === 'vacancy') started = performance.now(); };
  const tick = () => {
    if (stopped) return;
    if (started !== null && ready()) {
      requestAnimationFrame(() => { if (!stopped && ready()) state.elapsed_ms = performance.now() - started; }); return;
    }
    frame = requestAnimationFrame(tick);
  };
  const stop = () => { stopped = true; cancelAnimationFrame(frame); document.removeEventListener('change', change, true); };
  document.addEventListener('change', change, true); frame = requestAnimationFrame(tick);
  window.__colliersMetricSwitch = { state, stop };
}

async function switchMetric({ page, sample, network, result, confirmReceipt }) {
  const cursor = network.cursor(); sample.phase = 'metric_switch';
  await page.evaluate(observeMetricSwitch);
  try {
    const [response] = await Promise.all([page.waitForResponse(response => {
      const request = response.request();
      return new URL(response.url()).pathname === '/api/intelligence/query/artifact' && request.method() === 'POST'
        && request.postDataJSON()?.chart?.metric === 'vacancy';
    }), page.getByRole('combobox', { name: '图表指标', exact: true }).selectOption('vacancy')]);
    assert.equal(response.status(), 200, 'MULTI_METRIC_CHART_MISMATCH');
    const body = await response.json();
    assert.equal(body.status, 'ready', 'MULTI_METRIC_CHART_MISMATCH');
    assert.equal(body.chart.request.metric, 'vacancy', 'MULTI_METRIC_CHART_MISMATCH');
    assert.equal(body.chart.yUnit, 'ratio', 'MULTI_METRIC_CHART_MISMATCH');
    assert.equal(body.chart.points.length, result.table.rows.length, 'MULTI_METRIC_CHART_MISMATCH');
    for (const point of body.chart.points) {
      const row = result.table.rows.find(row => row.entityId === point.yCell.entityId), cell = row?.cells.vacancy_value;
      assert.equal(point.yCell.key, 'vacancy_value', 'MULTI_METRIC_CHART_MISMATCH');
      assert.deepEqual(point.yCell.sourceIds, cell?.sourceIds, 'MULTI_METRIC_CHART_MISMATCH');
      assert.ok(Math.abs(point.y - cell.value.numeric * 100) < 1e-10, 'MULTI_METRIC_CHART_MISMATCH');
    }
    await page.waitForFunction(() => window.__colliersMetricSwitch.state.elapsed_ms !== null);
    sample.metric_switch_ms = await page.evaluate(() => window.__colliersMetricSwitch.state.elapsed_ms);
    assert.ok(Number.isFinite(sample.metric_switch_ms), 'MULTI_METRIC_CHART_NOT_READY');
    await confirmReceipt('metric_chart', { after: cursor, surface: 'chart' });
    await network.waitForIdle(); sample.metricSwitchVerified = true;
  } finally { await page.evaluate(() => window.__colliersMetricSwitch?.stop()).catch(() => {}); }
}

export function summarizeMultiMetricPerformance(samples) {
  return QUERY_PERFORMANCE_PROFILES.flatMap(profile => scenarios.map(scenario => {
    const rows = samples.filter(sample => sample.profile === profile.name && sample.step === scenario.id);
    const fields = ['feedback_ms', 'content_usable_ms', 'source_open_ms', 'source_reopen_ms', 'metric_switch_ms'];
    const metrics = Object.fromEntries(fields.map(field => [field, { p50: nearestRank(rows.map(row => row[field]), 0.5), p90: nearestRank(rows.map(row => row[field]), 0.9) }]));
    const complete = rows.length === SAMPLES && rows.every(row => row.status === 'success' && row.oracleVerified && row.metricSwitchVerified && row.sourceVerified
      && fields.every(field => Number.isFinite(row[field])));
    return { profile: profile.name, scenario: scenario.id, expected: SAMPLES, observed: rows.length, failed: rows.filter(row => row.status !== 'success').length,
      measurementComplete: complete, metrics, budgetsMet: complete && metrics.feedback_ms.p90 <= 100 && metrics.content_usable_ms.p90 <= profile.usableP90Ms
        && metrics.source_reopen_ms.p90 <= 500 && metrics.metric_switch_ms.p90 <= profile.usableP90Ms };
  }));
}

/** New functionality has no equivalent old multi-metric UI; it receives its own
 * 80 real samples and independent SQL oracle, alongside the unchanged 640 A/B
 * samples. All fixtures, Auth, HTTP, charts and receipts use the real path. */
export async function verifyMultiMetricQueryPerformance({ browser, db, owner, ids, app, output, dataApiOrigin, semanticCalls, login, measure, githubEvent }) {
  const samples = [], validateResult = await multiMetricOracle(db, ids), beforeModelCalls = semanticCalls?.();
  const report = { version: 'query-multi-metric-performance/1', ...queryPerformanceRevision(process.env, githubEvent),
    production: false, realPhone: false, baseline: 'New multi-metric behavior; released P1 explicitly did not support it. Single-metric A/B is separately retained.',
    fixture: { buildings: 24, submarkets: 2, quarterlyRecords: 96, finalQuarterRentValidPerMarket: 11, finalQuarterVacancyValidPerMarket: 12 },
    profiles: QUERY_PERFORMANCE_PROFILES, samplesPerCondition: SAMPLES, cacheDefinition: 'Fresh browser context and real login before a single-quarter query followed by a four-quarter query; both servers and database are warm.',
    boundaries: 'No production data, external model, intercepted HTTP, fake Auth or physical-phone claim. First feedback, correct chart readiness, source reopening and actual metric switching are timed in the browser.',
    budgets: { feedbackP90Ms: 100, desktopUsableP90Ms: 2500, mobileUsableP90Ms: 3500, sourceReopenP90Ms: 500, metricSwitch: 'same desktop/mobile usable budget' },
    samples, summary: [], modelCalls: null, complete: false, functionalPassed: false, budgetsMet: false };
  const checkpoint = async () => {
    report.summary = summarizeMultiMetricPerformance(samples);
    report.functionalPassed = report.summary.every(group => group.measurementComplete);
    report.budgetsMet = report.summary.every(group => group.budgetsMet);
    report.modelCalls = semanticCalls ? semanticCalls() - beforeModelCalls : null;
    await writeFile(path.join(output, 'multi-metric-performance.json'), JSON.stringify(report, null, 2) + '\n');
  };
  try {
    for (const profile of QUERY_PERFORMANCE_PROFILES) for (let round = 0; round < SAMPLES; round++) {
      const context = await browser.newContext({ viewport: { width: profile.width, height: profile.height }, isMobile: profile.name === 'mobile', hasTouch: profile.name === 'mobile', timezoneId: 'Asia/Shanghai', serviceWorkers: 'block' });
      const pair = []; let loginHttpStatus = null;
      try {
        const page = await context.newPage(); page.setDefaultTimeout(30000);
        const cdp = await context.newCDPSession(page); await cdp.send('Network.enable');
        await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: profile.latencyMs,
          downloadThroughput: profile.downloadMbps * 1000000 / 8, uploadThroughput: profile.uploadMbps * 1000000 / 8 });
        await cdp.send('Emulation.setCPUThrottlingRate', { rate: profile.cpuRate });
        await login(page, app, owner, value => { loginHttpStatus = value; });
        for (const step of scenarios) {
          const sample = { variant: 'after', profile: profile.name, round: round + 1, step: step.id, status: 'running', phase: 'query',
            networkRequests: [], networkFailures: [], receiptConfirmations: [], actualQueryRequests: 0, queryFailures: 0, pageErrors: 0,
            sourceVerified: false, metricSwitchVerified: false, oracleVerified: false };
          samples.push(sample); pair.push(sample);
          await measure(page, 'after', step, sample, ids, dataApiOrigin, {
            validateResult: result => { validateResult(result); sample.oracleVerified = true; }, afterReady: switchMetric,
          });
          if (sample.status !== 'success') throw new Error(sample.error);
        }
      } catch (error) {
        for (const step of scenarios) if (!pair.some(sample => sample.step === step.id)) {
          const sample = { variant: 'after', profile: profile.name, round: round + 1, step: step.id, status: 'dependency_failed',
            phase: 'login_or_browser', httpStatus: loginHttpStatus, error: queryPerformanceErrorCode(error) };
          samples.push(sample); pair.push(sample);
        }
      } finally { await context.close(); await checkpoint(); }
      if (pair.some(sample => sample.status !== 'success')) {
        for (const sample of pair.filter(sample => sample.status !== 'success')) console.error('MULTI_METRIC_PERFORMANCE_FAILURE ' + JSON.stringify({
          profile: sample.profile, round: sample.round, step: sample.step, phase: sample.phase, error: sample.error, httpStatus: sample.httpStatus,
          networkFailures: sample.networkFailures ?? [] }));
        throw new Error('MULTI_METRIC_PERFORMANCE_FUNCTIONAL_FAILURE');
      }
      console.log(`MULTI_METRIC_PERFORMANCE ${profile.name} pair ${round + 1}/${SAMPLES}`);
    }
    report.complete = true; await checkpoint();
    assert.equal(report.functionalPassed, true);
    if (semanticCalls) assert.equal(report.modelCalls, 0, 'UNEXPECTED_MODEL_CALL_IN_MULTI_METRIC_QUERY');
  } finally { await checkpoint(); }
}
