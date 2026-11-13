import { parseQueryPlan, type QueryPlan } from './plan';

export const QUESTION_GRAMMAR_VERSION = 'bounded-business-question/5';
// Canonical submarket names from the existing map, not inferred geographic aliases.
export const QUESTION_SUBMARKETS = ['CBD', '中关村', '亚奥', '望京-酒仙桥', '东城商务区', '燕莎', '丽泽', '金融街', '通州', '其他', '上地', '亦庄', '北清路', '通惠河传媒走廊', '丰台科技园', '玉渊潭', '四季青'] as const;
export type QuestionClarification = { code: 'conditions_required'; message: string };
export type QuestionResolution = { kind: 'plan'; plan: QueryPlan } | { kind: 'clarification'; clarification: QuestionClarification };
const markets = `(${QUESTION_SUBMARKETS.join('|')}|全部获权楼宇)`;
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

/** Full-string grammar only. No substring fallback, SQL, external model, or guessed dates.
 * Unconsumed conditions, negation, multi-intent and relative periods require clarification. */
export function resolveBusinessQuestion(question: string): QuestionResolution {
  const clarification: QuestionResolution = { kind: 'clarification', clarification: { code: 'conditions_required',
    message: '还不能可靠理解完整条件。请明确子市场、指标及年份季度，每次查询一个问题；例如“CBD有哪些楼”“CBD最高的楼是什么”或“2026年第三季度CBD净有效租金”。租金需明确口径，暂不支持的条件不会被忽略。' } };
  if (!question || question.length > 6000) return clarification;
  const text = question.trim().replace(/\s+/g, '').replace(/cbd/gi, 'CBD').replace(/q([1-4])/g, 'Q$1').replace(/[？?。]$/, '');
  const marketList = `(${QUESTION_SUBMARKETS.join('|')})(?:、(?:${QUESTION_SUBMARKETS.join('|')}))*`;
  const groupedScope = (value: string): QueryPlan['scope'] => ({ inventory: 'tracked', ...(value === '全部获权楼宇' ? {} : { submarkets: [...new Set(value.split('、'))] }) });
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
