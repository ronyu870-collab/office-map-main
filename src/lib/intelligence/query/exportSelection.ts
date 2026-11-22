import { z } from 'zod';
import type { QueryResult } from './result';

export const tableExportSelectionSchema = z.strictObject({
  kind: z.enum(['selected', 'filtered']),
  rowIndexes: z.array(z.number().int().nonnegative().max(99999)).min(1).max(3000)
    .refine(values => new Set(values).size === values.length, 'Duplicate row indexes'),
});
export type TableExportSelection = z.infer<typeof tableExportSelectionSchema>;

/** Called only after recovery authorizes the entire original snapshot. Inputs
 * select immutable rows by index; they cannot provide values, fields or IDs. */
export function selectExportRows(result: QueryResult, selection: TableExportSelection): QueryResult {
  selection = tableExportSelectionSchema.parse(selection);
  if (!['list', 'rank'].includes(result.operation) || result.parameters.agentReport || result.parameters.researchTask
    || selection.rowIndexes.some(index => index >= result.table.rows.length)) throw new Error('ARTIFACT_SELECTION_INVALID');
  const rows = selection.rowIndexes.map(index => result.table.rows[index]);
  const used = new Set(rows.flatMap(row => Object.values(row.cells).flatMap(cell => cell.sourceIds)));
  return { ...result, operation: 'list', analysis: null,
    parameters: { ...Object.fromEntries(Object.entries(result.parameters).filter(([key]) =>
      ['scope', 'period', 'start', 'end', 'base', 'current', 'executedPlan', 'field', 'fields', 'metric', 'metrics', 'mode', 'filter', 'filters', 'where', 'direction', 'limit', 'dataDomain', 'businessTool'].includes(key))),
      tableSelection: { kind: selection.kind, originalOperation: result.operation, originalRows: result.table.rows.length, exportedRows: rows.length },
    },
    table: { ...result.table, rows }, sources: result.sources.filter(source => used.has(source.id)),
    limitations: [...result.limitations, `${selection.kind === 'selected' ? '仅导出已选记录' : '仅导出当前筛选记录'}；原结果 ${result.table.rows.length} 条，本文件 ${rows.length} 条。原统计不重新计算。`],
  };
}
