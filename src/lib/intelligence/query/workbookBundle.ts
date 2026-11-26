import { z } from 'zod';
import { resultViewSchema } from './presentation';

const bundle = z.strictObject({
  version: z.literal('agent-workbook/1'),
  sheets: z.array(z.strictObject({
    name: z.string().regex(/^[\p{L}\p{N} ]{1,31}$/u),
    snapshot: resultViewSchema,
  })).min(2).max(8),
}).refine(value => new Set(value.sheets.map(sheet => sheet.name.toLowerCase())).size === value.sheets.length
  && new Set(value.sheets.map(sheet => sheet.snapshot.resultId)).size === value.sheets.length
  && value.sheets.every(sheet => !['来源', '口径与快照'].includes(sheet.name)
    && sheet.snapshot.parameters.agentWorkbook === undefined));

/** Workbooks are composed only from sealed request-local results. This
 * descriptor confers no new authority at generation, read or download. */
export function readWorkbookBundle(parameters: Readonly<Record<string, unknown>>) {
  if (parameters.agentWorkbook === undefined) return undefined;
  return bundle.parse(parameters.agentWorkbook);
}
