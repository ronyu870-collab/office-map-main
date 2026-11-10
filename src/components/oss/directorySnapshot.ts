import type { ResearchLibraryItem } from './libraryModel';

type Snapshot = { items: ResearchLibraryItem[]; truncated: boolean; expiresAt: number };
const TTL_MS = 30_000;
const MAX_DIRECTORIES = 12;
const REVISION_KEY = 'colliers:research-directory-revision';
const entries = new Map<string, Snapshot>();
let activeScope: string | null = null;
let generation = 0;
let lastExternalRevision: string | null = null;

function readExternalRevision() {
  try { return localStorage.getItem(REVISION_KEY); } catch { return null; }
}

export function clearResearchDirectories() {
  entries.clear();
  activeScope = null;
  generation += 1;
}

export function beginResearchDirectoryRead(scope: string, prefix: string) {
  const externalRevision = readExternalRevision();
  if (activeScope !== scope || lastExternalRevision !== externalRevision) {
    clearResearchDirectories();
    activeScope = scope;
    lastExternalRevision = externalRevision;
  }
  const requestGeneration = generation;
  const candidate = entries.get(prefix);
  const cached = candidate && candidate.expiresAt > Date.now() ? candidate : undefined;
  return {
    cached,
    discard() { if (requestGeneration === generation) entries.delete(prefix); },
    remember(items: ResearchLibraryItem[], truncated: boolean, sessionExpiresAt: number) {
      if (requestGeneration !== generation || readExternalRevision() !== externalRevision) return;
      entries.delete(prefix);
      // Only complete lists can satisfy a short return without a new read.
      if (truncated) return;
      entries.set(prefix, { items, truncated, expiresAt: Math.min(Date.now() + TTL_MS, sessionExpiresAt) });
      if (entries.size > MAX_DIRECTORIES) entries.delete(entries.keys().next().value!);
    },
  };
}

export function invalidateResearchDirectories(exact: string[], subtrees: string[] = []) {
  const affects = (prefix: string) => exact.includes(prefix) || subtrees.some(tree => prefix.startsWith(tree));
  generation += 1;
  for (const prefix of entries.keys()) if (affects(prefix)) entries.delete(prefix);
  // Other tabs get a conservative invalidation without carrying private directory names.
  try {
    localStorage.setItem(REVISION_KEY, crypto.randomUUID());
    lastExternalRevision = readExternalRevision();
  } catch { /* local invalidation already applied */ }
  return affects;
}

export function subscribeResearchDirectoryChanges(refresh: () => void) {
  const handleStorage = (event: StorageEvent) => {
    if (event.key !== REVISION_KEY && event.key !== null) return;
    clearResearchDirectories();
    refresh();
  };
  window.addEventListener('storage', handleStorage);
  return () => window.removeEventListener('storage', handleStorage);
}

export function researchDirectoryParent(key: string) {
  const item = key.replace(/\/$/, '');
  return item.slice(0, item.lastIndexOf('/') + 1);
}
