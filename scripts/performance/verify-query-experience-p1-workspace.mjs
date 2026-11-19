import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import pg from 'pg';
import { grantQuery } from '../../supabase/tests/ai-query-authority/database.mjs';
import { login } from './verify-ai-query-conversation.mjs';
import { nearestRank, QUERY_PERFORMANCE_PROFILES, queryPerformanceRevision } from './query-conversation-probe.mjs';
import { WORKSPACE_PERFORMANCE_BASELINE } from '../verification/query-performance-baseline.mjs';

const require = createRequire(import.meta.url);
export const EXPERIENCE_SAMPLES = 20;
export const EXPERIENCE_BASELINE_SCENARIOS = ['first_expand', 'collapse', 'reopen'];
export const EXPERIENCE_SCENARIOS = [...EXPERIENCE_BASELINE_SCENARIOS, 'input_focus', 'focus_fullscreen', 'fullscreen_focus'];
const EXPAND = '展开 Colliers AI 工作空间', COLLAPSE = '收起 Colliers AI 工作空间';
const FULLSCREEN = '全屏 Colliers AI 工作空间', FOCUS = '退出全屏 Colliers AI 工作空间';
const QUESTION = '2026Q3CBD净有效租金';
const measures = ['feedback_ms', 'content_usable_ms', 'long_task_count', 'long_task_total_ms', 'long_task_max_ms'];
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const safeError = error => /^[A-Z][A-Z0-9_]+$/.test(error?.message ?? '') ? error.message
  : error?.name === 'TimeoutError' ? 'EXPERIENCE_BROWSER_TIMEOUT' : 'EXPERIENCE_OPERATION_FAILED';

export function summarizeExperienceWorkspace(samples, scenarios = EXPERIENCE_SCENARIOS) {
  return QUERY_PERFORMANCE_PROFILES.flatMap(profile => scenarios.map(scenario => {
    const rows = samples.filter(row => row.profile === profile.name && row.scenario === scenario);
    const metrics = Object.fromEntries(measures.map(field => {
      const values = rows.filter(row => row.status === 'success' && Number.isFinite(row[field])).map(row => row[field]);
      return [field, { measured: values.length, missing: rows.length - values.length,
        p50: nearestRank(values, .5), p90: nearestRank(values, .9) }];
    }));
    const complete = rows.length === EXPERIENCE_SAMPLES && rows.every(row => row.status === 'success'
      && row.sameInputNode && row.sameDraftAndSelection && row.sameOriginalResult && row.noQueryOrAuditReplay
      && row.longTaskObserverSupported && measures.every(field => Number.isFinite(row[field])));
    return { profile: profile.name, scenario, expected: EXPERIENCE_SAMPLES, observed: rows.length,
      failed: rows.filter(row => row.status !== 'success').length, missingSamples: Math.max(0, EXPERIENCE_SAMPLES - rows.length),
      complete, metrics, budget: { feedbackP90Ms: 100, loadedContentUsableP90Ms: 500 },
      budgetsMet: complete && metrics.feedback_ms.p90 <= 100 && metrics.content_usable_ms.p90 <= 500 };
  }));
}

export function summarizeExperiencePair(samples) {
  const summary = summarizeExperienceWorkspace(samples.filter(row => row.variant === 'after'));
  const baselineSummary = summarizeExperienceWorkspace(samples.filter(row => row.variant === 'before'), EXPERIENCE_BASELINE_SCENARIOS);
  const comparisons = summary.filter(row => EXPERIENCE_BASELINE_SCENARIOS.includes(row.scenario)).map(after => {
    const before = baselineSummary.find(row => row.profile === after.profile && row.scenario === after.scenario);
    return { profile: after.profile, scenario: after.scenario, complete: before.complete && after.complete,
      metrics: Object.fromEntries(['feedback_ms', 'content_usable_ms'].map(metric => [metric,
        Object.fromEntries(['p50', 'p90'].map(percentile => {
          const baseline = before.metrics[metric][percentile], candidate = after.metrics[metric][percentile];
          return [percentile, { before_ms: baseline, after_ms: candidate,
            delta_ms: baseline !== null && candidate !== null ? candidate - baseline : null,
            change_percent: baseline > 0 && candidate !== null ? (candidate - baseline) / baseline * 100 : null }];
        }))])), baselineMetBudget: before.budgetsMet, candidateMetBudget: after.budgetsMet };
  });
  return { summary, baselineSummary, comparisons };
}

/** Browser observation only. Start at a trusted user action, finish after the
 * actual spatial animation ends and the same composer is usable. A mode flag,
 * skeleton, HTTP completion or animation start alone is never the endpoint. */
export function observeExperienceTransition({ trigger, target, timeoutMs = 10000 }) {
  window.__colliersExperienceTransition?.stop();
  const input = document.querySelector('#home-query');
  const root = () => input?.closest('[data-mode]');
  const state = { status: 'waiting', feedback_ms: null, content_usable_ms: null,
    longTaskObserverSupported: PerformanceObserver.supportedEntryTypes.includes('longtask') };
  let start = null, startBounds = null, startMode = null, stopped = false, frame, painting = false;
  const tasks = [];
  const observer = state.longTaskObserverSupported ? new PerformanceObserver(list => {
    for (const entry of list.getEntries()) tasks.push({ start: entry.startTime, duration: entry.duration });
  }) : null;
  observer?.observe({ type: 'longtask', buffered: false });
  const visible = element => {
    if (!element?.isConnected) return false;
    const rect = element.getBoundingClientRect(), style = getComputedStyle(element);
    return rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0';
  };
  const ready = () => {
    const workspace = root();
    if (!visible(input) || input.disabled || document.querySelectorAll('#home-query').length !== 1
      || workspace?.dataset.mode !== target || workspace.dataset.transitioning !== 'false') return false;
    if (workspace.getAnimations({ subtree: true }).some(animation => animation.playState === 'running')) return false;
    if (target !== 'compact') {
      const dialog = document.querySelector('[role="dialog"][aria-label="Colliers AI 工作空间"]');
      if (!visible(dialog) || !dialog.contains(input) || dialog.getAttribute('aria-modal') !== 'true') return false;
      const bounds = dialog.getBoundingClientRect(), composer = input.getBoundingClientRect(), viewport = window.visualViewport;
      const top = viewport?.offsetTop ?? 0, left = viewport?.offsetLeft ?? 0;
      const width = viewport?.width ?? innerWidth, height = viewport?.height ?? innerHeight;
      if (composer.top < Math.max(top, bounds.top) || composer.bottom > Math.min(top + height, bounds.bottom) + 1) return false;
      if (target === 'expanded' || innerWidth < 640) {
        if (Math.abs(bounds.left - left) > 3 || Math.abs(bounds.top - top) > 3
          || Math.abs(bounds.width - width) > 3 || Math.abs(bounds.height - height) > 3) return false;
      } else if (bounds.left < left || bounds.top < top || bounds.right > left + width + 1 || bounds.bottom > top + height + 1
        || Math.abs(bounds.left + bounds.right - (left * 2 + width)) > 3 || bounds.width < width * .6 || bounds.height < height * .6) return false;
    }
    return true;
  };
  const feedback = () => {
    const workspace = root();
    if (!visible(workspace) || !startBounds) return false;
    const bounds = workspace.getBoundingClientRect();
    return ['left', 'top', 'width', 'height'].some(field => Math.abs(bounds[field] - startBounds[field]) > .5)
      || ((startMode === 'focus' && target === 'expanded') || (startMode === 'expanded' && target === 'focus'))
        && visible(workspace.querySelector(`button[aria-label="${target === 'focus' ? '全屏 Colliers AI 工作空间' : '退出全屏 Colliers AI 工作空间'}"]`))
      || matchMedia('(prefers-reduced-motion: reduce)').matches && ready();
  };
  const begin = event => {
    const matches = trigger === 'input' ? event.target === input
      : event.type === 'click' && event.target?.closest?.('button')?.getAttribute('aria-label') === trigger;
    if (start === null && event.isTrusted && matches) {
      startBounds = root()?.getBoundingClientRect() ?? null;
      startMode = root()?.dataset.mode;
      start = performance.now(); state.status = 'running';
    }
  };
  const tick = () => {
    if (stopped) return;
    if (start !== null) {
      if (!painting && (feedback() || ready())) {
        painting = true;
        requestAnimationFrame(() => {
          painting = false;
          if (stopped) return;
          if (state.feedback_ms === null && feedback()) state.feedback_ms = performance.now() - start;
          if (state.content_usable_ms === null && ready()) state.content_usable_ms = performance.now() - start;
          if (state.content_usable_ms !== null) state.status = 'ready';
        });
      }
      if (state.status !== 'ready' && performance.now() - start >= timeoutMs) state.status = 'timeout';
    }
    frame = requestAnimationFrame(tick);
  };
  const stop = () => {
    stopped = true; cancelAnimationFrame(frame); observer?.disconnect();
    for (const event of ['click', 'pointerdown', 'focusin']) document.removeEventListener(event, begin, true);
  };
  for (const event of ['click', 'pointerdown', 'focusin']) document.addEventListener(event, begin, true);
  frame = requestAnimationFrame(tick);
  window.__colliersExperienceTransition = { state, stop, read: () => {
    const end = state.content_usable_ms === null ? performance.now() : start + state.content_usable_ms;
    const measured = tasks.filter(task => start !== null && task.start >= start && task.start <= end);
    return { ...state, long_task_count: measured.length, long_task_total_ms: measured.reduce((sum, task) => sum + task.duration, 0),
      long_task_max_ms: Math.max(0, ...measured.map(task => task.duration)) };
  } };
}

async function until(predicate, code, timeout = 15000) {
  const start = Date.now();
  while (!await predicate()) { assert.ok(Date.now() - start < timeout, code); await delay(50); }
}
const textarea = page => page.locator('#home-query');
const currentResult = page => page.getByRole('region', { name: '查询结果', exact: true }).last();
const responseFor = (page, endpoint, action) => page.waitForResponse(response => {
  const request = response.request();
  return new URL(response.url()).pathname === endpoint && request.method() === 'POST'
    && (!action || request.postDataJSON()?.action === action);
});
async function activate(locator, mobile) {
  await locator.scrollIntoViewIfNeeded();
  if (mobile) await locator.tap();
  else { await locator.focus(); await locator.press('Enter'); }
}
async function draftSnapshot(page) {
  return textarea(page).evaluate(node => ({ value: node.value, start: node.selectionStart, end: node.selectionEnd }));
}
async function queryReady(page, response, allowedIds, network) {
  assert.equal(response.status(), 200, 'EXPERIENCE_QUERY_HTTP_FAILURE');
  const body = await response.json();
  assert.equal(body.status, 'ready', 'EXPERIENCE_QUERY_NOT_READY');
  assert.ok(body.result.sources.every(source => allowedIds.includes(source.entityId)), 'EXPERIENCE_SCOPE_EXPANDED');
  assert.equal(body.result.table.rows[0].cells.value.value.numeric, 140, 'EXPERIENCE_FACT_CHANGED');
  assert.ok(body.conversation?.id && body.requestId, 'EXPERIENCE_CONTEXT_MISSING');
  await currentResult(page).getByRole('button', { name: /^查看来源：/ }).first().waitFor();
  await page.getByRole('button', { name: '发送问题', exact: true }).waitFor();
  await network.receipt(response, { surface: 'answer_table', sourceCount: 'empty' });
  return body;
}
async function send(page, text) {
  await textarea(page).fill(text);
  const [response] = await Promise.all([responseFor(page, '/api/intelligence/query'),
    page.getByRole('button', { name: '发送问题', exact: true }).click()]);
  return response;
}

function observeRequests(page, app) {
  const entries = [], pending = new Set(), errors = [], records = new Map();
  let browserErrors = 0;
  const request = req => {
    const url = new URL(req.url());
    if (url.origin !== app || !url.pathname.startsWith('/api/intelligence/query')) return;
    const record = { endpoint: url.pathname, method: req.method(), request: req, finished: false, status: null };
    entries.push(record); records.set(req, record); pending.add(req);
  };
  const done = req => { pending.delete(req); if (records.has(req)) records.get(req).finished = true; };
  const failed = req => { pending.delete(req); };
  const response = reply => {
    if (records.has(reply.request())) records.get(reply.request()).status = reply.status();
    if (reply.status() >= 400 && new URL(reply.url()).origin === app) errors.push(reply.status());
  };
  const pageError = () => browserErrors++;
  page.on('request', request); page.on('requestfinished', done); page.on('requestfailed', failed); page.on('response', response); page.on('pageerror', pageError);
  return { entries, errors, count: endpoint => entries.filter(entry => entry.endpoint === endpoint && entry.method === 'POST').length,
    cursor: () => entries.length,
    receipt: async (delivered, { surface, sourceCount = 'any', after = 0 }) => {
      // Wait for the actual successful DOM delivery acknowledgement, identified
      // in memory by its response digest. network.idle alone can run before the
      // component's two animation frames have even dispatched that request.
      const digest = delivered.headers()['x-query-body-sha256'];
      assert.match(digest ?? '', /^[a-f0-9]{64}$/, 'EXPERIENCE_DELIVERY_DIGEST_MISSING');
      await until(() => entries.slice(after).some(entry => {
        if (entry.endpoint !== '/api/intelligence/query/receipt' || entry.method !== 'POST' || !entry.finished || entry.status !== 200) return false;
        const body = entry.request.postDataJSON();
        return body.bodySha256 === digest && body.phase === 'client_dom_committed' && body.view?.surface === surface
          && (sourceCount === 'any' || sourceCount === 'empty' && body.view.sourceIds?.length === 0
            || sourceCount === 'present' && body.view.sourceIds?.length > 0);
      }), 'EXPERIENCE_DOM_RECEIPT_UNCONFIRMED');
    },
    browserErrors: () => browserErrors,
    idle: () => until(() => pending.size === 0, 'EXPERIENCE_NETWORK_INCOMPLETE'),
    stop: () => { page.off('request', request); page.off('requestfinished', done); page.off('requestfailed', failed); page.off('response', response); page.off('pageerror', pageError); } };
}

async function assertLayout(page, mode) {
  const expected = typeof mode === 'boolean' ? mode ? 'expanded' : 'compact' : mode;
  const geometry = await page.evaluate(() => {
    const input = document.querySelector('#home-query'), root = input?.closest('[data-mode]');
    const inputBox = input?.getBoundingClientRect(), viewport = window.visualViewport;
    const top = viewport?.offsetTop ?? 0, height = viewport?.height ?? innerHeight;
    const button = document.querySelector('button[aria-label="收起 Colliers AI 工作空间"]');
    const close = button?.getBoundingClientRect();
    return { overflow: document.documentElement.scrollWidth > innerWidth + 2,
      count: document.querySelectorAll('#home-query').length, mode: root?.dataset.mode,
      inputVisible: Boolean(inputBox && inputBox.height > 0 && inputBox.top >= top && inputBox.bottom <= top + height + 2),
      touch: close ? close.width >= 43 && close.height >= 43 : false };
  });
  assert.equal(geometry.overflow, false, 'EXPERIENCE_VIEWPORT_OVERFLOW');
  assert.equal(geometry.count, 1, 'EXPERIENCE_DUPLICATE_COMPOSER');
  assert.equal(geometry.mode, expected, 'EXPERIENCE_WRONG_MODE');
  if (expected !== 'compact') {
    assert.equal(geometry.inputVisible, true, 'EXPERIENCE_COMPOSER_OCCLUDED');
    assert.equal(geometry.touch, true, 'EXPERIENCE_CLOSE_TARGET_TOO_SMALL');
  }
}

// History reads and presentation receipts legitimately use their own audited
// operations. Compare the original query family, including ingress retries and
// all original-stream events, rather than treating a first history read as a
// duplicate query. A repeated query cannot disappear into this distinction.
async function queryAuditSnapshot(db, userId) {
  return (await db.query(`with submissions as (
    select request_id from private.ai_query_ingress_events where actor_id=$1 and entry='query_submission'
  ), original as (
    select request_id from private.ai_query_audit_streams where actor_id=$1
      and request_id in (select request_id from submissions)
  ) select (select count(*) from submissions)::int as intake,
    (select count(*) from original)::int as streams,
    (select count(*) from private.ai_query_audit_events where request_id in (select request_id from original))::int as events`, [userId])).rows[0];
}

async function changeMode({ page, network, db, userId, profile, round, scenario, samples, variant = 'after', record = true }) {
  if (scenario === 'first_expand' || scenario === 'input_focus') await modeWithoutNetworkIdle(page, false);
  const target = scenario === 'collapse' ? 'compact' : ['input_focus', 'fullscreen_focus'].includes(scenario) ? 'focus' : 'expanded';
  const trigger = scenario === 'input_focus' ? 'input' : scenario === 'focus_fullscreen' ? FULLSCREEN
    : scenario === 'fullscreen_focus' ? FOCUS : target === 'expanded' ? EXPAND : COLLAPSE;
  const sample = { variant, profile: profile.name, round, scenario, status: 'running' };
  if (record) samples.push(sample);
  const node = await textarea(page).elementHandle(), draft = await draftSnapshot(page);
  const original = await currentResult(page).textContent().catch(() => null);
  await network.idle();
  const before = network.count('/api/intelligence/query');
  const auditBefore = await queryAuditSnapshot(db, userId);
  try {
    await page.evaluate(observeExperienceTransition, { trigger, target });
    if (trigger === 'input') {
      // Focus is a trusted browser action and preserves an existing selection;
      // a pointer click is separately exercised by the viewport regressions.
      await textarea(page).focus();
    } else await activate(page.getByRole('button', { name: trigger, exact: true }), profile.name === 'mobile');
    await page.waitForFunction(() => ['ready', 'timeout'].includes(window.__colliersExperienceTransition?.state.status), null, { timeout: 12000 });
    const measured = await page.evaluate(() => window.__colliersExperienceTransition.read());
    Object.assign(sample, measured);
    assert.equal(measured.status, 'ready', 'EXPERIENCE_ANIMATION_NOT_USABLE');
    sample.sameInputNode = await node.evaluate(element => element === document.querySelector('#home-query'));
    assert.ok(sample.sameInputNode, 'EXPERIENCE_INPUT_REMOUNTED');
    sample.sameDraftAndSelection = JSON.stringify(await draftSnapshot(page)) === JSON.stringify(draft);
    assert.ok(sample.sameDraftAndSelection, 'EXPERIENCE_DRAFT_OR_SELECTION_RESET');
    sample.sameOriginalResult = original === await currentResult(page).textContent().catch(() => null);
    assert.ok(sample.sameOriginalResult, 'EXPERIENCE_RESULT_RESET');
    await network.idle();
    const auditAfter = await queryAuditSnapshot(db, userId);
    sample.noQueryOrAuditReplay = before === network.count('/api/intelligence/query') && JSON.stringify(auditBefore) === JSON.stringify(auditAfter);
    assert.ok(sample.noQueryOrAuditReplay, 'EXPERIENCE_DUPLICATE_QUERY_OR_AUDIT');
    await assertLayout(page, target); sample.status = 'success';
    return sample;
  } catch (error) {
    sample.status = 'failed'; sample.error = safeError(error); throw error;
  } finally {
    await page.evaluate(() => window.__colliersExperienceTransition?.stop()).catch(() => {});
    await node?.dispose();
  }
}

async function modeWithoutNetworkIdle(page, expanded) {
  const currentMode = await textarea(page).evaluate(node => node.closest('[data-mode]')?.dataset.mode);
  if (currentMode === (expanded ? 'expanded' : 'compact')) return;
  await activate(page.getByRole('button', { name: expanded ? currentMode === 'focus' ? FULLSCREEN : EXPAND : COLLAPSE, exact: true }), false);
  await page.waitForFunction(target => {
    const root = document.querySelector('#home-query')?.closest('[data-mode]');
    return root?.dataset.mode === target && root.dataset.transitioning === 'false';
  }, expanded ? 'expanded' : 'compact');
}

async function resizeOpenPanels({ page, network, height }) {
  const history = page.getByRole('complementary', { name: '历史工作记录', exact: true });
  const research = page.getByRole('complementary', { name: '研究资料与口径', exact: true });
  const resize = async width => {
    await page.setViewportSize({ width, height });
    await page.waitForFunction(() => {
      const bounds = document.querySelector('#home-query')?.closest('[data-mode]')?.getBoundingClientRect();
      return bounds && Math.abs(bounds.width - (visualViewport?.width ?? innerWidth)) <= 2
        && Math.abs(bounds.height - (visualViewport?.height ?? innerHeight)) <= 2;
    });
  };
  await history.waitFor(); await research.waitFor(); await network.idle();
  const before = network.count('/api/intelligence/query');
  const input = textarea(page), inputNode = await input.elementHandle();
  await input.focus();
  const draft = await draftSnapshot(page);
  await input.dispatchEvent('compositionstart', { data: '中' });
  await resize(320);
  await history.waitFor({ state: 'hidden' }); await research.waitFor();
  assert.deepEqual(await draftSnapshot(page), draft, 'EXPERIENCE_RESIZE_CLEARED_DRAFT');
  assert.equal(await inputNode.evaluate(node => node === document.activeElement && node === document.querySelector('#home-query')), true,
    'EXPERIENCE_RESIZE_BLURRED_COMPOSER');
  await input.dispatchEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 229, isComposing: true, bubbles: true });
  await input.dispatchEvent('keydown', { key: 'Escape', code: 'Escape', isComposing: true, bubbles: true });
  await assertLayout(page, true);
  await resize(1280);
  await history.waitFor({ state: 'hidden' }); await research.waitFor();
  await input.dispatchEvent('compositionend', { data: '中' });
  assert.equal(await inputNode.evaluate(node => node === document.activeElement), true, 'EXPERIENCE_RESIZE_BLURRED_COMPOSER');

  await page.getByRole('button', { name: '历史记录', exact: true }).click();
  await history.waitFor(); await research.waitFor();
  const search = history.getByRole('searchbox', { name: '搜索标题或最近问题', exact: true });
  const searched = term => page.waitForResponse(response => new URL(response.url()).pathname === '/api/intelligence/query/history'
    && response.request().postDataJSON()?.action === 'list' && response.request().postDataJSON()?.search === term);
  const searchReady = searched('2026');
  await search.pressSequentially('2026', { delay: 15 }); await searchReady; await network.idle();
  await search.focus();
  const searchNode = await search.elementHandle();
  const searchDraft = await search.evaluate(node => ({ value: node.value, start: node.selectionStart, end: node.selectionEnd }));
  await search.dispatchEvent('compositionstart', { data: '研究' });
  await resize(320);
  await history.waitFor(); await research.waitFor({ state: 'hidden' });
  assert.equal(await searchNode.evaluate(node => node === document.activeElement), true, 'EXPERIENCE_RESIZE_BLURRED_HISTORY_SEARCH');
  assert.deepEqual(await search.evaluate(node => ({ value: node.value, start: node.selectionStart, end: node.selectionEnd })), searchDraft,
    'EXPERIENCE_RESIZE_CLEARED_HISTORY_SEARCH');
  assert.deepEqual(await draftSnapshot(page), draft, 'EXPERIENCE_RESIZE_CLEARED_DRAFT');
  await search.dispatchEvent('keydown', { key: 'Escape', code: 'Escape', isComposing: true, bubbles: true });
  await assertLayout(page, true);
  await resize(1280);
  await history.waitFor(); await research.waitFor({ state: 'hidden' });
  assert.equal(await searchNode.evaluate(node => node === document.activeElement), true, 'EXPERIENCE_RESIZE_BLURRED_HISTORY_SEARCH');
  await search.dispatchEvent('compositionend', { data: '研究' });
  const cleared = searched(''); await search.fill(''); await cleared; await network.idle();
  await page.getByRole('button', { name: '研究资料', exact: true }).click();
  await research.waitFor(); await history.waitFor(); await assertLayout(page, true);
  assert.equal(network.count('/api/intelligence/query'), before, 'EXPERIENCE_RESIZE_REEXECUTED_QUERY');
  await inputNode.dispose(); await searchNode.dispose();
}

async function pendingAndStop({ page, db, blocker, userId, ids, network }) {
  const start = network.count('/api/intelligence/query');
  await blocker.query('begin'); await blocker.query('lock table private.ai_query_control in access exclusive mode');
  let pending;
  try {
    await textarea(page).fill(QUESTION);
    pending = responseFor(page, '/api/intelligence/query');
    await page.getByRole('button', { name: '发送问题', exact: true }).click();
    await page.getByRole('button', { name: '停止等待', exact: true }).waitFor();
    await textarea(page).pressSequentially('next draft', { delay: 10 });
    await modeWithoutNetworkIdle(page, false);
    await textarea(page).focus();
    await page.waitForFunction(() => {
      const root = document.querySelector('#colliers-ai');
      return root?.dataset.mode === 'focus' && root.dataset.transitioning === 'false';
    });
    await assertLayout(page, 'focus');
    await modeWithoutNetworkIdle(page, true);
    assert.equal(network.count('/api/intelligence/query'), start + 1, 'EXPERIENCE_PENDING_DUPLICATED');
    assert.equal(await textarea(page).inputValue(), 'next draft', 'EXPERIENCE_PENDING_DRAFT_LOST');
  } finally { await blocker.query('rollback'); }
  await queryReady(page, await pending, ids, network);
  assert.equal(await textarea(page).inputValue(), 'next draft', 'EXPERIENCE_RESPONSE_CLEARED_NEXT_DRAFT');
  await network.idle();

  const prior = new Set((await db.query('select request_id from private.ai_query_audit_streams where actor_id=$1', [userId])).rows.map(row => row.request_id));
  await blocker.query('begin'); await blocker.query('lock table private.ai_query_control in access exclusive mode');
  let stoppedId, submitted;
  try {
    await textarea(page).fill(QUESTION);
    const [request] = await Promise.all([page.waitForRequest(request => new URL(request.url()).pathname === '/api/intelligence/query' && request.method() === 'POST'),
      page.getByRole('button', { name: '发送问题', exact: true }).click()]);
    submitted = request.postDataJSON();
    // The same owner can have more than one in-flight audit stream. Select
    // exactly the request bound to the POST idempotency key, never whichever
    // unseen stream happens to be returned first by an unordered query.
    const digest = createHash('sha256')
      .update(`query-http/1:${userId}:${userId}:${submitted.idempotencyKey}`)
      .digest().subarray(0, 16);
    digest[6] = (digest[6] & 15) | 128;
    digest[8] = (digest[8] & 63) | 128;
    const hex = digest.toString('hex');
    const exactId = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
    await until(async () => {
      const rows = (await db.query('select request_id from private.ai_query_audit_streams where actor_id=$1 and request_id=$2', [userId, exactId])).rows;
      stoppedId = rows.find(row => !prior.has(row.request_id))?.request_id;
      return Boolean(stoppedId);
    }, 'EXPERIENCE_PENDING_AUDIT_MISSING');
    await textarea(page).pressSequentially('keep after stop', { delay: 10 });
    await page.getByRole('button', { name: '停止等待', exact: true }).click();
    await page.getByText('已停止等待，服务端可能仍在处理。', { exact: false }).waitFor();
    assert.equal(await textarea(page).inputValue(), 'keep after stop', 'EXPERIENCE_STOP_CLEARED_DRAFT');
  } finally { await blocker.query('rollback'); }
  let terminalState;
  await until(async () => {
    terminalState = (await db.query('select state from private.ai_query_audit_streams where request_id=$1', [stoppedId])).rows[0]?.state;
    return ['succeeded', 'cancelled', 'failed', 'denied'].includes(terminalState);
  }, 'EXPERIENCE_SERVER_STATE_UNCONFIRMED');
  assert.ok(['succeeded', 'cancelled'].includes(terminalState), 'EXPERIENCE_STOP_SERVER_FAILURE');
  const executionCount = async () => Number((await db.query("select count(*) from private.ai_query_audit_events where request_id=$1 and kind='running'", [stoppedId])).rows[0].count);
  const beforeRetry = await executionCount();
  assert.ok(beforeRetry <= 1, 'EXPERIENCE_STOP_DUPLICATED_EXECUTION');
  const [response] = await Promise.all([responseFor(page, '/api/intelligence/query'), page.getByRole('button', { name: '重试本次请求', exact: true }).click()]);
  const retry = response.request().postDataJSON();
  assert.equal(retry.idempotencyKey, submitted.idempotencyKey, 'EXPERIENCE_RETRY_LOST_IDEMPOTENCY');
  assert.equal(response.status(), 202, 'EXPERIENCE_RETRY_DID_NOT_REUSE_REQUEST');
  const replay = await response.json();
  assert.equal(replay.status, 'already_received', 'EXPERIENCE_RETRY_DID_NOT_REUSE_REQUEST');
  assert.equal(replay.requestId, stoppedId, 'EXPERIENCE_STOP_REEXECUTED_QUERY');
  assert.equal(await executionCount(), beforeRetry, 'EXPERIENCE_RETRY_DUPLICATED_EXECUTION');
  const received = (await db.query("select count(*) from private.ai_query_audit_events where request_id=$1 and kind='received'", [stoppedId])).rows[0].count;
  assert.equal(Number(received), 1, 'EXPERIENCE_RETRY_DUPLICATED_ORIGINAL_AUDIT');
  const [recovery] = await Promise.all([responseFor(page, '/api/intelligence/query/recover', 'recover'),
    page.getByRole('button', { name: '检查状态并恢复结果', exact: true }).click()]);
  assert.equal(recovery.status(), 200, 'EXPERIENCE_STOP_RECOVERY_FAILED');
  const recovered = await recovery.json();
  assert.equal(recovered.requestId, stoppedId, 'EXPERIENCE_STOP_RECOVERY_CHANGED_REQUEST');
  assert.equal(recovered.status, terminalState === 'succeeded' ? 'ready' : 'cancelled', 'EXPERIENCE_STOP_RECOVERY_MISSTATED_STATE');
  if (terminalState === 'succeeded') {
    assert.equal(recovered.result.table.rows[0].cells.value.value.numeric, 140, 'EXPERIENCE_FACT_CHANGED');
    assert.ok(recovered.result.sources.every(source => ids.includes(source.entityId)), 'EXPERIENCE_SCOPE_EXPANDED');
    await currentResult(page).getByRole('button', { name: /^查看来源：/ }).first().waitFor();
    await network.receipt(recovery, { surface: 'answer_table', sourceCount: 'empty' });
  } else {
    assert.equal(recovered.result, undefined, 'EXPERIENCE_CANCELLED_INVENTED_RESULT');
  }
  await page.getByRole('button', { name: '发送问题', exact: true }).waitFor();
  assert.equal(await textarea(page).inputValue(), 'keep after stop', 'EXPERIENCE_RECOVERY_CLEARED_DRAFT');
  assert.equal(await executionCount(), beforeRetry, 'EXPERIENCE_RECOVERY_DUPLICATED_EXECUTION');
  return terminalState;
}

/** This uses the existing runner's disposable hold-open hook after ALL prior
 * P2/Auth regressions pass. It does not copy the server, migrations, Auth or
 * authorization model and cannot accept a non-loopback database/site. */
export async function verifyExperienceP1Workspace({ previewFile, statusFile, output = 'verification/ai-query-auth' }) {
  assert.equal(process.env.AI_QUERY_AUTH_ALLOW_LOCAL, 'disposable');
  assert.match(previewFile, /^\/(?:private\/)?tmp\/colliers-query-preview-[a-z0-9-]+\.json$/);
  const owner = JSON.parse(await readFile(previewFile, 'utf8')), settings = JSON.parse(await readFile(statusFile, 'utf8'));
  const app = new URL(owner.app), database = new URL(settings.DB_URL), api = new URL(settings.API_URL);
  assert.equal(app.hostname, '127.0.0.1'); assert.equal(app.port, '3289');
  assert.equal(owner.beforeCommit, WORKSPACE_PERFORMANCE_BASELINE, 'EXPERIENCE_PINNED_BASELINE_MISSING');
  const beforeApp = new URL(owner.beforeApp);
  assert.equal(beforeApp.hostname, '127.0.0.1'); assert.equal(beforeApp.port, '3290');
  assert.equal(database.hostname, '127.0.0.1'); assert.equal(database.port, '55992');
  assert.equal(api.hostname, '127.0.0.1'); assert.equal(api.port, '55991');
  assert.match(owner.userId, /^[0-9a-f-]{36}$/);
  const db = new pg.Client({ connectionString: settings.DB_URL }), blocker = new pg.Client({ connectionString: settings.DB_URL });
  await db.connect(); await blocker.connect(); await blocker.query("set lock_timeout='10s'");
  const ids = Array.from({ length: 12 }, () => randomUUID()), samples = [], layouts = [];
  const githubEvent = process.env.GITHUB_EVENT_PATH ? JSON.parse(await readFile(process.env.GITHUB_EVENT_PATH, 'utf8')) : null;
  const report = { version: 'query-experience-p1-workspace/3', ...queryPerformanceRevision(process.env, githubEvent),
    beforeCommit: WORKSPACE_PERFORMANCE_BASELINE,
    productionBuild: true, production: false, realPhone: false, manualVisualReview: false,
    authentication: 'Existing real GoTrue login form and scoped disposable PostgreSQL grant; no request interception, fake session or app-state replacement',
    baseline: 'Pinned released P0 f600c6b and candidate each run first-expand/collapse/reopen 20 times per profile, alternating before/after within each round on this runner, same database, account, grants, fixture, browser/CPU/network conditions and unchanged 100/500ms budgets. The three candidate focus paths have no released-P0 equivalent and have no fabricated before values.',
    actualBehaviorDifference: 'Released P0 first desktop expansion automatically opens history; candidate opens history only on demand. Each build retains its real behavior and resulting request cost. Candidate typing enters focus, then is explicitly collapsed before measuring the shared full-screen path; no source or app-state injection normalizes these differences.',
    cache: 'New browser context and real login for each 20-sample round. Query and numeric result are ready; typing enters focus, then setup closes it. first_expand is the first full-screen layout; reopen and focus paths reuse the same document. Server/database are warm.',
    endpoints: { start: 'Trusted keyboard/touch activation of the actual mode control, or trusted textarea focus', feedback: 'Geometry or the actual mode-control icon/label visibly changes on a subsequent frame (mobile focus/fullscreen can share bounds)',
      usable: 'All workspace/composer animations finished, same textarea enabled and visible inside the actual modal; fullscreen occupies visual viewport, desktop focus is centered and contained; not animation start or response arrival' },
    auditVerification: 'Original query_submission ingress, original query streams and their event counts remain unchanged during mode switches. First authorized history reads and DOM delivery receipts retain separate audit trails. The original result/chart DOM acknowledgement must finish before a switch sample.',
    budgets: { feedbackP90Ms: 100, loadedContentUsableP90Ms: 500 }, profiles: QUERY_PERFORMANCE_PROFILES,
    samplesPerCondition: EXPERIENCE_SAMPLES, samples, layouts, summary: [], baselineSummary: [], comparisons: [], complete: false, functionalPassed: false, budgetsMet: false,
    disclosure: 'Automated composition events validate event handling; they are not real OS IME/soft-keyboard or physical-phone acceptance. Reports exclude credentials, request bodies, signed tokens, and source IDs.' };
  await mkdir(output, { recursive: true });
  const reportPath = path.join(output, 'experience-p1-workspace.json');
  const checkpoint = async () => {
    Object.assign(report, summarizeExperiencePair(samples));
    report.functionalPassed = report.summary.every(row => row.complete) && report.baselineSummary.every(row => row.complete)
      && layouts.length === 4 && layouts.every(row => row.status === 'success');
    report.budgetsMet = report.summary.every(row => row.budgetsMet);
    report.baselineBudgetsMet = report.baselineSummary.every(row => row.budgetsMet);
    await writeFile(reportPath, JSON.stringify(report, null, 2) + '\n');
  };
  let browser, originalGrant;
  const setupContext = async (profile, reducedMotion = 'no-preference', targetApp = app.origin) => {
    const context = await browser.newContext({ viewport: { width: profile.width, height: profile.height },
      isMobile: profile.name === 'mobile', hasTouch: profile.name === 'mobile', serviceWorkers: 'block', timezoneId: 'Asia/Shanghai', reducedMotion });
    const page = await context.newPage(); page.setDefaultTimeout(20000);
    const cdp = await context.newCDPSession(page); await cdp.send('Network.enable');
    await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: profile.latencyMs,
      downloadThroughput: profile.downloadMbps * 1e6 / 8, uploadThroughput: profile.uploadMbps * 1e6 / 8 });
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: profile.cpuRate });
    const network = observeRequests(page, targetApp);
    try { await login(page, targetApp, owner, status => assert.equal(status, 200, 'EXPERIENCE_LOGIN_FAILURE')); }
    catch (error) { network.stop(); await context.close(); throw error; }
    return { context, page, network };
  };
  try {
    originalGrant = (await db.query('select * from private.ai_query_grants where user_id=$1', [owner.userId])).rows[0];
    assert.ok(originalGrant?.enabled, 'EXPERIENCE_DISPOSABLE_GRANT_MISSING');
    for (const [index, id] of ids.entries()) {
      await db.query("insert into public.buildings(id,name,submarket,grade) values($1,$2,'CBD','A')", [id, `Experience P1合成${index + 1}座`]);
      await db.query(`insert into public.building_metrics(building_id,record_year,record_quarter,total_area,net_effective_rent,vacant_area,is_draft)
        values($1,2026,3,100000,$2,1000,false)`, [id, 120 + (index % 3) * 20]);
    }
    await grantQuery({ setup: db }, owner.userId, { capabilities: originalGrant.capabilities, fields: originalGrant.fields,
      allSubmarkets: false, submarkets: ['CBD'], allBuildings: false, buildingIds: ids });
    const { chromium } = require(process.env.PERF_PLAYWRIGHT_MODULE || 'playwright-core');
    browser = await chromium.launch({ headless: true,
      ...(process.env.PERF_BROWSER_EXECUTABLE_PATH ? { executablePath: process.env.PERF_BROWSER_EXECUTABLE_PATH } : {}),
      ...(process.env.PERF_BROWSER_CHANNEL ? { channel: process.env.PERF_BROWSER_CHANNEL } : {}) });
    report.browser = browser.version();

    for (const width of [320, 390, 768, 1280]) {
      const profile = { ...QUERY_PERFORMANCE_PROFILES[width < 640 ? 1 : 0], width };
      const layout = { width, status: 'running', reducedMotion: width === 768 }; layouts.push(layout);
      const { context, page, network } = await setupContext(profile, width === 768 ? 'reduce' : 'no-preference');
      try {
        await page.getByRole('heading', { name: '你好，合成验收账号。', exact: true }).waitFor();
        const greeting = await send(page, '你好'); assert.equal(greeting.status(), 200, 'EXPERIENCE_GREETING_FAILURE');
        assert.equal((await greeting.json()).reason, 'assistant_help', 'EXPERIENCE_GREETING_NOT_HELP');
        await network.receipt(greeting, { surface: 'clarification' });
        await page.getByRole('button', { name: '发送问题', exact: true }).waitFor();
        await modeWithoutNetworkIdle(page, false); await assertLayout(page, false);
        const answerResponse = await send(page, QUESTION);
        const answer = await queryReady(page, answerResponse, ids, network);
        await textarea(page).pressSequentially('draft', { delay: 15 });
        const move = scenario => changeMode({ page, network, db, userId: owner.userId, profile, round: 0, scenario, samples, record: false });
        await move('first_expand');
        await textarea(page).focus(); await textarea(page).press('ArrowLeft'); await textarea(page).pressSequentially('X');
        assert.equal(await textarea(page).inputValue(), 'drafXt', 'EXPERIENCE_CONTINUOUS_EDIT_FAILED');
        const count = network.count('/api/intelligence/query');
        await textarea(page).dispatchEvent('compositionstart', { data: '中' });
        await textarea(page).dispatchEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 229, isComposing: true, bubbles: true });
        await textarea(page).dispatchEvent('keydown', { key: 'Escape', code: 'Escape', isComposing: true, bubbles: true });
        assert.equal(network.count('/api/intelligence/query'), count, 'EXPERIENCE_IME_SENT_QUERY');
        await assertLayout(page, true);
        await textarea(page).dispatchEvent('compositionend', { data: '中' });
        await textarea(page).press('Shift+Enter'); assert.match(await textarea(page).inputValue(), /\n/, 'EXPERIENCE_NEWLINE_FAILED');
        await move('collapse'); await move('reopen');
        const beforeSources = network.count('/api/intelligence/query');
        let receiptCursor = network.cursor();
        await currentResult(page).getByRole('button', { name: /^查看来源：/ }).first().click();
        await page.getByRole('region', { name: '来源详情', exact: true }).last().waitFor();
        await network.receipt(answerResponse, { after: receiptCursor, surface: 'answer_table', sourceCount: 'present' });
        await assertLayout(page, true);
        receiptCursor = network.cursor();
        await page.getByRole('button', { name: '关闭来源', exact: true }).last().click();
        await network.receipt(answerResponse, { after: receiptCursor, surface: 'answer_table', sourceCount: 'empty' });
        assert.equal(network.count('/api/intelligence/query'), beforeSources, 'EXPERIENCE_SOURCE_REEXECUTED');
        await page.getByRole('button', { name: '研究资料', exact: true }).click();
        const research = page.getByRole('complementary', { name: '研究资料与口径', exact: true });
        await research.waitFor();
        assert.match(await research.getByRole('region', { name: '当前分析范围', exact: true }).textContent(), /CBD/, 'EXPERIENCE_RESEARCH_SCOPE_MISSING');
        await assertLayout(page, true);
        if (width === 1280) {
          await page.getByRole('button', { name: '历史记录', exact: true }).click();
          await resizeOpenPanels({ page, network, height: profile.height });
        }
        await page.getByRole('button', { name: '关闭研究资料', exact: true }).click();
        assert.equal(network.count('/api/intelligence/query'), beforeSources, 'EXPERIENCE_RESEARCH_REEXECUTED');

        // Same saved snapshot is opened through the existing authorized history
        // endpoint. No original query or model submission may occur on restore.
        const history = page.getByRole('complementary', { name: '历史工作记录', exact: true });
        if (!await history.isVisible()) await page.getByRole('button', { name: '历史记录', exact: true }).click();
        const search = history.getByRole('searchbox', { name: '搜索标题或最近问题', exact: true });
        const searched = term => page.waitForResponse(response => new URL(response.url()).pathname === '/api/intelligence/query/history'
          && response.request().postDataJSON()?.action === 'list' && response.request().postDataJSON()?.search === term);
        const firstSearch = searched('2026');
        await search.pressSequentially('2026', { delay: 15 });
        await firstSearch; await network.idle();
        assert.equal(await search.evaluate(node => node === document.activeElement), true, 'EXPERIENCE_HISTORY_SEARCH_BLURRED');
        const continuedSearch = searched('2026Q3');
        await search.pressSequentially('Q3', { delay: 15 });
        await continuedSearch; await network.idle();
        assert.equal(await search.inputValue(), '2026Q3', 'EXPERIENCE_HISTORY_CONTINUOUS_EDIT_FAILED');
        await history.getByRole('button', { name: `打开对话：${QUESTION}`, exact: true }).first().waitFor();
        const beforeHistory = network.count('/api/intelligence/query');
        const [openedResponse] = await Promise.all([responseFor(page, '/api/intelligence/query/history', 'open'),
          history.getByRole('button', { name: `打开对话：${QUESTION}`, exact: true }).first().click()]);
        assert.equal(openedResponse.status(), 200, 'EXPERIENCE_HISTORY_FAILED');
        const opened = (await openedResponse.json()).opened;
        assert.equal(opened.selected.requestId, answer.requestId, 'EXPERIENCE_HISTORY_WRONG_TURN');
        assert.equal(opened.selected.reply.result.resultId, answer.result.resultId, 'EXPERIENCE_HISTORY_CHANGED_SNAPSHOT');
        await currentResult(page).getByRole('button', { name: /^查看来源：/ }).first().waitFor();
        await network.receipt(openedResponse, { surface: 'answer_table', sourceCount: 'empty' });
        assert.equal(network.count('/api/intelligence/query'), beforeHistory, 'EXPERIENCE_HISTORY_REEXECUTED');
        // Opening a saved turn auto-closes history on narrow viewports. Avoid
        // racing that close animation with a click on a now-hidden control.
        // Verify the actual closed state rather than weakening the behavior check.
        if (width >= 1024) {
          await history.getByRole('button', { name: '关闭历史', exact: true }).click();
          await history.waitFor({ state: 'hidden' });
        } else {
          await history.waitFor({ state: 'hidden' });
        }
        if (width === 1280) layout.stopServerState = await pendingAndStop({ page, db, blocker, userId: owner.userId, ids, network });
        const longResponse = await send(page, '找出2026Q3CBD季度总面积超过5万平方米的楼，并查看净有效租金');
        assert.equal(longResponse.status(), 200, 'EXPERIENCE_LONG_RESULT_HTTP_FAILURE');
        const long = await longResponse.json();
        assert.equal(long.status, 'ready', 'EXPERIENCE_LONG_RESULT_NOT_READY');
        assert.equal(long.result.table.rows.length, 12, 'EXPERIENCE_LONG_RESULT_INCOMPLETE');
        assert.ok(long.result.sources.every(source => ids.includes(source.entityId)), 'EXPERIENCE_LONG_RESULT_SCOPE_EXPANDED');
        await currentResult(page).locator('table tbody tr').last().waitFor();
        assert.equal(await currentResult(page).locator('table tbody tr').count(), 12, 'EXPERIENCE_LONG_TABLE_INCOMPLETE');
        await network.receipt(longResponse, { surface: 'answer_table', sourceCount: 'empty' });
        const [chartResponse] = await Promise.all([responseFor(page, '/api/intelligence/query/artifact', 'chart'),
          currentResult(page).getByRole('button', { name: '查看柱状图', exact: true }).click()]);
        const chart = currentResult(page).getByRole('figure', { name: '同源查询图表', exact: true });
        await chart.waitFor(); await network.receipt(chartResponse, { surface: 'chart' }); await network.idle();
        const chartNode = await chart.elementHandle();
        const queriesBeforeSwitch = network.count('/api/intelligence/query'), chartsBeforeSwitch = network.count('/api/intelligence/query/artifact');
        await modeWithoutNetworkIdle(page, false); await modeWithoutNetworkIdle(page, true);
        await chart.waitFor(); await network.idle();
        assert.equal(await chartNode.evaluate(node => node.isConnected), true, 'EXPERIENCE_CHART_REMOUNTED');
        assert.equal(network.count('/api/intelligence/query'), queriesBeforeSwitch, 'EXPERIENCE_LONG_RESULT_REEXECUTED');
        assert.equal(network.count('/api/intelligence/query/artifact'), chartsBeforeSwitch, 'EXPERIENCE_CHART_REEXECUTED');
        await chartNode.dispose(); await assertLayout(page, true);
        await textarea(page).focus(); await page.keyboard.press('Escape');
        await page.waitForFunction(() => document.querySelector('#home-query')?.closest('[data-mode]')?.dataset.mode === 'compact');
        await page.getByRole('button', { name: EXPAND, exact: true }).waitFor();
        await until(() => page.getByRole('button', { name: EXPAND, exact: true }).evaluate(node => node === document.activeElement), 'EXPERIENCE_FOCUS_NOT_RESTORED');
        await assertLayout(page, false);
        assert.equal(network.browserErrors(), 0, 'EXPERIENCE_BROWSER_ERROR'); layout.status = 'success';
        layout.checks = ['personal_welcome', 'short_greeting', 'same_input_draft_selection', 'composition_enter_escape', 'shift_enter',
          'full_viewport_composer', 'source_access', 'research_panel', 'history_continuous_search', 'saved_history_no_requery',
          'long_table', 'chart_survives_mode_change', 'escape_focus_restore', 'no_horizontal_overflow',
          ...(width === 1280 ? ['open_panels_resize_composer_composition', 'open_panels_resize_history_composition', 'wide_resize_preserves_panel_choice',
            'pending_mode_switch', 'next_draft_survives_response', 'stop_waiting_semantics', 'idempotent_retry'] : [])];
      } catch (error) { layout.status = 'failed'; layout.error = safeError(error); throw error; }
      finally { network.stop(); await context.close(); await checkpoint(); }
    }

    const variants = [{ name: 'before', app: beforeApp.origin, scenarios: EXPERIENCE_BASELINE_SCENARIOS },
      { name: 'after', app: app.origin, scenarios: EXPERIENCE_SCENARIOS }];
    for (const profile of QUERY_PERFORMANCE_PROFILES) for (let round = 1; round <= EXPERIENCE_SAMPLES; round++) for (const variant of variants) {
      let session;
      try {
        session = await setupContext(profile, 'no-preference', variant.app);
        const { page, network } = session;
        const answer = await queryReady(page, await send(page, QUESTION), ids, network);
        await textarea(page).pressSequentially('next research draft', { delay: 5 });
        await textarea(page).press('ArrowLeft'); await textarea(page).press('Shift+ArrowLeft');
        for (const scenario of variant.scenarios) await changeMode({ page, network, db, userId: owner.userId, profile, round, scenario, samples, variant: variant.name });
        // A real follow-up after both layouts verifies parent + conversation are
        // retained, rather than only comparing text painted on the screen.
        const next = await send(page, QUESTION), request = next.request().postDataJSON();
        assert.equal(request.conversation?.id, answer.conversation.id, 'EXPERIENCE_CONVERSATION_CHANGED');
        assert.equal(request.conversation?.parentRequestId, answer.requestId, 'EXPERIENCE_PARENT_CHANGED');
        await queryReady(page, next, ids, network); await network.idle();
        assert.equal(network.errors.length, 0, 'EXPERIENCE_HTTP_FAILURE');
        assert.equal(network.browserErrors(), 0, 'EXPERIENCE_BROWSER_ERROR');
        if (variant.name === 'after' && round === EXPERIENCE_SAMPLES && profile.name === 'mobile') {
          await db.query('update private.ai_query_grants set enabled=false where user_id=$1', [owner.userId]);
          const denied = await send(page, QUESTION);
          assert.equal(denied.status(), 403, 'EXPERIENCE_REVOKED_ACCESS_ALLOWED');
          await page.waitForFunction(() => !document.querySelector('section[aria-label="查询结果"]') && document.querySelector('#home-query')?.disabled);
          report.expandedRevocationCleared = true;
        }
      } catch (error) {
        const rows = samples.filter(row => row.variant === variant.name && row.profile === profile.name && row.round === round);
        if (rows.length && rows.every(row => row.status === 'success')) { rows.at(-1).status = 'failed'; rows.at(-1).error = safeError(error); }
        for (const scenario of variant.scenarios) if (!rows.some(row => row.scenario === scenario)) samples.push({ variant: variant.name, profile: profile.name, round, scenario, status: 'dependency_failed', error: safeError(error) });
        report.stoppedEarly = { variant: variant.name, profile: profile.name, round, error: safeError(error) }; throw error;
      } finally { session?.network.stop(); await session?.context.close(); await checkpoint(); }
      console.log(`EXPERIENCE_P1_WORKSPACE ${variant.name} ${profile.name} ${round}/${EXPERIENCE_SAMPLES}`);
    }
    report.complete = true; await checkpoint();
    assert.equal(report.functionalPassed, true, 'EXPERIENCE_FUNCTIONAL_FAILURE');
    assert.equal(report.baselineBudgetsMet, true, 'EXPERIENCE_BASELINE_BUDGET_FAILURE');
    assert.equal(report.budgetsMet, true, 'EXPERIENCE_BUDGET_FAILURE');
    assert.equal(report.expandedRevocationCleared, true, 'EXPERIENCE_REVOCATION_NOT_VERIFIED');
    console.log('PASS EXPERIENCE_P1_WORKSPACE 120 released-P0 + 240 candidate transition samples and 4 candidate viewport operation sequences');
    return { reportPath, summary: report.summary };
  } finally {
    await browser?.close(); await checkpoint();
    await blocker.query('rollback').catch(() => {}); await blocker.end();
    if (originalGrant) await grantQuery({ setup: db }, owner.userId, { capabilities: originalGrant.capabilities, fields: originalGrant.fields,
      allSubmarkets: originalGrant.all_submarkets, submarkets: originalGrant.submarkets,
      allBuildings: originalGrant.all_buildings, buildingIds: originalGrant.building_ids });
    await db.query('delete from public.building_metrics where building_id=any($1::uuid[])', [ids]);
    await db.query('delete from public.buildings where id=any($1::uuid[])', [ids]); await db.end();
  }
}

function verifySummaryContract() {
  const samples = QUERY_PERFORMANCE_PROFILES.flatMap(profile => EXPERIENCE_SCENARIOS.flatMap(scenario =>
    Array.from({ length: EXPERIENCE_SAMPLES }, (_, index) => ({ profile: profile.name, scenario, round: index + 1, status: 'success',
      sameInputNode: true, sameDraftAndSelection: true, sameOriginalResult: true, noQueryOrAuditReplay: true, longTaskObserverSupported: true,
      feedback_ms: 32, content_usable_ms: 360, long_task_count: 0, long_task_total_ms: 0, long_task_max_ms: 0 }))));
  assert.ok(summarizeExperienceWorkspace(samples).every(row => row.complete && row.budgetsMet));
  const missing = summarizeExperienceWorkspace(samples.slice(1)); assert.equal(missing[0].complete, false); assert.equal(missing[0].missingSamples, 1);
  const failed = structuredClone(samples); failed[0].status = 'failed'; failed[0].content_usable_ms = null;
  assert.equal(summarizeExperienceWorkspace(failed)[0].budgetsMet, false);
  const late = samples.map(row => ({ ...row, content_usable_ms: 501 })); assert.ok(summarizeExperienceWorkspace(late).every(row => !row.budgetsMet));
  const duplicate = samples.map(row => ({ ...row, noQueryOrAuditReplay: false })); assert.ok(summarizeExperienceWorkspace(duplicate).every(row => !row.complete));
  const after = samples.map(row => ({ ...row, variant: 'after' }));
  const before = samples.filter(row => EXPERIENCE_BASELINE_SCENARIOS.includes(row.scenario))
    .map(row => ({ ...row, variant: 'before', content_usable_ms: 400 }));
  assert.equal(before.length, 120); assert.equal(after.length, 240);
  const pair = summarizeExperiencePair([...before, ...after]);
  assert.ok([...pair.summary, ...pair.baselineSummary].every(row => row.complete && row.budgetsMet));
  assert.equal(pair.comparisons.length, 6, 'new focus paths must not invent before measurements');
  assert.ok(pair.comparisons.every(row => row.metrics.content_usable_ms.p90.delta_ms === -40));
  assert.ok(summarizeExperiencePair(after).baselineSummary.every(row => !row.complete && !row.budgetsMet));
  const failedBaseline = structuredClone(before); failedBaseline[0].status = 'failed';
  assert.equal(summarizeExperiencePair([...failedBaseline, ...after]).baselineSummary[0].complete, false,
    'successful after samples cannot hide a failed before sample');
  const missingBaseline = summarizeExperiencePair([...before.slice(1), ...after]);
  assert.equal(missingBaseline.baselineSummary[0].missingSamples, 1);
  assert.equal(missingBaseline.comparisons[0].complete, false);
  console.log('PASS EXPERIENCE_P1_SUMMARY candidate/baseline missing, failed, duplicated and over-budget samples cannot pass; focus has no invented baseline');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv[2] === '--self-test') verifySummaryContract();
  else await verifyExperienceP1Workspace({ previewFile: process.env.AI_QUERY_AUTH_PREVIEW_FILE, statusFile: process.env.AI_QUERY_AUTH_STATUS });
}
