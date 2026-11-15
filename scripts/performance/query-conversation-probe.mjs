import { safeQueryEndpoint } from './query-conversation-network.mjs';

// Browser-only measurement. No network interception, application state writes,
// response rewriting or synthetic authentication is performed by this probe.
export function observeQueryConversation({ chartRequired, timeoutMs = 30000, sourceLabelPrefix = '查看来源：面积加权净有效租金 ' }) {
  window.__colliersQueryPerformance?.stop();
  performance.setResourceTimingBufferSize(1000);
  const oldResult = document.querySelector('section[aria-label="查询结果"]');
  const state = { start: null, status: 'waiting', feedback_ms: null, result_painted_ms: null,
    content_usable_ms: null, source_open_ms: [], requests: [] };
  const pending = new Set(); let stopped = false, frame, sourceStart = null, oldSource = null;
  const visible = element => {
    if (!element?.isConnected) return false;
    const rect = element.getBoundingClientRect(), style = getComputedStyle(element);
    return rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden' && Number(style.opacity) !== 0;
  };
  const currentResult = () => {
    const node = document.querySelector('section[aria-label="查询结果"]');
    return node && node !== oldResult && visible(node) ? node : null;
  };
  const numericAction = node => [...(node?.querySelectorAll('button[aria-label]:not(:disabled)') ?? [])]
    .find(button => button.getAttribute('aria-label')?.startsWith(sourceLabelPrefix));
  const contentReady = () => {
    const result = currentResult();
    return result && visible(numericAction(result))
      && (!chartRequired || visible(result.querySelector('figure[aria-label="同源查询图表"]')))
      && !document.querySelector('button[aria-label="停止等待"]');
  };
  const paint = (field, predicate) => {
    if (state[field] !== null || pending.has(field) || !predicate()) return;
    pending.add(field);
    requestAnimationFrame(() => {
      pending.delete(field);
      if (!stopped && state.start !== null && predicate()) state[field] = performance.now() - state.start;
    });
  };
  const click = event => {
    const button = event.target?.closest?.('button');
    if (state.start === null && button?.getAttribute('aria-label') === '发送问题') {
      state.start = performance.now(); state.status = 'running'; return;
    }
    if (state.status === 'ready' && button?.getAttribute('aria-label')?.startsWith(sourceLabelPrefix)) {
      sourceStart = performance.now(); oldSource = document.querySelector('section[aria-label="来源详情"]');
    }
  };
  const tick = () => {
    if (stopped) return;
    if (state.start !== null) {
      paint('feedback_ms', () => visible(document.querySelector('button[aria-label="停止等待"]')) || Boolean(currentResult()));
      paint('result_painted_ms', () => visible(numericAction(currentResult())));
      paint('content_usable_ms', contentReady);
      if (state.content_usable_ms !== null && state.feedback_ms !== null) state.status = 'ready';
      else if (performance.now() - state.start >= timeoutMs) state.status = 'timeout';
      if (sourceStart !== null && !pending.has('source')) {
        const panel = document.querySelector('section[aria-label="来源详情"]');
        if (panel !== oldSource && visible(panel)) {
          pending.add('source'); const from = sourceStart; sourceStart = null;
          requestAnimationFrame(() => {
            pending.delete('source');
            if (!stopped && visible(panel)) state.source_open_ms.push(performance.now() - from);
          });
        }
      }
    }
    frame = requestAnimationFrame(tick);
  };
  const stop = () => { stopped = true; cancelAnimationFrame(frame); document.removeEventListener('click', click, true); };
  document.addEventListener('click', click, true); frame = requestAnimationFrame(tick);
  window.__colliersQueryPerformance = { state, stop, read: () => {
    const classify = pathname => pathname === '/api/intelligence/query' ? 'submit'
      : pathname === '/api/intelligence/query/artifact' ? 'artifact'
        : pathname === '/api/intelligence/query/receipt' ? 'receipt' : null;
    const requests = performance.getEntriesByType('resource').flatMap(entry => {
      const url = new URL(entry.name), kind = url.origin === location.origin ? classify(url.pathname) : null;
      if (!kind || state.start === null || entry.startTime < state.start) return [];
      return [{ kind, request_start_ms: entry.startTime - state.start,
        status: typeof entry.responseStatus === 'number' ? entry.responseStatus : null,
        response_start_ms: entry.responseStart > 0 ? entry.responseStart - state.start : null,
        response_end_ms: entry.responseEnd > 0 ? entry.responseEnd - state.start : null,
        request_to_first_byte_ms: entry.responseStart > 0 && entry.requestStart > 0 ? entry.responseStart - entry.requestStart : null,
        transfer_ms: entry.responseEnd > 0 && entry.responseStart > 0 ? entry.responseEnd - entry.responseStart : null,
        encoded_body_bytes: entry.encodedBodySize, decoded_body_bytes: entry.decodedBodySize }];
    });
    const submit = requests.find(request => request.kind === 'submit');
    return { ...state, requests, browser_validation_and_render_ms: submit?.response_end_ms !== null && submit?.response_end_ms !== undefined && state.result_painted_ms !== null
      ? state.result_painted_ms - submit.response_end_ms : null };
  } };
}

export const QUERY_PERFORMANCE_PROFILES = [
  { name: 'desktop', width: 1280, height: 900, latencyMs: 60, downloadMbps: 30, uploadMbps: 10, cpuRate: 1, usableP90Ms: 2500 },
  { name: 'mobile', width: 390, height: 844, latencyMs: 150, downloadMbps: 10, uploadMbps: 5, cpuRate: 4, usableP90Ms: 3500 },
];
export const QUERY_PERFORMANCE_STEPS = [
  { id: 'single_market', operation: 'aggregate', before: '2026Q3CBD净有效租金', after: '2026Q3CBD净有效租金', chart: false },
  { id: 'inherited_market', operation: 'aggregate', before: '金融街呢？', after: '金融街呢？', chart: false },
  { id: 'comparison', operation: 'group_aggregate', before: '把这两个地区对比一下', after: '把这两个地区对比一下', chart: true },
  { id: 'four_quarter_trend', operation: 'group_trend', before: '再看看过去四个季度的变化', after: '再看看过去四个季度的变化', chart: true },
];
export const QUERY_PERFORMANCE_CACHE_STATES = ['new_context_first_dialogue', 'same_document_second_dialogue'];
const QUERY_PERFORMANCE_ERRORS = new Set(['timeout', 'operation_failed', 'LOGIN_HTTP_FAILURE', 'QUERY_NOT_READY',
  'UNEXPECTED_QUERY_PLAN', 'SOURCE_OUTSIDE_GRANTED_FIXTURE', 'MISSING_CONVERSATION', 'RESULT_READINESS_TIMEOUT',
  'DATABASE_SOURCE_NOT_VISIBLE', 'DUPLICATE_QUERY_SUBMISSION', 'QUERY_NETWORK_FAILURE', 'QUERY_BROWSER_ERROR', 'NEW_CONVERSATION_RELOADED_DOCUMENT',
  'QUERY_BACKGROUND_HTTP_FAILURE',
  'MULTI_METRIC_ORACLE_MISMATCH', 'MULTI_METRIC_CHART_MISMATCH', 'MULTI_METRIC_CHART_NOT_READY',
  'MULTI_METRIC_ORACLE_FIXTURE_INVALID', 'MULTI_METRIC_ORACLE_METRICS_MISMATCH', 'MULTI_METRIC_ORACLE_ROW_COUNT_MISMATCH',
  'MULTI_METRIC_ORACLE_DIMENSION_MISMATCH', 'MULTI_METRIC_ORACLE_VALUE_MISMATCH', 'MULTI_METRIC_ORACLE_COUNT_MISMATCH', 'MULTI_METRIC_ORACLE_DENOMINATOR_MISMATCH',
  'QUERY_RECEIPT_CONFIRMATION_TIMEOUT', 'QUERY_NETWORK_COMPLETION_TIMEOUT', 'QUERY_OBSERVER_STOPPED']);
export function queryPerformanceRevision(env, event) {
  const sha = value => typeof value === 'string' && /^[a-f0-9]{40}$/.test(value) ? value : null;
  const testedCommit = sha(env.GITHUB_SHA);
  const mergeRef = /^refs\/pull\/\d+\/merge$/.test(env.GITHUB_REF ?? '');
  return { testedCommit: testedCommit ?? 'working_tree_not_release_evidence',
    testedMergeSha: mergeRef ? testedCommit : null,
    headSha: sha(event?.pull_request?.head?.sha) ?? (!mergeRef ? testedCommit : null),
    revisionBasis: mergeRef ? 'GitHub pull-request merge checkout; headSha identifies the proposed branch separately'
      : testedCommit ? 'GitHub workflow checkout' : 'Local working tree; no release-commit claim' };
}
export function queryPerformanceErrorCode(error) {
  if (error?.name === 'TimeoutError') return 'timeout';
  // AssertionError messages can append actual/expected data after the first line.
  // Only our static codes may enter an artifact or CI diagnostic.
  const code = typeof error?.message === 'string' ? error.message.split('\n')[0] : '';
  return QUERY_PERFORMANCE_ERRORS.has(code) ? code : 'operation_failed';
}
export function queryPerformanceFailureDiagnostics(samples) {
  return samples.flatMap(sample => {
    const required = ['feedback_ms', 'result_painted_ms', 'content_usable_ms', 'source_open_ms',
      ...(sample.step === 'four_quarter_trend' ? ['source_reopen_ms'] : [])];
    const missing = required.some(metric => !Number.isFinite(sample[metric]));
    if (sample.status === 'success' && !missing) return [];
    const profile = QUERY_PERFORMANCE_PROFILES.find(value => value.name === sample.profile);
    const status = ['failed', 'setup_failed', 'dependency_failed', 'result_mismatch', 'running', 'success'].includes(sample.status)
      ? sample.status : 'failed';
    return [{ variant: ['before', 'after'].includes(sample.variant) ? sample.variant : 'unknown',
      viewport: profile ? { name: profile.name, width: profile.width, height: profile.height } : null,
      round: Number.isInteger(sample.round) ? sample.round : null,
      cache_state: QUERY_PERFORMANCE_CACHE_STATES.includes(sample.cache_state) ? sample.cache_state : 'unknown',
      step: QUERY_PERFORMANCE_STEPS.some(value => value.id === sample.step) ? sample.step : 'unknown', status,
      phase: ['query', 'source_interaction', 'metric_switch', 'receipt_confirmation', 'complete', 'login_or_browser', 'new_conversation', 'equivalence', 'dependency'].includes(sample.phase) ? sample.phase : 'unknown',
      receiptStage: ['initial_result', 'initial_chart', 'metric_chart', 'source_open', 'source_close', 'source_reopen', 'source_reclose'].includes(sample.receiptStage) ? sample.receiptStage : null,
      error: status === 'success' ? 'MISSING_REQUIRED_MEASUREMENT'
        : sample.error ? queryPerformanceErrorCode({ message: sample.error }) : status.toUpperCase(),
      httpStatus: Number.isInteger(sample.httpStatus) && sample.httpStatus >= 100 && sample.httpStatus <= 599 ? sample.httpStatus : null,
      networkFailures: (sample.networkFailures ?? []).slice(0, 20).map(failure => ({
        kind: ['submit', 'artifact', 'receipt', 'capabilities', 'recover', 'other'].includes(failure.kind) ? failure.kind : 'other',
        endpoint: safeQueryEndpoint(failure.endpoint),
        method: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'].includes(failure.method) ? failure.method : 'OTHER',
        attribution: failure.attribution === 'started_in_sample' ? 'started_in_sample' : 'started_before_sample', critical: failure.critical === true,
        error: /^(?:net::ERR_[A-Z0-9_]+|HTTP_[1-5][0-9]{2})$/.test(failure.error) ? failure.error : 'NETWORK_REQUEST_FAILED',
        httpStatus: Number.isInteger(failure.httpStatus) && failure.httpStatus >= 100 && failure.httpStatus <= 599 ? failure.httpStatus : null,
      })), networkFailureCount: sample.networkFailures?.length ?? 0 }];
  });
}
export async function checkpointQueryPerformancePair(samples, { checkpoint, onFailure }) {
  const failures = queryPerformanceFailureDiagnostics(samples);
  // Persist raw samples, failed conditions and every still-missing condition
  // before stopping. A failed pair must never consume the remaining 20 rounds.
  await checkpoint(failures);
  if (!failures.length) return;
  for (const failure of failures) onFailure(failure);
  throw new Error('QUERY_PERFORMANCE_PAIR_FAILED');
}
export function nearestRank(values, percentile) {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  return sorted.length ? sorted[Math.max(0, Math.ceil(percentile * sorted.length) - 1)] : null;
}
export function summarizeQueryPerformance(samples, variants, expectedPerCondition = 20) {
  const summaries = [];
  for (const variant of variants) for (const profile of QUERY_PERFORMANCE_PROFILES)
    for (const cacheState of QUERY_PERFORMANCE_CACHE_STATES) for (const step of QUERY_PERFORMANCE_STEPS) {
      const group = samples.filter(sample => sample.variant === variant && sample.profile === profile.name
        && sample.cache_state === cacheState && sample.step === step.id);
      const measured = metric => group.filter(sample => sample.status === 'success' && Number.isFinite(sample[metric])).map(sample => sample[metric]);
      const metrics = Object.fromEntries(['feedback_ms', 'result_painted_ms', 'content_usable_ms', 'source_open_ms', 'source_reopen_ms', 'browser_validation_and_render_ms'].map(metric => {
        const values = measured(metric);
        return [metric, { measured: values.length, missing: group.length - values.length,
          p50: nearestRank(values, 0.5), p90: nearestRank(values, 0.9) }];
      }));
      const failed = group.filter(sample => sample.status !== 'success').length;
      const complete = group.length === expectedPerCondition && failed === 0 && metrics.feedback_ms.measured === expectedPerCondition
        && metrics.content_usable_ms.measured === expectedPerCondition && metrics.source_open_ms.measured === expectedPerCondition;
      const met = complete && metrics.feedback_ms.p90 <= 100 && metrics.content_usable_ms.p90 <= profile.usableP90Ms
        && (step.id !== 'four_quarter_trend' || (metrics.source_reopen_ms.measured === expectedPerCondition && metrics.source_reopen_ms.p90 <= 500));
      summaries.push({ variant, profile: profile.name, cache_state: cacheState, step: step.id,
        expected: expectedPerCondition, samples: group.length, failed, missing_samples: Math.max(0, expectedPerCondition - group.length),
        measurementComplete: complete, metrics, budget: { feedback_p90_ms: 100, content_usable_p90_ms: profile.usableP90Ms, source_reopen_p90_ms: 500 }, budgetsMet: met });
    }
  return summaries;
}
