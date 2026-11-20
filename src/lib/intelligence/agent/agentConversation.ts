import type { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';
import type { AuditKeys } from '../query/auditStore';
import { decryptAuditContent, redactSubmittedCredentials } from '../query/auditCrypto';
import { loadDataAuthority, type DataAuthority, type VerifiedQueryIdentity } from '../query/serverAuthority';
import { unsealHistoryToken } from '../query/historyToken';
import { readOwnResult, recoverOwnResult } from '../query/recovery';
import { resultViewSchema } from '../query/presentation';
import type { QueryConversation } from '../query/conversationProtocol';
import { parseQueryPlan, type QueryPlan } from '../query/plan';
import { authorizeConversationPlan } from '../query/conversationStore';

export const AGENT_CONVERSATION_PROTOCOL = 'colliers-agent-conversation/1';
const eventSchema = z.object({ request_id: z.uuid(), event_id: z.uuid(), sequence: z.number().int().positive(),
  kind: z.string(), cipher: z.unknown() });
const historySchema = z.array(z.strictObject({
  user: z.string().min(1).max(1800), assistant: z.string().min(1).max(3000),
})).max(8);
export type AgentHistory = z.infer<typeof historySchema> & { contextPlan?: QueryPlan };

/** Load only server-side encrypted previous answers from the existing owner/session-bound
 * RPC; never accept arbitrary client-provided history text as context. */
export async function readAgentHistory(
  client: SupabaseClient, identity: VerifiedQueryIdentity, keys: AuditKeys,
  authority: DataAuthority, conversation: QueryConversation, signal: AbortSignal,
): Promise<AgentHistory> {
  if (!conversation.parentRequestId) return [];
  const requestId = conversation.parentRequestId;
  const resuming = Boolean(conversation.resumeToken);
  if (resuming) {
    const resume = unsealHistoryToken(conversation.resumeToken!, identity, authority.permissionRevision,
      'history-resume', keys);
    if (resume.conversationId !== conversation.id || resume.requestId !== requestId)
      throw new Error('QUERY_DENIED');
    // Never feed decrypted old business claims back to a model until the current
    // source ACL has been rechecked. Text-only answers are owner-bound too.
    await restoreOwnAgentAnswer(client, identity, keys, authority, conversation.id, requestId, signal);
  }
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
  if ((!resuming && receipt?.sessionId !== identity.sessionId)
    || receipt?.authority?.actorId !== identity.actorId
    || receipt?.authority?.effectiveUserId !== identity.effectiveUserId
    || receipt?.metadata?.protocol !== AGENT_CONVERSATION_PROTOCOL
    || receipt?.metadata?.conversation?.id !== conversation.id) throw new Error('AGENT_CONTEXT_UNAVAILABLE');
  const prior = decoded.findLast(event => event.kind === 'tool_finished'
    && event.content?.protocol === 'agent-answer/1')?.content;
  if (!prior || prior.permissionRevision !== authority.permissionRevision
    || data.state !== 'succeeded') throw new Error('AGENT_CONTEXT_UNAVAILABLE');
  const history: AgentHistory = historySchema.parse(prior.history);
  // Only an encrypted, owner-checked prior execution plan is inheritable.
  // An older result or source is never imported into the new request's workset.
  if (prior.plan) {
    const plan = parseQueryPlan(prior.plan);
    authorizeConversationPlan(plan, authority);
    history.contextPlan = plan;
  }
  return history;
}

export function trimAgentHistory(history: AgentHistory, question: string, answer: string): AgentHistory {
  return historySchema.parse([...history, { user: redactSubmittedCredentials(question).text.slice(0, 1800),
    assistant: redactSubmittedCredentials(answer).text.slice(0, 3000) }].slice(-8));
}



/** Reopen a successfully audited Agent response without trusting client text,
 * and validate original query sources before returning any archived business data.
 * A text-only reply has no database source and is restricted to the original
 * owner/conversation and current query eligibility.
 */
export async function restoreOwnAgentAnswer(
  client: SupabaseClient, identity: VerifiedQueryIdentity, keys: AuditKeys,
  authority: DataAuthority, conversationId: string, requestId: string, signal: AbortSignal,
) {
  const read = await readOwnResult(client, identity, requestId, 'archive', signal);
  if (read.state !== 'succeeded' || read.permission_revision !== authority.permissionRevision)
    throw new Error('QUERY_DENIED');
  const decrypt = (event: (typeof read.events)[number]) => {
    if (event.request_id !== requestId) throw new Error('QUERY_DENIED');
    return JSON.parse(decryptAuditContent(event.cipher, { requestId, eventId: event.event_id,
      actorId: identity.actorId, effectiveUserId: identity.effectiveUserId },
    new Map([[keys.keyId, keys.encryptionKey]]))).content;
  };
  const first = read.events[0];
  if (!first || first.kind !== 'received' || first.sequence !== 1) throw new Error('QUERY_HISTORY_UNAVAILABLE');
  const receipt = decrypt(first);
  if (receipt?.authority?.actorId !== identity.actorId || receipt?.authority?.effectiveUserId !== identity.effectiveUserId
    || receipt?.metadata?.protocol !== AGENT_CONVERSATION_PROTOCOL
    || receipt?.metadata?.conversation?.id !== conversationId) throw new Error('QUERY_DENIED');
  const answerEvent = [...read.events].reverse().find(event => event.kind === 'tool_finished'
    && decrypt(event)?.protocol === 'agent-answer/1');
  if (!answerEvent) throw new Error('QUERY_HISTORY_UNAVAILABLE');
  const answer = decrypt(answerEvent);
  if (answer?.permissionRevision !== authority.permissionRevision) throw new Error('QUERY_DENIED');
  const history = historySchema.parse(answer.history);
  const lastAnswer = history.at(-1);
  if (!lastAnswer) throw new Error('QUERY_HISTORY_UNAVAILABLE');
  const generated = [...read.events].reverse().find(event => event.kind === 'response_generated');
  if (!generated) throw new Error('QUERY_HISTORY_UNAVAILABLE');
  const output = decrypt(generated)?.result;
  let message: string, result: ReturnType<typeof resultViewSchema.parse> | undefined;
  let recheck: () => Promise<void>;
  if (output?.version === 'agent-message/1') {
    message = z.string().min(1).max(12000).parse(output.text);
    if (lastAnswer.assistant !== redactSubmittedCredentials(message).text.slice(0, 3000))
      throw new Error('QUERY_HISTORY_UNAVAILABLE');
    recheck = async () => {
      const current = await loadDataAuthority(client, identity, signal);
      if (current.permissionRevision !== authority.permissionRevision
        || current.policyVersion !== authority.policyVersion
        || !current.grants.includes('query:catalog')) throw new Error('QUERY_DENIED');
    };
  } else {
    const restored = await recoverOwnResult(client, identity, keys, requestId, read, signal,
      { reauthorizedHistory: true });
    result = resultViewSchema.parse(restored.result);
    message = lastAnswer.assistant;
    recheck = restored.recheck;
  }
  await recheck();
  return { message, ...(result ? { result } : {}), recheck, headHash: read.head_hash,
    headSequence: read.head_sequence };
}
