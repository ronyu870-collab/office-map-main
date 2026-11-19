import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { grantQuery } from '../../supabase/tests/ai-query-authority/database.mjs';
import { observeQueryConversation, QUERY_PERFORMANCE_PROFILES, QUERY_PERFORMANCE_STEPS, QUERY_PERFORMANCE_CACHE_STATES,
  summarizeQueryPerformance, queryPerformanceErrorCode, checkpointQueryPerformancePair, queryPerformanceRevision } from './query-conversation-probe.mjs';
import { observeQueryNetwork } from './query-conversation-network.mjs';
import { QUERY_PERFORMANCE_BASELINE } from '../verification/query-performance-baseline.mjs';
import { verifyMultiMetricQueryPerformance } from './verify-query-multi-metric.mjs';

const SAMPLES = 20;
const PERIODS = [{ year: 2025, quarter: 4 }, { year: 2026, quarter: 1 }, { year: 2026, quarter: 2 }, { year: 2026, quarter: 3 }];
const require = createRequire(import.meta.url);
const numericProjection = result => ({ operation: result.operation, columns: result.table.columns.map(column => ({ key: column.key, unit: column.unit })),
  rows: result.table.rows.map(row => Object.fromEntries(Object.entries(row.cells).map(([key, cell]) => [key,
    cell.kind === 'number' ? { kind: cell.kind, exact: cell.value.exact } : cell.kind === 'text' ? { kind: cell.kind, text: cell.value } : { kind: cell.kind, reason: cell.reason }]))),
});

/** Invoked only by the dedicated disposable real-Auth harness, after its actual
 * Next production builds start. Authentication and business HTTP are unmodified.
 * No credentials, bodies, screenshots, URLs with query values or headers are saved. */
export async function verifyQueryConversationPerformance({ db, person, app, beforeApp, output, exportCaps, semanticCalls, dataApiOrigin }) {
  assert.equal(process.env.AI_QUERY_AUTH_ALLOW_LOCAL, 'disposable');
  const variants = [...(beforeApp ? [{ name: 'before', app: beforeApp }] : []), { name: 'after', app }];
  for (const variant of variants) assert.ok(['127.0.0.1', 'localhost'].includes(new URL(variant.app).hostname), 'ISOLATED_LOOPBACK_ONLY');
  assert.equal(db.connectionParameters.host, '127.0.0.1', 'ISOLATED_DATABASE_ONLY');
  assert.equal(Number(db.connectionParameters.port), 55992, 'ISOLATED_DATABASE_ONLY');
  const reportPath = path.join(output, 'performance.json'); await mkdir(output, { recursive: true });
  const samples = [], ids = Array.from({ length: 24 }, () => randomUUID());
  const githubEvent = process.env.GITHUB_EVENT_PATH ? JSON.parse(await readFile(process.env.GITHUB_EVENT_PATH, 'utf8')) : null;
  const report = { version: 'query-conversation-performance/2', suite: 'regression', beforeCommit: beforeApp ? QUERY_PERFORMANCE_BASELINE : null,
    ...queryPerformanceRevision(process.env, githubEvent), production: false, realPhone: false,
    authentication: 'Real login form -> local GoTrue -> canonical user_roles -> unchanged query grants/RPC',
    modelCalls: null, realExternalModelCalls: false, modelPath: 'Bounded supported semantics; not a provider latency benchmark',
    baseline: beforeApp ? 'Released P1 and candidate use the same inherited four-turn questions and New Conversation action'
      : 'No baseline build provided; this run cannot establish A/B regression acceptance',
    workspacePreparation: 'Candidate enters its actual Expanded workspace before query timing so full tables/charts remain the readiness target. The released baseline has no mode control and retains its original full-result UI. This layout precondition differs; no hidden compact summary counts as a usable result. Mode-transition cost is independently measured by Experience P1.',
    cacheDefinition: { new_context_first_dialogue: 'A new browser context; real login and homepage are ready before measurement. First query of this page, then inherited continuation. Server and database are warm; not a cold server/DNS/TLS claim.',
      same_document_second_dialogue: 'Second four-turn dialogue in the same document and authenticated session, retaining browser/app caches. Both variants start through the real New Conversation button. No reload or prefilled response.' },
    endpoints: { start: 'Actual send-button click captured in the browser', feedback: 'Loading/stop control or real result painted on a subsequent animation frame',
      result: 'Fresh numeric result and an enabled source action painted', usable: 'Fresh result + source action + required same-result chart painted; actual source interaction then verified',
      source: 'Actual numeric-source click -> new database-source panel painted; final trend also reopened',
      receipt: 'Observe each real DOM receipt through HTTP 200 and completed transfer before opening/closing a source view or replacing the result. These waits do not change the recorded paint endpoints.',
      browserValidationAndRender: 'Response end -> result paint, including body decoding, receipt verification, schema validation and React; not a separate JSON decoder benchmark' },
    fixture: { buildings: 24, submarkets: 2, buildingsPerSubmarket: 12, quarterlyRecords: 96, quarters: PERIODS,
      missingFinalRents: 2, grants: 'only these synthetic building IDs, CBD and 金融街' },
    profiles: QUERY_PERFORMANCE_PROFILES, samplesPerCondition: SAMPLES, sharedRunner: Boolean(process.env.CI), node: process.version,
    networkBoundary: 'CDP throttles the browser network and CPU only; Next-to-Auth/PostgREST traffic stays on loopback',
    networkAttribution: 'Same-origin POST submit/artifact/receipt requests started in the sample are critical. All HTTP 4xx/5xx, including known homepage dependencies, also fail the sample; other lifecycle cancellations remain separately recorded. Only finite allowlisted endpoint categories are retained, never URLs or query values.',
    numericGate: 'Fixed-condition 20-sample evidence. Shared runner single wall-clock timings are not CI functional assertions. Production network, real devices and server cold starts remain outside this report.',
    samples, summary: [], comparisons: [], functionalPassed: false, budgetsMet: false, complete: false };
  const modelCallsBefore = semanticCalls?.();
  const checkpoint = async () => {
    report.summary = summarizeQueryPerformance(samples, variants.map(variant => variant.name), SAMPLES);
    report.functionalPassed = report.summary.every(group => group.measurementComplete);
    report.budgetsMet = report.summary.filter(group => group.variant === 'after').every(group => group.budgetsMet);
    report.modelCalls = semanticCalls ? semanticCalls() - modelCallsBefore : null;
    const failures = samples.flatMap(sample => (sample.networkFailures ?? []).map(failure => ({ variant: sample.variant,
      endpoint: failure.endpoint, error: failure.error, httpStatus: failure.httpStatus, attribution: failure.attribution })));
    report.backgroundHttpFailureCount = failures.filter(failure => failure.httpStatus >= 400).length;
    report.networkFailureSummary = Object.entries(failures.reduce((counts, failure) => {
      const key = JSON.stringify(failure); counts[key] = (counts[key] ?? 0) + 1; return counts;
    }, {})).map(([key, count]) => ({ ...JSON.parse(key), count }));
    report.comparisons = beforeApp ? report.summary.filter(group => group.variant === 'after').map(after => {
      const before = report.summary.find(group => group.variant === 'before' && group.profile === after.profile && group.cache_state === after.cache_state && group.step === after.step);
      const baseline = before.metrics.content_usable_ms.p90, candidate = after.metrics.content_usable_ms.p90;
      return { profile: after.profile, cache_state: after.cache_state, step: after.step, complete: before.measurementComplete && after.measurementComplete,
        before_p90_ms: baseline, after_p90_ms: candidate, delta_ms: baseline !== null && candidate !== null ? candidate - baseline : null,
        change_percent: baseline > 0 && candidate !== null ? (candidate - baseline) / baseline * 100 : null,
        baselineMetBudget: before.budgetsMet, candidateMetBudget: after.budgetsMet };
    }) : [];
    await writeFile(reportPath, JSON.stringify(report, null, 2) + '\n');
  };
  let browser;
  try {
    for (let i = 0; i < ids.length; i++) {
      await db.query("insert into public.buildings(id,name,submarket,grade) values($1,$2,$3,'A')", [ids[i], `P1性能合成${i + 1}楼`, i < 12 ? 'CBD' : '金融街']);
      for (let q = 0; q < PERIODS.length; q++) {
        const period = PERIODS[q], rent = q === 3 && (i === 5 || i === 17) ? null : 180 + i * 2 - q * 3;
        await db.query('insert into public.building_metrics(building_id,record_year,record_quarter,total_area,net_effective_rent,vacant_area,is_draft) values($1,$2,$3,$4,$5,1000,false)',
          [ids[i], period.year, period.quarter, 10000 + i * 100, rent]);
      }
    }
    const owner = await person('admin', 'p1-performance');
    owner.phone = '10000000000';
    await db.query('update public.user_roles set phone=$1 where user_id=$2', [owner.phone, owner.id]);
    await grantQuery({ setup: db }, owner.id, { capabilities: exportCaps, allSubmarkets: false, submarkets: ['CBD', '金融街'], allBuildings: false, buildingIds: ids });
    const { chromium } = require(process.env.PERF_PLAYWRIGHT_MODULE || 'playwright-core');
    browser = await chromium.launch({ headless: true, ...(process.env.PERF_BROWSER_CHANNEL ? { channel: process.env.PERF_BROWSER_CHANNEL } : {}) });
    report.browser = await browser.version();
    for (const profile of QUERY_PERFORMANCE_PROFILES) for (let round = 0; round < SAMPLES; round++) {
      const paired = new Map();
      for (const variant of round % 2 === 0 ? variants : [...variants].reverse()) {
        const collected = []; let context, loginHttpStatus = null, setupPhase = 'login_or_browser';
        try {
          context = await browser.newContext({ viewport: { width: profile.width, height: profile.height },
            isMobile: profile.name === 'mobile', hasTouch: profile.name === 'mobile', timezoneId: 'Asia/Shanghai', serviceWorkers: 'block' });
          const page = await context.newPage(); page.setDefaultTimeout(30000);
          const cdp = await context.newCDPSession(page);
          await cdp.send('Network.enable');
          await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: profile.latencyMs,
            downloadThroughput: profile.downloadMbps * 1000000 / 8, uploadThroughput: profile.uploadMbps * 1000000 / 8 });
          await cdp.send('Emulation.setCPUThrottlingRate', { rate: profile.cpuRate });
          await login(page, variant.app, owner, status => { loginHttpStatus = status; });
          const workspaceMode = await prepareFullQueryWorkspace(page);
          let dependencyFailed = false;
          for (const cacheState of QUERY_PERFORMANCE_CACHE_STATES) {
            if (!dependencyFailed && cacheState === 'same_document_second_dialogue') {
              setupPhase = 'new_conversation';
              const documentOrigin = await page.evaluate(() => performance.timeOrigin);
              await page.getByRole('button', { name: '新对话', exact: true }).click();
              await page.getByRole('region', { name: '查询结果', exact: true }).waitFor({ state: 'detached' });
              assert.equal(await page.evaluate(() => performance.timeOrigin), documentOrigin, 'NEW_CONVERSATION_RELOADED_DOCUMENT');
            }
            for (const step of QUERY_PERFORMANCE_STEPS) {
              const sample = { variant: variant.name, profile: profile.name, cache_state: cacheState, round: round + 1, step: step.id,
                workspaceMode,
                status: dependencyFailed ? 'dependency_failed' : 'running', phase: dependencyFailed ? 'dependency' : 'query', feedback_ms: null, result_painted_ms: null,
                content_usable_ms: null, source_open_ms: null, source_reopen_ms: null, browser_validation_and_render_ms: null,
                requests: [], networkRequests: [], networkFailures: [], receiptConfirmations: [],
                actualQueryRequests: 0, queryFailures: 0, pageErrors: 0, sourceVerified: false, equivalentResult: null };
              samples.push(sample);
              if (dependencyFailed) { collected.push({ sample, projection: null }); continue; }
              const measured = await measure(page, variant.name, step, sample, ids, dataApiOrigin);
              dependencyFailed = sample.status !== 'success'; collected.push({ sample, projection: measured });
            }
          }
        } catch (error) {
          // Keep every planned sample in the denominator, including login failures.
          for (const cacheState of QUERY_PERFORMANCE_CACHE_STATES) for (const step of QUERY_PERFORMANCE_STEPS) {
            if (collected.some(item => item.sample.cache_state === cacheState && item.sample.step === step.id)) continue;
            const sample = { variant: variant.name, profile: profile.name, cache_state: cacheState, round: round + 1, step: step.id,
              status: 'setup_failed', phase: setupPhase, error: queryPerformanceErrorCode(error), httpStatus: loginHttpStatus,
              feedback_ms: null, content_usable_ms: null };
            samples.push(sample); collected.push({ sample, projection: null });
          }
        } finally { await context?.close(); }
        paired.set(variant.name, collected); await checkpoint();
      }
      if (beforeApp) {
        const before = paired.get('before'), after = paired.get('after');
        for (let i = 0; i < before.length; i++) {
          const a = before[i], b = after[i];
          // An unavailable counterpart is missing evidence, not a factual mismatch.
          if (a.projection === null || b.projection === null) continue;
          const equal = JSON.stringify(a.projection) === JSON.stringify(b.projection);
          a.sample.equivalentResult = b.sample.equivalentResult = equal;
          if (!equal) for (const value of [a.sample, b.sample]) if (value.status === 'success') { value.status = 'result_mismatch'; value.phase = 'equivalence'; }
        }
      }
      await checkpointQueryPerformancePair([...paired.values()].flatMap(items => items.map(item => item.sample)), {
        checkpoint: async failures => {
          if (failures.length) report.stoppedEarly = { reason: 'functional_failure', profile: profile.name, round: round + 1 };
          await checkpoint();
        },
        onFailure: failure => console.error('QUERY_PERFORMANCE_FAILURE ' + JSON.stringify(failure)),
      });
      console.log(`QUERY_PERFORMANCE ${profile.name} pair ${round + 1}/${SAMPLES}`);
    }
    report.complete = true; await checkpoint();
    assert.equal(report.functionalPassed, true, 'QUERY_PERFORMANCE_FUNCTIONAL_FAILURE');
    if (semanticCalls) assert.equal(report.modelCalls, 0, 'UNEXPECTED_MODEL_CALL_IN_BOUNDED_QUERY');
    await verifyMultiMetricQueryPerformance({browser,db,owner,ids,app,output,dataApiOrigin,semanticCalls,login,measure,githubEvent,prepareWorkspace:prepareFullQueryWorkspace});
    return { functionalPassed: report.functionalPassed, budgetsMet: report.budgetsMet, reportPath, summary: report.summary };
  } finally {
    await browser?.close(); await checkpoint();
    await db.query('delete from public.building_metrics where building_id=any($1::uuid[])', [ids]);
    await db.query('delete from public.buildings where id=any($1::uuid[])', [ids]);
  }
}

export async function login(page, app, owner, recordHttpStatus) {
  await page.goto(app + '/login', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => { const form = document.querySelector('form');
    return form && Object.keys(form).some(key => key.startsWith('__reactProps$') && typeof form[key]?.onSubmit === 'function'); });
  await page.getByLabel('企业邮箱').fill(owner.email); await page.getByLabel('手机号').fill(owner.phone);
  await page.getByLabel('密码', { exact: true }).fill(owner.password);
  const [response] = await Promise.all([page.waitForResponse(response => {
    const url = new URL(response.url());
    return url.pathname === '/auth/v1/token' && url.searchParams.get('grant_type') === 'password' && response.request().method() === 'POST';
  }), page.getByRole('button', { name: '登录', exact: true }).click()]);
  recordHttpStatus(response.status());
  // A definite rejected login (including 429) cannot navigate to the homepage.
  // Stop promptly without copying the response body, headers or credentials.
  if (!response.ok()) throw new Error('LOGIN_HTTP_FAILURE');
  await page.waitForURL(url => url.pathname === '/');
  await page.locator('#home-query:enabled').waitFor();
}

/** Prepare the real full-result surface before existing query timings. Old
 * releases have no control and keep their original UI. This is a user action,
 * never DOM/state injection, and does not weaken any result/receipt endpoint. */
export async function prepareFullQueryWorkspace(page, { keepHistory = false } = {}) {
  const mode = await page.locator('#home-query').evaluate(node => node.closest('[data-mode]')?.dataset.mode);
  const history = page.getByRole('complementary', { name: '历史工作记录', exact: true });
  const historyWasOpen = await history.isVisible();
  // A narrow history drawer correctly makes the toolbar inert. Close it through
  // its own control before changing mode, then restore it if the caller needs it.
  const closeDrawer = mode !== 'expanded' && historyWasOpen && await history.evaluate(node =>
    node.closest('#query-workspace-history')?.getAttribute('aria-modal') === 'true');
  if (closeDrawer) {
    await history.getByRole('button', { name: '关闭历史', exact: true }).click();
    await history.waitFor({ state: 'hidden' });
  }
  const expand = page.getByRole('button', { name: mode === 'focus' ? '全屏 Colliers AI 工作空间' : '展开 Colliers AI 工作空间', exact: true });
  if (mode !== 'expanded') {
    if (!await expand.count()) return 'legacy';
    await expand.click();
  }
  await page.waitForFunction(() => {
    const input = document.querySelector('#home-query'), surface = input?.closest('[data-mode]');
    return input && !input.disabled && surface?.dataset.mode === 'expanded' && surface.dataset.transitioning === 'false';
  });
  if (keepHistory && closeDrawer) {
    await page.getByRole('button', { name: '历史记录', exact: true }).click();
    await history.waitFor({ state: 'visible' });
  }
  if (!keepHistory) {
    if (await history.isVisible()) {
      // Finish the initial directory read outside query timing; subsequent real
      // reads/receipts retain their existing network attribution and assertions.
      await page.waitForFunction(() => {
        const panel = document.querySelector('aside[aria-label="历史工作记录"]');
        return panel && !panel.querySelector('[role="status"]')?.textContent.includes('正在读取');
      });
      await history.getByRole('button', { name: '关闭历史', exact: true }).click();
    }
  }
  return 'expanded';
}

export async function measure(page, variant, step, sample, allowedIds, dataApiOrigin, { validateResult, afterReady } = {}) {
  let probeInstalled = false;
  const network = observeQueryNetwork(page, sample, { dataApiOrigin });
  const pageError = () => { sample.pageErrors++; };
  page.on('pageerror', pageError);
  const confirmReceipt = async (stage, matcher) => {
    sample.phase = 'receipt_confirmation'; sample.receiptStage = stage;
    sample.receiptConfirmations.push({ stage, ...await network.waitForReceipt(matcher) });
  };
  try {
    await page.locator('#home-query').fill(step[variant]);
    await page.getByRole('button', { name: '发送问题', exact: true }).scrollIntoViewIfNeeded();
    await page.evaluate(observeQueryConversation, { chartRequired: step.chart, sourceLabelPrefix: step.sourceLabelPrefix }); probeInstalled = true;
    const [response] = await Promise.all([page.waitForResponse(response => new URL(response.url()).pathname === '/api/intelligence/query' && response.request().method() === 'POST'),
      page.getByRole('button', { name: '发送问题', exact: true }).click()]); sample.httpStatus = response.status();
    assert.equal(response.status(), 200, 'QUERY_NOT_READY');
    const body = await response.json(); assert.equal(body.status, 'ready', 'QUERY_NOT_READY');
    assert.equal(body.result.operation, step.operation, 'UNEXPECTED_QUERY_PLAN');
    if (validateResult) await validateResult(body.result);
    assert.ok(body.result.sources.every(source => allowedIds.includes(source.entityId)), 'SOURCE_OUTSIDE_GRANTED_FIXTURE');
    assert.ok(body.conversation?.id, 'MISSING_CONVERSATION');
    await page.waitForFunction(() => ['ready', 'timeout'].includes(window.__colliersQueryPerformance?.state.status), null, { timeout: 35000 });
    assert.equal(await page.evaluate(() => window.__colliersQueryPerformance.state.status), 'ready', 'RESULT_READINESS_TIMEOUT');
    // Opening a source changes answer_table.view.sourceIds and deliberately
    // aborts the obsolete view's pending DOM receipt. Confirm that real receipt
    // first; the already captured result paint measurement remains unchanged.
    await confirmReceipt('initial_result', { surface: 'answer_table', sourceCount: 'empty' });
    if (step.chart) await confirmReceipt('initial_chart', { surface: 'chart' });
    await network.waitForIdle();
    if (afterReady) await afterReady({ page, sample, network, result: body.result, confirmReceipt });
    sample.phase = 'source_interaction';
    const prefix = step.sourceLabelPrefix ?? '查看来源：面积加权净有效租金 ';
    const source = page.getByRole('region', { name: '查询结果', exact: true }).getByRole('button', { name: new RegExp('^' + prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')) }).first();
    let receiptCursor = network.cursor();
    await source.click();
    const panel = page.getByRole('region', { name: '来源详情', exact: true }); await panel.waitFor();
    assert.match(await panel.innerText(), /building_metrics/, 'DATABASE_SOURCE_NOT_VISIBLE');
    await page.waitForFunction(() => window.__colliersQueryPerformance.state.source_open_ms.length >= 1);
    sample.sourceVerified = true;
    await confirmReceipt('source_open', { after: receiptCursor, surface: 'answer_table', sourceCount: 'present' });
    receiptCursor = network.cursor();
    await panel.getByRole('button', { name: '关闭来源', exact: true }).click();
    await confirmReceipt('source_close', { after: receiptCursor, surface: 'answer_table', sourceCount: 'empty' });
    if (step.id === 'four_quarter_trend' || step.reopenSource) {
      sample.phase = 'source_interaction'; receiptCursor = network.cursor();
      await source.click(); await panel.waitFor();
      await page.waitForFunction(() => window.__colliersQueryPerformance.state.source_open_ms.length >= 2);
      await confirmReceipt('source_reopen', { after: receiptCursor, surface: 'answer_table', sourceCount: 'present' });
      receiptCursor = network.cursor();
      await panel.getByRole('button', { name: '关闭来源', exact: true }).click();
      await confirmReceipt('source_reclose', { after: receiptCursor, surface: 'answer_table', sourceCount: 'empty' });
    }
    await network.waitForIdle();
    assert.equal(sample.actualQueryRequests, 1, 'DUPLICATE_QUERY_SUBMISSION');
    assert.equal(sample.queryFailures, 0, 'QUERY_NETWORK_FAILURE');
    assert.equal(sample.networkFailures.filter(failure => failure.httpStatus >= 400).length, 0, 'QUERY_BACKGROUND_HTTP_FAILURE');
    assert.equal(sample.pageErrors, 0, 'QUERY_BROWSER_ERROR');
    sample.status = 'success'; sample.phase = 'complete';
    return numericProjection(body.result);
  } catch (error) { sample.status = 'failed'; sample.error = queryPerformanceErrorCode(error); return null; }
  finally {
    if (probeInstalled) {
      const measurement = await page.evaluate(() => { const probe = window.__colliersQueryPerformance; const result = probe.read(); probe.stop(); return result; }).catch(() => null);
      if (measurement) Object.assign(sample, { feedback_ms: measurement.feedback_ms, result_painted_ms: measurement.result_painted_ms,
        content_usable_ms: measurement.content_usable_ms, source_open_ms: measurement.source_open_ms[0] ?? null,
        source_reopen_ms: measurement.source_open_ms[1] ?? null, browser_validation_and_render_ms: measurement.browser_validation_and_render_ms,
        requests: measurement.requests });
    }
    network.stop(); page.off('pageerror', pageError);
  }
}
