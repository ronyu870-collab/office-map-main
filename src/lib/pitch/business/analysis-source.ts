import { quarterKey, type Quarter } from '@/src/lib/intelligence/query/contracts';
import { queryHttpDependencies } from '@/src/lib/intelligence/query/http';
import { parseQueryPlan, type QueryPlan } from '@/src/lib/intelligence/query/plan';
import { resultViewSchema } from '@/src/lib/intelligence/query/presentation';
import { readOwnResult, recoverOwnResult } from '@/src/lib/intelligence/query/recovery';
import type { PitchContext } from '../data/store';

export async function readAnalysisPlan(ctx: PitchContext, requestId: string, resultId?: string) {
  const { keys, enabled } = queryHttpDependencies();
  if (!enabled) throw new Error('QUERY_DENIED');
  const archive = await readOwnResult(ctx.client, ctx.identity, requestId, 'archive', ctx.signal);
  const recovered = await recoverOwnResult(ctx.client, ctx.identity, keys, requestId, archive, ctx.signal,
    { exporting: true, reauthorizedHistory: true });
  const selected = resultId && recovered.answerSelection?.results.find(item => item.result.resultId === resultId);
  const view = resultViewSchema.parse(selected ? selected.result : recovered.result);
  if (resultId && view.resultId !== resultId) throw new Error('QUERY_DENIED');
  const originalPlan = view.parameters.executedPlan ?? recovered.quarterPlan;
  if (!originalPlan || view.parameters.dataDomain || view.parameters.exportPlans)
    throw new Error('PITCH_HANDOFF_UNSUPPORTED');
  const plan = parseQueryPlan(originalPlan);
  if (plan.operation !== view.operation) throw new Error('PITCH_HANDOFF_UNSUPPORTED');
  return { requestId, resultId: view.resultId, plan };
}

export function analysisEndPeriod(plan: QueryPlan) {
  if ('current' in plan) return plan.current;
  if ('end' in plan) return plan.end;
  return plan.period;
}

export function analysisPlanAtPeriod(plan: QueryPlan, period: Quarter): QueryPlan {
  const end = analysisEndPeriod(plan);
  if (end && quarterKey(end) === quarterKey(period)) return plan;
  const index = (value: Quarter) => value.year * 4 + value.quarter - 1;
  const shift = (value: Quarter, from: Quarter) => {
    const result = index(value) + index(period) - index(from);
    return { year: Math.floor(result / 4), quarter: result % 4 + 1 };
  };
  if ('current' in plan) return parseQueryPlan({ ...plan, current: period, base: shift(plan.base, plan.current) });
  if ('end' in plan) return parseQueryPlan({ ...plan, end: period, start: shift(plan.start, plan.end) });
  return parseQueryPlan({ ...plan, period });
}
