import { isBusinessResult, BUSINESS_DOMAIN, businessBindingSchema } from '../business/protocol';
import { isLeaseResult, LEASE_DOMAIN, leaseBindingSchema } from '../lease/protocol';
import { createHash, randomUUID } from 'node:crypto';
import { exportTableSchema } from './toolRegistry';
import { AuthorizedResultWorkset, type WorksetOwner, WORKSET_LIMITS } from './resultWorkset';
import { sanitizeAuditContent } from '../query/auditStore';
import { buildResultArtifact } from '../query/artifacts';
import { resultViewSchema } from '../query/presentation';
import { parseQueryPlan } from '../query/plan';
import { Decimal } from '../query/decimal';
import type { QueryResult, ResultCell } from '../query/result';

function compare(a: ResultCell, b: ResultCell): number {
  if (a.kind === 'number' && b.kind === 'number') {
    const left = BigInt(a.value.exact.numerator) * BigInt(b.value.exact.denominator);
    const right = BigInt(b.value.exact.numerator) * BigInt(a.value.exact.denominator);
    return left < right ? -1 : left > right ? 1 : 0;
  }
  return a.kind === 'text' && b.kind === 'text' ? a.value.localeCompare(b.value, 'zh-CN') : 0;
}

/** Full server results only. No model-provided cells, source references or paths. */
export function prepareExportResult(results: readonly QueryResult[], raw: unknown): QueryResult {
  const args = exportTableSchema.parse(raw);
  if (results.length !== args.resultIds.length || new Set(args.resultIds).size !== results.length
    || results.some((result, i) => result.resultId !== args.resultIds[i])) throw new Error('AGENT_RESULT_NOT_FOUND');
  results.forEach(result => resultViewSchema.parse(result));
  const base = results[0];
  const lease = isLeaseResult(base);
  const business=isBusinessResult(base);
  if(results.some(r=>isBusinessResult(r)!==business || business && r.parameters.businessTool!==base.parameters.businessTool)) throw new Error('AGENT_EXPORT_INCOMPATIBLE_DOMAIN');
  if (results.some(result => isLeaseResult(result) !== lease)) throw new Error('AGENT_EXPORT_INCOMPATIBLE_DOMAIN');
  if (results.some(result => JSON.stringify(result.table.columns) !== JSON.stringify(base.table.columns)))
    throw new Error('AGENT_EXPORT_INCOMPATIBLE_COLUMNS');
  if (results.reduce((sum, result) => sum + result.table.rows.length, 0) > WORKSET_LIMITS.totalRows)
    throw new Error('AGENT_WORKSET_LIMIT');
  const columns = base.table.columns;
  const check = (key: string) => {
    if (!columns.some(column => column.key === key)) throw new Error('AGENT_FIELD_NOT_AVAILABLE');
  };
  const fields = args.fields ?? columns.map(column => column.key);
  if (new Set(fields).size !== fields.length) throw new Error('AGENT_INVALID_TOOL_ARGUMENTS');
  fields.forEach(check);
  if (args.sort) check(args.sort.field);
  for (const filter of args.filters) check(filter.field);
  let rows: Array<{ entityId: string; cells: Record<string, ResultCell> }> = results.flatMap(result => result.table.rows.map(row => ({ ...row,
    cells: { ...row.cells, ...(results.length > 1 ? {
      export_result_id: { kind: 'text' as const, value: result.resultId, sourceIds: [] },
      export_period: { kind: 'text' as const, value: JSON.stringify(lease ? result.parameters.scope : result.parameters.period ?? {
        start: result.parameters.start, end: result.parameters.end,
      }), sourceIds: [] },
    } : {}) },
  })));
  for (const filter of args.filters) {
    const numeric = columns.find(column => column.key === filter.field)?.unit !== null;
    const value = numeric ? Decimal.parse(filter.value) : null;
    if (numeric && (!value || filter.operator === 'contains')
      || !numeric && filter.operator !== 'contains' && filter.operator !== 'eq') throw new Error('AGENT_INVALID_TOOL_ARGUMENTS');
    rows = rows.filter(row => {
      const cell = row.cells[filter.field];
      if (cell.kind === 'unknown') return false;
      if (cell.kind === 'text') return filter.operator === 'contains'
        ? cell.value.toLocaleLowerCase().includes(String(filter.value).toLocaleLowerCase()) : cell.value === String(filter.value);
      if (!value) throw new Error('AGENT_INVALID_TOOL_ARGUMENTS');
      const compared = compare(cell, { kind: 'number', value: { numeric: value.toNumber(), exact: value.exact() }, sourceIds: [] });
      return filter.operator === 'eq' ? compared === 0 : filter.operator === 'gte' ? compared >= 0 : compared <= 0;
    });
  }
  if (args.sort) {
    const sort = args.sort;
    rows.sort((a, b) => {
      const ca = a.cells[sort.field], cb = b.cells[sort.field];
      if (ca.kind === 'unknown' || cb.kind === 'unknown') return ca.kind === cb.kind ? 0 : ca.kind === 'unknown' ? 1 : -1;
      return compare(ca, cb) * (sort.direction === 'asc' ? 1 : -1);
    });
  }
  const matchedRows = rows.length;
  if (args.topN) {
    if (!args.sort) throw new Error('AGENT_EXPORT_TOP_REQUIRES_SORT');
    let count = Math.min(args.topN, rows.length);
    const boundary = rows[count - 1]?.cells[args.sort.field];
    while (boundary && boundary.kind !== 'unknown' && count < rows.length
      && rows[count].cells[args.sort.field].kind !== 'unknown'
      && compare(boundary, rows[count].cells[args.sort.field]) === 0) count++;
    rows = rows.slice(0, count);
  }
  const sources = new Map<string, QueryResult['sources'][number]>();
  for (const result of results) for (const source of result.sources) {
    if (sources.has(source.id) && JSON.stringify(sources.get(source.id)) !== JSON.stringify(source))
      throw new Error('AGENT_EXPORT_SOURCE_COLLISION');
    sources.set(source.id, source);
  }
  const lineage = results.map(result => ({ resultId: result.resultId, snapshotId: result.snapshotId,
    dataVersion: result.dataVersion, scopeFingerprint: result.scopeFingerprint,
    parameters: result.parameters, analysis: result.analysis, rowCount: result.table.rows.length }));
  const leaseBindings = lease ? results.flatMap(result => leaseBindingSchema.array().min(1).max(64).parse(result.parameters.leaseBindings)) : [];
  const businessBindings=results.flatMap(r=>r.parameters.businessBindings?businessBindingSchema.array().min(1).max(64).parse(r.parameters.businessBindings):[]);
  const exportPlans = lease || business ? [] : results.flatMap(result => Array.isArray(result.parameters.exportPlans)
    ? result.parameters.exportPlans.map(parseQueryPlan) : [parseQueryPlan(result.parameters.executedPlan)]);
  const outputColumns = [...(results.length > 1 ? [
    { key: 'export_result_id', label: '原结果编号', unit: null },
    { key: 'export_period', label: '原结果期间', unit: null },
  ] : []), ...fields.map(key => columns.find(column => column.key === key)!)];
  if (outputColumns.length > 30) throw new Error('AGENT_EXPORT_COLUMN_LIMIT');
  const result: QueryResult = { ...base, resultId: randomUUID(), operation: 'list', analysis: null,
    dataVersion: createHash('sha256').update(JSON.stringify(results.map(item => item.dataVersion))).digest('hex'),
    // The derived table has its own shape. Original analytics and research
    // metadata stay in lineage; reusing them would mislabel filtered rows or
    // make the multi-metric renderer reject this list result.
    parameters: { ...Object.fromEntries(Object.entries(base.parameters).filter(([key]) =>
      ['scope', 'period', 'executedPlan', 'relativeQuarterContext'].includes(key))), fields, exportPlans,
      ...(businessBindings.length?{businessBindings}:{}),
      ...(business?{dataDomain:BUSINESS_DOMAIN,businessTool:base.parameters.businessTool}:{}),
      ...(lease ? { dataDomain: LEASE_DOMAIN, leaseBindings, leaseProviderMinGroupSize: Math.max(...results.map(r => typeof r.parameters.leaseProviderMinGroupSize === 'number' ? r.parameters.leaseProviderMinGroupSize : 100)) } : {}),
      agentExport: { version: 'agent-export/1', format: args.format, singleSheet: args.singleSheet,
        matchedRows, exportedRows: rows.length, selection: args, lineage } },
    table: { id: 'export', columns: outputColumns, rows: rows.map(row => ({ ...row,
      cells: Object.fromEntries(outputColumns.map(column => [column.key, row.cells[column.key]])) })) },
    sources: [...sources.values()], limitations: [...new Set(results.flatMap(result => result.limitations)),
      '导出读取完整正式结果，不受界面分页或模型预览限制；来源、期间及原始统计口径保留。',
      ...(args.topN ? ['Top N 保留末位并列；缺失值排在最后，不当成零。'] : [])] };
  resultViewSchema.parse(result);
  try { sanitizeAuditContent({ result }); } catch { throw new Error('AGENT_EXPORT_ARCHIVE_LIMIT'); }
  if (Buffer.byteLength(JSON.stringify(result)) > 15 * 1024 * 1024) throw new Error('AGENT_EXPORT_ARCHIVE_LIMIT');
  return result;
}

export async function exportAuthorizedTable(workset: AuthorizedResultWorkset, owner: WorksetOwner,
  raw: unknown, grants: readonly string[]) {
  if (!grants.includes('export:internal')) throw new Error('AGENT_EXPORT_DENIED');
  const args = exportTableSchema.parse(raw);
  const results = args.resultIds.map(id => workset.read(id, owner));
  const result = prepareExportResult(results, args);
  const file = await buildResultArtifact(result, { requestId: owner.requestId,
    resultId: result.resultId, action: 'export', format: args.format });
  if (file.type !== 'download') throw new Error('AGENT_EXPORT_NOT_GENERATED');
  return { result, content: JSON.stringify({ status: 'ready', state: 'server_generated',
    sourceResultIds: args.resultIds, resultId: result.resultId, format: args.format, filename: file.filename,
    bytes: file.bytes.byteLength, sha256: file.sha256, exportedRows: result.table.rows.length,
    matchedRows: (result.parameters.agentExport as { matchedRows: number }).matchedRows,
    note: '服务器已真实生成文件；回答将显示可信下载操作。文件resultId仅用于交付，继续处理请使用sourceResultIds。尚未发起浏览器下载，不能声称已保存到本机。' }) };
}
