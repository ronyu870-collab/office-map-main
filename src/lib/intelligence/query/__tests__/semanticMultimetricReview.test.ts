import { describe, expect, it } from 'vitest';
import { resolveSemanticQuestion, type SemanticContext } from '../semanticPlanner';

const context: SemanticContext = { version: 'colliers-semantic-context/1', comparisonSubmarkets: ['CBD'],
  lastPlan: { operation: 'aggregate', metric: 'rent', metrics: ['rent', 'vacancy'],
    scope: { inventory: 'tracked', submarkets: ['CBD'] }, period: { year: 2026, quarter: 3 } } };
const base = { version: 'colliers-semantic-intent/1', submarkets: ['金融街'], unresolvedConditions: [] };

describe('multi-metric independent safety review', () => {
  it.each([
    { question: '共同样本呢', priorMode: 'per_period', nextMode: 'paired' },
    { question: '共同有效样本呢', priorMode: 'per_period', nextMode: 'paired' },
    { question: '各期样本呢', priorMode: 'paired', nextMode: 'per_period' },
  ])('honors the explicit sample mode in $question', ({ question, priorMode, nextMode }) => {
    const lastPlan = { operation: 'trend', metric: 'rent', metrics: ['rent', 'vacancy'],
      scope: { inventory: 'tracked', submarkets: ['CBD'] }, start: { year: 2026, quarter: 2 }, end: { year: 2026, quarter: 3 }, mode: priorMode };
    const result = resolveSemanticQuestion({ question, context: { ...context, lastPlan } as SemanticContext,
      now: new Date('2026-11-15T12:00:00Z'), availablePeriods: [{ year: 2026, quarter: 2 }, { year: 2026, quarter: 3 }] });
    expect(result.kind).toBe('plan');
    if (result.kind === 'plan') expect(result.plan).toMatchObject({ operation: 'trend', mode: nextMode, metrics: ['rent', 'vacancy'] });
  });
  it.each([
    { operation: 'cross_aggregate', period: { year: 2026, quarter: 3 } },
    { operation: 'group_aggregate', groupBy: 'grade', period: { year: 2026, quarter: 3 } },
    { operation: 'group_trend', groupBy: 'grade', start: { year: 2026, quarter: 2 }, end: { year: 2026, quarter: 3 }, mode: 'paired' },
  ])('honors an explicit submarket regrouping after $operation', previous => {
    const lastPlan = { metric: 'rent', metrics: ['rent', 'vacancy'], scope: { inventory: 'tracked', submarkets: ['CBD', '金融街'] }, ...previous };
    const result = resolveSemanticQuestion({ question: '按子市场呢', context: { ...context, lastPlan } as SemanticContext,
      now: new Date('2026-11-15T12:00:00Z'), availablePeriods: [{ year: 2026, quarter: 2 }, { year: 2026, quarter: 3 }] });
    expect(result.kind).toBe('plan');
    if (result.kind === 'plan') expect(result.plan).toMatchObject({
      operation: previous.operation === 'group_trend' ? 'group_trend' : 'group_aggregate', groupBy: 'submarket', metrics: ['rent', 'vacancy'],
      ...(previous.operation === 'group_trend' ? { mode: 'paired', start: previous.start, end: previous.end } : { period: previous.period }),
    });
  });
  it.each([
    { ...base, operation: 'list', fields: ['netEffectiveRent'] },
    { ...base, operation: 'rank', field: 'netEffectiveRent', metric: 'rent' },
    { ...base, operation: 'distribution', metric: 'rent' },
  ])('does not let a model silently turn an inherited metric pair into $operation', modelIntent => {
    const result = resolveSemanticQuestion({ question: '金融街情况怎么样', context,
      now: new Date('2026-11-15T12:00:00Z'), availablePeriods: [{ year: 2026, quarter: 3 }], modelIntent });
    expect(result.kind).toBe('clarification');
    if (result.kind === 'clarification') expect(result.clarification.reason).toBe('invalid_model_intent');
  });
});
