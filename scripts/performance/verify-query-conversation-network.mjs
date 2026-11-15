// Collector calibration only: synthetic lifecycle events never serve as browser
// or product performance evidence. This module is also imported by the collector.
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { observeQueryNetwork } from './query-conversation-network.mjs';

const origin = 'http://127.0.0.1:3099';
const secret = 'SYNTHETIC_SECRET_MUST_NOT_ENTER_DIAGNOSTICS';
const page = () => Object.assign(new EventEmitter(), { url: () => origin + '/' });
const sample = () => ({ actualQueryRequests: 0, queryFailures: 0, networkFailures: [], networkRequests: [] });
const request = (path, { method = 'POST', body, error = 'net::ERR_ABORTED' } = {}) => ({
  url: () => origin + path + '?private=' + secret,
  method: () => method,
  postDataJSON: () => body,
  failure: () => ({ errorText: error }),
});
const receipt = (sourceIds = [], surface = 'answer_table') => request('/api/intelligence/query/receipt', {
  body: { deliveryToken: secret, bodySha256: secret, phase: 'client_dom_committed', view: { surface, sourceIds } },
});
const response = (browser, req, status = 200) => browser.emit('response', { request: () => req, status: () => status });
const complete = (browser, req, status = 200) => {
  browser.emit('request', req); response(browser, req, status); browser.emit('requestfinished', req);
};
const isNetworkFailure = error => error?.message === 'QUERY_NETWORK_FAILURE';
let checks = 0;
async function check(name, run) {
  await run(); checks++; console.log('PASS query network collector: ' + name);
}

await check('HTTP 200 waits for requestfinished before receipt confirmation and idle', async () => {
  const browser = page(), data = sample(), network = observeQueryNetwork(browser, data);
  try {
    const submit = request('/api/intelligence/query'); complete(browser, submit);
    const req = receipt(); browser.emit('request', req);
    let confirmed = false, idle = false;
    const waiting = network.waitForReceipt({ surface: 'answer_table', sourceCount: 'empty' }).then(value => { confirmed = true; return value; });
    const waitingIdle = network.waitForIdle().then(() => { idle = true; });
    response(browser, req);
    await Promise.resolve();
    assert.equal(confirmed, false); assert.equal(idle, false);
    browser.emit('requestfinished', req);
    const record = await waiting; await waitingIdle;
    assert.equal(record.status, 'finished'); assert.equal(record.httpStatus, 200);
    assert.equal(record.phase, 'client_dom_committed'); assert.equal(record.sourceCount, 0);
    assert.equal(data.actualQueryRequests, 1); assert.equal(data.queryFailures, 0);
  } finally { network.stop(); }
});

await check('submit, artifact and receipt aborts remain critical and reject every wait', async () => {
  for (const endpoint of ['', '/artifact', '/receipt']) {
    const browser = page(), data = sample(), network = observeQueryNetwork(browser, data);
    try {
      const req = endpoint === '/receipt' ? receipt() : request('/api/intelligence/query' + endpoint);
      browser.emit('request', req);
      const waiting = assert.rejects(network.waitForReceipt({ surface: 'answer_table' }), isNetworkFailure);
      const idle = assert.rejects(network.waitForIdle(), isNetworkFailure);
      browser.emit('requestfailed', req);
      await waiting; await idle;
      assert.equal(data.queryFailures, 1); assert.equal(data.networkFailures.length, 1);
      assert.equal(data.networkFailures[0].error, 'net::ERR_ABORTED');
      assert.equal(data.networkFailures[0].critical, true);
      assert.equal(data.networkFailures[0].attribution, 'started_in_sample');
      assert.equal(data.networkRequests[0].status, 'failed');
      browser.emit('requestfailed', req); assert.equal(data.queryFailures, 1, 'one failed request is counted once');
    } finally { network.stop(); }
  }
});

await check('HTTP 503 on every critical endpoint rejects before requestfinished', async () => {
  for (const endpoint of ['', '/artifact', '/receipt']) {
    const browser = page(), data = sample(), network = observeQueryNetwork(browser, data);
    try {
      const req = request('/api/intelligence/query' + endpoint); browser.emit('request', req);
      const waiting = assert.rejects(network.waitForIdle(), isNetworkFailure);
      response(browser, req, 503); await waiting;
      assert.equal(data.queryFailures, 1); assert.equal(data.networkFailures[0].error, 'HTTP_503');
      assert.equal(data.networkFailures[0].httpStatus, 503);
      browser.emit('requestfinished', req);
      assert.equal(data.networkRequests[0].status, 'failed');
      await assert.rejects(network.waitForReceipt({ surface: 'answer_table' }), isNetworkFailure);
    } finally { network.stop(); }
  }
});

await check('capabilities cancellation is retained separately without weakening critical waits', async () => {
  const browser = page(), data = sample(), network = observeQueryNetwork(browser, data);
  try {
    const caps = request('/api/intelligence/query/capabilities', { method: 'GET' });
    browser.emit('request', caps); browser.emit('requestfailed', caps);
    assert.equal(data.queryFailures, 0); assert.equal(data.networkFailures.length, 1);
    assert.equal(data.networkFailures[0].kind, 'capabilities'); assert.equal(data.networkFailures[0].critical, false);
    assert.equal(data.networkFailures[0].error, 'net::ERR_ABORTED');
    complete(browser, receipt([], 'chart'));
    assert.equal((await network.waitForReceipt({ surface: 'chart' })).surface, 'chart');
    await network.waitForIdle();
  } finally { network.stop(); }
});

await check('requests started before observation cannot contaminate the current query window', async () => {
  const browser = page(), data = sample();
  const previousSubmit = request('/api/intelligence/query'), previousReceipt = receipt();
  browser.emit('request', previousSubmit); browser.emit('request', previousReceipt);
  const network = observeQueryNetwork(browser, data);
  try {
    browser.emit('requestfailed', previousReceipt); response(browser, previousSubmit, 503);
    browser.emit('requestfinished', previousSubmit);
    assert.equal(data.actualQueryRequests, 0); assert.equal(data.queryFailures, 0);
    assert.equal(data.networkRequests.length, 0); assert.equal(data.networkFailures.length, 2);
    assert.ok(data.networkFailures.every(value => value.attribution === 'started_before_sample' && value.critical === false && value.index === null));
    const current = receipt(); complete(browser, current);
    assert.equal((await network.waitForReceipt({ surface: 'answer_table' })).index, 0);
    await network.waitForIdle();
  } finally { network.stop(); }
});

await check('cursor distinguishes a newly closed empty source view from the initial empty view', async () => {
  const browser = page(), data = sample(), network = observeQueryNetwork(browser, data);
  try {
    complete(browser, receipt());
    const initial = await network.waitForReceipt({ surface: 'answer_table', sourceCount: 'empty' });
    const after = network.cursor();
    let closed = false;
    const waiting = network.waitForReceipt({ after, surface: 'answer_table', sourceCount: 'empty' }).then(value => { closed = true; return value; });
    complete(browser, receipt([secret]));
    await Promise.resolve(); assert.equal(closed, false);
    const opened = await network.waitForReceipt({ after, surface: 'answer_table', sourceCount: 'present' });
    assert.ok(opened.index > initial.index); assert.equal(opened.sourceCount, 1);
    const nextEmpty = receipt(); browser.emit('request', nextEmpty); response(browser, nextEmpty);
    await Promise.resolve(); assert.equal(closed, false);
    browser.emit('requestfinished', nextEmpty);
    assert.ok((await waiting).index > opened.index);
  } finally { network.stop(); }
});

await check('home background failures retain finite endpoint categories without URL or record values', async () => {
  const browser = page(), data = sample(), apiOrigin = 'http://127.0.0.1:55991';
  const network = observeQueryNetwork(browser, data, { dataApiOrigin: apiOrigin });
  try {
    for (const [url, endpoint] of [
      [origin + '/api/audit-events?private=' + secret, 'audit_events'],
      [apiOrigin + '/rest/v1/message_notifications?recipient_user_id=eq.' + secret, 'rest_message_notifications'],
      [apiOrigin + '/rest/v1/admin_issues?created_by=eq.' + secret, 'rest_admin_issues'],
      [apiOrigin + '/rest/v1/admin_issue_reads?user_id=eq.' + secret, 'rest_admin_issue_reads'],
      [apiOrigin + '/rest/v1/' + secret, 'unclassified_data_api'],
      ['https://untrusted.invalid/rest/v1/admin_issues?value=' + secret, 'unclassified_external'],
    ]) {
      const req = { ...request('/unused'), url: () => url };
      complete(browser, req, 404);
      assert.equal(data.networkFailures.at(-1).endpoint, endpoint);
      assert.equal(data.networkRequests.at(-1).endpoint, endpoint);
    }
    assert.equal(data.queryFailures, 0);
    const serialized = JSON.stringify(data);
    for (const sensitive of [secret, origin, apiOrigin, 'untrusted.invalid']) assert.equal(serialized.includes(sensitive), false);
  } finally { network.stop(); }
});

await check('only allowlisted diagnostics survive; raw body, token, URL and error text are absent', async () => {
  const browser = page(), data = sample(), network = observeQueryNetwork(browser, data);
  try {
    complete(browser, receipt([secret]));
    const confirmed = await network.waitForReceipt({ surface: 'answer_table', sourceCount: 'present' });
    const req = request('/api/intelligence/query/receipt', {
      body: { deliveryToken: secret, phase: secret, view: { surface: secret, sourceIds: [secret] } },
      error: 'net::ERR_FAILED ' + origin + '/?token=' + secret,
    });
    browser.emit('request', req); browser.emit('requestfailed', req);
    await assert.rejects(network.waitForIdle(), isNetworkFailure);
    assert.equal(data.networkFailures[0].error, 'NETWORK_REQUEST_FAILED');
    assert.equal(data.networkRequests[1].phase, 'unknown'); assert.equal(data.networkRequests[1].surface, null);
    const serialized = JSON.stringify({ data, confirmed });
    assert.equal(serialized.includes(secret), false); assert.equal(serialized.includes(origin), false);
    const safeRequestKeys = new Set(['index', 'kind', 'endpoint', 'method', 'critical', 'status', 'httpStatus', 'phase', 'surface', 'sourceCount']);
    const safeFailureKeys = new Set(['index', 'kind', 'endpoint', 'method', 'attribution', 'critical', 'error', 'httpStatus']);
    for (const value of [...data.networkRequests, confirmed]) assert.ok(Object.keys(value).every(key => safeRequestKeys.has(key)));
    for (const value of data.networkFailures) assert.ok(Object.keys(value).every(key => safeFailureKeys.has(key)));
  } finally { network.stop(); }
  for (const event of ['request', 'response', 'requestfinished', 'requestfailed']) assert.equal(browser.listenerCount(event), 0);
});

assert.equal(checks, 8);
