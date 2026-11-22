import { describe, expect, it } from 'vitest';
import { resolveSemanticQuestion, type SemanticContext, type SemanticResolution } from '../semanticPlanner';
import type { QueryPlan } from '../plan';

const options = { now: new Date('2026-11-22T04:00:00Z'),
  availablePeriods: [{ year: 2026, quarter: 1 }, { year: 2026, quarter: 2 }, { year: 2026, quarter: 3 }] };
const ask = (question: string, context?: SemanticContext) => resolveSemanticQuestion({ ...options, question, context });
const ready = (resolution: SemanticResolution) => {
  expect(resolution.kind).toBe('plan');
  if (resolution.kind !== 'plan') throw new Error(JSON.stringify(resolution.clarification));
  return resolution;
};

describe('independent H6 failure promoted to explicit-period correction regression', () => {
  it('changes only the period, then only the market, keeping the original vacancy meaning', () => {
    const first = ready(ask('2026Q1 CBD空置率'));
    const second = ready(ask('改到2026Q2', first.context));
    expect(second.plan).toEqual({ operation: 'aggregate', metric: 'vacancy', period: { year: 2026, quarter: 2 },
      scope: { inventory: 'tracked', submarkets: ['CBD'] } });
    const third = ready(ask('金融街呢', second.context));
    expect(third.plan).toEqual({ ...second.plan, scope: { inventory: 'tracked', submarkets: ['金融街'] } });
  });
  it('retains the parent inventory, explicit building scope and full numeric predicate', () => {
    const plan: QueryPlan = { operation: 'aggregate', metric: 'vacancy', period: { year: 2026, quarter: 1 },
      scope: { inventory: 'all_authorized', submarkets: ['CBD'], buildingIds: ['00000000-0000-4000-8000-000000000001'] },
      filter: { field: 'totalArea', operator: 'gt', value: '50000' } };
    const context: SemanticContext = { version: 'colliers-semantic-context/1', lastPlan: plan, comparisonSubmarkets: ['CBD'] };
    expect(ready(ask('改到2026Q2', context)).plan).toEqual({ ...plan, period: { year: 2026, quarter: 2 } });
  });
  it('does not supply absent context or silently discard unsupported and conflicting conditions', () => {
    expect(ask('改到2026Q2').kind).toBe('clarification');
    const first = ready(ask('2026Q1 CBD空置率'));
    for (const question of ['改到2026Q2且带装修', '改到2026Q2最新季度', '改到2026Q2并修改数据'])
      expect(ask(question, first.context).kind).toBe('clarification');
  });
});
