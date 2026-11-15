import { auditExportDocumentSchema, auditExportTargetsSchema, type AuditExportTarget } from '@/src/lib/intelligence/query/auditExportView';
import { auditIntakeSchema, auditListSchema, auditStreamSchema, type AuditFilter, type AuditRead } from '@/src/lib/intelligence/query/auditConsoleView';

export type AuditScope = { actorId: string; sessionId: string };
export class AuditReadError extends Error {
  constructor(public readonly reason: 'denied' | 'export_denied' | 'unavailable' | 'identity') { super(reason); }
}

async function auditSession(scope: AuditScope, signal: AbortSignal) {
  const [{ getSessionFast }, { getImpersonationTargetUserId }] = await Promise.all([
    import('@/src/services/Auth'), import('@/src/services/impersonationHeaders'),
  ]);
  const session = await getSessionFast(); signal.throwIfAborted();
  if (!session || session.session.user.id !== scope.actorId || session.user.id !== scope.actorId
    || session.sessionId !== scope.sessionId || getImpersonationTargetUserId()) throw new AuditReadError('identity');
  return session;
}
async function receive(scope: AuditScope, input: unknown, signal: AbortSignal, endpoint='/api/intelligence/audit') {
  const session = await auditSession(scope, signal);
  const bounded = AbortSignal.any([signal, AbortSignal.timeout(40000)]);
  const response = await fetch(endpoint, { method: 'POST', cache: 'no-store', signal: bounded,
    headers: { Authorization: `Bearer ${session.session.access_token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(input) });
  if (response.status === 401 || response.status === 403) throw new AuditReadError(endpoint.endsWith('/export') ? 'export_denied' : 'denied');
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
  await auditSession(scope, signal); bounded.throwIfAborted();
  return { bytes, response };
}

async function read(scope: AuditScope, input: AuditRead, signal: AbortSignal): Promise<unknown> {
  const { bytes } = await receive(scope, input, signal);
  return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
}
export type AuditExportFile = { blob: Blob; filename: string; receiptToken: string };

export const aiAuditClient = {
  exportRecords: async (scope: AuditScope, targets: AuditExportTarget[], signal: AbortSignal): Promise<AuditExportFile> => {
    auditExportTargetsSchema.parse(targets);
    const {bytes,response}=await receive(scope,{action:'export',targets},signal,'/api/intelligence/audit/export');
    const document=auditExportDocumentSchema.parse(JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes)));
    const actual=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),b=>b.toString(16).padStart(2,'0')).join('');
    const receiptToken=response.headers.get('x-audit-export-receipt');
    if(document.requestedBy!==scope.actorId || document.exportId!==response.headers.get('x-audit-export-id')
      || JSON.stringify(document.targets)!==JSON.stringify(targets) || document.records.length!==targets.length
      || document.records.some((r,i)=>r.target.kind!==targets[i].kind || r.target.id!==targets[i].id)
      || actual!==response.headers.get('x-audit-export-sha256') || !receiptToken || receiptToken.length>3000)throw new AuditReadError('unavailable');
    await auditSession(scope,signal);
    return {blob:new Blob([bytes],{type:'application/json'}),filename:`ai-audit-${document.exportId}.json`,receiptToken};
  },
  reportExport: async (scope: AuditScope, file: AuditExportFile, signal: AbortSignal) => {
    const {bytes}=await receive(scope,{action:'report',receiptToken:file.receiptToken},signal,'/api/intelligence/audit/export');
    const response: unknown=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));
    if(!response || typeof response!=='object' || !('status' in response) || response.status!=='accepted')throw new AuditReadError('unavailable');
  },
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
