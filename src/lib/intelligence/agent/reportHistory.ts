import type { SupabaseClient } from '@supabase/supabase-js';
import type { AuditKeys } from '../query/auditStore';
import type { DataAuthority, VerifiedQueryIdentity } from '../query/serverAuthority';
import type { QueryConversation } from '../query/conversationProtocol';
import { resultViewSchema } from '../query/presentation';
import type { QueryResult } from '../query/result';
import { restoreOwnAgentAnswer } from './agentConversation';

/** Follow only encrypted parent links in this conversation. Every archived
 * snapshot passes existing owner, current grants and full source recovery. */
export async function readReportHistory(client: SupabaseClient, identity: VerifiedQueryIdentity, keys: AuditKeys,
  authority: DataAuthority, conversation: QueryConversation, signal: AbortSignal) {
  const results = new Map<string, QueryResult>(), visited = new Set<string>();
  const checks: Array<() => Promise<void>> = [];
  let requestId = conversation.parentRequestId;
  while (requestId && visited.size < 8) {
    signal.throwIfAborted();
    if (visited.has(requestId)) throw new Error('REPORT_HISTORY_CYCLE');
    visited.add(requestId);
    const restored = await restoreOwnAgentAnswer(client, identity, keys, authority, conversation.id, requestId, signal);
    checks.push(restored.recheck);
    const root = restored.result;
    const candidates = root?.parameters.agentReport
      ? (root.parameters.agentReport as { sections: Array<{ result: unknown }> }).sections.map(s => resultViewSchema.parse(s.result))
      : root ? [root] : [];
    for (const result of candidates) {
      if (result.parameters.agentExport || result.parameters.agentReport || results.has(result.resultId)) continue;
      if (results.size >= 8) throw new Error('REPORT_HISTORY_RESULT_LIMIT');
      results.set(result.resultId, result as QueryResult);
    }
    requestId = restored.parentRequestId;
  }
  return { results: [...results.values()].reverse(), limited: Boolean(requestId),
    recheck: async () => { for (const check of checks) await check(); } };
}
