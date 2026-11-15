import assert from 'node:assert/strict';
import test from 'node:test';
import { trackRouteCallbacks } from './route-callback-drain.mjs';

const gate = () => { let release; const wait = new Promise(resolve => { release = resolve; }); return { wait, release }; };

/** Minimal model of Playwright 1.58's client _onRoute/server removeHandler:
 * removing registration lets the first completed callback auto-continue the
 * remaining routes, including ones still awaiting their fetched JS response.
 */
async function teardown(drained) {
  const first = gate(), second = gate(), firstFinished = gate();
  const handled = new Set(), fulfilled = [], pending = [];
  let removed = false;
  const tracker = trackRouteCallbacks(async route => {
    await route.response;
    assert.ok(!handled.has(route.id), 'Route is already handled!');
    handled.add(route.id); fulfilled.push(route.id);
  });
  for (const [id, response] of [['first', first.wait], ['second', second.wait]]) {
    const task = tracker.handle({ id, response }).then(() => {
      if (removed) handled.add('second'); // removed handler auto-continues in-flight routes
      if (id === 'first') firstFinished.release();
    });
    pending.push(task);
  }
  const drain = drained ? tracker.drain({ unregister: () => { removed = true; } }) : Promise.resolve();
  if (!drained) removed = true;
  first.release(); await firstFinished.wait; second.release();
  await drain;
  removed = true;
  await Promise.all(pending);
  return fulfilled;
}

test('old unregister-before-drain reproduces a double-handled route; draining first fulfills each response once', async () => {
  await assert.rejects(teardown(false), /Route is already handled/);
  assert.deepEqual(await teardown(true), ['first', 'second']);
});

test('a dependent chunk started while draining is also awaited before unregistering', async () => {
  const first = gate(), child = gate(); let childStarted = false, childFinished = false;
  let tracker;
  tracker = trackRouteCallbacks(async route => {
    await route.response;
    if (route.id === 'first') { childStarted = true; void tracker.handle({ id: 'child', response: child.wait }); }
    else childFinished = true;
  });
  void tracker.handle({ id: 'first', response: first.wait });
  const drain = tracker.drain(); first.release();
  await first.wait; await Promise.resolve(); await Promise.resolve();
  assert.equal(childStarted, true); assert.equal(childFinished, false);
  child.release(); await drain; assert.equal(childFinished, true);
});

test('route callback failures remain failures and a blocked callback has a bounded teardown', async () => {
  const failure = new Error('fixture response unavailable');
  const errors = trackRouteCallbacks(async () => { throw failure; });
  await assert.rejects(errors.handle({}), error => error === failure);
  await assert.rejects(errors.drain(), error => error === failure);
  const blocked = gate(), tracker = trackRouteCallbacks(async () => blocked.wait);
  const pending = tracker.handle({});
  await assert.rejects(tracker.drain({ timeoutMs: 10 }), /ROUTE_CALLBACK_DRAIN_TIMEOUT/);
  blocked.release(); await pending; await tracker.drain();
});

test('deadline preserves the original callback failure even when another callback is still blocked', async () => {
  const failure = new Error('original callback failure'), blocked = gate();
  const tracker = trackRouteCallbacks(async route => { if (route.fail) throw failure; await blocked.wait; });
  const pending = tracker.handle({});
  await assert.rejects(tracker.handle({ fail: true }), error => error === failure);
  await assert.rejects(tracker.drain({ timeoutMs: 10 }), error => error === failure);
  blocked.release(); await pending;
});

test('unregister failures are not mistaken for successful cleanup', async () => {
  const failure = new Error('unregister failed'), tracker = trackRouteCallbacks(async () => {});
  await tracker.handle({});
  await assert.rejects(tracker.drain({ unregister: async () => { throw failure; } }), error => error === failure);
});
