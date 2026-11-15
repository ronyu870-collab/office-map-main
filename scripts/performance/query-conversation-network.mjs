// Observes real Playwright request lifecycles. No interception or application
// state changes. Receipt bodies are read only to extract allowlisted view shape;
// tokens, source IDs, URLs, query strings, headers and bodies are never retained.
export function observeQueryNetwork(page, sample) {
  const origin = new URL(page.url()).origin, requests = new Map(), listeners = new Set(), failures = new Set();
  let sequence = 0, stopped = false;
  const knownMethods = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS']);
  const method = request => knownMethods.has(request.method()) ? request.method() : 'OTHER';
  const kind = request => {
    const url = new URL(request.url());
    if (url.origin !== origin) return 'other';
    return ({ '/api/intelligence/query': 'submit', '/api/intelligence/query/artifact': 'artifact',
      '/api/intelligence/query/receipt': 'receipt', '/api/intelligence/query/capabilities': 'capabilities',
      '/api/intelligence/query/recover': 'recover' })[url.pathname] ?? 'other';
  };
  const notify = () => { for (const listener of [...listeners]) listener(); };
  const receiptShape = request => {
    try {
      const body = request.postDataJSON();
      return { phase: ['client_received', 'client_dom_committed', 'browser_download_dispatched'].includes(body?.phase) ? body.phase : 'unknown',
        surface: ['answer_table', 'chart', 'clarification'].includes(body?.view?.surface) ? body.view.surface : null,
        sourceCount: Array.isArray(body?.view?.sourceIds) ? body.view.sourceIds.length : null };
    } catch { return { phase: 'unknown', surface: null, sourceCount: null }; }
  };
  const onRequest = request => {
    const requestKind = kind(request), requestMethod = method(request);
    const record = { index: sequence++, kind: requestKind, method: requestMethod,
      critical: requestMethod === 'POST' && ['submit', 'artifact', 'receipt'].includes(requestKind),
      status: 'pending', httpStatus: null, ...(requestKind === 'receipt' && requestMethod === 'POST' ? receiptShape(request) : {}) };
    requests.set(request, record); sample.networkRequests.push(record);
    if (requestKind === 'submit' && requestMethod === 'POST') sample.actualQueryRequests++;
    notify();
  };
  const fail = (request, error, httpStatus = null) => {
    if (failures.has(request)) return;
    failures.add(request);
    const record = requests.get(request);
    const failure = { index: record?.index ?? null, kind: record?.kind ?? kind(request), method: record?.method ?? method(request),
      attribution: record ? 'started_in_sample' : 'started_before_sample', critical: record?.critical === true, error,
      httpStatus: httpStatus ?? record?.httpStatus ?? null };
    sample.networkFailures.push(failure);
    if (failure.critical) sample.queryFailures++;
    notify();
  };
  const onResponse = response => {
    const request = response.request(), record = requests.get(request), status = response.status();
    if (record) record.httpStatus = status;
    if (status < 200 || status >= 300) fail(request, `HTTP_${status}`, status);
    notify();
  };
  const onFinished = request => {
    const record = requests.get(request);
    if (record) record.status = failures.has(request) ? 'failed' : 'finished';
    notify();
  };
  const onFailed = request => {
    const record = requests.get(request), raw = request.failure()?.errorText;
    if (record) record.status = 'failed';
    fail(request, typeof raw === 'string' && /^net::ERR_[A-Z0-9_]+$/.test(raw) ? raw : 'NETWORK_REQUEST_FAILED');
  };
  const waitUntil = (check, timeoutMs, timeoutCode) => new Promise((resolve, reject) => {
    const cleanup = () => { clearTimeout(timer); listeners.delete(poll); };
    const poll = () => {
      if (stopped || sample.queryFailures > 0) { cleanup(); reject(new Error(stopped ? 'QUERY_OBSERVER_STOPPED' : 'QUERY_NETWORK_FAILURE')); return; }
      const value = check();
      if (value) { cleanup(); resolve(value); }
    };
    const timer = setTimeout(() => { cleanup(); reject(new Error(timeoutCode)); }, timeoutMs);
    listeners.add(poll); poll();
  });
  page.on('request', onRequest); page.on('response', onResponse);
  page.on('requestfinished', onFinished); page.on('requestfailed', onFailed);
  return {
    cursor: () => sequence,
    waitForReceipt: ({ after = 0, surface, sourceCount = 'any' }, timeoutMs = 12000) => waitUntil(() => {
      const record = sample.networkRequests.find(value => value.index >= after && value.kind === 'receipt' && value.method === 'POST'
        && value.phase === 'client_dom_committed' && value.surface === surface && value.status === 'finished' && value.httpStatus === 200
        && (sourceCount === 'any' || sourceCount === 'empty' && value.sourceCount === 0 || sourceCount === 'present' && value.sourceCount > 0));
      return record ? { ...record } : null;
    }, timeoutMs, 'QUERY_RECEIPT_CONFIRMATION_TIMEOUT'),
    waitForIdle: (timeoutMs = 12000) => waitUntil(() => !sample.networkRequests.some(value => value.critical && value.status === 'pending'),
      timeoutMs, 'QUERY_NETWORK_COMPLETION_TIMEOUT'),
    stop: () => {
      stopped = true; notify();
      page.off('request', onRequest); page.off('response', onResponse);
      page.off('requestfinished', onFinished); page.off('requestfailed', onFailed);
    },
  };
}
