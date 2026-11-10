// A private, memory-only comparison snapshot. The cross-tab signal contains no data or identity.
const TTL_MS = 30_000;
const MAX_ENTRIES = 12;
const INVALIDATION_KEY = 'colliers:compare-revision';
let localRevision = '';
let activeScope: string | undefined;
let activeRevision: string | undefined;
const entries = new Map<string, { promise: Promise<unknown>; expiresAt: number }>();

function revision(): string {
  try { return `${localRevision}:${localStorage.getItem(INVALIDATION_KEY) ?? ''}`; }
  catch { return localRevision; }
}

export function clearCompareSnapshot(scope?: string): void {
  if (scope !== undefined && activeScope !== scope) return;
  entries.clear();
  activeScope = undefined;
  activeRevision = undefined;
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

export function readCompareSnapshot<T>(scope: string, load: () => Promise<T>, key = 'all'): Promise<{ payload: T; expiresAt: number }> {
  if (typeof window === 'undefined') return load().then(payload => ({ payload, expiresAt: Date.now() + TTL_MS }));
  const stamp = revision();
  if (activeScope !== scope || activeRevision !== stamp) {
    clearCompareSnapshot();
    activeScope = scope;
    activeRevision = stamp;
  }
  const cached = entries.get(key);
  if (cached && cached.expiresAt > Date.now()) {
    // Keep recently used selections available without extending their TTL.
    entries.delete(key);
    entries.set(key, cached);
    return cached.promise as Promise<{ payload: T; expiresAt: number }>;
  }
  const next: { expiresAt: number; promise: Promise<{ payload: T; expiresAt: number }> } = {
    expiresAt: Infinity, promise: Promise.resolve().then(load).then(payload => {
      next.expiresAt = Date.now() + TTL_MS;
      return { payload, expiresAt: next.expiresAt };
    }),
  };
  entries.delete(key);
  entries.set(key, next);
  if (entries.size > MAX_ENTRIES) entries.delete(entries.keys().next().value!);
  void next.promise.catch(() => { if (entries.get(key) === next) entries.delete(key); });
  return next.promise;
}
