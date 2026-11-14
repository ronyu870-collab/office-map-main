import type { SupabaseClient } from '@supabase/supabase-js';
import { verifyQueryIdentity } from './query/serverAuthority';

export type AdminSessionGuard = () => Promise<void>;

/** A necessary identity check, never a model/data capability grant.
 * Capture the Auth-verified session, then recheck its current canonical role,
 * ban/deletion and persisted session at every protected boundary. */
export async function createAdminSessionGuard(request: Request, client: SupabaseClient): Promise<AdminSessionGuard> {
  const identity = await verifyQueryIdentity(request, client);
  if (identity.actorId !== identity.effectiveUserId) throw new Error('AI_ADMIN_DENIED');
  const guard = async () => {
    if (identity.expiresAt <= Date.now()) throw new Error('AI_ADMIN_DENIED');
    const { data, error } = await client.rpc('ai_admin_session_authority', {
      p_actor: identity.actorId, p_session: identity.sessionId,
    }).abortSignal(AbortSignal.timeout(2500));
    if (error) throw new Error('AI_ADMIN_AUTHORITY_UNAVAILABLE');
    if (data !== true || identity.expiresAt <= Date.now()) throw new Error('AI_ADMIN_DENIED');
  };
  await guard();
  return guard;
}
