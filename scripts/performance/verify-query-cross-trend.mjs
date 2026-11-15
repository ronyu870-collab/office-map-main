import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { grantQuery } from '../../supabase/tests/ai-query-authority/database.mjs';
import { crossTrendOracleRows, validateCrossTrendResult } from '../verification/ai-query-cross-trend-oracle.mjs';
import { login, measure } from './verify-ai-query-conversation.mjs';
import { switchQueryMetric } from './verify-query-multi-metric.mjs';
import { nearestRank, QUERY_PERFORMANCE_PROFILES, queryPerformanceErrorCode, queryPerformanceRevision } from './query-conversation-probe.mjs';

const require = createRequire(import.meta.url), SAMPLES = 20;
const PERIODS = [{ year: 2025, quarter: 4 }, { year: 2026, quarter: 1 }, { year: 2026, quarter: 2 }, { year: 2026, quarter: 3 }];
const steps = [
  { id: 'cross_per_period', mode: 'per_period', after: 'CBD、金融街净有效租金、空置率和季度总面积2025Q4至2026Q3按子市场和等级趋势各期样本' },
  { id: 'cross_paired', mode: 'paired', after: '共同有效样本呢' },
].map(step => ({ ...step, operation: 'cross_trend', chart: true, reopenSource: true,
  sourceLabelPrefix: '查看来源：净有效租金 · 面积加权净有效租金 ' }));

export function summarizeCrossTrendPerformance(samples) {
  return QUERY_PERFORMANCE_PROFILES.flatMap(profile => steps.map(step => {
    const rows = samples.filter(sample => sample.profile === profile.name && sample.step === step.id);
    const fields = ['feedback_ms', 'content_usable_ms', 'source_open_ms', 'source_reopen_ms', 'vacancy_switch_ms', 'area_switch_ms'];
    const metrics = Object.fromEntries(fields.map(field => [field, { p50: nearestRank(rows.map(row => row[field]), .5), p90: nearestRank(rows.map(row => row[field]), .9) }]));
    const complete = rows.length === SAMPLES && rows.every(row => row.status === 'success' && row.oracleVerified && row.sourceVerified
      && row.vacancySwitchVerified && row.areaSwitchVerified && fields.every(field => Number.isFinite(row[field])));
    return { profile: profile.name, scenario: step.id, expected: SAMPLES, observed: rows.length, failed: rows.filter(row => row.status !== 'success').length,
      measurementComplete: complete, metrics, budgetsMet: complete && metrics.feedback_ms.p90 <= 100 && metrics.content_usable_ms.p90 <= profile.usableP90Ms
        && metrics.source_reopen_ms.p90 <= 500 && metrics.vacancy_switch_ms.p90 <= profile.usableP90Ms && metrics.area_switch_ms.p90 <= profile.usableP90Ms };
  }));
}

async function switchBothMetrics(context) {
  await switchQueryMetric(context, { measurement: 'vacancy_switch_ms', stage: 'vacancy_chart' });
  context.sample.vacancySwitchVerified = true;
  await switchQueryMetric(context, { metric: 'totalArea', caption: '总面积', unit: 'm2', column: 'totalArea_value', factor: 1,
    measurement: 'area_switch_ms', stage: 'area_chart' });
  context.sample.areaSwitchVerified = true;
}

/** Runs in its own CI runner/stack. The original 640+80 regression remains in
 * the other job with unchanged conditions; no competing browser process runs
 * on this host. Inputs, accounts and output are synthetic and disposable only. */
export async function verifyCrossTrendQueryPerformance({ db, person, app, output, exportCaps, semanticCalls, dataApiOrigin }) {
  assert.equal(process.env.AI_QUERY_AUTH_ALLOW_LOCAL, 'disposable');
  assert.equal(db.connectionParameters.host, '127.0.0.1'); assert.equal(Number(db.connectionParameters.port), 55992);
  assert.ok(['127.0.0.1', 'localhost'].includes(new URL(app).hostname));
  await mkdir(output, { recursive: true });
  const ids = Array.from({ length: 24 }, () => randomUUID()), samples = [];
  const githubEvent = process.env.GITHUB_EVENT_PATH ? JSON.parse(await readFile(process.env.GITHUB_EVENT_PATH, 'utf8')) : null;
  const modelStart = semanticCalls?.();
  const report = { version: 'query-cross-trend-performance/1', suite: 'cross_trend', ...queryPerformanceRevision(process.env, githubEvent),
    production: false, realPhone: false, baseline: 'New cross_trend operation has no released equivalent. The separate regression job retains the full 640+80 measurements.',
    fixture: { buildings: 24, submarkets: 2, grades: 2, quarterlyRecords: 96, quarters: PERIODS, metricCount: 3,
      finalMissingRents: 2, finalInvalidVacancies: 2, differentMetricCohorts: true },
    profiles: QUERY_PERFORMANCE_PROFILES, samplesPerCondition: SAMPLES,
    cacheDefinition: 'Fresh browser context and real login; explicit per-period cross trend followed by inherited paired-sample query. Servers/database are warm.',
    boundaries: 'Real disposable GoTrue, Next production build, SQL oracle, Data API, metric changes and DOM receipts; no intercepted HTTP, production data, external model or physical phone.',
    budgets: { feedbackP90Ms: 100, desktopUsableP90Ms: 2500, mobileUsableP90Ms: 3500, sourceReopenP90Ms: 500, metricSwitch: 'same desktop/mobile usable budget for each actual switch' },
    samples, summary: [], modelCalls: null, complete: false, functionalPassed: false, budgetsMet: false };
  const checkpoint = async () => {
    report.summary = summarizeCrossTrendPerformance(samples);
    report.functionalPassed = report.summary.every(group => group.measurementComplete);
    report.budgetsMet = report.summary.every(group => group.budgetsMet);
    report.modelCalls = semanticCalls ? semanticCalls() - modelStart : null;
    await writeFile(path.join(output, 'cross-trend-performance.json'), JSON.stringify(report, null, 2) + '\n');
  };
  let browser;
  try {
    for (const [i, id] of ids.entries()) {
      await db.query('insert into public.buildings(id,name,submarket,grade) values($1,$2,$3,$4)', [id, `交叉趋势性能合成${i + 1}`, i < 12 ? 'CBD' : '金融街', i % 2 === 0 ? 'A' : 'B']);
      for (const [q, period] of PERIODS.entries()) {
        const area = 10000 + i * 100, rent = q === 3 && [5, 17].includes(i) ? null : 180 + i * 2 - q * 3;
        const vacant = q === 3 && [8, 20].includes(i) ? area + 1000 : 1000;
        await db.query('insert into public.building_metrics(building_id,record_year,record_quarter,total_area,net_effective_rent,vacant_area,is_draft) values($1,$2,$3,$4,$5,$6,false)',
          [id, period.year, period.quarter, area, rent, vacant]);
      }
    }
    const owner = await person('admin', 'cross-trend-performance'); owner.phone = '10000000000';
    await db.query('update public.user_roles set phone=$1 where user_id=$2', [owner.phone, owner.id]);
    await grantQuery({ setup: db }, owner.id, { capabilities: exportCaps, allSubmarkets: false, submarkets: ['CBD', '金融街'], allBuildings: false, buildingIds: ids });
    const oracles = new Map();
    for (const step of steps) {
      const rows = await crossTrendOracleRows(db, { ids, periods: PERIODS, mode: step.mode, submarkets: ['CBD', '金融街'] });
      assert.equal(rows.length, 16, 'CROSS_TREND_ORACLE_FIXTURE_INVALID'); oracles.set(step.mode, rows);
    }
    const { chromium } = require(process.env.PERF_PLAYWRIGHT_MODULE || 'playwright-core');
    browser = await chromium.launch({ headless: true, ...(process.env.PERF_BROWSER_CHANNEL ? { channel: process.env.PERF_BROWSER_CHANNEL } : {}) });
    report.browser = await browser.version();
    for (const profile of QUERY_PERFORMANCE_PROFILES) for (let round = 0; round < SAMPLES; round++) {
      const context = await browser.newContext({ viewport: { width: profile.width, height: profile.height }, isMobile: profile.name === 'mobile', hasTouch: profile.name === 'mobile', timezoneId: 'Asia/Shanghai', serviceWorkers: 'block' });
      const pair = []; let loginHttpStatus = null;
      try {
        const page = await context.newPage(); page.setDefaultTimeout(30000);
        const cdp = await context.newCDPSession(page); await cdp.send('Network.enable');
        await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: profile.latencyMs,
          downloadThroughput: profile.downloadMbps * 1000000 / 8, uploadThroughput: profile.uploadMbps * 1000000 / 8 });
        await cdp.send('Emulation.setCPUThrottlingRate', { rate: profile.cpuRate });
        await login(page, app, owner, status => { loginHttpStatus = status; });
        for (const step of steps) {
          const sample = { variant: 'after', profile: profile.name, round: round + 1, step: step.id, status: 'running', phase: 'query',
            networkRequests: [], networkFailures: [], receiptConfirmations: [], actualQueryRequests: 0, queryFailures: 0, pageErrors: 0,
            sourceVerified: false, oracleVerified: false, vacancySwitchVerified: false, areaSwitchVerified: false };
          samples.push(sample); pair.push(sample);
          await measure(page, 'after', step, sample, ids, dataApiOrigin, { afterReady: switchBothMetrics, validateResult: result => {
            assert.equal(result.parameters.executedPlan.mode, step.mode, 'CROSS_TREND_ORACLE_PLAN_MISMATCH');
            validateCrossTrendResult(result, oracles.get(step.mode)); sample.oracleVerified = true;
          } });
          if (sample.status !== 'success') throw new Error(sample.error);
        }
      } catch (error) {
        for (const step of steps) if (!pair.some(sample => sample.step === step.id)) {
          const sample = { variant: 'after', profile: profile.name, round: round + 1, step: step.id, status: 'dependency_failed',
            phase: 'login_or_browser', httpStatus: loginHttpStatus, error: queryPerformanceErrorCode(error) };
          samples.push(sample); pair.push(sample);
        }
      } finally { await context.close(); await checkpoint(); }
      if (pair.some(sample => sample.status !== 'success')) {
        for (const sample of pair.filter(sample => sample.status !== 'success')) console.error('CROSS_TREND_PERFORMANCE_FAILURE ' + JSON.stringify({
          profile: sample.profile, round: sample.round, step: sample.step, phase: sample.phase, error: sample.error, httpStatus: sample.httpStatus,
          networkFailures: sample.networkFailures ?? [] }));
        throw new Error('CROSS_TREND_PERFORMANCE_FUNCTIONAL_FAILURE');
      }
      console.log(`CROSS_TREND_PERFORMANCE ${profile.name} pair ${round + 1}/${SAMPLES}`);
    }
    report.complete = true; await checkpoint();
    assert.equal(report.functionalPassed, true, 'CROSS_TREND_PERFORMANCE_FUNCTIONAL_FAILURE');
    assert.equal(report.budgetsMet, true, 'CROSS_TREND_PERFORMANCE_BUDGET_FAILURE');
    if (semanticCalls) assert.equal(report.modelCalls, 0, 'UNEXPECTED_MODEL_CALL_IN_CROSS_TREND_QUERY');
  } finally {
    await browser?.close(); await checkpoint();
    await db.query('delete from public.building_metrics where building_id=any($1::uuid[])', [ids]);
    await db.query('delete from public.buildings where id=any($1::uuid[])', [ids]);
  }
}
