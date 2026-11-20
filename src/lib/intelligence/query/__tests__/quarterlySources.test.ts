import { describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { readQuarterlyCoverage, describeQuarterlyCoverage } from '../quarterlySources';
import type { DataAuthority } from '../serverAuthority';

const id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1';
const revision = 'a'.repeat(64);
const authority: DataAuthority = {
  actorId: id, effectiveUserId: id, sessionId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', sessionActive: true,
  policyVersion: 'test', permissionRevision: revision, grants: ['query:catalog', 'query:quarter'],
  fields: ['totalArea', 'netEffectiveRent'], allSubmarkets: false, submarkets: ['CBD'],
  allBuildings: false, buildingIds: [id],
};
const identity = { actorId: id, effectiveUserId: id, sessionId: authority.sessionId, expiresAt: Date.now() + 600000 };
const period = { year: 2026, quarter: 3 };
function response() {
  return {
    version: 'quarterly-source-coverage/1', permission_revision: revision, year: 2026, quarter: 3,
    fields: ['netEffectiveRent', 'totalArea'], read_at: '2026-11-20T00:00:00Z',
    database_snapshot: '1:2:', catalog_buildings: 36,
    formal: { source: 'building_metrics', rows: 0, buildings: 0, valid_buildings: 0,
      unlocked_rows: 2, draft_rows: 1, incomplete_lock_evidence: 0,
      locked_draft_conflicts: 0, duplicate_metric_rows: 0 },
    submitted: { source: 'quarterly_submissions', rows: 69, buildings: 36, latest_rows: 36,
      superseded_rows: 33, latest_field_complete: 36, zero_area_latest: 0,
      missing_rent_latest: 0, submitted_outside_calendar_quarter: 0 },
    overlap: { buildings: 0, conflicting_values: 0 },
  };
}
function client(data: unknown = response(), error: unknown = null) {
  const rpc = vi.fn((name: string) => ({
    abortSignal: async () => name === 'ai_query_authority' ? { data: {
      allowed: true, access_policy: 'admin-only/1', actor_id: id, effective_user_id: id,
      session_id: authority.sessionId, policy_version: 'test', permission_revision: revision,
      capabilities: ['query:catalog', 'query:quarter'], fields: ['totalArea', 'netEffectiveRent'],
      all_submarkets: false, submarkets: ['CBD'], all_buildings: false, building_ids: [id],
    }, error: null } : { data, error },
  }));
  return { rpc } as unknown as SupabaseClient & { rpc: typeof rpc };
}
const read = (c: SupabaseClient, auth = authority) => readQuarterlyCoverage(c, identity, auth,
  { inventory: 'tracked', submarkets: ['CBD'], buildingIds: [id] }, ['totalArea', 'netEffectiveRent'],
  period, new AbortController().signal);

describe('authorized quarterly source adapter', () => {
  it('keeps the formal and submitted counts distinct with unreviewed status', async () => {
    const c = client();
    const result = await read(c);
    expect(result.formal.valid_buildings).toBe(0);
    expect(result.submitted.rows).toBe(69);
    expect(result.submitted.buildings).toBe(36);
    expect(result.submitted.superseded_rows).toBe(33);
    expect(describeQuarterlyCoverage(result, { year: 2026, quarter: 2 })).toContain('最近正式有效季度为 2026Q2');
    expect(describeQuarterlyCoverage(result, null)).toContain('不能并入市场统计');
    expect(c.rpc).toHaveBeenCalledWith('ai_query_quarterly_coverage', expect.objectContaining({
      p_year: 2026, p_quarter: 3, p_submarkets: ['CBD'], p_building_ids: [id],
      p_fields: ['netEffectiveRent', 'totalArea'],
    }));
  });
  it('denies restricted fields without making a database request', async () => {
    const c = client();
    await expect(read(c, { ...authority, fields: ['totalArea'] })).rejects.toThrow();
    expect(c.rpc).not.toHaveBeenCalled();
  });
  it('fails closed on inconsistent source counts or permission revisions', async () => {
    const inconsistent = response(); inconsistent.submitted.latest_rows = 69;
    await expect(read(client(inconsistent))).rejects.toThrow('QUERY_COVERAGE_UNAVAILABLE');
    await expect(read(client({ ...response(), permission_revision: 'b'.repeat(64) }))).rejects.toThrow('QUERY_COVERAGE_UNAVAILABLE');
  });
  it('never falls back to unscoped table reads after an RPC failure', async () => {
    const c = client(null, { code: '42501', message: 'denied' });
    await expect(read(c)).rejects.toThrow('QUERY_DENIED');
    expect(c.rpc).toHaveBeenCalledTimes(1);
  });
});
