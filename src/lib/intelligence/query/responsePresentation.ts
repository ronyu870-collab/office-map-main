import { z } from 'zod';
import { agentExportDescriptorSchema } from './exportProtocol';
import { reportDescriptorSchema } from './reportProtocol';
import { agentChartDescriptorSchema } from './chartProtocol';
import { resultBuildingRows } from './buildingCards';
import { cellText, resultSummary, units, type QueryResultView } from './presentation';
import { resultMetrics, resultMetricColumns, metricLabels } from './multiMetricView';
import type { ResearchAnalysis } from './researchAnalysisView';

/** A versioned presentation hint, never a source of facts or authorization.
 * Data blocks reference the one immutable, source-bound result instead of
 * copying tables, sources or model-authored values into another protocol. */
export const responsePresentationSchema = z.object({
  version: z.literal('response-presentation/1'),
  narrativeRole: z.enum(['analysis', 'result_summary', 'delivery_status']),
});
export type ResponseBlock =
  | { type: 'text'; text: string }
  | { type: 'summary' | 'metrics' | 'table' | 'chart' | 'building' | 'sources' | 'map' | 'suggestions' | 'analysis' | 'research'; resultId: string }
  | { type: 'file'; resultId: string; format: 'xlsx' | 'csv_zip' | 'pdf' };
export type ResponseDocument = { version: 'response/1'; layout?: 'conversation' | 'fact' | 'list' | 'ranking' | 'trend' | 'delivery' | 'research'; blocks: ResponseBlock[] };

export function composeResponse(message: string | undefined, result?: QueryResultView): ResponseDocument {
  if (!result) return { version: 'response/1', layout: 'conversation', blocks: message ? [{ type: 'text', text: message }] : [] };
  const presentation = responsePresentationSchema.safeParse(result.parameters.responsePresentation).data;
  const exported = agentExportDescriptorSchema.safeParse(result.parameters.agentExport).data;
  const report = reportDescriptorSchema.safeParse(result.parameters.agentReport).data;
  const chart = agentChartDescriptorSchema.safeParse(result.parameters.agentChart).data;
  // Old file replies are deterministic delivery notices. Do not inspect or
  // rewrite arbitrary prose using keyword/regex rules. Unknown versions keep
  // their narrative and fall back to the existing verified table renderer.
  const legacyDelivery = result.parameters.responsePresentation == null && !!(exported || report || chart);
  const narrative = presentation ? presentation.narrativeRole === 'analysis' : !legacyDelivery;
  const resultId = result.resultId;
  const blocks: ResponseBlock[] = [];
  if (narrative && message) blocks.push({ type: 'text', text: message });
  blocks.push({ type: 'summary', resultId });
  if (exported) blocks.push({ type: 'file', resultId, format: exported.format });
  else if (report && report.format === 'pdf') blocks.push({ type: 'file', resultId, format: 'pdf' });
  if (result.operation === 'aggregate') blocks.push({ type: 'metrics', resultId });
  const buildings = resultBuildingRows(result);
  const scalar = result.operation === 'aggregate' && result.table.rows.length === 1 && result.table.columns.length === 1;
  const data: ResponseBlock[] = [];
  if (result.parameters.researchTask != null) data.push({ type: 'research', resultId });
  if (buildings.length === 1) data.push({ type: 'building', resultId });
  if (result.table.rows.length && !scalar) data.push({ type: 'table', resultId });
  const analysis: ResponseBlock[] = [
    ...(chart ? [{ type: 'chart' as const, resultId }] : []),
    { type: 'analysis', resultId },
  ];
  // The trusted operation and validated delivery descriptors determine ordering.
  // No question matching, model call, data copying or snapshot mutation.
  blocks.push(...(['list', 'rank', 'aggregate'].includes(result.operation) ? [...data, ...analysis] : [...analysis, ...data]));
  blocks.push({ type: 'sources', resultId });
  const layout = exported || report ? 'delivery' : result.parameters.researchTask != null ? 'research'
    : result.operation === 'aggregate' ? 'fact' : result.operation === 'list' ? 'list'
      : result.operation === 'rank' ? 'ranking' : result.operation === 'trend' ? 'trend' : 'research';
  return { version: 'response/1', layout, blocks };
}

/** Shared by active replies and historical turns. Partial execution warnings
 * remain visible even when a typed delivery notice moves to an attachment. */
export function responseNarrative(message: string | undefined, result?: QueryResultView, executionStatus?: 'completed' | 'partial' | 'limited'): string {
  if (executionStatus && executionStatus !== 'completed') return message ?? '';
  return composeResponse(message, result).blocks.flatMap(block => block.type === 'text' ? [block.text] : []).join('\n\n');
}

/** Editorial content comes only from the verified snapshot and attributed
 * findings. Method text remains available separately from the lead sentence. */
export function responseResultContent(result: QueryResultView, research: ResearchAnalysis | null) {
  const metrics = resultMetrics(result);
  const primaryFinding = metrics.length > 1 ? undefined : research?.findings.find(finding => finding.kind === 'trend');
  const summary = resultSummary(result);
  const index = result.operation === 'distribution' || result.operation === 'relationship' ? 1 : 0;
  const aggregate = metrics.length > 1 && result.operation === 'aggregate' && result.table.rows.length === 1
    ? metrics.flatMap(metric => {
      const key = resultMetricColumns(result, metric).value;
      const column = result.table.columns.find(item => item.key === key), cell = result.table.rows[0].cells[key];
      return column && cell ? [`${metricLabels[metric]}为 ${cellText(cell, column.unit)}${cell.kind === 'number' ? ` ${units[column.unit ?? ''] ?? column.unit ?? ''}` : ''}`] : [];
    }).join('；') : '';
  const conclusion = primaryFinding?.text ?? (aggregate ? `${aggregate}。` : summary[index] ?? summary[0]);
  return { conclusion, primaryFinding, context: summary.filter((line, i) => (primaryFinding || i !== index) && line !== conclusion) };
}

export function responseTableTitle(result: QueryResultView): string {
  if (result.parameters.domain === 'knowledge-research/1') return '研究资料';
  if (result.parameters.dataDomain === 'lease-research/1') return '成交研究明细';
  if (result.parameters.dataDomain === 'business-research/1') return '业务资料';
  const scope = z.object({ submarkets: z.array(z.string()).optional() }).safeParse(result.parameters.scope).data;
  const object = scope?.submarkets?.join('、') ?? '';
  const field = typeof result.parameters.field === 'string' ? result.table.columns.find(column => column.key === result.parameters.field)?.label : null;
  return result.operation === 'rank' ? `${object}${field ?? '楼宇'}排名`
    : result.operation === 'list' ? `${object}楼宇清单` : `${object}数据明细`;
}
