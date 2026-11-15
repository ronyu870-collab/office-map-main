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
export type AvailablePeriods = z.infer<typeof schema>;

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
