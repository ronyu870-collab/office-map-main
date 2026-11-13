import type { AuthSessionResult } from './Auth';

type Transition = { pending: true } | { pending: false; result: AuthSessionResult | null };
type Listener = (transition: Transition) => void;
const listeners = new Set<Listener>();
let pending = false;

export function isPasswordSignInPending(): boolean {
  return pending;
}

export function subscribeToPasswordSignIn(listener: Listener): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

/** The SDK emits SIGNED_IN before the app has verified the phone number. */
export async function runPasswordSignIn(work: () => Promise<AuthSessionResult>): Promise<AuthSessionResult> {
  if (typeof window === 'undefined') return work();
  if (pending) throw new Error('正在验证登录，请稍候');
  pending = true;
  let result: AuthSessionResult | null = null;
  try {
    listeners.forEach(listener => listener({ pending: true }));
    result = await work();
    return result;
  } finally {
    pending = false;
    listeners.forEach(listener => listener({ pending: false, result }));
  }
}
