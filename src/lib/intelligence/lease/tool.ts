import type { SupabaseClient } from '@supabase/supabase-js';
import type { VerifiedQueryIdentity } from '../query/serverAuthority';
import type { QueryResult } from '../query/result';
import { authorizeLeasePlan, buildLeaseResult, loadLeaseSnapshot } from './research';
import { leasePlanSchema } from './protocol';

/** The external provider gets approved aggregate cells only, never row-level lease facts. */
export function leaseModelObservation(result: QueryResult) {
  const bindings = result.parameters.leaseBindings as Array<{ plan: { mode: string } }>;
  const details = bindings.some(b => b.plan.mode === 'details');
  const minimum = typeof result.parameters.leaseProviderMinGroupSize === 'number'
    ? Math.max(3, result.parameters.leaseProviderMinGroupSize) : 100;
  const providerRows = result.table.rows.filter(row => row.cells.count?.kind === 'number' && row.cells.count.value.numeric >= minimum);
  const providerCell = (key: string, row: QueryResult['table']['rows'][number]) => {
    const cell = row.cells[key];
    if (key === 'area' && (row.cells.areaValidCount?.kind !== 'number' || row.cells.areaValidCount.value.numeric < minimum)) return null;
    return cell.kind === 'unknown' ? null : cell.kind === 'number' ? cell.value : cell.value;
  };
  return { status: 'ready', resultId: result.resultId, dataDomain: result.parameters.dataDomain,
    rowCount: result.table.rows.length, columns: result.table.columns,
    coverage: result.parameters.leaseCoverage,
    ...(!details ? { aggregates: providerRows.slice(0, 12).map(row => ({
      values: Object.fromEntries(Object.keys(row.cells).map(key => [key, providerCell(key, row)])),
    })), previewOnly: providerRows.length > 12, providerSuppressedGroups: result.table.rows.length - providerRows.length } : {}),
    limitations: result.limitations,
    note: details ? '获权脱敏明细仅交付当前用户的正式结果/文件，模型不可读取明细、分页、明细图表点或原始客户信息。可使用export_table生成完整文件。'
      : '模型仅收到达到聚合披露阈值的统计，不接收小组或低有效样本面积；获权用户的正式表格／图表保留其完整允许范围。聚合值由服务端确定性计算；成交记录数不等于已完成全量人工去重的交易总数。图表使用完整正式结果。' };
}
export async function queryLeaseResearch(client: SupabaseClient, identity: VerifiedQueryIdentity, signal: AbortSignal, raw: unknown) {
  const plan = leasePlanSchema.parse(raw);
  const snapshot = await loadLeaseSnapshot(client, identity, signal);
  authorizeLeasePlan(plan, snapshot);
  if (plan.industry?.toUpperCase() === 'TMT') return {
    content: JSON.stringify({ status: 'requires_clarification', reason: '既有行业治理将TMT视为可能歧义的概念。请确认仅按原始TMT标签筛选（industries=["TMT"]），或明确需要组合的industries分类；可先按industry分组查看获权分类。当前仅说明分类口径待确认，不表示数据库有无成交，不能自动将科技/媒体/通信混为同类。' }),
  };
  const result = buildLeaseResult(snapshot, plan);
  return { result, content: JSON.stringify(leaseModelObservation(result)) };
}
