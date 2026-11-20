import type { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { authorizePlan } from './admission';
import { quarterSchema, type Quarter } from './contracts';
import type { QueryPlan } from './plan';
import type { NumericField } from './registry';
import { loadDataAuthority, type DataAuthority, type VerifiedQueryIdentity } from './serverAuthority';

const fields = z.enum(['totalArea', 'vacantArea', 'netEffectiveRent']);
const count = z.number().int().min(0).max(20000);
const coverageSchema = z.strictObject({
  version: z.literal('quarterly-source-coverage/1'),
  permission_revision: z.string().regex(/^[0-9a-f]{64}$/),
  year: z.number().int().min(1900).max(2200), quarter: z.number().int().min(1).max(4),
  fields: z.array(fields).min(1).max(3), read_at: z.string().min(1),
  database_snapshot: z.string().min(1), catalog_buildings: count,
  formal: z.strictObject({
    source: z.literal('building_metrics'), rows: count, buildings: count, valid_buildings: count,
    unlocked_rows: count, draft_rows: count, incomplete_lock_evidence: count,
    locked_draft_conflicts: count, duplicate_metric_rows: count,
  }),
  submitted: z.strictObject({
    source: z.literal('quarterly_submissions'), rows: count, buildings: count,
    latest_rows: count, superseded_rows: count, latest_field_complete: count,
    zero_area_latest: count, missing_rent_latest: count, submitted_outside_calendar_quarter: count,
  }),
  overlap: z.strictObject({ buildings: count, conflicting_values: count }),
});
export type QuarterlyCoverage = z.infer<typeof coverageSchema>;

/** Only an independently authorized and bounded RPC may read submission metadata.
 * The formal snapshot/analytics engine never consumes submissions. */
export async function readQuarterlyCoverage(client: SupabaseClient, identity: VerifiedQueryIdentity,
  authority: DataAuthority, scope: QueryPlan['scope'], requestedFields: readonly NumericField[],
  period: Quarter, signal: AbortSignal): Promise<QuarterlyCoverage> {
  const selected = [...new Set(requestedFields.filter(field => fields.options.includes(field as typeof fields.options[number])))].sort();
  if (!selected.length) throw new Error('QUERY_QUARTERLY_FIELDS_REQUIRED');
  quarterSchema.parse(period);
  authorizePlan({ operation: 'list', fields: selected as NumericField[], period, scope }, authority);
  if (identity.actorId !== authority.actorId || identity.effectiveUserId !== authority.effectiveUserId
    || identity.sessionId !== authority.sessionId || identity.expiresAt <= Date.now()) throw new Error('QUERY_DENIED');
  const { data, error } = await client.rpc('ai_query_quarterly_coverage', {
    p_actor: identity.actorId, p_effective: identity.effectiveUserId, p_session: identity.sessionId,
    p_permission_revision: authority.permissionRevision, p_fields: selected,
    p_year: period.year, p_quarter: period.quarter, p_inventory: scope.inventory,
    p_submarkets: scope.submarkets ?? null, p_building_ids: scope.buildingIds ?? null,
  }).abortSignal(signal);
  signal.throwIfAborted();
  if (error) throw new Error(error.code === '42501' ? 'QUERY_DENIED' : 'QUERY_COVERAGE_UNAVAILABLE');
  const parsed = coverageSchema.parse(data);
  if (parsed.permission_revision !== authority.permissionRevision
    || parsed.year !== period.year || parsed.quarter !== period.quarter
    || JSON.stringify(parsed.fields) !== JSON.stringify(selected)
    || parsed.submitted.latest_rows !== parsed.submitted.buildings
    || parsed.submitted.rows !== parsed.submitted.latest_rows + parsed.submitted.superseded_rows
    || parsed.formal.valid_buildings > parsed.formal.buildings
    || parsed.overlap.buildings > Math.min(parsed.formal.buildings, parsed.submitted.buildings)) {
    throw new Error('QUERY_COVERAGE_UNAVAILABLE');
  }
  const current = await loadDataAuthority(client, identity, signal);
  if (current.permissionRevision !== authority.permissionRevision) throw new Error('QUERY_DENIED');
  return parsed;
}

/** A coverage notice is not a new market statistic, verified source, or alternative rent calculation. */
export function describeQuarterlyCoverage(coverage: QuarterlyCoverage, latestFormal: Quarter | null): string {
  const quarter = coverage.year + 'Q' + coverage.quarter;
  const formal = coverage.formal.valid_buildings;
  const submitted = coverage.submitted;
  const status = formal === 0 ? '本次指标口径没有符合已锁定且非草稿条件的有效正式样本'
    : '本次指标口径有 ' + formal + ' 栋正式有效楼宇';
  const other = submitted.rows ? '另有 ' + submitted.rows + ' 条季度提交，按楼宇去重涉及 '
    + submitted.buildings + ' 栋（最新记录中 ' + submitted.latest_field_complete
    + ' 栋具备所选字段的正向/非负数值）' : '未查询到其他季度提交';
  const latest = formal === 0 && latestFormal ? '；最近正式有效季度为 '
    + latestFormal.year + 'Q' + latestFormal.quarter : '';
  const quality = submitted.superseded_rows ? '；另有 ' + submitted.superseded_rows + ' 条同楼宇旧提交已去重' : '';
  const conflict = coverage.overlap.conflicting_values ? '；有 ' + coverage.overlap.conflicting_values
    + ' 栋正式记录与最新提交数值不一致，不能自动覆盖' : '';
  return quarter + '：' + status + '；' + other + '。这些提交尚未获正式统计核验，不能并入市场统计'
    + latest + quality + conflict + '。';
}
