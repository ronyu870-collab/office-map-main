import { createHash, randomUUID } from 'node:crypto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { IMPERSONATION_REQUEST_HEADER } from '@/src/lib/server/impersonationAuth';
import { runAuditedSubmission, type QueryAuthority } from './admission';
import { createRpcAuditPort, type AuditKeys } from './auditStore';
import { executeQueryPlan } from './executePlan';
import { readQueryBody } from './httpBody';
import { loadDataAuthority, verifyQueryIdentity, type VerifiedQueryIdentity } from './serverAuthority';
import { readQuerySnapshots } from './snapshotReader';
import { parseQueryPlan } from './plan';

const submissionSchema = z.strictObject({ idempotencyKey: z.uuid(), question: z.string().min(1).max(6000), plan: z.unknown() });
function scopedRequestId(identity: VerifiedQueryIdentity, nonce: string): string {
  const bytes = createHash('sha256').update(`query-http/1:${identity.actorId}:${identity.effectiveUserId}:${nonce}`).digest().subarray(0, 16);
  bytes[6] = (bytes[6] & 15) | 128; bytes[8] = (bytes[8] & 63) | 128;
  const hex = bytes.toString('hex');
  return `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`;
}
const json = (body: unknown, status: number) => Response.json(body, { status, headers: {
  'Cache-Control': 'private, no-store', Vary: `Authorization, ${IMPERSONATION_REQUEST_HEADER}`, 'X-Content-Type-Options': 'nosniff',
} });

export function queryHttpDependencies(): { client: SupabaseClient; keys: AuditKeys; enabled: boolean } {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL, secret = process.env.SUPABASE_SECRET_KEY;
  const keyId = process.env.AI_QUERY_AUDIT_KEY_ID;
  const encryption = process.env.AI_QUERY_AUDIT_ENCRYPTION_KEY, digest = process.env.AI_QUERY_AUDIT_DIGEST_KEY;
  if (!url || !secret || !keyId || !/^[A-Za-z0-9_-]{1,80}$/.test(keyId)
    || !encryption || !/^[a-f0-9]{64}$/i.test(encryption) || !digest || !/^[a-f0-9]{64}$/i.test(digest) || encryption.toLowerCase() === digest.toLowerCase()) throw new Error('QUERY_CONFIGURATION_UNAVAILABLE');
  return {
    client: createClient(url, secret, { auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: (input, init) => fetch(input, { ...init, signal: AbortSignal.any([...(init?.signal ? [init.signal] : []), AbortSignal.timeout(10000)]) }) } }),
    keys: { keyId, encryptionKey: Buffer.from(encryption, 'hex'), digestKey: Buffer.from(digest, 'hex') }, enabled: process.env.AI_QUERY_HTTP_ENABLED === 'true',
  };
}

/** Complete structured HTTP submission boundary; this never calls a model. */
export async function handleQuerySubmission(request: Request, dependencies: ReturnType<typeof queryHttpDependencies>): Promise<Response> {
  const { client, keys } = dependencies;
  let requestId: string = randomUUID();
  try {
    const body = await readQueryBody(request, keys.digestKey);
    let parsed: z.infer<typeof submissionSchema> | undefined;
    if (body.text !== null) {
      try { const value = submissionSchema.safeParse(JSON.parse(body.text)); if (value.success) parsed = value.data; } catch { /* Full bounded text is retained below for authenticated malformed submissions. */ }
    }
    let identity: VerifiedQueryIdentity | undefined;
    let impersonationDenied = false;
    if (!body.rejection) {
      const headers = new Headers(request.headers); headers.delete(IMPERSONATION_REQUEST_HEADER);
      try {
        // Verify the actual caller first so a forged simulation cannot turn their
        // formally submitted question into an unattributed anonymous event.
        identity = await verifyQueryIdentity(new Request(request.url, { headers }), client);
        if (request.headers.has(IMPERSONATION_REQUEST_HEADER)) {
          try { identity = await verifyQueryIdentity(new Request(request.url, { headers: request.headers }), client); }
          catch { impersonationDenied = true; }
        }
      } catch { /* No identity is invented from a decoded, unverified token. */ }
    }
    if (identity && parsed) requestId = scopedRequestId(identity, parsed.idempotencyKey);
    const reason = body.rejection ?? (identity ? 'request_received' : 'unauthenticated');
    const ingress = await client.rpc('ai_query_record_ingress', {
      p_event_id: randomUUID(), p_request_id: requestId, p_actor: identity?.actorId ?? null, p_session: identity?.sessionId ?? null, p_reason: reason,
      p_bytes: body.bytesObserved, p_complete: body.complete, p_digest: body.digest, p_digest_scope: body.digestScope,
    }).abortSignal(AbortSignal.timeout(8000));
    if (ingress.error) throw new Error('AUDIT_PERSISTENCE_UNAVAILABLE');
    if (body.rejection) return json({ requestId, status: 'rejected', code: body.rejection, error: '请求未完整接收，请缩短内容或重新提交。' }, body.rejection === 'body_too_large' ? 413 : 400);
    if (!identity) return json({ requestId, status: 'denied', error: '登录状态无效，请重新登录。' }, 401);
    const audit = createRpcAuditPort(client, identity, keys);
    const pending: QueryAuthority = { actorId: identity.actorId, effectiveUserId: identity.effectiveUserId, sessionActive: false,
      policyVersion: 'http-receipt/1:authorization-pending', permissionRevision: 'not_evaluated', grants: [], fields: [] };
    const signal = AbortSignal.any([request.signal, AbortSignal.timeout(30000)]);
    const verified = identity;
    const fresh = async () => {
      if (!dependencies.enabled || impersonationDenied || !parsed
        || !/^application\/json(?:\s*;|$)/i.test(request.headers.get('content-type') ?? '')
        || (request.headers.get('origin') && request.headers.get('origin') !== new URL(request.url).origin)) throw new Error('QUERY_DENIED');
      return loadDataAuthority(client, verified, signal);
    };
    let boundedPlan: unknown = null;
    try { if (parsed) boundedPlan = parseQueryPlan(parsed.plan); } catch { /* Raw bounded submission is still audited; invalid plans cannot execute. */ }
    let usedRevision: string | null = null;
    const submission = { requestId, submittedText: parsed?.question ?? body.text!, plan: boundedPlan,
      authority: pending, signal, metadata: { rawRequest: body.text, conversationId: requestId, turnId: requestId, relation: 'initial_structured_submission', impersonationDenied, inputBytes: body.bytesObserved } };
    const result = await runAuditedSubmission(submission, audit, {
      freshAuthority: fresh,
      execute: async plan => {
        const authority = await fresh(); usedRevision = authority.permissionRevision;
        return executeQueryPlan(plan, await readQuerySnapshots(client, verified, authority, plan, signal));
      },
    }).catch(async error => {
      if (!(error instanceof Error) || error.message !== 'AUDIT_IDEMPOTENCY_CONFLICT') throw error;
      const conflictingId = requestId; requestId = randomUUID();
      await audit.receive({ ...submission, requestId, metadata: { ...submission.metadata, conversationId: requestId, turnId: requestId, rejectedRetryOf: conflictingId } });
      await audit.append(requestId, 'denied', { reason: 'idempotency_content_conflict', delivery: 'not_sent' });
      return { status: 'conflict' as const };
    });
    if (result.status !== 'ready') {
      const status = result.status === 'already_received' ? 202 : result.status === 'denied' ? 403 : result.status === 'cancelled' || result.status === 'conflict' ? 409 : 503;
      return json({ requestId, status: result.status, error: result.status === 'already_received' ? '此请求已接收，请勿重复执行。' : '本次查询未交付，请检查权限或稍后重试。' }, status);
    }
    const responseBody = { requestId, status: 'ready', result: result.result };
    await audit.append(requestId, 'delivery_receipt', { phase: 'response_prepared', resultId: result.result.resultId,
      bodySha256: createHash('sha256').update(JSON.stringify(responseBody)).digest('hex'), httpStatus: 200, clientReceipt: 'unconfirmed' });
    try { if ((await fresh()).permissionRevision !== usedRevision) throw new Error('QUERY_DENIED'); }
    catch (error) {
      const denied = error instanceof Error && error.message === 'QUERY_DENIED';
      await audit.append(requestId, 'correction', { delivery: 'not_sent', reason: denied ? 'authorization_changed_before_response' : 'authorization_unavailable_before_response' });
      return json({ requestId, status: denied ? 'denied' : 'unavailable', error: denied ? '查询权限已变化，结果未交付。' : '暂时无法确认查询权限，结果未交付。' }, denied ? 403 : 503);
    }
    return json(responseBody, 200);
  } catch {
    // Do not expose SDK exceptions, raw questions, role lookups or source counts.
    return json({ requestId, status: 'unavailable', error: '查询或审计服务暂不可用，本次未交付结果。' }, 503);
  }
}
