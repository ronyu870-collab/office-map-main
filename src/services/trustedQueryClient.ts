import { z } from 'zod';
import { QueryClientError } from './queryClientErrors';
import type { BuildingSelection } from '@/src/lib/intelligence/query/buildingNavigation';
import type { AgentProgressEvent } from '@/src/lib/intelligence/agent/agentStreamProtocol';
import { buildingContextSchema, type BuildingContext } from '@/src/lib/intelligence/query/buildingCards';
import { parseArtifactFilename } from '@/src/lib/intelligence/query/artifactFilename';
import type { DeliveryReceipt, DeliveryReport, DeliveryView } from '@/src/lib/intelligence/query/delivery';
const receipts = new WeakMap<object, DeliveryReceipt>();
const sha256 = async (bytes: Uint8Array) => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new Uint8Array(bytes)))).map(b => b.toString(16).padStart(2, '0')).join('');
async function bindReceipt(value: object, response: Response, bytes: Uint8Array) {
  const deliveryToken = response.headers.get('x-query-delivery-token'), bodySha256 = response.headers.get('x-query-body-sha256');
  if (!deliveryToken && !bodySha256) return; // Compatibility with the independently deployed homepage.
  if (!deliveryToken || deliveryToken.length > 4000 || !bodySha256 || bodySha256 !== await sha256(bytes)) throw new Error('响应交付校验失败，请重试恢复。');
  receipts.set(value, { deliveryToken, bodySha256 });
}
function transferReceipt(from: unknown, to: object) {
  if (from && typeof from === 'object') { const receipt = receipts.get(from); if (receipt) receipts.set(to, receipt); }
}
async function reportDelivery(scope: QueryClientScope, value: object, phase: DeliveryReport['phase'], view?: DeliveryView, signal?: AbortSignal): Promise<boolean> {
  const receipt = receipts.get(value); if (!receipt) return false;
  const bounded = AbortSignal.any([...(signal ? [signal] : []), AbortSignal.timeout(10000)]);
  for (let attempt = 0; attempt < 2 && !bounded.aborted; attempt++) {
    try {
      const response = await call('/receipt', scope, bounded, { ...receipt, phase, ...(view ? { view } : {}) });
      const status = z.object({ status: z.string() }).parse(response).status;
      if (status === 'recorded') return true;
      if (status !== 'unavailable') return false;
    } catch { /* Unconfirmed remains unconfirmed; never log payload or token. */ }
  }
  return false;
}
function received<T extends object>(scope: QueryClientScope, raw: unknown, value: T): T {
  transferReceipt(raw, value); void reportDelivery(scope, value, 'client_received'); return value;
}
import type { ArtifactInput } from '@/src/lib/intelligence/query/artifacts';
import type { ChartRequest, ResultChart } from '@/src/lib/intelligence/query/charts';
import { resultViewSchema, type QueryResultView } from '@/src/lib/intelligence/query/presentation';
import { queryActionSchema, queryClarificationReasonSchema, queryConversationSchema, type QueryConversation } from '@/src/lib/intelligence/query/conversationProtocol';

const capabilitiesSchema = z.object({ enabled: z.boolean(), examples: z.array(z.string()).max(20), permissionRevision: z.string().optional(), internalExport: z.boolean().optional(), agentEnabled: z.boolean().optional(), agentStreamEnabled: z.boolean().optional() });
export const queryReplySchema = z.object({ requestId: z.uuid().optional(), status: z.string(), reason: z.union([queryClarificationReasonSchema, z.enum(['scope_limit', 'history_reopen'])]).optional(), error: z.string().optional(), message: z.string().optional(), result: resultViewSchema.optional(), historySaved: z.boolean().optional(), isNativeAgent: z.boolean().optional(),
  conversation: queryConversationSchema.optional(), options: z.array(queryActionSchema).max(6).optional(),
  agent: z.object({
    model: z.string().max(120), modelCalls: z.number().int().nonnegative(),
    toolCalls: z.number().int().nonnegative(),
    inputTokens: z.number().int().nonnegative().nullable(),
    outputTokens: z.number().int().nonnegative().nullable(),
    executionStatus: z.enum(['completed', 'partial', 'limited']).optional(),
    phases: z.array(z.enum(['understanding', 'tool_selection', 'executing',
      'verification', 'synthesis', 'completed'])).max(120).optional(),
    workset: z.array(z.object({ requestId: z.uuid(), resultId: z.uuid(),
      operation: z.string(), rowCount: z.number().int().nonnegative(),
      columnCount: z.number().int().nonnegative(), sourceCount: z.number().int().nonnegative(),
      snapshotId: z.string(), dataVersion: z.string(), scopeFingerprint: z.string(),
      createdAt: z.string() })).max(8).optional(),
    unresolvedFailures: z.array(z.object({ tool: z.string().max(100),
      code: z.string().max(100) })).max(12).optional(),
  }).optional() });
const replySchema = queryReplySchema;
export type QueryReply = z.infer<typeof replySchema>;
function decodeQueryReply(value: unknown): QueryReply {
  const decoded = replySchema.safeParse(value);
  if (!decoded.success) throw new QueryClientError('protocol', '查询响应协议不兼容。');
  return decoded.data;
}
export type QueryAccess = z.infer<typeof capabilitiesSchema>;
export type QueryClientScope = { actorId: string; effectiveId: string; sessionId: string; targetId: string | null };
// Additional owned work surfaces reuse the same session-race, receipt and
// transport guards rather than constructing a parallel authenticated client.
export const receiveTrustedQueryValue = received;
export const trustedQueryRequest = call;
/** A signed nested snapshot can own a DOM receipt only after both its enclosing
 * transport and its exact unprojected content have passed digest validation. */
export async function bindTrustedQueryReceipt(parent: object, raw: object, value: object,
  receipt: DeliveryReceipt, signal: AbortSignal): Promise<void> {
  signal.throwIfAborted();
  if (!receipts.has(parent)) throw new Error('历史交付校验失败，请重新打开对话。');
  await bindReceipt(value, new Response(null, { headers: {
    'x-query-delivery-token': receipt.deliveryToken, 'x-query-body-sha256': receipt.bodySha256,
  } }), new TextEncoder().encode(JSON.stringify(raw)));
  signal.throwIfAborted();
}
export const queryScopeKey = (scope: QueryClientScope) => JSON.stringify([scope.actorId, scope.effectiveId, scope.sessionId, scope.targetId]);

async function call(path: string, scope: QueryClientScope, signal: AbortSignal, body?: unknown,
  downloadResultId?: string, onStreamProgress?: (event: AgentProgressEvent) => void): Promise<unknown> {
  const controller = new AbortController();
  let timedOut = false;
  const relay = () => controller.abort(signal.reason);
  if (signal.aborted) relay(); else signal.addEventListener('abort', relay, { once: true });
  const timer = setTimeout(() => { timedOut = true; controller.abort(); }, path === '/capabilities' ? 15000 : path === '/receipt' ? 10000 : 90000);
  try { return await callOnce(path, scope, controller.signal, body, downloadResultId, onStreamProgress); }
  catch (error) {
    if (signal.aborted) throw signal.reason;
    if (timedOut) throw new QueryClientError('timeout', '等待查询响应超时。');
    if (error instanceof TypeError) throw new QueryClientError('network', '网络连接中断。');
    throw error;
  } finally { clearTimeout(timer); signal.removeEventListener('abort', relay); }
}

async function callOnce(path: string, scope: QueryClientScope, signal: AbortSignal, body?: unknown,
  downloadResultId?: string, onStreamProgress?: (event: AgentProgressEvent) => void): Promise<unknown> {
  const [{ getSessionFast }, { withImpersonationHeaders, getImpersonationTargetUserId }] = await Promise.all([
    import('@/src/services/Auth'), import('@/src/services/impersonationHeaders'),
  ]);
  const currentSession = async () => {
    const session = await getSessionFast();
    signal.throwIfAborted();
  // This is a client race guard, not authorization. The server independently
  // verifies the token, simulation, current DB session and grants every time.
    if (!session || session.session.user.id !== scope.actorId || session.user.id !== scope.effectiveId
      || session.sessionId !== scope.sessionId || getImpersonationTargetUserId() !== scope.targetId) throw new QueryClientError('identity', '查询身份已变化，请重新进入主页。');
    return session;
  };
  const session = await currentSession();
  const response = await fetch(`/api/intelligence/query${path}`, { method: body === undefined ? 'GET' : 'POST', cache: 'no-store', signal,
    headers: withImpersonationHeaders({ Authorization: `Bearer ${session.session.access_token}`, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) }),
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  if (path === '/agent/stream') {
    const { readAgentEventStream } = await import('./agentStreamReader');
    const final = await readAgentEventStream(response, signal, onStreamProgress ?? (() => {}));
    const raw = final.reply;
    if (!raw || typeof raw !== 'object' || Array.isArray(raw))
      throw new QueryClientError('protocol', 'AI 流式终态响应格式不正确。');
    const bytes = new TextEncoder().encode(JSON.stringify(raw));
    // The wire carries the original canonical JSON and server-signed digest
    // in the terminal SSE frame, never a speculative browser-side success.
    const signed = new Response(null, { headers: {
      'x-query-delivery-token': final.receipt.deliveryToken,
      'x-query-body-sha256': final.receipt.bodySha256,
    } });
    await bindReceipt(raw, signed, bytes);
    await currentSession();
    return raw;
  }
  if (downloadResultId && response.ok && !response.headers.get('content-type')?.includes('application/json')) {
    const filename = parseArtifactFilename(response.headers.get('content-disposition'));
    const mime = response.headers.get('content-type') ?? '';
    if (response.headers.get('x-query-result-id') !== downloadResultId || !filename
      || !['application/zip', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'application/pdf', ...(path==='/document'?['application/vnd.openxmlformats-officedocument.wordprocessingml.document','application/vnd.openxmlformats-officedocument.presentationml.presentation']:[])].includes(mime)) throw new Error('下载结果与当前查询不一致。');
    if ((body as { format?: string } | undefined)?.format === 'pdf' && (mime !== 'application/pdf' || !filename.endsWith('.pdf'))) throw new Error('PDF 下载格式不正确。');
    const bytes = await response.arrayBuffer();
    if (bytes.byteLength > 32 * 1024 * 1024) throw new Error('下载文件超过当前支持的大小。');
    if (mime === 'application/pdf' && new TextDecoder('ascii').decode(new Uint8Array(bytes, 0, Math.min(5, bytes.byteLength))) !== '%PDF-') throw new Error('PDF 文件内容无效。');
    const digest = await sha256(new Uint8Array(bytes));
    if (digest !== response.headers.get('x-artifact-sha256')) throw new Error('下载校验失败，请重试。');
    await currentSession();
    const file = { blob: new Blob([bytes], { type: mime }), filename };
    await bindReceipt(file, response, new Uint8Array(bytes)); await currentSession();
    return file;
  }
  if (!response.headers.get('content-type')?.includes('application/json')) {
    if (response.status === 401 || response.status === 403) throw new QueryClientError('identity', '查询身份已变化，请重新进入主页。');
    throw new QueryClientError('service', '查询服务未返回可识别的结果。');
  }
  if (path === '/capabilities' && !response.ok && response.status !== 403) throw new Error('暂时无法核对查询资格。');
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength > 64 * 1024 * 1024) throw new Error('查询响应过大。');
  const value: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  if (value && typeof value === 'object') await bindReceipt(value, response, bytes);
  await currentSession();
  if (path === '/artifact' && !response.ok) throw new Error(z.object({ error: z.string() }).safeParse(value).data?.error ?? '本次图表或下载请求未完成。');
  if (downloadResultId) throw new Error('下载未返回文件，请稍后重试。');
  return value;
}
export const trustedQueryClient = {
  buildings: async (scope: QueryClientScope, input: { requestId: string; resultId?: string; buildingId?: string; photoId?: string; mapSelection?: boolean; offset?: number; limit?: number }, signal: AbortSignal): Promise<BuildingContext> => {
    const raw = await call('/buildings', scope, signal, { ...input, action: 'buildings' });
    const envelope = z.object({ status: z.string() }).safeParse(raw);
    if (!envelope.success || envelope.data.status !== 'ready') throw new Error(envelope.success && envelope.data.status === 'denied'
      ? '当前没有访问这些楼宇信息的权限，请重新核对查询资格。'
      : '楼宇信息暂时不可用，请稍后重试；不能据此判断楼宇或照片不存在。');
    const value = buildingContextSchema.parse(raw);
    if (value.requestId !== input.requestId || input.resultId && value.resultId !== input.resultId
      || input.buildingId && value.buildings.some(building => building.id !== input.buildingId)) throw new Error('楼宇信息与当前结果不一致。');
    return received(scope, raw, value);
  },
  copy: async (scope: QueryClientScope, input: { requestId: string; resultId: string; action: 'copy'; format: 'conclusion' | 'figures' | 'summary' }, signal: AbortSignal): Promise<{ text: string; resultId: string; format: 'conclusion' | 'figures' | 'summary' }> => {
    const raw = await call('/artifact', scope, signal, input);
    const value = z.object({ status: z.literal('ready'), requestId: z.uuid(), resultId: z.uuid(), format: z.enum(['conclusion', 'figures', 'summary']), text: z.string().max(120000), resultDigest: z.string().regex(/^[0-9a-f]{64}$/) }).parse(raw);
    if (value.requestId !== input.requestId || value.resultId !== input.resultId || value.format !== input.format) throw new Error('复制内容与当前结果不一致。');
    return received(scope, raw, value);
  },
  chart: async (scope: QueryClientScope, requestId: string, result: QueryResultView, chart: ChartRequest, signal: AbortSignal): Promise<ResultChart> => {
    const raw = await call('/artifact', scope, signal, { requestId, resultId: result.resultId, action: 'chart', chart });
    const value = z.object({ status: z.literal('ready'), chart: z.unknown() }).parse(raw);
    const { buildResultChart } = await import('@/src/lib/intelligence/query/charts');
    const expected = buildResultChart(result, chart);
    if (JSON.stringify(value.chart) !== JSON.stringify(expected)) throw new Error('图表与当前结果不一致，请重新恢复结果。');
    signal.throwIfAborted();
    return received(scope, raw, expected);
  },
  download: async (scope: QueryClientScope, input: Extract<ArtifactInput, { action: 'export' }>, signal: AbortSignal): Promise<{ blob: Blob; filename: string }> =>
    received(scope, null, await call('/artifact', scope, signal, input, input.resultId) as { blob: Blob; filename: string }),
  originalDocument: async (scope:QueryClientScope,input:{requestId:string;resultId:string;sourceId:string;action:'original'},signal:AbortSignal):Promise<{blob:Blob;filename:string}>=>
    received(scope,null,await call('/document',scope,signal,input,input.resultId) as {blob:Blob;filename:string}),
  capabilities: async (scope: QueryClientScope, signal: AbortSignal): Promise<QueryAccess> => capabilitiesSchema.parse(await call('/capabilities', scope, signal)),
  submit: async (scope: QueryClientScope, input: { idempotencyKey: string; question: string; conversation?: QueryConversation; buildingSelection?: BuildingSelection; replayRequestId?: string }, signal: AbortSignal): Promise<QueryReply> => {
    const raw = await call('', scope, signal, input), reply = decodeQueryReply(raw);
    if (reply.conversation && (!input.conversation || reply.conversation.id !== input.conversation.id
      || reply.conversation.parentRequestId !== input.conversation.parentRequestId)) throw new Error('查询响应与当前对话不一致，请重试原请求。');
    return received(scope, raw, reply);
  },
  submitAgent: async (scope: QueryClientScope, input: { idempotencyKey: string; question: string; conversation?: QueryConversation }, signal: AbortSignal): Promise<QueryReply> => {
    if (!input.conversation) throw new Error('需要有效的对话标识。');
    const raw = await call('/agent', scope, signal, input), reply = decodeQueryReply(raw);
    if (reply.conversation && (reply.conversation.id !== input.conversation.id
      || reply.conversation.parentRequestId !== input.conversation.parentRequestId)) throw new Error('AI 响应与当前对话不一致，请重试原请求。');
    return received(scope, raw, reply);
  },
  submitAgentStream: async (scope: QueryClientScope,
    input: { idempotencyKey: string; question: string; conversation: QueryConversation },
    signal: AbortSignal, onProgress: (event: AgentProgressEvent) => void): Promise<QueryReply> => {
    const raw = await call('/agent/stream', scope, signal, input, undefined, onProgress);
    const reply = decodeQueryReply(raw);
    if (reply.conversation && (reply.conversation.id !== input.conversation.id
      || reply.conversation.parentRequestId !== input.conversation.parentRequestId))
      throw new Error('AI 流式响应与当前对话不一致，请重试原请求。');
    return received(scope, raw, reply);
  },
  recover: async (scope: QueryClientScope, requestId: string, signal: AbortSignal): Promise<QueryReply> => { const raw = await call('/recover', scope, signal, { requestId, action: 'recover' }); return received(scope, raw, decodeQueryReply(raw)); },
  reportDelivery,
};
