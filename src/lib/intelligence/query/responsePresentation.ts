import { z } from 'zod';
import { agentExportDescriptorSchema } from './exportProtocol';
import { reportDescriptorSchema } from './reportProtocol';
import { agentChartDescriptorSchema } from './chartProtocol';
import { resultBuildingRows } from './buildingCards';
import type { QueryResultView } from './presentation';

/** A versioned presentation hint, never a source of facts or authorization.
 * Data blocks reference the one immutable, source-bound result instead of
 * copying tables, sources or model-authored values into another protocol. */
export const responsePresentationSchema = z.object({
  version: z.literal('response-presentation/1'),
  narrativeRole: z.enum(['analysis', 'result_summary', 'delivery_status']),
});
export type ResponseBlock =
  | { type: 'text'; text: string }
  | { type: 'summary' | 'metrics' | 'table' | 'chart' | 'building' | 'sources' | 'map' | 'suggestions'; resultId: string }
  | { type: 'file'; resultId: string; format: 'xlsx' | 'csv_zip' | 'pdf' };
export type ResponseDocument = { version: 'response/1'; blocks: ResponseBlock[] };

export function composeResponse(message: string | undefined, result?: QueryResultView): ResponseDocument {
  if (!result) return { version: 'response/1', blocks: message ? [{ type: 'text', text: message }] : [] };
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
  if (report && report.format === 'pdf') blocks.push({ type: 'file', resultId, format: 'pdf' });
  if (result.operation === 'aggregate') blocks.push({ type: 'metrics', resultId });
  if (chart || !['list', 'aggregate'].includes(result.operation)) blocks.push({ type: 'chart', resultId });
  const buildings = resultBuildingRows(result);
  if (buildings.length === 1) blocks.push({ type: 'building', resultId });
  if (buildings.length) blocks.push({ type: 'map', resultId });
  if (result.table.rows.length) blocks.push({ type: 'table', resultId });
  blocks.push({ type: 'sources', resultId });
  if (Array.isArray(result.parameters.suggestions)) blocks.push({ type: 'suggestions', resultId });
  return { version: 'response/1', blocks };
}

/** Shared by active replies and historical turns. Partial execution warnings
 * remain visible even when a typed delivery notice moves to an attachment. */
export function responseNarrative(message: string | undefined, result?: QueryResultView, executionStatus?: 'completed' | 'partial' | 'limited'): string {
  if (executionStatus && executionStatus !== 'completed') return message ?? '';
  return composeResponse(message, result).blocks.flatMap(block => block.type === 'text' ? [block.text] : []).join('\n\n');
}
