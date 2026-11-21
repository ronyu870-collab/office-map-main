import { randomUUID } from 'node:crypto';
import { parseQueryPlan, type QueryPlan } from '../query/plan';
import { STRUCTURED_DATA_SCHEMAS, type StructuredDataToolName } from './toolRegistry';
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
    completeResultsInStructuredView: true, displayedPreviewRows: rows.length,
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

/** Validated structured tool -> existing QueryPlan -> authorize -> snapshot -> deterministic
 * result. No natural-language parsing, direct SQL, alternate RPC or additional grants.
 * Historic {question} calls continue using queryVerifiedRealEstate above. */
export async function executeStructuredDataTool(
  env: VerifiedToolEnvironment, name: StructuredDataToolName, input: Record<string, unknown>,
): Promise<AgentToolObservation<QueryResult>> {
  env.signal.throwIfAborted();
  const schema = STRUCTURED_DATA_SCHEMAS[name];
  schema.parse(input);
  let planInput: unknown;
  let nameContains: string | undefined;
  switch (name) {
    case 'analyze_rent_vacancy': {
      const args = STRUCTURED_DATA_SCHEMAS.analyze_rent_vacancy.parse(input);
      planInput = { operation: 'relationship', ...args }; break;
    }
    case 'analyze_distribution': {
      const args = STRUCTURED_DATA_SCHEMAS.analyze_distribution.parse(input);
      planInput = { operation: 'distribution', ...args }; break;
    }
    case 'list_buildings': {
      const args = STRUCTURED_DATA_SCHEMAS.list_buildings.parse(input);
      planInput = { operation: 'list', scope: args.scope, fields: args.fields, period: args.period,
        ...(args.filter ? { filter: args.filter } : {}) };
      break;
    }
    case 'search_buildings': {
      const args = STRUCTURED_DATA_SCHEMAS.search_buildings.parse(input);
      planInput = { operation: 'list', scope: args.scope, period: null, fields: [] };
      nameContains = args.nameContains;
      break;
    }
    case 'get_building_profile': {
      const args = STRUCTURED_DATA_SCHEMAS.get_building_profile.parse(input);
      planInput = { operation: 'list', scope: { inventory: 'all_authorized', buildingIds: args.buildingIds },
        period: args.period ?? null, fields: args.fields ?? ['height', 'floors', 'parking'] };
      break;
    }
    case 'query_quarterly_metrics': {
      const args = STRUCTURED_DATA_SCHEMAS.query_quarterly_metrics.parse(input);
      planInput = { operation: 'aggregate', scope: args.scope, period: args.period,
        metric: args.metric, ...(args.metrics ? { metrics: args.metrics } : {}) };
      break;
    }
    case 'rank_buildings': {
      const args = STRUCTURED_DATA_SCHEMAS.rank_buildings.parse(input);
      planInput = { operation: 'rank', scope: args.scope, field: args.field,
        period: args.period ?? null, direction: args.direction, limit: args.limit,
        ...(args.filter ? { filter: args.filter } : {}) };
      break;
    }
    case 'compare_market_segments': {
      const args = STRUCTURED_DATA_SCHEMAS.compare_market_segments.parse(input);
      planInput = { operation: 'group_aggregate', scope: { inventory: args.inventory, submarkets: args.submarkets },
        period: args.period, metric: args.metric, groupBy: 'submarket' };
      break;
    }
    case 'analyze_market_trends': {
      const args = STRUCTURED_DATA_SCHEMAS.analyze_market_trends.parse(input);
      planInput = { operation: args.groupBy ? 'group_trend' : 'trend', scope: args.scope,
        start: args.start, end: args.end, metric: args.metric, mode: args.mode,
        ...(args.groupBy ? { groupBy: args.groupBy } : {}) };
      break;
    }
    default: throw new Error('AGENT_UNREGISTERED_TOOL');
  }
  const plan: QueryPlan = parseQueryPlan(planInput);
  const fresh = async () => {
    const current = await loadDataAuthority(env.client, env.identity, env.signal);
    if (!current.grants.includes('query:catalog')
      || current.permissionRevision !== env.authority.permissionRevision
      || current.policyVersion !== env.authority.policyVersion) throw new Error('QUERY_DENIED');
    return current;
  };
  const authority = await fresh();
  authorizeConversationPlan(plan, authority);
  const snapshots = await readQuerySnapshots(env.client, env.identity, await fresh(), plan, env.signal);
  let result: QueryResult = executeQueryPlan(plan, snapshots);
  // Search-by-name is a deterministic, result-only transformation of an already
  // authorized catalog snapshot. Preserve the original scope and source IDs.
  if (nameContains) {
    const needle = nameContains.toLocaleLowerCase();
    const rows = result.table.rows.filter(row => {
      const name = row.cells.name;
      return name?.kind === 'text' && name.value.toLocaleLowerCase().includes(needle);
    });
    const used = new Set(rows.flatMap(row => Object.values(row.cells).flatMap(cell => cell.sourceIds)));
    result = { ...result, resultId: randomUUID(),
      parameters: { ...result.parameters, parentResultId: result.resultId, nameContains },
      table: { ...result.table, rows },
      sources: result.sources.filter(source => used.has(source.id)),
      limitations: [...result.limitations, '楼宇名称包含匹配仅筛选本次已获权目录；不代表全市真实项目全集。'] };
  }
  await fresh();
  const view = resultViewSchema.parse(result);
  const columns = view.table.columns.slice(0, 6);
  const preview = view.table.rows.slice(0, 6).map(row => ({
    entityId: row.entityId,
    values: Object.fromEntries(columns.map(col => [col.key, cellText(row.cells[col.key], col.unit)])),
  }));
  return { result, content: JSON.stringify({
    status: 'ready', operation: view.operation, resultId: view.resultId,
    columns: view.table.columns, rowCount: view.table.rows.length, sourceCount: view.sources.length,
    dataVersion: view.dataVersion, snapshotId: view.snapshotId,
    summary: resultSummary(view).slice(0, 5), preview,
    previewRows: preview.length, completeResultAvailable: true,
    note: '本工具返回已授权完整正式结果的引用。preview仅是前几行；使用read_result_page读取后续行、check_data_coverage检查全量样本。',
  }) };
}
