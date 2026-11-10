// A private, memory-only comparison snapshot. The cross-tab signal contains no data or identity.
const TTL_MS = 30_000;
const INVALIDATION_KEY = 'colliers:compare-revision';
let localRevision = '';
let entry: { scope: string; revision: string; promise: Promise<unknown>; expiresAt: number } | undefined;

function revision(): string {
  try { return `${localRevision}:${localStorage.getItem(INVALIDATION_KEY) ?? ''}`; }
  catch { return localRevision; }
}

export function clearCompareSnapshot(): void {
  entry = undefined;
}

export function invalidateCompareSnapshot(): void {
  if (typeof window === 'undefined') return;
  clearCompareSnapshot();
  localRevision = crypto.randomUUID();
  try { localStorage.setItem(INVALIDATION_KEY, localRevision); } catch { /* same-tab still works */ }
  window.dispatchEvent(new Event(INVALIDATION_KEY));
}

export function subscribeCompareInvalidation(listener: () => void): () => void {
  const handleStorage = (event: StorageEvent) => {
    if (event.key !== INVALIDATION_KEY && event.key !== null) return;
    clearCompareSnapshot();
    listener();
  };
  window.addEventListener(INVALIDATION_KEY, listener);
  window.addEventListener('storage', handleStorage);
  return () => {
    window.removeEventListener(INVALIDATION_KEY, listener);
    window.removeEventListener('storage', handleStorage);
  };
}

export function readCompareSnapshot<T>(scope: string, load: () => Promise<T>): Promise<{ payload: T; expiresAt: number }> {
  if (typeof window === 'undefined') return load().then(payload => ({ payload, expiresAt: Date.now() + TTL_MS }));
  const stamp = revision();
  if (entry?.scope === scope && entry.revision === stamp && entry.expiresAt > Date.now()) {
    return entry.promise as Promise<{ payload: T; expiresAt: number }>;
  }
  const next: { scope: string; revision: string; expiresAt: number; promise: Promise<{ payload: T; expiresAt: number }> } = {
    scope, revision: stamp, expiresAt: Infinity, promise: Promise.resolve().then(load).then(payload => {
      next.expiresAt = Date.now() + TTL_MS;
      return { payload, expiresAt: next.expiresAt };
    }),
  };
  entry = next;
  void next.promise.catch(() => { if (entry === next) clearCompareSnapshot(); });
  return next.promise;
}
