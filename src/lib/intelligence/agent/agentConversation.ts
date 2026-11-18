import type { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';
import type { AuditKeys } from '../query/auditStore';
import { decryptAuditContent } from '../query/auditCrypto';
import type { DataAuthority, VerifiedQueryIdentity } from '../query/serverAuthority';
import type { QueryConversation } from '../query/conversationProtocol';

export const AGENT_CONVERSATION_PROTOCOL = 'colliers-agent-conversation/1';
const eventSchema = z.object({ request_id: z.uuid(), event_id: z.uuid(), sequence: z.number().int().positive(),
  kind: z.string(), cipher: z.unknown() });
const historySchema = z.array(z.strictObject({
  user: z.string().min(1).max(1800), assistant: z.string().min(1).max(3000),
})).max(4);
export type AgentHistory = z.infer<typeof historySchema>;

/** Load only server-side encrypted previous answers from the existing owner/session-bound
 * RPC; never accept arbitrary client-provided history text as context. */
export async function readAgentHistory(
  client: SupabaseClient, identity: VerifiedQueryIdentity, keys: AuditKeys,
  authority: DataAuthority, conversation: QueryConversation, signal: AbortSignal,
): Promise<AgentHistory> {
  if (!conversation.parentRequestId) return [];
  if (conversation.resumeToken) throw new Error('AGENT_RESUME_NOT_SUPPORTED');
  const requestId = conversation.parentRequestId;
  const { data, error } = await client.rpc('ai_query_context_read', {
    p_actor: identity.actorId, p_effective: identity.effectiveUserId,
    p_session: identity.sessionId, p_request_id: requestId,
  }).abortSignal(signal);
  signal.throwIfAborted();
  if (error || data?.allowed !== true || data.permission_revision !== authority.permissionRevision)
    throw new Error('AGENT_CONTEXT_UNAVAILABLE');
  const events = z.array(eventSchema).min(2).max(16).parse(data.events);
  if (events[0].kind !== 'received' || events[0].sequence !== 1
    || events.some(event => event.request_id !== requestId)) throw new Error('AGENT_CONTEXT_UNAVAILABLE');
  const decoded = events.map(event => ({
    kind: event.kind,
    content: JSON.parse(decryptAuditContent(event.cipher,
      { requestId, eventId: event.event_id, actorId: identity.actorId,
        effectiveUserId: identity.effectiveUserId },
      new Map([[keys.keyId, keys.encryptionKey]]))).content,
  }));
  const receipt = decoded[0].content;
  if (receipt?.sessionId !== identity.sessionId
    || receipt?.authority?.actorId !== identity.actorId
    || receipt?.authority?.effectiveUserId !== identity.effectiveUserId
    || receipt?.metadata?.protocol !== AGENT_CONVERSATION_PROTOCOL
    || receipt?.metadata?.conversation?.id !== conversation.id) throw new Error('AGENT_CONTEXT_UNAVAILABLE');
  const prior = decoded.findLast(event => event.kind === 'tool_finished'
    && event.content?.protocol === 'agent-answer/1')?.content;
  if (!prior || prior.permissionRevision !== authority.permissionRevision
    || data.state !== 'succeeded') throw new Error('AGENT_CONTEXT_UNAVAILABLE');
  return historySchema.parse(prior.history);
}

export function trimAgentHistory(history: AgentHistory, question: string, answer: string): AgentHistory {
  return historySchema.parse([...history, { user: question.slice(0, 1800),
    assistant: answer.slice(0, 3000) }].slice(-4));
}

