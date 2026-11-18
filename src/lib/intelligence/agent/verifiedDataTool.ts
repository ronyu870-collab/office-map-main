import type { SupabaseClient } from '@supabase/supabase-js';
import type { AuditPort } from '../query/admission';
import type { AuditKeys } from '../query/auditStore';
import { resultViewSchema, cellText, resultSummary } from '../query/presentation';
import { executeQueryPlan } from '../query/executePlan';
import { authorizeConversationPlan } from '../query/conversationStore';
import { prepareSemanticExecution, attachSemanticExecution } from '../query/semanticExecution';
import { readQuerySnapshots } from '../query/snapshotReader';
import { loadDataAuthority, type DataAuthority, type VerifiedQueryIdentity } from '../query/serverAuthority';
import type { QueryResult } from '../query/result';
import type { AgentToolObservation } from './agentOrchestrator';

export type VerifiedToolEnvironment = {
  client: SupabaseClient; keys: AuditKeys; identity: VerifiedQueryIdentity; audit: AuditPort;
  requestId: string; authority: DataAuthority; signal: AbortSignal;
};

/** Model only sees truncated, sanctioned summaries. No raw customer records, service-role
 * SQL access or sensitive source documents are disclosed to the external provider. */
export async function queryVerifiedRealEstate(
  env: VerifiedToolEnvironment, question: string,
): Promise<AgentToolObservation<QueryResult>> {
  env.signal.throwIfAborted();
  const fresh = async () => {
    const authority = await loadDataAuthority(env.client, env.identity, env.signal);
    if (authority.permissionRevision !== env.authority.permissionRevision
      || authority.policyVersion !== env.authority.policyVersion
      || !authority.grants.includes('query:catalog')) throw new Error('QUERY_DENIED');
    return authority;
  };
  const authority = await fresh();
  const prepared = await prepareSemanticExecution({
    client: env.client, keys: env.keys, identity: env.identity, authority,
    audit: env.audit, requestId: env.requestId,
    conversation: { id: env.requestId }, question, receivedAt: new Date(), signal: env.signal,
  });
  if (prepared.resolution.kind === 'clarification') {
    return { content: JSON.stringify({ status: 'requires_clarification',
      message: prepared.resolution.clarification.message,
      reason: prepared.resolution.clarification.reason,
      options: prepared.resolution.clarification.options.map(option => option.label).slice(0, 3) }) };
  }
  authorizeConversationPlan(prepared.resolution.plan, await fresh());
  const snapshots = await readQuerySnapshots(env.client, env.identity, await fresh(), prepared.resolution.plan, env.signal);
  const result = attachSemanticExecution(executeQueryPlan(prepared.resolution.plan, snapshots), prepared);
  await fresh();
  const view = resultViewSchema.parse(result);
  const summaries = resultSummary(view).slice(0, 5);
  const columns = view.table.columns.slice(0, 6);
  const rows = view.table.rows.slice(0, 8).map(row => Object.fromEntries(columns.map(column =>
    [column.label, cellText(row.cells[column.key], column.unit) + (column.unit ? ' [' + column.unit + ']' : '')])));
  const envelope = {
    status: 'ready', operation: view.operation, summary: summaries,
    rowCount: view.table.rows.length, rows,
    registeredSources: view.sources.length, dataAsOf: view.createdAt,
    sourceTables: [...new Set(view.sources.map(source => source.table))].slice(0, 8),
    limitations: view.limitations.slice(0, 4),
    note: '来源详情留在正式结果视图中。不能将未查询的范围视作已验证。',
  };
  const content = JSON.stringify(envelope);
  if (content.length <= 4700) return { content, result };
  return { content: JSON.stringify({ ...envelope, rows: rows.slice(0, 2),
    summary: summaries.slice(0, 3), limitations: view.limitations.slice(0, 2) }), result };
}

