import type { QueryResultView } from './presentation';
import { resultMetricColumns, resultMetrics } from './multiMetricView';

export type ResultAvailability = { title: string; description: string; kind: 'empty' | 'missing' } | null;

/** Counts are evidence about the sample, never substitutes for a missing metric. */
export function resultAvailability(result: QueryResultView): ResultAvailability {
  if (result.table.rows.length === 0) return {
    kind: 'empty', title: '没有符合条件的楼宇记录',
    description: '本次已完成授权范围内的查询。可以调整项目、地区或期间后重新提问；空结果不代表现实市场中不存在这些楼宇。',
  };
  if (result.operation === 'list') return null;
  const metrics = resultMetrics(result);
  const keys = metrics.length ? metrics.flatMap(metric => {
    const columns = resultMetricColumns(result, metric);
    return ['value', 'base', 'current'].flatMap(key => columns[key] ? [columns[key]] : []);
  }) : result.table.columns.filter(column => column.unit !== null && column.unit !== 'building_count'
    && !/Count|denominator|coverage/i.test(column.key)).map(column => column.key);
  if (!keys.length || result.table.rows.some(row => keys.some(key => row.cells[key]?.kind === 'number'))) return null;
  return { kind: 'missing', title: '有记录，但没有可用的指标数值',
    description: '记录中的数值缺失、无效或不满足本次样本口径，不能按零处理。可查看来源和缺失说明，或选择其他指标、期间。' };
}
