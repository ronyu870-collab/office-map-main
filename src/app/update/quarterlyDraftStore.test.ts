import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  QuarterlyDraftStore, draftCacheKey, hasConfirmedDraftPeriod, unpackDraft, packDraft, type DraftIdentity, type DraftPayload,
  type DraftStorage, type DraftTransport, type RemoteDraft,
} from './quarterlyDraftStore';

const identity: DraftIdentity = { userId: 'synthetic-user-a', year: 2026, quarter: 4, tab: 'office' };
const stamp = '2026-10-08T00:00:00.000Z';
const payload = (value: string): DraftPayload => ({ regular: { 'synthetic-building': { qQuote: value } }, future: {} });
const remote = (value: string, revision = 1): RemoteDraft => ({ payload: payload(value), revision, updatedAt: stamp, year: 2026, quarter: 4, periodConfirmed: true });
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}
function memoryStorage() {
  const values = new Map<string, string>();
  const storage: DraftStorage = {
    getItem: vi.fn((key: string) => values.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => { values.set(key, value); }),
    removeItem: vi.fn((key: string) => { values.delete(key); }),
  };
  return { values, storage };
}
function transport() {
  return { read: vi.fn<DraftTransport['read']>().mockResolvedValue(null), save: vi.fn<DraftTransport['save']>().mockResolvedValue({ revision: 1, updatedAt: stamp }) };
}
function edit(store: QuarterlyDraftStore, value: string) { store.edit('regular', 'synthetic-building', 'qQuote', value); }
function cache(storage: DraftStorage, dirty: boolean, cachedAt: number, overrides: Record<string, unknown> = {}) {
  storage.setItem(draftCacheKey(identity), JSON.stringify({ version: 1, identity, payload: payload('cached'), revision: 1, dirty, updatedAt: stamp, cachedAt, ...overrides }));
}
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

describe('QuarterlyDraftStore recovery and concurrency', () => {
  it('persists an edit synchronously, survives offline save, reload, and a new controller restart', async () => {
    const { storage } = memoryStorage();
    const api = transport();
    const store = new QuarterlyDraftStore(identity, api, storage);
    await store.load();
    edit(store, 'offline edit');
    api.save.mockRejectedValue(new Error('offline'));
    api.read.mockRejectedValue(new Error('offline'));
    expect(await store.flush()).toBe(false);
    expect(store.getSnapshot()).toMatchObject({ dirty: true, saving: false, payload: payload('offline edit'), retryCount: 1 });
    expect(store.getSnapshot().error).toBeTruthy();
    const restarted = new QuarterlyDraftStore(identity, api, storage);
    expect(restarted.getSnapshot()).toMatchObject({ dirty: true, payload: payload('offline edit') });
    await restarted.load();
    expect(restarted.getSnapshot()).toMatchObject({ loaded: false, dirty: true, payload: payload('offline edit') });
    api.read.mockResolvedValue(null);
    api.save.mockResolvedValue({ revision: 1, updatedAt: stamp });
    expect(await restarted.flush()).toBe(true);
    expect(api.save).toHaveBeenLastCalledWith(payload('offline edit'), 0);
    expect(new QuarterlyDraftStore(identity, api, storage).getSnapshot()).toMatchObject({ dirty: false, payload: payload('offline edit'), revision: 1 });
  });

  it('drains edits made during a save with the next acknowledged revision', async () => {
    const api = transport();
    api.read.mockResolvedValue(remote('base', 7));
    const first = deferred<{ revision: number; updatedAt: string }>();
    api.save.mockReturnValueOnce(first.promise).mockResolvedValueOnce({ revision: 9, updatedAt: stamp });
    const store = new QuarterlyDraftStore(identity, api, memoryStorage().storage);
    await store.load();
    edit(store, 'first');
    const pending = store.flush();
    expect(api.save).toHaveBeenNthCalledWith(1, payload('first'), 7);
    edit(store, 'latest');
    first.resolve({ revision: 8, updatedAt: stamp });
    expect(await pending).toBe(true);
    expect(api.save).toHaveBeenNthCalledWith(2, payload('latest'), 8);
    expect(store.getSnapshot()).toMatchObject({ dirty: false, saving: false, revision: 9, payload: payload('latest') });
  });

  it('shares duplicate flushes while retaining the latest edit', async () => {
    const api = transport();
    const first = deferred<{ revision: number; updatedAt: string }>();
    api.save.mockReturnValueOnce(first.promise).mockResolvedValueOnce({ revision: 2, updatedAt: stamp });
    const store = new QuarterlyDraftStore(identity, api, memoryStorage().storage);
    await store.load();
    edit(store, 'first');
    const a = store.flush();
    edit(store, 'second');
    const b = store.flush();
    expect(a).toBe(b);
    first.resolve({ revision: 1, updatedAt: stamp });
    expect(await b).toBe(true);
    expect(api.save).toHaveBeenCalledTimes(2);
    expect(api.save).toHaveBeenLastCalledWith(payload('second'), 1);
  });

  it.each([
    { ...identity, userId: 'synthetic-user-b' },
    { ...identity, quarter: 3 },
    { ...identity, year: 2025 },
    { ...identity, tab: 'industrial' },
  ])('isolates cached edits from identity %j', (other) => {
    const { storage } = memoryStorage();
    const original = new QuarterlyDraftStore(identity, transport(), storage);
    edit(original, 'private');
    const separate = new QuarterlyDraftStore(other, transport(), storage);
    expect(separate.key).not.toBe(original.key);
    expect(separate.getSnapshot().payload).toEqual({ regular: {}, future: {} });
    edit(separate, 'other');
    expect(new QuarterlyDraftStore(identity, transport(), storage).getSnapshot().payload).toEqual(payload('private'));
  });

  it('does not overwrite an edit with a late initial read', async () => {
    const api = transport();
    const read = deferred<RemoteDraft | null>();
    api.read.mockReturnValue(read.promise);
    const store = new QuarterlyDraftStore(identity, api, memoryStorage().storage);
    const loading = store.load();
    edit(store, 'newer local');
    read.resolve(remote('older remote', 2));
    await loading;
    expect(store.getSnapshot()).toMatchObject({ payload: payload('newer local'), dirty: true, conflict: remote('older remote', 2) });
    expect(await store.flush()).toBe(false);
    expect(api.save).not.toHaveBeenCalled();
  });

  it.each(['local', 'remote'] as const)('preserves both versions before resolving to %s', async (choice) => {
    const { storage, values } = memoryStorage();
    const api = transport();
    const store = new QuarterlyDraftStore(identity, api, storage);
    edit(store, 'local');
    api.read.mockResolvedValue(remote('server', 3));
    await store.load();
    expect(await store.resolveConflict(choice)).toBe(true);
    const backups = [...values.entries()].filter(([key]) => key.includes(':recovery:')).map(([, value]) => JSON.parse(value));
    expect(backups).toHaveLength(2);
    expect(backups.map((backup) => backup.value)).toContainEqual(payload('local'));
    expect(backups.map((backup) => backup.value)).toContainEqual(remote('server', 3));
    expect(store.getSnapshot()).toMatchObject({ payload: payload(choice === 'local' ? 'local' : 'server'), dirty: choice === 'local', revision: 3, conflict: null });
  });

  it('requires another review when the server changes during conflict resolution', async () => {
    const api = transport();
    const store = new QuarterlyDraftStore(identity, api, memoryStorage().storage);
    edit(store, 'local');
    api.read.mockResolvedValueOnce(remote('server', 3)).mockResolvedValueOnce(remote('new server', 4));
    await store.load();
    expect(await store.resolveConflict('remote')).toBe(false);
    expect(store.getSnapshot()).toMatchObject({ payload: payload('local'), dirty: true, conflict: remote('new server', 4) });
  });

  it('preserves the newest local edit when a failed save discovers another writer', async () => {
    const api = transport(); const { storage } = memoryStorage();
    const save = deferred<{ revision: number; updatedAt: string }>();
    api.read.mockResolvedValueOnce(remote('base', 1)).mockResolvedValueOnce(remote('another writer', 2));
    api.save.mockReturnValue(save.promise);
    const store = new QuarterlyDraftStore(identity, api, storage);
    await store.load(); edit(store, 'first');
    const flushing = store.flush(); edit(store, 'newest local');
    save.reject(new Error('revision conflict'));
    expect(await flushing).toBe(false);
    expect(store.getSnapshot()).toMatchObject({ payload: payload('newest local'), dirty: true, conflict: remote('another writer', 2), revision: 1 });
    expect(new QuarterlyDraftStore(identity, api, storage).getSnapshot()).toMatchObject({ payload: payload('newest local'), dirty: true });
    expect(await store.flush()).toBe(false);
    expect(api.save).toHaveBeenCalledTimes(1);
  });

  it('recovers an acknowledged commit whose response was lost without resending it', async () => {
    const api = transport();
    api.read.mockResolvedValueOnce(null).mockResolvedValueOnce(remote('saved', 1));
    api.save.mockRejectedValue(new Error('response lost'));
    const store = new QuarterlyDraftStore(identity, api, memoryStorage().storage);
    await store.load(); edit(store, 'saved');
    expect(await store.flush()).toBe(true);
    expect(api.save).toHaveBeenCalledTimes(1);
    expect(store.getSnapshot()).toMatchObject({ revision: 1, dirty: false, saving: false, error: null });
  });

  it('drains a newer edit after readback recovers a lost acknowledgement', async () => {
    const api = transport();
    const save = deferred<{ revision: number; updatedAt: string }>();
    api.read.mockResolvedValueOnce(null).mockResolvedValueOnce(remote('first', 1));
    api.save.mockReturnValueOnce(save.promise).mockResolvedValueOnce({ revision: 2, updatedAt: stamp });
    const store = new QuarterlyDraftStore(identity, api, memoryStorage().storage);
    await store.load(); edit(store, 'first');
    const flushing = store.flush(); edit(store, 'latest');
    save.reject(new Error('response lost'));
    expect(await flushing).toBe(true);
    expect(api.save).toHaveBeenLastCalledWith(payload('latest'), 1);
    expect(store.getSnapshot()).toMatchObject({ revision: 2, dirty: false, payload: payload('latest') });
  });

  it.each([
    { revision: 0, updatedAt: stamp },
    { revision: 3, updatedAt: stamp },
    { revision: 1.5, updatedAt: stamp },
    { revision: 1, updatedAt: 'invalid' },
  ])('keeps work dirty for invalid save acknowledgement %j', async (ack) => {
    const api = transport(); api.save.mockResolvedValue(ack);
    const store = new QuarterlyDraftStore(identity, api, memoryStorage().storage);
    await store.load(); edit(store, 'unsaved');
    expect(await store.flush()).toBe(false);
    expect(store.getSnapshot()).toMatchObject({ dirty: true, revision: 0, payload: payload('unsaved'), saving: false });
  });

  it('quarantines a relabeled prior-quarter draft instead of treating it as current work', async () => {
    const api = transport();
    const old = { ...remote('last quarter', 6), periodConfirmed: false, updatedAt: '2026-09-01T00:00:00.000Z' };
    api.read.mockResolvedValue(old);
    const store = new QuarterlyDraftStore(identity, api, memoryStorage().storage);
    await store.load();
    expect(store.getSnapshot()).toMatchObject({ historical: old, revision: 6, dirty: false, loaded: true });
    expect(store.getSnapshot().payload).toEqual({ regular: {}, future: {} });
    edit(store, 'fresh'); api.save.mockResolvedValue({ revision: 7, updatedAt: stamp });
    expect(await store.flush()).toBe(true);
    expect(api.save).toHaveBeenCalledWith(payload('fresh'), 6);
  });

  it('removes a clean cached relabeled payload when the server proves it belongs to the prior quarter', async () => {
    const { storage } = memoryStorage();
    const oldStamp = '2026-09-01T00:00:00.000Z';
    cache(storage, false, Date.now(), { updatedAt: oldStamp });
    const api = transport();
    const old = { ...remote('cached', 1), periodConfirmed: false, updatedAt: oldStamp };
    api.read.mockResolvedValue(old);
    const store = new QuarterlyDraftStore(identity, api, storage);
    await store.load();
    expect(store.getSnapshot()).toMatchObject({ historical: old, dirty: false });
    expect(store.getSnapshot().payload).toEqual({ regular: {}, future: {} });
    expect(new QuarterlyDraftStore(identity, api, storage).getSnapshot().payload).toEqual({ regular: {}, future: {} });
  });

  it('never acknowledges a failed save from a malformed readback revision', async () => {
    const api = transport();
    api.read.mockResolvedValueOnce(null).mockResolvedValueOnce(remote('unsaved', -1));
    api.save.mockRejectedValue(new Error('failed save'));
    const store = new QuarterlyDraftStore(identity, api, memoryStorage().storage);
    await store.load(); edit(store, 'unsaved');
    expect(await store.flush()).toBe(false);
    expect(store.getSnapshot()).toMatchObject({ dirty: true, revision: 0, payload: payload('unsaved') });
  });

  it('never expires unsynced work, even after a year', () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date(stamp));
    const { storage } = memoryStorage();
    cache(storage, true, Date.now() - 366 * 86400_000);
    expect(new QuarterlyDraftStore(identity, transport(), storage).getSnapshot()).toMatchObject({ dirty: true, payload: payload('cached') });
    expect(storage.removeItem).not.toHaveBeenCalled();
  });

  it('expires acknowledged copies after 30 days', () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date(stamp));
    const { storage } = memoryStorage(); cache(storage, false, Date.now() - 31 * 86400_000);
    expect(new QuarterlyDraftStore(identity, transport(), storage).getSnapshot().payload).toEqual({ regular: {}, future: {} });
    expect(storage.removeItem).toHaveBeenCalledWith(draftCacheKey(identity));
  });

  it('reports quota failure without discarding the in-memory edit or preventing cloud save', async () => {
    const { storage } = memoryStorage();
    vi.mocked(storage.setItem).mockImplementation(() => { throw new Error('QuotaExceededError'); });
    const store = new QuarterlyDraftStore(identity, transport(), storage);
    await store.load(); edit(store, 'keep me');
    expect(store.getSnapshot()).toMatchObject({ dirty: true, payload: payload('keep me') });
    expect(store.getSnapshot().localError).toBeTruthy();
    expect(await store.flush()).toBe(true);
    expect(store.getSnapshot()).toMatchObject({ dirty: false, payload: payload('keep me') });
    expect(store.getSnapshot().localError).toBeTruthy();
  });

  it('refuses conflict replacement when recovery backups cannot be written', async () => {
    const { storage } = memoryStorage(); const api = transport();
    const store = new QuarterlyDraftStore(identity, api, storage); edit(store, 'local');
    api.read.mockResolvedValue(remote('server', 3)); await store.load();
    vi.mocked(storage.setItem).mockImplementation(() => { throw new Error('QuotaExceededError'); });
    expect(await store.resolveConflict('remote')).toBe(false);
    expect(store.getSnapshot()).toMatchObject({ dirty: true, payload: payload('local'), conflict: remote('server', 3) });
    expect(store.getSnapshot().localError).toBeTruthy();
  });

  it('archives the other window shared cache before replacing it with a different local edit', () => {
    const { storage, values } = memoryStorage();
    const windowA = new QuarterlyDraftStore(identity, transport(), storage);
    const windowB = new QuarterlyDraftStore(identity, transport(), storage);
    edit(windowA, 'window A work');
    edit(windowB, 'window B work');
    expect(new QuarterlyDraftStore(identity, transport(), storage).getSnapshot().payload).toEqual(payload('window B work'));
    const archives = [...values.entries()].filter(([key]) => key.includes(':other-window:')).map(([, value]) => JSON.parse(value));
    expect(archives).toHaveLength(1);
    expect(archives[0].value).toMatchObject({ dirty: true, payload: payload('window A work') });
    expect(windowA.getSnapshot().payload).toEqual(payload('window A work'));
  });

  it('does not overwrite another window cache when quota prevents its recovery archive', () => {
    const { storage } = memoryStorage();
    const windowA = new QuarterlyDraftStore(identity, transport(), storage);
    const windowB = new QuarterlyDraftStore(identity, transport(), storage);
    edit(windowA, 'window A work');
    const existing = storage.getItem(draftCacheKey(identity));
    const setItem = storage.setItem;
    storage.setItem = vi.fn((key, value) => {
      if (key.includes(':recovery:')) throw new Error('QuotaExceededError');
      setItem(key, value);
    });
    edit(windowB, 'window B work');
    expect(storage.getItem(draftCacheKey(identity))).toBe(existing);
    expect(windowB.getSnapshot()).toMatchObject({ dirty: true, payload: payload('window B work') });
    expect(windowB.getSnapshot().localError).toBeTruthy();
    expect(storage.setItem).not.toHaveBeenCalledWith(draftCacheKey(identity), expect.any(String));
  });

  it('does not clear unsynced work on cleanup', () => {
    const { storage } = memoryStorage(); const store = new QuarterlyDraftStore(identity, transport(), storage);
    edit(store, 'unsynced'); expect(store.clearAcknowledgedLocalCopy()).toBe(false);
    expect(storage.removeItem).not.toHaveBeenCalled();
  });
  it('requires explicit resolution when a previously acknowledged server row has been deleted', async () => {
    const { storage, values } = memoryStorage(); cache(storage, true, Date.now());
    const api = transport(); api.read.mockResolvedValue(null);
    const store = new QuarterlyDraftStore(identity, api, storage);
    await store.load();
    expect(store.getSnapshot()).toMatchObject({ remoteMissing: true, dirty: true, revision: 1, payload: payload('cached') });
    expect(await store.flush()).toBe(false); expect(api.save).not.toHaveBeenCalled();
    expect(store.clearAcknowledgedLocalCopy()).toBe(false);
    expect(await store.resolveConflict('local')).toBe(true);
    expect(store.getSnapshot()).toMatchObject({ remoteMissing: false, dirty: true, revision: 0, payload: payload('cached') });
    expect(await store.flush()).toBe(true);
    expect(api.save).toHaveBeenCalledExactlyOnceWith(payload('cached'), 0);
    const backups = [...values.entries()].filter(([key]) => key.includes(':recovery:')).map(([, value]) => JSON.parse(value).value);
    expect(backups).toContainEqual(payload('cached')); expect(backups).toContain(null);
  });

  it('keeps explicitly confirmed future-quarter input saved before calendar quarter start on reload', async () => {
    const nextIdentity = { ...identity, year: 2027, quarter: 1 };
    const earlyStamp = '2026-12-15T00:00:00.000Z';
    const { storage } = memoryStorage(); const api = transport();
    api.save.mockResolvedValue({ revision: 1, updatedAt: earlyStamp });
    const store = new QuarterlyDraftStore(nextIdentity, api, storage);
    await store.load(); edit(store, 'early new-quarter work');
    expect(await store.flush()).toBe(true);
    const confirmed = { payload: payload('early new-quarter work'), revision: 1, updatedAt: earlyStamp, year: 2027, quarter: 1, periodConfirmed: true };
    api.read.mockResolvedValue(confirmed);
    const restarted = new QuarterlyDraftStore(nextIdentity, api, storage);
    await restarted.load();
    expect(restarted.getSnapshot()).toMatchObject({ revision: 1, dirty: false, historical: null });
    expect(restarted.getSnapshot().payload).toEqual(payload('early new-quarter work'));
  });

  it('accepts only a marker matching the exact server revision and row period', () => {
    const raw = { ...packDraft(payload('marked')), __quarterly_meta__: { version: 2, year: 2026, quarter: 4, revision: 7 } };
    expect(hasConfirmedDraftPeriod(raw, 7, 2026, 4)).toBe(true);
    expect(hasConfirmedDraftPeriod(raw, 8, 2026, 4)).toBe(false); // An old client changed the row.
    expect(hasConfirmedDraftPeriod(raw, 7, 2027, 1)).toBe(false); // A rollover relabeled the row.
    expect(hasConfirmedDraftPeriod(raw, 7, 2026, 3)).toBe(false);
    expect(hasConfirmedDraftPeriod({ ...raw, __quarterly_meta__: { version: 1, year: 2026, quarter: 4, revision: 7 } }, 7, 2026, 4)).toBe(false);
    expect(hasConfirmedDraftPeriod(packDraft(payload('unmarked')), 7, 2026, 4)).toBe(false);
  });

  it('strips reserved confirmation metadata without dropping regular or future draft values', () => {
    const original = { regular: { 'synthetic-building': { qQuote: '0' } }, future: { 'synthetic-future': { qQuote: '200' } } };
    const raw = { ...packDraft(original), __quarterly_meta__: { version: 2, year: 2026, quarter: 4, revision: 7 } };
    expect(unpackDraft(raw)).toEqual(original);
    expect(packDraft(unpackDraft(raw))).not.toHaveProperty('__quarterly_meta__');
  });

  it('keeps a recently updated unconfirmed legacy draft as a visible reference instead of trusting its timestamp', async () => {
    const api = transport();
    const legacy = { ...remote('recent but unconfirmed', 3), periodConfirmed: false };
    api.read.mockResolvedValue(legacy);
    const store = new QuarterlyDraftStore(identity, api, memoryStorage().storage);
    await store.load();
    expect(store.getSnapshot().payload).toEqual({ regular: {}, future: {} });
    expect(store.getSnapshot()).toMatchObject({ historical: legacy, revision: 3, dirty: false });
    expect(await store.flush()).toBe(true);
    expect(api.save).not.toHaveBeenCalled();
  });

  it('preserves one deterministic unconfirmed reference across normal edits, v2 save, and restart', async () => {
    const { storage, values } = memoryStorage(); const api = transport();
    const legacy = { ...remote('legacy reference', 3), periodConfirmed: false };
    api.read.mockResolvedValue(legacy);
    const store = new QuarterlyDraftStore(identity, api, storage);
    await store.load(); await store.load();
    const referenceKey = `${draftCacheKey(identity)}:reference:2026:Q4:r3`;
    const reference = storage.getItem(referenceKey);
    expect(JSON.parse(reference!).value).toEqual(legacy);
    expect([...values.keys()].filter((key) => key.includes(':reference:'))).toEqual([referenceKey]);
    edit(store, 'new work'); api.save.mockResolvedValue({ revision: 4, updatedAt: stamp });
    expect(await store.flush()).toBe(true);
    api.read.mockResolvedValue(remote('new work', 4));
    const restarted = new QuarterlyDraftStore(identity, api, storage); await restarted.load();
    expect(restarted.getSnapshot().payload).toEqual(payload('new work'));
    expect(storage.getItem(referenceKey)).toBe(reference);
    expect([...values.keys()].filter((key) => key.includes(':reference:'))).toEqual([referenceKey]);
  });

  it('surfaces a reference archive quota warning while still allowing an acknowledged cloud save', async () => {
    const { storage } = memoryStorage(); const setItem = storage.setItem;
    storage.setItem = vi.fn((key, value) => { if (key.includes(':reference:')) throw new Error('quota'); setItem(key, value); });
    const api = transport(); api.read.mockResolvedValue({ ...remote('legacy reference', 3), periodConfirmed: false });
    const store = new QuarterlyDraftStore(identity, api, storage); await store.load();
    expect(store.getSnapshot().localError).toBeTruthy();
    expect(store.getSnapshot().historical?.payload).toEqual(payload('legacy reference'));
    edit(store, 'new work'); api.save.mockResolvedValue({ revision: 4, updatedAt: stamp });
    expect(await store.flush()).toBe(true);
    expect(store.getSnapshot()).toMatchObject({ dirty: false, revision: 4, payload: payload('new work') });
  });

});
