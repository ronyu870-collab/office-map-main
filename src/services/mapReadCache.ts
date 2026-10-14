// Browser memory only. Each identity gets its own short-lived map snapshot.
const MAP_READ_TTL_MS = 30_000;
let activeScope: string | null = null;
const entries = new Map<string, { expiresAt: number; promise: Promise<unknown> }>();

export function clearMapReadCache(): void {
  entries.clear();
  activeScope = null;
}

export function readMapDataWithCache<T>(scope: string, path: string, load: () => Promise<T>): Promise<T> {
  if (typeof window === 'undefined') return load();
  if (activeScope !== scope) {
    clearMapReadCache();
    activeScope = scope;
  }
  const cached = entries.get(path);
  if (cached && cached.expiresAt > Date.now()) return cached.promise as Promise<T>;

  const entry = { expiresAt: Infinity, promise: Promise.resolve().then(load) };
  entries.set(path, entry);
  void entry.promise.then(() => {
    entry.expiresAt = Date.now() + MAP_READ_TTL_MS;
  }, () => {
    if (entries.get(path) === entry) entries.delete(path);
  });
  return entry.promise;
}
