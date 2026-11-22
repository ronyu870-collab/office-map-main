import { KNOWLEDGE_TOOL_NAMES, isKnowledgeResult, type KnowledgeToolName } from '../knowledge/protocol';
import { queryKnowledge, knowledgeModelObservation, recheckKnowledgeResults } from '../knowledge/research';
import { publicSearchConfigured } from '../knowledge/publicSearch';
import { RESEARCH_TOOL_NAMES } from '../research/protocol';
import { ResearchExecution } from '../research/execution';
import { isResearchResult, researchObservation, researchSections, reviewIssueText } from '../research/workspace';
import { recheckResearchResult } from '../research/authorization';
import { generateResearchDeliverable } from '../research/deliverable';
import { artifactFulfillment, artifactLabels } from './artifactFulfillment';
import { BUSINESS_TOOL_NAMES, isBusinessResult, type BusinessToolName } from '../business/protocol';
import { queryBusinessResearch, businessModelObservation, recheckBusinessResults, businessCapabilities } from '../business/research';
import { isLeaseResult } from '../lease/protocol';
import { queryLeaseResearch, leaseModelObservation } from '../lease/tool';
import { recheckLeaseResult, recheckLeaseResults } from '../lease/research';
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
import { readOwnResult, recoverOwnResult } from '../query/recovery';
import { buildResultArtifact } from '../query/artifacts';
import { chartRequestSchema, type ChartRequest } from '../query/chartSpec';
import { agentChartDescriptorSchema } from '../query/chartProtocol';
import { generateAuthorizedReport } from './reportTool';
import { readReportHistory } from './reportHistory';
import { exportAuthorizedTable } from './exportTableTool';
import type { QueryResult } from '../query/result';
import { estimateAgentCostRange } from './agentCost';
import { createModelRuntime, modelModeSchema } from './modelRuntime';
import { nextAgentMemory } from './agentMemory';
import { queryVerifiedRealEstate, executeStructuredDataTool } from './verifiedDataTool';
import { queryCapabilityManifest } from '../query/capabilityManifest';
import { recordHistorySubmission } from '../query/historyStore';
import { REGISTERED_AGENT_TOOL_NAMES, STRUCTURED_DATA_TOOL_NAMES, WORKSET_TOOL_NAMES, type StructuredDataToolName } from './toolRegistry';
import { AuthorizedResultWorkset, type WorksetOwner } from './resultWorkset';
import { PRESENTATION_TOOL_NAMES, runResultPresentationTool } from './resultTools';
import { AGENT_CONVERSATION_PROTOCOL, readAgentHistory, trimAgentHistory } from './agentConversation';
import { selectedAnswerResult, type AnswerSelection } from '../query/answerSelection';
import { answerTask, applyAnswerPolicy, hasExplicitLeaseWindow, isLatestLeaseQuestion } from './answerPolicy';

const inputSchema = z.strictObject({
  idempotencyKey: z.uuid(), question: z.string().min(1).max(6000).refine(s => !!s.trim()),
  conversation: queryConversationSchema, mode: modelModeSchema.optional(),
});
type Dependencies = { client: SupabaseClient; keys: AuditKeys; enabled: boolean; invokeModel?: typeof completeWithDeepSeek };
export type AgentStreamObserver = (event:
  | { type: 'run_started'; requestId: string }
  | { type: 'phase_changed'; phase: import('./agentOrchestrator').AgentPhase; tools?: string[] }
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
      case 'budget_exceeded': return '本轮模型调用已达到 token 或费用估算预算，未继续调用供应商。';
      case 'disclosure_denied': return '当前账号未获准向该模型供应商披露请求，未调用供应商。';
      case 'stream_interrupted': return '模型供应商流式连接中断，未取得完整回复。';
      case 'not_configured': return '模型供应商尚未配置，本轮未调用模型。';
      case 'unauthorized': return '模型供应商 API 鉴权或访问资格失败（401／403），请核对生产密钥。';
      case 'payment_required': return '模型供应商 API 余额或付费状态异常（402），本轮未生成模型回复。';
      case 'model_not_found': return '模型供应商当前模型不可用（404），请核对生产模型配置。';
      case 'rate_limited': return '模型供应商请求过于频繁（429），请稍后重试。';
      case 'timeout': return '模型供应商连接超时，本轮未完成。';
      case 'invalid_configuration': return '模型供应商生产接口配置无效，请联系管理员核对。';
      case 'invalid_response': return '模型供应商返回不符合响应协议，本轮未完成。';
      default: return '模型供应商服务暂时不可用，本轮未生成模型回复。';
    }
  }
  if (error instanceof Error && error.message === 'REPORT_HISTORY_RESULT_LIMIT') return '当前对话的历史正式结果超过 8 个，本轮未生成 PDF；请开始新对话并按所需范围查询后组合，不会截断结果。';
  if (error instanceof Error && error.message === 'REPORT_HISTORY_CYCLE') return '历史引用无效，本轮未生成 PDF，请开始新对话。';
  if (error instanceof Error && error.message === 'AGENT_CONTEXT_UNAVAILABLE') return '之前的对话已过期或权限已变化，请开始新对话。';
  if (error instanceof Error && error.message === 'AGENT_RESUME_NOT_SUPPORTED') return '旧会话暂不能以 Agent 模式直接续接，请开始新对话。';
  if (error instanceof Error && error.message === 'AGENT_TOKEN_BUDGET_EXCEEDED') return '本轮研究超过模型 token 安全预算，未执行后续工具或生成新的结论。';
  if (error instanceof Error && error.message === 'AGENT_TOOL_BUDGET_EXCEEDED') return '本次研究超过安全工具执行上限，未将部分过程误报为完成。';
  if (error instanceof Error && error.message === 'AGENT_TOOL_RECOVERY_EXHAUSTED') return '工具连续失败或参数无效，已达到受控修正上限，本轮未将失败任务认定为完成。';
  if (error instanceof Error && error.message === 'AGENT_WORKSET_LIMIT') return '本轮已达到可信结果工作集容量上限，请缩小任务范围后重新查询。';
  if (error instanceof Error && error.message === 'AGENT_TOOL_RESULT_TOO_LARGE') return '工具返回内容超过安全上限，须使用分页或缩小范围。';
  if (error instanceof Error && error.message === 'LEASE_SNAPSHOT_LIMIT') return '获权成交数据池超过 20000 条，本轮未交付部分数据；请由授权维护者缩小正式研究授权范围后重试。';
  if (error instanceof Error && error.message === 'QUERY_READ_UNAVAILABLE') return '授权数据源读取失败，本轮未能取得可核验的正式结果。';
  if (error instanceof Error && error.message === 'QUERY_AUTHORITY_UNAVAILABLE') return '权限复核服务暂不可用，已停止查询与结果交付。';
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
  let checkpointPreserved = false;
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
        error: '同一请求已记录。请勿重复提交；此请求不会再次调用模型供应商。' }, 202);
    }
    const authority = await fresh();
    const worksetOwner: WorksetOwner = { requestId, actorId: actor.actorId,
      effectiveUserId: actor.effectiveUserId, sessionId: actor.sessionId,
      permissionRevision: authority.permissionRevision, policyVersion: authority.policyVersion };
    const workset = new AuthorizedResultWorkset(worksetOwner);
    await audit.append(requestId, 'running', { phase: 'agent_planning', provider: 'server_policy',
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
        ? '模型供应商调用预算服务暂不可用，本轮没有调用模型。'
        : '模型供应商调用预算校验未通过，本轮没有调用模型。' }, 503);
    }
    const history = await readAgentHistory(client, actor, keys, authority, valid.conversation, signal);
    const research = new ResearchExecution(history.contextResult && isResearchResult(history.contextResult) ? history.contextResult : undefined);
    let researchTouched = false;
    const reportHistory = /PDF/i.test(valid.question) && !research.task && authority.grants.includes('export:internal')
      ? await readReportHistory(client, actor, keys, authority, valid.conversation, signal) : undefined;
    for (const result of reportHistory?.results ?? []) workset.register(result, worksetOwner);
    for (const result of history.contextResults ?? [])
      if (!reportHistory?.results.some(item => item.resultId === result.resultId)) workset.register(result, worksetOwner);
    if (research.task) for (const section of researchSections(history.contextResult!)) workset.register(section.result, worksetOwner);
    if (history.contextResult && !isResearchResult(history.contextResult) && !reportHistory?.results.some(r => r.resultId === history.contextResult!.resultId))
      workset.register(history.contextResult, worksetOwner);
    if (reportHistory) {
      const priorCheck = history.contextRecheck;
      history.contextRecheck = async () => { await priorCheck?.(); await reportHistory.recheck(); };
    }
    await observer?.({ type: 'run_started', requestId });
    await audit.append(requestId, 'tool_started', { tool: 'model_agent', provider: 'server_policy',
      operation: 'native_tool_calling', historyTurns: history.length });
    const agentStartedAt = Date.now();
    let completedModels = 0, reportedInput: number | null = 0, reportedOutput: number | null = 0;
    let reportedModel: string | null = null;
    const providerRequestIds: string[] = [];
    const toolTrace: Array<{ name: string; status: 'ready' | 'limited'; reused: boolean;
      durationMs: number | null; errorCode?: string }> = [];
    const onEvent = async (event: AgentEvent) => {
      if (event.type === 'model_finished') {
        completedModels++;
        reportedModel = event.model ?? reportedModel;
        if (event.providerRequestId) providerRequestIds.push(event.providerRequestId);
        reportedInput = reportedInput === null || event.inputTokens === null || event.inputTokens === undefined
          ? null : reportedInput + event.inputTokens;
        reportedOutput = reportedOutput === null || event.outputTokens === null || event.outputTokens === undefined
          ? null : reportedOutput + event.outputTokens;
      } else if (event.type === 'phase_changed') {
        if (event.phase) await observer?.({ type: 'phase_changed', phase: event.phase,
          ...(event.tools ? { tools: event.tools } : {}) });
      } else if (event.type === 'tool_started') {
        if (event.name) await observer?.({ type: 'tool_started', name: event.name });
      } else if (event.type === 'tool_finished') {
        if (event.name) toolTrace.push({ name: event.name, status: event.status ?? 'limited',
          reused: event.reused === true, durationMs: event.durationMs ?? null,
          ...(event.errorCode ? { errorCode: event.errorCode } : {}) });
        if (event.name) await observer?.({ type: 'tool_completed', name: event.name,
          status: event.status ?? 'limited' });
      }
    };
    // All results live only in this authenticated request, never in process globals.
    // A revocation invalidates every reference, including cached/deduplicated reads.
    const knowledgeResults=new Map<string,QueryResult>();
    const imported = research.task ? research.results : history.contextResults ?? (history.contextResult ? [history.contextResult] : []);
    for (const r of imported) if(r.parameters.knowledgeBindings || r.parameters.publicBindings) knowledgeResults.set(r.resultId,r);
    const businessResults = new Map<string,QueryResult>();
    for (const r of imported) if(r.parameters.businessBindings) businessResults.set(r.resultId,r);
    const leaseResults = new Map<string, QueryResult>();
    for (const r of imported) if(r.parameters.leaseBindings) leaseResults.set(r.resultId,r);
    const recheckLeases = async (exporting = false) => {
      await recheckKnowledgeResults(client,actor,signal,[...knowledgeResults.values()],exporting);
      await recheckLeaseResults(client, actor, signal, [...leaseResults.values()], exporting);
      await recheckBusinessResults(client,actor,signal,[...businessResults.values()],exporting);
    };
    const revalidateModel = async (currentSignal: AbortSignal) => {
      await history.contextRecheck?.(); await recheckLeases();
      const current = await loadDataAuthority(client, actor, currentSignal);
      if (!current.grants.includes('query:catalog') || current.permissionRevision !== authority.permissionRevision
        || current.policyVersion !== authority.policyVersion) throw new Error('QUERY_DENIED');
    };
    const runtime = createModelRuntime({ actorId: actor.actorId, question: valid.question, mode: valid.mode ?? (research.task ? 'deep' : undefined),
      hasChartContext: !!history.contextChart,
      contextDomains: [...(leaseResults.size ? ['lease' as const] : []), ...(businessResults.size ? ['business' as const] : []),
        ...(knowledgeResults.size ? ['knowledge' as const] : [])],
      legacyInvoke: dependencies.invokeModel ?? completeWithDeepSeek, revalidate: revalidateModel,
      onAttempt: async attempt => { await audit!.append(requestId, 'accounting', attempt); } });
    let preparedMap: QueryResult | undefined;
    let preparedExport: QueryResult | undefined;
    let preparedReport: QueryResult | undefined;
    let reportFile: Record<string, unknown> | undefined;
    let preparedChart: QueryResult | undefined;
    let chartFile: Record<string, unknown> | undefined;
    let preparedResearch: QueryResult | undefined;
    let researchFiles: unknown;
    const exportFiles: Array<Record<string, unknown>> = [];
    let selectedAnswer: AnswerSelection | undefined;
    const queriedIds = new Set<string>();
    // History is eligible evidence, not an automatic answer. Only a data
    // task or an actual workset/chart read makes it participate now.
    const comparisonRequested = /(?:比较|对比|相比|环比|同比|差异|变化|涨跌|compare|versus|\bvs\b)/i.test(valid.question)
      && !/(?:解释|说明|介绍).*(?:方法|口径|含义|定义|规则)|(?:如何|怎么).*(?:比较|对比|计算)/.test(valid.question);
    const historicalDataRequested = comparisonRequested
      || /(?:查|展示|显示|分析|总结|概括|继续).*(?:数据|统计|结果|季度|租金|成交|排名|趋势)/.test(valid.question)
        && !/(?:解释|说明|介绍).*(?:方法|口径|含义|定义|规则)/.test(valid.question);
    const referencedIds = new Set<string>(historicalDataRequested ? workset.manifest(worksetOwner).map(item => item.resultId) : []);
    const needsSelection = () => new Set([...queriedIds, ...referencedIds]).size > 1
      && (!selectedAnswer || comparisonRequested && !selectedAnswer.results.some(item => item.role === 'comparison'));

    let execution: Awaited<ReturnType<typeof runAgentLoop<import('../query/result').QueryResult>>>;
    try {
      execution = await runAgentLoop({
        question: redactSubmittedCredentials(valid.question).text,
        history, memory: history.memory, limits: runtime.limits,
        contextPlan: history.contextPlan,
        contextExport: history.contextExport,
        contextChart: history.contextChart,
        ...(history.contextResults?.length ? { answerResults: workset.manifest(worksetOwner) } : {}),
        ...(research.task ? { researchContext: researchObservation(research.checkpoint()!) } : {}),
        ...(history.contextResult && (isBusinessResult(history.contextResult)||isKnowledgeResult(history.contextResult)) ? { businessResults:workset.manifest(worksetOwner) } : {}),
        ...(history.contextResult && isLeaseResult(history.contextResult) ? { leaseResults: workset.manifest(worksetOwner) } : {}),
        ...(reportHistory ? { reportResults: workset.manifest(worksetOwner), reportHistoryLimited: reportHistory.limited } : {}),
        needsAnswerSelection: () => needsSelection() && !preparedExport && !preparedReport && !research.task,
        revalidate: async currentSignal => {
          await history.contextRecheck?.();
          await recheckLeases();
          const rechecked = await loadDataAuthority(client, actor, currentSignal);
          if (!rechecked.grants.includes('query:catalog')
            || rechecked.permissionRevision !== authority.permissionRevision
            || rechecked.policyVersion !== authority.policyVersion) throw new Error('QUERY_DENIED');
        },
        invoke: async (messages, currentSignal) => {
          if (!observer) return runtime.invoke(messages, currentSignal);
          // Bound provisional updates; never make a DB authorization RPC for
          // every individual supplier token. Every visible batch must pass a
          // live permission-revision check before it reaches the browser.
          let pending = '';
          const flush = async () => {
            while (pending.length) {
              const delta = pending.slice(0, 3500);
              pending = pending.slice(delta.length);
              const current = await fresh();
              if (current.permissionRevision !== authority.permissionRevision
                || current.policyVersion !== authority.policyVersion) throw new Error('QUERY_DENIED');
              await observer({ type: 'message_delta', delta });
            }
          };
          // Provisional model tokens may include unfinished tool calls. Never
          // send those to the UI as if they were a verified final answer.
          const result = await runtime.invoke(messages, currentSignal, async delta => {
            pending += delta;
            if (pending.length > 12000) throw new Error('AGENT_STREAM_EVENT_TOO_LARGE');
          });
          // File delivery state comes from the server, never model prose.
          if (!/^(?:你好|您好|嗨|哈[喽啰]|hello|hi|谢谢|多谢|感谢|thanks|thank you)[！!。.?？\s]*$/i.test(valid.question.trim())
            && !(result.message.calls?.length) && !referencedIds.size && !queriedIds.size && !leaseResults.size && !knowledgeResults.size && !preparedExport
            && !preparedChart && !preparedReport && !research.task && !/(?:导出|下载|Excel|CSV|xlsx|PNG|SVG|PDF|Word|PPT|报告|图)/i.test(valid.question)) await flush();
          return result;
        },
        signal, onEvent,
        runTool: async function runTool(name, args): Promise<import('./agentOrchestrator').AgentToolObservation<QueryResult>> {
          if (!REGISTERED_AGENT_TOOL_NAMES.has(name)) throw new Error('AGENT_UNREGISTERED_TOOL');
          const toolSignal = AbortSignal.any([signal, AbortSignal.timeout(20000)]);
          const rechecked = await loadDataAuthority(client, actor, toolSignal);
          if (!rechecked.grants.includes('query:catalog')
            || rechecked.permissionRevision !== authority.permissionRevision
            || rechecked.policyVersion !== authority.policyVersion) throw new Error('QUERY_DENIED');
          await recheckLeases();
          if (name === 'select_answer_results') {
            selectedAnswer = workset.select(args, worksetOwner);
            return { content: JSON.stringify({ status: 'ready', primaryResultId: selectedAnswer.primaryResultId,
              task: selectedAnswer.task, answerStatus: selectedAnswer.status,
              references: selectedAnswer.results.map(item => ({ role: item.role, resultId: item.result.resultId })) }),
              result: workset.read(selectedAnswer.primaryResultId, worksetOwner) };
          }
          if (RESEARCH_TOOL_NAMES.has(name)) {
            researchTouched = true;
            if (name === 'plan_research_task') return research.plan(args);
            if (name === 'advance_research_task') {
              try { return await research.advance(args, async (tool, input) => {
                const observed = await runTool(tool, input);
                await audit!.append(requestId, 'tool_finished', { protocol: 'research-step/1', taskId: research.task!.id,
                  tool, resultId: observed.result?.resultId ?? null, status: observed.result ? 'complete' : 'blocked' });
                return observed;
              }, toolSignal); }
              catch (error) {
                if (signal.aborted || error instanceof Error && error.message === 'QUERY_DENIED') throw error;
                const observed = research.observation();
                return { ...observed, content: JSON.stringify({ ...JSON.parse(observed.content), status: 'limited',
                  reason: '部分来源步骤未完成；可按最新游标重试或明确报告限制，不能编造结果。' }) };
              }
            }
            if (name === 'review_research_task') return research.review(args);
            const checkpoint = research.checkpoint();
            if (!checkpoint) throw new Error('RESEARCH_TASK_NOT_FOUND');
            await recheckResearchResult(client, actor, toolSignal, requestId, checkpoint, authority.permissionRevision, { exporting: true });
            const file = await generateResearchDeliverable(checkpoint, args, requestId);
            await recheckResearchResult(client, actor, toolSignal, requestId, file.result, authority.permissionRevision, { exporting: true });
            preparedResearch = file.result;
            researchFiles = JSON.parse(file.content).files;
            return file;
          }
          if(KNOWLEDGE_TOOL_NAMES.has(name)) {
            const observed=await queryKnowledge(client,actor,toolSignal,name as KnowledgeToolName,args);
            knowledgeResults.set(observed.result.resultId,observed.result);workset.register(observed.result,worksetOwner);queriedIds.add(observed.result.resultId);
            return observed;
          }
          if(BUSINESS_TOOL_NAMES.has(name)) {
            const observed=await queryBusinessResearch(client,actor,toolSignal,name as BusinessToolName,args);
            businessResults.set(observed.result.resultId,observed.result);queriedIds.add(observed.result.resultId);
            const manifest=workset.register(observed.result,worksetOwner);
            return {...observed,content:JSON.stringify({...JSON.parse(observed.content),workset:manifest})};
          }
          if (name === 'query_lease_transactions') {
            const observed = await queryLeaseResearch(client, actor, toolSignal, args);
            if (!observed.result) return observed;
            leaseResults.set(observed.result.resultId, observed.result);queriedIds.add(observed.result.resultId);
            const manifest = workset.register(observed.result, worksetOwner);
            return { ...observed, content: JSON.stringify({ ...JSON.parse(observed.content), workset: manifest }) };
          }
          if (name === 'get_data_capabilities') {
            return { content: JSON.stringify({ status: 'ready', authority: queryCapabilityManifest(rechecked), business:await businessCapabilities(client,actor,toolSignal),knowledge:{privateTextSentToModel:false,requiresDocumentGrant:true,publicSearchConfigured:publicSearchConfigured()} }) };
          }
          if (PRESENTATION_TOOL_NAMES.has(name)) {
            toolSignal.throwIfAborted();
            const id = typeof args.resultId === 'string' ? args.resultId : workset.latestId();
            let chosen = id ? workset.read(id, worksetOwner) : undefined;
            if (chosen) referencedIds.add(chosen.resultId);
            if (chosen && preparedChart?.resultId === chosen.resultId) chosen = preparedChart;
            if(chosen && isKnowledgeResult(chosen)) return {content:JSON.stringify(knowledgeModelObservation(chosen))};
            if (name === 'export_chart') {
              if (!chosen) throw new Error('AGENT_RESULT_NOT_FOUND');
              if (!rechecked.grants.includes('export:internal')) throw new Error('AGENT_EXPORT_DENIED');
              const prior = agentChartDescriptorSchema.safeParse(chosen.parameters.agentChart).data;
              const chart = chartRequestSchema.parse(args.chart ?? prior?.request);
              const format = args.format as 'png_zip' | 'svg_zip';
              const next: QueryResult = { ...chosen, parameters: { ...chosen.parameters,
                agentChart: { version: 'chart-workspace/1', request: chart, format } } };
              await recheckBusinessResults(client,actor,toolSignal,[next],true);
              if (isLeaseResult(next)) await recheckLeaseResult(client, actor, toolSignal, next, true);
              const file = await buildResultArtifact(next, { requestId, resultId: next.resultId, action: 'export', format, chart });
              if (file.type !== 'download') throw new Error('AGENT_EXPORT_NOT_GENERATED');
              await history.contextRecheck?.();
              const current = await fresh();
              if (!current.grants.includes('export:internal') || current.permissionRevision !== authority.permissionRevision) throw new Error('QUERY_DENIED');
              await recheckLeases(true);
              preparedChart = next;
              chartFile = { status: 'ready', state: 'server_generated', format, filename: file.filename, bytes: file.bytes.length, sha256: file.sha256 };
              return { content: JSON.stringify({ ...chartFile, resultId: next.resultId, note: '服务器已生成真实图片及来源包；回答提供下载操作，尚未发起浏览器下载，不能声称本机已保存。' }), result: next };
            }
            // Selected snapshots are archived in full. Map actions can now
            // refer to an earlier selected result without changing its role.
            const presentation = runResultPresentationTool(name as Parameters<typeof runResultPresentationTool>[0],
              requestId, chosen, args as { chart?: ChartRequest });
            if(name==='prepare_map_selection' && presentation.result) preparedMap=presentation.result;
            if (['prepare_chart', 'create_chart', 'modify_chart'].includes(name) && presentation.result) {
              preparedChart = presentation.result; chartFile = undefined;
              if(isBusinessResult(presentation.result)) return {...presentation,content:JSON.stringify(businessModelObservation(presentation.result))};
              if (isLeaseResult(presentation.result)) return { ...presentation, content: JSON.stringify(leaseModelObservation(presentation.result)) };
              return presentation;
            }
            // Source/chart of an earlier result must not change which formal
            // QueryResult is archived as this request's final result.
            if(chosen && isBusinessResult(chosen) && name!=='prepare_map_selection') return {content:JSON.stringify(businessModelObservation(chosen))};
            if (chosen && isLeaseResult(chosen)) return { content: JSON.stringify(leaseModelObservation(chosen)) };
            return id === workset.latestId() ? presentation : { content: presentation.content };
          }
          if (name === 'generate_pdf_report') {
            if((args.resultIds as string[]).some(id=>isKnowledgeResult(workset.read(id,worksetOwner))))throw new Error('AGENT_EXPORT_DENIED');
            if ((args.resultIds as string[]).some(id => isBusinessResult(workset.read(id,worksetOwner)))) throw new Error('BUSINESS_PDF_UNSUPPORTED');
            if ((args.resultIds as string[]).some(id => isLeaseResult(workset.read(id, worksetOwner)))) throw new Error('LEASE_PDF_UNSUPPORTED');
            const report = await generateAuthorizedReport(workset, worksetOwner, args, rechecked.grants, preparedChart);
            await history.contextRecheck?.();
            const current = await fresh();
            if (!current.grants.includes('export:internal') || current.permissionRevision !== authority.permissionRevision
              || current.policyVersion !== authority.policyVersion) throw new Error('QUERY_DENIED');
            preparedReport = report.result; reportFile = JSON.parse(report.content);
            return report;
          }
          if (name === 'export_table') {
            if((args.resultIds as string[]).some(id=>isKnowledgeResult(workset.read(id,worksetOwner))))throw new Error('AGENT_EXPORT_DENIED');
            for (const id of args.resultIds as string[]) {
              const result = workset.read(id, worksetOwner);
              await recheckBusinessResults(client,actor,toolSignal,[result],true);
              if (isLeaseResult(result)) await recheckLeaseResult(client, actor, toolSignal, result, true);
            }
            const exported = await exportAuthorizedTable(workset, worksetOwner, args, rechecked.grants);
            // Derived export is archived as the terminal result. Do not duplicate
            // its rows into the bounded query workset or evict earlier queries.
            preparedExport = exported.result;
            await recheckLeases(true);
            exportFiles.push(JSON.parse(exported.content) as Record<string, unknown>);
            const current = await loadDataAuthority(client, actor, toolSignal);
            if (!current.grants.includes('export:internal')
              || current.permissionRevision !== authority.permissionRevision
              || current.policyVersion !== authority.policyVersion) throw new Error('QUERY_DENIED');
            return exported;
          }
          if (WORKSET_TOOL_NAMES.has(name)) {
            const ids = name === 'compare_result_sets' ? args.resultIds as string[] : [args.resultId as string];
            for (const id of ids) { workset.read(id, worksetOwner); referencedIds.add(id); }
            const knowledge=ids.map(id=>workset.read(id,worksetOwner)).filter(isKnowledgeResult);
            if(knowledge.length)return {content:JSON.stringify({status:'ready',results:knowledge.map(knowledgeModelObservation)})};
            const businesses=ids.map(id=>workset.read(id,worksetOwner)).filter(isBusinessResult);
            if(businesses.length) return {content:JSON.stringify({status:'ready',results:businesses.map(businessModelObservation)})};
            const leases = ids.map(id => workset.read(id, worksetOwner)).filter(isLeaseResult);
            if (leases.length) return { content: JSON.stringify({ status: 'ready', results: leases.map(leaseModelObservation) }) };
            const id = args.resultId as string;
            const payload = name === 'summarize_result' ? workset.summary(id, worksetOwner)
              : name === 'check_data_coverage' ? workset.coverage(id, worksetOwner)
              : name === 'compare_result_sets' ? workset.compare(args.resultIds as string[], worksetOwner)
              : workset.page({ resultId: id, offset: args.offset as number,
                limit: args.limit as number,
                ...(args.sort ? { sort: args.sort as { field: string; direction: 'asc' | 'desc' } } : {}),
                ...(args.filter ? { filter: args.filter as { field: string;
                  operator: 'eq' | 'contains' | 'gte' | 'lte'; value: string | number } } : {}) }, worksetOwner);
            return { content: JSON.stringify(payload) };
          }
          let observation: Awaited<ReturnType<typeof queryVerifiedRealEstate>>;
          if (typeof args.question === 'string') {
            if (/(?:成交|租赁交易|lease.transaction)/i.test(args.question)) throw new Error('LEASE_TOOL_REQUIRED');
            // Bounded migration for previous native Tool Calling clients.
            observation = await queryVerifiedRealEstate({ client, keys, identity: actor, audit: audit!,
              requestId, authority, signal: toolSignal }, args.question);
          } else if (STRUCTURED_DATA_TOOL_NAMES.has(name)) {
            observation = await executeStructuredDataTool({ client, keys, identity: actor, audit: audit!,
              requestId, authority, signal: toolSignal }, name as StructuredDataToolName, args);
          } else throw new Error('AGENT_UNREGISTERED_TOOL');
          if (observation.result) {
            queriedIds.add(observation.result.resultId);
            const manifest = workset.register(observation.result, worksetOwner);
            const original = JSON.parse(observation.content) as Record<string, unknown>;
            observation = { ...observation, content: JSON.stringify({ ...original,
              resultId: manifest.resultId, workset: manifest }) };
          }
          return observation;
        },
      });
    } catch (error) {
      await audit.append(requestId, 'accounting', { provider: 'server_policy', operations: runtime.summary(), status: 'incomplete', toolTrace,
        modelCallsCompleted: completedModels, inputTokens: reportedInput, outputTokens: reportedOutput,
        providerRequestIds: providerRequestIds.slice(0, 6),
        cost: null, costStatus: 'planning_range_not_invoice',
        costEstimate: runtime.summary().providers.every(p => p === 'deepseek') ? estimateAgentCostRange(reportedModel, reportedInput, reportedOutput) : null,
        durationMs: Math.max(0, Date.now() - agentStartedAt) });
      if ((researchTouched || history.contextResult && isResearchResult(history.contextResult)) && research.task
        && !(error instanceof Error && error.message === 'QUERY_DENIED')) {
        // A valid partial checkpoint is a successful archive write, not a claim
        // that the research completed. Existing owner/session audit recovery is reused.
        const checkpoint = research.checkpoint(true)!;
        const checkpointSignal = AbortSignal.timeout(10000);
        await recheckResearchResult(client, actor, checkpointSignal, requestId, checkpoint, authority.permissionRevision);
        const answer = '研究已暂停，已完成步骤已记录；可重新鉴权后恢复继续。尚未完成研究或交付新文件。';
        await audit.append(requestId, 'tool_finished', { protocol: 'agent-answer/1', researchContext: true,
          resolution: { protocol: 'deep-research/1' }, permissionRevision: authority.permissionRevision,
          history: trimAgentHistory(history, valid.question, answer), memory: nextAgentMemory(history.memory, valid.question, checkpoint), operations: runtime.summary(), executionStatus: 'partial', status: 'checkpoint_prepared' });
        await audit.append(requestId, 'response_generated', { result: checkpoint });
        await audit.append(requestId, 'succeeded', { delivery: 'not_sent', executionStatus: 'partial', researchInterrupted: true });
        completed = true; checkpointPreserved = true;
        await recordHistorySubmission(client, keys, actor, valid.conversation.id, requestId);
      }
      throw error;
    }
    if(execution.unresolvedFailures.some(item=>item.code==='knowledge_public_search_disabled'))execution.answer='公开搜索服务尚未启用，本轮没有联网或发送外部查询。需由维护者配置正式搜索服务及公开研究授权。';
    if (execution.unresolvedFailures.some(item => item.code === 'lease_scope_too_large')) execution.answer = '获权成交数据池超过20000条，未返回部分结果。请由授权维护者缩小正式研究授权范围后重试；本轮未完成成交查询。';
    if (!preparedChart && (execution.toolNames.some(name => ['prepare_chart', 'create_chart', 'modify_chart'].includes(name))
      || execution.unresolvedFailures.some(item => ['create_chart', 'modify_chart'].includes(item.tool)))) execution.answer = '本轮未生成图表。请核对获权字段、单位、范围及图表规格后重试。';
    if (preparedChart && (!selectedAnswer || selectedAnswer.primaryResultId === preparedChart.resultId)) {
      execution.result = preparedChart;
      execution.answer = chartFile ? '服务器已生成 ' + (chartFile.format === 'png_zip' ? 'PNG' : 'SVG') + ' 图片与来源包，可通过本条回答下载；尚未发起浏览器下载，未确认本机保存。'
        : '已使用本次获权结果生成同源图表，图表与来源见本条回答；图表修改不改变正式数值。';
      if (execution.unresolvedFailures.length) execution.answer += '\n部分步骤未完成。';
    }
    if (preparedExport && !preparedChart) {
      execution.result = preparedExport;
      execution.answer = '服务器已生成 ' + preparedExport.table.rows.length
        + ' 行' + ((preparedExport.parameters.agentExport as { format: string }).format === 'xlsx' ? ' Excel 文件' : ' CSV 与来源包')
        + '，可通过本条回答的下载操作获取；尚未发起浏览器下载，也未确认本机保存。'
        + (execution.unresolvedFailures.length ? '\n其余步骤未全部完成。' : '');
    }
    if (!preparedExport && (execution.toolNames.includes('export_table')
      || execution.unresolvedFailures.some(item => item.tool === 'export_table'))) {
      execution.answer = '本轮未生成文件。'
        + (execution.unresolvedFailures.some(item => item.code === 'export_not_authorized')
          ? '当前身份没有独立的内部导出资格。' : '导出步骤未通过，请调整范围、字段或规格后重试。')
        + '其余步骤未全部完成。';
    }
    if (!chartFile && (execution.toolNames.includes('export_chart') || execution.unresolvedFailures.some(item => item.tool === 'export_chart'))) {
      execution.answer = '本轮未生成图片文件。' + (preparedChart ? '同源图表仍可查看。' : '')
        + '请核对导出资格、字段与图表规格后重试。';
    }
    if(!preparedMap && !preparedChart && !preparedExport && !preparedReport && execution.toolNames.includes('prepare_map_selection')) {
      execution.answer='本轮未准备地图操作。当前结果缺少可操作的楼宇身份，或选择范围未通过校验；未打开地图或生成点位。';
    }
    if(preparedMap && !preparedChart && !preparedExport && !preparedReport) {
      execution.result=preparedMap;
      execution.answer='已准备获权楼宇的地图操作，可通过本条回答打开地图；尚未打开地图或改变当前地图选择。';
      if(execution.unresolvedFailures.length) execution.answer+='部分步骤未完成，请查看执行限制。';
    }
    if (preparedReport) {
      execution.result = preparedReport;
      execution.answer = '服务器已生成内部研究 PDF 报告，可通过本条回答下载；尚未发起浏览器下载，未确认本机保存。对客发布须另行授权。';
      if (execution.unresolvedFailures.length) execution.answer += '\n部分任务未完成，请核对执行限制后重试。';
    } else if (execution.toolNames.includes('generate_pdf_report') || execution.unresolvedFailures.some(item => item.tool === 'generate_pdf_report')) {
      execution.answer = '本轮未生成 PDF 文件。请核对内部导出资格、正式结果、报告范围与用途后重试；对客发布须另行授权。';
    }
    const current = await fresh();
    if (current.permissionRevision !== authority.permissionRevision
      || current.policyVersion !== authority.policyVersion) throw new Error('QUERY_DENIED');
    await recheckLeases();
    if(knowledgeResults.size){
      // Do not feed model-authored claims about unread private text into history.
      if(execution.result && isKnowledgeResult(execution.result)) execution.answer=execution.result.table.rows.length===0
        ?'当前获权范围没有检索到匹配证据；未编造原文或研究判断。可调整文档范围和关键词，未命中不代表全文没有该信息。'
        :execution.result.parameters.evidenceKind==='external_public'
        ?'公开搜索已返回来源与摘要。请核对来源 URL、检索时间及资料时间；摘要尚未核验原网页。'
        :'内部资料证据已在结果表格交付，可按文档和页码／位置对照核查。私有正文未发送外部模型；文档陈述不等于已核验的当前事实。';
    }
    const researchRequested = execution.toolNames.some(name => RESEARCH_TOOL_NAMES.has(name))
      || /(?:Word|PPT|PowerPoint|docx|pptx)/i.test(valid.question) && /(?:生成|导出|制作|输出|报告|下载)/.test(valid.question);
    const researchFailures = execution.unresolvedFailures.filter(f => RESEARCH_TOOL_NAMES.has(f.tool)).map(f => {
      if (f.code === 'research_step_limit') return '本次范围超过八个数据步骤，请减少指标或模块，未截断结果。';
      if (/^(?:report_|research_archive_limit|artifact_size_limit)/.test(f.code)) return '成果超过当前行数、页数、文件或可读排版容量，未裁剪数据；请缩小范围或分批生成。';
      if (f.code === 'invalid_arguments') return '研究规格不符合受控范围：最多两个子市场、八个季度；请明确期间和业务口径。';
      return '成果步骤未通过校验，请核对研究进度、当前授权和生成要求。';
    });
    if (researchRequested && !preparedResearch) execution.answer = '本轮未生成研究文件。' + [...new Set(researchFailures)].join('');
    if (researchTouched && research.task) {
      execution.result = preparedResearch ?? research.checkpoint()!;
      const descriptor = researchObservation(execution.result);
      const formats = execution.result.parameters.researchDeliverables as string[] | undefined;
      execution.answer = formats ? '服务器已生成内部研究 ' + formats.map(f => ({ docx: 'Word', pptx: 'PPT', pdf: 'PDF', xlsx: 'Excel' } as Record<string, string>)[f]).join('、')
        + ' 文件，可通过本条回答下载；尚未发起浏览器下载，未确认本机保存。对客发布须另行授权。'
        : descriptor.state === 'reviewed' ? '研究步骤已完成并审查，正式结果、同源图表规格及来源保留在研究工作集中；本轮尚未生成成果文件。'
        : '研究进度已记录，尚有步骤未完成；可在当前对话继续，不能将部分结果视为完整研究。';
      if (descriptor.issues.length) execution.answer += '\n研究限制：' + [...new Set(descriptor.issues.map(i => reviewIssueText(i.code)))].join('');
      if (researchFailures.length) execution.answer += '\n' + [...new Set(researchFailures)].join('');
      if (descriptor.state !== 'reviewed' || execution.unresolvedFailures.length) execution.executionStatus = 'partial';
    }
    const fulfillment = artifactFulfillment(valid.question, execution.result);
    if (fulfillment.missing.length) {
      for (const format of fulfillment.missing) {
        const tool = fulfillment.toolFor(format);
        if (!execution.unresolvedFailures.some(f => f.tool === tool)) execution.unresolvedFailures.push({ tool, code: 'not_generated' });
      }
      execution.executionStatus = execution.result ? 'partial' : 'limited';
      const delivered = fulfillment.requested.filter(f => fulfillment.available.includes(f));
      execution.answer = (delivered.length ? delivered.map(f => artifactLabels[f]).join('、') + ' 已可下载。' : '')
        + '本轮未生成 ' + fulfillment.missing.map(f => artifactLabels[f]).join('、') + ' 文件，任务尚未全部完成。请核对范围或重试。';
    }
    const terminalDelivery = !!(preparedExport || preparedReport || preparedResearch);
    if (!execution.result && execution.toolCalls === 0 && isLatestLeaseQuestion(valid.question) && !hasExplicitLeaseWindow(valid.question))
      execution.answer = '要查询哪个日期范围内的最新一笔租赁成交？';
    if (selectedAnswer && !needsSelection() && !terminalDelivery && !researchTouched) {
      selectedAnswer = { ...selectedAnswer, results: selectedAnswer.results.map(item => {
        const prepared = preparedChart?.resultId === item.result.resultId ? preparedChart
          : preparedMap?.resultId === item.result.resultId ? preparedMap : undefined;
        return prepared ? { ...item, result: prepared as typeof item.result } : item;
      }) };
      execution.result = selectedAnswerResult(selectedAnswer) as QueryResult;
    } else if (needsSelection() && !terminalDelivery && !researchTouched) {
      selectedAnswer = undefined;
      // Fail closed rather than pair an unbound model narrative with the last
      // query (which may only be a coverage or future-period check).
      execution.result = undefined;
      execution.answer = '本轮取得多个结果，但尚未确认与当前问题对应的主结果。请明确需要比较的期间或范围。';
      execution.executionStatus = 'limited';
      execution.unresolvedFailures.push({ tool: 'select_answer_results', code: 'conditions_required' });
    }
    // Persist presentation intent with the archived snapshot. Delivery prose is
    // rendered by attachments; substantive partial-execution warnings stay in
    // the narrative. No keyword removal or model-supplied presentation values.
    if (execution.result) {
      const delivery = !!(preparedExport || preparedReport || chartFile || preparedResearch);
      const listing = !isKnowledgeResult(execution.result) && !isResearchResult(execution.result)
        && !/(?:详细|完整报告|解释方法|为什么|原因|方法说明)/.test(valid.question);
      const narrativeRole = delivery ? 'delivery_status' : listing ? 'result_summary' : 'analysis';
      // Already-generated files bind the original digest. Never mutate their
      // snapshot after generation; their versioned artifact descriptor is the
      // legacy adapter's presentation input.
      if (!delivery) execution.result = { ...execution.result, parameters: { ...execution.result.parameters,
        responsePresentation: { version: 'response-presentation/1', narrativeRole } } };
      if (execution.executionStatus === 'completed') {
        if (narrativeRole === 'delivery_status') execution.answer = '文件已准备好，可从附件下载。仅供内部分析。';
        else if (narrativeRole === 'result_summary') execution.answer = '查询结果见下方表格。';
      }
    }
    if (execution.result) {
      const primary = execution.result;
      if (!selectedAnswer || terminalDelivery || researchTouched) selectedAnswer = {
        version: 'answer-selection/1', task: answerTask(valid.question, primary),
        status: execution.executionStatus === 'completed' ? 'answered' : 'partial',
        primaryResultId: primary.resultId, results: [{ role: 'primary', result: primary as AnswerSelection['results'][number]['result'] }],
      };
      else selectedAnswer = { ...selectedAnswer, results: selectedAnswer.results.map(item =>
        item.result.resultId === primary.resultId ? { ...item, result: primary as typeof item.result } : item) };
      selectedAnswer = applyAnswerPolicy(valid.question, selectedAnswer, execution.executionStatus);
      if (execution.executionStatus !== 'completed') {
        // Summary ownership stays with formal blocks even after partial tool
        // execution. A separate trusted notice retains what did not complete;
        // no arbitrary supplier prose or Markdown table is scanned/deleted.
        const executionNotice = fulfillment.missing.length ? execution.answer
          : '部分步骤未取得可核验的完整结果，任务尚未全部完成。';
        selectedAnswer = { ...selectedAnswer, notice: [selectedAnswer.notice, executionNotice].filter(Boolean).join(' ') };
      }
      if (selectedAnswer.notice) execution.answer = selectedAnswer.notice;
    }
    await audit.append(requestId, 'accounting', { provider: 'server_policy', operations: runtime.summary(), status: execution.executionStatus,
      model: execution.model, modelCalls: execution.calls, toolCalls: execution.toolCalls,
      toolTrace, phases: execution.phases, workset: workset.manifest(worksetOwner),
      providerRequestIds: providerRequestIds.slice(0, 6), toolNames: execution.toolNames,
      inputTokens: execution.inputTokens, outputTokens: execution.outputTokens,
      cost: null, costStatus: 'planning_range_not_invoice',
      costEstimate: runtime.summary().providers.every(p => p === 'deepseek') ? estimateAgentCostRange(execution.model, execution.inputTokens, execution.outputTokens) : null,
      durationMs: Math.max(0, Date.now() - agentStartedAt) });
    const knowledgeAnswer=execution.result && isKnowledgeResult(execution.result);
    const businessAnswer=execution.result && isBusinessResult(execution.result);
    const leaseAnswer = execution.result && isLeaseResult(execution.result);
    const researchAnswer = execution.result && isResearchResult(execution.result);
    const answerPlan = execution.result && !researchAnswer && !leaseAnswer && !businessAnswer && !knowledgeAnswer ? parseQueryPlan(execution.result.parameters.executedPlan) : null;
    await audit.append(requestId, 'tool_finished', {
      protocol: 'agent-answer/1', provider: 'server_policy', model: execution.model,
      permissionRevision: authority.permissionRevision,
      history: trimAgentHistory(history, valid.question, execution.answer),
      memory: nextAgentMemory(history.memory, valid.question, execution.result), operations: runtime.summary(),
      toolTrace, phases: execution.phases, workset: workset.manifest(worksetOwner),
      executionStatus: execution.executionStatus, unresolvedFailures: execution.unresolvedFailures,
      ...(researchAnswer ? { researchContext: true, resolution: { protocol: 'deep-research/1' } } : {}),
      ...(researchFiles ? { researchFiles, researchFileState: 'server_generated' } : {}),
      ...(knowledgeResults.size ? {knowledgeContext:true}: {}),
      ...(knowledgeAnswer ? {resolution:{protocol:'knowledge-research/1'}}:{}),
      ...(businessResults.size ? {businessContext:true} : {}),
      ...(businessAnswer ? {resolution:{protocol:'business-research/1'}} : {}),
      ...(leaseResults.size ? { leaseContext: true } : {}),
      ...(leaseAnswer ? { resolution: { protocol: 'lease-research/1' } } : {}),
      ...(answerPlan ? { plan: answerPlan, resolution: { protocol: 'research-conversation/1' } } : {}),
      ...(preparedReport ? { reportFile } : {}),
      ...(!preparedReport && preparedChart ? { chartContext: { resultId: preparedChart.resultId, chart: (preparedChart.parameters.agentChart as { request: ChartRequest }).request }, ...(chartFile ? { chartFile } : {}) } : {}),
      ...(preparedExport && !isLeaseResult(preparedExport) && !isBusinessResult(preparedExport) && !isKnowledgeResult(preparedExport) ? { exportFiles, exportContext: {
        plans: preparedExport.parameters.exportPlans,
        selection: (() => { const { resultIds: _ids, ...selection } = (preparedExport.parameters.agentExport as {
          selection: { resultIds: string[] } }).selection; void _ids; return selection; })(),
      } } : {}),
      ...(selectedAnswer ? { answerContext: true, resolution: { protocol: 'answer-selection/1' } } : {}),
      status: 'answer_prepared',
    });
    await audit.append(requestId, 'response_generated', { result: selectedAnswer ?? execution.result ?? {
      version: 'agent-message/1', text: execution.answer, model: execution.model,
    } });
    await audit.append(requestId, 'succeeded', { delivery: 'not_yet_sent',
      provider: 'server_policy', model: execution.model, toolCalls: execution.toolCalls,
      executionStatus: execution.executionStatus, worksetCount: workset.manifest(worksetOwner).length });
    completed = true;
    // History indexing is optional until the owner-only RPC is deployed.
    const historySaved = await recordHistorySubmission(client, keys, actor, valid.conversation.id, requestId);
    const responseBody = { requestId, status: execution.result ? 'ready' : 'assistant',
      message: execution.answer, ...(execution.result ? { result: execution.result } : {}),
      ...(selectedAnswer ? { answerSelection: selectedAnswer } : {}),
      conversation: valid.conversation, historySaved,
      agent: { model: execution.model, modelCalls: execution.calls, operations: runtime.summary(),
        toolCalls: execution.toolCalls, inputTokens: execution.inputTokens,
        outputTokens: execution.outputTokens, executionStatus: execution.executionStatus,
        phases: execution.phases, workset: workset.manifest(worksetOwner),
        unresolvedFailures: execution.unresolvedFailures } };
    const deliveryHeaders = await prepareDelivery(audit, keys, actor, {
      requestId, kind: execution.result ? 'result' : 'status',
      resultId: execution.result?.resultId ?? null,
      itemCount: execution.result?.table.rows.length ?? 0,
      bodySha256: createHash('sha256').update(JSON.stringify(responseBody)).digest('hex'),
    }, { httpStatus: 200, provider: 'server_policy' });
    const response = await prepareQueryJsonResponse(request, responseBody, deliveryHeaders);
    try {
      await history.contextRecheck?.();
      await recheckLeases();
      if (preparedReport || researchAnswer) {
        const read = await readOwnResult(client, actor, requestId, 'archive', signal);
        await recoverOwnResult(client, actor, keys, requestId, read, signal);
      }
    } catch (error) {
      await audit.append(requestId, 'correction', { reason: 'artifact_sources_changed_before_response', delivery: 'not_sent' });
      throw error;
    }
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
      error: checkpointPreserved ? '研究已中断，已完成的合法步骤已记录，可从历史恢复继续；研究尚未全部完成。' : '浏览器已中断请求，不能确认服务端是否完全停止。' }, 409);
    if (checkpointPreserved) return json({ requestId, status: 'cancelled', error: '本轮执行受到预算、时间或服务异常限制，合法研究进度已记录，可从历史恢复继续；研究尚未全部完成。' }, 409);
    return json({ requestId, status: error instanceof Error && error.message === 'QUERY_DENIED' ? 'denied' : 'unavailable',
      error: providerMessage(error) },
      error instanceof Error && error.message === 'QUERY_DENIED' ? 403 : 503);
  }
}
