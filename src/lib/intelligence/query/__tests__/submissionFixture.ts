import { SUBMISSION_POLICY, type SubmissionSnapshot } from '../submissions/contracts';
import type { DataAuthority } from '../serverAuthority';
export const id = (n: number) => `aaaaaaaa-aaaa-4aaa-8aaa-${String(n).padStart(12,'0')}`;
export const hash = 'a'.repeat(64), time = '2026-11-14T00:00:00.000001Z';
export const authority: DataAuthority = { actorId: id(10), effectiveUserId: id(10), sessionId: id(20), sessionActive: true,
  policyVersion: 'test', permissionRevision: hash, grants: ['query:catalog','query:submission-progress','query:submission-quality'],
  fields: [], allBuildings: true, buildingIds: [], allSubmarkets: true, submarkets: [] };
export function sample(): SubmissionSnapshot {
  const buildings = [1,2,3,4].map(n => ({ id: id(n), name: `${n}座`, submarket: 'CBD', grade: 'A', version: hash }));
  const assignment = (n: number, b: number, u: number) => ({ id: id(n), buildingId: id(b), userId: id(u), userName: '同名人员', createdAt: time, version: hash });
  const submission = (n: number, b: number, u: number) => ({ id: id(n), buildingId: id(b), userId: id(u), userName: '提交时姓名', createdAt: time,
    updatedAt: time, year: 2026, quarter: 3, version: hash, values: { total_area: '10000', vacant_area: '50', vacancy_rate: '0.5', asking_rent: '10',
      management_fee: '30', face_rent: '120', rent_free_period: '6', net_effective_rent: '100' } });
  return { policy: SUBMISSION_POLICY, snapshotId: id(90), requestId: id(91), databaseSnapshot: '1:2:', readAt: time,
    period: { year: 2026, quarter: 3 }, configuredPeriod: { year: 2026, quarter: 3 }, periodBasis: 'configured', quality: true,
    inventory: 'current_active_tracked_stock', assignmentsTime: 'current', complete: true,
    expected: { buildings: 4, assignments: 5, submissions: 4 },
    settings: [{ key: 'current_submission_year', value: '2026', version: hash, updatedAt: time }, { key: 'current_submission_quarter', value: '3', version: hash, updatedAt: time }],
    buildings, assignments: [assignment(31,1,11), assignment(32,1,11), assignment(33,1,12), assignment(34,2,11), assignment(35,3,12)],
    submissions: [submission(41,1,11), submission(42,1,11), submission(43,2,12), submission(44,4,12)],
  };
}
