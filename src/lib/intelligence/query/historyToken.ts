import { createHmac, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import type { AuditKeys } from './auditStore';
import type { VerifiedQueryIdentity } from './serverAuthority';

const tokenSchema = z.strictObject({ purpose: z.enum(['history-page', 'history-resume']), actor: z.uuid(), effective: z.uuid(),
  session: z.uuid(), revision: z.string().regex(/^[a-f0-9]{64}$/), expires: z.number().int(), value: z.record(z.string(), z.unknown()) });
export function sealHistoryToken(identity: VerifiedQueryIdentity, revision: string, purpose: 'history-page' | 'history-resume',
  value: Record<string, unknown>, keys: AuditKeys, now = Date.now()): string {
  const encoded = Buffer.from(JSON.stringify({ purpose, actor: identity.actorId, effective: identity.effectiveUserId,
    session: identity.sessionId, revision, expires: Math.min(now + 15 * 60_000, identity.expiresAt), value })).toString('base64url');
  return `${encoded}.${createHmac('sha256', keys.digestKey).update(`query-history/1:${encoded}`).digest('base64url')}`;
}
export function unsealHistoryToken(token: string, identity: VerifiedQueryIdentity, revision: string,
  purpose: 'history-page' | 'history-resume', keys: AuditKeys, now = Date.now()): Record<string, unknown> {
  let record: z.infer<typeof tokenSchema>;
  try {
    if (token.length > 3000) throw new Error();
    const parts = token.split('.');
    if (parts.length !== 2 || !parts.every(part => /^[A-Za-z0-9_-]+$/.test(part))) throw new Error();
    const expected = createHmac('sha256', keys.digestKey).update(`query-history/1:${parts[0]}`).digest();
    const actual = Buffer.from(parts[1], 'base64url');
    if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) throw new Error();
    record = tokenSchema.parse(JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8')));
    if (record.purpose !== purpose || record.actor !== identity.actorId || record.effective !== identity.effectiveUserId
      || record.session !== identity.sessionId || record.revision !== revision) throw new Error();
  } catch { throw new Error('QUERY_DENIED'); }
  // Expiry is user-recoverable only after every signature/ownership/current
  // revision check succeeds. Invalid references remain ordinary denials.
  if (record.expires <= now) throw new Error('QUERY_HISTORY_REOPEN');
  return record.value;
}
