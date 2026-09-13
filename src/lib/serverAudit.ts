import type { SupabaseClient } from '@supabase/supabase-js';

export type ServerAuditPayload = Record<string, unknown> & {
  action_type: string;
};

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
    const { error } = await client.from('audit_logs').insert(payload);
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
