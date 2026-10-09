import { afterEach, describe, expect, it, vi } from 'vitest';
import { QuarterlySubmissionAttempt, type QuarterlyBatch, type SubmissionReceipt } from './quarterlySubmissionAttempt';
import { draftCacheKey, type DraftIdentity, type DraftStorage } from './quarterlyDraftStore';

const identity: DraftIdentity = { userId: 'synthetic-user', year: 2026, quarter: 4, tab: 'GradeA' };
const batch = (quote = 100): QuarterlyBatch => ({ p_user_id: identity.userId, p_user_name: 'Synthetic Person', p_year: 2026, p_quarter: 4, p_tab: 'GradeA', p_regular_rows: [{ building_id: 'synthetic-building', asking_rent: quote }], p_future_rows: [{ future_supply_id: 'synthetic-future', asking_rent: quote }] });
const receipt: SubmissionReceipt = { regular_count: 1, future_count: 1, submitted_at: '2026-10-08T00:00:00.000Z' };
function memoryStorage() {
  const values = new Map<string, string>();
  const storage: DraftStorage = { get length() { return values.size; }, key: (index) => [...values.keys()][index] ?? null, getItem: vi.fn((key: string) => values.get(key) ?? null), setItem: vi.fn((key: string, value: string) => { values.set(key, value); }), removeItem: vi.fn((key: string) => { values.delete(key); }) };
  return { storage, values };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

afterEach(() => { vi.unstubAllGlobals(); });

describe('QuarterlySubmissionAttempt durable idempotency', () => {
  it('shares duplicate clicks as one in-flight request', async () => {
    const { storage } = memoryStorage(); const attempt = new QuarterlySubmissionAttempt(identity, storage);
    const pending = deferred<SubmissionReceipt>(); const send = vi.fn().mockReturnValue(pending.promise);
    const first = attempt.submit(batch(), send); const second = attempt.submit(batch(), send);
    expect(first).toBe(second); expect(send).toHaveBeenCalledTimes(1);
    pending.resolve(receipt); expect(await second).toEqual(receipt); expect(attempt.hasPending()).toBe(false);
  });

  it('retries the exact frozen payload and request ID after timeout and reload', async () => {
    const { storage } = memoryStorage(); const original = batch();
    const attempt = new QuarterlySubmissionAttempt(identity, storage);
    const send = vi.fn().mockRejectedValue(new Error('timeout'));
    await expect(attempt.submit(original, send)).rejects.toThrow('timeout');
    const [sentBatch, requestId] = send.mock.calls[0];
    original.p_regular_rows[0].asking_rent = 999;
    expect(sentBatch).toEqual(batch()); expect(attempt.hasPending()).toBe(true);
    const restarted = new QuarterlySubmissionAttempt(identity, storage);
    const retry = vi.fn().mockResolvedValue(receipt);
    expect(restarted.getPendingBatch()).toEqual(batch());
    expect(await restarted.submit(batch(500), retry)).toEqual(receipt);
    expect(retry).toHaveBeenCalledExactlyOnceWith(batch(), requestId);
  });

  it.each([{ ...identity, userId: 'synthetic-other' }, { ...identity, tab: 'BP' }, { ...identity, quarter: 3 }, { ...identity, year: 2025 }])('isolates pending attempts from %j', async (other) => {
    const { storage } = memoryStorage(); const send = vi.fn().mockRejectedValue(new Error('timeout'));
    await expect(new QuarterlySubmissionAttempt(identity, storage).submit(batch(), send)).rejects.toThrow();
    const isolated = new QuarterlySubmissionAttempt(other, storage);
    expect(isolated.hasPending()).toBe(false); expect(isolated.getPendingBatch()).toBeNull();
  });

  it.each([
    { ...receipt, regular_count: 0 }, { ...receipt, future_count: 2 },
    { ...receipt, submitted_at: 'invalid' }, { ...receipt, regular_count: '1' },
  ])('requires a matching valid acknowledgement %j', async (invalid) => {
    const { storage } = memoryStorage(); const attempt = new QuarterlySubmissionAttempt(identity, storage);
    const send = vi.fn().mockResolvedValueOnce(invalid).mockResolvedValueOnce(receipt);
    await expect(attempt.submit(batch(), send)).rejects.toThrow('回执');
    expect(attempt.hasPending()).toBe(true);
    await expect(attempt.submit(batch(), send)).resolves.toEqual(receipt);
    expect(send.mock.calls[1]).toEqual(send.mock.calls[0]);
  });

  it('blocks before sending when durable storage is unavailable', async () => {
    const send = vi.fn(); const attempt = new QuarterlySubmissionAttempt(identity, null);
    await expect(attempt.submit(batch(), send)).rejects.toThrow('恢复凭据');
    expect(send).not.toHaveBeenCalled(); expect(attempt.hasPending()).toBe(false);
  });

  it('blocks before sending when storage quota prevents saving the request ID', async () => {
    const { storage } = memoryStorage(); vi.mocked(storage.setItem).mockImplementation(() => { throw new Error('quota'); });
    const send = vi.fn(); const attempt = new QuarterlySubmissionAttempt(identity, storage);
    await expect(attempt.submit(batch(), send)).rejects.toThrow('恢复凭据'); expect(send).not.toHaveBeenCalled();
  });

  it('returns the stored receipt for identical repeats before and after reload', async () => {
    const { storage } = memoryStorage(); const send = vi.fn().mockResolvedValue(receipt);
    const attempt = new QuarterlySubmissionAttempt(identity, storage);
    await attempt.submit(batch(), send);
    expect(await attempt.submit(batch(), send)).toEqual(receipt);
    expect(await new QuarterlySubmissionAttempt(identity, storage).submit(batch(), send)).toEqual(receipt);
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('finishes the unresolved old batch before allowing new edits as a new request', async () => {
    const { storage } = memoryStorage(); const send = vi.fn().mockRejectedValueOnce(new Error('timeout')).mockResolvedValue(receipt);
    const attempt = new QuarterlySubmissionAttempt(identity, storage);
    await expect(attempt.submit(batch(), send)).rejects.toThrow('timeout');
    await attempt.submit(batch(200), send);
    expect(send.mock.calls[1]).toEqual(send.mock.calls[0]);
    await attempt.submit(batch(200), send);
    expect(send.mock.calls[2][0]).toEqual(batch(200));
    expect(send.mock.calls[2][1]).not.toBe(send.mock.calls[0][1]);
  });

  it('keeps the same request ID after receipt persistence fails and the page reloads', async () => {
    const { storage } = memoryStorage(); const set = storage.setItem;
    storage.setItem = (key, value) => { if (JSON.parse(value).receipt) throw new Error('quota'); set(key, value); };
    const send = vi.fn().mockResolvedValue(receipt);
    await new QuarterlySubmissionAttempt(identity, storage).submit(batch(), send);
    const restarted = new QuarterlySubmissionAttempt(identity, storage);
    expect(restarted.hasPending()).toBe(true);
    await restarted.submit(batch(), send);
    expect(send.mock.calls[1]).toEqual(send.mock.calls[0]);
  });

  it('rejects a cross-account cached record instead of sending it', () => {
    const { storage } = memoryStorage();
    storage.setItem(`${draftCacheKey(identity)}:submission`, JSON.stringify({ requestId: 'synthetic-request', batch: { ...batch(), p_user_id: 'other-account' } }));
    expect(() => new QuarterlySubmissionAttempt(identity, storage)).toThrow('恢复副本无效');
  });
  it('keeps a terminal SQL rejection record and sends corrected edits with a new request ID', async () => {
    const { storage, values } = memoryStorage();
    const failure = { code: '22023', message: 'invalid_submission_numeric_range:asking_rent' };
    const send = vi.fn().mockRejectedValueOnce(failure).mockResolvedValueOnce(receipt);
    const first = new QuarterlySubmissionAttempt(identity, storage);
    await expect(first.submit(batch(-100), send)).rejects.toEqual(failure);
    expect(first.hasPending()).toBe(false);
    const rejectedId = send.mock.calls[0][1];
    const restarted = new QuarterlySubmissionAttempt(identity, storage);
    expect(restarted.hasPending()).toBe(false);
    await restarted.submit(batch(100), send);
    const acceptedId = send.mock.calls[1][1];
    expect(acceptedId).not.toBe(rejectedId);
    const prefix = `${draftCacheKey(identity)}:submission:request:`;
    expect(JSON.parse(values.get(`${prefix}${rejectedId}`)!)).toMatchObject({ requestId: rejectedId, batch: batch(-100), rejected: failure });
    expect(JSON.parse(values.get(`${prefix}${acceptedId}`)!)).toMatchObject({ requestId: acceptedId, batch: batch(100), receipt });
  });

  it('refreshes a shared pending pointer across concurrently active instances without changing its payload or ID', async () => {
    const { storage, values } = memoryStorage();
    const first = new QuarterlySubmissionAttempt(identity, storage);
    const second = new QuarterlySubmissionAttempt(identity, storage);
    const pending = deferred<SubmissionReceipt>();
    const sendA = vi.fn().mockReturnValue(pending.promise);
    const sendB = vi.fn().mockResolvedValue(receipt);
    const original = first.submit(batch(100), sendA);
    await second.submit(batch(200), sendB);
    expect(sendB.mock.calls[0]).toEqual(sendA.mock.calls[0]);
    pending.resolve(receipt); await original;
    expect([...values.keys()].filter((key) => key.includes(':request:'))).toHaveLength(1);
    const restarted = new QuarterlySubmissionAttempt(identity, storage);
    const sendAfterReload = vi.fn();
    expect(await restarted.submit(batch(100), sendAfterReload)).toEqual(receipt);
    expect(sendAfterReload).not.toHaveBeenCalled();
  });

  it('discovers and reconciles every immutable pending request even after the shared pointer was overwritten', async () => {
    const { storage, values } = memoryStorage();
    const key = `${draftCacheKey(identity)}:submission`;
    const first = { requestId: 'synthetic-first-request', batch: batch(100) };
    const second = { requestId: 'synthetic-second-request', batch: batch(200) };
    storage.setItem(`${key}:request:${first.requestId}`, JSON.stringify(first));
    storage.setItem(`${key}:request:${second.requestId}`, JSON.stringify(second));
    storage.setItem(key, JSON.stringify(second));
    const send = vi.fn().mockResolvedValue(receipt);
    const firstReload = new QuarterlySubmissionAttempt(identity, storage);
    await firstReload.submit(batch(999), send);
    expect(send).toHaveBeenNthCalledWith(1, batch(100), first.requestId);
    const secondReload = new QuarterlySubmissionAttempt(identity, storage);
    expect(secondReload.hasPending()).toBe(true);
    await secondReload.submit(batch(999), send);
    expect(send).toHaveBeenNthCalledWith(2, batch(200), second.requestId);
    expect(JSON.parse(values.get(`${key}:request:${first.requestId}`)!)).toMatchObject({ ...first, receipt });
    expect(JSON.parse(values.get(`${key}:request:${second.requestId}`)!)).toMatchObject({ ...second, receipt });
  });

  it.each(['regular_submission_assignment_or_category_mismatch', 'future_submission_assignment_or_category_mismatch'])('allows a corrected request after the explicitly terminal 42501 %s', async (message) => {
    const { storage, values } = memoryStorage();
    const failure = { code: '42501', message };
    const send = vi.fn().mockRejectedValueOnce(failure).mockResolvedValueOnce(receipt);
    const attempt = new QuarterlySubmissionAttempt(identity, storage);
    await expect(attempt.submit(batch(100), send)).rejects.toEqual(failure);
    expect(attempt.hasPending()).toBe(false);
    const firstId = send.mock.calls[0][1];
    await new QuarterlySubmissionAttempt(identity, storage).submit(batch(200), send);
    expect(send.mock.calls[1][1]).not.toBe(firstId);
    expect(JSON.parse(values.get(`${draftCacheKey(identity)}:submission:request:${firstId}`)!)).toMatchObject({ rejected: failure, batch: batch(100) });
  });

  it('retains a generic authorization 42501 as unresolved and reuses its original request after reload', async () => {
    const { storage } = memoryStorage();
    const failure = { code: '42501', message: 'permission denied for table quarterly_submissions' };
    const send = vi.fn().mockRejectedValueOnce(failure).mockResolvedValueOnce(receipt);
    const attempt = new QuarterlySubmissionAttempt(identity, storage);
    await expect(attempt.submit(batch(100), send)).rejects.toEqual(failure);
    expect(attempt.hasPending()).toBe(true);
    await new QuarterlySubmissionAttempt(identity, storage).submit(batch(200), send);
    expect(send.mock.calls[1]).toEqual(send.mock.calls[0]);
  });

  it('uses browser-wide Web Locks to serialize duplicate requests from two controllers', async () => {
    const { storage } = memoryStorage();
    let tail = Promise.resolve();
    const request = vi.fn((_name: string, callback: () => Promise<unknown>) => {
      const result = tail.then(callback);
      tail = result.then(() => undefined, () => undefined);
      return result;
    });
    vi.stubGlobal('navigator', { locks: { request } });
    const pending = deferred<SubmissionReceipt>();
    const send = vi.fn().mockReturnValue(pending.promise);
    const first = new QuarterlySubmissionAttempt(identity, storage);
    const second = new QuarterlySubmissionAttempt(identity, storage);
    const resultA = first.submit(batch(), send);
    const resultB = second.submit(batch(), send);
    await Promise.resolve();
    expect(send).toHaveBeenCalledTimes(1);
    pending.resolve(receipt);
    expect(await resultA).toEqual(receipt);
    expect(await resultB).toEqual(receipt);
    expect(send).toHaveBeenCalledTimes(1);
    expect(request).toHaveBeenCalledTimes(2);
    expect(request.mock.calls[0][0]).toBe(request.mock.calls[1][0]);
  });

});
