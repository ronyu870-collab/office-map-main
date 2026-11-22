import { z } from 'zod';
import { resultViewSchema } from './presentation';

export const answerTaskSchema = z.enum(['fact', 'record', 'list', 'ranking', 'comparison', 'trend', 'research', 'file']);
export const answerStatusSchema = z.enum(['answered', 'partial', 'needs_conditions', 'unavailable']);
export const answerRoleSchema = z.enum(['primary', 'comparison', 'alternative', 'supporting']);
/** References are model proposals; only the request-local workset can resolve
 * them. No facts, reasons, permissions or source metadata are accepted here. */
export const selectAnswerResultsSchema = z.strictObject({
  primaryResultId: z.uuid(), task: answerTaskSchema, status: answerStatusSchema,
  auxiliary: z.array(z.strictObject({ resultId: z.uuid(), role: z.enum(['comparison', 'supporting']) })).max(2).default([]),
}).superRefine((value, ctx) => {
  const ids = [value.primaryResultId, ...value.auxiliary.map(item => item.resultId)];
  if (new Set(ids).size !== ids.length) ctx.addIssue({ code: 'custom', message: 'Duplicate answer reference' });
});
export type AnswerResultRequest = z.infer<typeof selectAnswerResultsSchema>;
/** Immutable archive envelope: retains each selected, source-bound snapshot
 * without mutating it (including already generated file digests). */
export const answerSelectionSchema = z.object({
  version: z.literal('answer-selection/1'), task: answerTaskSchema, status: answerStatusSchema,
  primaryResultId: z.uuid(), notice: z.string().max(600).optional(),
  results: z.array(z.object({ role: answerRoleSchema, result: resultViewSchema })).min(1).max(3),
}).superRefine((value, ctx) => {
  const ids = value.results.map(item => item.result.resultId);
  if (new Set(ids).size !== ids.length || !ids.includes(value.primaryResultId))
    ctx.addIssue({ code: 'custom', message: 'Incomplete answer snapshots' });
  if (value.results.some(item => item.result.resultId === value.primaryResultId
    ? !['primary', 'alternative'].includes(item.role) : ['primary', 'alternative'].includes(item.role)))
    ctx.addIssue({ code: 'custom', message: 'Answer role does not match primary reference' });
});
export type AnswerSelection = z.infer<typeof answerSelectionSchema>;
export function selectedAnswerResult(selection: AnswerSelection, resultId = selection.primaryResultId) {
  const entry = selection.results.find(item => item.result.resultId === resultId);
  if (!entry) throw new Error('QUERY_DENIED');
  return entry.result;
}
