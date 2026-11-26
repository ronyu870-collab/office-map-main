import type { QueryResultView } from './presentation';
import { resultMetricColumns, resultMetrics } from './multiMetricView';

export type ResultAvailability = { title: string; description: string; kind: 'empty' | 'missing' } | null;

/** Counts are evidence about a sample, never substitutes for an unrelated missing metric. */
export function resultAvailability(result: QueryResultView): ResultAvailability {
  const lease = result.parameters.dataDomain === 'lease-research/1';
  const business = result.parameters.dataDomain === 'business-research/1';
  const knowledge = result.parameters.domain === 'knowledge-research/1';
  const scope = result.parameters.scope as { mode?: unknown } | undefined;
  const leaseAggregate = lease && scope?.mode !== 'details';
  if (result.table.rows.length === 0) return {
    kind: 'empty', title: leaseAggregate ? '该期间暂无可交付统计' : lease ? '当前范围暂无可交付成交记录'
      : business ? '没有符合条件的业务资料' : knowledge ? '没有找到可交付的研究资料'
        : result.parameters.dataDomain || result.parameters.domain ? '当前范围没有可交付记录' : '没有符合条件的楼宇记录',
    description: lease ? '当前查询范围未返回可交付结果，不据此判断零成交；可在数据依据中核对期间与范围。'
      : '本次查询未返回符合条件的记录，可调整范围后重新查询。',
  };
  if (result.operation === 'list' && !leaseAggregate) return null;
  const metrics = resultMetrics(result);
  const keys = leaseAggregate ? ['count', 'area'].filter(key => result.table.columns.some(column => column.key === key))
    : metrics.length ? metrics.flatMap(metric => {
      const columns = resultMetricColumns(result, metric);
      return ['value', 'base', 'current'].flatMap(key => columns[key] ? [columns[key]] : []);
    }) : result.table.columns.filter(column => column.unit !== null && column.unit !== 'building_count'
      && !/Count|denominator|coverage/i.test(column.key)).map(column => column.key);
  if (!keys.length || result.table.rows.some(row => keys.some(key => row.cells[key]?.kind === 'number'))) return null;
  return { kind: 'missing', title: leaseAggregate ? '该期间暂无可交付统计' : '有记录，但没有可用的指标数值',
    description: leaseAggregate ? '未返回有效统计值，不能当作零成交；期间、范围和已有来源可在数据依据中查看。'
      : '指标缺失、无效或尚未核验，不能按零处理；具体状态可在数据依据中查看。' };
}
