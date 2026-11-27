import { z } from 'zod';
import { quarterSchema, type Quarter } from '../query/contracts';
import { parseQueryPlan, type QueryPlan, type RankProjection } from '../query/plan';
import { inferSemanticScope } from '../query/semanticPlanner';
import type { MetroScreeningRequest } from '../query/metroScreening';
import { QUESTION_SUBMARKETS } from '../query/question';

export const siteSelectionSchema = z.strictObject({
  area: z.number().positive().max(1000000),
  budget: z.number().positive().max(10000),
  walkMeters: z.number().int().positive().max(10000).optional(),
  grade: z.enum(['A', 'B', 'P']).optional(),
  period: quarterSchema.optional(),
  submarkets: z.array(z.string()).max(8).optional(),
  limit: z.number().int().min(1).max(20),
  mapRequested: z.boolean(),
  preferences: z.array(z.enum(['transport', 'image', 'industry'])).optional(),
});
export type SiteSelectionRequest = z.infer<typeof siteSelectionSchema>;

const excludedMap = /(?:不(?:要|用|需要)(?:在|生成|显示|打开|提供|标注|准备|给)?|禁止(?:打开|生成|提供|在)?)(?:楼宇)?地图(?:链接)?/u;
const requestedMap = /(?:在地图(?:上|中)(?:展示|标记|标注|查看|显示)|(?:给出|提供|显示|准备|标注|打开|附上|输出)(?:楼宇)?地图(?:链接)?|地图链接)/u;

export const mapExplicitlyExcluded = (question: string) => excludedMap.test(question.normalize('NFKC').replace(/\s+/gu, ''));

export function walkingOnlyThreshold(question: string): number | undefined {
  const text = question.normalize('NFKC').replace(/[\s，,。！？!?]+/gu, '');
  if (!/选址|找(?:办公楼|写字楼|办公室)/u.test(text)) return undefined;
  const match = /^(?:请|帮我)?(?:办公选址|选址|找办公楼|找写字楼|找办公室)?(?:要求)?(?:距|到|离)?(?:地铁站?)?步行(?:不超过|不高于|小于|约|<=|≤)?(\d{1,5})(?:米|m)(?:以内|内)?的?(?:办公选址|选址|找办公楼|找写字楼|找办公室)?$/iu.exec(text);
  const meters = Number(match?.[1]);
  return meters > 0 && meters <= 10000 ? meters : undefined;
}

export function readMetroScreeningRequest(question: string): MetroScreeningRequest | undefined {
  const original = question.normalize('NFKC').replace(/\s+/gu, '');
  const text = original.replace(excludedMap, '').replace(requestedMap, '').replace(/[。！？!?]+/gu, '')
    .replace(/[，,]+/gu, ',').replace(/^,+|,+$/g, '');
  const office = '(?:办公选址|选址|找办公楼|找写字楼|找办公室|办公楼|写字楼)';
  const markets = [...QUESTION_SUBMARKETS.filter(name => name !== '其他'), '望京'].join('|');
  const intent = new RegExp(office, 'u');
  if (!intent.test(text)) return undefined;
  // A market prefix must end at a complete action word. A station name such
  // as 中关村地铁站 or 望京西站 must survive intact.
  const action = '(?:查找|查|找|推荐|列出)';
  const marketBoundary = `(?:,|(?=地铁(?!站)|${office}|${action}|要求|距|到|离))`;
  const opening = `^(?:请)?(?:帮我)?(?:北京(?:市)?)?在?(?:(${markets})${marketBoundary})?${office}?,?${action}?(?:要求)?(?:距|到|离)?`;
  const destination = '(?:地铁站?|(?:地铁)?([\\p{L}\\p{N}·]{1,30})(?:地铁)?站)';
  const range = '步行(?:不超过|不高于|小于|约|<=|≤)?(\\d{1,5})(?:米|m)(?:以内|内)?的?';
  const match = new RegExp(`${opening}${destination}${range},?${office}?(?:,?(?:并|同时))?$`, 'iu').exec(text);
  const radiusMeters = Number(match?.[3]);
  if (!(radiusMeters > 0 && radiusMeters <= 10000)) return undefined;
  return { radiusMeters, stationName: match?.[2]?.replace(/地铁$/u, ''),
    submarkets: match?.[1] ? inferSemanticScope(match[1]).submarkets : undefined,
    mapRequested: !mapExplicitlyExcluded(original) && requestedMap.test(original) };
}

/** Only use the provisional rent screen for a clear area and monthly unit
 * budget. Other pricing bases and explicit exclusions remain with the agent. */
export function readSiteSelectionRequest(question: string): SiteSelectionRequest | undefined {
  const text = question.normalize('NFKC').replace(/\s+/g, '').replace(/(\d{4})年第?([一二三四1-4])季度/g,
    (_, year, quarter) => `${year}Q${'一二三四'.includes(quarter) ? '一二三四'.indexOf(quarter) + 1 : quarter}`);
  if (!/选址|租赁|承租|租办公室|找(?:办公|写字楼)|办公选址/.test(text)
    || /报价|签约价|含税|含物业|美元|元\/天|元\/日|上海|广州|深圳|朝阳区|海淀区|东城区|西城区|丰台区|排除|不含|剔除|除了|以下条件均需|全部条件均需/.test(text)) return undefined;
  const areas = [...text.matchAll(/(\d{1,7}(?:\.\d{1,2})?)(?:m2|平米|平方米)(?!\d)/gi)];
  const budgets = [...text.matchAll(/(?:预算(?:上限)?|租金上限|租金不超过|预算租金)(?:为|是|约为|约|不高于|不超过|<=|≤|:)?(\d{1,5}(?:\.\d{1,2})?)元\/(?:m2|平米|平方米)\/月/gi)];
  if (areas.length !== 1 || budgets.length !== 1 || /仅限?(?:非|不)|不考虑|不看|最低每|租金至少|分别租|分租|两套|各租/.test(text)) return undefined;
  const period = [...text.matchAll(/(\d{4})[Qq]([1-4])/g)];
  if (period.length > 1 || /上季度|本季度|今年第|去年|近\d+个?季度/.test(text)) return undefined;
  const walk = /步行(?:不超过|不高于|约|小于|<=|≤)?(\d{1,5})(?:米|m(?!2))/i.exec(text);
  const limit = /(?:推荐|筛选|给出|列出|初筛|前)(\d{1,3})(?:栋|座|处)/.exec(text);
  const grade = /(?:仅限|只看|限定|必须是|要求)(?:为)?(甲级|乙级|P级)(?!和|及|或|[+＋])/i.exec(text);
  const submarkets = inferSemanticScope(text).submarkets?.filter(market => market !== '其他' || text.includes('其他子市场'));
  let remaining = text;
  const recognized = [areas[0][0], budgets[0][0], period[0]?.[0], walk?.[0], limit?.[0], grade?.[0], ...(submarkets ?? [])];
  for (const phrase of recognized) if (phrase) remaining = remaining.replaceAll(phrase, '');
  remaining = remaining.replace(/CBD|望京|北京市?/gi, '').replace(excludedMap, '').replace(requestedMap, '')
    .replace(/(?:最新正式|最新有数据的?|最近一期)季度|地铁站|地铁|通勤|交通(?:便利)?|重视形象|形象(?:优先|好)?|产业匹配/g, '')
    .replace(/(?:金融|科技|咨询|保险|医药|贸易|专业服务)(?:类)?(?:企业|机构|公司)|办公选址|选址|想租|租赁|承租|找(?:办公楼|写字楼)|办公室|办公楼|写字楼|客户|优先|重视|需要|计划|拟|希望|帮我|请|建议|备选|候选|推荐|筛选|给出|找|租|坐落|位于|要求|面积(?:约|为)?|约|左右/g, '')
    .replace(/以内|内|在|和|与|及|以及|并|的|为|附近|一组|一家|[，,。！？!?、：:；;()]/gu, '');
  if (remaining) return undefined;
  const preferences: SiteSelectionRequest['preferences'] = [];
  if (/地铁|交通|通勤/.test(text)) preferences.push('transport');
  if (/形象/.test(text)) preferences.push('image');
  if (/(?:企业|机构|公司)|产业/.test(text)) preferences.push('industry');
  const parsed = siteSelectionSchema.safeParse({
    area: Number(areas[0][1]), budget: Number(budgets[0][1]),
    ...(walk ? { walkMeters: Number(walk[1]) } : {}),
    ...(grade ? { grade: ({ 甲级: 'A', 乙级: 'B', P级: 'P' } as const)[grade[1].toUpperCase() as '甲级' | '乙级' | 'P级'] } : {}),
    ...(period.length ? { period: { year: Number(period[0][1]), quarter: Number(period[0][2]) } } : {}),
    ...(submarkets?.length ? { submarkets } : {}),
    limit: limit ? Number(limit[1]) : 8, mapRequested: !mapExplicitlyExcluded(text) && requestedMap.test(text), preferences,
  });
  return parsed.success ? parsed.data : undefined;
}

export function siteSelectionScope(request: SiteSelectionRequest): QueryPlan['scope'] {
  return { inventory: 'tracked', ...(request.submarkets ? { submarkets: request.submarkets } : {}) };
}

export function siteSelectionPlan(request: SiteSelectionRequest, period: Quarter): QueryPlan {
  const rent = { field: 'netEffectiveRent', operator: 'lte', value: String(request.budget) };
  const projection: RankProjection[] = ['vacantArea', 'vacancyRate'];
  return parseQueryPlan({ operation: 'rank', scope: siteSelectionScope(request), period, field: 'netEffectiveRent',
    direction: 'asc', limit: request.limit, projection, filter: request.grade
      ? { operator: 'and', terms: [rent, { field: 'grade', operator: 'eq', value: request.grade }] } : rent });
}

export function siteSelectionNotice(request: SiteSelectionRequest): string {
  const preferences = request.preferences ?? [];
  const pending = ['当前报价', `${request.area} ㎡连续可租面积`];
  if (preferences.includes('image')) pending.push('楼宇形象');
  if (preferences.includes('industry')) pending.push('产业适配');
  return `候选按正式季度净有效租金与 ${request.budget} 元/㎡/月预算初筛。${pending.join('、')}仍需经纪人核实。`
    + (request.walkMeters ? `尚无可核验的 ${request.walkMeters} 米步行路径；楼书交通信息仅供初筛。`
      : preferences.includes('transport') ? '楼书交通信息仅供初筛，现场通勤条件需另行核实。' : '');
}
