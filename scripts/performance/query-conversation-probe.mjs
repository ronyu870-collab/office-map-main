// Browser-only measurement. No network interception, application state writes,
// response rewriting or synthetic authentication is performed by this probe.
export function observeQueryConversation({ chartRequired, timeoutMs = 30000 }) {
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
  const numericAction = node => node?.querySelector('button[aria-label^="查看来源：面积加权净有效租金 "]:not(:disabled)');
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
    if (state.status === 'ready' && button?.getAttribute('aria-label')?.startsWith('查看来源：面积加权净有效租金 ')) {
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
  { id: 'inherited_market', operation: 'aggregate', before: '2026Q3金融街净有效租金', after: '金融街呢？', chart: false },
  { id: 'comparison', operation: 'group_aggregate', before: '2026Q3CBD、金融街净有效租金按子市场比较', after: '把这两个地区对比一下', chart: true },
  { id: 'four_quarter_trend', operation: 'group_trend', before: 'CBD、金融街净有效租金2025Q4至2026Q3按子市场趋势各期样本', after: '再看看过去四个季度的变化', chart: true },
];
export const QUERY_PERFORMANCE_CACHE_STATES = ['new_context_first_dialogue', 'same_document_second_dialogue'];
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
