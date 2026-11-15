import { z } from 'zod';
import { authorizePlan, type QueryAuthority } from './admission';
import { quarterSchema, type Quarter } from './contracts';
import { parseQueryPlan, planPeriods, type QueryPlan } from './plan';
import { QUESTION_SUBMARKETS, resolveBusinessQuestion } from './question';
import { shanghaiQuarter, shiftQuarter } from './relativeQuarter';
import type { Predicate } from './facts';
import { numericFields, type NumericField } from './registry';
import { distributionFields } from './distribution';

export const SEMANTIC_PLANNER_VERSION = 'colliers-semantic-planner/1';
export type SemanticOption = { id: string; label: string; question: string };
export type SemanticClarification = {
  code: 'conditions_required';
  reason: 'metric_required' | 'period_required' | 'scope_required' | 'ambiguous_reference' | 'unsupported' | 'unrecognized' | 'unavailable_periods' | 'invalid_model_intent';
  message: string;
  options: SemanticOption[];
};
/** Only persisted in the authenticated audit stream. This is never a request-body contract. */
export type SemanticContext = {
  version: 'colliers-semantic-context/1';
  lastPlan?: QueryPlan;
  comparisonSubmarkets: string[];
  pending?: { question: string; clarification: SemanticClarification };
};
export type SemanticInterpretation = {
  version: typeof SEMANTIC_PLANNER_VERSION;
  method: 'bounded_semantic_rules' | 'validated_model_intent' | 'legacy_grammar';
  resolvedQuestion: string;
  periodBasis: string;
  periods: Quarter[];
  availableThrough: Quarter | null;
  unavailablePeriods: Quarter[];
  inherited: string[];
  notices: string[];
};
export type SemanticResolution =
  | { kind: 'plan'; plan: QueryPlan; context: SemanticContext; interpretation: SemanticInterpretation; limitations: string[] }
  | { kind: 'clarification'; clarification: SemanticClarification; context: SemanticContext };

const optionSchema = z.strictObject({ id: z.string().min(1).max(80), label: z.string().min(1).max(100), question: z.string().min(1).max(1000) });
const clarificationSchema = z.strictObject({
  code: z.literal('conditions_required'),
  reason: z.enum(['metric_required', 'period_required', 'scope_required', 'ambiguous_reference', 'unsupported', 'unrecognized', 'unavailable_periods', 'invalid_model_intent']),
  message: z.string().min(1).max(1000), options: z.array(optionSchema).max(5),
});
const contextSchema = z.strictObject({
  version: z.literal('colliers-semantic-context/1'), lastPlan: z.unknown().optional(),
  comparisonSubmarkets: z.array(z.enum(QUESTION_SUBMARKETS)).max(8),
  pending: z.strictObject({ question: z.string().min(1).max(6000), clarification: clarificationSchema }).optional(),
});
export function parseSemanticContext(value: unknown): SemanticContext {
  const context = contextSchema.parse(value);
  if (new Set(context.comparisonSubmarkets).size !== context.comparisonSubmarkets.length) throw new Error('DUPLICATE_CONTEXT_SCOPE');
  return { ...context, ...(context.lastPlan === undefined ? {} : { lastPlan: parseQueryPlan(context.lastPlan) }) } as SemanticContext;
}

const metricSchema = z.enum(['rent', 'vacancy', 'totalArea']);
type SemanticMetric = z.infer<typeof metricSchema>;
const aggregateOperations = ['aggregate', 'group_aggregate', 'cross_aggregate', 'trend', 'group_trend', 'compare'] as const;
const fieldSchema = z.enum(['height', 'floors', 'parking', 'totalArea', 'vacantArea', 'netEffectiveRent']);
const semanticTimeSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('latest') }),
  z.strictObject({ kind: z.literal('inherit') }),
  z.strictObject({ kind: z.literal('calendar_current') }),
  z.strictObject({ kind: z.literal('calendar_previous') }),
  z.strictObject({ kind: z.literal('last_year_same') }),
  z.strictObject({ kind: z.literal('rolling'), count: z.number().int().min(2).max(40) }),
  z.strictObject({ kind: z.literal('year'), year: z.number().int().min(1900).max(2200) }),
  z.strictObject({ kind: z.literal('explicit'), periods: z.array(quarterSchema).min(1).max(2) }),
]);
/** A model can propose only these slots, never SQL, results, authority or source records. */
export const semanticIntentSchema = z.strictObject({
  version: z.literal('colliers-semantic-intent/1'),
  operation: z.enum(['list', 'rank', 'aggregate', 'trend', 'compare', 'group_aggregate', 'group_trend', 'distribution', 'relationship', 'cross_aggregate']),
  submarkets: z.array(z.enum(QUESTION_SUBMARKETS)).min(1).max(8).optional(),
  allAuthorized: z.boolean().optional(),
  metric: metricSchema.optional(), metrics: z.array(metricSchema).min(2).max(3).optional(),
  field: fieldSchema.optional(), fields: z.array(fieldSchema).max(6).optional(),
  time: semanticTimeSchema.optional(), groupBy: z.enum(['submarket', 'grade']).optional(),
  mode: z.enum(['per_period', 'paired']).optional(), direction: z.enum(['asc', 'desc']).optional(),
  limit: z.number().int().min(1).max(100).optional(),
  unresolvedConditions: z.array(z.string().min(1).max(120)).max(10),
});
export type SemanticIntent = z.infer<typeof semanticIntentSchema>;
export function parseSemanticIntent(input: unknown): SemanticIntent {
  const intent = semanticIntentSchema.parse(input);
  if (intent.submarkets && new Set(intent.submarkets).size !== intent.submarkets.length) throw new Error('DUPLICATE_SEMANTIC_SCOPE');
  if (intent.allAuthorized && intent.submarkets) throw new Error('CONFLICTING_SEMANTIC_SCOPE');
  if (intent.fields && new Set(intent.fields).size !== intent.fields.length) throw new Error('DUPLICATE_SEMANTIC_FIELD');
  if (intent.metrics && (new Set(intent.metrics).size !== intent.metrics.length || intent.metric !== intent.metrics[0]
    || !aggregateOperations.some(operation => operation === intent.operation))) throw new Error('INVALID_SEMANTIC_METRICS');
  return intent;
}

const metricLabels = { rent: '净有效租金', vacancy: '空置率', totalArea: '季度总面积' } as const;
const fieldLabels = { height: '建筑高度', floors: '楼层数', parking: '总车位数', totalArea: '季度总面积', vacantArea: '空置面积', netEffectiveRent: '净有效租金' } as const;
const emptyContext = (): SemanticContext => ({ version: 'colliers-semantic-context/1', comparisonSubmarkets: [] });
const quarterIndex = (q: Quarter) => q.year * 4 + q.quarter - 1;
const quarterText = (q: Quarter) => `${q.year}Q${q.quarter}`;
const sameQuarter = (a: Quarter, b: Quarter) => quarterIndex(a) === quarterIndex(b);
const unique = <T,>(values: readonly T[]) => [...new Set(values)];
function planMetrics(plan?: QueryPlan): SemanticMetric[] {
  if (plan && 'metric' in plan) return plan.metrics ?? [plan.metric];
  const metric = planMetric(plan);
  return metric ? [metric] : [];
}
function explicitMetrics(text: string, prior?: QueryPlan): SemanticMetric[] {
  const knownRent = text.includes('净有效租金') || /租金|最贵|最便宜/.test(text) && planMetrics(prior).includes('rent');
  return [knownRent ? 'rent' : null, text.includes('空置率') ? 'vacancy' : null, text.includes('季度总面积') ? 'totalArea' : null]
    .filter((value): value is SemanticMetric => value !== null);
}
function selectedMetrics(text: string, prior?: QueryPlan): SemanticMetric[] {
  const stated = explicitMetrics(text, prior);
  const adding = /加上|再加|补充|一并看|一起看|也看|也加/.test(text);
  return stated.length ? adding ? unique([...planMetrics(prior), ...stated]) : stated : planMetrics(prior);
}
function metricSlots(metrics: SemanticMetric[]): { metric?: SemanticMetric; metrics?: SemanticMetric[] } {
  return { ...(metrics.length ? { metric: metrics[0] } : {}), ...(metrics.length > 1 ? { metrics } : {}) };
}
const numberWords: Record<string, number> = { 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10, 十二: 12 };
const countOf = (value: string) => numberWords[value] ?? Number(value);
function normalize(question: string): string {
  return question.trim().replace(/\s+/g, '').replace(/cbd/gi, 'CBD').replace(/q(?=\d)/g, 'Q')
    .replace(/(19\d{2}|20\d{2}|21\d{2}|2200)年第?([一二三四1-4])季度/g, (_, year, q) => `${year}Q${'一二三四'.includes(q) ? '一二三四'.indexOf(q) + 1 : q}`);
}
function detectedMarkets(text: string): string[] {
  const matches: { at: number; value: string }[] = [];
  for (const market of QUESTION_SUBMARKETS) {
    const at = text.indexOf(market);
    if (at >= 0) matches.push({ at, value: market });
  }
  if (!text.includes('望京-酒仙桥') && /望京/.test(text)) matches.push({ at: text.indexOf('望京'), value: '望京-酒仙桥' });
  return unique(matches.sort((a, b) => a.at - b.at).map(item => item.value));
}
const allScopePattern = /全部获权楼宇|全部获权范围|全部有权访问的楼宇/;
const pairReferencePattern = /两者|两地|这两(?:个)?(?:地区|子市场|区域)?|这两个/;
const manyReferencePattern = /这些(?:地区|子市场|区域)|上述(?:地区|子市场|区域)|它们/;
const pairedSamplePattern = /共同(?:有效)?样本|配对样本|同样本/;
function expandedPending(question: string, context: SemanticContext): string {
  if (!context.pending) return question;
  const text = normalize(question).replace(/[？?。！!，,]/g, '').replace(/^(选择|按|用|就按|查询|看看)/, '');
  const options = context.pending.clarification.options;
  const index = /^[1-5]$/.test(text) ? Number(text) - 1 : -1;
  return (options[index] ?? options.find(option => normalize(option.label) === text || option.id === text
    || context.pending?.clarification.reason === 'period_required' && text === '最新季度' && option.id === 'latest_period'))?.question ?? question;
}

const filterFieldAliases: Record<string, NumericField> = { 季度总面积: 'totalArea', 空置面积: 'vacantArea', 建筑高度: 'height', 高度: 'height', 楼层数: 'floors', 总车位数: 'parking', 车位数: 'parking', 净有效租金: 'netEffectiveRent' };
const filterOperators: Record<string, 'gt' | 'gte' | 'lt' | 'lte' | 'eq'> = {
  大于等于: 'gte', 不少于: 'gte', 不低于: 'gte', 至少: 'gte', '>=': 'gte', '≥': 'gte',
  小于等于: 'lte', 不超过: 'lte', 不高于: 'lte', 至多: 'lte', '<=': 'lte', '≤': 'lte',
  超过: 'gt', 大于: 'gt', 高于: 'gt', 多于: 'gt', '>': 'gt', 小于: 'lt', 低于: 'lt', 少于: 'lt', '<': 'lt', 等于: 'eq', '=': 'eq',
};
function decimalMagnitude(raw: string, magnitude: string): string {
  if (raw.length > 70) throw new Error('FILTER_PRECISION_LIMIT');
  const power = ({ 万: 4, 千: 3, 亿: 8 } as Record<string, number>)[magnitude] ?? 0;
  const negative = raw.startsWith('-');
  const [integer, fraction = ''] = raw.replace(/^[+-]/, '').split('.');
  const digits = `${integer}${fraction}`;
  const split = integer.length + power;
  const integerResult = (digits.slice(0, split) + '0'.repeat(Math.max(0, split - digits.length))).replace(/^0+(?=\d)/, '');
  const fractionResult = digits.slice(split).replace(/0+$/, '');
  return `${negative ? '-' : ''}${integerResult}${fractionResult ? `.${fractionResult}` : ''}`;
}
function numericConditions(text: string): { text: string; filter?: Predicate; fields: NumericField[]; error?: string } {
  const terms: Predicate[] = [];
  const fields: NumericField[] = [];
  const spans: { start: number; end: number }[] = [];
  let error: string | undefined;
  const pattern = /(季度总面积|空置面积|建筑高度|高度|楼层数|总车位数|车位数|净有效租金)(大于等于|小于等于|不少于|不低于|不超过|不高于|至少|至多|超过|大于|高于|多于|小于|低于|少于|等于|>=|<=|[><=≥≤])([+-]?\d+(?:\.\d+)?)(万|千|亿)?(元\/(?:平方米|㎡|m2|m²)\/月|元每(?:平方米|平米)每月|平方米|平米|㎡|m2|m²|米|m|层|个)?/gi;
  const rest = text.replace(pattern, (full: string, label: string, operator: string, value: string, magnitude: string | undefined, unit: string | undefined, offset: number) => {
    const field = filterFieldAliases[label];
    const allowed = field === 'height' ? ['米', 'm'] : field === 'floors' ? ['层'] : field === 'parking' ? ['个'] : field === 'netEffectiveRent' ? ['元/平方米/月', '元/㎡/月', '元/m2/月', '元/m²/月', '元每平方米每月', '元每平米每月'] : ['平方米', '平米', '㎡', 'm2', 'm²'];
    if (unit && !allowed.includes(unit.toLowerCase())) error = '筛选条件的单位与指标口径不一致，不能自动换算或忽略。';
    if (/^(?:万|千|亿|w|k|米|平方|㎡|层|个|元|亩|公顷|英尺|m|\/|\d)/i.test(text.slice(offset + full.length))) error = '筛选数值或单位尚未可靠识别，请使用明确的米、平方米、层、个或元/㎡/月。';
    try { terms.push({ field, operator: filterOperators[operator], value: decimalMagnitude(value, magnitude ?? '') }); }
    catch { error = '筛选数值过长，无法可靠执行。'; }
    fields.push(field); spans.push({ start: offset, end: offset + full.length });
    return '';
  });
  if (terms.length > 12) error = '一次最多支持 12 项明确数值条件。';
  const connections = spans.slice(1).map((span, i) => text.slice(spans[i].end, span.start));
  const hasOr = connections.some(value => /或|\bor\b/i.test(value));
  if (hasOr && connections.some(value => /且|并|和|与|以及|同时|\band\b/i.test(value))) error = '混合“且／或”的条件需要明确括号分组；当前无法可靠确定优先级。';
  return { text: rest, fields: unique(fields), ...(terms.length ? { filter: terms.length === 1 ? terms[0] : { operator: hasOr ? 'or' : 'and', terms } as Predicate } : {}), ...(error ? { error } : {}) };
}
function predicateFields(predicate?: Predicate): NumericField[] {
  if (!predicate) return [];
  return 'terms' in predicate ? unique(predicate.terms.flatMap(predicateFields)) : [predicate.field];
}
function inheritedFilter(prior: Predicate | undefined, next: Predicate | undefined): Predicate | undefined {
  if (!prior || !next) return next ?? prior;
  const replaced = new Set(predicateFields(next));
  const keep = (value: Predicate): Predicate | undefined => {
    if (!('terms' in value)) return replaced.has(value.field) ? undefined : value;
    if (value.operator === 'or' && predicateFields(value).some(field => replaced.has(field))) throw new Error('AMBIGUOUS_FILTER_REPLACEMENT');
    const terms = value.terms.map(keep).filter((value): value is Predicate => value !== undefined);
    return terms.length === 1 ? terms[0] : terms.length ? { operator: value.operator, terms } : undefined;
  };
  const kept = keep(prior);
  return kept ? { operator: 'and', terms: [kept, next] } : next;
}

/** Required quarterly observations for latest-period lookup; grants are checked by the server. */
export function inferSemanticPeriodFields(question: string, contextInput?: SemanticContext, modelInput?: unknown): NumericField[] {
  const context = contextInput ? parseSemanticContext(contextInput) : emptyContext();
  const normalized = normalize(expandedPending(question, context));
  const conditions = numericConditions(normalized);
  const text = conditions.text;
  const prior = context.lastPlan;
  const model = modelInput === undefined ? undefined : parseSemanticIntent(modelInput);
  const statedMetrics = explicitMetrics(text, prior);
  const metrics = selectedMetrics(text, prior);
  const knownMetric = metrics[0];
  const metric = knownMetric ?? model?.metric;
  const explicitFields = (Object.keys(fieldLabels) as NumericField[]).filter(value => text.includes(fieldLabels[value]));
  let field: NumericField | undefined = explicitFields[0] ?? (knownMetric === 'rent' ? 'netEffectiveRent' : knownMetric === 'totalArea' ? 'totalArea' : prior?.operation === 'rank' ? prior.field : undefined);
  if (/最高的楼|最高楼/.test(text) && !/租金|最贵|空置率/.test(text)) field = 'height';
  field ??= model?.field;
  const rank = /最贵|最便宜|最高|最低|排名|排前|前\d+栋|前[二三四五六七八九十]栋/.test(text);
  const list = /有哪些|有多少栋|楼宇列表|楼列表|列表|列出|清单|找出|筛出|筛选/.test(text);
  const distribution = /分布|分位数|直方图|箱线图/.test(text);
  const relationship = /关系|相关性|相关关系/.test(text) && statedMetrics.includes('rent') && statedMetrics.includes('vacancy');
  const changesOperation = /变化|趋势|最近|过去|逐季|比较|对比|同比|环比|按子市场|各子市场|按等级|不同等级|各等级|交叉/.test(text)
    || pairReferencePattern.test(text) || manyReferencePattern.test(text);
  const multiplePeriods = [...text.matchAll(/(?:19\d{2}|20\d{2}|21\d{2}|2200)年?Q[1-4](?!\d)/g)].length > 1
    || /(?:最近|过去|近)[二两三四五六七八九十0-9]{1,2}个?(?:已结束)?季度|过去一年|最近一年|(?:今年|去年)(?!同期|Q[1-4]|第?[一二三四1-4]季度)|(?:19\d{2}|20\d{2}|21\d{2}|2200)年(?!Q)/.test(text);
  const preserve = prior && !rank && !list && !distribution && !relationship && !changesOperation && !multiplePeriods;
  const inheritedOperation = preserve && (!statedMetrics.length || ['rank', 'distribution'].includes(prior.operation)) ? prior.operation : undefined;
  const operation = model?.operation ?? (relationship ? 'relationship' : rank ? 'rank' : list ? 'list' : distribution ? 'distribution' : inheritedOperation ?? 'aggregate');
  let outputFields: readonly NumericField[];
  if (operation === 'rank') outputFields = !model && inheritedOperation === 'rank' && !statedMetrics.length && prior?.operation === 'rank' ? [prior.field] : field ? [field] : [];
  else if (operation === 'list') outputFields = model ? model.fields ?? explicitFields
    : list ? explicitFields.length ? explicitFields : conditions.fields.length ? conditions.fields : prior?.operation === 'list' ? prior.fields : []
      : prior?.operation === 'list' ? prior.fields : [];
  else if (operation === 'relationship') outputFields = ['totalArea', 'netEffectiveRent', 'vacantArea'];
  else if (operation === 'distribution') {
    const measure = metric ?? (inheritedOperation === 'distribution' && prior?.operation === 'distribution' ? prior.measure : field);
    outputFields = measure ? distributionFields(measure) : [];
  } else outputFields = (metrics.length ? metrics : model?.metrics ?? (metric ? [metric] : [])).flatMap(distributionFields);
  // A rent ranking/list consumes the observation itself; only weighted metrics
  // require totalArea. Adding that denominator would hide valid later periods.
  return unique([...conditions.fields, ...predicateFields(prior?.filter), ...outputFields]).filter(value => numericFields[value].temporal === 'quarter');
}

/** Aggregate metrics have independent valid samples. Availability therefore
 * intersects their periods, not the buildings satisfying every metric. */
export function inferSemanticPeriodFieldGroups(question: string, contextInput?: SemanticContext, modelInput?: unknown): NumericField[][] {
  const fields = inferSemanticPeriodFields(question, contextInput, modelInput);
  if (!fields.length) return [];
  const context = contextInput ? parseSemanticContext(contextInput) : emptyContext();
  const conditions = numericConditions(normalize(expandedPending(question, context)));
  const text = conditions.text;
  const model = modelInput === undefined ? undefined : parseSemanticIntent(modelInput);
  const metrics = selectedMetrics(text, context.lastPlan);
  const actual = metrics.length ? metrics : model?.metrics ?? (model?.metric ? [model.metric] : []);
  if (actual.length < 2 || /最贵|最便宜|最高|最低|排名|排前|前\d+栋|前[二三四五六七八九十]栋|有哪些|有多少栋|列表|列出|清单|找出|筛出|筛选|分布|分位数|直方图|箱线图|关系|相关性/.test(text)
    || model && !aggregateOperations.some(operation => operation === model.operation)) return [fields];
  const dependencies = [...conditions.fields, ...predicateFields(context.lastPlan?.filter)].filter(value => numericFields[value].temporal === 'quarter');
  return actual.map(metric => unique([...dependencies, ...distributionFields(metric)]));
}

/** Used only to scope an authorized period-availability read, never as authorization itself. */
export function inferSemanticScope(question: string, contextInput?: SemanticContext): QueryPlan['scope'] {
  const context = contextInput ? parseSemanticContext(contextInput) : emptyContext();
  const text = normalize(expandedPending(question, context));
  const prior = context.lastPlan?.scope;
  const markets = detectedMarkets(text);
  // Explicit scope replacement retains building IDs/inventory/filter in the planner.
  if (allScopePattern.test(text)) return { inventory: prior?.inventory ?? 'tracked', ...(prior?.buildingIds ? { buildingIds: prior.buildingIds } : {}) };
  if (markets.length) return { ...prior, inventory: prior?.inventory ?? 'tracked', submarkets: markets };
  if (pairReferencePattern.test(text) || manyReferencePattern.test(text)) {
    return { ...prior, inventory: prior?.inventory ?? 'tracked', ...(context.comparisonSubmarkets.length ? { submarkets: context.comparisonSubmarkets } : {}) };
  }
  return prior ? { ...prior } : { inventory: 'tracked' };
}

function planMetric(plan?: QueryPlan): 'rent' | 'vacancy' | 'totalArea' | undefined {
  if (!plan) return undefined;
  if ('metric' in plan) return plan.metric;
  if (plan.operation === 'rank') return plan.field === 'netEffectiveRent' ? 'rent' : plan.field === 'totalArea' ? 'totalArea' : undefined;
  if (plan.operation === 'distribution') return ['rent', 'vacancy', 'totalArea'].includes(plan.measure) ? plan.measure as 'rent' | 'vacancy' | 'totalArea' : undefined;
  return undefined;
}
function latestPlanPeriod(plan?: QueryPlan): Quarter | undefined {
  return plan ? planPeriods(plan).filter((q): q is Quarter => q !== null).at(-1) : undefined;
}
function validPeriods(periods: readonly Quarter[]): Quarter[] {
  if (periods.length > 1204) throw new Error('PERIOD_METADATA_TOO_LARGE');
  const byIndex = new Map(periods.map(q => { const valid = quarterSchema.parse(q); return [quarterIndex(valid), valid]; }));
  return [...byIndex.values()].sort((a, b) => quarterIndex(a) - quarterIndex(b));
}
function formatPlan(plan: QueryPlan): string {
  const markets = plan.scope.submarkets?.join('、') ?? '全部获权楼宇';
  const mode = 'mode' in plan ? plan.mode === 'paired' ? '全期间共同样本' : '各期样本' : '';
  const metricsLabel = planMetrics(plan).map(metric => metricLabels[metric]).join('和');
  if (plan.operation === 'trend' || plan.operation === 'group_trend') return `${markets}${metricsLabel}${quarterText(plan.start)}至${quarterText(plan.end)}${plan.operation === 'group_trend' ? `按${plan.groupBy === 'grade' ? '等级' : '子市场'}` : ''}趋势${mode}`;
  if (plan.operation === 'compare') return `${markets}${metricsLabel}${quarterText(plan.base)}与${quarterText(plan.current)}比较${plan.mode === 'paired' ? '配对样本' : '各期样本'}`;
  if (plan.operation === 'rank') return `${plan.period ? quarterText(plan.period) : ''}${markets}${fieldLabels[plan.field]}${plan.direction === 'desc' ? '最高' : '最低'}的前${plan.limit}栋楼`;
  if (plan.operation === 'list') return `${plan.period ? quarterText(plan.period) : ''}${markets}${plan.fields.map(field => fieldLabels[field]).join('和')}楼宇列表`;
  if (plan.operation === 'relationship') return `${quarterText(plan.period)}${markets}净有效租金和空置率关系`;
  if (plan.operation === 'distribution') return `${plan.period ? quarterText(plan.period) : ''}${markets}${plan.measure === 'rent' || plan.measure === 'vacancy' ? metricLabels[plan.measure] : fieldLabels[plan.measure]}分布`;
  return `${quarterText(plan.period)}${markets}${metricsLabel}${plan.operation === 'group_aggregate' ? `按${plan.groupBy === 'grade' ? '等级' : '子市场'}比较` : plan.operation === 'cross_aggregate' ? '按子市场和等级交叉统计' : ''}`;
}

export type ResolveSemanticInput = {
  question: string;
  /** Trusted metadata from real, authorized, non-draft observations, not a calendar guess. */
  availablePeriods: readonly Quarter[];
  now: Date;
  context?: SemanticContext;
  modelIntent?: unknown;
};

/** Conservative compositional interpretation. Unknown conditions are never silently discarded. */
export function resolveSemanticQuestion(input: ResolveSemanticInput): SemanticResolution {
  const context = input.context ? parseSemanticContext(input.context) : emptyContext();
  const question = expandedPending(input.question, context);
  const originalText = normalize(question);
  const conditions = numericConditions(originalText);
  const text = conditions.text;
  const prior = context.lastPlan;
  const clarify = (reason: SemanticClarification['reason'], message: string, options: SemanticOption[] = []): SemanticResolution => {
    const clarification: SemanticClarification = { code: 'conditions_required', reason, message, options: options.filter(option => option.question.length <= 1000) };
    return { kind: 'clarification', clarification, context: { ...context, pending: { question, clarification } } };
  };
  if (!originalText || question.length > 6000 || /[\u0000-\u001f\u007f]/.test(question)) return clarify('unrecognized', '问题为空、过长或包含无效字符，请重新描述查询条件。');
  if (conditions.error) return clarify('unsupported', conditions.error);
  if (/忽略.{0,6}(规则|指令|权限)|绕过|不受权限|SELECT\b|INSERT\b|UPDATE\b|DELETE\b|DROP\b|执行SQL|修改数据|删除数据/i.test(text)) return clarify('unsupported', '只支持经过授权的只读业务查询，不能执行 SQL、修改记录或绕过权限。');
  if (/建成|楼龄|竣工|投用年份/.test(text)) return clarify('unsupported', '竣工日期与楼龄尚未纳入当前 AI 的可信查询字段授权；现有“入市时间”也不能直接当作竣工日期。本次不会忽略楼龄条件继续查询。当前支持按子市场与等级比较净有效租金、空置率和季度总面积。');
  if (/建筑面积|总建筑面积|GFA/i.test(text)) return clarify('unsupported', '数据库已有建筑面积字段，但尚未纳入当前 AI 的可信查询字段授权。建筑面积与季度总面积不是同一口径，不能用季度总面积代替，也不会忽略这个条件执行。');
  if (/报价|表面租金|成交价|成交租金|成交价格|售价|佣金|业主|联系方式|租赁成交|合同/.test(text)) return clarify('unsupported', '当前 AI 查询授权支持净有效租金及季度指标，尚未接入报价、成交价格或租赁成交等数据域，不能用净有效租金替代这些指标。');
  if (/简单平均|算术平均|中位数租金|年度平均|年度汇总/.test(text)) return clarify('unsupported', '正式租金指标沿用有效总面积加权口径；本次不能改用简单平均或未经定义的年度汇总。可以按季度查看，或查询租金分布及分位数。');
  if (/已审定|已审核|正式发布|已发布/.test(text)) return clarify('unsupported', '现有可用期间只证明有非草稿数据，不能证明该季度已经审定或正式发布。请使用明确季度或“最新有数据季度”。');
  if (/不要|不含|不包括|不包含|不统计|不查询|不看|排除|剔除|仅限|只要|只看|只统计|除了|超过|大于|小于|少于|至少|至多|以上|以下|>=|<=|[<>]/.test(text)) return clarify('unsupported', '本句包含尚未可靠解析的排除或数值筛选条件，不能忽略条件执行。支持季度总面积、空置面积、建筑高度、楼层数、总车位数及净有效租金的明确数值比较。');
  if (/英亩|公顷|平方英尺|美元|港币|每天|每日|\/天|\/日/.test(text)) return clarify('unsupported', '条件中的单位尚未纳入正式指标换算口径，不能自动换算。');
  if (/核心区|附近|周边|步行|地铁|沿线|半径|东区|西区|南区|北区/.test(text)) return clarify('unsupported', '当前查询使用已定义子市场边界，尚不支持核心区、周边距离或地铁沿线等空间筛选；不会将这些条件替换成整个子市场。');

  const periods = validPeriods(input.availablePeriods);
  const latest = periods.at(-1);
  const calendar = shanghaiQuarter(input.now);
  const explicitMarkets = detectedMarkets(text);
  const pairReference = pairReferencePattern.test(text);
  const manyReference = manyReferencePattern.test(text);
  if ((pairReference || manyReference) && explicitMarkets.length) return clarify('ambiguous_reference', '请直接列出需要比较的子市场，避免“这两个”和新地区混在一起造成比较对象不明确。');
  if (pairReference && context.comparisonSubmarkets.length !== 2) return clarify('ambiguous_reference', '当前上下文不能唯一确定“两者”。请明确要比较的两个子市场。');
  if (manyReference && context.comparisonSubmarkets.length < 2) return clarify('ambiguous_reference', '当前上下文没有明确的多个比较对象，请列出子市场。');
  const scope = inferSemanticScope(question, context);
  if (!explicitMarkets.length && !pairReference && !manyReference && !allScopePattern.test(text) && !prior?.scope.submarkets && !prior?.scope.buildingIds && !prior) {
    return clarify('scope_required', '需要查询哪个子市场？也可以明确选择“全部获权楼宇”。');
  }
  const inherited: string[] = [];
  if (!explicitMarkets.length && !allScopePattern.test(text) && prior) inherited.push('子市场及楼宇范围');
  if (prior?.filter) inherited.push('筛选条件');
  const notices: string[] = [];
  if (/望京/.test(text) && !text.includes('望京-酒仙桥')) notices.push('“望京”按当前目录的“望京-酒仙桥”子市场处理，包含酒仙桥，未单独划出望京。');

  const metricMatches = explicitMetrics(text, prior);
  let metrics = selectedMetrics(text, prior);
  const relation = /关系|相关性|相关关系/.test(text) && metricMatches.includes('rent') && metricMatches.includes('vacancy');
  let metric: SemanticMetric | undefined = metrics[0];
  const bareRent = /租金|最贵|最便宜/.test(text) && !text.includes('净有效租金');
  if (bareRent && !planMetrics(prior).includes('rent')) {
    const replacement = (name: string) => question.replace(/最贵|最便宜|租金/g, value => value === '最贵' ? `${name}最高` : value === '最便宜' ? `${name}最低` : name);
    return clarify('metric_required', '“租金／最贵”可能指不同价格口径，请选择要比较的指标。', [
      { id: 'net_effective_rent', label: '净有效租金', question: replacement('净有效租金') },
      { id: 'asking_rent', label: '报价租金', question: replacement('报价租金') },
      { id: 'transaction_price', label: '成交价格', question: replacement('成交价格') },
    ]);
  }
  if (!metricMatches.length && metric) inherited.push('指标口径');
  const explicitFields = (Object.keys(fieldLabels) as (keyof typeof fieldLabels)[]).filter(field => text.includes(fieldLabels[field]));
  let field: keyof typeof fieldLabels | undefined = explicitFields[0] ?? (metric === 'rent' ? 'netEffectiveRent' : metric === 'totalArea' ? 'totalArea' : prior?.operation === 'rank' ? prior.field : undefined);
  if (/最高的楼|最高楼/.test(text) && !/租金|最贵|空置率/.test(text)) field = 'height';
  const rank = /最贵|最便宜|最高|最低|排名|排前|前\d+栋|前[二三四五六七八九十]栋/.test(text);
  const isList = /有哪些|有多少栋|楼宇列表|楼列表|列表|列出|清单|找出|筛出|筛选/.test(text);
  const distribution = /分布|分位数|直方图|箱线图/.test(text);
  if (relation && metricMatches.length !== 2) return clarify('unsupported', '当前关系分析专门比较同季度净有效租金与空置率，不能静默忽略其他指标。可以查询这些指标的分组比较或趋势。');
  if ((rank || distribution) && metricMatches.length > 1) return clarify('unsupported', '逐楼排名或分布需要明确一个指标；多指标支持统一聚合、分组、两期比较和趋势，不会只挑其中一个指标执行。');
  if (isList && metricMatches.includes('vacancy')) return clarify('unsupported', '逐楼原始字段列表尚不支持计算后的空置率列，不能用空置面积代替。可以查询净有效租金与空置率的聚合、分组比较或趋势。');
  if ((rank || distribution) && !metricMatches.length && !explicitFields.length && planMetrics(prior).length > 1) return clarify('metric_required', '上一轮包含多个指标，请选择本次排名或分布要使用的指标。', planMetrics(prior).map(value => ({ id: `select_${value}`, label: metricLabels[value], question: `${metricLabels[value]}${question}` })));
  const explicitCross = /按子市场(?:和|与|×)等级|子市场.*等级.*交叉/.test(text);
  const byGrade = /按等级|不同等级|各等级/.test(text);
  const explicitGrouping = byGrade || /按子市场|各子市场/.test(text);
  const wantsTrend = /变化|趋势|最近|过去|逐季/.test(text);
  const comparing = /比较|对比|同比|环比/.test(text) || pairReference || manyReference;
  const cross = explicitCross || byGrade && (scope.submarkets?.length ?? 0) > 1
    || prior?.operation === 'cross_aggregate' && !wantsTrend && !rank && !isList && !distribution && !relation && !byGrade && !/按子市场|各子市场/.test(text);
  if (prior?.operation === 'cross_aggregate' && wantsTrend && !/按等级|按子市场/.test(text)) return clarify('unsupported', '上一轮包含子市场×等级两个分组维度，目前多季度趋势一次支持一个分组维度。请明确按子市场还是按等级查看趋势。');
  const groupBy: 'submarket' | 'grade' | undefined = byGrade ? 'grade' : cross ? undefined
    : /按子市场|各子市场/.test(text) || (explicitMarkets.length > 1 && comparing) || pairReference || manyReference ? 'submarket'
      : prior && 'groupBy' in prior ? prior.groupBy : scope.submarkets && scope.submarkets.length > 1 ? 'submarket' : undefined;
  const mode: 'per_period' | 'paired' = pairedSamplePattern.test(text) ? 'paired' : /各期(?:有效)?样本/.test(text) ? 'per_period' : prior && 'mode' in prior ? prior.mode : 'per_period';

  let remaining = text;
  let requestedPeriods: Quarter[] = [];
  let periodBasis = '未指定期间';
  const consume = (pattern: RegExp) => { remaining = remaining.replace(pattern, ''); };
  // Explicit years and quarters are read before remaining date expressions.
  const expandedYears = remaining.replace(/(今年|去年)(?:Q([1-4])|第?([一二三四1-4])季度)/g, (_, year, q, cq) => `${calendar.year - (year === '去年' ? 1 : 0)}Q${q || ('一二三四'.includes(cq) ? '一二三四'.indexOf(cq) + 1 : cq)}`);
  remaining = expandedYears;
  const absolute = [...remaining.matchAll(/(19\d{2}|20\d{2}|21\d{2}|2200)年?Q([1-4])(?!\d)/g)].map(match => ({ year: Number(match[1]), quarter: Number(match[2]) }));
  if (absolute.length > 2) return clarify('unsupported', '目前支持一个季度、两期比较或连续季度范围，请明确起止季度。');
  if (absolute.length) { requestedPeriods = absolute; periodBasis = '用户明确指定季度'; consume(/(?:19\d{2}|20\d{2}|21\d{2}|2200)年?Q[1-4](?!\d)/g); }
  const rolling = /(?:最近|过去|近)([二两三四五六七八九十0-9]{1,2})个?(已结束)?季度(（含本季度）|\(含本季度\))?/.exec(remaining);
  const pastYear = /过去一年|最近一年/.test(remaining);
  const explicitLatest = /最新(?:有数据的?|可用的?)?(?:季度)?|最近一期/.test(remaining);
  const current = /本季度|这季度|当前季度/.test(remaining) && !rolling;
  const previous = /上一季度|上个季度|上季度/.test(remaining);
  const lastYearSame = /去年同期/.test(remaining);
  const yearMatch = /(?<!\d)(19\d{2}|20\d{2}|21\d{2}|2200)年|今年|去年(?!同期)/.exec(remaining);
  const relativeCount = Number(Boolean(rolling || pastYear)) + Number(explicitLatest) + Number(current) + Number(previous) + Number(lastYearSame) + Number(Boolean(yearMatch));
  if (relativeCount > 1 || (absolute.length && relativeCount)) return clarify('period_required', '问题中有多个可能冲突的时间条件，请明确季度或连续起止季度。');
  if (rolling || pastYear) {
    const count = rolling ? countOf(rolling[1]) : 4;
    if (!Number.isInteger(count) || count < 2 || count > 40) return clarify('unsupported', '趋势窗口支持连续 2–40 个季度。');
    const end = rolling?.[3] ? calendar : rolling?.[2] ? shiftQuarter(calendar, -1) : latest;
    if (!end) return clarify('unavailable_periods', '当前获权范围没有可用于确定最新季度的有效业务数据，请指定季度或检查数据。');
    try { requestedPeriods = [shiftQuarter(end, 1 - count), end]; } catch { return clarify('period_required', '所需期间超出了支持的年份范围。'); }
    periodBasis = rolling?.[3] ? '截至接收时北京时间所在季度' : rolling?.[2] ? '截至接收时上一日历季度' : '截至当前获权范围最新有有效数据的季度';
    consume(/(?:最近|过去|近)[二两三四五六七八九十0-9]{1,2}个?(?:已结束)?季度(?:（含本季度）|\(含本季度\))?|过去一年|最近一年/g);
  } else if (explicitLatest) {
    if (!latest) return clarify('unavailable_periods', '当前获权范围没有可用于确定“最新季度”的有效业务数据，不能把当前自然季度当作最新数据。');
    requestedPeriods = [latest]; periodBasis = '当前获权范围最新有有效数据的季度';
    consume(/最新(?:有数据的?|可用的?)?(?:季度)?|最近一期/g);
  } else if (current || previous || lastYearSame) {
    const anchor = lastYearSame ? latestPlanPeriod(prior) ?? latest : calendar;
    if (!anchor) return clarify('unavailable_periods', '尚无明确比较季度，也没有可用业务期间，无法确定“去年同期”。');
    try { requestedPeriods = [shiftQuarter(anchor, previous ? -1 : lastYearSame ? -4 : 0)]; } catch { return clarify('period_required', '所需期间超出了支持的年份范围。'); }
    periodBasis = lastYearSame ? `以${quarterText(anchor)}为基准向前四个季度` : '接收时北京时间对应的日历季度';
    consume(/本季度|这季度|当前季度|上一季度|上个季度|上季度|去年同期/g);
  } else if (yearMatch) {
    const year = yearMatch[1] ? Number(yearMatch[1]) : calendar.year - (yearMatch[0] === '去年' ? 1 : 0);
    const yearPeriods = periods.filter(period => period.year === year);
    if (!yearPeriods.length) return clarify('unavailable_periods', `${year}年在当前获权范围没有可用的有效季度数据，不生成年度数值。`);
    const end = year === calendar.year ? yearPeriods.at(-1)! : { year, quarter: 4 };
    requestedPeriods = end.quarter === 1 ? [end] : [{ year, quarter: 1 }, end];
    periodBasis = `${year}年按季度展示${year === calendar.year ? '，截至本年最新有数据季度' : ''}，不计算未定义的年度平均`;
    notices.push(periodBasis); consume(/(?:19\d{2}|20\d{2}|21\d{2}|2200)年|今年|去年/g);
  } else if (!absolute.length && prior) {
    requestedPeriods = planPeriods(prior).filter((q): q is Quarter => q !== null);
    if (requestedPeriods.length > 2) requestedPeriods = [requestedPeriods[0], requestedPeriods.at(-1)!];
    periodBasis = '继承上一轮已执行的明确期间';
    if (requestedPeriods.length) inherited.push('季度及统计口径');
  }
  if (cross && requestedPeriods.length > 1) return clarify('unsupported', '当前支持单季度子市场×等级交叉比较；多季度趋势一次支持一个分组维度。请明确按子市场还是按等级查看，不能将两个维度合并后冒充原比较。');

  let model: SemanticIntent | undefined;
  if (input.modelIntent !== undefined) {
    try { model = parseSemanticIntent(input.modelIntent); } catch { return clarify('invalid_model_intent', '语义服务返回了未通过结构和字段校验的计划，请明确子市场、指标和季度后重试。'); }
    if (model.unresolvedConditions.length) return clarify('unrecognized', `尚不能可靠确定这些条件：${model.unresolvedConditions.join('、')}。请补充或简化问题。`);
    // A semantic provider is not allowed to introduce or widen locations absent
    // from the submitted question or authenticated prior context.
    if (model.allAuthorized && !allScopePattern.test(text) || model.submarkets && JSON.stringify(model.submarkets) !== JSON.stringify(scope.submarkets)) return clarify('invalid_model_intent', '语义服务的地区范围与问题或已确认上下文不一致，请明确地区。');
    if (metrics.length > 1 && !isList && !relation && !aggregateOperations.some(operation => operation === model!.operation)) return clarify('invalid_model_intent', '多指标聚合需求不能改成列表、单指标操作或未要求的关系分析。');
    if (aggregateOperations.some(operation => operation === model!.operation)) {
      const proposed = model.metrics ?? (model.metric ? [model.metric] : metrics);
      if (metrics.length && (proposed.length !== metrics.length || proposed.some((value, index) => value !== metrics[index]))) return clarify('invalid_model_intent', '语义服务没有完整保留明确或继承的指标组合，不能添加、遗漏或替换其中的指标。');
    } else if (metricMatches.length > 1 && !['list', 'relationship'].includes(model.operation)) return clarify('invalid_model_intent', '语义服务将多个指标缩减成了单一指标操作。');
    if (metricMatches.length === 1 && model.metric && model.metric !== metricMatches[0]) return clarify('invalid_model_intent', '语义服务的指标与明确问题不一致，请重新指定指标。');
    if (model.metric && metric && model.metric !== metric || model.field && explicitFields.length === 1 && model.field !== explicitFields[0]) return clarify('invalid_model_intent', '语义服务的字段与明确问题或继承口径不一致。');
    if (pairedSamplePattern.test(text) && model.mode && model.mode !== 'paired') return clarify('invalid_model_intent', '语义服务改变了明确要求的共同样本口径。');
    if (rank && model.operation !== 'rank' || isList && model.operation !== 'list' || relation && model.operation !== 'relationship' || distribution && model.operation !== 'distribution') return clarify('invalid_model_intent', '语义服务的操作与问题中明确要求的操作不一致。');
    if (model.operation === 'list' && model.fields && explicitFields.some(value => !model!.fields!.includes(value))) return clarify('invalid_model_intent', '语义服务遗漏了问题中明确要求的字段。');
    if (explicitFields.some(value => ['height', 'floors', 'parking', 'vacantArea'].includes(value)) && !['list', 'rank', 'distribution'].includes(model.operation)) return clarify('invalid_model_intent', '语义服务不能把多个明确字段缩减成一个季度指标。');
    if (requestedPeriods.length > 1 && !['trend', 'group_trend', 'compare'].includes(model.operation)) return clarify('invalid_model_intent', '语义服务遗漏了请求中的其他季度，不能仅执行第一个季度。');
    if (requestedPeriods.length > 1 && wantsTrend && !['trend', 'group_trend'].includes(model.operation)) return clarify('invalid_model_intent', '语义服务没有保留明确要求的季度趋势。');
    if (cross && model.operation !== 'cross_aggregate') return clarify('invalid_model_intent', '语义服务没有保留子市场与等级的交叉维度。');
    if (groupBy && !cross && !rank && !isList && !distribution && !relation && (!['group_aggregate', 'group_trend'].includes(model.operation) || model.groupBy && model.groupBy !== groupBy)) return clarify('invalid_model_intent', '语义服务没有保留已确认的分组维度。');
    if (model.mode && model.mode !== mode) return clarify('invalid_model_intent', '语义服务改变了明确或继承的样本统计口径。');
    const explicitLimit = /(?:排名前|前)(\d{1,3}|[二三四五六七八九十])/.exec(text);
    if (explicitLimit && model.limit && model.limit !== countOf(explicitLimit[1])) return clarify('invalid_model_intent', '语义服务改变了明确要求的排名数量。');
    if (model.direction && (/最低|最便宜/.test(text) ? model.direction !== 'asc' : /最高|最贵/.test(text) && model.direction !== 'desc')) return clarify('invalid_model_intent', '语义服务改变了明确要求的排名方向。');
    if (model.operation === 'compare' && requestedPeriods.length < 2 && !/同比|环比/.test(text)) return clarify('invalid_model_intent', '两期比较缺少明确的两个季度。');
    if (model.time && model.time.kind !== 'inherit') {
      let proposedPeriods: Quarter[];
      try {
        switch (model.time.kind) {
          case 'latest': proposedPeriods = latest ? [latest] : []; break;
          case 'calendar_current': proposedPeriods = [calendar]; break;
          case 'calendar_previous': proposedPeriods = [shiftQuarter(calendar, -1)]; break;
          case 'last_year_same': { const anchor = latestPlanPeriod(prior) ?? latest; proposedPeriods = anchor ? [shiftQuarter(anchor, -4)] : []; break; }
          case 'rolling': proposedPeriods = latest ? [shiftQuarter(latest, 1 - model.time.count), latest] : []; break;
          case 'year': proposedPeriods = []; break;
          case 'explicit': proposedPeriods = model.time.periods; break;
        }
      } catch { return clarify('invalid_model_intent', '语义服务返回了无效的季度范围。'); }
      if (model.time.kind === 'year') {
        const year = model.time.year;
        const end = year === calendar.year ? periods.filter(q => q.year === year).at(-1) : { year, quarter: 4 };
        proposedPeriods = end ? end.quarter === 1 ? [end] : [{ year, quarter: 1 }, end] : [];
      }
      if (!requestedPeriods.length || proposedPeriods.length !== requestedPeriods.length || proposedPeriods.some((period, index) => !sameQuarter(period, requestedPeriods[index]))) {
        return clarify('invalid_model_intent', '语义服务的时间范围与明确问题或已确认上下文不一致。请直接指定季度。');
      }
    }
    if (!metrics.length && model.metric) metrics = model.metrics ?? [model.metric];
    metric ??= model.metric; field ??= model.field;
  }

  const temporal = Boolean(metric || relation || [...explicitFields, ...conditions.fields, ...predicateFields(prior?.filter)].some(value => ['totalArea', 'vacantArea', 'netEffectiveRent'].includes(value)));
  if (!requestedPeriods.length && temporal) {
    return clarify('period_required', '需要查询哪个季度？可以选择当前获权范围的最新有数据季度。', latest ? [
      { id: 'latest_period', label: `最新季度（${quarterText(latest)}）`, question: `${quarterText(latest)}${question}` },
    ] : []);
  }
  if (!metric && !isList && !rank && !distribution && !prior && !model) return clarify('metric_required', '需要查看净有效租金、空置率，还是楼宇目录？');

  // Every condition must be consumed by a supported slot. Negations and
  // unsupported filters remain here and therefore cannot disappear silently.
  for (const market of QUESTION_SUBMARKETS) remaining = remaining.replaceAll(market, '');
  consume(/望京|全部获权楼宇|全部获权范围|全部有权访问的楼宇/g);
  consume(/净有效租金|季度总面积|空置面积|空置率|建筑高度|楼层数|总车位数|租金/g);
  consume(/全期间共同样本|共同有效样本|共同样本|配对样本|各期有效样本|各期样本|同样本|按有效总面积加权|按面积加权/g);
  consume(/再加上|加上|再加|补充|一并看|一起看|也看看|也看|也加上|也加/g);
  consume(/按子市场(?:和|与|×)等级|按子市场|按等级|不同等级|各等级|各子市场/g);
  consume(/这两(?:个)?(?:地区|子市场|区域)?|这两个|两者|两地|这些(?:地区|子市场|区域)|上述(?:地区|子市场|区域)|它们/g);
  consume(/排名前\d{1,3}|前\d{1,3}栋|前[二三四五六七八九十]栋/g);
  consume(/净有效|最高|最低|最贵|最便宜|建筑|楼宇|写字楼|楼列表|列表|清单|有哪些|有多少栋|是哪栋|是什么|多少|楼|栋|子市场|地区|区域/g);
  consume(/请你|请|帮我|给我|我想|想看|想知道|可以|能否|分析一下|分析|看一下|查看|看看|再看看|再看|对比一下|比较一下|对比|比较|变化情况|变化|趋势|同比|环比|逐季|分别|按|交叉统计|交叉分析|分组|统计|关系|相关性|相关关系|分布|分位数|直方图|箱线图|列出|找出|筛出|筛选|查询/g);
  consume(/把|这|那|再|的|是|呢|一下|并且|以及|同时|或者|并|且|或|和|与|及|、|至|到|在|里|内|等|三个|两个|四个|[，,。？?！!；;：:（）()]/g);
  // A model's empty unresolvedConditions is not proof that a request has no
  // extra constraints. Only complete, non-constraining inquiry phrases may
  // remain after supported business slots have been consumed. Unknown words
  // (including certifications, ownership, frontage, or future field names)
  // must be clarified instead of being silently dropped by a valid JSON plan.
  const nonConstrainingInquiry = /^(?:(?:水平|情况|表现)?(?:怎么样|怎样|如何)|什么情况|有何特点|能(?:反映|说明)(?:些)?什么)$/;
  if (model && remaining && !nonConstrainingInquiry.test(remaining)) return clarify('invalid_model_intent', '问题中仍有未能映射到受支持字段的条件。请明确或简化这些条件；语义计划不能忽略未识别的业务限制执行。');
  if (remaining && !model) {
    // Exact established grammar remains available; it also rejects leftovers.
    const legacy = resolveBusinessQuestion(question, input.now);
    if (legacy.kind === 'plan' && !prior) return finish(legacy.plan, 'legacy_grammar');
    return clarify('unrecognized', '还有未能可靠识别的条件。请明确子市场、指标和季度；未识别的筛选条件不会被忽略。');
  }

  let filter: Predicate | undefined;
  try { filter = inheritedFilter(prior?.filter, conditions.filter); }
  catch { return clarify('unrecognized', '上一轮含“或”组合筛选，本次修改的字段会影响组合含义。请在新查询中明确写出全部筛选条件。'); }
  const common = { scope: { ...scope, inventory: prior?.scope.inventory ?? (temporal ? 'tracked' : 'all_authorized') }, ...(filter ? { filter } : {}) };
  const first = requestedPeriods[0];
  const last = requestedPeriods.at(-1);
  let candidate: unknown;
  const explicitMultiPeriod = requestedPeriods.length > 1 && (relativeCount > 0 || absolute.length > 0);
  if (explicitMultiPeriod && prior && ['rank', 'list', 'distribution'].includes(prior.operation) && !metricMatches.length && !wantsTrend && !comparing) return clarify('unsupported', '上一轮逐楼查询不能直接扩展为多季度结果。请明确需要季度聚合趋势，或指定单一季度继续查询。');
  const preservedFollowup = !explicitMultiPeriod && !rank && !isList && !distribution && !relation && !comparing && !wantsTrend && !cross && !explicitGrouping && !metricMatches.length && prior;
  const metricOnlyFollowup = prior && metrics.length === 1 && metricMatches.length === 1 && !explicitMultiPeriod && !rank && !isList && !distribution && !relation && !comparing && !wantsTrend && !cross && !explicitGrouping;
  if (model) {
    const modelGroup = model.groupBy ?? groupBy;
    const modelMode = model.mode ?? mode;
    switch (model.operation) {
      case 'aggregate': candidate = { ...common, operation: model.operation, metric, period: first }; break;
      case 'group_aggregate': candidate = { ...common, operation: model.operation, metric, period: first, groupBy: modelGroup }; break;
      case 'cross_aggregate': candidate = { ...common, operation: model.operation, metric, period: first }; break;
      case 'trend': case 'group_trend': candidate = { ...common, operation: model.operation, metric, start: first, end: last, mode: modelMode, ...(model.operation === 'group_trend' ? { groupBy: modelGroup } : {}) }; break;
      case 'compare': {
        let base = first;
        if (last && /同比|环比/.test(text)) base = shiftQuarter(last, /同比/.test(text) ? -4 : -1);
        candidate = { ...common, operation: model.operation, metric, base, current: last, mode: modelMode }; break;
      }
      case 'relationship': candidate = { ...common, operation: model.operation, period: first }; break;
      case 'distribution': candidate = { ...common, operation: model.operation, measure: metric ?? field, period: temporal ? first : null }; break;
      case 'list': candidate = { ...common, operation: model.operation, fields: model.fields ?? explicitFields, period: temporal ? first : null }; break;
      case 'rank': { const explicitLimit = /(?:排名前|前)(\d{1,3}|[二三四五六七八九十])/.exec(text); candidate = { ...common, operation: model.operation, field, period: field && ['height', 'floors', 'parking'].includes(field) ? null : first, direction: /最低|最便宜/.test(text) ? 'asc' : model.direction ?? 'desc', limit: explicitLimit ? countOf(explicitLimit[1]) : model.limit ?? 1 }; break; }
    }
    if (scope.submarkets && scope.submarkets.length > 1 && ['aggregate', 'trend'].includes(model.operation) && comparing) return clarify('invalid_model_intent', '多个子市场比较必须保留分组，不能合并成一个总体结果。');
  } else if (metricOnlyFollowup && prior.operation === 'rank') {
    if (metric === 'vacancy') return clarify('unsupported', '上一轮是逐楼排名，当前执行器尚不支持按计算后的空置率逐楼排名；不能用空置面积替代。可以明确询问同范围的空置率聚合或分布。');
    candidate = { ...prior, ...common, field: metric === 'rent' ? 'netEffectiveRent' : 'totalArea', period: first };
  } else if (metricOnlyFollowup && prior.operation === 'distribution') candidate = { ...prior, ...common, measure: metric, period: first };
  else if (preservedFollowup) {
    candidate = { ...prior, ...common, ...('mode' in prior ? { mode } : {}) };
    if (requestedPeriods.length === 1 && 'period' in prior) candidate = { ...candidate as object, period: first };
    else if (requestedPeriods.length === 1 && 'metric' in prior) candidate = { ...common, operation: groupBy ? 'group_aggregate' : 'aggregate', metric: prior.metric, period: first, ...(groupBy ? { groupBy } : {}) };
    else if (requestedPeriods.length > 1 && (prior.operation === 'trend' || prior.operation === 'group_trend')) candidate = { ...prior, ...common, start: first, end: last, mode };
    else if (requestedPeriods.length > 1 && prior.operation === 'compare') candidate = { ...prior, ...common, base: first, current: last, mode };
  } else if (relation) candidate = { ...common, operation: 'relationship', period: first };
  else if (rank) {
    if (!field || field === 'vacantArea' && metric === 'vacancy') return clarify('unsupported', '当前排名需要明确可查询的数值字段；不能用空置面积替代空置率。');
    const limitMatch = /(?:排名前|前)(\d{1,3}|[二三四五六七八九十])/.exec(text);
    candidate = { ...common, operation: 'rank', field, period: ['height', 'floors', 'parking'].includes(field) ? null : first, direction: /最低|最便宜/.test(text) ? 'asc' : 'desc', limit: limitMatch ? countOf(limitMatch[1]) : 1 };
  } else if (isList) candidate = { ...common, operation: 'list', fields: explicitFields.length ? explicitFields : conditions.fields.length ? conditions.fields : prior?.operation === 'list' ? prior.fields : [], period: temporal ? first : null };
  else if (distribution) {
    const measure = metric ?? field;
    if (!measure) return clarify('metric_required', '需要查看哪个指标的分布？');
    candidate = { ...common, operation: 'distribution', measure, period: ['height', 'floors', 'parking'].includes(measure) ? null : first };
  } else if (!metric) return clarify('metric_required', '尚未确定指标，请明确净有效租金、空置率或季度总面积。');
  else if (/同比|环比/.test(text)) {
    if (!last) return clarify('period_required', '请明确进行同比或环比的目标季度。');
    try { candidate = { ...common, operation: 'compare', metric, base: shiftQuarter(last, /同比/.test(text) ? -4 : -1), current: last, mode }; } catch { return clarify('period_required', '比较期间超出了支持的年份范围。'); }
  } else if (requestedPeriods.length > 1) {
    // An explicit regrouping compares the groups while retaining the confirmed
    // trend window, unless the user also explicitly replaces the periods.
    const inheritedTrend = (prior?.operation === 'trend' || prior?.operation === 'group_trend')
      && (!comparing || explicitGrouping && !explicitMultiPeriod);
    const trend = wantsTrend || Boolean(rolling || pastYear || yearMatch) || inheritedTrend;
    candidate = trend ? { ...common, operation: groupBy ? 'group_trend' : 'trend', metric, start: first, end: last, mode, ...(groupBy ? { groupBy } : {}) }
      : { ...common, operation: 'compare', metric, base: first, current: last, mode };
    if (groupBy && !trend) return clarify('unsupported', '多个子市场的两期对比请使用“变化”或“趋势”，以保留每个子市场的独立结果。');
  } else if (cross) candidate = { ...common, operation: 'cross_aggregate', metric, period: first };
  else candidate = { ...common, operation: groupBy ? 'group_aggregate' : 'aggregate', metric, period: first, ...(groupBy ? { groupBy } : {}) };
  const candidateOperation = candidate && typeof candidate === 'object' && 'operation' in candidate ? candidate.operation : undefined;
  if (candidate && aggregateOperations.some(operation => operation === candidateOperation)) {
    // Every aggregate family consumes the complete selected metric set. A
    // normal explicit metric replacement removes an inherited metrics array.
    const baseCandidate = { ...candidate as Record<string, unknown> };
    delete baseCandidate.metrics;
    candidate = { ...baseCandidate, ...metricSlots(metrics) };
  }
  try { return finish(parseQueryPlan(candidate), model ? 'validated_model_intent' : 'bounded_semantic_rules'); }
  catch { return clarify('unrecognized', '查询条件组合尚不明确或超出允许复杂度，请明确指标、期间和比较方式。'); }

  function finish(plan: QueryPlan, method: SemanticInterpretation['method']): SemanticResolution {
    const resolvedPeriods = planPeriods(plan).filter((q): q is Quarter => q !== null);
    const unavailablePeriods = resolvedPeriods.filter(period => !periods.some(value => sameQuarter(value, period)));
    const limitations = [...notices];
    if (unavailablePeriods.length) limitations.push(`可用期间记录未包含${unavailablePeriods.map(quarterText).join('、')}；该期无有效观测时显示缺失，不推算或改查其他季度。`);
    if (resolvedPeriods.length) limitations.push('使用当前跟踪目录内楼宇的历史季度记录，不代表当时市场全集；统计口径沿用已授权指标公式。');
    const comparisonSubmarkets = unique([...(context.comparisonSubmarkets ?? []), ...(plan.scope.submarkets ?? [])]).slice(-8);
    return { kind: 'plan', plan, context: { version: 'colliers-semantic-context/1', lastPlan: plan, comparisonSubmarkets },
      interpretation: { version: SEMANTIC_PLANNER_VERSION, method, resolvedQuestion: formatPlan(plan), periodBasis, periods: resolvedPeriods, availableThrough: latest ?? null, unavailablePeriods, inherited: unique(inherited), notices }, limitations };
  }
}

/** Suggestions use only executable capabilities and never imply an unobserved finding. */
export function buildSemanticSuggestions(input: {
  plan: QueryPlan; availablePeriods: readonly Quarter[]; authority: QueryAuthority;
  /** Supply actual row-authorized choices; omission never authorizes a new market. */
  allowedSubmarkets?: readonly string[];
}): (SemanticOption & { plan: QueryPlan })[] {
  const { plan, authority } = input;
  const suggestions: { id: string; label: string; plan: QueryPlan }[] = [];
  const metric = planMetric(plan);
  const metrics = planMetrics(plan);
  const slots = metricSlots(metrics);
  const period = latestPlanPeriod(plan);
  const common = { scope: plan.scope, ...(plan.filter ? { filter: plan.filter } : {}) };
  if (metric && period) {
    const preserveGrouping = (nextMetric: 'rent' | 'vacancy'): QueryPlan => {
      if (plan.operation === 'cross_aggregate') return { ...common, operation: 'cross_aggregate', metric: nextMetric, period };
      const groupBy = 'groupBy' in plan ? plan.groupBy : plan.scope.submarkets && plan.scope.submarkets.length > 1 ? 'submarket' as const : undefined;
      return groupBy ? { ...common, operation: 'group_aggregate', groupBy, metric: nextMetric, period } : { ...common, operation: 'aggregate', metric: nextMetric, period };
    };
    const start = shiftQuarter(period, -3);
    const available = validPeriods(input.availablePeriods);
    if (!['trend', 'group_trend', 'cross_aggregate'].includes(plan.operation) && available.filter(q => quarterIndex(q) >= quarterIndex(start) && quarterIndex(q) <= quarterIndex(period)).length > 1) {
      const groupBy = 'groupBy' in plan ? plan.groupBy : plan.scope.submarkets && plan.scope.submarkets.length > 1 ? 'submarket' as const : undefined;
      suggestions.push({ id: 'recent_four_quarters', label: '查看过去四季度变化', plan: { ...common, operation: groupBy ? 'group_trend' : 'trend', ...slots, start, end: period, mode: 'per_period', ...(groupBy ? { groupBy } : {}) } as QueryPlan });
    }
    if (metrics.includes('rent') && !metrics.includes('vacancy')) suggestions.push({ id: 'same_period_vacancy', label: '分析同季度空置率', plan: preserveGrouping('vacancy') });
    if (metrics.includes('vacancy') && !metrics.includes('rent')) suggestions.push({ id: 'same_period_rent', label: '查看同季度净有效租金', plan: preserveGrouping('rent') });
    if (metrics.includes('rent') && plan.operation !== 'rank') suggestions.push({ id: 'highest_rent', label: '查看净有效租金最高的楼宇', plan: { ...common, operation: 'rank', field: 'netEffectiveRent', direction: 'desc', limit: 5, period } });
    const comparison = input.allowedSubmarkets?.find(market => QUESTION_SUBMARKETS.includes(market as typeof QUESTION_SUBMARKETS[number]) && !plan.scope.submarkets?.includes(market));
    if (comparison && plan.scope.submarkets?.length === 1 && !plan.scope.buildingIds) {
      const dimensions = plan.operation === 'cross_aggregate' || 'groupBy' in plan && plan.groupBy === 'grade'
        ? { operation: 'cross_aggregate' as const } : { operation: 'group_aggregate' as const, groupBy: 'submarket' as const };
      suggestions.push({ id: 'compare_submarket', label: `与${comparison}比较`, plan: { ...common, scope: { ...plan.scope, submarkets: [...plan.scope.submarkets, comparison] }, ...dimensions, ...slots, period } as QueryPlan });
    }
  }
  if ((plan.operation === 'trend' || plan.operation === 'group_trend' || plan.operation === 'compare') && plan.mode === 'per_period') suggestions.unshift({ id: 'paired_sample', label: '改看共同有效样本', plan: { ...plan, mode: 'paired' } });
  if (plan.operation === 'rank') suggestions.push({ id: 'distribution', label: '查看同范围指标分布', plan: { ...common, operation: 'distribution', measure: plan.field === 'netEffectiveRent' ? 'rent' : plan.field, period: plan.period } });
  return suggestions.filter(suggestion => {
    // The text route cannot faithfully encode an inherited arbitrary predicate
    // or building UUID filter. Such suggestions must use the parent context;
    // avoid making a self-contained string look equivalent when it is not.
    try { authorizePlan(parseQueryPlan(suggestion.plan), authority); return true; } catch { return false; }
  }).slice(0, 4).map(suggestion => ({ id: suggestion.id, label: suggestion.label, question: formatPlan(suggestion.plan), plan: suggestion.plan }));
}
