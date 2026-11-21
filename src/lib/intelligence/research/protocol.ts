import { z } from 'zod';
import { quarterSchema } from '../query/contracts';
import { reportPeriodRange } from '../query/reportProtocol';
import { shiftQuarter } from '../query/relativeQuarter';
import { KNOWLEDGE_TOOL_SCHEMAS } from '../knowledge/protocol';

export const RESEARCH_DOMAIN = 'deep-research/1';
export const researchFormats = ['pdf', 'xlsx', 'docx', 'pptx'] as const;
export const researchSpecSchema = z.strictObject({
  submarkets: z.array(z.string().trim().min(1).max(80)).min(1).max(2).refine(a => new Set(a).size === a.length),
  start: quarterSchema.optional(), end: quarterSchema.optional(),
  recentCompletedQuarters: z.number().int().min(1).max(8).optional(),
  metrics: z.array(z.enum(['rent', 'vacancy', 'totalArea'])).min(1).max(3).default(['rent', 'vacancy']).refine(a => new Set(a).size === a.length),
  sampleMode: z.enum(['per_period', 'paired']).default('per_period'),
  leases: z.enum(['none', 'quarter', 'industry']).default('none'),
  supply: z.boolean().default(false), profiles: z.boolean().default(false),
  buildingIds: z.array(z.uuid()).min(1).max(20).optional(),
  jointRentVacancy: z.boolean().default(false),
  distribution: z.enum(['rent', 'vacancy']).optional(),
  documents: KNOWLEDGE_TOOL_SCHEMAS.search_internal_documents.optional(),
  publicResearch: KNOWLEDGE_TOOL_SCHEMAS.search_public_building_information.optional(),
}).superRefine((s, c) => {
  if (Boolean(s.start) !== Boolean(s.end) || s.start && s.recentCompletedQuarters !== undefined)
    c.addIssue({ code: 'custom', message: 'RESEARCH_AMBIGUOUS_PERIOD' });
  if (s.start && s.end && ((s.end.year - s.start.year) * 4 + s.end.quarter - s.start.quarter < 0
    || (s.end.year - s.start.year) * 4 + s.end.quarter - s.start.quarter >= 8))
    c.addIssue({ code: 'custom', message: 'RESEARCH_PERIOD_LIMIT' });
});
export type ResearchSpec = z.infer<typeof researchSpecSchema>;
export const RESEARCH_TOOL_SCHEMAS = {
  plan_research_task: researchSpecSchema,
  advance_research_task: z.strictObject({ taskId: z.uuid(), afterStep: z.string().max(60).nullable().default(null) }),
  review_research_task: z.strictObject({ taskId: z.uuid() }),
  generate_research_deliverable: z.strictObject({ taskId: z.uuid(),
    formats: z.array(z.enum(researchFormats)).min(1).max(4).refine(a => new Set(a).size === a.length),
    purpose: z.enum(['internal', 'client']).default('internal') }),
} as const;
export type ResearchToolName = keyof typeof RESEARCH_TOOL_SCHEMAS;
export const RESEARCH_TOOL_NAMES = new Set<string>(Object.keys(RESEARCH_TOOL_SCHEMAS));
export const researchStepSchema = z.strictObject({ id: z.string().max(60), title: z.string().max(160),
  tool: z.string().max(80), args: z.record(z.string(), z.unknown()), dependsOn: z.array(z.string()).max(10),
  state: z.enum(['pending', 'running', 'complete', 'blocked']), resultId: z.uuid().optional(),
  error: z.string().max(100).optional() });
export const researchTaskSchema = z.strictObject({ version: z.literal(RESEARCH_DOMAIN), id: z.uuid(),
  spec: researchSpecSchema, createdAt: z.iso.datetime(), updatedAt: z.iso.datetime(),
  start: quarterSchema, end: quarterSchema, state: z.enum(['planned', 'running', 'reviewed', 'interrupted', 'blocked']),
  steps: z.array(researchStepSchema).min(2).max(10) });
export type ResearchTask = z.infer<typeof researchTaskSchema>;
export type ResearchStep = z.infer<typeof researchStepSchema>;

/** Fixed DAG of existing tools, never a model-authored executable plan. */
export function researchPlan(raw: unknown, id: string, now = new Date()): ResearchTask {
  const spec = researchSpecSchema.parse(raw);
  const range = spec.start && spec.end ? { start: spec.start, end: spec.end } : reportPeriodRange(spec.recentCompletedQuarters ?? 4, now);
  const scope = { inventory: 'tracked', submarkets: spec.submarkets, ...(spec.buildingIds ? { buildingIds: spec.buildingIds } : {}) };
  const steps: ResearchStep[] = [];
  const add = (id: string, title: string, tool: string, args: Record<string, unknown>) => steps.push({ id, title, tool, args, dependsOn: [], state: 'pending' });
  const labels = { rent: '净有效租金', vacancy: '空置率', totalArea: '季度总面积' };
  for (const metric of spec.metrics) add('market_' + metric, labels[metric] + '趋势与区域比较', 'analyze_market_trends',
    { scope, ...range, metric, mode: spec.sampleMode, ...(spec.submarkets.length > 1 ? { groupBy: 'submarket' } : {}) });
  const from = `${range.start.year}-${String((range.start.quarter - 1) * 3 + 1).padStart(2, '0')}-01`;
  const next = shiftQuarter(range.end, 1);
  const to = new Date(Date.UTC(next.year, (next.quarter - 1) * 3, 0)).toISOString().slice(0, 10);
  if (spec.leases !== 'none') for (const [i, market] of spec.submarkets.entries()) add('leases_' + i, market + '历史与当前成交' + (spec.leases === 'industry' ? '行业结构' : '季度趋势'),
    'query_lease_transactions', { source: 'combined', from, to, mode: 'aggregate', groupBy: spec.leases,
      submarkets: [market], ...(spec.buildingIds ? { buildingIds: spec.buildingIds } : {}), sort: spec.leases === 'quarter' ? 'period' : 'area', direction: spec.leases === 'quarter' ? 'asc' : 'desc' });
  if (spec.supply) add('supply', '未来供应目录及其时效边界', 'query_future_supply', { submarkets: spec.submarkets, source: 'catalog' });
  if (spec.profiles) add('profiles', '已发布子市场资料', 'query_submarket_profile', { submarkets: spec.submarkets });
  if (spec.buildingIds) add('buildings', '已指定楼座的基础参数', 'query_building_dossier', { buildingIds: spec.buildingIds,
    fields: ['address', 'submarket', 'completionYear', 'gfaTotal', 'leasableArea', 'floors'] });
  if (spec.jointRentVacancy) add('joint', '末期租金与空置率联合有效样本', 'analyze_rent_vacancy', { scope, period: range.end });
  if (spec.distribution) add('distribution', '末期分布及异常标记', 'analyze_distribution', { scope, period: range.end, measure: spec.distribution });
  if (spec.documents) add('documents', '获权内部资料证据', 'search_internal_documents', spec.documents);
  if (spec.publicResearch) add('public', '批准的公开楼宇研究', 'search_public_building_information', spec.publicResearch);
  if (steps.length > 8) throw new Error('RESEARCH_STEP_LIMIT');
  steps.push({ id: 'review', title: '范围、单位、来源与披露审查', tool: 'review_research_task', args: {}, state: 'pending', dependsOn: steps.map(s => s.id) });
  return researchTaskSchema.parse({ version: RESEARCH_DOMAIN, id, spec, ...range, createdAt: now.toISOString(), updatedAt: now.toISOString(), state: 'planned', steps });
}
