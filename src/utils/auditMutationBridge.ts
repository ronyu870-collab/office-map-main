export type SupabaseMutationOperation = 'INSERT' | 'UPSERT' | 'UPDATE' | 'DELETE' | 'RPC';

export interface SupabaseMutationNotice {
  kind: 'table' | 'rpc';
  target: string;
  method: 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  operation: SupabaseMutationOperation;
  status: number;
  occurredAt: string;
}

type Listener = (notice: SupabaseMutationNotice) => void;
const listeners = new Set<Listener>();
const pending: SupabaseMutationNotice[] = [];
const MAX_PENDING = 100;

export function reportSupabaseMutation(notice: SupabaseMutationNotice): void {
  if (typeof window === 'undefined') return;
  if (listeners.size === 0) {
    pending.push(notice);
    if (pending.length > MAX_PENDING) pending.splice(0, pending.length - MAX_PENDING);
    return;
  }
  for (const listener of listeners) {
    queueMicrotask(() => {
      try { listener(notice); } catch { /* audit fallback must never affect data writes */ }
    });
  }
}

export function subscribeSupabaseMutations(listener: Listener): () => void {
  listeners.add(listener);
  if (pending.length) {
    const queued = pending.splice(0);
    queueMicrotask(() => {
      for (const notice of queued) {
        try { listener(notice); } catch { /* ignore */ }
      }
    });
  }
  return () => { listeners.delete(listener); };
}
