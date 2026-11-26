import { resolveSemanticQuestion } from '../../../src/lib/intelligence/query/semanticPlanner';

export const contract = { version: 'ai-evaluation/1', fixture: 'synthetic-v1', permission: 'synthetic-admin-v1',
  clock: '2026-11-22T04:00:00.000Z', scope: 'CBD/tracked', model: 'deepseek-flash', thinking: 'disabled' };
// Equivalent legal planning paths are evaluated by their facts, never by one
// required tool sequence. The synthetic fixture remains scoped to CBD/Q3/rent.
export function matchesQuarterlyContract(name: string, args: Record<string, unknown>): boolean {
  let plan = args;
  if (name === 'query_verified_real_estate') {
    const resolution = resolveSemanticQuestion({ question: String(args.question), now: new Date(contract.clock), availablePeriods: [{ year: 2026, quarter: 3 }] });
    if (resolution.kind !== 'plan' || resolution.plan.operation !== 'aggregate') return false;
    plan = resolution.plan;
  } else if (name === 'analyze_market_trends') {
    if (JSON.stringify(args.start) !== JSON.stringify(args.end) || args.groupBy) return false;
    plan = { ...args, period: args.start };
  } else if (name !== 'query_quarterly_metrics') return false;
  const scope = plan.scope as { inventory?: string; submarkets?: string[]; buildingIds?: string[] } | undefined;
  const period = plan.period as { year?: number; quarter?: number } | undefined;
  return scope?.inventory === 'tracked' && scope.submarkets?.length === 1 && scope.submarkets[0] === 'CBD'
    && !scope.buildingIds && period?.year === 2026 && period.quarter === 3 && plan.metric === 'rent' && !plan.metrics && !plan.filter;
}
