import { createHash, randomUUID } from 'node:crypto';
import { reportRequestSchema, REPORT_LIMITS } from '../query/reportProtocol';
import { resultViewSchema } from '../query/presentation';
import { resultOutputDescriptor } from '../query/resultOutput';
import { agentChartDescriptorSchema } from '../query/chartProtocol';
import { preferredChartRequest } from './resultTools';
import { buildResultChart } from '../query/charts';
import { parseQueryPlan } from '../query/plan';
import { buildResultArtifact } from '../query/artifacts';
import { sanitizeAuditContent } from '../query/auditStore';
import type { QueryResult } from '../query/result';
import type { AuthorizedResultWorkset, WorksetOwner } from './resultWorkset';

export function prepareReportResult(results: readonly QueryResult[], raw: unknown): QueryResult {
  const args = reportRequestSchema.parse(raw);
  if (args.purpose !== 'internal') throw new Error('REPORT_CLIENT_PUBLICATION_REQUIRES_SEPARATE_APPROVAL');
  if (new Set(args.resultIds).size !== args.resultIds.length || results.length !== args.resultIds.length
    || results.some((r, i) => r.resultId !== args.resultIds[i])) throw new Error('AGENT_RESULT_NOT_FOUND');
  const views = results.map(r => resultViewSchema.parse(r));
  if (results.some(r => r.parameters.agentReport || r.parameters.agentExport)) throw new Error('REPORT_NESTED_RESULT_UNSUPPORTED');
  const rowCount = results.reduce((n, r) => n + r.table.rows.length, 0);
  if (rowCount > REPORT_LIMITS.rows) throw new Error('REPORT_ROW_LIMIT');
  if (args.charts.some(c => !args.resultIds.includes(c.resultId)) || new Set(args.charts.map(c => c.resultId)).size !== args.charts.length)
    throw new Error('REPORT_CHART_RESULT_NOT_FOUND');
  const sections = results.map((result, i) => {
    const prior = agentChartDescriptorSchema.safeParse(result.parameters.agentChart).data;
    const preferred = preferredChartRequest(views[i]);
    const defaultChart = result.operation === 'list' && result.table.rows.length > 40 ? null
      : preferred?.kind === 'bar' && result.table.columns.some(c => c.key === 'name') && result.table.columns.some(c => c.key === preferred.field)
        ? { kind: 'plot' as const, type: 'horizontal_bar' as const, x: 'name', y: [preferred.field] } : preferred;
    const chart = args.charts.find(c => c.resultId === result.resultId)?.chart ?? prior?.request ?? defaultChart;
    if (chart) buildResultChart(views[i], chart);
    return { result, chart };
  });
  const sources = new Map<string, QueryResult['sources'][number]>();
  for (const r of results) for (const source of r.sources) {
    if (sources.has(source.id) && JSON.stringify(sources.get(source.id)) !== JSON.stringify(source)) throw new Error('REPORT_SOURCE_COLLISION');
    sources.set(source.id, source);
  }
  const hash = (v: unknown) => createHash('sha256').update(JSON.stringify(v)).digest('hex');
  const text = (value: string) => ({ kind: 'text' as const, value, sourceIds: [] });
  const result: QueryResult = { ...results[0], resultId: randomUUID(), operation: 'list', analysis: null,
    createdAt: new Date().toISOString(), snapshotId: hash(results.map(r => r.snapshotId)),
    dataVersion: hash(results.map(r => r.dataVersion)), sources: [...sources.values()],
    parameters: { executedPlan: parseQueryPlan(results[0].parameters.executedPlan),
      // Reuse the existing multi-plan recovery authorization, not a PDF ACL.
      exportPlans: results.flatMap(r => Array.isArray(r.parameters.exportPlans) ? r.parameters.exportPlans.map(parseQueryPlan) : [parseQueryPlan(r.parameters.executedPlan)]),
      agentReport: { version: 'research-pdf/1', format: 'pdf', purpose: 'internal', generatedAt: new Date().toISOString(), sectionCount: sections.length, rowCount, sections } },
    table: { id: 'report-sections', columns: [{ key: 'name', label: '研究范围', unit: null }, { key: 'metric', label: '研究指标', unit: null }, { key: 'period', label: '数据期间', unit: null }],
      rows: views.map((view, i) => { const d = resultOutputDescriptor(view); return { entityId: String(i), cells: { name: text(d.object), metric: text(d.metric), period: text(d.period) } }; }) },
    limitations: [...new Set(results.flatMap(r => r.limitations)), '内部研究资料；不构成对客发布、对外传播或投资建议。缺失不填零，统计不跨结果重算。'] };
  resultViewSchema.parse(result);
  try { sanitizeAuditContent({ result }); } catch { throw new Error('REPORT_ARCHIVE_LIMIT'); }
  if (Buffer.byteLength(JSON.stringify(result)) > REPORT_LIMITS.archiveBytes) throw new Error('REPORT_ARCHIVE_LIMIT');
  return result;
}

export async function generateAuthorizedReport(workset: AuthorizedResultWorkset, owner: WorksetOwner, raw: unknown, grants: readonly string[], preparedChart?: QueryResult) {
  if (!grants.includes('export:internal')) throw new Error('AGENT_EXPORT_DENIED');
  const args = reportRequestSchema.parse(raw);
  const result = prepareReportResult(args.resultIds.map(id => { const original = workset.read(id, owner); return preparedChart?.resultId === id ? preparedChart : original; }), args);
  const file = await buildResultArtifact(result, { requestId: owner.requestId, resultId: result.resultId, action: 'export', format: 'pdf' });
  if (file.type !== 'download') throw new Error('AGENT_EXPORT_NOT_GENERATED');
  return { result, content: JSON.stringify({ status: 'ready', state: 'server_generated', format: 'pdf', purpose: 'internal',
    sourceResultIds: args.resultIds, resultId: result.resultId, filename: file.filename, bytes: file.bytes.byteLength, sha256: file.sha256,
    note: '服务器已生成真实内部研究PDF；回答提供可信下载操作，尚未触发浏览器下载，未确认本机保存；不授予对客发布资格。' }) };
}
