import type { QueryPlan } from '../plan';
import { buildGroupedResult } from '../result';
import type { DataAuthority } from '../serverAuthority';
import { describePlanRead, normalizeSnapshot } from '../snapshotReader';

/** Synthetic observations using the ACTUAL UUID/version source-id normalizer.
 * Short A/B fixture IDs cannot validate serialized production-sized evidence. */
export function researchCapacityFixture(count: number) {
  const periods = [{ year: 2025, quarter: 4 }, { year: 2026, quarter: 1 }, { year: 2026, quarter: 2 }, { year: 2026, quarter: 3 }];
  const markets = ['CBD', '金融街', '望京-酒仙桥'];
  const plan: QueryPlan = { operation: 'group_trend', metric: 'rent', scope: { inventory: 'tracked', submarkets: markets },
    start: periods[0], end: periods[3], mode: 'per_period', groupBy: 'submarket' };
  const authority: DataAuthority = { actorId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', effectiveUserId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    sessionId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', sessionActive: true, policyVersion: 'capacity-fixture/1', permissionRevision: 'c'.repeat(64),
    grants: ['query:catalog', 'query:quarter'], fields: ['totalArea', 'netEffectiveRent'], allSubmarkets: true, allBuildings: true, submarkets: [], buildingIds: [] };
  const snapshots = normalizeSnapshot({ snapshot_id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', database_snapshot: 'capacity-synthetic',
    read_at: '2026-11-15T00:00:00Z', expected_count: count, complete: true, periods, fields: describePlanRead(plan).fields,
    inventory_time: 'current_catalog', brochure_selection: 'all_unresolved_record_candidates', rows: Array.from({ length: count }, (_, i) => ({
      id: '10000000-0000-4000-8000-' + String(i + 1).padStart(12, '0'), name: '合成容量楼宇' + i,
      submarket: markets[i % 3], grade: 'A', is_active: true, tracking_scope: 'tracked', version: 'a'.repeat(64), brochures: [],
      metrics: periods.map((period, j) => ({ id: '20000000-0000-4000-8000-' + String(i * 4 + j + 1).padStart(12, '0'),
        year: period.year, quarter: period.quarter, version: 'b'.repeat(64), recorded_at: '2026-10-01T00:00:00Z',
        values: { netEffectiveRent: String(100 + i % 25 + j * 5), totalArea: String(10000 + i % 10 * 1000) } })),
    })) }, plan, authority);
  return { snapshots, original: buildGroupedResult(snapshots, snapshots, 'submarket', 'rent', 'per_period') };
}
