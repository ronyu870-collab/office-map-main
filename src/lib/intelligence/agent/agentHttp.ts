import { createHash, randomUUID } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { IMPERSONATION_REQUEST_HEADER } from '@/src/lib/server/impersonationAuth';
import type { QueryAuthority } from '../query/admission';
import { createRpcAuditPort, type AuditKeys } from '../query/auditStore';
import { redactSubmittedCredentials } from '../query/auditCrypto';
import { readQueryBody } from '../query/httpBody';
import { recordQueryIntake } from '../query/intake';
import { isQuerySameOrigin } from '../query/sameOrigin';
import { prepareDelivery } from '../query/deliveryToken';
import { prepareQueryJsonResponse } from '../query/jsonResponse';
import { loadDataAuthority, verifyQueryIdentity, type VerifiedQueryIdentity } from '../query/serverAuthority';
import { queryConversationSchema } from '../query/conversationProtocol';
import { parseQueryPlan } from '../query/plan';
import { completeWithDeepSeek, ModelProviderError } from './modelProvider';
import { runAgentLoop, type AgentEvent } from './agentOrchestrator';
import { estimateAgentCostRange } from './agentCost';
import { queryVerifiedRealEstate } from './verifiedDataTool';
import { recordHistorySubmission } from '../query/historyStore';
import { REGISTERED_AGENT_TOOL_NAMES } from './toolRegistry';
import { AGENT_CONVERSATION_PROTOCOL, readAgentHistory, trimAgentHistory } from './agentConversation';

const inputSchema = z.strictObject({
  idempotencyKey: z.uuid(), question: z.string().min(1).max(6000).refine(s => !!s.trim()),
  conversation: queryConversationSchema,
});
type Dependencies = { client: SupabaseClient; keys: AuditKeys; enabled: boolean };
export type AgentStreamObserver = (event:
  | { type: 'run_started'; requestId: string }
  | { type: 'tool_started'; name: string }
  | { type: 'tool_completed'; name: string; status: 'ready' | 'limited' }
  | { type: 'message_delta'; delta: string }) => Promise<void>;
const secureHeaders = { 'Cache-Control': 'private, no-store',
  'X-Content-Type-Options': 'nosniff', Vary: 'Authorization, ' + IMPERSONATION_REQUEST_HEADER };
const json = (payload: unknown, status: number) => Response.json(payload, { status, headers: secureHeaders });

function scopedAgentId(identity: VerifiedQueryIdentity, idempotencyKey: string): string {
  const bytes = createHash('sha256').update('colliers-agent/1:' + identity.actorId + ':' + identity.effectiveUserId + ':' + idempotencyKey).digest().subarray(0, 16);
  bytes[6] = (bytes[6] & 15) | 128; bytes[8] = (bytes[8] & 63) | 128;
  const hex = bytes.toString('hex');
  return hex.slice(0, 8) + '-' + hex.slice(8, 12) + '-' + hex.slice(12, 16) + '-' + hex.slice(16, 20) + '-' + hex.slice(20);
}
function providerMessage(error: unknown): string {
  if (error instanceof ModelProviderError) {
    switch (error.code) {
      case 'not_configured': return 'DeepSeek 尚未配置，本轮未调用模型。';
      case 'unauthorized': return 'DeepSeek API 鉴权失败（401），请核对生产密钥。';
      case 'payment_required': return 'DeepSeek API 余额或付费状态异常（402），本轮未生成模型回复。';
      case 'model_not_found': return 'DeepSeek 当前模型不可用（404），请核对生产模型配置。';
      case 'rate_limited': return 'DeepSeek 请求过于频繁（429），请稍后重试。';
      case 'timeout': return 'DeepSeek 连接超时，本轮未完成。';
      case 'invalid_configuration': return 'DeepSeek 生产接口配置无效，请联系管理员核对。';
      case 'invalid_response': return 'DeepSeek 返回不符合响应协议，本轮未完成。';
      default: return 'DeepSeek 服务暂时不可用，本轮未生成模型回复。';
    }
  }
  if (error instanceof Error && error.message === 'AGENT_CONTEXT_UNAVAILABLE') return '之前的对话已过期或权限已变化，请开始新对话。';
  if (error instanceof Error && error.message === 'AGENT_RESUME_NOT_SUPPORTED') return '旧会话暂不能以 Agent 模式直接续接，请开始新对话。';
  if (error instanceof Error && error.message === 'AGENT_TOKEN_BUDGET_EXCEEDED') return '本轮研究超过模型 token 安全预算，未执行后续工具或生成新的结论。';
  if (error instanceof Error && error.message === 'AGENT_TOOL_BUDGET_EXCEEDED') return '本次研究超过安全工具执行上限，未将部分过程误报为完成。';
  if (error instanceof Error && error.message === 'QUERY_DENIED') return '查询权限已变化或当前没有该数据的访问资格。';
  return '本次 AI 执行未完成，请查看执行状态或重新发起请求。';
}

/** Agent-specific authenticated route, preserving existing formal results, sources
 * and DB RLS. LLM requests are suggestions; the service remains the authority. */
export async function handleAgentSubmission(request: Request, dependencies: Dependencies,
  observer?: AgentStreamObserver): Promise<Response> {
  const { client, keys } = dependencies;
  let requestId: string = randomUUID();
  let audit: ReturnType<typeof createRpcAuditPort> | undefined;
  let received = false, completed = false;
  try {
    const body = await readQueryBody(request, keys.digestKey);
    let parsed: z.infer<typeof inputSchema> | undefined;
    if (body.text !== null) {
      try {
        const value = inputSchema.safeParse(JSON.parse(body.text));
        if (value.success) parsed = value.data;
      } catch { /* The attempted body is still durably accounted for. */ }
    }
    let identity: VerifiedQueryIdentity | undefined;
    const impersonationDenied = request.headers.has(IMPERSONATION_REQUEST_HEADER);
    if (!body.rejection) {
      const safeHeaders = new Headers(request.headers);
      safeHeaders.delete(IMPERSONATION_REQUEST_HEADER);
      try { identity = await verifyQueryIdentity(new Request(request.url, { headers: safeHeaders }), client); }
      catch { /* Never invent an actor for an invalid token. */ }
    }
    if (identity && parsed) requestId = scopedAgentId(identity, parsed.idempotencyKey);
    await recordQueryIntake(client, keys, { requestId, body, identity, entry: 'query_submission', impersonationDenied });
    if (body.rejection) return json({ status: 'rejected', requestId,
      error: '提交内容过长或中断，未执行 AI 请求。' }, body.rejection === 'body_too_large' ? 413 : 400);
    if (!identity) return json({ status: 'denied', requestId, error: '登录状态无效，请重新登录。' }, 401);
    if (!parsed || !dependencies.enabled || impersonationDenied
      || !/^application\/json(?:\s*;|$)/i.test(request.headers.get('content-type') ?? '')
      || !isQuerySameOrigin(request)) return json({ status: 'denied', requestId,
        error: '请求不满足当前 AI 资格或输入协议。' }, 403);
    const valid = parsed, actor = identity;
    const signal = AbortSignal.any([request.signal, AbortSignal.timeout(54000)]);
    const fresh = async () => {
      const authority = await loadDataAuthority(client, actor, signal);
      if (!authority.grants.includes('query:catalog')) throw new Error('QUERY_DENIED');
      return authority;
    };
    audit = createRpcAuditPort(client, actor, keys);
    const pending: QueryAuthority = { actorId: actor.actorId, effectiveUserId: actor.effectiveUserId,
      sessionActive: false, policyVersion: 'agent-admission/1:pending', permissionRevision: 'not_evaluated',
      grants: [], fields: [] };
    const receipt = await audit.receive({ requestId, submittedText: valid.question,
      plan: { resolution: 'server_agent/1' }, authority: pending,
      metadata: { protocol: AGENT_CONVERSATION_PROTOCOL, relation: 'initial_agent_submission',
        conversation: valid.conversation, idempotencyKey: valid.idempotencyKey } });
    received = true;
    if (receipt.replayed) {
      await fresh();
      return json({ requestId, status: 'already_received',
        error: '同一请求已记录。请勿重复提交；此请求不会再次调用 DeepSeek。' }, 202);
    }
    const authority = await fresh();
    await audit.append(requestId, 'running', { phase: 'agent_planning', provider: 'deepseek',
      permissionRevision: authority.permissionRevision, policyVersion: authority.policyVersion });
    const budget = await client.rpc('ai_query_model_budget', {
      p_actor: actor.actorId, p_effective: actor.effectiveUserId,
      p_session: actor.sessionId, p_request_id: requestId,
    }).abortSignal(signal);
    if (budget.error || budget.data?.allowed !== true) {
      const reason = budget.error ? 'budget_rpc_unavailable' : 'budget_rejected';
      await audit.append(requestId, 'failed', { stage: 'provider_admission', reason, delivery: 'not_sent' });
      completed = true;
      return json({ requestId, status: 'unavailable', error: budget.error
        ? 'DeepSeek 调用预算服务暂不可用，本轮没有调用模型。'
        : 'DeepSeek 调用预算校验未通过，本轮没有调用模型。' }, 503);
    }
    const history = await readAgentHistory(client, actor, keys, authority, valid.conversation, signal);
    await observer?.({ type: 'run_started', requestId });
    await audit.append(requestId, 'tool_started', { tool: 'deepseek_chat', provider: 'deepseek',
      operation: 'native_tool_calling', historyTurns: history.length });
    const agentStartedAt = Date.now();
    let completedModels = 0, reportedInput: number | null = 0, reportedOutput: number | null = 0;
    let reportedModel: string | null = null;
    const providerRequestIds: string[] = [];
    const onEvent = async (event: AgentEvent) => {
      if (event.type === 'model_finished') {
        completedModels++;
        reportedModel = event.model ?? reportedModel;
        if (event.providerRequestId) providerRequestIds.push(event.providerRequestId);
        reportedInput = reportedInput === null || event.inputTokens === null || event.inputTokens === undefined
          ? null : reportedInput + event.inputTokens;
        reportedOutput = reportedOutput === null || event.outputTokens === null || event.outputTokens === undefined
          ? null : reportedOutput + event.outputTokens;
      } else if (event.type === 'tool_started') {
        await audit!.append(requestId, 'tool_started', { tool: event.name,
          provider: 'trusted_query_engine', permissionRevision: authority.permissionRevision });
        if (event.name) await observer?.({ type: 'tool_started', name: event.name });
      } else if (event.type === 'tool_finished') {
        await audit!.append(requestId, 'tool_finished', {
          tool: event.name, status: event.status, reused: event.reused === true,
          provider: 'trusted_query_engine', permissionRevision: authority.permissionRevision });
        if (event.name) await observer?.({ type: 'tool_completed', name: event.name,
          status: event.status ?? 'limited' });
      }
    };
    let execution: Awaited<ReturnType<typeof runAgentLoop<import('../query/result').QueryResult>>>;
    try {
      execution = await runAgentLoop({
        question: redactSubmittedCredentials(valid.question).text,
        history,
        invoke: async (messages, currentSignal) => {
          if (!observer) return completeWithDeepSeek(messages, currentSignal);
          // Bound provisional updates; never make a DB authorization RPC for
          // every individual supplier token. Every visible batch must pass a
          // live permission-revision check before it reaches the browser.
          let pending = '', lastFlush = 0;
          const flush = async () => {
            while (pending.length) {
              const delta = pending.slice(0, 3500);
              pending = pending.slice(delta.length);
              const current = await fresh();
              if (current.permissionRevision !== authority.permissionRevision
                || current.policyVersion !== authority.policyVersion) throw new Error('QUERY_DENIED');
              await observer({ type: 'message_delta', delta });
              lastFlush = Date.now();
            }
          };
          const result = await completeWithDeepSeek(messages, currentSignal, async delta => {
            pending += delta;
            if (!lastFlush || pending.length >= 96 || Date.now() - lastFlush >= 250) await flush();
          });
          await flush();
          return result;
        },
        signal, onEvent,
        runTool: async (name, args) => {
          if (!REGISTERED_AGENT_TOOL_NAMES.has(name)) throw new Error('AGENT_UNREGISTERED_TOOL');
          const rechecked = await fresh();
          if (rechecked.permissionRevision !== authority.permissionRevision
            || rechecked.policyVersion !== authority.policyVersion) throw new Error('QUERY_DENIED');
          return queryVerifiedRealEstate({ client, keys, identity: actor, audit: audit!, requestId,
            authority, signal }, args.question);
        },
      });
    } catch (error) {
      await audit.append(requestId, 'accounting', { provider: 'deepseek', status: 'incomplete',
        modelCallsCompleted: completedModels, inputTokens: reportedInput, outputTokens: reportedOutput,
        providerRequestIds: providerRequestIds.slice(0, 6),
        cost: null, costStatus: 'planning_range_not_invoice',
        costEstimate: estimateAgentCostRange(reportedModel, reportedInput, reportedOutput),
        durationMs: Math.max(0, Date.now() - agentStartedAt) });
      throw error;
    }
    await audit.append(requestId, 'accounting', { provider: 'deepseek', status: 'completed',
      model: execution.model, modelCalls: execution.calls, toolCalls: execution.toolCalls,
      providerRequestIds: providerRequestIds.slice(0, 6), toolNames: execution.toolNames,
      inputTokens: execution.inputTokens, outputTokens: execution.outputTokens,
      cost: null, costStatus: 'planning_range_not_invoice',
      costEstimate: estimateAgentCostRange(execution.model, execution.inputTokens, execution.outputTokens),
      durationMs: Math.max(0, Date.now() - agentStartedAt) });
    const current = await fresh();
    if (current.permissionRevision !== authority.permissionRevision
      || current.policyVersion !== authority.policyVersion) throw new Error('QUERY_DENIED');
    const answerPlan = execution.result ? parseQueryPlan(execution.result.parameters.executedPlan) : null;
    await audit.append(requestId, 'tool_finished', {
      protocol: 'agent-answer/1', provider: 'deepseek', model: execution.model,
      permissionRevision: authority.permissionRevision,
      history: trimAgentHistory(history, valid.question, execution.answer),
      ...(answerPlan ? { plan: answerPlan, resolution: { protocol: 'research-conversation/1' } } : {}),
      status: 'answer_prepared',
    });
    await audit.append(requestId, 'response_generated', { result: execution.result ?? {
      version: 'agent-message/1', text: execution.answer, model: execution.model,
    } });
    await audit.append(requestId, 'succeeded', { delivery: 'not_yet_sent',
      provider: 'deepseek', model: execution.model, toolCalls: execution.toolCalls });
    completed = true;
    // History indexing is optional until the owner-only RPC is deployed.
    const historySaved = await recordHistorySubmission(client, keys, actor, valid.conversation.id, requestId);
    const responseBody = { requestId, status: execution.result ? 'ready' : 'assistant',
      message: execution.answer, ...(execution.result ? { result: execution.result } : {}),
      conversation: valid.conversation, historySaved,
      agent: { model: execution.model, modelCalls: execution.calls,
        toolCalls: execution.toolCalls, inputTokens: execution.inputTokens,
        outputTokens: execution.outputTokens } };
    const deliveryHeaders = await prepareDelivery(audit, keys, actor, {
      requestId, kind: execution.result ? 'result' : 'status',
      resultId: execution.result?.resultId ?? null,
      itemCount: execution.result?.table.rows.length ?? 0,
      bodySha256: createHash('sha256').update(JSON.stringify(responseBody)).digest('hex'),
    }, { httpStatus: 200, provider: 'deepseek' });
    const response = await prepareQueryJsonResponse(request, responseBody, deliveryHeaders);
    const finalAuthority = await fresh();
    if (finalAuthority.permissionRevision !== authority.permissionRevision
      || finalAuthority.policyVersion !== authority.policyVersion) {
      await audit.append(requestId, 'correction', { reason: 'authorization_changed_before_response',
        delivery: 'not_sent' });
      return json({ status: 'denied', requestId, error: '查询权限已变化，结果未交付。' }, 403);
    }
    return response;
  } catch (error) {
    if (audit && received && !completed) {
      const cancelled = request.signal.aborted;
      const reason = error instanceof Error ? error.message : 'AGENT_UNKNOWN_ERROR';
      const denied = reason === 'QUERY_DENIED';
      try { await audit.append(requestId, cancelled ? 'cancelled' : denied ? 'denied' : 'failed',
        { stage: 'agent_execution', reason: error instanceof ModelProviderError ? error.code
          : denied ? 'authorization_revoked' : 'agent_execution_failed', delivery: 'not_sent' }); }
      catch { /* Audit persistence unavailable: never deliver a successful result. */ }
    }
    if (request.signal.aborted) return json({ requestId, status: 'cancelled',
      error: '浏览器已中断请求，不能确认服务端是否完全停止。' }, 409);
    return json({ requestId, status: error instanceof Error && error.message === 'QUERY_DENIED' ? 'denied' : 'unavailable',
      error: providerMessage(error) },
      error instanceof Error && error.message === 'QUERY_DENIED' ? 403 : 503);
  }
}

