/**
 * Exposed Agent tools are named, read-only adapters to the existing authorized
 * semantic execution and snapshot pipeline. No model-generated SQL or raw table
 * access is accepted. A tool name alone does not grant additional fields.
 */
const parameters = {
  type: 'object',
  properties: {
    question: { type: 'string', description: '完整的中文业务问题，须包含必要的地区、期间、指标和楼宇线索。' },
  },
  required: ['question'],
  additionalProperties: false,
} as const;

export const SPECIALIST_DATA_TOOLS = [
  {
    type: 'function', function: {
      name: 'search_buildings',
      description: '经现有获权楼宇搜索与别名消歧规则查找项目。只返回当前可信引擎有权展示的楼宇，不承诺涵盖历史成交全集。',
      parameters,
    },
  },
  {
    type: 'function', function: {
      name: 'get_building_profile',
      description: '查询已获权楼宇的现有可用基础资料、面积与对应季度参数。未授权楼龄、GFA和楼书原件不能通过此工具读取。',
      parameters,
    },
  },
  {
    type: 'function', function: {
      name: 'query_quarterly_metrics',
      description: '使用确定性统计引擎查询指定子市场或楼宇的季度净有效租金、空置率、总面积、空置面积及有效样本，注明口径。',
      parameters,
    },
  },
  {
    type: 'function', function: {
      name: 'compare_market_segments',
      description: '在当前可信查询范围比较 CBD、金融街等子市场的已获权季度指标，使用正式统计计算结果，不臆造差值。',
      parameters,
    },
  },
  {
    type: 'function', function: {
      name: 'analyze_market_trends',
      description: '通过现有可信跨季度趋势和比较能力分析已授权子市场的租金、空置率、面积、同比环比与样本差异。',
      parameters,
    },
  },
] as const;

export const REGISTERED_AGENT_TOOL_NAMES = new Set<string>([
  'query_verified_real_estate',
  ...SPECIALIST_DATA_TOOLS.map(tool => tool.function.name),
]);
