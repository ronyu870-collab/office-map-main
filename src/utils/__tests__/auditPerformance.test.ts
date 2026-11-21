import { IDBFactory, IDBObjectStore, IDBDatabase } from 'fake-indexeddb';
import { expect, test, vi } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
const fixture = vi.hoisted(() => ({ getSession: vi.fn() }));
vi.mock('@/src/services/supabaseClient', () => ({ supabase: { auth: { getSession: fixture.getSession } } }));
vi.mock('@/src/services/deviceIdentity', () => ({ getOrCreateDeviceId: () => 'benchmark-device' }));
test('measures the ordinary interaction audit path with a reproducible synthetic burst', async () => {
  vi.stubGlobal('indexedDB', new IDBFactory());
  fixture.getSession.mockResolvedValue({ data: { session: null } });
  const count = vi.spyOn(IDBObjectStore.prototype, 'count');
  const put = vi.spyOn(IDBObjectStore.prototype, 'put');
  const transaction = vi.spyOn(IDBDatabase.prototype, 'transaction');
  const audit = await import('../audit');
  audit.setAuditSessionContext({ userId: 'benchmark-user', authSessionId: 'benchmark-session' });
  const durations: number[] = [];
  for (let i = 0; i < 120; i++) {
    const start = performance.now();
    audit.logAuditEvent({ action_type: 'VIEW_BUILDING', details: { building_id: `synthetic-${i}` } });
    durations.push(performance.now() - start);
  }
  await vi.waitFor(() => expect(put).toHaveBeenCalledTimes(120));
  await new Promise(resolve => setTimeout(resolve, 50));
  durations.sort((a, b) => a - b);
  const result = { environment: 'Node jsdom + fake-indexeddb (CPU/storage operations only; not browser or production business latency)',
    samples: 120, syncP95Ms: durations[113], syncMaxMs: durations[119], capacityReads: count.mock.calls.length,
    puts: put.mock.calls.length, transactions: transaction.mock.calls.length, sessionReads: fixture.getSession.mock.calls.length };
  console.log(JSON.stringify(result));
  if (process.env.AUDIT_BENCH_STAGE) {
    mkdirSync('verification/audit-2', { recursive: true });
    writeFileSync(`verification/audit-2/${process.env.AUDIT_BENCH_STAGE}.json`, JSON.stringify(result, null, 2));
  }
  expect(result.syncP95Ms).toBeLessThan(1);
  audit.clearAuditSessionContext();
  vi.restoreAllMocks(); vi.unstubAllGlobals();
});
