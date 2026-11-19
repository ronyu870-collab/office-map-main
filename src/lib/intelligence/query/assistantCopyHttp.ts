import { createHash, randomUUID } from 'node:crypto';
import { IMPERSONATION_REQUEST_HEADER } from '@/src/lib/server/impersonationAuth';
import { restoreOwnAgentAnswer } from '../agent/agentConversation';
import type { AuditPort, QueryAuthority } from './admission';
import { assistantCopyInputSchema, assistantCopyOutputSchema } from './assistantCopyProtocol';
import { createRpcAuditPort } from './auditStore';
import { prepareDelivery } from './deliveryToken';
import { readQuestion } from './historyStore';
import type { queryHttpDependencies } from './http';
import { readQueryBody } from './httpBody';
import { recordQueryIntake } from './intake';
import { prepareQueryJsonResponse } from './jsonResponse';
import { readOwnResult } from './recovery';
import { isQuerySameOrigin } from './sameOrigin';
import { loadDataAuthority, verifyQueryIdentity, type DataAuthority, type VerifiedQueryIdentity } from './serverAuthority';

const json = (body: unknown, status: number) => Response.json(body, { status, headers: {
  'Cache-Control': 'private, no-store', Vary: `Authorization, ${IMPERSONATION_REQUEST_HEADER}`,
  'X-Content-Type-Options': 'nosniff',
} });
function authorizeCopy(authority: DataAuthority) {
  if (!authority.grants.includes('query:catalog') || !authority.grants.includes('export:internal')) throw new Error('QUERY_DENIED');
}

/** Copy the exact archived text, with the same independent export grant as
 * numerical result copying. It neither generates a new answer nor trusts text
 * from the browser. Native answers and legacy bounded assistant help share the
 * existing owner, current eligibility and inherited-plan authorization paths. */
export async function handleAssistantCopy(request: Request, dependencies: ReturnType<typeof queryHttpDependencies>): Promise<Response> {
  const attemptId = randomUUID(), { client, keys } = dependencies;
  let audit: AuditPort | undefined, terminal = false;
  try {
    const body = await readQueryBody(request, keys.digestKey);
    let identity: VerifiedQueryIdentity | undefined;
    const impersonationDenied = request.headers.has(IMPERSONATION_REQUEST_HEADER);
    if (!body.rejection) {
      const headers = new Headers(request.headers); headers.delete(IMPERSONATION_REQUEST_HEADER);
      try { identity = await verifyQueryIdentity(new Request(request.url, { headers }), client); } catch { /* No invented audit identity. */ }
    }
    await recordQueryIntake(client, keys, { requestId: attemptId, body, identity, entry: 'query_result_artifact', impersonationDenied });
    if (body.rejection) return json({ status: 'rejected', error: '请求未完整接收，请重试。' }, body.rejection === 'body_too_large' ? 413 : 400);
    if (!identity) return json({ status: 'denied', error: '登录状态无效，请重新登录。' }, 401);
    audit = createRpcAuditPort(client, identity, keys);
    const pending: QueryAuthority = { actorId: identity.actorId, effectiveUserId: identity.effectiveUserId, sessionActive: false,
      policyVersion: 'http-receipt/1:authorization-pending', permissionRevision: 'not_evaluated', grants: [], fields: [] };
    await audit.receive({ requestId: attemptId, submittedText: body.text!, plan: null, authority: pending,
      metadata: { entry: 'query_assistant_copy', rawRequest: body.text, impersonationDenied } });
    if (!dependencies.enabled || impersonationDenied || !isQuerySameOrigin(request)
      || !/^application\/json(?:\s*;|$)/i.test(request.headers.get('content-type') ?? '')) throw new Error('QUERY_DENIED');
    let input;
    try { input = assistantCopyInputSchema.parse(JSON.parse(body.text!)); } catch { throw new Error('QUERY_DENIED'); }
    const signal = AbortSignal.any([request.signal, AbortSignal.timeout(30000)]);
    const authority = await loadDataAuthority(client, identity, signal); authorizeCopy(authority);
    await audit.append(attemptId, 'running', { authority, sourceRequestId: input.requestId, action: 'copy_assistant' });
    const record = await readOwnResult(client, identity, input.requestId, 'status', signal);
    if (record.permission_revision !== authority.permissionRevision) throw new Error('QUERY_DENIED');
    const question = await readQuestion({ client, keys, identity, authority, signal }, input.requestId);
    if (question.conversation.id !== input.conversationId) throw new Error('QUERY_DENIED');
    let text: string, recheck: (() => Promise<void>) | undefined;
    if (question.agent && record.state === 'succeeded') {
      const answer = await restoreOwnAgentAnswer(client, identity, keys, authority, input.conversationId, input.requestId, signal);
      // Structured results retain their deterministic result-copy endpoint.
      if (answer.result) throw new Error('QUERY_DENIED');
      if (answer.headHash !== record.head_hash || answer.headSequence !== record.head_sequence) throw new Error('QUERY_RESULT_CHANGED');
      text = answer.message; recheck = answer.recheck;
    } else if (record.state === 'denied' && question.clarification?.reason === 'assistant_help') {
      text = question.clarification.message;
      recheck = async () => { await readQuestion({ client, keys, identity: identity!, authority, signal }, input.requestId); };
    } else throw new Error('QUERY_DENIED');
    const responseBody = { attemptId, ...assistantCopyOutputSchema.parse({ status: 'ready',
      requestId: input.requestId, conversationId: input.conversationId, text }) };
    const bodySha256 = createHash('sha256').update(JSON.stringify(responseBody)).digest('hex');
    await audit.append(attemptId, 'response_generated', { result: { kind: 'assistant_copy_reference', sourceRequestId: input.requestId,
      sourceHeadHash: record.head_hash, sourceHeadSequence: record.head_sequence, bodySha256, rendererVersion: 'assistant-copy/1' } });
    await audit.append(attemptId, 'succeeded', { delivery: 'not_yet_sent' }); terminal = true;
    const delivery = await prepareDelivery(audit, keys, identity, { requestId: attemptId, bodySha256, kind: 'copy', resultId: null, itemCount: 0 },
      { httpStatus: 200, sourceRequestId: input.requestId });
    const response = await prepareQueryJsonResponse(request, responseBody, delivery);
    await recheck();
    const final = await readOwnResult(client, identity, input.requestId, 'status', signal);
    if (final.permission_revision !== authority.permissionRevision) throw new Error('QUERY_DENIED');
    if (final.head_hash !== record.head_hash || final.head_sequence !== record.head_sequence) throw new Error('QUERY_RESULT_CHANGED');
    const current = await loadDataAuthority(client, identity, signal); authorizeCopy(current);
    if (current.permissionRevision !== authority.permissionRevision || current.policyVersion !== authority.policyVersion) throw new Error('QUERY_DENIED');
    return response;
  } catch (error) {
    const denied = error instanceof Error && error.message === 'QUERY_DENIED';
    const changed = error instanceof Error && error.message === 'QUERY_RESULT_CHANGED';
    if (audit) {
      try { await audit.append(attemptId, terminal ? 'correction' : denied ? 'denied' : 'failed', {
        delivery: 'not_sent', reason: denied ? 'assistant_copy_not_granted' : changed ? 'assistant_copy_changed' : 'assistant_copy_unavailable' }); }
      catch { return json({ status: 'unavailable', error: '审计服务暂不可用，未交付复制内容。' }, 503); }
    }
    return json({ status: denied ? 'denied' : changed ? 'changed' : 'unavailable',
      error: denied ? '当前没有复制此回答的权限。' : changed ? '回答状态已变化，请重新打开对话。' : '回答暂时无法复制，请稍后重试。' },
    denied ? 403 : changed ? 409 : 503);
  }
}
