// Explicitly loaded only by the disposable Auth harness's Next child process.
// Production endpoint/model validation remains unchanged. Only the transport
// for the official supplier URL is replaced; identity and data APIs stay real.
const assert = require('node:assert/strict');
assert.equal(process.env.AI_QUERY_AUTH_ALLOW_LOCAL, 'disposable');
const target = new URL(process.env.AI_QUERY_TEST_PROVIDER_TARGET);
assert.equal(target.protocol, 'http:'); assert.equal(target.hostname, '127.0.0.1');
assert.equal(target.pathname, '/'); assert.equal(target.username + target.password + target.search + target.hash, '');
const original = globalThis.fetch.bind(globalThis);
globalThis.fetch = (input, init) => {
  const url = new URL(input instanceof Request ? input.url : String(input));
  if (url.hostname === 'api.deepseek.com') {
    assert.ok(['/chat/completions', '/responses'].includes(url.pathname));
    const redirected = new URL(url.pathname, target);
    return original(input instanceof Request ? new Request(redirected, input) : redirected, init);
  }
  if (url.hostname === 'api.openai.com') throw new Error('REAL_PROVIDER_FORBIDDEN_IN_AUTH_TEST');
  return original(input, init);
};
