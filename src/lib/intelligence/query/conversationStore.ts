import type { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { authorizePlan } from './admission';
import { decryptAuditContent } from './auditCrypto';
import type { AuditKeys } from './auditStore';
import { queryActionSchema, queryConversationSchema, SEMANTIC_PROTOCOL_VERSION, type QueryConversation } from './conversationProtocol';
import { parseQueryPlan, type QueryPlan } from './plan';
import { parseSemanticContext, type SemanticContext, type SemanticClarification } from './semanticPlanner';
import type { DataAuthority, VerifiedQueryIdentity } from './serverAuthority';
import { unsealHistoryToken } from './historyToken';
import { readOwnResult, recoverOwnResult } from './recovery';

const readSchema = z.object({ allowed: z.literal(true), state: z.enum(['received','running','succeeded','denied','failed','cancelled']),
  permission_revision: z.string().regex(/^[a-f0-9]{64}$/), events: z.array(z.object({ request_id: z.uuid(), event_id: z.uuid(),
    sequence: z.number().int().positive(), kind: z.enum(['received','running','tool_finished','denied']), cipher: z.unknown() })).min(1).max(16) });
const metadataSchema = z.object({ protocol: z.literal(SEMANTIC_PROTOCOL_VERSION), conversation: queryConversationSchema });
const resolutionSchema = z.object({ protocol: z.literal(SEMANTIC_PROTOCOL_VERSION), semanticContext: z.unknown(),
  turn: z.number().int().min(1).max(40), suggestions: z.array(queryActionSchema.extend({ plan: z.unknown() })).max(5).optional() });

export function authorizeConversationPlan(plan: QueryPlan, authority: DataAuthority) {
  authorizePlan(plan, authority);
  if ((!authority.allSubmarkets && plan.scope.submarkets?.some(value => !authority.submarkets.includes(value)))
    || (!authority.allBuildings && plan.scope.buildingIds?.some(value => !authority.buildingIds.includes(value)))) throw new Error('QUERY_DENIED');
}
export type StoredConversation = { context?: SemanticContext; plan?: QueryPlan; clarification?: SemanticClarification;
  turn: number; state: string; suggestions: Array<z.infer<typeof queryActionSchema> & { plan: QueryPlan }> };

/** The client gives references only. All inherited slots come from encrypted, owner-checked audit events. */
export async function readConversation(client: SupabaseClient, identity: VerifiedQueryIdentity, keys: AuditKeys,
  authority: DataAuthority, conversation: QueryConversation, requestId: string, signal: AbortSignal, allowPending = false): Promise<StoredConversation> {
  const { data, error } = await client.rpc('ai_query_context_read', { p_actor: identity.actorId, p_effective: identity.effectiveUserId,
    p_session: identity.sessionId, p_request_id: requestId }).abortSignal(signal);
  signal.throwIfAborted();
  if (error) throw new Error('QUERY_CONTEXT_UNAVAILABLE');
  if (data?.allowed !== true) throw new Error('QUERY_DENIED');
  const record = readSchema.parse(data);
  if (record.permission_revision !== authority.permissionRevision || record.events[0].kind !== 'received'
    || record.events[0].sequence !== 1 || record.events.some(event => event.request_id !== requestId)
    || new Set(record.events.map(event => event.event_id)).size !== record.events.length) throw new Error('QUERY_DENIED');
  const decoded = record.events.map(event => ({ kind: event.kind, content: JSON.parse(decryptAuditContent(event.cipher,
    { requestId, eventId: event.event_id, actorId: identity.actorId, effectiveUserId: identity.effectiveUserId },
    new Map([[keys.keyId, keys.encryptionKey]]))).content }));
  const receipt = decoded[0].content;
  const metadata = metadataSchema.parse(receipt?.metadata);
  const resuming = Boolean(conversation.resumeToken && conversation.parentRequestId === requestId);
  if (resuming) {
    const resume = unsealHistoryToken(conversation.resumeToken!, identity, authority.permissionRevision, 'history-resume', keys);
    if (resume.conversationId !== conversation.id || resume.requestId !== requestId) throw new Error('QUERY_DENIED');
    const archive = await readOwnResult(client, identity, requestId, 'archive', signal);
    if (archive.state !== 'succeeded') throw new Error('QUERY_CONTEXT_UNAVAILABLE');
    const restored = await recoverOwnResult(client, identity, keys, requestId, archive, signal, { reauthorizedHistory: true });
    await restored.recheck();
  }
  if ((!resuming && receipt?.sessionId !== identity.sessionId) || receipt?.authority?.actorId !== identity.actorId
    || receipt?.authority?.effectiveUserId !== identity.effectiveUserId || metadata.conversation.id !== conversation.id) throw new Error('QUERY_DENIED');
  const execution = decoded.find(event => event.kind === 'running');
  if (!resuming && execution && execution.content?.permissionRevision !== authority.permissionRevision) throw new Error('QUERY_DENIED');
  const interpreted = decoded.findLast(event => event.content?.resolution?.protocol === SEMANTIC_PROTOCOL_VERSION);
  if (!interpreted) {
    if (allowPending) return { state: record.state, turn: 0, suggestions: [] };
    throw new Error('QUERY_CONTEXT_UNAVAILABLE');
  }
  const resolved = resolutionSchema.parse(interpreted.content.resolution);
  const context = parseSemanticContext(resolved.semanticContext);
  if (context.lastPlan) authorizeConversationPlan(context.lastPlan, authority);
  const plan = interpreted.content.plan ? parseQueryPlan(interpreted.content.plan) : undefined;
  if (plan) authorizeConversationPlan(plan, authority);
  const suggestions = (resolved.suggestions ?? []).map(action => ({ ...action, plan: parseQueryPlan(action.plan) }));
  for (const action of suggestions) authorizeConversationPlan(action.plan, authority);
  if (!allowPending && !['succeeded', 'denied'].includes(record.state)) throw new Error('QUERY_CONTEXT_UNAVAILABLE');
  return { state: record.state, context, plan, turn: resolved.turn, suggestions,
    ...(interpreted.kind === 'denied' && context.pending ? { clarification: context.pending.clarification } : {}) };
}
