export const NOTICE_DRAFT_PREFIX = 'colliers:admin:notice-drafts:';

export function noticeDraftKey(userId: string, sessionId: string) {
  return `${NOTICE_DRAFT_PREFIX}${userId}:${sessionId}`;
}

export function readNoticeDrafts(key: string | null, limit: number): string[] {
  if (!key || typeof window === 'undefined') return [];
  try {
    const value: unknown = JSON.parse(window.sessionStorage.getItem(key) ?? 'null');
    return Array.isArray(value) && value.length <= limit && value.every(text => typeof text === 'string') ? value : [];
  } catch {
    return [];
  }
}

export function writeNoticeDrafts(key: string | null, drafts: string[]) {
  if (!key) return;
  try {
    if (drafts.some(Boolean)) window.sessionStorage.setItem(key, JSON.stringify(drafts));
    else window.sessionStorage.removeItem(key);
  } catch { /* In-page confirmation and the unload prompt still protect in-memory input. */ }
}
