import { z } from 'zod';
import { quarterSchema, type Quarter } from '../query/contracts';
import { parseQueryPlan, type QueryPlan, type RankProjection } from '../query/plan';
import { inferSemanticScope } from '../query/semanticPlanner';

export const siteSelectionSchema = z.strictObject({
  area: z.number().positive().max(1000000),
  budget: z.number().positive().max(10000),
  walkMeters: z.number().int().positive().max(10000).optional(),
  grade: z.enum(['A', 'B', 'P']).optional(),
  period: quarterSchema.optional(),
  submarkets: z.array(z.string()).max(8).optional(),
  limit: z.number().int().min(1).max(20),
  mapRequested: z.boolean(),
});
export type SiteSelectionRequest = z.infer<typeof siteSelectionSchema>;

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
  const parsed = siteSelectionSchema.safeParse({
    area: Number(areas[0][1]), budget: Number(budgets[0][1]),
    ...(walk ? { walkMeters: Number(walk[1]) } : {}),
    ...(grade ? { grade: ({ 甲级: 'A', 乙级: 'B', P级: 'P' } as const)[grade[1].toUpperCase() as '甲级' | '乙级' | 'P级'] } : {}),
    ...(period.length ? { period: { year: Number(period[0][1]), quarter: Number(period[0][2]) } } : {}),
    ...(submarkets?.length ? { submarkets } : {}),
    limit: limit ? Number(limit[1]) : 8, mapRequested: /地图/.test(text),
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
  return `候选按正式季度净有效租金与 ${request.budget} 元/㎡/月预算初筛。当前报价、${request.area} ㎡连续可租面积、形象和产业适配仍需经纪人核实。`
    + (request.walkMeters ? `尚无可核验的 ${request.walkMeters} 米步行路径；楼书交通信息仅供初筛。` : '楼书交通信息仅供初筛，现场通勤条件需另行核实。');
}
