import { createHash, createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import type { AuditPort } from './admission';
import type { AuditKeys } from './auditStore';
import type { VerifiedQueryIdentity } from './serverAuthority';
import type { DeliveryReport } from './delivery';

const claimsSchema = z.strictObject({ version: z.literal('query-delivery/1'), keyId: z.string(), deliveryId: z.uuid(),
  requestId: z.uuid(), actorId: z.uuid(), effectiveUserId: z.uuid(), sessionId: z.uuid(),
  bodySha256: z.string().regex(/^[a-f0-9]{64}$/), kind: z.enum(['result', 'clarification', 'status', 'chart', 'download']),
  resultId: z.uuid().nullable(), itemCount: z.number().int().min(0).max(5000000), issuedAt: z.number().int(), expiresAt: z.number().int(),
});
export type DeliveryClaims = z.infer<typeof claimsSchema>;
const sign = (payload: string, keys: AuditKeys) => createHmac('sha256', keys.digestKey).update(`query-delivery-token/1\n${payload}`).digest();
export function verifyDeliveryToken(token: string, keys: AuditKeys, identity: VerifiedQueryIdentity, now = Date.now()): DeliveryClaims {
  if (token.length > 4000 || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{43}$/.test(token)) throw new Error('QUERY_DENIED');
  const [payload, signature] = token.split('.');
  const provided = Buffer.from(signature, 'base64url');
  if (!timingSafeEqual(provided, sign(payload, keys))) throw new Error('QUERY_DENIED');
  let value: DeliveryClaims;
  try { value = claimsSchema.parse(JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'))); } catch { throw new Error('QUERY_DENIED'); }
  if (value.keyId !== keys.keyId || value.actorId !== identity.actorId || value.effectiveUserId !== identity.effectiveUserId
    || value.sessionId !== identity.sessionId || value.issuedAt > now || value.expiresAt <= now
    || value.expiresAt - value.issuedAt !== 24 * 60 * 60 * 1000 || identity.expiresAt <= now) throw new Error('QUERY_DENIED');
  return value;
}
export function validateDeliveryReport(claims: DeliveryClaims, report: DeliveryReport) {
  if (report.bodySha256 !== claims.bodySha256) throw new Error('QUERY_DENIED');
  if (report.phase === 'client_received' && report.view) throw new Error('QUERY_DENIED');
  if (report.phase === 'browser_download_dispatched' && (claims.kind !== 'download' || report.view)) throw new Error('QUERY_DENIED');
  if (report.phase === 'client_dom_committed') {
    const view = report.view;
    if (!view || (view.surface === 'answer_table' && claims.kind !== 'result')
      || (view.surface === 'chart' && claims.kind !== 'chart') || (view.surface === 'clarification' && claims.kind !== 'clarification')
      || ('page' in view && view.page * view.pageSize >= Math.max(1, claims.itemCount))) throw new Error('QUERY_DENIED');
  }
}
/** A signed challenge is returned only after the caller's final delivery checks.
 * It proves server preparation and binds the client's claim, not human reading. */
export async function prepareDelivery(audit: AuditPort, keys: AuditKeys, identity: VerifiedQueryIdentity,
  input: Pick<DeliveryClaims, 'requestId' | 'bodySha256' | 'kind' | 'resultId' | 'itemCount'>,
  detail: Record<string, unknown> = {}, now = Date.now()): Promise<Record<string, string>> {
  const claims = claimsSchema.parse({ ...input, version: 'query-delivery/1', keyId: keys.keyId, deliveryId: randomUUID(),
    actorId: identity.actorId, effectiveUserId: identity.effectiveUserId, sessionId: identity.sessionId,
    issuedAt: now, expiresAt: now + 24 * 60 * 60 * 1000 });
  const payload = Buffer.from(JSON.stringify(claims)).toString('base64url');
  const token = `${payload}.${sign(payload, keys).toString('base64url')}`;
  await audit.append(input.requestId, 'delivery_receipt', { ...detail, phase: 'response_prepared', bodySha256: input.bodySha256,
    delivery: claims, tokenSha256: createHash('sha256').update(token).digest('hex'), clientReceipt: 'unconfirmed' });
  return { 'X-Query-Delivery-Token': token, 'X-Query-Body-Sha256': input.bodySha256 };
}
