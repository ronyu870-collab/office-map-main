import type { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { authorizePlan } from './admission';
import { quarterSchema } from './contracts';
import type { QueryPlan } from './plan';
import type { NumericField } from './registry';
import { loadDataAuthority, type DataAuthority, type VerifiedQueryIdentity } from './serverAuthority';

const schema = z.strictObject({
  version: z.literal('authorized-periods/1'), permission_revision: z.string().regex(/^[a-f0-9]{64}$/),
  read_at: z.string().min(1), inventory_time: z.literal('current_catalog'),
  fields: z.array(z.enum(['totalArea', 'vacantArea', 'netEffectiveRent'])).min(1).max(3),
  truncated: z.boolean(), periods: z.array(quarterSchema).max(40),
});
export type AvailablePeriods = z.infer<typeof schema> & {
  availabilityMethod?: 'intersection_of_independently_valid_metric_periods';
  fieldGroups?: Array<Pick<z.infer<typeof schema>, 'fields' | 'periods' | 'truncated' | 'read_at'>>;
};

/** Metadata from the same row/field authority as the final trusted snapshot; never a calendar guess. */
export async function readAvailablePeriods(client: SupabaseClient, identity: VerifiedQueryIdentity, authority: DataAuthority,
  scope: QueryPlan['scope'], fields: NumericField[], signal: AbortSignal): Promise<AvailablePeriods> {
  const quarterFields = [...new Set(fields.filter(field => ['totalArea', 'vacantArea', 'netEffectiveRent'].includes(field)))].sort();
  authorizePlan({ operation: 'list', fields: quarterFields as NumericField[], period: { year: 2000, quarter: 1 }, scope }, authority);
  if (!quarterFields.length) throw new Error('QUERY_PERIOD_FIELDS_REQUIRED');
  const { data, error } = await client.rpc('ai_query_available_periods', {
    p_actor: identity.actorId, p_effective: identity.effectiveUserId, p_session: identity.sessionId,
    p_permission_revision: authority.permissionRevision, p_fields: quarterFields, p_inventory: scope.inventory,
    p_submarkets: scope.submarkets ?? null, p_building_ids: scope.buildingIds ?? null,
  }).abortSignal(signal);
  signal.throwIfAborted();
  if (error) throw new Error(error.code === '42501' ? 'QUERY_DENIED' : 'QUERY_PERIODS_UNAVAILABLE');
  const value = schema.parse(data);
  if (value.permission_revision !== authority.permissionRevision || JSON.stringify(value.fields) !== JSON.stringify(quarterFields)
    || value.periods.some((period, index) => index > 0 && (period.year * 4 + period.quarter <= value.periods[index - 1].year * 4 + value.periods[index - 1].quarter))) {
    throw new Error('QUERY_PERIODS_UNAVAILABLE');
  }
  const current = await loadDataAuthority(client, identity, signal);
  if (current.permissionRevision !== authority.permissionRevision) throw new Error('QUERY_DENIED');
  return value;
}

/** At most three authorized metadata reads, while the factual execution still
 * uses one snapshot. Different metrics may use different valid buildings. */
export async function readAvailablePeriodGroups(client: SupabaseClient, identity: VerifiedQueryIdentity, authority: DataAuthority,
  scope: QueryPlan['scope'], groups: NumericField[][], signal: AbortSignal): Promise<AvailablePeriods> {
  if (!groups.length || groups.length > 3) throw new Error('QUERY_PERIOD_GROUPS_INVALID');
  const normalized = groups.map(group => [...new Set(group)].sort());
  if (normalized.some(group => !group.length || group.some(field => !['totalArea', 'vacantArea', 'netEffectiveRent'].includes(field)))) throw new Error('QUERY_PERIOD_GROUPS_INVALID');
  const distinct = [...new Map(normalized.map(group => [JSON.stringify(group), group])).values()];
  const fields = [...new Set(distinct.flat())].sort();
  // Validate every group before starting any metadata read; no partial read of
  // an otherwise unauthorized composite request is necessary.
  authorizePlan({ operation: 'list', fields, period: { year: 2000, quarter: 1 }, scope }, authority);
  const readings = await Promise.all(distinct.map(group => readAvailablePeriods(client, identity, authority, scope, group, signal)));
  if (readings.length === 1) return readings[0];
  const periodKey = (period: z.infer<typeof quarterSchema>) => `${period.year}Q${period.quarter}`;
  const available = readings.slice(1).map(reading => new Set(reading.periods.map(periodKey)));
  return { ...readings[0], fields: fields as AvailablePeriods['fields'],
    periods: readings[0].periods.filter(period => available.every(index => index.has(periodKey(period)))),
    read_at: readings.map(reading => reading.read_at).sort().at(-1)!, truncated: readings.some(reading => reading.truncated),
    availabilityMethod: 'intersection_of_independently_valid_metric_periods',
    fieldGroups: readings.map(({ fields, periods, truncated, read_at }) => ({ fields, periods, truncated, read_at })) };
}
