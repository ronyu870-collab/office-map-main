import { z } from 'zod';
import { reportRequestSchema } from '../query/reportProtocol';
import { distributionMeasureSchema } from '../query/distribution';
import { chartRequestSchema } from '../query/chartSpec';

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
  query_report_market: z.strictObject({ scope, metric, recentCompletedQuarters: z.number().int().min(1).max(12).default(4) }),
  analyze_rent_vacancy: z.strictObject({ scope, period: quarter }),
  analyze_distribution: z.strictObject({ scope, period: quarter.nullable(), measure: distributionMeasureSchema }),
  list_buildings: z.strictObject({ scope, fields: z.array(field).max(6).default([]),
    period: quarter.nullable().default(null), filter: predicate.optional() }),
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

export const exportTableSchema = z.strictObject({
  resultIds: z.array(z.uuid()).min(1).max(8),
  format: z.enum(['xlsx', 'csv_zip']),
  fields: z.array(z.string().min(1).max(50)).min(1).max(30).optional(),
  sort: rowSort.optional(), filters: z.array(rowFilter).max(10).default([]),
  topN: z.number().int().min(1).max(50000).optional(),
  singleSheet: z.boolean().default(false),
});

export const exportContextSchema = z.strictObject({
  plans: z.array(z.unknown()).min(1).max(8),
  selection: exportTableSchema.omit({ resultIds: true }),
});

export const WORKSET_TOOL_SCHEMAS = {
  export_table: exportTableSchema,
  generate_pdf_report: reportRequestSchema,
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
  prepare_chart: z.strictObject({ resultId: z.uuid().optional(), chart: chartRequestSchema.optional() }),
  create_chart: z.strictObject({ resultId: z.uuid(), chart: chartRequestSchema }),
  modify_chart: z.strictObject({ resultId: z.uuid().optional(), chart: chartRequestSchema }),
  export_chart: z.strictObject({ resultId: z.uuid().optional(), chart: chartRequestSchema.optional(), format: z.enum(['png_zip', 'svg_zip']) }),
  prepare_map_selection: optionalResultRef,
  prepare_research_output: optionalResultRef,
} as const;
export type PresentationToolName = keyof typeof PRESENTATION_TOOL_SCHEMAS;
export const PRESENTATION_TOOL_NAMES: ReadonlySet<string> = new Set(Object.keys(PRESENTATION_TOOL_SCHEMAS));

export const LEGACY_TOOL_NAMES: ReadonlySet<string> = new Set([
  'query_verified_real_estate', 'get_data_capabilities', ...Object.keys(STRUCTURED_DATA_SCHEMAS),
  'get_source_evidence', 'prepare_chart', 'prepare_map_selection', 'prepare_research_output',
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
  if (PRESENTATION_TOOL_NAMES.has(name)) return PRESENTATION_TOOL_SCHEMAS[name as PresentationToolName].parse(input);
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
  def('query_report_market', 'PDF研究报告的相对期间查询。用户未指定明确起止、说最近四季度时，报告默认最近4个已结束的北京时间日历季度；由服务器计算起止，缺期保留未知，不回退到最近有数季度。metric=rent|vacancy|totalArea，可分别执行后组合PDF。已指定起止或含本季度时应使用analyze_market_trends，不改写用户期间。', z.toJSONSchema(STRUCTURED_DATA_SCHEMAS.query_report_market).properties as Record<string, unknown>, ['scope', 'metric']),
  def('analyze_rent_vacancy', '查询同季度获权楼宇的净有效租金与空置率联合样本，用于散点；返回rent与vacancy列，空置率正式比例来自授权面积，不自行估算。', { scope: s, period: q }, ['scope', 'period']),
  def('analyze_distribution', '复用正式分布统计生成直方图或箱线图所需的完整获权结果；不由模型计算分箱和分位数。', z.toJSONSchema(STRUCTURED_DATA_SCHEMAS.analyze_distribution).properties as Record<string, unknown>, ['scope', 'period', 'measure']),
  def('list_buildings', '查询完整获权楼宇列表及最多6个组合数值字段；无季度只能查询目录/资料字段，季度数值须明确period。可供全量导出，绝不以预览行替代全表。',
    { scope: s, fields: { type: 'array', items: f, maxItems: 6 }, period: { anyOf: [q, { type: 'null' }] }, filter: p }, ['scope']),
  def('get_data_capabilities', '实时检查当前登录身份的楼宇、字段、范围、操作和内部导出授权；授权不保证数据覆盖，不得凭推测回答权限。',
    { question: { type: 'string', minLength: 2, maxLength: 1000 } }, ['question']),
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
  def('generate_pdf_report', '真实生成内部PDF研究报告。只接受本轮完整获权resultIds（含服务器重新授权导入的当前对话reportResults），允许不同列结构的多个结果组合；租金、空置率、面积应分别查询完整期间后一起提交。正文、KPI、研究结论、同比环比只来自正式结果，禁止模型提供数字或自写分析。可指定现有chart规格，默认复用已准备图表或原确定性图种。purpose=internal；client用途须另行正式发布授权，本工具不发布对客文件。成功仅表示服务器生成，回答提供可信下载，不能声称本机保存。历史未导入的ID须重新查询。',
    z.toJSONSchema(reportRequestSchema).properties as Record<string, unknown>, ['resultIds']),
  def('export_table', '真实生成内部Excel或CSV与来源ZIP。只接受本轮完整正式resultIds，不能提交数值/SQL/路径。可选择现有列、组合筛选、排序、Top N；默认全部行，超限明确失败。多结果按同列结构纵向合并并保留结果ID/期间，禁止重算均值。singleSheet=true明确只生成一个工作表。跨轮“刚才结果”须按历史条件重新查询再导出。先获取合法resultId及列key；本工具成功只表示服务器生成，下载由回答中的真实操作交付，不表示本机已保存。',
    z.toJSONSchema(exportTableSchema).properties as Record<string, unknown>, ['resultIds', 'format']),
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
  ...(['prepare_chart', 'create_chart', 'modify_chart', 'export_chart'] as const).map(name => def(name,
    name === 'export_chart' ? '真实生成PNG或SVG及来源ZIP；须独立导出资格，只能使用完整获权结果。format=png_zip|svg_zip。成功仅表示服务器生成，下载入口在回答中，不能声称已保存。'
      : '使用指定获权完整结果创建或修改图表。chart.kind=plot时type=bar|horizontal_bar|line|scatter，x为现有横轴列key，y为1至6个同单位数值列key，groupBy可用现有分类列。横向条形仍传x分类/y数值，仅改变方向。支持sort、title、legend、periods和xAxis/yAxis的min/max/ticks/unit；ratio坐标按0至100%，percentage_point不再乘100。其它kind复用time_series/grouped_time_series/heatmap/histogram/box_plot。修改须保留未变的规格，数值绝不由模型提供。',
    z.toJSONSchema(PRESENTATION_TOOL_SCHEMAS[name]).properties as Record<string, unknown>,
    name === 'create_chart' ? ['resultId', 'chart'] : name === 'modify_chart' ? ['chart'] : name === 'export_chart' ? ['format'] : [])),
  def('prepare_map_selection', '由指定完整结果的已获权楼宇ID构造需要再次鉴权的地图跳转。', optionalRef.properties),
  def('prepare_research_output', '基于指定正式结果构造有来源及限制的研究摘要，不表示已导出PDF或Excel。', optionalRef.properties),
] as const;
export const REGISTERED_AGENT_TOOL_NAMES = new Set<string>([
  'query_verified_real_estate',
  ...SPECIALIST_DATA_TOOLS.map(tool => tool.function.name),
  ...WORKSET_TOOLS.map(tool => tool.function.name),
  ...PRESENTATION_TOOLS.map(tool => tool.function.name),
]);
