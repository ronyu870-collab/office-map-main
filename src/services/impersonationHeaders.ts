export const IMPERSONATION_REQUEST_HEADER = 'X-Colliers-Impersonate-User';
const STORAGE_KEY = '__impersonation_state';

type StoredImpersonationState = {
  targetUserId?: unknown;
};

export function getImpersonationTargetUserId(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StoredImpersonationState;
    return typeof parsed.targetUserId === 'string' && parsed.targetUserId.trim()
      ? parsed.targetUserId.trim()
      : null;
  } catch {
    return null;
  }
}

export function getImpersonationRequestHeaders(): Record<string, string> {
  const targetUserId = getImpersonationTargetUserId();
  return targetUserId ? { [IMPERSONATION_REQUEST_HEADER]: targetUserId } : {};
}

export function withImpersonationHeaders(headers?: HeadersInit): Headers {
  const result = new Headers(headers);
  const targetUserId = getImpersonationTargetUserId();
  if (targetUserId) result.set(IMPERSONATION_REQUEST_HEADER, targetUserId);
  return result;
}
