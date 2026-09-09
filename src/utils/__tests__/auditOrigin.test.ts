import { describe, expect, it } from 'vitest';
import { AUDIT_ORIGIN_SCHEMA_VERSION, isAuditOriginCurrent } from '@/src/utils/auditOrigin';

describe('audit origin isolation', () => {
  const userA = '11111111-1111-4111-8111-111111111111';
  const userB = '22222222-2222-4222-8222-222222222222';
  const sessionA = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const sessionB = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

  it('accepts only the exact user and auth session that created the event', () => {
    expect(isAuditOriginCurrent({
      origin_schema_version: AUDIT_ORIGIN_SCHEMA_VERSION,
      origin_user_id: userA,
      origin_auth_session_id: sessionA,
    }, userA, sessionA)).toBe(true);
  });

  it('rejects an A event when B signs in on the same browser', () => {
    expect(isAuditOriginCurrent({
      origin_schema_version: AUDIT_ORIGIN_SCHEMA_VERSION,
      origin_user_id: userA,
      origin_auth_session_id: sessionA,
    }, userB, sessionB)).toBe(false);
  });

  it('rejects an old session even when the same user signs in again', () => {
    expect(isAuditOriginCurrent({
      origin_schema_version: AUDIT_ORIGIN_SCHEMA_VERSION,
      origin_user_id: userA,
      origin_auth_session_id: sessionA,
    }, userA, sessionB)).toBe(false);
  });

  it('rejects legacy events without explicit origin metadata', () => {
    expect(isAuditOriginCurrent({ origin_user_id: userA }, userA, sessionA)).toBe(false);
    expect(isAuditOriginCurrent({}, userA, sessionA)).toBe(false);
  });
});
