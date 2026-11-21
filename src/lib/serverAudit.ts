import type { SupabaseClient } from '@supabase/supabase-js';
import { after } from 'next/server';
import { sanitizeAuditDetails, sanitizeAuditPayload } from '@/src/utils/auditSanitizer';

export type ServerAuditPayload = Record<string, unknown> & {
  action_type: string;
};

const MANAGED_ORDINARY_ACTIONS = new Set(['BUILDING_PHOTO_ACCESS', 'SALES_MATERIAL_ACCESS', 'OSS_FILE_ACCESS', 'AI_REQUIREMENT_PARSE', 'AI_RECOMMENDATION']);

/** Durable intent precedes cross-service effects; terminal evidence is atomic in PostgreSQL.
 * A crash or finalization outage leaves an explicit pending receipt for reconciliation.
 * It never manufactures a success and never repeats the business mutation to retry audit.
 */
export async function withCriticalAudit<T extends Response>(client: SupabaseClient, payload: ServerAuditPayload, context: string, run: (recordResult: (details: Record<string, unknown>) => void) => Promise<T>, requireCompletion = false): Promise<T | Response> {
  const id = crypto.randomUUID();
  const { error } = await client.from('audit_operation_receipts').insert({ id, actor_id:payload.user_id,
    action_type:payload.action_type,target_table:payload.target_table,target_id:payload.target_id,module:payload.module,
    details:sanitizeAuditPayload(payload.details || {}) });
  if (error) return Response.json({error:'关键操作凭据暂时无法保存，请稍后重试。'}, {status:503});
  let outcomeDetails: Record<string, unknown> = {};
  const complete = async (state: 'success' | 'failed') => {
    try {
      const result = await client.rpc('audit_complete_operation', { p_id:id,p_state:state,p_details:outcomeDetails });
      if (result.error || result.data !== true) console.error('[audit][server] pending critical receipt', {context,id});
      return !result.error && result.data === true;
    } catch { console.error('[audit][server] pending critical receipt', {context,id}); return false; }
  };
  try {
    const response = await run(details => { outcomeDetails = sanitizeAuditPayload(details) as Record<string, unknown>; });
    const confirmed = await complete(response.ok ? 'success' : 'failed');
    if (requireCompletion && !confirmed) return Response.json({error:'审计凭据尚未确认，请稍后重试。'},{status:503});
    return response;
  } catch (error) { await complete('failed'); throw error; }
}
/** Next 16 after() is backed by waitUntil on Vercel and request lifecycle on Node.
 * It is bounded best effort, not a durable queue. Never use for critical operations.
 */
export function scheduleAuditBestEffort(client: SupabaseClient, payload: ServerAuditPayload, context: string): void {
  if (!MANAGED_ORDINARY_ACTIONS.has(payload.action_type)) throw new Error('AUDIT_REQUIRES_RELIABLE_DELIVERY');
  try {
    after(async () => { await writeAuditBestEffort(client, payload, context); });
  } catch {
    // Unsupported lifecycle is observable, and must not fail an ordinary access response.
    console.error('[audit][server] lifecycle unavailable', { context });
  }
}

/**
 * Persist a server-side audit event before the business response returns.
 * Audit failures are reported to server logs but intentionally do not turn an
 * already-successful business mutation into a user-facing failure.
 */
export async function writeAuditBestEffort(
  client: SupabaseClient,
  payload: ServerAuditPayload,
  context: string,
): Promise<boolean> {
  try {
    const { error } = await client.from('audit_logs').insert({...payload,details:sanitizeAuditDetails(payload.action_type,payload.details,payload.module)});
    if (error) {
      console.error('[audit][server] write failed', {
        context,
        code: error.code,
        message: error.message,
      });
      return false;
    }
    return true;
  } catch (error) {
    console.error('[audit][server] write threw', {
      context,
      message: error instanceof Error ? error.message : String(error),
    });
    return false;
  }
}
