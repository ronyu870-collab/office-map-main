import { z } from 'zod';
import type { SupabaseClient } from '@supabase/supabase-js';
import { IMPERSONATION_REQUEST_HEADER, resolveEffectiveRequestIdentity } from '@/src/lib/server/impersonationAuth';
import { getSessionIdFromAccessToken } from '@/src/utils/authSession';
import type { QueryAuthority } from './admission';

export type VerifiedQueryIdentity = Readonly<{ actorId: string; effectiveUserId: string; sessionId: string; expiresAt: number }>;
export type DataAuthority = QueryAuthority & Readonly<{
  sessionId: string;
  allSubmarkets: boolean;
  submarkets: readonly string[];
  allBuildings: boolean;
  buildingIds: readonly string[];
}>;

export async function verifyQueryIdentity(request: Request, client: SupabaseClient): Promise<VerifiedQueryIdentity> {
  // AI is only available in the current admin's own identity. Also refuse a
  // self-targeted simulation header; actor/effective equality alone cannot detect it.
  if (request.headers.has(IMPERSONATION_REQUEST_HEADER)) throw new Error('QUERY_UNAUTHENTICATED');
  const authorization = request.headers.get('authorization') ?? '';
  if (!/^Bearer\s+\S+$/i.test(authorization) || authorization.length > 16384) throw new Error('QUERY_UNAUTHENTICATED');
  const resolved = await resolveEffectiveRequestIdentity(request, client);
  if ('response' in resolved) throw new Error('QUERY_UNAUTHENTICATED');
  // Claims are decoded only after the existing resolver verified this token with Auth.
  const token = authorization.replace(/^Bearer\s+/i, '');
  const sessionId = getSessionIdFromAccessToken(token);
  let expiresAt: number;
  try {
    const claims = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8')) as { exp?: unknown; sub?: unknown };
    if (claims.sub !== resolved.identity.caller.id || typeof claims.exp !== 'number' || !Number.isSafeInteger(claims.exp)) throw new Error();
    expiresAt = claims.exp * 1000;
  } catch { throw new Error('QUERY_UNAUTHENTICATED'); }
  if (!sessionId || expiresAt <= Date.now()) throw new Error('QUERY_UNAUTHENTICATED');
  return { actorId: resolved.identity.caller.id, effectiveUserId: resolved.identity.effectiveUserId, sessionId, expiresAt };
}

const allowedSchema = z.strictObject({
  allowed: z.literal(true), access_policy: z.literal('admin-only/1'), actor_id: z.uuid(), effective_user_id: z.uuid(), session_id: z.uuid(),
  policy_version: z.string().min(1), permission_revision: z.string().regex(/^[0-9a-f]{64}$/),
  capabilities: z.array(z.enum(['query:catalog','query:brochure','query:quarter','export:internal','query:submission-progress','query:submission-quality','query:future-catalog','query:future-progress','query:future-quality','query:leases'])),
  fields: z.array(z.enum(['height','floors','parking','totalArea','vacantArea','netEffectiveRent'])),
  all_submarkets: z.boolean(), submarkets: z.array(z.string()), all_buildings: z.boolean(), building_ids: z.array(z.uuid()),
});

/** Fresh RPC on every execution boundary; never cached by account or JWT. */
export async function loadDataAuthority(client: SupabaseClient, identity: VerifiedQueryIdentity, signal: AbortSignal): Promise<DataAuthority> {
  signal.throwIfAborted();
  if (identity.expiresAt <= Date.now()) throw new Error('QUERY_DENIED');
  const { data, error } = await client.rpc('ai_query_authority', {
    p_actor: identity.actorId, p_effective: identity.effectiveUserId, p_session: identity.sessionId,
  }).abortSignal(signal);
  signal.throwIfAborted();
  if (error) throw new Error('QUERY_AUTHORITY_UNAVAILABLE');
  if (data?.allowed === false) throw new Error('QUERY_DENIED');
  const parsed = allowedSchema.safeParse(data);
  if (!parsed.success) throw new Error('QUERY_AUTHORITY_UNAVAILABLE');
  const authority = parsed.data;
  if (authority.actor_id !== identity.actorId || authority.effective_user_id !== identity.effectiveUserId || authority.session_id !== identity.sessionId) throw new Error('QUERY_DENIED');
  return {
    actorId: identity.actorId, effectiveUserId: identity.effectiveUserId, sessionId: identity.sessionId, sessionActive: true,
    policyVersion: authority.policy_version, permissionRevision: authority.permission_revision,
    grants: authority.capabilities, fields: authority.fields,
    allSubmarkets: authority.all_submarkets, submarkets: authority.submarkets,
    allBuildings: authority.all_buildings, buildingIds: authority.building_ids,
  };
}
