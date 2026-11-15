/** Keep interception registered until its async callbacks have finished.
 * Playwright 1.58 can auto-continue another in-flight route after unrouteAll
 * empties the registered list, even while behavior:'wait' is draining handlers.
 * A later fulfill from that callback then targets an already-handled route.
 */
export function trackRouteCallbacks(handler) {
  const pending = new Set();
  let failure, failed = false;
  return {
    handle(route) {
      const task = Promise.resolve().then(() => handler(route));
      pending.add(task);
      task.then(() => pending.delete(task), error => { if (!failed) { failed = true; failure = error; } pending.delete(task); });
      return task;
    },
    async drain({ timeoutMs = 10_000, unregister } = {}) {
      let timer;
      const settled = async () => {
        // New callbacks can start while earlier responses finish loading their
        // dependent chunks. Keep the handler installed until the whole set drains.
        while (pending.size) await Promise.allSettled([...pending]);
        if (failed) throw failure;
        // Start unregistering synchronously at the empty-set boundary, before
        // yielding back to a caller that could admit another route callback.
        if (unregister) await unregister();
      };
      try {
        await Promise.race([settled(), new Promise((_, reject) => {
          timer = setTimeout(() => reject(failed ? failure : new Error(`ROUTE_CALLBACK_DRAIN_TIMEOUT: ${pending.size} callbacks still pending`)), timeoutMs);
        })]);
      } finally { clearTimeout(timer); }
    },
  };
}
