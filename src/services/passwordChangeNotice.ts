const NOTICE_KEY = '__password_changed_reauthentication';
const listeners = new Set<() => void>();

export function subscribeToPasswordChangeNotice(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

/** A non-sensitive tab-local notice survives auth-driven redirects and reloads. */
export function setPasswordChangeNotice(show: boolean): void {
  if (typeof window === 'undefined') return;
  try {
    if (show) sessionStorage.setItem(NOTICE_KEY, '1');
    else sessionStorage.removeItem(NOTICE_KEY);
  } catch { /* The notice must not block authentication recovery. */ }
  listeners.forEach(listener => listener());
}

export function hasPasswordChangeNotice(): boolean {
  if (typeof window === 'undefined') return false;
  try { return sessionStorage.getItem(NOTICE_KEY) === '1'; }
  catch { return false; }
}
