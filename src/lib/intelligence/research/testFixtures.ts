import { ResearchExecution } from './execution';
import { buildTrendResult } from '../query/result';
import { fixture } from '../query/__tests__/fixtures';
import { parseQueryPlan } from '../query/plan';
import { attachResearchAnalysis } from '../query/researchAnalysis';

export function formalTrend(metric: 'rent' | 'vacancy' | 'totalArea' = 'rent') {
  const start = { year: 2026, quarter: 1 }, end = { year: 2026, quarter: 4 };
  const snapshots = [1, 2, 3, 4].map(quarter => fixture({ year: 2026, quarter }));
  const result = attachResearchAnalysis(buildTrendResult(snapshots, metric, 'per_period'), snapshots);
  return { ...result, parameters: { ...result.parameters, scope: { inventory: 'tracked', submarkets: ['CBD'] },
    executedPlan: parseQueryPlan({ operation: 'trend', metric, start, end, mode: 'per_period', scope: { inventory: 'tracked', submarkets: ['CBD'] } }) } };
}
export async function completedResearch(metrics: Array<'rent' | 'vacancy' | 'totalArea'> = ['rent', 'vacancy']) {
  const run = new ResearchExecution(); run.plan({ submarkets: ['CBD'], start: { year: 2026, quarter: 1 }, end: { year: 2026, quarter: 4 }, metrics });
  while (run.task!.steps.some(s => s.id !== 'review' && s.state !== 'complete')) {
    await run.advance({ taskId: run.task!.id, afterStep: run.task!.steps.filter(s => s.id !== 'review' && s.state === 'complete').at(-1)?.id ?? null },
      async (_, args) => ({ content: '{}', result: formalTrend(args.metric as 'rent') }), new AbortController().signal);
  }
  run.review({ taskId: run.task!.id }); return run;
}
