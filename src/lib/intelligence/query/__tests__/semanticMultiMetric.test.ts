import { describe, expect, it } from 'vitest';
import type { QueryAuthority } from '../admission';
import type { Quarter } from '../contracts';
import type { QueryPlan } from '../plan';
import { buildSemanticSuggestions, inferSemanticPeriodFieldGroups, inferSemanticPeriodFields, parseSemanticIntent, resolveSemanticQuestion, type SemanticContext, type SemanticResolution } from '../semanticPlanner';

const now = new Date('2026-11-15T10:00:00Z');
const availablePeriods: Quarter[] = [{ year: 2025, quarter: 4 }, { year: 2026, quarter: 1 }, { year: 2026, quarter: 2 }, { year: 2026, quarter: 3 }];
const ask = (question: string, context?: SemanticContext, modelIntent?: unknown) => resolveSemanticQuestion({ question, context, modelIntent, availablePeriods, now });
const ready = (value: SemanticResolution) => { expect(value.kind).toBe('plan'); if (value.kind !== 'plan') throw new Error(JSON.stringify(value)); return value; };
const authority: QueryAuthority = { actorId: 'actor', effectiveUserId: 'actor', sessionActive: true, policyVersion: 'v', permissionRevision: 'v', grants: ['query:catalog', 'query:quarter', 'query:brochure'], fields: ['height', 'floors', 'parking', 'totalArea', 'vacantArea', 'netEffectiveRent'] };
const intent = { version: 'colliers-semantic-intent/1', operation: 'group_aggregate', submarkets: ['CBD', '金融街'], metric: 'rent', metrics: ['rent', 'vacancy'], groupBy: 'submarket', time: { kind: 'explicit', periods: [{ year: 2026, quarter: 3 }] }, unresolvedConditions: [] };

describe('P1 follow-up bounded multi-metric semantics', () => {
  it('compares all explicitly requested metrics and all three submarkets', () => {
    const result = ready(ask('比较2026Q3CBD、金融街和望京三个子市场的净有效租金和空置率'));
    expect(result.plan).toMatchObject({ operation: 'group_aggregate', metric: 'rent', metrics: ['rent', 'vacancy'], groupBy: 'submarket', scope: { submarkets: ['CBD', '金融街', '望京-酒仙桥'] } });
    expect(result.interpretation.resolvedQuestion).toContain('净有效租金和空置率');
  });
  it('inherits both metrics through market changes, comparison, four-quarter trend and a single-quarter override', () => {
    const first = ready(ask('2026Q3CBD净有效租金和空置率'));
    const second = ready(ask('金融街呢', first.context));
    expect(second.plan).toMatchObject({ metrics: ['rent', 'vacancy'], period: { year: 2026, quarter: 3 }, scope: { submarkets: ['金融街'] } });
    const compared = ready(ask('把两者比较一下', second.context));
    expect(compared.plan).toMatchObject({ metrics: ['rent', 'vacancy'], groupBy: 'submarket' });
    const trend = ready(ask('最近四季度变化', compared.context));
    expect(trend.plan).toMatchObject({ operation: 'group_trend', metrics: ['rent', 'vacancy'], start: { year: 2025, quarter: 4 }, end: { year: 2026, quarter: 3 } });
    expect(ready(ask('2026Q2呢', trend.context)).plan).toMatchObject({ operation: 'group_aggregate', metrics: ['rent', 'vacancy'], period: { year: 2026, quarter: 2 } });
  });
  it('keeps the complete deterministic five-turn group and sample-mode chain while rejecting multi-quarter cross dimensions', () => {
    expect(ask('CBD、金融街净有效租金和空置率2026Q2至2026Q3按等级趋势各期样本')).toMatchObject({
      kind: 'clarification', clarification: { reason: 'unsupported' },
    });
    let context: SemanticContext | undefined;
    const steps = [
      { question: 'CBD净有效租金和空置率2026Q2至2026Q3按等级趋势各期样本', groupBy: 'grade', mode: 'per_period', submarkets: ['CBD'], metrics: ['rent', 'vacancy'] },
      { question: '按子市场比较CBD、金融街呢', groupBy: 'submarket', mode: 'per_period', submarkets: ['CBD', '金融街'], metrics: ['rent', 'vacancy'] },
      { question: '共同有效样本呢', groupBy: 'submarket', mode: 'paired', submarkets: ['CBD', '金融街'], metrics: ['rent', 'vacancy'] },
      { question: '各期样本呢', groupBy: 'submarket', mode: 'per_period', submarkets: ['CBD', '金融街'], metrics: ['rent', 'vacancy'] },
      { question: '空置率呢', groupBy: 'submarket', mode: 'per_period', submarkets: ['CBD', '金融街'], metrics: ['vacancy'] },
    ];
    for (const step of steps) {
      const result = ready(ask(step.question, context));
      expect(result.plan).toEqual({
        operation: 'group_trend', metric: step.metrics[0],
        ...(step.metrics.length > 1 ? { metrics: step.metrics } : {}),
        groupBy: step.groupBy, mode: step.mode,
        scope: { inventory: 'tracked', submarkets: step.submarkets },
        start: { year: 2026, quarter: 2 }, end: { year: 2026, quarter: 3 },
      });
      expect(result.interpretation.method).toBe('bounded_semantic_rules');
      context = result.context;
    }
  });
  it('does not treat a newly specified two-period comparison as an inherited grouped trend', () => {
    const prior = ready(ask('CBD净有效租金和空置率2026Q2至2026Q3按等级趋势各期样本'));
    expect(ask('CBD、金融街2026Q2与2026Q3按子市场比较', prior.context)).toMatchObject({
      kind: 'clarification', clarification: { reason: 'unsupported' },
    });
  });
  it('adds an explicit metric while a normal metric change replaces the prior selection', () => {
    const first = ready(ask('2026Q3CBD净有效租金按等级比较'));
    const combined = ready(ask('再加上空置率', first.context));
    expect(combined.plan).toMatchObject({ operation: 'group_aggregate', groupBy: 'grade', metrics: ['rent', 'vacancy'] });
    const single = ready(ask('季度总面积呢', combined.context));
    expect(single.plan).toMatchObject({ operation: 'group_aggregate', metric: 'totalArea', groupBy: 'grade' });
    expect(single.plan).not.toHaveProperty('metrics');
  });
  it('clarifies generic rent even when vacancy is also named; a short answer retains both metrics', () => {
    const first = ask('比较2026Q3CBD、金融街租金和空置率');
    expect(first).toMatchObject({ kind: 'clarification', clarification: { reason: 'metric_required' } });
    expect(ready(ask('净有效租金', first.context)).plan).toMatchObject({ metrics: ['rent', 'vacancy'] });
  });
  it('a known rent basis can resolve generic rent without dropping other named metrics', () => {
    const first = ready(ask('2026Q3CBD净有效租金'));
    expect(ready(ask('比较CBD、金融街租金和空置率', first.context)).plan).toMatchObject({ metrics: ['rent', 'vacancy'] });
  });
  it('retains cross dimensions and supports three declared metrics', () => {
    expect(ready(ask('2026Q3CBD、金融街净有效租金、空置率和季度总面积按子市场和等级交叉统计')).plan).toMatchObject({ operation: 'cross_aggregate', metrics: ['rent', 'vacancy', 'totalArea'] });
  });
  it('does not drop vacancy or a second metric from unsupported raw-list/rank/distribution combinations', () => {
    for (const question of ['2026Q3CBD净有效租金和空置率列表', '2026Q3CBD净有效租金和空置率最高的楼', '2026Q3CBD净有效租金和空置率分布', '2026Q3CBD净有效租金、空置率和季度总面积关系']) {
      expect(ask(question)).toMatchObject({ kind: 'clarification', clarification: { reason: 'unsupported' } });
    }
  });
  it('latest availability reads every required quarterly field including both denominators', () => {
    expect(inferSemanticPeriodFields('最新季度CBD净有效租金和空置率')).toEqual(['totalArea', 'netEffectiveRent', 'vacantArea']);
    const first = ready(ask('2026Q3CBD净有效租金和空置率'));
    expect(inferSemanticPeriodFields('金融街最新季度呢', first.context)).toEqual(['totalArea', 'netEffectiveRent', 'vacantArea']);
    const one = ready(ask('2026Q3CBD净有效租金'));
    expect(inferSemanticPeriodFields('再加上空置率', one.context)).toEqual(['totalArea', 'netEffectiveRent', 'vacantArea']);
  });
  it('allows a validated model proposal only when its complete metric selection matches the question', () => {
    const question = '2026Q3CBD、金融街净有效租金和空置率水平怎么样';
    expect(ready(ask(question, undefined, intent)).plan).toMatchObject({ metrics: ['rent', 'vacancy'] });
    const single = { ...intent, metrics: undefined };
    expect(ask(question, undefined, single)).toMatchObject({ kind: 'clarification', clarification: { reason: 'invalid_model_intent' } });
    expect(ask(question, undefined, { ...intent, metrics: ['rent', 'totalArea'] })).toMatchObject({ kind: 'clarification', clarification: { reason: 'invalid_model_intent' } });
    expect(ask('2026Q3CBD、金融街净有效租金水平怎么样', undefined, intent)).toMatchObject({ kind: 'clarification', clarification: { reason: 'invalid_model_intent' } });
    for (const operation of ['list', 'relationship', 'rank', 'distribution']) expect(ask(question, undefined, { ...single, operation })).toMatchObject({ kind: 'clarification', clarification: { reason: 'invalid_model_intent' } });
  });
  it('rejects illegal model metric arrays and metrics attached to unrelated operations', () => {
    for (const value of [[], ['rent'], ['rent', 'rent'], ['rent', 'vacancy', 'totalArea', 'rent'], ['rent', 'askingRent']]) expect(() => parseSemanticIntent({ ...intent, metrics: value })).toThrow();
    expect(() => parseSemanticIntent({ ...intent, metric: 'vacancy' })).toThrow();
    expect(() => parseSemanticIntent({ ...intent, operation: 'rank' })).toThrow();
  });
  it('suggestions keep metric set, grade grouping and filters; cannot exceed field authorization', () => {
    const result = ready(ask('2026Q3CBD建筑高度大于100米净有效租金和空置率按等级比较'));
    const suggestions = buildSemanticSuggestions({ plan: result.plan, availablePeriods, authority, allowedSubmarkets: ['CBD', '金融街'] });
    expect(suggestions.find(item => item.id === 'recent_four_quarters')?.plan).toMatchObject({ operation: 'group_trend', groupBy: 'grade', metrics: ['rent', 'vacancy'], filter: { field: 'height', value: '100' } });
    expect(suggestions.some(item => item.id === 'same_period_vacancy')).toBe(false);
    expect(suggestions.find(item => item.id === 'compare_submarket')?.plan).toMatchObject({ operation: 'cross_aggregate', metrics: ['rent', 'vacancy'] });
    const restricted = { ...authority, fields: authority.fields.filter(field => field !== 'vacantArea') };
    expect(buildSemanticSuggestions({ plan: result.plan, availablePeriods, authority: restricted, allowedSubmarkets: ['CBD', '金融街'] }).some(item => 'metrics' in item.plan && item.plan.metrics?.includes('vacancy'))).toBe(false);
  });
  it('a single-metric grade result never loses its grade in a trend or comparison suggestion', () => {
    const result = ready(ask('2026Q3CBD净有效租金按等级比较'));
    const suggestions = buildSemanticSuggestions({ plan: result.plan, availablePeriods, authority, allowedSubmarkets: ['CBD', '金融街'] });
    expect(suggestions.find(item => item.id === 'recent_four_quarters')?.plan).toMatchObject({ operation: 'group_trend', groupBy: 'grade' });
    expect(suggestions.find(item => item.id === 'compare_submarket')?.plan).toMatchObject({ operation: 'cross_aggregate' });
  });
  it('preserves predicates and paired sample mode across multi-metric followups', () => {
    const result = ready(ask('CBD建筑高度大于100米净有效租金和空置率最近四季度共同样本变化'));
    expect(ready(ask('金融街呢', result.context)).plan).toMatchObject({ metrics: ['rent', 'vacancy'], mode: 'paired', filter: { field: 'height', value: '100' } });
  });
  it('unsupported field and unknown constraint limitations still take priority over multiple supported metrics', () => {
    for (const question of ['2026Q3CBD近五年建成的净有效租金和空置率', '2026Q3CBD建筑面积超过50000平方米净有效租金和空置率', '2026Q3CBD净有效租金和空置率LEED认证']) expect(ask(question).kind).toBe('clarification');
  });
  it('legacy single-metric plans remain byte-equivalent', () => {
    const expected: QueryPlan = { operation: 'aggregate', metric: 'rent', period: { year: 2026, quarter: 3 }, scope: { inventory: 'tracked', submarkets: ['CBD'] } };
    expect(ready(ask('2026Q3CBD净有效租金')).plan).toEqual(expected);
  });
  it('retains both geographic and grade dimensions instead of pooling markets', () => {
    const result = ready(ask('比较2026Q3CBD、金融街不同等级写字楼的净有效租金和空置率'));
    expect(result.plan).toMatchObject({ operation: 'cross_aggregate', metrics: ['rent', 'vacancy'], scope: { submarkets: ['CBD', '金融街'] } });
    expect(ask('比较CBD、金融街不同等级净有效租金和空置率最近四季度变化')).toMatchObject({ kind: 'clarification', clarification: { reason: 'unsupported' } });
    expect(ask('CBD净有效租金按子市场和等级交叉统计最近四季度变化')).toMatchObject({ kind: 'clarification', clarification: { reason: 'unsupported' } });
  });
  it('clarifies which inherited metric a single-metric distribution should use', () => {
    const result = ready(ask('2026Q3CBD净有效租金和空置率'));
    const next = ask('看看分布', result.context);
    expect(next).toMatchObject({ kind: 'clarification', clarification: { reason: 'metric_required' } });
    expect(ready(ask('空置率', next.context)).plan).toMatchObject({ operation: 'distribution', measure: 'vacancy' });
  });
  it('availability groups reflect metric samples while raw lists and relationships retain joint field requirements', () => {
    expect(inferSemanticPeriodFieldGroups('最新季度CBD净有效租金和空置率')).toEqual([['totalArea', 'netEffectiveRent'], ['totalArea', 'vacantArea']]);
    expect(inferSemanticPeriodFieldGroups('最新季度CBD净有效租金和空置率关系')).toEqual([['totalArea', 'netEffectiveRent', 'vacantArea']]);
    expect(inferSemanticPeriodFieldGroups('最新季度CBD净有效租金和季度总面积列表')).toEqual([['totalArea', 'netEffectiveRent']]);
  });
});
