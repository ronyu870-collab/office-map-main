import {futureLaunchRangeSchema} from './future/contracts';
import {futureViewSchema,futureModeForView} from './future/view';
import { z } from 'zod';
import { submissionViewSchema } from './submissions/view';
import { distributionMeasureSchema } from './distribution';
import { quarterSchema, type Quarter } from './contracts';
import type { Predicate } from './facts';

const fieldSchema = z.enum(['height', 'floors', 'parking', 'totalArea', 'vacantArea', 'netEffectiveRent']);
const metricSchema = z.enum(['rent', 'vacancy', 'totalArea']);
const numericString = z.string().max(100).regex(/^[+-]?\d+(?:\.\d+)?(?:[eE][+-]?\d{1,3})?$/);
const predicateSchema: z.ZodType<Predicate> = z.lazy(() => z.union([
  z.strictObject({ field: fieldSchema, operator: z.enum(['gt', 'gte', 'lt', 'lte', 'eq']), value: numericString }),
  z.strictObject({ operator: z.enum(['and', 'or']), terms: z.array(predicateSchema).min(1).max(20) }),
]));
const scopeSchema = z.strictObject({
  // Canonical IDs/names resolved and authorized upstream. Never a SQL/filter fragment.
  submarkets: z.array(z.string().trim().min(1).max(80)).min(1).max(30).optional(),
  buildingIds: z.array(z.uuid()).min(1).max(500).optional(),
  inventory: z.enum(['tracked', 'all_authorized']),
});
const common = { scope: scopeSchema, filter: predicateSchema.optional() };
const planSchema = z.discriminatedUnion('operation', [
  z.strictObject({operation:z.literal('future_observation'),view:futureViewSchema,period:quarterSchema.nullable(),launchRange:futureLaunchRangeSchema.optional(),filter:z.never().optional(),scope:z.strictObject({inventory:z.literal('future'),submarkets:z.array(z.string().trim().min(1).max(80)).min(1).max(30).optional(),futureIds:z.array(z.uuid()).min(1).max(500).optional(),buildingIds:z.never().optional()})}),
  z.strictObject({ scope: scopeSchema, filter: z.never().optional(), operation: z.literal('submission_progress'), period: quarterSchema.nullable(), view: submissionViewSchema }),
  z.strictObject({ ...common, operation: z.literal('list'), fields: z.array(fieldSchema).max(6), period: quarterSchema.nullable() }),
  z.strictObject({ ...common, operation: z.literal('rank'), field: fieldSchema, period: quarterSchema.nullable(), direction: z.enum(['asc', 'desc']), limit: z.number().int().min(1).max(1000) }),
  z.strictObject({ ...common, operation: z.literal('aggregate'), metric: metricSchema, period: quarterSchema }),
  z.strictObject({ ...common, operation: z.literal('distribution'), measure: distributionMeasureSchema, period: quarterSchema.nullable() }),
  z.strictObject({ ...common, operation: z.literal('relationship'), period: quarterSchema }),
  z.strictObject({ ...common, operation: z.literal('cross_aggregate'), metric: metricSchema, period: quarterSchema }),
  z.strictObject({ ...common, operation: z.literal('trend'), metric: metricSchema, start: quarterSchema, end: quarterSchema, mode: z.enum(['per_period', 'paired']) }),
  z.strictObject({ ...common, operation: z.literal('group_aggregate'), metric: metricSchema, period: quarterSchema, groupBy: z.enum(['submarket', 'grade']) }),
  z.strictObject({ ...common, operation: z.literal('group_trend'), metric: metricSchema, start: quarterSchema, end: quarterSchema, mode: z.enum(['per_period', 'paired']), groupBy: z.enum(['submarket', 'grade']) }),
  z.strictObject({ ...common, operation: z.literal('compare'), metric: metricSchema, base: quarterSchema, current: quarterSchema, mode: z.enum(['per_period', 'paired']) }),
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
  if(plan.operation==='future_observation'&&plan.launchRange&&futureModeForView(plan.view)!=='catalog')throw new Error('FUTURE_RANGE_CATALOG_ONLY');
  if(plan.operation==='future_observation'&&futureModeForView(plan.view)==='catalog'&&plan.period!==null)throw new Error('FUTURE_CATALOG_PERIOD_FORBIDDEN');
  if (plan.operation === 'submission_progress' && plan.scope.inventory !== 'tracked') throw new Error('SUBMISSION_TRACKED_STOCK_REQUIRED');
  if (plan.operation === 'distribution' && !['height','floors','parking'].includes(plan.measure) && !plan.period) throw new Error('QUARTER_REQUIRED');
  if (plan.operation === 'list' && new Set(plan.fields).size !== plan.fields.length) throw new Error('DUPLICATE_QUERY_FIELD');
  if (plan.operation === 'trend' || plan.operation === 'group_trend') quarterRange(plan.start, plan.end);
  return plan;
}

/** Consecutive quarters, including those without observations. */
export function quarterRange(start: Quarter, end: Quarter): Quarter[] {
  quarterSchema.parse(start); quarterSchema.parse(end);
  const first=start.year*4+start.quarter-1, last=end.year*4+end.quarter-1;
  if(last-first<1 || last-first>=40)throw new Error('TREND_REQUIRES_2_TO_40_QUARTERS');
  return Array.from({length:last-first+1},(_,i)=>({year:Math.floor((first+i)/4),quarter:(first+i)%4+1}));
}
export function planPeriods(plan: QueryPlan): (Quarter|null)[] {
  return plan.operation==='trend'||plan.operation==='group_trend'?quarterRange(plan.start,plan.end):plan.operation==='compare'?[plan.base,plan.current]:[plan.period];
}
