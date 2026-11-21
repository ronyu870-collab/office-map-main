export type SupabaseMutationOperation = 'INSERT' | 'UPSERT' | 'UPDATE' | 'DELETE' | 'RPC';

export interface SupabaseMutationNotice {
  origin?: { userId:string; authSessionId:string } | null;
  kind: 'table' | 'rpc';
  target: string;
  method: 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  operation: SupabaseMutationOperation;
  status: number;
  occurredAt: string;
}

type Listener = (notice: SupabaseMutationNotice) => void;
const listeners = new Set<Listener>();
let origin: SupabaseMutationNotice['origin'] = null;
export function setSupabaseMutationOrigin(value:SupabaseMutationNotice['origin']) { origin=value; }
export function captureSupabaseMutationOrigin() { return origin; }
export function reportSupabaseMutation(notice: SupabaseMutationNotice): void {
  if (typeof window === 'undefined') return;
  for (const listener of listeners) {
    queueMicrotask(() => {
      try { listener(notice); } catch { /* audit fallback must never affect data writes */ }
    });
  }
}

export function subscribeSupabaseMutations(listener: Listener): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
