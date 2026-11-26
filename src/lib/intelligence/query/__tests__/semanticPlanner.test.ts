import { describe, expect, it } from 'vitest';
import type { Quarter } from '../contracts';
import type { QueryPlan } from '../plan';
import type { QueryAuthority } from '../admission';
import { describePlanRead } from '../snapshotReader';
import { buildSemanticSuggestions, inferSemanticPeriodFields, inferSemanticScope, parseSemanticContext, parseSemanticIntent, resolveSemanticQuestion, type SemanticContext, type SemanticResolution } from '../semanticPlanner';

const now = new Date('2026-11-15T10:00:00Z');
const availablePeriods: Quarter[] = [{ year: 2025, quarter: 3 }, { year: 2025, quarter: 4 }, { year: 2026, quarter: 1 }, { year: 2026, quarter: 2 }, { year: 2026, quarter: 3 }];
const ask = (question: string, context?: SemanticContext, additional = {}) => resolveSemanticQuestion({ question, context, availablePeriods, now, ...additional });
const ready = (value: SemanticResolution) => { expect(value.kind).toBe('plan'); if (value.kind !== 'plan') throw new Error(JSON.stringify(value)); return value; };
const contextFor = (plan: QueryPlan): SemanticContext => ({ version: 'colliers-semantic-context/1', lastPlan: plan, comparisonSubmarkets: plan.scope.submarkets ?? [] });
const rentPlan: QueryPlan = { operation: 'aggregate', metric: 'rent', period: { year: 2026, quarter: 3 }, scope: { inventory: 'tracked', submarkets: ['CBD'] } };
const authority: QueryAuthority = { actorId: 'actor', effectiveUserId: 'actor', sessionActive: true, policyVersion: 'v', permissionRevision: 'v', grants: ['query:catalog', 'query:quarter', 'query:brochure'], fields: ['height', 'floors', 'parking', 'totalArea', 'vacantArea', 'netEffectiveRent'] };

describe('P1 structured semantic conversation', () => {
  it('T01-T03 inherits metric/period, retains both markets, then builds a real four-quarter comparison trend', () => {
    const first = ready(ask('2026 年第三季度 CBD 的净有效租金是多少？'));
    expect(first.plan).toEqual(rentPlan);
    const second = ready(ask('金融街呢？', first.context));
    expect(second.plan).toEqual({ ...rentPlan, scope: { ...rentPlan.scope, submarkets: ['金融街'] } });
    expect(second.context.comparisonSubmarkets).toEqual(['CBD', '金融街']);
    const third = ready(ask('把这两个地区对比一下。', second.context));
    expect(third.plan).toMatchObject({ operation: 'group_aggregate', metric: 'rent', period: { year: 2026, quarter: 3 }, groupBy: 'submarket', scope: { submarkets: ['CBD', '金融街'] } });
    const fourth = ready(ask('再看看过去四个季度的变化。', third.context));
    expect(fourth.plan).toMatchObject({ operation: 'group_trend', start: { year: 2025, quarter: 4 }, end: { year: 2026, quarter: 3 }, metric: 'rent', scope: { submarkets: ['CBD', '金融街'] } });
  });
  it('explicit metric, quarter and location override only the corresponding previous slots', () => {
    const next = ready(ask('2026Q2金融街空置率', contextFor(rentPlan)));
    expect(next.plan).toMatchObject({ operation: 'aggregate', metric: 'vacancy', period: { year: 2026, quarter: 2 }, scope: { submarkets: ['金融街'] } });
  });
  it('retains UUID scope, inventory and full predicates for elliptical followups', () => {
    const plan: QueryPlan = { ...rentPlan, scope: { ...rentPlan.scope, inventory: 'all_authorized', buildingIds: ['00000000-0000-4000-8000-000000000001'] }, filter: { field: 'height', operator: 'gt', value: '100' } };
    const next = ready(ask('金融街呢', contextFor(plan)));
    expect(next.plan).toEqual({ ...plan, scope: { ...plan.scope, submarkets: ['金融街'] } });
    expect(inferSemanticScope('金融街呢', contextFor(plan))).toEqual(next.plan.scope);
  });
  it('does not invent the referents for two/many and does not use an absent context', () => {
    expect(ask('把两者比较一下')).toMatchObject({ kind: 'clarification', clarification: { reason: 'ambiguous_reference' } });
    expect(ask('把两者比较一下', contextFor(rentPlan))).toMatchObject({ kind: 'clarification', clarification: { reason: 'ambiguous_reference' } });
    expect(ask('金融街呢')).toMatchObject({ kind: 'clarification', clarification: { reason: 'metric_required' } });
    expect(ask('它们如何', contextFor(rentPlan)).kind).toBe('clarification');
  });
  it('T04 clarifies price meaning and permits a short clickable answer without losing the initial question', () => {
    const initial = ask('CBD最贵的楼是哪栋？');
    expect(initial).toMatchObject({ kind: 'clarification', clarification: { reason: 'metric_required' } });
    if (initial.kind !== 'clarification') throw new Error();
    expect(initial.clarification.options.map(option => option.label)).toEqual(['净有效租金', '报价租金', '成交价格']);
    const second = ask('净有效租金', initial.context);
    expect(second).toMatchObject({ kind: 'clarification', clarification: { reason: 'period_required' } });
    if (second.kind !== 'clarification') throw new Error();
    const third = ready(ask('最新季度', second.context));
    expect(third.plan).toMatchObject({ operation: 'rank', field: 'netEffectiveRent', limit: 1, period: { year: 2026, quarter: 3 }, scope: { submarkets: ['CBD'] } });
    expect(ask('报价租金', initial.context)).toMatchObject({ kind: 'clarification', clarification: { reason: 'unsupported' } });
  });
  it('new generic rent does not inherit a prior vacancy meaning', () => {
    expect(ask('最贵的楼呢', contextFor({ ...rentPlan, metric: 'vacancy' }))).toMatchObject({ kind: 'clarification', clarification: { reason: 'metric_required' } });
  });
  it('T08 supports authorized submarket × grade analysis and explicitly refuses missing age/building-area fields', () => {
    expect(ready(ask('2026Q3CBD、金融街净有效租金按子市场和等级交叉统计')).plan).toMatchObject({ operation: 'cross_aggregate', scope: { submarkets: ['CBD', '金融街'] }, metric: 'rent' });
    expect(ask('比较CBD、金融街和望京三个子市场，不同楼龄写字楼的租金和空置率')).toMatchObject({ kind: 'clarification', clarification: { reason: 'unsupported' } });
    expect(ask('找出CBD近五年建成建筑面积超过5万平方米的写字楼，并查看净有效租金')).toMatchObject({ kind: 'clarification', clarification: { reason: 'unsupported' } });
    expect(ask('2026Q3CBD建筑面积')).toMatchObject({ kind: 'clarification', clarification: { reason: 'unsupported' } });
  });
  it('retains established brochure/list/distribution/relationship paths', () => {
    expect(ready(ask('CBD有哪些楼')).plan).toMatchObject({ operation: 'list', fields: [], period: null });
    expect(ready(ask('CBD最高的楼是什么')).plan).toMatchObject({ operation: 'rank', field: 'height', period: null });
    expect(ready(ask('2026Q3CBD建筑高度和净有效租金列表')).plan).toMatchObject({ operation: 'list', fields: ['height', 'netEffectiveRent'] });
    expect(ready(ask('2026Q3CBD净有效租金分布')).plan).toMatchObject({ operation: 'distribution', measure: 'rent' });
    expect(ready(ask('2026Q3CBD净有效租金和空置率关系')).plan).toMatchObject({ operation: 'relationship' });
  });
  it('does not silently select only one metric from a multi-metric request', () => {
    expect(ready(ask('比较2026Q3CBD、金融街净有效租金和空置率')).plan).toMatchObject({ operation: 'group_aggregate', metric: 'rent', metrics: ['rent', 'vacancy'], groupBy: 'submarket' });
  });
  it('changes an inherited trend into the explicitly requested single period', () => {
    const trend = ready(ask('CBD净有效租金最近四个季度变化'));
    expect(ready(ask('2026Q2呢', trend.context)).plan).toMatchObject({ operation: 'aggregate', metric: 'rent', period: { year: 2026, quarter: 2 } });
    expect(ready(ask('今年呢', contextFor(rentPlan))).plan).toMatchObject({ operation: 'trend', start: { year: 2026, quarter: 1 }, end: { year: 2026, quarter: 3 } });
  });
  it('inherits grade and cross dimensions when changing only the metric', () => {
    const grade = ready(ask('2026Q3CBD净有效租金按等级比较'));
    expect(ready(ask('空置率呢', grade.context)).plan).toMatchObject({ operation: 'group_aggregate', groupBy: 'grade', metric: 'vacancy' });
    const cross = ready(ask('2026Q3CBD净有效租金按子市场和等级交叉统计'));
    expect(ready(ask('空置率呢', cross.context)).plan).toMatchObject({ operation: 'cross_aggregate', metric: 'vacancy' });
    expect(ready(ask('最近四个季度变化', cross.context)).plan).toMatchObject({ operation: 'cross_trend', metric: 'rent', start: { year: 2025, quarter: 4 }, end: { year: 2026, quarter: 3 } });
  });
  it('P1-09 joins authorized catalog/brochure/quarter fields through existing numeric predicates', () => {
    const result = ready(ask('找出2026Q3CBD季度总面积超过5万平方米的楼，并查看净有效租金'));
    expect(result.plan).toMatchObject({ operation: 'list', fields: ['netEffectiveRent'], period: { year: 2026, quarter: 3 }, filter: { field: 'totalArea', operator: 'gt', value: '50000' } });
    expect(ready(ask('找出2026Q3CBD建筑高度大于100米且总车位数不少于1000个的写字楼，并查看净有效租金')).plan).toMatchObject({ operation: 'list', filter: { operator: 'and', terms: [{ field: 'height', operator: 'gt', value: '100' }, { field: 'parking', operator: 'gte', value: '1000' }] } });
  });
  it('numeric scaling is exact, OR is explicit, invalid units/mixed boolean precedence are refused', () => {
    expect(ready(ask('列出CBD季度总面积大于0.123456789012345万平方米的楼，2026Q3')).plan).toMatchObject({ filter: { value: '1234.56789012345' } });
    expect(ready(ask('列出CBD建筑高度大于100米或总车位数大于500个的楼')).plan).toMatchObject({ filter: { operator: 'or' } });
    for (const question of ['找出CBD高度大于100平方米的楼', '找出CBD高度大于100英尺的楼', '找出CBD高度大于100米或者总车位数大于100个且楼层数大于20层的楼', '找出CBD净有效租金大于5元/㎡/日的楼']) expect(ask(question).kind).toBe('clarification');
  });
  it('an explicitly changed numeric field replaces its previous condition and retains other constraints', () => {
    const prior = ready(ask('找出2026Q3CBD建筑高度大于100米且总车位数不少于1000个的楼，并查看净有效租金'));
    const next = ready(ask('建筑高度大于200米', prior.context));
    expect(next.plan).toMatchObject({ filter: { operator: 'and', terms: [{ field: 'parking', operator: 'gte', value: '1000' }, { field: 'height', operator: 'gt', value: '200' }] } });
  });
  it('availability field hints include effective-rent denominators and inherited filter fields', () => {
    expect(inferSemanticPeriodFields('最新季度CBD净有效租金')).toEqual(['totalArea', 'netEffectiveRent']);
    expect(inferSemanticPeriodFields('最新季度CBD空置率')).toEqual(['totalArea', 'vacantArea']);
    expect(inferSemanticPeriodFields('CBD建筑高度排名前3')).toEqual([]);
    expect(inferSemanticPeriodFields('金融街呢', contextFor(rentPlan))).toEqual(['totalArea', 'netEffectiveRent']);
    expect(inferSemanticPeriodFields('金融街季度总面积超过50000平方米呢', contextFor(rentPlan))).toEqual(['totalArea', 'netEffectiveRent']);
    expect(inferSemanticPeriodFields('找出CBD季度总面积超过5万平方米的楼，并查看净有效租金')).toEqual(['totalArea', 'netEffectiveRent']);
  });
  it('latest rent rankings and raw lists require only their actual fields, not the weighted rent denominator', () => {
    const question = 'CBD最新季度净有效租金最高的楼';
    expect(ask(question, undefined, { availablePeriods: [] })).toMatchObject({ kind: 'clarification', clarification: { reason: 'unavailable_periods' } });
    expect(inferSemanticPeriodFields(question)).toEqual(['netEffectiveRent']);
    const latestRentOnly = [{ year: 2026, quarter: 4 }];
    const rank = ready(ask(question, undefined, { availablePeriods: latestRentOnly }));
    expect(rank.plan).toMatchObject({ operation: 'rank', field: 'netEffectiveRent', period: latestRentOnly[0] });
    expect(inferSemanticPeriodFields(question).sort()).toEqual(describePlanRead(rank.plan).fields);
    for (const query of ['CBD最新季度净有效租金列表', 'CBD最新季度建筑高度和净有效租金列表']) {
      expect(inferSemanticPeriodFields(query)).toEqual(['netEffectiveRent']);
      const plan = ready(ask(query, undefined, { availablePeriods: latestRentOnly })).plan;
      expect(inferSemanticPeriodFields(query).sort()).toEqual(describePlanRead(plan).fields.filter(field => !['height', 'floors', 'parking'].includes(field)));
    }
    expect(inferSemanticPeriodFields('CBD最新季度净有效租金')).toEqual(['totalArea', 'netEffectiveRent']);
  });
  it('latest field hints preserve rank/list field plans without a metric property, including filter dependencies', () => {
    const rank: QueryPlan = { operation: 'rank', scope: rentPlan.scope, field: 'netEffectiveRent', period: rentPlan.period, limit: 5, direction: 'desc' };
    expect(inferSemanticPeriodFields('金融街最新季度净有效租金呢', contextFor(rank))).toEqual(['netEffectiveRent']);
    expect(inferSemanticPeriodFields('金融街最新季度呢', contextFor(rank))).toEqual(['netEffectiveRent']);
    const list: QueryPlan = { operation: 'list', scope: rentPlan.scope, fields: ['height', 'netEffectiveRent'], period: rentPlan.period };
    expect(inferSemanticPeriodFields('金融街最新季度呢', contextFor(list))).toEqual(['netEffectiveRent']);
    expect(inferSemanticPeriodFields('CBD最新季度净有效租金最高的楼，季度总面积超过50000平方米')).toEqual(['totalArea', 'netEffectiveRent']);
    for (const [question, context] of [['金融街最新季度呢', contextFor(rank)], ['金融街最新季度呢', contextFor(list)]] as const) {
      const plan = ready(ask(question, context)).plan;
      expect(inferSemanticPeriodFields(question, context).sort()).toEqual(describePlanRead(plan).fields.filter(field => !['height', 'floors', 'parking'].includes(field)));
    }
  });
  it('model rank/list field hints use their operation instead of an optional metric descriptor', () => {
    const rank = { version: 'colliers-semantic-intent/1', operation: 'rank', metric: 'rent', field: 'netEffectiveRent', unresolvedConditions: [] };
    expect(inferSemanticPeriodFields('CBD最新季度净有效租金最高的楼', undefined, rank)).toEqual(['netEffectiveRent']);
    expect(inferSemanticPeriodFields('CBD最新季度净有效租金列表', undefined, { ...rank, operation: 'list', fields: ['netEffectiveRent'] })).toEqual(['netEffectiveRent']);
    expect(inferSemanticPeriodFields('CBD最新季度空置面积列表')).toEqual(['vacantArea']);
    const prior: QueryPlan = { operation: 'rank', scope: rentPlan.scope, field: 'vacantArea', period: rentPlan.period, direction: 'desc', limit: 1 };
    const model = { ...rank, field: 'vacantArea' };
    const question = '金融街最新季度如何';
    const resolved = ready(ask(question, contextFor(prior), { modelIntent: model })).plan;
    expect(inferSemanticPeriodFields(question, contextFor(prior), model)).toEqual(['vacantArea']);
    expect(inferSemanticPeriodFields(question, contextFor(prior), model)).toEqual(describePlanRead(resolved).fields);
  });
});

describe('P1 available-business-period resolution', () => {
  it('uses the latest authorized period for formal-quarter ranking, without asking a provider to guess', () => {
    const availablePeriods = [{ year: 2026, quarter: 2 }];
    expect(ready(ask('CBD最新正式季度净有效租金前十栋', undefined, { availablePeriods })).plan)
      .toMatchObject({ operation: 'rank', field: 'netEffectiveRent', period: availablePeriods[0], limit: 10 });
  });

  it('retains a stated start quarter and resolves the end of a formal-quarter trend', () => {
    const availablePeriods = [{ year: 2025, quarter: 4 }, { year: 2026, quarter: 2 }];
    const resolution = ready(ask('金融街从2025Q1到最新正式季度的净有效租金和空置率趋势', undefined, { availablePeriods }));
    expect(resolution.plan).toMatchObject({ operation: 'trend', metrics: ['rent', 'vacancy'],
      start: { year: 2025, quarter: 1 }, end: { year: 2026, quarter: 2 } });
    expect(resolution.interpretation.unavailablePeriods).toContainEqual({ year: 2025, quarter: 1 });
    expect(ask('金融街从2026Q3到最新正式季度的净有效租金趋势', undefined, { availablePeriods }))
      .toMatchObject({ kind: 'clarification', clarification: { reason: 'period_required' } });
  });
  it('T05 uses latest actual period, even when calendar is later or database is lagging', () => {
    expect(ready(ask('最新季度CBD净有效租金')).plan).toMatchObject({ period: { year: 2026, quarter: 3 } });
    expect(ready(ask('最新季度CBD净有效租金', undefined, { availablePeriods: [{ year: 2024, quarter: 2 }] })).plan).toMatchObject({ period: { year: 2024, quarter: 2 } });
    expect(ask('最新季度CBD净有效租金', undefined, { availablePeriods: [] })).toMatchObject({ kind: 'clarification', clarification: { reason: 'unavailable_periods' } });
  });
  it.each(['最近四个季度', '过去4季度', '过去一年', '最近一年'])('resolves %s against actual latest data without calendar guessing', word => {
    expect(ready(ask(`分析CBD${word}净有效租金变化`)).plan).toMatchObject({ operation: 'trend', start: { year: 2025, quarter: 4 }, end: { year: 2026, quarter: 3 } });
  });
  it('keeps calendar previous/current semantics explicit, and prior-year same quarter uses conversation period', () => {
    expect(ready(ask('上季度CBD净有效租金')).plan).toMatchObject({ period: { year: 2026, quarter: 3 } });
    expect(ready(ask('本季度CBD净有效租金')).interpretation.unavailablePeriods).toEqual([{ year: 2026, quarter: 4 }]);
    expect(ready(ask('去年同期呢', contextFor(rentPlan))).plan).toMatchObject({ period: { year: 2025, quarter: 3 } });
    expect(ready(ask('今年第二季度CBD净有效租金')).plan).toMatchObject({ period: { year: 2026, quarter: 2 } });
  });
  it('this year is an explicit quarterly series through latest available quarter, not an invented annual metric', () => {
    const result = ready(ask('今年CBD净有效租金'));
    expect(result.plan).toMatchObject({ operation: 'trend', start: { year: 2026, quarter: 1 }, end: { year: 2026, quarter: 3 } });
    expect(result.limitations.join('')).toContain('不计算未定义的年度平均');
  });
  it('T10 keeps explicitly missing periods, flags missing observations and does not substitute a known quarter', () => {
    const result = ready(ask('2027Q2CBD净有效租金'));
    expect(result.plan).toMatchObject({ period: { year: 2027, quarter: 2 } });
    expect(result.interpretation.unavailablePeriods).toEqual([{ year: 2027, quarter: 2 }]);
  });
  it('keeps gaps inside a trend and preserves explicit paired sample mode', () => {
    const result = ready(ask('CBD净有效租金最近四个季度变化共同样本', undefined, { availablePeriods: [availablePeriods[1], availablePeriods[4]] }));
    expect(result.plan).toMatchObject({ operation: 'trend', mode: 'paired' });
    expect(result.interpretation.unavailablePeriods).toEqual([{ year: 2026, quarter: 1 }, { year: 2026, quarter: 2 }]);
  });
  it.each(['2026Q5CBD净有效租金', 'CBD净有效租金最近99个季度变化', '2026Q2最新季度CBD净有效租金', '最新已审定季度CBD净有效租金'])('rejects an invalid or ambiguous time: %s', question => {
    expect(ask(question).kind).toBe('clarification');
  });
});

describe('P1 bounded model intent and dynamic suggestions', () => {
  const intent = { version: 'colliers-semantic-intent/1', operation: 'aggregate', metric: 'rent', submarkets: ['CBD'], time: { kind: 'explicit', periods: [{ year: 2026, quarter: 3 }] }, unresolvedConditions: [] };
  it('T15 accepts schema-checked semantic slots for a paraphrase, preserving official execution plan', () => {
    const result = ready(ask('2026Q3CBD净有效租金水平怎么样', undefined, { modelIntent: intent }));
    expect(result.plan).toEqual(rentPlan);
    expect(result.interpretation.method).toBe('validated_model_intent');
  });
  it.each([{ sql: 'select * from auth.users' }, { operation: 'delete' }, { metric: 'askingRent' }, { time: { kind: 'explicit', periods: [{ year: 2026, quarter: 5 }] } }, { submarkets: ['CBD', 'CBD'] }, { limit: 9999 }])('rejects an illegal model plan: %o', patch => {
    expect(() => parseSemanticIntent({ ...intent, ...patch })).toThrow();
    expect(ask('2026Q3CBD净有效租金水平怎么样', undefined, { modelIntent: { ...intent, ...patch } })).toMatchObject({ kind: 'clarification', clarification: { reason: 'invalid_model_intent' } });
  });
  it('cannot widen scope or change explicit metrics/periods even with a schema-valid model response', () => {
    for (const patch of [{ allAuthorized: true, submarkets: undefined }, { submarkets: ['金融街'] }, { metric: 'vacancy' }, { time: { kind: 'explicit', periods: [{ year: 2026, quarter: 2 }] } }]) {
      expect(ask('2026Q3CBD净有效租金水平怎么样', undefined, { modelIntent: { ...intent, ...patch } })).toMatchObject({ kind: 'clarification', clarification: { reason: 'invalid_model_intent' } });
    }
  });
  it('never allows a model to discard explicit unsupported filters, data domains or unresolved conditions', () => {
    for (const suffix of ['但不要包含A楼', '仅限甲级', '季度总面积大约50000', '顺便提供业主联系方式', '楼龄5年以下']) {
      expect(ask(`2026Q3CBD净有效租金${suffix}`, undefined, { modelIntent: intent }).kind).toBe('clarification');
    }
    expect(ask('2026Q3CBD净有效租金水平怎么样', undefined, { modelIntent: { ...intent, unresolvedConditions: ['样本类型'] } })).toMatchObject({ kind: 'clarification' });
    expect(ask('2026Q3CBD净有效租金约100', undefined, { modelIntent: intent })).toMatchObject({ kind: 'clarification', clarification: { reason: 'invalid_model_intent' } });
    expect(ask('2026Q3CBD净有效租金甲级', undefined, { modelIntent: intent })).toMatchObject({ kind: 'clarification', clarification: { reason: 'invalid_model_intent' } });
  });
  it('a model cannot remove a deterministic numeric condition from a paraphrased question', () => {
    const result = ready(ask('2026Q3CBD净有效租金水平怎么样，季度总面积大于50000平方米', undefined, { modelIntent: intent }));
    expect(result.plan.filter).toEqual({ field: 'totalArea', operator: 'gt', value: '50000' });
  });
  it.each(['绿色认证', 'LEED认证', '临街', '外资持有', '国企持有', '带装修', '有落地窗', '可整租', '朝南', '智能化优秀'])('rejects an omitted unsupported condition even when a schema-valid model claims no unresolved slots: %s', condition => {
    for (const question of [`CBD2026Q3${condition}写字楼的净有效租金如何`, `CBD2026Q3净有效租金水平怎么样，${condition}`]) {
      expect(ask(question, undefined, { modelIntent: intent })).toMatchObject({ kind: 'clarification', clarification: { reason: 'invalid_model_intent' } });
    }
  });
  it('allows a bounded non-constraining inquiry only after all business slots are consumed', () => {
    for (const suffix of ['如何', '水平怎么样', '情况如何', '能反映些什么']) {
      expect(ready(ask(`2026Q3CBD净有效租金${suffix}`, undefined, { modelIntent: intent })).plan).toEqual(rentPlan);
    }
    // Appending a valid question phrase cannot make an unknown condition disappear.
    expect(ask('2026Q3CBD净有效租金水平怎么样条件X如何', undefined, { modelIntent: intent })).toMatchObject({ kind: 'clarification', clarification: { reason: 'invalid_model_intent' } });
  });
  it('rejects a model losing multiple periods, grouping, inherited paired mode or an explicit ranking limit', () => {
    expect(ask('CBD2026Q1至2026Q3净有效租金变化能反映些什么', undefined, { modelIntent: { ...intent, time: { kind: 'inherit' } } })).toMatchObject({ kind: 'clarification', clarification: { reason: 'invalid_model_intent' } });
    expect(ask('2026Q3CBD净有效租金按等级比较能反映些什么', undefined, { modelIntent: intent })).toMatchObject({ kind: 'clarification', clarification: { reason: 'invalid_model_intent' } });
    const prior: QueryPlan = { operation: 'trend', scope: rentPlan.scope, metric: 'rent', start: { year: 2026, quarter: 1 }, end: rentPlan.period, mode: 'paired' };
    expect(ask('最近四个季度净有效租金变化能反映些什么', contextFor(prior), { modelIntent: { ...intent, operation: 'trend', mode: 'per_period', time: { kind: 'rolling', count: 4 } } })).toMatchObject({ kind: 'clarification', clarification: { reason: 'invalid_model_intent' } });
    expect(ask('2026Q3CBD净有效租金排名前5能反映些什么', undefined, { modelIntent: { ...intent, operation: 'rank', field: 'netEffectiveRent', limit: 1 } })).toMatchObject({ kind: 'clarification', clarification: { reason: 'invalid_model_intent' } });
  });
  it('context is structurally bounded and has no authority/identity/SQL fields', () => {
    expect(() => parseSemanticContext({ ...contextFor(rentPlan), actorId: 'other' })).toThrow();
    expect(() => parseSemanticContext({ ...contextFor(rentPlan), lastPlan: { ...rentPlan, sql: 'select *' } })).toThrow();
  });
  it('T14 suggestions change by result and require actual capabilities and row-authorized comparison choices', () => {
    const rent = buildSemanticSuggestions({ plan: rentPlan, availablePeriods, authority, allowedSubmarkets: ['CBD', '金融街'] });
    expect(rent.map(item => item.id)).toContain('same_period_vacancy');
    expect(rent.map(item => item.id)).toContain('recent_four_quarters');
    expect(rent.find(item => item.id === 'compare_submarket')?.plan.scope.submarkets).toEqual(['CBD', '金融街']);
    expect(buildSemanticSuggestions({ plan: rentPlan, availablePeriods, authority }).some(item => item.id === 'compare_submarket')).toBe(false);
    const reduced = buildSemanticSuggestions({ plan: rentPlan, availablePeriods, authority: { ...authority, fields: ['netEffectiveRent', 'totalArea'] } });
    expect(reduced.some(item => item.id === 'same_period_vacancy')).toBe(false);
    expect(buildSemanticSuggestions({ plan: rentPlan, availablePeriods, authority: { ...authority, grants: [] } })).toEqual([]);
    const vacancy = buildSemanticSuggestions({ plan: { ...rentPlan, metric: 'vacancy' }, availablePeriods, authority });
    expect(vacancy.map(item => item.id)).toContain('same_period_rent');
    expect(vacancy.map(item => item.id)).not.toContain('highest_rent');
  });
  it('suggestion plans retain exact predicates and building scopes for parent-bound execution', () => {
    const plan: QueryPlan = { ...rentPlan, scope: { ...rentPlan.scope, buildingIds: ['00000000-0000-4000-8000-000000000001'] }, filter: { field: 'height', operator: 'gt', value: '100' } };
    const options = buildSemanticSuggestions({ plan, availablePeriods, authority, allowedSubmarkets: ['CBD', '金融街'] });
    for (const option of options) { expect(option.plan.filter).toEqual(plan.filter); expect(option.plan.scope.buildingIds).toEqual(plan.scope.buildingIds); }
    expect(options.some(option => option.id === 'compare_submarket')).toBe(false);
  });
  it('a followup metric keeps submarket/grade groups instead of pooling the groups', () => {
    const plan: QueryPlan = { operation: 'group_aggregate', metric: 'rent', scope: { ...rentPlan.scope, submarkets: ['CBD', '金融街'] }, period: rentPlan.period, groupBy: 'submarket' };
    expect(buildSemanticSuggestions({ plan, availablePeriods, authority }).find(option => option.id === 'same_period_vacancy')?.plan).toMatchObject({ operation: 'group_aggregate', groupBy: 'submarket', metric: 'vacancy', scope: { submarkets: ['CBD', '金融街'] } });
  });
});
