export const AUDIT_ORIGIN_SCHEMA_VERSION = 2;

export type AuditOriginLike = {
  origin_schema_version?: unknown;
  origin_user_id?: unknown;
  origin_auth_session_id?: unknown;
};

/**
 * Audit events are session-bound, not merely user-bound.
 *
 * A queued event is valid only for the exact authenticated user + Supabase Auth
 * session that created it. Legacy events without an origin version are rejected
 * intentionally: losing a stale audit event is safer than attributing it to the
 * next person who signs in on the same browser.
 */
export function isAuditOriginCurrent(
  event: AuditOriginLike,
  currentUserId: string,
  currentAuthSessionId: string | null,
): boolean {
  return event.origin_schema_version === AUDIT_ORIGIN_SCHEMA_VERSION
    && typeof event.origin_user_id === 'string'
    && event.origin_user_id === currentUserId
    && typeof event.origin_auth_session_id === 'string'
    && Boolean(currentAuthSessionId)
    && event.origin_auth_session_id === currentAuthSessionId;
}
