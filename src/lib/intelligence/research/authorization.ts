import type { SupabaseClient } from '@supabase/supabase-js';
import { authorizePlan } from '../query/admission';
import { parseQueryPlan } from '../query/plan';
import { loadDataAuthority, type VerifiedQueryIdentity } from '../query/serverAuthority';
import { recheckBusinessResults } from '../business/research';
import { recheckLeaseResults } from '../lease/research';
import { recheckKnowledgeResults } from '../knowledge/research';
import { researchSections } from './workspace';
import { isKnowledgeResult } from '../knowledge/protocol';

/** Reuse the original domain authorities. A workspace is not an additional grant. */
export async function recheckResearchResult(client: SupabaseClient, identity: VerifiedQueryIdentity, signal: AbortSignal,
  requestId: string, result: { parameters: Readonly<Record<string, unknown>> }, revision: string,
  options: { exporting?: boolean; archived?: boolean } = {}) {
  const sections = researchSections(result);
  const authority = await loadDataAuthority(client, identity, signal);
  if (authority.permissionRevision !== revision || !authority.grants.includes('query:catalog')
    || options.exporting && !authority.grants.includes('export:internal')) throw new Error('QUERY_DENIED');
  await recheckBusinessResults(client, identity, signal, sections.map(s => s.result), options.exporting);
  await recheckLeaseResults(client, identity, signal, sections.filter(s => s.result.parameters.leaseBindings).map(s => s.result), options.exporting);
  await recheckKnowledgeResults(client, identity, signal, sections.map(s => s.result), options.exporting);
  const quarters = sections.map(s => s.result).filter(r => !r.parameters.dataDomain && !isKnowledgeResult(r));
  const plans = quarters.map(r => parseQueryPlan(r.parameters.executedPlan));
  for (const plan of plans) {
    authorizePlan(plan, authority);
    if (plan.scope.submarkets && !authority.allSubmarkets && plan.scope.submarkets.some(s => !authority.submarkets.includes(s))
      || plan.scope.buildingIds && !authority.allBuildings && plan.scope.buildingIds.some(id => !authority.buildingIds.includes(id))) throw new Error('QUERY_DENIED');
  }
  if (options.archived && quarters.length) {
    const sources = [...new Map(quarters.flatMap(r => r.sources).map(s => [s.id, s])).values()].map(s => ({
      entity_id: s.entityId, record_id: s.recordId, source_table: s.table, field: s.field,
      year: s.period?.year ?? null, quarter: s.period?.quarter ?? null,
    }));
    const { data, error } = await client.rpc('ai_query_result_sources_allowed', { p_actor: identity.actorId,
      p_effective: identity.effectiveUserId, p_session: identity.sessionId, p_request_id: requestId,
      p_permission_revision: authority.permissionRevision, p_sources: sources }).abortSignal(signal);
    signal.throwIfAborted();
    if (error) throw new Error('QUERY_RECOVERY_UNAVAILABLE');
    if (data?.allowed !== true || data.permission_revision !== authority.permissionRevision
      || plans.some(p => ['group_aggregate', 'group_trend', 'cross_aggregate', 'cross_trend'].includes(p.operation)) && data.source_policy !== 'catalog-dimensions/1') throw new Error('QUERY_DENIED');
  }
}
