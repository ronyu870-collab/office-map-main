import { z } from 'zod';

/**
 * The public DeepSeek contract is structured. Only the legacy query adapter
 * accepts free-text questions. Every parameter is revalidated server-side.
 * Never accept table names, arbitrary predicates, SQL or model-supplied data.
 */
const quarter = z.strictObject({ year: z.number().int().min(1900).max(2200),
  quarter: z.number().int().min(1).max(4) });
const field = z.enum(['height', 'floors', 'parking', 'totalArea', 'vacantArea', 'netEffectiveRent']);
const metric = z.enum(['rent', 'vacancy', 'totalArea']);
const scope = z.strictObject({
  inventory: z.enum(['tracked', 'all_authorized']),
  submarkets: z.array(z.string().trim().min(1).max(80)).min(1).max(30).optional(),
  buildingIds: z.array(z.uuid()).min(1).max(500).optional(),
});
const predicate = z.strictObject({
  field, operator: z.enum(['gt', 'gte', 'lt', 'lte', 'eq']),
  value: z.string().max(100).regex(/^[+-]?\d+(?:\.\d+)?$/),
});
const legacy = z.strictObject({ question: z.string().trim().min(2).max(1000) });
const resultRef = z.strictObject({ resultId: z.uuid() });
const optionalResultRef = z.strictObject({ resultId: z.uuid().optional() });
const rowSort = z.strictObject({ field: z.string().min(1).max(50), direction: z.enum(['asc', 'desc']) });
const rowFilter = z.strictObject({ field: z.string().min(1).max(50),
  operator: z.enum(['eq', 'contains', 'gte', 'lte']), value: z.union([z.string().max(160), z.number().finite()]) });

export const STRUCTURED_DATA_SCHEMAS = {
  search_buildings: z.strictObject({ scope, nameContains: z.string().trim().min(1).max(100).optional() }),
  get_building_profile: z.strictObject({
    buildingIds: z.array(z.uuid()).min(1).max(100), fields: z.array(field).max(6).optional(),
    period: quarter.nullable().optional(),
  }),
  query_quarterly_metrics: z.strictObject({ scope, period: quarter, metric,
    metrics: z.array(metric).min(2).max(3).optional() }),
  rank_buildings: z.strictObject({
    scope, field, direction: z.enum(['asc', 'desc']), limit: z.number().int().min(1).max(1000),
    period: quarter.nullable().optional(), filter: predicate.optional(),
  }),
  compare_market_segments: z.strictObject({ submarkets: z.array(z.string().trim().min(1).max(80)).min(2).max(8),
    period: quarter, metric, inventory: z.enum(['tracked', 'all_authorized']).default('tracked') }),
  analyze_market_trends: z.strictObject({
    scope, start: quarter, end: quarter, metric,
    mode: z.enum(['per_period', 'paired']).default('per_period'),
    groupBy: z.enum(['submarket', 'grade']).optional(),
  }),
} as const;
export type StructuredDataToolName = keyof typeof STRUCTURED_DATA_SCHEMAS;
export const STRUCTURED_DATA_TOOL_NAMES: ReadonlySet<string> = new Set(Object.keys(STRUCTURED_DATA_SCHEMAS));

export const WORKSET_TOOL_SCHEMAS = {
  summarize_result: resultRef,
  read_result_page: z.strictObject({ resultId: z.uuid(), offset: z.number().int().min(0).max(100000).default(0),
    limit: z.number().int().min(1).max(100).default(30), sort: rowSort.optional(), filter: rowFilter.optional() }),
  check_data_coverage: resultRef,
  compare_result_sets: z.strictObject({ resultIds: z.array(z.uuid()).min(2).max(8) }),
} as const;
export type WorksetToolName = keyof typeof WORKSET_TOOL_SCHEMAS;
export const WORKSET_TOOL_NAMES: ReadonlySet<string> = new Set(Object.keys(WORKSET_TOOL_SCHEMAS));

export const PRESENTATION_TOOL_SCHEMAS = {
  get_source_evidence: optionalResultRef,
  prepare_chart: optionalResultRef,
  prepare_map_selection: optionalResultRef,
  prepare_research_output: optionalResultRef,
} as const;
export type PresentationToolName = keyof typeof PRESENTATION_TOOL_SCHEMAS;
export const PRESENTATION_TOOL_NAMES: ReadonlySet<string> = new Set(Object.keys(PRESENTATION_TOOL_SCHEMAS));

export const LEGACY_TOOL_NAMES: ReadonlySet<string> = new Set([
  'query_verified_real_estate', ...Object.keys(STRUCTURED_DATA_SCHEMAS),
  ...Object.keys(PRESENTATION_TOOL_SCHEMAS),
]);

/** For a bounded migration, accept previously issued {question} calls at the
 * runtime boundary, but do not advertise that obsolete contract to the model. */
export function parseAgentToolArguments(name: string, input: unknown): Record<string, unknown> {
  if (name === 'query_verified_real_estate') return legacy.parse(input);
  if (LEGACY_TOOL_NAMES.has(name) && typeof input === 'object' && input !== null
    && Object.hasOwn(input, 'question')) return legacy.parse(input);
  if (STRUCTURED_DATA_TOOL_NAMES.has(name)) {
    const schema = STRUCTURED_DATA_SCHEMAS[name as StructuredDataToolName];
    return schema.parse(input) as Record<string, unknown>;
  }
  if (WORKSET_TOOL_NAMES.has(name)) {
    const schema = WORKSET_TOOL_SCHEMAS[name as WorksetToolName];
    return schema.parse(input) as Record<string, unknown>;
  }
  if (PRESENTATION_TOOL_NAMES.has(name)) return optionalResultRef.parse(input);
  throw new Error('AGENT_UNREGISTERED_TOOL');
}

const q = { type: 'object', properties: { year: { type: 'integer', minimum: 1900, maximum: 2200 },
  quarter: { type: 'integer', enum: [1, 2, 3, 4] } }, required: ['year', 'quarter'], additionalProperties: false };
const s = { type: 'object', properties: { inventory: { type: 'string', enum: ['tracked', 'all_authorized'] },
  submarkets: { type: 'array', items: { type: 'string' }, minItems: 1, maxItems: 30 },
  buildingIds: { type: 'array', items: { type: 'string', format: 'uuid' }, minItems: 1, maxItems: 500 } },
  required: ['inventory'], additionalProperties: false };
const f = { type: 'string', enum: ['height', 'floors', 'parking', 'totalArea', 'vacantArea', 'netEffectiveRent'] };
const m = { type: 'string', enum: ['rent', 'vacancy', 'totalArea'] };
const p = { type: 'object', properties: { field: f,
  operator: { type: 'string', enum: ['gt', 'gte', 'lt', 'lte', 'eq'] },
  value: { type: 'string', description: '十进制原值，不含单位、不使用 SQL' } },
  required: ['field', 'operator', 'value'], additionalProperties: false };
const ref = { type: 'object', properties: { resultId: { type: 'string', format: 'uuid' } },
  required: ['resultId'], additionalProperties: false };
const optionalRef = { type: 'object', properties: { resultId: { type: 'string', format: 'uuid' } },
  additionalProperties: false };
function def(name: string, description: string, properties: Record<string, unknown>,
  required: string[] = []) {
  return { type: 'function' as const, function: { name, description,
    parameters: { type: 'object', properties, required, additionalProperties: false } } };
}
const jsonScope = s;
export const SPECIALIST_DATA_TOOLS = [
  def('search_buildings', '列出获权楼宇目录，可用名称子串进一步筛选。先使用此工具取得真实楼宇ID，不接受模糊生成的ID。',
    { scope: jsonScope, nameContains: { type: 'string', minLength: 1, maxLength: 100 } }, ['scope']),
  def('get_building_profile', '读取指定已授权楼宇ID的资料。建筑高度/楼层/车位为资料字段；季度字段须提供具体period。',
    { buildingIds: { type: 'array', items: { type: 'string', format: 'uuid' }, minItems: 1, maxItems: 100 },
      fields: { type: 'array', items: f, maxItems: 6 }, period: { anyOf: [q, { type: 'null' }] } }, ['buildingIds']),
  def('query_quarterly_metrics', '对指定子市场或楼宇的明确季度计算净有效租金、空置率或季度总面积，返回面积加权正式口径及有效样本。',
    { scope: jsonScope, period: q, metric: m, metrics: { type: 'array', items: m, minItems: 2, maxItems: 3 } },
    ['scope', 'period', 'metric']),
  def('rank_buildings', '按已授权数值字段排序并可增加一个确定性数值筛选；不默默改租金口径、季度或排行数量。',
    { scope: jsonScope, field: f, direction: { type: 'string', enum: ['asc', 'desc'] },
      limit: { type: 'integer', minimum: 1, maximum: 1000 },
      period: { anyOf: [q, { type: 'null' }] }, filter: p }, ['scope', 'field', 'direction', 'limit']),
  def('compare_market_segments', '用同一季度的分组统计确定性比较2至8个子市场；不能对市场均值简单平均。',
    { submarkets: { type: 'array', items: { type: 'string' }, minItems: 2, maxItems: 8 },
      period: q, metric: m, inventory: { type: 'string', enum: ['tracked', 'all_authorized'] } },
    ['submarkets', 'period', 'metric']),
  def('analyze_market_trends', '跨明确起止季度计算经授权的时间序列，可按子市场或等级分组。缺期不填零，明确配对与逐期样本。',
    { scope: jsonScope, start: q, end: q, metric: m, mode: { type: 'string', enum: ['per_period', 'paired'] },
      groupBy: { type: 'string', enum: ['submarket', 'grade'] } }, ['scope', 'start', 'end', 'metric']),
] as const;
export const WORKSET_TOOLS = [
  def('summarize_result', '汇总本次请求中某一完整可信结果的总行数、正式结论、列有效样本数，非前8行。',
    { resultId: ref.properties.resultId }, ['resultId']),
  def('read_result_page', '对本次获权工作集结果分页、按已存在列排序或筛选，返回真实总行数及分页，不能访问不属于本次会话的结果。',
    { resultId: ref.properties.resultId, offset: { type: 'integer', minimum: 0, maximum: 100000 },
      limit: { type: 'integer', minimum: 1, maximum: 100 },
      sort: { type: 'object', properties: { field: { type: 'string' }, direction: { type: 'string', enum: ['asc', 'desc'] } },
        required: ['field', 'direction'], additionalProperties: false },
      filter: { type: 'object', properties: { field: { type: 'string' },
        operator: { type: 'string', enum: ['eq', 'contains', 'gte', 'lte'] },
        value: { anyOf: [{ type: 'string' }, { type: 'number' }] } },
        required: ['field', 'operator', 'value'], additionalProperties: false } }, ['resultId']),
  def('check_data_coverage', '检查所选正式结果各列的有效/缺失/无效/冲突/待核验数量，不将缺失解释为0。',
    { resultId: ref.properties.resultId }, ['resultId']),
  def('compare_result_sets', '对本轮多个已获权结果列出并排证据和原有正式数值，不重新计算均值或相加百分比。',
    { resultIds: { type: 'array', items: { type: 'string', format: 'uuid' }, minItems: 2, maxItems: 8 } }, ['resultIds']),
] as const;
export const PRESENTATION_TOOLS = [
  def('get_source_evidence', '读取本轮指定已获权结果的来源、期间、核验状态；不返回未获权原文。', optionalRef.properties),
  def('prepare_chart', '由指定可信完整结果的确定性图表程序准备规格，不凭模型绘制数据点。', optionalRef.properties),
  def('prepare_map_selection', '由指定完整结果的已获权楼宇ID构造需要再次鉴权的地图跳转。', optionalRef.properties),
  def('prepare_research_output', '基于指定正式结果构造有来源及限制的研究摘要，不表示已导出PDF或Excel。', optionalRef.properties),
] as const;
export const REGISTERED_AGENT_TOOL_NAMES = new Set<string>([
  'query_verified_real_estate',
  ...SPECIALIST_DATA_TOOLS.map(tool => tool.function.name),
  ...WORKSET_TOOLS.map(tool => tool.function.name),
  ...PRESENTATION_TOOLS.map(tool => tool.function.name),
]);
