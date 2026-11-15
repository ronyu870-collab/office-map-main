import { createHash, randomUUID } from 'node:crypto';
import { IMPERSONATION_REQUEST_HEADER } from '@/src/lib/server/impersonationAuth';
import type { AuditPort, QueryAuthority } from './admission';
import { createRpcAuditPort } from './auditStore';
import { prepareDelivery } from './deliveryToken';
import type { queryHttpDependencies } from './http';
import { readQueryBody } from './httpBody';
import { historyInputSchema } from './historyProtocol';
import { changeOwnHistory, listOwnHistory, openOwnHistory } from './historyStore';
import { recordQueryIntake } from './intake';
import { prepareQueryJsonResponse } from './jsonResponse';
import { isQuerySameOrigin } from './sameOrigin';
import { loadDataAuthority, verifyQueryIdentity, type VerifiedQueryIdentity } from './serverAuthority';

const json = (body: unknown, status: number) => Response.json(body, { status, headers: { 'Cache-Control': 'private, no-store',
  Vary: `Authorization, ${IMPERSONATION_REQUEST_HEADER}`, 'X-Content-Type-Options': 'nosniff' } });

/** Own work history is not the audit console. Current AI eligibility and all
 * selected-result source ACLs are checked again before any body is delivered. */
export async function handleOwnHistory(request: Request, dependencies: ReturnType<typeof queryHttpDependencies>) {
  const attemptId = randomUUID();
  let audit: AuditPort | undefined, terminal = false;
  try {
    const { client, keys } = dependencies, body = await readQueryBody(request, keys.digestKey);
    let identity: VerifiedQueryIdentity | undefined;
    const impersonationDenied = request.headers.has(IMPERSONATION_REQUEST_HEADER);
    if (!body.rejection) {
      const headers = new Headers(request.headers); headers.delete(IMPERSONATION_REQUEST_HEADER);
      try { identity = await verifyQueryIdentity(new Request(request.url, { headers }), client); } catch { /* No invented identity. */ }
    }
    // History is an owned recovery control operation, so it reuses the deployed
    // intake family rather than widening existing ingress constraints.
    await recordQueryIntake(client, keys, { requestId: attemptId, body, identity, entry: 'query_result_recovery', impersonationDenied });
    if (body.rejection) return json({ status: 'rejected', error: '请求未完整接收，请重试。' }, body.rejection === 'body_too_large' ? 413 : 400);
    if (!identity) return json({ status: 'denied', error: '登录状态无效，请重新登录。' }, 401);
    audit = createRpcAuditPort(client, identity, keys);
    const pending: QueryAuthority = { actorId: identity.actorId, effectiveUserId: identity.effectiveUserId, sessionActive: false,
      policyVersion: 'http-receipt/1:authorization-pending', permissionRevision: 'not_evaluated', grants: [], fields: [] };
    await audit.receive({ requestId: attemptId, submittedText: body.text!, plan: null, authority: pending,
      metadata: { entry: 'query_history', rawRequest: body.text, impersonationDenied } });
    if (!dependencies.enabled || impersonationDenied || !isQuerySameOrigin(request)
      || !/^application\/json(?:\s*;|$)/i.test(request.headers.get('content-type') ?? '')) throw new Error('QUERY_DENIED');
    const input = historyInputSchema.parse(JSON.parse(body.text!));
    const signal = AbortSignal.any([request.signal, AbortSignal.timeout(30000)]);
    const authority = await loadDataAuthority(client, identity, signal);
    if (!authority.grants.includes('query:catalog')) throw new Error('QUERY_DENIED');
    await audit.append(attemptId, 'running', { action: input.action, authority });
    const context = { client, keys, identity, authority, signal };
    let responseBody: Record<string, unknown>, recheck: (() => Promise<void>) | undefined;
    let resultId: string | null = null, itemCount = 0;
    if (input.action === 'list') {
      const page = await listOwnHistory(context, input);
      responseBody = { status: 'ready', page }; itemCount = page.entries.length;
    } else if (input.action === 'open') {
      const opened = await openOwnHistory(context, input);
      responseBody = { status: 'ready', opened: opened.opened }; recheck = opened.recheck;
      resultId = opened.opened.selected.reply.result?.resultId ?? null;
      itemCount = opened.opened.selected.reply.result?.table.rows.length ?? 0;
    } else {
      await changeOwnHistory(context, input);
      responseBody = { status: 'saved', action: input.action };
    }
    // Store only a response reference/digest. Existing encrypted original
    // archives own every answer; list/open never create a duplicate answer blob.
    const bodySha256 = createHash('sha256').update(JSON.stringify(responseBody)).digest('hex');
    await audit.append(attemptId, 'response_generated', { result: { kind: 'history_reference', action: input.action, bodySha256, resultId } });
    await audit.append(attemptId, 'succeeded', { delivery: 'not_yet_sent' }); terminal = true;
    const delivery = await prepareDelivery(audit, keys, identity, { requestId: attemptId, bodySha256, resultId, itemCount,
      kind: resultId ? 'result' : 'status' }, { httpStatus: 200 });
    const response = await prepareQueryJsonResponse(request, responseBody, delivery);
    if (recheck) await recheck();
    if ((await loadDataAuthority(client, identity, signal)).permissionRevision !== authority.permissionRevision) throw new Error('QUERY_DENIED');
    return response;
  } catch (error) {
    const denied = error instanceof Error && error.message === 'QUERY_DENIED';
    const changed = error instanceof Error && error.message === 'QUERY_RESULT_CHANGED';
    const expired = error instanceof Error && error.message === 'QUERY_HISTORY_REOPEN';
    if (audit) {
      try { await audit.append(attemptId, terminal ? 'correction' : denied ? 'denied' : 'failed', {
        delivery: 'not_sent', reason: denied ? 'history_not_granted' : changed ? 'history_changed' : expired ? 'history_context_expired' : 'history_unavailable' }); }
      catch { return json({ status: 'unavailable', error: '历史记录审计暂不可用，请稍后重试。' }, 503); }
    }
    return json({ status: denied ? 'denied' : changed || expired ? 'changed' : 'unavailable',
      error: denied ? '当前账号无法访问此工作记录，请重新核对权限。' : changed ? '历史记录状态已更新，请重新打开。'
        : expired ? '此历史列表已过期，请重新读取历史记录。'
          : '历史工作记录暂不可用，请稍后重试。原查询结果和审计快照不会因此被删除。' }, denied ? 403 : changed || expired ? 409 : 503);
  }
}
