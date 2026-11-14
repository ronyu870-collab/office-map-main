import {leaseRequiredFields, type LeaseView} from './leases/view';
import { parseQueryPlan, type QueryPlan } from './plan';
import { expandRelativeQuarters, shiftQuarter, type RelativeQuarterContext } from './relativeQuarter';

export const QUESTION_GRAMMAR_VERSION = 'bounded-business-question/14';
// Canonical submarket names from the existing map, not inferred geographic aliases.
export const QUESTION_SUBMARKETS = ['CBD', '中关村', '亚奥', '望京-酒仙桥', '东城商务区', '燕莎', '丽泽', '金融街', '通州', '其他', '上地', '亦庄', '北清路', '通惠河传媒走廊', '丰台科技园', '玉渊潭', '四季青'] as const;
export type QuestionClarification = { code: 'conditions_required'; message: string };
export type QuestionResolution = { kind: 'plan'; plan: QueryPlan; timeResolution?: RelativeQuarterContext } | { kind: 'clarification'; clarification: QuestionClarification };
const markets = `(${QUESTION_SUBMARKETS.join('|')}|全部获权楼宇)`;
const futureMarkets = `(${QUESTION_SUBMARKETS.join('|')}|全部获权|全部获权楼宇)`;
const futureScope = (market: string) => ({ inventory: 'future' as const, ...(['全部获权', '全部获权楼宇'].includes(market) ? {} : { submarkets: [market] }) });
const period = '(19\\d{2}|20\\d{2}|21\\d{2}|2200)(?:年?Q([1-4])|年第?([一二三四1-4])季度)';
const metric = '(净有效租金|空置率|季度总面积)';
const listFields = { 建筑高度: 'height', 楼层数: 'floors', 总车位数: 'parking', 季度总面积: 'totalArea', 空置面积: 'vacantArea', 净有效租金: 'netEffectiveRent' } as const;
const listFieldPattern = `(${Object.keys(listFields).join('|')})`;
const metrics = { 净有效租金: 'rent', 空置率: 'vacancy', 季度总面积: 'totalArea' } as const;
function quarter(year: string, latin: string, chinese: string) {
  return { year: Number(year), quarter: latin ? Number(latin) : '一二三四'.includes(chinese) ? '一二三四'.indexOf(chinese) + 1 : Number(chinese) };
}
function scope(market: string, quarterly = false): QueryPlan['scope'] {
  return { inventory: quarterly ? 'tracked' : 'all_authorized', ...(market === '全部获权楼宇' ? {} : { submarkets: [market] }) };
}

/** Relative dates use a trusted server clock, then the same full-string grammar.
 * A client cannot supply the clock or reinterpret an old result. */
export function resolveBusinessQuestion(question: string, clock?: Date): QuestionResolution {
  if (question?.trim().startsWith('企业「')) return resolveExplicitQuestion(question);
  if (!clock || !question || question.length > 6000) return resolveExplicitQuestion(question);
  try {
    const normalized = question.trim().replace(/\s+/g, '').replace(/cbd/gi, 'CBD').replace(/q([1-4])/g, 'Q$1').replace(/[？?。]$/, '');
    const expanded = expandRelativeQuarters(normalized, clock);
    const resolved = resolveExplicitQuestion(expanded.text);
    return resolved.kind === 'plan' && expanded.context ? { ...resolved, timeResolution: expanded.context } : resolved;
  } catch { return resolveExplicitQuestion(''); }
}

/** Reject every unconsumed condition, negation or unsupported multi-intent. */
function resolveExplicitQuestion(question: string): QuestionResolution {
  const clarification: QuestionResolution = { kind: 'clarification', clarification: { code: 'conditions_required',
    message: '还不能可靠理解完整条件。请明确子市场、指标及年份季度，每次查询一个问题；例如“CBD有哪些楼”“CBD最高的楼是什么”或“2026年第三季度CBD净有效租金”。租金需明确口径；最近几个季度需说明“已结束”或“含本季度”，“最新”不能代替明确季度。填报可问“当前填报季度CBD填报进度”，该期间取系统配置；“本季度”取日历季度。暂不支持的条件不会被忽略。' } };
  if (!question || question.length > 6000) return clarification;
  const companyLease=/^企业「([^「」\u0000-\u001f\u007f]{1,200})」(日常|历史|全部来源)成交明细[？?。]?$/.exec(question.trim());
  if(companyLease){try{return {kind:'plan',plan:parseQueryPlan({operation:'lease_observation',view:'catalog',period:null,scope:{inventory:'leases',sources:companyLease[2]==='日常'?['live']:companyLease[2]==='历史'?['history']:['live','history'],fields:[],companyExact:companyLease[1]}})};}catch{return clarification;}}
  const text = question.trim().replace(/\s+/g, '').replace(/cbd/gi, 'CBD').replace(/q([1-4])/g, 'Q$1').replace(/[？?。]$/, '');
  const leaseViews={明细:'catalog',有哪些:'catalog',面积汇总:'summary',表面租金:'face_rent',有效租金:'effective_rent',行业占比:'industry',子行业占比:'sub_industry',需求类型占比:'demand_type',子市场占比:'submarket'} as const;
  const leaseTrend=new RegExp(`^${futureMarkets}(日常|历史|全部来源)成交${period}(?:至|到)${period}(?:季度)?趋势$`).exec(text);
  if(leaseTrend){try{return {kind:'plan',plan:parseQueryPlan({operation:'lease_observation',view:'quarter_trend',period:null,range:{start:quarter(leaseTrend[3],leaseTrend[4],leaseTrend[5]),end:quarter(leaseTrend[6],leaseTrend[7],leaseTrend[8])},scope:{inventory:'leases',sources:leaseTrend[2]==='日常'?['live']:leaseTrend[2]==='历史'?['history']:['live','history'],fields:['area_sqm'],...(['全部获权','全部获权楼宇'].includes(leaseTrend[1])?{}:{submarkets:[leaseTrend[1]]})}})};}catch{return clarification;}}
  const leasePattern=new RegExp(`^(?:${period})?${futureMarkets}(日常|历史|全部来源)成交(${Object.keys(leaseViews).join('|')})$`).exec(text);
  if(leasePattern){
    const view=leaseViews[leasePattern[6] as keyof typeof leaseViews] as LeaseView;
    try{return {kind:'plan',plan:parseQueryPlan({operation:'lease_observation',view,period:leasePattern[1]?quarter(leasePattern[1],leasePattern[2],leasePattern[3]):null,
      scope:{inventory:'leases',sources:leasePattern[5]==='日常'?['live']:leasePattern[5]==='历史'?['history']:['live','history'],fields:[...leaseRequiredFields(view)],
        ...(['全部获权','全部获权楼宇'].includes(leasePattern[4])?{}:{submarkets:[leasePattern[4]]})}})};}catch{return clarification;}
  }
  const submissionViews = {填报进度:'summary',填报明细:'buildings',哪些楼还没填:'missing',未分配楼宇:'unassigned',人员填报进度:'people',谁还没填:'missing_people',填报数据质量:'quality',填报缺项:'missing_fields',填报异常:'anomalies'} as const;
  const submissionAction = `(${Object.keys(submissionViews).join('|')})`;
  const futureCatalogViews={有哪些:'catalog',目录:'catalog',预计时间精度:'launch_summary',预计入市区间:'launch_schedule',面积汇总:'area_summary'} as const;
  const launchSelection={完全在范围内:'within',可能涉及:'overlap',时间未知:'unknown',范围外:'outside'} as const;
  const rangedFuture=new RegExp(`^${futureMarkets}未来供应预计入市${period}(?:至|到)${period}(完全在范围内|可能涉及|时间未知|范围外)(?:的)?(${Object.keys(futureCatalogViews).join('|')})$`).exec(text);
  const naturalFuture=new RegExp(`^${futureMarkets}未来供应预计在${period}(?:至|到)${period}入市(${Object.keys(futureCatalogViews).join('|')})$`).exec(text);
  const rf=rangedFuture??naturalFuture;
  if(rf){try{return {kind:'plan',plan:parseQueryPlan({operation:'future_observation',view:futureCatalogViews[(rangedFuture?rf[9]:rf[8]) as keyof typeof futureCatalogViews],period:null,
    launchRange:{start:quarter(rf[2],rf[3],rf[4]),end:quarter(rf[5],rf[6],rf[7]),selection:rangedFuture?launchSelection[rf[8] as keyof typeof launchSelection]:'within'},scope:futureScope(rf[1])})};}catch{return clarification;}}
  const futureCatalog=new RegExp(`^${futureMarkets}未来供应(${Object.keys(futureCatalogViews).join('|')})$`).exec(text);
  if(futureCatalog)return {kind:'plan',plan:parseQueryPlan({operation:'future_observation',view:futureCatalogViews[futureCatalog[2] as keyof typeof futureCatalogViews],period:null,scope:futureScope(futureCatalog[1])})};
  const futureConfigured=new RegExp(`^当前填报季度${futureMarkets}未来供应${submissionAction}$`).exec(text);
  if(futureConfigured)return {kind:'plan',plan:parseQueryPlan({operation:'future_observation',view:submissionViews[futureConfigured[2] as keyof typeof submissionViews],period:null,scope:futureScope(futureConfigured[1])})};
  const futureExplicit=new RegExp(`^${period}${futureMarkets}未来供应${submissionAction}$`).exec(text);
  if(futureExplicit)return {kind:'plan',plan:parseQueryPlan({operation:'future_observation',view:submissionViews[futureExplicit[5] as keyof typeof submissionViews],period:quarter(futureExplicit[1],futureExplicit[2],futureExplicit[3]),scope:futureScope(futureExplicit[4])})};
  const configured = new RegExp(`^当前填报季度${markets}${submissionAction}$`).exec(text);
  if (configured) return {kind:'plan',plan:parseQueryPlan({operation:'submission_progress',scope:scope(configured[1],true),period:null,view:submissionViews[configured[2] as keyof typeof submissionViews]})};
  const submitted = new RegExp(`^${period}${markets}${submissionAction}$`).exec(text);
  if (submitted) return {kind:'plan',plan:parseQueryPlan({operation:'submission_progress',scope:scope(submitted[4],true),period:quarter(submitted[1],submitted[2],submitted[3]),view:submissionViews[submitted[5] as keyof typeof submissionViews]})};
  const marketList = `(${QUESTION_SUBMARKETS.join('|')})(?:、(?:${QUESTION_SUBMARKETS.join('|')}))*`;
  const groupedScope = (value: string): QueryPlan['scope'] => ({ inventory: 'tracked', ...(value === '全部获权楼宇' ? {} : { submarkets: [...new Set(value.split('、'))] }) });
  const distributionMeasures={建筑高度:'height',楼层数:'floors',总车位数:'parking',季度总面积:'totalArea',空置面积:'vacantArea',净有效租金:'rent',空置率:'vacancy'} as const;
  const distribution=new RegExp(`^${period}((?:${marketList})|全部获权楼宇)(建筑高度|楼层数|总车位数|季度总面积|空置面积|净有效租金|空置率)分布$`).exec(text);
  if(distribution)return {kind:'plan',plan:parseQueryPlan({operation:'distribution',period:quarter(distribution[1],distribution[2],distribution[3]),scope:groupedScope(distribution[4]),measure:distributionMeasures[distribution[6] as keyof typeof distributionMeasures]})};
  const catalogDistribution=new RegExp(`^${markets}(建筑高度|楼层数|总车位数)分布$`).exec(text);
  if(catalogDistribution)return {kind:'plan',plan:parseQueryPlan({operation:'distribution',period:null,scope:scope(catalogDistribution[1]),measure:distributionMeasures[catalogDistribution[2] as keyof typeof distributionMeasures]})};
  const relation = new RegExp(`^${period}((?:${marketList})|全部获权楼宇)净有效租金(?:和|与)空置率(?:关系|相关性)$`).exec(text);
  if (relation) return { kind: 'plan', plan: parseQueryPlan({ operation: 'relationship', period: quarter(relation[1], relation[2], relation[3]), scope: groupedScope(relation[4]) }) };
  const cross = new RegExp(`^${period}((?:${marketList})|全部获权楼宇)${metric}按子市场(?:和|与|×)等级交叉统计$`).exec(text);
  if (cross) return { kind: 'plan', plan: parseQueryPlan({ operation: 'cross_aggregate', period: quarter(cross[1], cross[2], cross[3]), scope: groupedScope(cross[4]), metric: metrics[cross[6] as keyof typeof metrics] }) };
  let grouped = new RegExp(`^${period}((?:${marketList})|全部获权楼宇)${metric}按(子市场|等级)比较$`).exec(text);
  if (grouped) return { kind: 'plan', plan: parseQueryPlan({ operation: 'group_aggregate', period: quarter(grouped[1], grouped[2], grouped[3]), scope: groupedScope(grouped[4]), metric: metrics[grouped[6] as keyof typeof metrics], groupBy: grouped[7] === '等级' ? 'grade' : 'submarket' }) };
  grouped = new RegExp(`^((?:${marketList})|全部获权楼宇)${metric}${period}(?:至|到)${period}按(子市场|等级)趋势(各期样本|全期间共同样本)$`).exec(text);
  if (grouped) { try { return { kind: 'plan', plan: parseQueryPlan({ operation: 'group_trend', scope: groupedScope(grouped[1]), metric: metrics[grouped[3] as keyof typeof metrics], start: quarter(grouped[4], grouped[5], grouped[6]), end: quarter(grouped[7], grouped[8], grouped[9]), groupBy: grouped[10] === '等级' ? 'grade' : 'submarket', mode: grouped[11] === '各期样本' ? 'per_period' : 'paired' }) }; } catch { return clarification; } }
  let match = new RegExp(`^${markets}(?:里|内)?(?:有哪些楼(?:宇)?|有多少栋楼|楼宇列表)$`).exec(text);
  if (match) return { kind: 'plan', plan: parseQueryPlan({ operation: 'list', scope: scope(match[1]), fields: [], period: null }) };
  match = new RegExp(`^${markets}(?:里|内)?(?:最高的楼(?:是什么|是哪栋)?|建筑高度最高的楼(?:是什么|是哪栋)?)$`).exec(text);
  if (match) return { kind: 'plan', plan: parseQueryPlan({ operation: 'rank', scope: scope(match[1]), field: 'height', period: null, direction: 'desc', limit: 1 }) };
  match = new RegExp(`^${markets}(?:的)?(建筑高度|楼层数|总车位数)(?:排名前([1-9][0-9]{0,2})|列表)$`).exec(text);
  if (match) {
    const field = ({ 建筑高度: 'height', 楼层数: 'floors', 总车位数: 'parking' } as const)[match[2] as '建筑高度'];
    return { kind: 'plan', plan: parseQueryPlan(match[3]
      ? { operation: 'rank', scope: scope(match[1]), field, period: null, direction: 'desc', limit: Number(match[3]) }
      : { operation: 'list', scope: scope(match[1]), fields: [field], period: null }) };
  }
  match = new RegExp(`^${period}${markets}(?:的)?${listFieldPattern}(?:与|和)${listFieldPattern}列表$`).exec(text);
  if (match) {
    const fields = [listFields[match[5] as keyof typeof listFields], listFields[match[6] as keyof typeof listFields]];
    if (fields[0] === fields[1]) return clarification;
    return { kind: 'plan', plan: parseQueryPlan({ operation: 'list', scope: scope(match[4], true), fields,
      period: quarter(match[1], match[2], match[3]) }) };
  }
  match = new RegExp(`^${period}${markets}(?:的)?${metric}(同比|环比)(各期样本|配对样本)$`).exec(text);
  if (match) {
    try {
      const current = quarter(match[1], match[2], match[3]);
      return { kind: 'plan', plan: parseQueryPlan({ operation: 'compare', scope: scope(match[4], true), metric: metrics[match[5] as keyof typeof metrics],
        base: shiftQuarter(current, match[6] === '同比' ? -4 : -1), current, mode: match[7] === '配对样本' ? 'paired' : 'per_period' }) };
    } catch { return clarification; }
  }
  match = new RegExp(`^${period}${markets}(?:的)?${metric}(?:是多少)?$`).exec(text);
  if (match) return { kind: 'plan', plan: parseQueryPlan({ operation: 'aggregate', scope: scope(match[4], true),
    period: quarter(match[1], match[2], match[3]), metric: metrics[match[5] as keyof typeof metrics] }) };
  match = new RegExp(`^${markets}(?:的)?${metric}${period}与${period}比较(各期样本|配对样本)$`).exec(text);
  if (match) return { kind: 'plan', plan: parseQueryPlan({ operation: 'compare', scope: scope(match[1], true), metric: metrics[match[2] as keyof typeof metrics],
    base: quarter(match[3], match[4], match[5]), current: quarter(match[6], match[7], match[8]), mode: match[9] === '配对样本' ? 'paired' : 'per_period' }) };
  match = new RegExp(`^${markets}(?:的)?${metric}${period}(?:至|到)${period}趋势(各期样本|全期间共同样本|配对样本)$`).exec(text);
  if(match){try{return {kind:'plan',plan:parseQueryPlan({operation:'trend',scope:scope(match[1],true),metric:metrics[match[2] as keyof typeof metrics],
    start:quarter(match[3],match[4],match[5]),end:quarter(match[6],match[7],match[8]),mode:match[9]==='各期样本'?'per_period':'paired'})};}catch{return clarification;}}
  return clarification;
}
