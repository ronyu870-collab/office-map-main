import { auditIntakeSchema, auditListSchema, auditStreamSchema, type AuditFilter, type AuditRead } from '@/src/lib/intelligence/query/auditConsoleView';

export type AuditScope = { actorId: string; sessionId: string };
export class AuditReadError extends Error {
  constructor(public readonly reason: 'denied' | 'unavailable' | 'identity') { super(reason); }
}

async function read(scope: AuditScope, input: AuditRead, signal: AbortSignal): Promise<unknown> {
  const [{ getSessionFast }, { getImpersonationTargetUserId }] = await Promise.all([
    import('@/src/services/Auth'), import('@/src/services/impersonationHeaders'),
  ]);
  const current = async () => {
    const session = await getSessionFast(); signal.throwIfAborted();
    if (!session || session.session.user.id !== scope.actorId || session.user.id !== scope.actorId
      || session.sessionId !== scope.sessionId || getImpersonationTargetUserId()) throw new AuditReadError('identity');
    return session;
  };
  const session = await current();
  const bounded = AbortSignal.any([signal, AbortSignal.timeout(40000)]);
  const response = await fetch('/api/intelligence/audit', { method: 'POST', cache: 'no-store', signal: bounded,
    headers: { Authorization: `Bearer ${session.session.access_token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(input) });
  if (response.status === 401 || response.status === 403) throw new AuditReadError('denied');
  if (!response.ok || !response.headers.get('content-type')?.includes('application/json') || !response.body) throw new AuditReadError('unavailable');
  const reader = response.body.getReader(), chunks: Uint8Array[] = []; let size = 0;
  try {
    while (true) {
      const part = await reader.read(); bounded.throwIfAborted();
      if (part.done) break;
      size += part.value.byteLength;
      if (size > 64 * 1024 * 1024) throw new AuditReadError('unavailable');
      chunks.push(part.value);
    }
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
  const bytes = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  const value: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  await current(); bounded.throwIfAborted();
  return value;
}

export const aiAuditClient = {
  list: async (scope: AuditScope, input: AuditFilter, signal: AbortSignal) => auditListSchema.parse(await read(scope, input, signal)),
  intake: async (scope: AuditScope, id: string, signal: AbortSignal) => {
    const value = auditIntakeSchema.parse(await read(scope, { action: 'intake', id }, signal));
    if (value.record && value.record.id !== id) throw new AuditReadError('unavailable');
    return value;
  },
  stream: async (scope: AuditScope, id: string, signal: AbortSignal) => {
    const value = auditStreamSchema.parse(await read(scope, { action: 'stream', id }, signal));
    if (value.record && value.record.stream.request_id !== id) throw new AuditReadError('unavailable');
    return value;
  },
};
