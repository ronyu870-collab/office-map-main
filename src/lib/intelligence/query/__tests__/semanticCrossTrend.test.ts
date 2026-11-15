import { describe, expect, it } from 'vitest';
import type { QueryAuthority } from '../admission';
import type { Quarter } from '../contracts';
import { parseQueryPlan, type QueryPlan } from '../plan';
import { resolveBusinessQuestion } from '../question';
import { buildSemanticSuggestions, inferSemanticPeriodFieldGroups, parseSemanticIntent, resolveSemanticQuestion, type SemanticContext, type SemanticResolution } from '../semanticPlanner';

const now = new Date('2026-11-15T10:00:00Z');
const availablePeriods: Quarter[] = [{ year: 2025, quarter: 4 }, { year: 2026, quarter: 1 }, { year: 2026, quarter: 2 }, { year: 2026, quarter: 3 }];
const ask = (question: string, context?: SemanticContext, modelIntent?: unknown) => resolveSemanticQuestion({ question, context, modelIntent, availablePeriods, now });
const ready = (value: SemanticResolution) => { if (value.kind !== 'plan') throw new Error(JSON.stringify(value)); expect(value.kind).toBe('plan'); return value; };
const authority: QueryAuthority = { actorId: 'actor', effectiveUserId: 'actor', sessionActive: true, policyVersion: 'v', permissionRevision: 'v', grants: ['query:catalog', 'query:quarter', 'query:brochure'], fields: ['height', 'floors', 'parking', 'totalArea', 'vacantArea', 'netEffectiveRent'] };
const scope = { inventory: 'tracked', submarkets: ['CBD', '金融街'] } as const;
const filter = { field: 'height', operator: 'gt', value: '100' } as const;
const cross = (): QueryPlan => parseQueryPlan({ operation: 'cross_trend', scope, metric: 'rent', metrics: ['rent', 'vacancy'], start: availablePeriods[0], end: availablePeriods[3], mode: 'per_period', filter });
const contextFor = (plan: QueryPlan): SemanticContext => ({ version: 'colliers-semantic-context/1', lastPlan: plan, comparisonSubmarkets: [...plan.scope.submarkets ?? []] });
const model = { version: 'colliers-semantic-intent/1', operation: 'cross_trend', submarkets: ['CBD', '金融街'], metric: 'rent', metrics: ['rent', 'vacancy'], time: { kind: 'explicit', periods: [availablePeriods[0], availablePeriods[3]] }, mode: 'per_period', unresolvedConditions: [] };

describe('P1 fixed submarket × grade quarterly semantics', () => {
  it('plans the exact three-metric, four-quarter request used by real execution regression', () => {
    const result = ready(ask('CBD、金融街净有效租金、空置率和季度总面积2025Q4至2026Q3按子市场和等级趋势各期样本'));
    expect(result.plan).toEqual({ operation: 'cross_trend', scope, metric: 'rent', metrics: ['rent', 'vacancy', 'totalArea'], start: availablePeriods[0], end: availablePeriods[3], mode: 'per_period' });
    expect(result.interpretation.periods).toEqual(availablePeriods);
    expect(result.interpretation.resolvedQuestion).toContain('按子市场和等级趋势各期样本');
    expect(result.limitations.join('')).toContain('当前目录');
  });

  it('retains geographic and grade dimensions for a natural multi-market grade trend', () => {
    expect(ready(ask('比较CBD、金融街不同等级写字楼的净有效租金和空置率最近四季度变化')).plan).toMatchObject({ operation: 'cross_trend', scope, metrics: ['rent', 'vacancy'], start: availablePeriods[0], end: availablePeriods[3] });
    expect(ready(ask('CBD、金融街净有效租金和空置率2026Q2至2026Q3按等级趋势各期样本')).plan).toMatchObject({ operation: 'cross_trend', start: availablePeriods[2], end: availablePeriods[3] });
  });

  it('extends a single-quarter cross result to a trend without silently removing its grade', () => {
    const first = ready(ask('2026Q3CBD、金融街建筑高度大于100米净有效租金和空置率按子市场和等级交叉统计'));
    expect(ready(ask('再看看最近四季度变化', first.context)).plan).toEqual(cross());
  });

  it('retains both dimensions, every metric, filters and periods through sample and scope followups', () => {
    let context = contextFor(cross());
    for (const [question, mode, submarkets] of [
      ['共同有效样本呢', 'paired', ['CBD', '金融街']],
      ['金融街呢', 'paired', ['金融街']],
      ['把两者比较一下', 'paired', ['CBD', '金融街']],
      ['各期有效样本呢', 'per_period', ['CBD', '金融街']],
    ] as const) {
      const result = ready(ask(question, context));
      expect(result.plan).toMatchObject({ operation: 'cross_trend', mode, scope: { submarkets }, metrics: ['rent', 'vacancy'], start: availablePeriods[0], end: availablePeriods[3], filter });
      context = result.context;
    }
  });

  it('explicit metric replacement and addition preserve cross trend and sample mode', () => {
    const first = ready(ask('共同样本呢', contextFor(cross())));
    const one = ready(ask('空置率呢', first.context));
    expect(one.plan).toMatchObject({ operation: 'cross_trend', metric: 'vacancy', mode: 'paired', filter });
    expect(one.plan).not.toHaveProperty('metrics');
    expect(ready(ask('再加上季度总面积', one.context)).plan).toMatchObject({ operation: 'cross_trend', metric: 'vacancy', metrics: ['vacancy', 'totalArea'], mode: 'paired' });
  });

  it.each([['按子市场比较', 'submarket'], ['按等级呢', 'grade']])('an explicit %s override changes only the grouping', (question, groupBy) => {
    const result = ready(ask(question, contextFor({ ...cross(), mode: 'paired' } as QueryPlan)));
    expect(result.plan).toEqual({ operation: 'group_trend', groupBy, scope, metric: 'rent', metrics: ['rent', 'vacancy'], start: availablePeriods[0], end: availablePeriods[3], mode: 'paired', filter });
  });

  it.each(['按等级和子市场呢', '按等级与子市场呢', '按子市场和按等级呢', '按等级与按子市场呢', '按子市场及等级呢', '按等级、子市场呢', '按等级和子市场交叉趋势'])('keeps both expressly named dimensions in %s', question => {
    const prior = { ...cross(), mode: 'paired' } as QueryPlan;
    expect(ready(ask(question, contextFor(prior))).plan).toEqual(prior);
  });

  it('an explicit single quarter changes cross trend to cross aggregate, retaining predicates and metrics', () => {
    expect(ready(ask('2026Q2呢', contextFor(cross()))).plan).toEqual({ operation: 'cross_aggregate', scope, metric: 'rent', metrics: ['rent', 'vacancy'], period: availablePeriods[2], filter });
  });

  it('a new market comparison retains an already confirmed grade dimension', () => {
    const first = ready(ask('CBD净有效租金最近四季度按等级趋势'));
    expect(ready(ask('CBD、金融街比较呢', first.context)).plan).toMatchObject({ operation: 'cross_trend', scope, start: availablePeriods[0], end: availablePeriods[3] });
  });

  it('uses exactly the named adjacent periods when a cross comparison can be represented without expansion', () => {
    const result = ready(ask('CBD、金融街净有效租金2026Q2与2026Q3按子市场和等级比较'));
    expect(result.plan).toMatchObject({ operation: 'cross_trend', start: availablePeriods[2], end: availablePeriods[3] });
    expect(result.interpretation.periods).toEqual(availablePeriods.slice(2));
  });

  it('clarifies non-contiguous endpoints even when the user says changes, preserving filters in its optional range action', () => {
    const result = ask('CBD、金融街建筑高度大于100米净有效租金2026Q1与2026Q3按子市场和等级比较变化');
    expect(result).toMatchObject({ kind: 'clarification', clarification: { reason: 'unsupported' } });
    if (result.kind !== 'clarification') throw new Error('expected clarification');
    expect(result.clarification.message).toContain('中间季度');
    expect(result.clarification.options).toHaveLength(1);
    const accepted = ready(ask(result.clarification.options[0].question, result.context));
    expect(accepted.plan).toMatchObject({ operation: 'cross_trend', filter, start: availablePeriods[1], end: availablePeriods[3] });
  });

  it.each([
    ['2026Q1与2026Q3', 2026],
    ['2026年第一季度与2026年第三季度', 2026],
    ['今年Q1与今年Q3', 2026],
    ['去年Q1与去年Q3', 2025],
    ['今年第一季度与今年第三季度', 2026],
    ['去年第一季度与去年第三季度', 2025],
    ['今年Q1与2026Q3', 2026],
  ])('the continuous-range option resolves %s exactly once and keeps every numeric condition', (time, year) => {
    const result = ask(`CBD、金融街建筑高度大于100米净有效租金${time}按子市场和等级比较`);
    expect(result.kind).toBe('clarification');
    if (result.kind !== 'clarification') throw new Error('expected clarification');
    expect(result.clarification.options).toHaveLength(1);
    const option = result.clarification.options[0];
    expect(option.question).not.toMatch(/今年|去年/);
    const accepted = ready(ask(option.question, result.context));
    expect(accepted.plan).toMatchObject({ operation: 'cross_trend', filter, start: { year, quarter: 1 }, end: { year, quarter: 3 } });
    expect(accepted.interpretation.periods).toEqual([1, 2, 3].map(quarter => ({ year, quarter })));
  });

  it('cross quarter-on-quarter comparison is exactly two quarters and annual comparison does not invent intermediate periods', () => {
    expect(ready(ask('2026Q3环比呢', contextFor(cross()))).plan).toMatchObject({ operation: 'cross_trend', start: availablePeriods[2], end: availablePeriods[3], filter });
    expect(ask('2026Q3同比呢', contextFor(cross()))).toMatchObject({ kind: 'clarification', clarification: { reason: 'unsupported' } });
  });

  it.each(['净有效租金最高的楼', '净有效租金分布', '净有效租金列表', '净有效租金和空置率关系'])('requires a target quarter instead of silently selecting the first inherited period: %s', question => {
    const result = ask(question, contextFor(cross()));
    expect(result).toMatchObject({ kind: 'clarification', clarification: { reason: 'period_required' } });
    if (result.kind !== 'clarification') throw new Error('expected clarification');
    expect(result.clarification.options).toHaveLength(1);
    const selected = ready(ask(result.clarification.options[0].question, result.context));
    expect(selected.plan).toMatchObject({ period: availablePeriods[3], filter, scope });
  });

  it('does not discard explicitly requested cross dimensions for unsupported grouped row-level operations', () => {
    for (const operation of ['净有效租金最高的楼', '净有效租金分布', '净有效租金列表', '净有效租金和空置率关系']) {
      expect(ask(`2026Q3CBD、金融街按子市场和等级${operation}`).kind).toBe('clarification');
    }
  });

  it('keeps a purely catalog ranking available without requiring a meaningless business quarter', () => {
    expect(ready(ask('建筑高度最高的楼', contextFor(cross()))).plan).toMatchObject({ operation: 'rank', field: 'height', period: null, filter, scope });
  });

  it('does not offer an unexecutable continuous option for endpoints more than forty quarters apart', () => {
    const result = ask('CBD净有效租金2000Q1与2026Q3按子市场和等级比较');
    expect(result).toMatchObject({ kind: 'clarification', clarification: { options: [] } });
  });

  it('does not expand inherited non-contiguous comparison endpoints into a cross trend without a new explicit range', () => {
    const prior: QueryPlan = { operation: 'compare', scope: { inventory: 'tracked', submarkets: ['CBD'] }, metric: 'rent', metrics: ['rent', 'vacancy'], base: availablePeriods[1], current: availablePeriods[3], mode: 'paired', filter };
    const result = ask('按子市场和等级变化', contextFor(prior));
    expect(result).toMatchObject({ kind: 'clarification', clarification: { reason: 'unsupported' } });
    if (result.kind !== 'clarification') throw new Error('expected clarification');
    expect(result.clarification.options).toHaveLength(1);
    const accepted = ready(ask(result.clarification.options[0].question, result.context));
    expect(accepted.plan).toMatchObject({ operation: 'cross_trend', mode: 'paired', filter, start: availablePeriods[1], end: availablePeriods[3] });
    expect(accepted.interpretation.periods).toEqual(availablePeriods.slice(1));
  });

  it.each([['按子市场', 'submarket'], ['按等级', 'grade']])('a %s override still cannot expand explicitly named non-contiguous endpoints', (dimension, groupBy) => {
    const result = ask(`2026Q1与2026Q3${dimension}比较变化`, contextFor(cross()));
    expect(result).toMatchObject({ kind: 'clarification', clarification: { reason: 'unsupported' } });
    if (result.kind !== 'clarification') throw new Error('expected clarification');
    expect(result.clarification.options).toHaveLength(1);
    expect(ready(ask(result.clarification.options[0].question, result.context)).plan).toMatchObject({ operation: 'group_trend', groupBy, filter, start: availablePeriods[1], end: availablePeriods[3] });
    expect(ready(ask(`2026Q1至2026Q3${dimension}趋势`, contextFor(cross()))).plan).toMatchObject({ operation: 'group_trend', groupBy, start: availablePeriods[1], end: availablePeriods[3] });
  });

  it('keeps a supported ungrouped two-endpoint comparison unchanged', () => {
    const result = ready(ask('CBD净有效租金2026Q1与2026Q3比较'));
    expect(result.plan).toMatchObject({ operation: 'compare', base: availablePeriods[1], current: availablePeriods[3] });
    expect(result.interpretation.periods).toEqual([availablePeriods[1], availablePeriods[3]]);
  });

  it('accepts a complete bounded model proposal for both fixed dimensions', () => {
    const result = ready(ask('CBD、金融街净有效租金和空置率2025Q4至2026Q3按子市场和等级趋势表现如何', undefined, model));
    expect(result.plan).toMatchObject({ operation: 'cross_trend', scope, metrics: ['rent', 'vacancy'], start: availablePeriods[0], end: availablePeriods[3], mode: 'per_period' });
    expect(result.interpretation.method).toBe('validated_model_intent');
  });

  it.each([
    { operation: 'group_trend', groupBy: 'submarket' },
    { operation: 'group_trend', groupBy: 'grade' },
    { operation: 'trend' },
    { operation: 'cross_aggregate' },
    { metrics: undefined },
    { mode: 'paired' },
    { time: { kind: 'explicit', periods: [availablePeriods[1], availablePeriods[3]] } },
    { groupBy: 'submarket' },
  ])('rejects a model that drops or contradicts a confirmed cross-trend slot: %o', patch => {
    expect(ask('CBD、金融街净有效租金和空置率2025Q4至2026Q3按子市场和等级趋势如何', undefined, { ...model, ...patch })).toMatchObject({ kind: 'clarification', clarification: { reason: 'invalid_model_intent' } });
  });

  it('rejects an invented cross dimension and does not trust a model to discard historical classification or a third dimension', () => {
    expect(ask('CBD、金融街净有效租金和空置率2025Q4至2026Q3按子市场趋势如何', undefined, model)).toMatchObject({ kind: 'clarification', clarification: { reason: 'invalid_model_intent' } });
    expect(() => parseSemanticIntent({ ...model, groupBy: 'grade' })).toThrow();
    for (const extra of ['按当时等级', '按历史等级', '按楼龄']) {
      expect(ask(`CBD、金融街净有效租金和空置率2025Q4至2026Q3按子市场和等级趋势${extra}`, undefined, model).kind).toBe('clarification');
    }
  });

  it('keeps latest-period lookup separate for each metric and includes inherited numeric filters', () => {
    const prior = { ...cross(), filter: { field: 'vacantArea', operator: 'gt', value: '0' } } as QueryPlan;
    expect(inferSemanticPeriodFieldGroups('最近四季度变化', contextFor(prior))).toEqual([['vacantArea', 'totalArea', 'netEffectiveRent'], ['vacantArea', 'totalArea']]);
  });

  it('offers authorized cross trends and paired samples without losing filters or building restrictions', () => {
    const single = ready(ask('2026Q3CBD、金融街建筑高度大于100米净有效租金和空置率按子市场和等级交叉统计'));
    const plan = { ...single.plan, scope: { ...single.plan.scope, buildingIds: ['00000000-0000-4000-8000-000000000001'] } } as QueryPlan;
    const suggestions = buildSemanticSuggestions({ plan, availablePeriods, authority, allowedSubmarkets: ['CBD', '金融街', '中关村'] });
    const trend = suggestions.find(item => item.id === 'recent_four_quarters');
    expect(trend?.plan).toMatchObject({ operation: 'cross_trend', metrics: ['rent', 'vacancy'], scope: plan.scope, filter, start: availablePeriods[0], end: availablePeriods[3] });
    expect(trend?.question).toContain('按子市场和等级趋势');
    if (!trend) throw new Error('missing cross trend suggestion');
    expect(buildSemanticSuggestions({ plan: trend.plan, availablePeriods, authority }).find(item => item.id === 'paired_sample')?.plan).toMatchObject({ operation: 'cross_trend', mode: 'paired', scope: plan.scope, filter });
    expect(suggestions.some(item => item.id === 'compare_submarket')).toBe(false);
    expect(buildSemanticSuggestions({ plan, availablePeriods, authority: { ...authority, fields: ['height', 'totalArea', 'netEffectiveRent'] } }).some(item => item.id === 'recent_four_quarters')).toBe(false);
  });

  it('cross-trend suggestions preserve both dimensions and the complete time window when adding an authorized market', () => {
    const plan = { ...cross(), scope: { inventory: 'tracked', submarkets: ['CBD'] }, metric: 'rent', metrics: undefined, mode: 'paired' } as QueryPlan;
    const suggestions = buildSemanticSuggestions({ plan, availablePeriods, authority, allowedSubmarkets: ['CBD', '金融街'] });
    expect(suggestions.find(item => item.id === 'same_period_vacancy')?.plan).toMatchObject({ operation: 'cross_aggregate', period: availablePeriods[3], metric: 'vacancy', filter });
    expect(suggestions.find(item => item.id === 'compare_submarket')?.plan).toMatchObject({ operation: 'cross_trend', scope, start: availablePeriods[0], end: availablePeriods[3], mode: 'paired', filter });
  });

  it('legacy strict grammar accepts a canonical cross range and rejects unconsumed or invalid conditions', () => {
    expect(resolveBusinessQuestion('CBD、金融街净有效租金2025Q4至2026Q3按子市场和等级趋势全期间共同样本')).toMatchObject({ kind: 'plan', plan: { operation: 'cross_trend', scope, mode: 'paired', start: availablePeriods[0], end: availablePeriods[3] } });
    for (const question of ['CBD净有效租金2026Q1至2026Q3按子市场和等级趋势各期样本且楼龄5年', 'CBD净有效租金2026Q3至2026Q3按子市场和等级趋势各期样本', 'CBD净有效租金2026Q1与2026Q3按子市场和等级趋势各期样本']) expect(resolveBusinessQuestion(question).kind).toBe('clarification');
  });
});
