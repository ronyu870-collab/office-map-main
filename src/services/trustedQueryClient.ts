import { z } from 'zod';
import { resultViewSchema } from '@/src/lib/intelligence/query/presentation';

const capabilitiesSchema = z.object({ enabled: z.boolean(), examples: z.array(z.string()).max(20), permissionRevision: z.string().optional() });
const replySchema = z.object({ requestId: z.uuid().optional(), status: z.string(), error: z.string().optional(), message: z.string().optional(), result: resultViewSchema.optional() });
export type QueryReply = z.infer<typeof replySchema>;
export type QueryAccess = z.infer<typeof capabilitiesSchema>;
export type QueryClientScope = { actorId: string; effectiveId: string; sessionId: string; targetId: string | null };
export const queryScopeKey = (scope: QueryClientScope) => JSON.stringify([scope.actorId, scope.effectiveId, scope.sessionId, scope.targetId]);

async function call(path: string, scope: QueryClientScope, signal: AbortSignal, body?: unknown): Promise<unknown> {
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
  if (!response.headers.get('content-type')?.includes('application/json')) throw new Error('查询服务未返回可识别的结果。');
  if (path === '/capabilities' && !response.ok && response.status !== 403) throw new Error('暂时无法核对查询资格。');
  const value: unknown = await response.json();
  await currentSession();
  return value;
}
export const trustedQueryClient = {
  capabilities: async (scope: QueryClientScope, signal: AbortSignal): Promise<QueryAccess> => capabilitiesSchema.parse(await call('/capabilities', scope, signal)),
  submit: async (scope: QueryClientScope, input: { idempotencyKey: string; question: string }, signal: AbortSignal): Promise<QueryReply> => replySchema.parse(await call('', scope, signal, input)),
  recover: async (scope: QueryClientScope, requestId: string, signal: AbortSignal): Promise<QueryReply> => replySchema.parse(await call('/recover', scope, signal, { requestId, action: 'recover' })),
};
