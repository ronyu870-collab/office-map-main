import {loadEntryAuthority} from './entryAuthority';
import { createHash, randomUUID } from 'node:crypto';
import { IMPERSONATION_REQUEST_HEADER } from '@/src/lib/server/impersonationAuth';
import type { AuditPort, QueryAuthority } from './admission';
import { createRpcAuditPort } from './auditStore';
import { deliveryReportSchema } from './delivery';
import { validateDeliveryReport, verifyDeliveryToken } from './deliveryToken';
import type { queryHttpDependencies } from './http';
import { readQueryBody } from './httpBody';
import { isQuerySameOrigin } from './sameOrigin';
import { verifyQueryIdentity, type VerifiedQueryIdentity } from './serverAuthority';
import { recordQueryIntake } from './intake';

const json = (body: unknown, status: number) => Response.json(body, { status, headers: {
  'Cache-Control': 'private, no-store', Vary: `Authorization, ${IMPERSONATION_REQUEST_HEADER}`, 'X-Content-Type-Options': 'nosniff',
} });
/** Technical acknowledgements never read business data or return old content.
 * Every retry is retained; aggregate by deliveryId/phase/view digest, not rows.
 * A client claim cannot establish human attention, viewport visibility or disk save. */
export async function handleDeliveryReport(request: Request, dependencies: ReturnType<typeof queryHttpDependencies>): Promise<Response> {
  const attemptId = randomUUID(), { client, keys } = dependencies;
  let audit: AuditPort | undefined, received = false;
  try {
    const body = await readQueryBody(request, keys.digestKey);
    let identity: VerifiedQueryIdentity | undefined, impersonationDenied = false;
    if (!body.rejection) {
      const headers = new Headers(request.headers); headers.delete(IMPERSONATION_REQUEST_HEADER);
      try {
        identity = await verifyQueryIdentity(new Request(request.url, { headers }), client);
        if (request.headers.has(IMPERSONATION_REQUEST_HEADER)) {
          try { identity = await verifyQueryIdentity(request, client); } catch { impersonationDenied = true; }
        }
      } catch { /* Never attribute an unverified token. */ }
    }
    await recordQueryIntake(client,keys,{requestId:attemptId,body,identity,entry:'query_delivery_report',impersonationDenied});
    if (body.rejection) return json({ status: 'rejected' }, body.rejection === 'body_too_large' ? 413 : 400);
    if (!identity) return json({ status: 'denied' }, 401);
    audit = createRpcAuditPort(client, identity, keys);
    const pending: QueryAuthority = { actorId: identity.actorId, effectiveUserId: identity.effectiveUserId, sessionActive: false,
      policyVersion: 'http-receipt/1:authorization-pending', permissionRevision: 'not_evaluated', grants: [], fields: [] };
    let input;
    try { input = deliveryReportSchema.parse(JSON.parse(body.text!)); } catch { /* Invalid technical bodies are represented by bounded ingress digest, not arbitrary text. */ }
    await audit.receive({ requestId: attemptId, submittedText: '客户端交付回执', plan: null, authority: pending,
      metadata: { entry: 'query_delivery_report', impersonationDenied, inputValid: Boolean(input),
        report: input ? { ...input, deliveryToken: '[已脱敏:delivery_token]', tokenSha256: createHash('sha256').update(input.deliveryToken).digest('hex') } : null,
        inputDigest: body.digest, digestScope: body.digestScope, inputBytes: body.bytesObserved } }); received = true;
    if (!input || impersonationDenied || !isQuerySameOrigin(request)
      || !/^application\/json(?:\s*;|$)/i.test(request.headers.get('content-type') ?? '')) throw new Error('QUERY_DENIED');
    const claims = verifyDeliveryToken(input.deliveryToken, keys, identity);
    validateDeliveryReport(claims, input);
    // This performs the existing live auth.sessions / disabled-user / simulation
    // checks. Revoked credentials do not become an alternate receipt-only login.
    const authority = await loadEntryAuthority(client, identity, AbortSignal.timeout(10000));
    if (!authority.grants.includes('query:catalog')&&!authority.grants.includes('query:future-catalog')&&!authority.grants.includes('query:leases')) throw new Error('QUERY_DENIED');
    await audit.append(attemptId, 'running', { sourceRequestId: claims.requestId, authority });
    await audit.append(attemptId, 'delivery_receipt', { phase: input.phase, evidence: 'authenticated_client_report',
      humanRead: 'unproven', viewportVisibility: 'unproven', diskSave: 'unproven', delivery: claims,
      view: input.view ?? null, viewDigest: createHash('sha256').update(JSON.stringify(input.view ?? null)).digest('hex'),
      rendererVersion: 'home-query/2', reportedAt: 'server_event_time', sourceRequestId: claims.requestId });
    await audit.append(attemptId, 'succeeded', { status: 'client_report_recorded', delivery: 'acknowledgement_only' });
    return json({ status: 'recorded', attemptId, deliveryId: claims.deliveryId }, 200);
  } catch (error) {
    const denied = error instanceof Error && error.message === 'QUERY_DENIED';
    if (audit && received) {
      try { await audit.append(attemptId, denied ? 'denied' : 'failed', { reason: denied ? 'delivery_report_not_granted' : 'delivery_report_unavailable' }); }
      catch { return json({ status: 'unavailable' }, 503); }
    }
    return json({ status: denied ? 'denied' : 'unavailable' }, denied ? 403 : 503);
  }
}
