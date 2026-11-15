import { z } from 'zod';
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

const capabilitiesSchema = z.object({ enabled: z.boolean(), examples: z.array(z.string()).max(20), permissionRevision: z.string().optional(), internalExport: z.boolean().optional() });
const replySchema = z.object({ requestId: z.uuid().optional(), status: z.string(), error: z.string().optional(), message: z.string().optional(), result: resultViewSchema.optional() });
export type QueryReply = z.infer<typeof replySchema>;
export type QueryAccess = z.infer<typeof capabilitiesSchema>;
export type QueryClientScope = { actorId: string; effectiveId: string; sessionId: string; targetId: string | null };
export const queryScopeKey = (scope: QueryClientScope) => JSON.stringify([scope.actorId, scope.effectiveId, scope.sessionId, scope.targetId]);

async function call(path: string, scope: QueryClientScope, signal: AbortSignal, body?: unknown, downloadResultId?: string): Promise<unknown> {
  const [{ getSessionFast }, { withImpersonationHeaders, getImpersonationTargetUserId }] = await Promise.all([
    import('@/src/services/Auth'), import('@/src/services/impersonationHeaders'),
  ]);
  const currentSession = async () => {
    const session = await getSessionFast();
    signal.throwIfAborted();
  // This is a client race guard, not authorization. The server independently
  // verifies the token, simulation, current DB session and grants every time.
    if (!session || session.session.user.id !== scope.actorId || session.user.id !== scope.effectiveId
      || session.sessionId !== scope.sessionId || getImpersonationTargetUserId() !== scope.targetId) throw new Error('查询身份已变化，请重新进入主页。');
    return session;
  };
  const session = await currentSession();
  const response = await fetch(`/api/intelligence/query${path}`, { method: body === undefined ? 'GET' : 'POST', cache: 'no-store', signal,
    headers: withImpersonationHeaders({ Authorization: `Bearer ${session.session.access_token}`, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) }),
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  if (downloadResultId && response.ok && !response.headers.get('content-type')?.includes('application/json')) {
    const filename = response.headers.get('content-disposition')?.match(/^attachment; filename="([a-zA-Z0-9._-]+)"$/)?.[1];
    const mime = response.headers.get('content-type') ?? '';
    if (response.headers.get('x-query-result-id') !== downloadResultId || !filename
      || !['application/zip', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'].includes(mime)) throw new Error('下载结果与当前查询不一致。');
    const bytes = await response.arrayBuffer();
    if (bytes.byteLength > 32 * 1024 * 1024) throw new Error('下载文件超过当前支持的大小。');
    const digest = await sha256(new Uint8Array(bytes));
    if (digest !== response.headers.get('x-artifact-sha256')) throw new Error('下载校验失败，请重试。');
    await currentSession();
    const file = { blob: new Blob([bytes], { type: mime }), filename };
    await bindReceipt(file, response, new Uint8Array(bytes)); await currentSession();
    return file;
  }
  if (!response.headers.get('content-type')?.includes('application/json')) throw new Error('查询服务未返回可识别的结果。');
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
  capabilities: async (scope: QueryClientScope, signal: AbortSignal): Promise<QueryAccess> => capabilitiesSchema.parse(await call('/capabilities', scope, signal)),
  submit: async (scope: QueryClientScope, input: { idempotencyKey: string; question: string }, signal: AbortSignal): Promise<QueryReply> => { const raw = await call('', scope, signal, input); return received(scope, raw, replySchema.parse(raw)); },
  recover: async (scope: QueryClientScope, requestId: string, signal: AbortSignal): Promise<QueryReply> => { const raw = await call('/recover', scope, signal, { requestId, action: 'recover' }); return received(scope, raw, replySchema.parse(raw)); },
  reportDelivery,
};
