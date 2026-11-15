import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { grantQuery } from '../../supabase/tests/ai-query-authority/database.mjs';
import { login } from './verify-ai-query-conversation.mjs';
import { nearestRank, QUERY_PERFORMANCE_PROFILES, queryPerformanceRevision } from './query-conversation-probe.mjs';

const require = createRequire(import.meta.url);
export const P2_WORKSPACE_SAMPLES = 20;
export const P2_WORKSPACE_SCENARIOS = Object.freeze([
  'history_list', 'history_next_page', 'history_snapshot', 'history_earlier_turns',
  'summary_open', 'summary_reopen', 'copy_conclusion', 'buildings_snapshot', 'buildings_next_page',
]);
const fields = ['feedback_ms', 'content_usable_ms', 'long_task_count', 'long_task_total_ms', 'long_task_max_ms'];
const question = '2026Q3CBD净有效租金';
const buildingsQuestion = '比较选中楼宇最新有数据季度的净有效租金和空置面积';
const endpoints = new Map([
  ['/api/intelligence/query', 'submit'], ['/api/intelligence/query/history', 'history'],
  ['/api/intelligence/query/buildings', 'buildings'], ['/api/intelligence/query/artifact', 'artifact'],
  ['/api/intelligence/query/receipt', 'receipt'], ['/api/intelligence/query/capabilities', 'capabilities'],
  ['/api/intelligence/query/recover', 'recover'],
]);

/** Missing/failed samples stay in the denominator; measurements from a different
 * scenario or viewport never fill an incomplete condition. */
export function summarizeP2WorkspacePerformance(samples) {
  return QUERY_PERFORMANCE_PROFILES.flatMap(profile => P2_WORKSPACE_SCENARIOS.map(scenario => {
    const rows = samples.filter(sample => sample.profile === profile.name && sample.scenario === scenario);
    const metrics = Object.fromEntries(fields.map(field => {
      const values = rows.filter(row => row.status === 'success' && Number.isFinite(row[field])).map(row => row[field]);
      return [field, { measured: values.length, missing: rows.length - values.length,
        p50: nearestRank(values, .5), p90: nearestRank(values, .9) }];
    }));
    const complete = rows.length === P2_WORKSPACE_SAMPLES && rows.every(row => row.status === 'success'
      && row.factsVerified && row.boundedRenderingVerified && row.requestsVerified && row.receiptsVerified
      && row.longTaskObserverSupported && fields.every(field => Number.isFinite(row[field])));
    const usable = scenario === 'summary_reopen' ? 500 : profile.usableP90Ms;
    return { profile: profile.name, scenario, expected: P2_WORKSPACE_SAMPLES, observed: rows.length,
      failed: rows.filter(row => row.status !== 'success').length, missingSamples: Math.max(0, P2_WORKSPACE_SAMPLES - rows.length),
      measurementComplete: complete, metrics, budget: { feedbackP90Ms: 100, contentUsableP90Ms: usable },
      budgetsMet: complete && metrics.feedback_ms.p90 <= 100 && metrics.content_usable_ms.p90 <= usable };
  }));
}

export function p2WorkspaceErrorCode(error) {
  if (error?.name === 'TimeoutError') return 'P2_BROWSER_TIMEOUT';
  const code = typeof error?.message === 'string' ? error.message.split('\n')[0] : '';
  return /^(?:P2_[A-Z_]+|LOGIN_HTTP_FAILURE)$/.test(code) ? code : 'P2_OPERATION_FAILED';
}

/** Runs inside the actual document. It observes DOM, paint, resource timing and
 * Long Tasks only; it cannot change Auth, query data, routes or application state.
 * A busy control is feedback, never the content-ready endpoint. */
export function observeP2WorkspaceAction({ mode, triggerText, triggerAria, expectedCount, expectedTitle, expectedNames = [], timeoutMs = 30000 }) {
  window.__colliersP2Workspace?.stop();
  performance.setResourceTimingBufferSize(1000);
  const state = { start: null, status: 'waiting', feedback_ms: null, content_usable_ms: null,
    longTaskObserverSupported: PerformanceObserver.supportedEntryTypes.includes('longtask') };
  let stopped = false, frame, paintPending = false;
  const tasks = [];
  const observer = state.longTaskObserverSupported ? new PerformanceObserver(list => {
    for (const entry of list.getEntries()) tasks.push({ start: entry.startTime, duration: entry.duration });
  }) : null;
  observer?.observe({ type: 'longtask', buffered: false });
  const visible = node => {
    if (!node?.isConnected) return false;
    const box = node.getBoundingClientRect(), style = getComputedStyle(node);
    return box.width > 0 && box.height > 0 && style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0';
  };
  const panel = () => document.querySelector('aside[aria-label="历史工作记录"]');
  const result = () => document.querySelector('section[aria-label="查询结果"]');
  const cards = () => document.querySelector('section[aria-label="查询楼宇信息"]');
  const buttons = (root, prefix) => [...(root?.querySelectorAll('button[aria-label]') ?? [])].filter(node => node.getAttribute('aria-label').startsWith(prefix));
  const oldResult = result(), oldFirst = panel()?.querySelector('button[aria-label^="打开对话："]')?.getAttribute('aria-label');
  const ready = () => {
    if (mode === 'history_list' || mode === 'history_page') {
      const list = buttons(panel(), '打开对话：');
      return visible(panel()) && list.length === expectedCount && list.every(node => !node.disabled)
        && (mode !== 'history_page' || list[0]?.getAttribute('aria-label') !== oldFirst)
        && (!expectedTitle || list.some(node => node.getAttribute('aria-label') === `打开对话：${expectedTitle}`));
    }
    if (mode === 'history_snapshot' || mode === 'history_turns') {
      const current = result(), turns = buttons(panel(), '查看记录：');
      const number = current?.querySelector('section[aria-label="核心指标"] button');
      return current !== oldResult && visible(current) && visible(number) && !number.disabled
        && turns.length === expectedCount && turns.every(node => !node.disabled);
    }
    if (mode === 'summary') {
      const section = document.querySelector('section[aria-label="市场分析摘要"]');
      return visible(section) && Boolean(section.querySelector('pre')?.textContent.trim())
        && [...section.querySelectorAll('button')].some(node => node.textContent === '收起摘要' && !node.disabled);
    }
    if (mode === 'copy') return [...document.querySelectorAll('[role="status"]')].some(node => visible(node) && node.textContent.startsWith('已复制，'))
      && [...document.querySelectorAll('button')].some(node => node.textContent === '复制结论' && !node.disabled);
    if (mode === 'buildings_snapshot' || mode === 'buildings_page') {
      const section = cards(), articles = [...(section?.querySelectorAll('article[aria-label$="楼宇卡片"]') ?? [])];
      return visible(section) && articles.length === expectedCount && articles.every((node, index) => visible(node)
        && node.getAttribute('aria-label') === `${expectedNames[index]}楼宇卡片` && node.querySelector('a[href^="/map?"]'))
        && (mode !== 'buildings_snapshot' || result() !== oldResult)
        && ![...(section?.querySelectorAll('[role="status"]') ?? [])].some(visible);
    }
    return false;
  };
  const feedback = () => {
    if (ready()) return true;
    if (mode.startsWith('history')) return visible(panel()) && [...panel().querySelectorAll('[role="status"]')]
      .some(node => visible(node) && node.textContent.includes('正在读取'));
    if (mode === 'copy') return [...document.querySelectorAll('[role="status"]')]
      .some(node => visible(node) && node.textContent.includes('正在核对复制权限'));
    if (mode.startsWith('buildings')) return [...document.querySelectorAll('[role="status"]')]
      .some(node => visible(node) && /正在读取本人|正在打开楼宇|正在核对楼宇/.test(node.textContent));
    return false;
  };
  const click = event => {
    const button = event.target?.closest?.('button');
    if (state.start === null && button && (triggerAria ? button.getAttribute('aria-label') === triggerAria : button.textContent.trim() === triggerText)) {
      state.start = performance.now(); state.status = 'running';
    }
  };
  const tick = () => {
    if (stopped) return;
    if (state.start !== null) {
      if (!paintPending && (feedback() || ready())) {
        paintPending = true;
        requestAnimationFrame(() => {
          paintPending = false;
          if (stopped) return;
          if (state.feedback_ms === null && feedback()) state.feedback_ms = performance.now() - state.start;
          if (state.content_usable_ms === null && ready()) state.content_usable_ms = performance.now() - state.start;
          if (state.feedback_ms !== null && state.content_usable_ms !== null) state.status = 'ready';
        });
      }
      if (state.status !== 'ready' && performance.now() - state.start >= timeoutMs) state.status = 'timeout';
    }
    frame = requestAnimationFrame(tick);
  };
  const stop = () => { stopped = true; cancelAnimationFrame(frame); observer?.disconnect(); document.removeEventListener('click', click, true); };
  document.addEventListener('click', click, true); frame = requestAnimationFrame(tick);
  window.__colliersP2Workspace = { state, stop, read: () => {
    const end = state.content_usable_ms === null ? performance.now() : state.start + state.content_usable_ms;
    const measuredTasks = tasks.filter(task => state.start !== null && task.start >= state.start && task.start <= end);
    const classify = pathname => ({ '/api/intelligence/query': 'submit', '/api/intelligence/query/history': 'history',
      '/api/intelligence/query/artifact': 'artifact', '/api/intelligence/query/buildings': 'buildings', '/api/intelligence/query/receipt': 'receipt' })[pathname];
    const resources = performance.getEntriesByType('resource').flatMap(entry => {
      const url = new URL(entry.name), kind = url.origin === location.origin ? classify(url.pathname) : null;
      if (!kind || state.start === null || entry.startTime < state.start || entry.startTime > end) return [];
      return [{ kind, request_start_ms: entry.startTime - state.start,
        response_start_ms: entry.responseStart > 0 ? entry.responseStart - state.start : null,
        response_end_ms: entry.responseEnd > 0 ? entry.responseEnd - state.start : null,
        request_to_first_byte_ms: entry.responseStart > 0 && entry.requestStart > 0 ? entry.responseStart - entry.requestStart : null,
        transfer_ms: entry.responseEnd > 0 && entry.responseStart > 0 ? entry.responseEnd - entry.responseStart : null,
        encoded_body_bytes: entry.encodedBodySize, decoded_body_bytes: entry.decodedBodySize }];
    });
    const business = resources.filter(resource => !['receipt', 'submit'].includes(resource.kind));
    const lastResponse = business.length ? Math.max(...business.map(resource => resource.response_end_ms ?? 0)) : null;
    return { ...state, resources, long_task_count: measuredTasks.length,
      long_task_total_ms: measuredTasks.reduce((sum, task) => sum + task.duration, 0),
      long_task_max_ms: Math.max(0, ...measuredTasks.map(task => task.duration)),
      browser_validation_and_render_ms: lastResponse !== null && state.content_usable_ms !== null ? state.content_usable_ms - lastResponse : null,
      mounted: { historyEntries: buttons(panel(), '打开对话：').length, historyTurns: buttons(panel(), '查看记录：').length,
        buildingCards: cards()?.querySelectorAll('article[aria-label$="楼宇卡片"]').length ?? 0,
        resultRows: result()?.querySelectorAll('table tbody tr').length ?? 0, results: document.querySelectorAll('section[aria-label="查询结果"]').length,
        domNodes: document.getElementsByTagName('*').length } };
  } };
}

// Only allowlisted shapes are persisted. Receipt tokens remain in this closure
// solely to match each observed acknowledgement to its actual response.
function observeP2Network(page, sample, dataApiOrigin) {
  const origin = new URL(page.url()).origin, requests = new Map(), listeners = new Set();
  let stopped = false;
  const notify = () => { for (const listener of listeners) listener(); };
  const category = request => {
    const url = new URL(request.url());
    return url.origin === origin ? endpoints.get(url.pathname) ?? (url.pathname.startsWith('/_next/') ? 'application_asset' : 'application_other')
      : url.origin === dataApiOrigin ? 'data_api' : 'external';
  };
  const onRequest = request => {
    const kind = category(request), critical = endpoints.has(new URL(request.url()).pathname) && new URL(request.url()).origin === origin;
    const record = { kind, method: request.method(), critical, status: 'pending', httpStatus: null };
    let token = null;
    if (kind === 'receipt') {
      try { const body = request.postDataJSON(); token = body.deliveryToken;
        record.phase = ['client_received', 'client_dom_committed', 'browser_download_dispatched'].includes(body.phase) ? body.phase : 'unknown';
        record.surface = ['answer_table', 'chart', 'clarification'].includes(body.view?.surface) ? body.view.surface : null;
      } catch { /* Invalid bodies are rejected by the real endpoint. */ }
    }
    requests.set(request, { record, token }); sample.networkRequests.push(record); notify();
  };
  const onResponse = response => {
    const entry = requests.get(response.request()), status = response.status();
    if (entry) entry.record.httpStatus = status;
    if (status >= 400) sample.networkFailures.push({ kind: category(response.request()), httpStatus: status, error: `HTTP_${status}` });
    notify();
  };
  const onFinished = request => { const entry = requests.get(request); if (entry) entry.record.status = 'finished'; notify(); };
  const onFailed = request => {
    const entry = requests.get(request); if (entry) entry.record.status = 'failed';
    const raw = request.failure()?.errorText;
    sample.networkFailures.push({ kind: category(request), critical: entry?.record.critical === true,
      error: /^net::ERR_[A-Z0-9_]+$/.test(raw ?? '') ? raw : 'NETWORK_REQUEST_FAILED' }); notify();
  };
  const wait = (predicate, code) => new Promise((resolve, reject) => {
    const cleanup = () => { clearTimeout(timer); listeners.delete(poll); };
    const poll = () => { if (stopped) { cleanup(); reject(new Error('P2_OBSERVER_STOPPED')); }
      else if (predicate()) { cleanup(); resolve(); } };
    const timer = setTimeout(() => { cleanup(); reject(new Error(code)); }, 12000);
    listeners.add(poll); poll();
  });
  page.on('request', onRequest); page.on('response', onResponse); page.on('requestfinished', onFinished); page.on('requestfailed', onFailed);
  return {
    idle: () => wait(() => ![...requests.values()].some(({ record }) => record.critical && record.status === 'pending'), 'P2_NETWORK_INCOMPLETE'),
    receipt: async (response, phase = 'client_received', surface = null) => {
      const token = await response.headerValue('x-query-delivery-token'); assert.ok(token, 'P2_RECEIPT_MISSING');
      await wait(() => [...requests.values()].some(entry => entry.token === token && entry.record.phase === phase
        && (!surface || entry.record.surface === surface) && entry.record.status === 'finished' && entry.record.httpStatus === 200), 'P2_RECEIPT_INCOMPLETE');
      sample.receiptConfirmations.push({ phase, surface, httpStatus: 200 });
    },
    stop: () => { stopped = true; notify(); page.off('request', onRequest); page.off('response', onResponse);
      page.off('requestfinished', onFinished); page.off('requestfailed', onFailed); requests.clear(); },
  };
}

async function activate(locator, profile) {
  await locator.scrollIntoViewIfNeeded();
  if (profile.name === 'mobile') await locator.tap();
  else { await locator.focus(); await locator.press('Enter'); }
}
const responseFor = (page, endpoint, action) => page.waitForResponse(response => {
  const request = response.request();
  return new URL(response.url()).pathname === endpoint && request.method() === 'POST' && request.postDataJSON()?.action === action;
});
async function responseBody(response) {
  assert.equal(response.status(), 200, 'P2_HTTP_NOT_READY');
  const body = await response.json(); assert.equal(body.status, 'ready', 'P2_HTTP_NOT_READY'); return body;
}
async function unmeasuredRequest({ page, profile, dataApiOrigin, locator, endpoint, action, verify }) {
  const evidence = { networkRequests: [], networkFailures: [], receiptConfirmations: [] };
  const network = observeP2Network(page, evidence, dataApiOrigin);
  try {
    const [response] = await Promise.all([responseFor(page, endpoint, action), activate(locator, profile)]);
    const body = await responseBody(response);
    await verify?.(body); await network.receipt(response); await network.idle();
    assert.ok(evidence.networkFailures.every(failure => !failure.critical && !failure.httpStatus), 'P2_NETWORK_FAILURE');
    return body;
  } finally { network.stop(); }
}
function validateOriginal(actual, expected, ids) {
  assert.deepEqual(actual, expected, 'P2_ORIGINAL_SNAPSHOT_CHANGED');
  assert.ok(actual.sources.every(source => ids.includes(source.entityId)), 'P2_SOURCE_OUTSIDE_FIXTURE');
}

async function measureAction({ page, profile, round, samples, dataApiOrigin, scenario, locator, probe, run, verify, expectedRequests }) {
  const sample = { variant: 'after', profile: profile.name, round, scenario, status: 'running',
    activation: profile.name === 'mobile' ? 'touch' : 'keyboard', networkRequests: [], networkFailures: [], receiptConfirmations: [], pageErrors: 0,
    factsVerified: false, boundedRenderingVerified: false, requestsVerified: false, receiptsVerified: false };
  samples.push(sample);
  const network = observeP2Network(page, sample, dataApiOrigin), pageError = () => sample.pageErrors++;
  page.on('pageerror', pageError);
  try {
    await locator.scrollIntoViewIfNeeded();
    await page.evaluate(observeP2WorkspaceAction, probe);
    const value = await run(() => activate(locator, profile), network);
    await page.waitForFunction(() => ['ready', 'timeout'].includes(window.__colliersP2Workspace?.state.status), null, { timeout: 35000 });
    assert.equal(await page.evaluate(() => window.__colliersP2Workspace.state.status), 'ready', 'P2_CONTENT_NOT_USABLE');
    await verify(value, network, sample); sample.factsVerified = true;
    await network.idle();
    const measured = await page.evaluate(() => window.__colliersP2Workspace.read());
    Object.assign(sample, measured); delete sample.start;
    assert.ok(measured.mounted.historyEntries <= 15 && measured.mounted.historyTurns <= 10 && measured.mounted.buildingCards <= 5
      && measured.mounted.resultRows <= 25 && measured.mounted.results === (scenario.startsWith('history_') && ['history_list', 'history_next_page'].includes(scenario) ? 0 : 1), 'P2_UNBOUNDED_RENDER');
    sample.boundedRenderingVerified = true;
    for (const kind of ['submit', 'history', 'buildings', 'artifact', 'recover']) {
      const count = sample.networkRequests.filter(item => item.kind === kind && item.method === 'POST').length;
      assert.equal(count, expectedRequests[kind] ?? 0, 'P2_DUPLICATE_OR_UNEXPECTED_REQUEST');
    }
    assert.equal(sample.pageErrors, 0, 'P2_BROWSER_ERROR');
    assert.ok(sample.networkFailures.every(failure => !failure.critical && !failure.httpStatus), 'P2_NETWORK_FAILURE');
    sample.requestsVerified = true; sample.receiptsVerified = true; sample.status = 'success';
  } catch (error) { sample.status = 'failed'; sample.error = p2WorkspaceErrorCode(error); throw error; }
  finally {
    const partial = await page.evaluate(() => window.__colliersP2Workspace?.read()).catch(() => null);
    if (partial && sample.status !== 'success') { const status = sample.status; Object.assign(sample, partial); delete sample.start; sample.status = status; }
    await page.evaluate(() => window.__colliersP2Workspace?.stop()).catch(() => {});
    network.stop(); page.off('pageerror', pageError);
  }
  return sample;
}

async function seedWorkspace({ db, person, call, exportCaps, ids }) {
  for (const [index, id] of ids.entries()) {
    await db.query(`insert into public.buildings(id,name,submarket,grade,location_lng,location_lat)
      values($1,$2,'CBD','A',$3,$4)`, [id, `P2性能合成${String(index + 1).padStart(2, '0')}座`, index >= 10 ? null : 116.4 + index * .001, index >= 10 ? null : 39.9]);
    await db.query(`insert into public.building_metrics(building_id,record_year,record_quarter,total_area,net_effective_rent,vacant_area,is_draft)
      values($1,2026,3,10000,$2,1000,false)`, [id, 100 + index * 10]);
    await db.query('insert into public.building_brochure_data(building_id,building_height) values($1,$2)', [id, index >= 10 ? null : 200 + index]);
  }
  const owner = await person('admin', 'p2-workspace-performance'); owner.phone = '10000000000';
  await db.query('update public.user_roles set phone=$1 where user_id=$2', [owner.phone, owner.id]);
  await grantQuery({ setup: db }, owner.id, { capabilities: exportCaps, allSubmarkets: false, submarkets: ['CBD'], allBuildings: false, buildingIds: ids });
  const expectedRent = (await db.query(`select sum(total_area::numeric * net_effective_rent::numeric) / sum(total_area::numeric) value
    from public.building_metrics where building_id=any($1::uuid[]) and record_year=2026 and record_quarter=3 and not is_draft`, [ids])).rows[0].value;
  assert.equal(Number(expectedRent), 155, 'P2_FIXTURE_INVALID');
  const check = response => {
    assert.equal(response.status, 200, 'P2_SEED_QUERY_FAILED'); assert.equal(response.body.status, 'ready', 'P2_SEED_QUERY_FAILED');
    assert.equal(response.body.historySaved, true, 'P2_HISTORY_MIGRATION_REQUIRED'); return response.body;
  };
  for (let index = 0; index < 14; index++) check(await call(owner, { idempotencyKey: randomUUID(), question: `P2性能历史会话${index + 1}`,
    plan: { operation: 'aggregate', scope: { inventory: 'tracked', submarkets: ['CBD'] }, metric: 'rent', period: { year: 2026, quarter: 3 } } }));
  const conversationId = randomUUID(), turns = []; let parentRequestId;
  for (let index = 0; index < 12; index++) {
    const body = check(await call(owner, { idempotencyKey: randomUUID(), question,
      conversation: { id: conversationId, ...(parentRequestId ? { parentRequestId } : {}) } }));
    assert.equal(body.result.table.rows[0].cells.value.value.numeric, Number(expectedRent), 'P2_FIXTURE_ORACLE_MISMATCH');
    turns.push(body); parentRequestId = body.requestId;
  }
  const buildings = check(await call(owner, { idempotencyKey: randomUUID(), question: buildingsQuestion, conversation: { id: randomUUID() },
    buildingSelection: { ids, intent: 'compare' } }));
  assert.equal(buildings.result.table.rows.length, ids.length, 'P2_FIXTURE_INVALID');
  assert.deepEqual(buildings.result.table.rows.map(row => row.entityId).sort(), [...ids].sort(), 'P2_FIXTURE_IDENTITY_MISMATCH');
  // Intentionally change a disposable source AFTER saving every query. The
  // browser must open/copy the original 155 snapshot, never this new average.
  await db.query('update public.building_metrics set net_effective_rent=9999 where building_id=$1 and record_year=2026 and record_quarter=3', [ids[0]]);
  return { owner, turns, buildings };
}

/** Entry point for verify-ai-query-auth.mjs after the real P2 schema/scenarios.
 * No replacement routes, fake sessions, app-state injection or model calls.
 * All records and credentials live only in the disposable guarded local stack. */
export async function verifyP2WorkspacePerformance({ db, person, app, output, exportCaps, semanticCalls, dataApiOrigin, call }) {
  assert.equal(process.env.AI_QUERY_AUTH_ALLOW_LOCAL, 'disposable');
  assert.equal(db.connectionParameters.host, '127.0.0.1'); assert.equal(Number(db.connectionParameters.port), 55992);
  assert.ok(['127.0.0.1', 'localhost'].includes(new URL(app).hostname));
  await mkdir(output, { recursive: true });
  const samples = [], ids = Array.from({ length: 12 }, () => randomUUID()).sort(), modelStart = semanticCalls?.();
  const githubEvent = process.env.GITHUB_EVENT_PATH ? JSON.parse(await readFile(process.env.GITHUB_EVENT_PATH, 'utf8')) : null;
  const reportPath = path.join(output, 'p2-workspace-performance.json');
  const report = { version: 'query-p2-workspace-performance/1', suite: 'p2_workspace', ...queryPerformanceRevision(process.env, githubEvent),
    production: false, productionBuild: true, realPhone: false, manualVisualReview: false,
    baseline: 'New P2 workspace paths have no published before equivalent. No before values or improvement percentages are invented. Existing P1 A/B and cross-trend suites remain separate requirements.',
    fixture: { buildings: 12, quarterlyRecords: 12, quarters: ['2026Q3'], conversations: 16, formallySubmittedQueries: 27, longestConversationTurns: 12,
      visibleHistoryPageLimit: 15, visibleTurnLimit: 10, visibleBuildingLimit: 5, originalAreaWeightedRent: 155, changedSourceAfterSnapshot: true, missingCoordinates: 2, missingHeights: 2, realPhotos: 0 },
    profiles: QUERY_PERFORMANCE_PROFILES, samplesPerCondition: P2_WORKSPACE_SAMPLES, scenarios: P2_WORKSPACE_SCENARIOS,
    cacheDefinition: 'New browser context and real login for each round. First history open and first dynamic building-card module in that document are cold client paths; API/database/Next process are warm. Summary reopen uses the same already loaded result. No server cold-start or physical-device claim.',
    endpoints: { start: 'Actual trusted keyboard/touch click event', feedback: 'Visible progress or actual content on a following animation frame',
      content: 'Enabled history controls/original numeric result, complete summary, clipboard success, or five actual identity-bound cards painted on a following frame',
      copy: 'Backend authorization and immutable text -> real Clipboard API -> visible success; clipboard read is checked separately',
      receipts: 'Each real response client_received and selected answer_table DOM acknowledgement completes before changing the view',
      longTasks: 'Long Tasks API entries between activation and usable content; P50/P90 count/total/max reported, including zero observations' },
    boundaries: 'Real local GoTrue/PostgreSQL/Data API/Next production build, scoped synthetic admin, real HTTP and DOM receipts. CDP throttles browser network/CPU only. No screenshots, Auth tokens, body contents, question text, source IDs or signed URLs are written to this report.',
    budgets: { feedbackP90Ms: 100, desktopContentUsableP90Ms: 2500, mobileContentUsableP90Ms: 3500, loadedSummaryReopenP90Ms: 500 },
    samples, summary: [], modelCalls: null, complete: false, functionalPassed: false, budgetsMet: false };
  const checkpoint = async () => {
    report.summary = summarizeP2WorkspacePerformance(samples);
    report.functionalPassed = report.summary.every(group => group.measurementComplete);
    report.budgetsMet = report.summary.every(group => group.budgetsMet);
    report.modelCalls = semanticCalls ? semanticCalls() - modelStart : null;
    await writeFile(reportPath, JSON.stringify(report, null, 2) + '\n');
  };
  let browser;
  try {
    const fixture = await seedWorkspace({ db, person, call, exportCaps, ids });
    const { chromium } = require(process.env.PERF_PLAYWRIGHT_MODULE || 'playwright-core');
    browser = await chromium.launch({ headless: true,
      ...(process.env.PERF_BROWSER_EXECUTABLE_PATH ? { executablePath: process.env.PERF_BROWSER_EXECUTABLE_PATH } : {}),
      ...(process.env.PERF_BROWSER_CHANNEL ? { channel: process.env.PERF_BROWSER_CHANNEL } : {}) });
    report.browser = await browser.version();
    for (const profile of QUERY_PERFORMANCE_PROFILES) for (let round = 1; round <= P2_WORKSPACE_SAMPLES; round++) {
      const context = await browser.newContext({ viewport: { width: profile.width, height: profile.height }, isMobile: profile.name === 'mobile',
        hasTouch: profile.name === 'mobile', timezoneId: 'Asia/Shanghai', serviceWorkers: 'block' });
      let loginHttpStatus = null;
      try {
        await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: app });
        const page = await context.newPage(); page.setDefaultTimeout(30000);
        const cdp = await context.newCDPSession(page); await cdp.send('Network.enable');
        await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: profile.latencyMs,
          downloadThroughput: profile.downloadMbps * 1000000 / 8, uploadThroughput: profile.uploadMbps * 1000000 / 8 });
        await cdp.send('Emulation.setCPUThrottlingRate', { rate: profile.cpuRate });
        await login(page, app, fixture.owner, value => { loginHttpStatus = value; });
        const measure = options => measureAction({ page, profile, round, samples, dataApiOrigin, ...options });
        const history = page.getByRole('complementary', { name: '历史工作记录', exact: true });
        const result = page.getByRole('region', { name: '查询结果', exact: true });
        const historyRequest = async (activateAction, network, action, verify) => {
          const [response] = await Promise.all([responseFor(page, '/api/intelligence/query/history', action), activateAction()]);
          const body = await responseBody(response); await verify?.(body);
          await network.receipt(response);
          if (action === 'open') await network.receipt(response, 'client_dom_committed', 'answer_table');
          return body;
        };
        await measure({ scenario: 'history_list', locator: page.getByRole('button', { name: '历史记录', exact: true }),
          probe: { mode: 'history_list', triggerText: '历史记录', expectedCount: 15, expectedTitle: question }, expectedRequests: { history: 1 },
          run: (activateAction, network) => historyRequest(activateAction, network, 'list'),
          verify: async body => { assert.equal(body.page.entries.length, 15, 'P2_HISTORY_PAGE_MISMATCH'); assert.equal(body.page.hasMore, true, 'P2_HISTORY_PAGE_MISMATCH'); } });
        await measure({ scenario: 'history_next_page', locator: history.getByRole('button', { name: '下一页记录', exact: true }),
          probe: { mode: 'history_page', triggerText: '下一页记录', expectedCount: 1 }, expectedRequests: { history: 1 },
          run: (activateAction, network) => historyRequest(activateAction, network, 'list'),
          verify: async body => { assert.equal(body.page.entries.length, 1, 'P2_HISTORY_PAGE_MISMATCH'); assert.equal(body.page.hasMore, false, 'P2_HISTORY_PAGE_MISMATCH'); } });
        // Restore the first metadata page through its normal UI; it is setup for
        // the next measured condition, not a sample or a fabricated warm cache.
        await unmeasuredRequest({ page, profile, dataApiOrigin, locator: history.getByRole('button', { name: '上一页记录', exact: true }),
          endpoint: '/api/intelligence/query/history', action: 'list' });
        await history.getByRole('button', { name: `打开对话：${question}`, exact: true }).waitFor();
        let selectedResult = fixture.turns.at(-1).result;
        await measure({ scenario: 'history_snapshot', locator: history.getByRole('button', { name: `打开对话：${question}`, exact: true }),
          probe: { mode: 'history_snapshot', triggerAria: `打开对话：${question}`, expectedCount: 10 }, expectedRequests: { history: 1 },
          run: (activateAction, network) => historyRequest(activateAction, network, 'open'),
          verify: async body => { assert.equal(body.opened.turns.length, 10, 'P2_HISTORY_TURN_MISMATCH'); assert.equal(body.opened.hasMore, true, 'P2_HISTORY_TURN_MISMATCH');
            validateOriginal(body.opened.selected.reply.result, selectedResult, ids); assert.match(await result.innerText(), /155/, 'P2_ORIGINAL_SNAPSHOT_CHANGED'); } });
        await measure({ scenario: 'history_earlier_turns', locator: history.getByRole('button', { name: '查看更早提问', exact: true }),
          probe: { mode: 'history_turns', triggerText: '查看更早提问', expectedCount: 2 }, expectedRequests: { history: 1 },
          run: (activateAction, network) => historyRequest(activateAction, network, 'open'),
          verify: async body => { assert.equal(body.opened.turns.length, 2, 'P2_HISTORY_TURN_MISMATCH'); assert.equal(body.opened.hasMore, false, 'P2_HISTORY_TURN_MISMATCH');
            const saved = fixture.turns.find(turn => turn.requestId === body.opened.selected.requestId); assert.ok(saved, 'P2_HISTORY_TURN_MISMATCH');
            selectedResult = saved.result; validateOriginal(body.opened.selected.reply.result, selectedResult, ids); } });
        const menu = result.locator('details').filter({ has: page.locator('summary', { hasText: '更多操作' }) });
        await activate(menu.locator('summary'), profile);
        for (const scenario of ['summary_open', 'summary_reopen']) {
          await measure({ scenario, locator: result.getByRole('button', { name: '生成分析摘要', exact: true }),
            probe: { mode: 'summary', triggerText: '生成分析摘要' }, expectedRequests: {},
            run: async activateAction => { await activateAction(); },
            verify: async () => { const summary = result.getByRole('region', { name: '市场分析摘要', exact: true });
              const text = await summary.locator('pre').innerText(); assert.match(text, /2026Q3/, 'P2_SUMMARY_PERIOD_MISSING');
              assert.match(text, /155/, 'P2_SUMMARY_VALUE_MISMATCH'); assert.match(text, /元\/㎡\/月/, 'P2_SUMMARY_UNIT_MISSING');
              assert.match(text, /有效 12 栋/, 'P2_SUMMARY_SAMPLE_MISSING'); assert.match(text, /数据库|原始/, 'P2_SUMMARY_SOURCE_LIMIT_MISSING');
              assert.equal(await summary.evaluate(node => document.activeElement === node), true, 'P2_SUMMARY_FOCUS_MISSING'); } });
          await activate(result.getByRole('button', { name: '收起摘要', exact: true }), profile);
          assert.equal(await result.getByRole('button', { name: '生成分析摘要', exact: true }).evaluate(node => document.activeElement === node), true, 'P2_SUMMARY_FOCUS_MISSING');
        }
        await measure({ scenario: 'copy_conclusion', locator: result.getByRole('button', { name: '复制结论', exact: true }),
          probe: { mode: 'copy', triggerText: '复制结论' }, expectedRequests: { artifact: 1 },
          run: async (activateAction, network) => {
            const [response] = await Promise.all([responseFor(page, '/api/intelligence/query/artifact', 'copy'), activateAction()]);
            const body = await responseBody(response); await network.receipt(response); return body;
          },
          verify: async body => { assert.equal(body.resultId, selectedResult.resultId, 'P2_COPY_SNAPSHOT_MISMATCH');
            assert.equal(body.format, 'conclusion', 'P2_COPY_FORMAT_MISMATCH'); assert.match(body.text, /2026Q3/, 'P2_COPY_PERIOD_MISSING');
            assert.match(body.text, /155/, 'P2_COPY_VALUE_MISMATCH'); assert.match(body.text, /元\/㎡\/月/, 'P2_COPY_UNIT_MISSING');
            assert.match(body.text, /有效 12 栋/, 'P2_COPY_SAMPLE_MISSING'); assert.doesNotMatch(body.text, /9999|9,999/, 'P2_COPY_SNAPSHOT_MISMATCH');
            assert.equal(await page.evaluate(() => navigator.clipboard.readText()), body.text, 'P2_CLIPBOARD_MISMATCH'); } });
        const buildingRows = fixture.buildings.result.table.rows;
        const verifyCards = async (body, offset) => {
          assert.equal(body.resultId, fixture.buildings.result.resultId, 'P2_BUILDING_SNAPSHOT_MISMATCH');
          assert.equal(body.offset, offset, 'P2_BUILDING_PAGE_MISMATCH'); assert.equal(body.total, 12, 'P2_BUILDING_PAGE_MISMATCH');
          const expected = buildingRows.slice(offset, offset + 5); assert.deepEqual(body.buildings.map(building => building.id), expected.map(row => row.entityId), 'P2_BUILDING_IDENTITY_MISMATCH');
          const section = result.getByRole('region', { name: '查询楼宇信息', exact: true });
          assert.equal(await section.getByRole('article').count(), expected.length, 'P2_UNBOUNDED_RENDER');
          assert.equal(await section.locator('img').count(), 0, 'P2_INVENTED_BUILDING_PHOTO');
          for (const row of expected) {
            const card = section.getByRole('article', { name: `${row.cells.name.value}楼宇卡片`, exact: true });
            const link = card.getByRole('link', { name: '在地图中查看', exact: true });
            const url = new URL(await link.getAttribute('href'), app);
            assert.equal(url.searchParams.get('aiBuilding'), row.entityId, 'P2_BUILDING_IDENTITY_MISMATCH');
            assert.equal(url.searchParams.get('aiRequest'), fixture.buildings.requestId, 'P2_BUILDING_SNAPSHOT_MISMATCH');
          }
        };
        await measure({ scenario: 'buildings_snapshot', locator: history.getByRole('button', { name: `打开对话：${buildingsQuestion}`, exact: true }),
          probe: { mode: 'buildings_snapshot', triggerAria: `打开对话：${buildingsQuestion}`, expectedCount: 5, expectedNames: buildingRows.slice(0, 5).map(row => row.cells.name.value) },
          expectedRequests: { history: 1, buildings: 1 },
          run: async (activateAction, network) => {
            const buildingResponse = responseFor(page, '/api/intelligence/query/buildings', 'buildings');
            const historyBody = await historyRequest(activateAction, network, 'open'); validateOriginal(historyBody.opened.selected.reply.result, fixture.buildings.result, ids);
            const response = await buildingResponse, body = await responseBody(response); await network.receipt(response); return body;
          }, verify: async body => verifyCards(body, 0) });
        const buildingSection = result.getByRole('region', { name: '查询楼宇信息', exact: true });
        const firstCard = buildingSection.getByRole('article', { name: `${buildingRows[0].cells.name.value}楼宇卡片`, exact: true });
        await activate(firstCard.getByRole('button', { name: '展开全部参数', exact: true }), profile);
        const originalRent = firstCard.locator('dl > div').filter({ has: page.locator('dt', { hasText: '净有效租金' }) });
        assert.equal(await originalRent.locator('dd button').innerText(), '100', 'P2_BUILDING_SNAPSHOT_MISMATCH');
        assert.match(await originalRent.innerText(), /2026Q3/, 'P2_BUILDING_PERIOD_MISSING');
        await measure({ scenario: 'buildings_next_page', locator: buildingSection.getByRole('button', { name: '下一组楼宇', exact: true }),
          probe: { mode: 'buildings_page', triggerText: '下一组楼宇', expectedCount: 5, expectedNames: buildingRows.slice(5, 10).map(row => row.cells.name.value) }, expectedRequests: { buildings: 1 },
          run: async (activateAction, network) => {
            const [response] = await Promise.all([responseFor(page, '/api/intelligence/query/buildings', 'buildings'), activateAction()]);
            const body = await responseBody(response); await network.receipt(response); return body;
          }, verify: async body => verifyCards(body, 5) });
        // Complete the real final page and full-parameter actions on both
        // viewports. Their facts are functional checks, not extra timed samples.
        await unmeasuredRequest({ page, profile, dataApiOrigin, locator: buildingSection.getByRole('button', { name: '下一组楼宇', exact: true }),
          endpoint: '/api/intelligence/query/buildings', action: 'buildings', verify: async last => {
            await buildingSection.getByRole('article', { name: `${buildingRows[10].cells.name.value}楼宇卡片`, exact: true }).waitFor();
            await verifyCards(last, 10);
          } });
        for (const card of await buildingSection.getByRole('article').all()) {
          await activate(card.getByRole('button', { name: '展开全部参数', exact: true }), profile);
          assert.match(await card.innerText(), /未知/, 'P2_MISSING_VALUE_AS_ZERO');
          assert.match(await card.innerText(), /缺少可靠坐标/, 'P2_INVENTED_COORDINATES');
          assert.match(await card.innerText(), /2026Q3/, 'P2_BUILDING_PERIOD_MISSING');
        }
        assert.equal(await page.evaluate(() => Object.values(localStorage).some(value => /P2性能|2026Q3CBD净有效租金|比较选中楼宇最新/.test(value))), false, 'P2_UNPROTECTED_LOCAL_HISTORY');
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 2), false, 'P2_VIEWPORT_OVERFLOW');
      } catch (error) {
        // A functional failure in a between-sample setup or final-page check is
        // still a failed round, even when every timed paint endpoint existed.
        const current = samples.filter(sample => sample.profile === profile.name && sample.round === round);
        if (current.length && current.every(sample => sample.status === 'success')) {
          current.at(-1).status = 'failed'; current.at(-1).error = p2WorkspaceErrorCode(error);
        }
        for (const scenario of P2_WORKSPACE_SCENARIOS) if (!samples.some(sample => sample.profile === profile.name && sample.round === round && sample.scenario === scenario)) {
          samples.push({ variant: 'after', profile: profile.name, round, scenario, status: 'dependency_failed', httpStatus: loginHttpStatus, error: p2WorkspaceErrorCode(error) });
        }
        report.stoppedEarly = { profile: profile.name, round, error: p2WorkspaceErrorCode(error) };
        throw error;
      } finally { await context.close(); await checkpoint(); }
      console.log(`P2_WORKSPACE_PERFORMANCE ${profile.name} round ${round}/${P2_WORKSPACE_SAMPLES}`);
    }
    report.complete = true; await checkpoint();
    assert.equal(report.functionalPassed, true, 'P2_WORKSPACE_FUNCTIONAL_FAILURE');
    assert.equal(report.budgetsMet, true, 'P2_WORKSPACE_BUDGET_FAILURE');
    if (semanticCalls) assert.equal(report.modelCalls, 0, 'P2_UNEXPECTED_MODEL_CALL');
    return { reportPath, functionalPassed: report.functionalPassed, budgetsMet: report.budgetsMet, summary: report.summary };
  } finally {
    await browser?.close(); await checkpoint();
    await db.query('delete from public.building_metrics where building_id=any($1::uuid[])', [ids]);
    await db.query('delete from public.building_brochure_data where building_id=any($1::uuid[])', [ids]);
    await db.query('delete from public.buildings where id=any($1::uuid[])', [ids]);
  }
}
