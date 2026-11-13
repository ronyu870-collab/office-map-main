import { createHash, randomUUID } from 'node:crypto';
import { gzipSync, gunzipSync } from 'node:zlib';
import type { SupabaseClient } from '@supabase/supabase-js';
import { auditPayloadDigest, encryptAuditContent } from './auditCrypto';
import { sanitizeAuditContent, type AuditKeys } from './auditStore';
import { deliveryReportSchema } from './delivery';
import type { BodyRead } from './httpBody';
import type { VerifiedQueryIdentity } from './serverAuthority';

type Entry = 'query_submission' | 'query_result_recovery' | 'query_result_artifact' | 'query_delivery_report';

/** Only consume authenticated, decrypted intake content; cap decompression. */
export function decodeIntakeDocument(plaintext: string): unknown {
  const value = JSON.parse(plaintext);
  if (value?.encoding !== 'gzip-base64') return value;
  if (value.version !== 'query-intake-envelope/1' || typeof value.data !== 'string' || value.data.length > 128 * 1024
    || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value.data)) throw new Error('AUDIT_INTAKE_ENCODING_INVALID');
  return JSON.parse(gunzipSync(Buffer.from(value.data, 'base64'), { maxOutputLength: 512 * 1024 }).toString('utf8'));
}

/** The transport observation and protected submitted content commit together.
 * This is an attempt journal, not evidence of authorization or execution.
 * Every HTTP retry gets a new event; a transport retry within one call reuses it. */
export async function recordQueryIntake(client: SupabaseClient, keys: AuditKeys, input: {
  requestId: string; body: BodyRead; identity?: VerifiedQueryIdentity; entry: Entry; impersonationDenied: boolean;
}): Promise<void> {
  const { body } = input;
  const identity = body.rejection ? undefined : input.identity;
  const eventId = randomUUID();
  const base = { p_event_id: eventId, p_request_id: input.requestId, p_actor: identity?.actorId ?? null,
    p_session: identity?.sessionId ?? null, p_reason: body.rejection ?? (identity ? 'request_received' : 'unauthenticated'),
    p_bytes: body.bytesObserved, p_complete: body.complete, p_digest: body.digest, p_digest_scope: body.digestScope };
  if (!identity || body.rejection) {
    const { error } = await client.rpc('ai_query_record_ingress', base).abortSignal(AbortSignal.timeout(8000));
    if (error) throw new Error('AUDIT_PERSISTENCE_UNAVAILABLE');
    return;
  }
  if (body.text === null || !body.complete || body.digestScope !== 'complete') throw new Error('AUDIT_INTAKE_INCOMPLETE');
  let payload: unknown = { rawRequest: body.text };
  if (input.entry === 'query_delivery_report') {
    // This route accepts protocol acknowledgements, not business questions.
    // Never duplicate the delivery capability token into any protected journal.
    let report;
    try { report = deliveryReportSchema.parse(JSON.parse(body.text)); } catch { /* Digest-only malformed technical report. */ }
    payload = { inputValid: Boolean(report), report: report ? { ...report, deliveryToken: '[已脱敏:delivery_token]',
      tokenSha256: createHash('sha256').update(report.deliveryToken).digest('hex') } : null };
  }
  const document = JSON.stringify(sanitizeAuditContent({ version: 'query-intake/1', entry: input.entry,
    payload, impersonationDenied: input.impersonationDenied, sessionId: identity.sessionId,
    inputBytes: body.bytesObserved, inputDigest: body.digest, policyVersion: 'http-receipt/1:authorization-pending',
    authorization: 'not_evaluated', execution: 'not_started', timezone: 'Asia/Shanghai' }));
  // A bounded malformed body full of control characters expands up to sixfold
  // in JSON. Compress inside encryption rather than silently dropping its text.
  const content = Buffer.byteLength(document, 'utf8') <= 80 * 1024 ? document : JSON.stringify({
    version: 'query-intake-envelope/1', encoding: 'gzip-base64', data: gzipSync(document).toString('base64'),
  });
  const { error } = await client.rpc('ai_query_record_intake', { ...base, p_effective: identity.effectiveUserId,
    p_entry: input.entry, p_content_digest: auditPayloadDigest(content, keys.digestKey),
    p_cipher: encryptAuditContent(content, { requestId: input.requestId, eventId, actorId: identity.actorId,
      effectiveUserId: identity.effectiveUserId }, keys.keyId, keys.encryptionKey),
  }).abortSignal(AbortSignal.timeout(8000));
  if (error) throw new Error('AUDIT_PERSISTENCE_UNAVAILABLE');
}
