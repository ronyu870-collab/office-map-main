import { z } from 'zod';
import { distributionFields, distributionMeasureSchema } from './distribution';
import { quarterSchema, type Quarter } from './contracts';
import type { Predicate } from './facts';
import type { NumericField } from './registry';

const fieldSchema = z.enum(['height', 'floors', 'parking', 'totalArea', 'vacantArea', 'netEffectiveRent']);
const rankProjectionSchema = z.enum([...fieldSchema.options, 'vacancyRate']);
export type RankProjection = z.infer<typeof rankProjectionSchema>;
export function rankProjectionFields(projection: readonly RankProjection[]): NumericField[] {
  return [...new Set(projection.flatMap((field): NumericField[] =>
    field === 'vacancyRate' ? ['totalArea', 'vacantArea'] : [field]))];
}
const metricSchema = z.enum(['rent', 'vacancy', 'totalArea']);
const metricSelection = { metric: metricSchema, metrics: z.array(metricSchema).min(2).max(3).optional() };
export const CROSS_TREND_LIMITS = Object.freeze({ groups: 50, metricPoints: 1000 });
const numericString = z.string().max(100).regex(/^[+-]?\d+(?:\.\d+)?(?:[eE][+-]?\d{1,3})?$/);
const predicateSchema: z.ZodType<Predicate> = z.lazy(() => z.union([
  z.strictObject({ field: z.enum([...fieldSchema.options, 'vacancyRate']), operator: z.enum(['gt', 'gte', 'lt', 'lte', 'eq']), value: numericString }),
  z.strictObject({ field: z.literal('grade'), operator: z.literal('eq'), value: z.enum(['A', 'B', 'P']) }),
  z.strictObject({ operator: z.enum(['and', 'or']), terms: z.array(predicateSchema).min(1).max(20) }),
]));
const scopeSchema = z.strictObject({
  // Canonical IDs/names resolved and authorized upstream. Never a SQL/filter fragment.
  submarkets: z.array(z.string().trim().min(1).max(80)).min(1).max(30).optional(),
  buildingIds: z.array(z.uuid()).min(1).max(500).optional(),
  inventory: z.enum(['tracked', 'all_authorized']),
});
const common = { scope: scopeSchema, filter: predicateSchema.optional() };
export const planSchema = z.discriminatedUnion('operation', [
  z.strictObject({ ...common, operation: z.literal('list'), fields: z.array(fieldSchema).max(6), period: quarterSchema.nullable() }),
  z.strictObject({ ...common, operation: z.literal('rank'), field: fieldSchema, projection: z.array(rankProjectionSchema).min(1).max(6).optional(), period: quarterSchema.nullable(), direction: z.enum(['asc', 'desc']), limit: z.number().int().min(1).max(1000) }),
  z.strictObject({ ...common, operation: z.literal('aggregate'), ...metricSelection, period: quarterSchema }),
  z.strictObject({ ...common, operation: z.literal('distribution'), measure: distributionMeasureSchema, period: quarterSchema.nullable() }),
  z.strictObject({ ...common, operation: z.literal('relationship'), period: quarterSchema }),
  z.strictObject({ ...common, operation: z.literal('cross_aggregate'), ...metricSelection, period: quarterSchema }),
  z.strictObject({ ...common, operation: z.literal('cross_trend'), ...metricSelection, start: quarterSchema, end: quarterSchema, mode: z.enum(['per_period', 'paired']) }),
  z.strictObject({ ...common, operation: z.literal('trend'), ...metricSelection, start: quarterSchema, end: quarterSchema, mode: z.enum(['per_period', 'paired']) }),
  z.strictObject({ ...common, operation: z.literal('group_aggregate'), ...metricSelection, period: quarterSchema, groupBy: z.enum(['submarket', 'grade']) }),
  z.strictObject({ ...common, operation: z.literal('group_trend'), ...metricSelection, start: quarterSchema, end: quarterSchema, mode: z.enum(['per_period', 'paired']), groupBy: z.enum(['submarket', 'grade']) }),
  z.strictObject({ ...common, operation: z.literal('compare'), ...metricSelection, base: quarterSchema, current: quarterSchema, mode: z.enum(['per_period', 'paired']) }),
]);
export type QueryPlan = z.infer<typeof planSchema>;

/** Bounded structural validation before recursive schema parsing; model output is untrusted. */
export function parseQueryPlan(input: unknown): QueryPlan {
  const stack: { value: unknown; depth: number }[] = [{ value: input, depth: 0 }];
  const visited = new Set<object>();
  let nodes = 0;
  while (stack.length) {
    const item = stack.pop()!;
    if (++nodes > 5000 || item.depth > 24) throw new Error('QUERY_PLAN_TOO_COMPLEX');
    if (typeof item.value === 'object' && item.value !== null) {
      if (visited.has(item.value)) throw new Error('CYCLIC_QUERY_PLAN');
      visited.add(item.value);
      for (const [key, value] of Object.entries(item.value)) {
        if (['__proto__', 'prototype', 'constructor'].includes(key)) throw new Error('UNSAFE_QUERY_PLAN_KEY');
        stack.push({ value, depth: item.depth + 1 });
      }
    } else if (typeof item.value === 'string' && item.value.length > 200) throw new Error('QUERY_PLAN_VALUE_TOO_LONG');
  }
  const plan = planSchema.parse(input);
  if (plan.operation === 'distribution' && !['height','floors','parking'].includes(plan.measure) && !plan.period) throw new Error('QUARTER_REQUIRED');
  if (plan.operation === 'list' && new Set(plan.fields).size !== plan.fields.length) throw new Error('DUPLICATE_QUERY_FIELD');
  if (plan.operation === 'rank' && plan.projection && (new Set(plan.projection).size !== plan.projection.length || plan.projection.includes(plan.field)))
    throw new Error('DUPLICATE_QUERY_FIELD');
  if ('metrics' in plan && plan.metrics && (plan.metrics[0] !== plan.metric || new Set(plan.metrics).size !== plan.metrics.length)) throw new Error('INVALID_QUERY_METRICS');
  if (plan.operation === 'trend' || plan.operation === 'group_trend' || plan.operation === 'cross_trend') quarterRange(plan.start, plan.end);
  return plan;
}

/** A single snapshot request includes every metric input before authorization. */
export function planMetrics(plan: QueryPlan): ('rent' | 'vacancy' | 'totalArea')[] {
  return 'metric' in plan ? [...(plan.metrics ?? [plan.metric])] : [];
}
export function planOutputFields(plan: QueryPlan): NumericField[] {
  if (plan.operation === 'list') return [...plan.fields];
  if (plan.operation === 'rank') return [...new Set([plan.field, ...rankProjectionFields(plan.projection ?? [])])];
  if (plan.operation === 'distribution') return [...distributionFields(plan.measure)];
  if (plan.operation === 'relationship') return ['totalArea', 'netEffectiveRent', 'vacantArea'];
  return [...new Set(planMetrics(plan).flatMap((metric): NumericField[] => metric === 'rent'
    ? ['totalArea', 'netEffectiveRent'] : metric === 'vacancy' ? ['totalArea', 'vacantArea'] : ['totalArea']))];
}

/** Consecutive quarters, including those without observations. */
export function quarterRange(start: Quarter, end: Quarter): Quarter[] {
  quarterSchema.parse(start); quarterSchema.parse(end);
  const first=start.year*4+start.quarter-1, last=end.year*4+end.quarter-1;
  if(last-first<1 || last-first>=40)throw new Error('TREND_REQUIRES_2_TO_40_QUARTERS');
  return Array.from({length:last-first+1},(_,i)=>({year:Math.floor((first+i)/4),quarter:(first+i)%4+1}));
}
export function planPeriods(plan: QueryPlan): (Quarter|null)[] {
  return plan.operation==='trend'||plan.operation==='group_trend'||plan.operation==='cross_trend'?quarterRange(plan.start,plan.end):plan.operation==='compare'?[plan.base,plan.current]:[plan.period];
}
