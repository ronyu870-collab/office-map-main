import { z } from 'zod';
import { authorizePlan } from '@/src/lib/intelligence/query/admission';
import type { Quarter } from '@/src/lib/intelligence/query/contracts';
import { parseQueryPlan } from '@/src/lib/intelligence/query/plan';
import type { DataAuthority } from '@/src/lib/intelligence/query/serverAuthority';
import { normalizeSnapshot } from '@/src/lib/intelligence/query/snapshotReader';
import { DocumentError } from '@/src/lib/intelligence/knowledge/safeArchive';
import { pitchRpc, type PitchContext } from '../data/store';

const researchSnapshotSchema = z.union([
  z.object({ limit: z.literal(true) }),
  z.object({ buildingIds: z.array(z.uuid()).max(500), snapshot: z.unknown() }),
]);

export async function readQuarterlyResearchSnapshot(ctx: PitchContext, authority: DataAuthority, period: Quarter) {
  const capture = researchSnapshotSchema.parse(await pitchRpc(ctx, {
    action: 'business_quarterly_research_snapshot', period, permissionRevision: authority.permissionRevision,
  }));
  if ('limit' in capture)
    throw new DocumentError('PITCH_DATA_UNAVAILABLE', '北京甲级写字楼的获权样本超过单次汇总容量。');
  if (!capture.buildingIds.length)
    throw new DocumentError('PITCH_DATA_UNAVAILABLE', '当前账号在北京甲级写字楼范围内没有获权跟踪样本。');
  const plan = parseQueryPlan({ operation: 'aggregate', scope: { inventory: 'tracked', buildingIds: capture.buildingIds },
    period, metric: 'rent', metrics: ['rent', 'vacancy', 'totalArea'] });
  authorizePlan(plan, authority);
  const snapshots = normalizeSnapshot(capture.snapshot, plan, authority);
  if (snapshots[0].rows.length !== capture.buildingIds.length) throw new Error('QUERY_DENIED');
  if (!snapshots[0].rows.some(row => Object.values(row.facts).some(fact => fact.state === 'valid')))
    throw new DocumentError('PITCH_DATA_UNAVAILABLE', '所选正式季度在获权样本内没有可汇总的指标。');
  return { plan, snapshots };
}
