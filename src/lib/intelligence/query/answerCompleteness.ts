import { z } from 'zod';
import { resultMetricAnalysis, resultMetricColumns, resultMetrics } from './multiMetricView';
import type { DisplayCell, QueryResultView } from './presentation';

const compareCounts = z.object({
  base: z.object({ usedEntityIds: z.array(z.string()) }),
  current: z.object({ usedEntityIds: z.array(z.string()) }),
});
const quarterlyOperations = new Set(['trend', 'group_trend', 'cross_trend', 'compare', 'aggregate', 'group_aggregate', 'cross_aggregate']);
const count = (cell: DisplayCell | undefined) => cell?.kind === 'number' && Number.isSafeInteger(cell.value.numeric) && cell.value.numeric >= 0;

/** A completed provider call is not sufficient evidence of requested deliverables.
 * Check the immutable source-bound result; never ask the model to fill holes. */
export function quarterlyAnswerIssues(question: string, result: QueryResultView): string[] {
  if (!quarterlyOperations.has(result.operation) || result.parameters.dataDomain === 'lease-research/1') return [];
  const wantsSamples = /各期样本|样本(?:数|数量|明细|楼宇|覆盖)|参与计算|多少栋|几栋/.test(question);
  const wantsAllValues = /每(?:一|个)?季度(?:的)?(?:数值|数据)|各期(?:数值|数据)|完整季度|逐季(?:列出|提供)/.test(question);
  if (!wantsSamples && !wantsAllValues) return [];
  const metrics = resultMetrics(result);
  if (!metrics.length) return [];
  const issues = new Set<string>();
  for (const metric of metrics) {
    const keys = resultMetricColumns(result, metric);
    if (wantsSamples) {
      const complete = result.operation === 'compare'
        ? compareCounts.safeParse(resultMetricAnalysis(result, metric)).success
        : !!keys.usedCount && result.table.rows.length > 0 && result.table.rows.every(row => count(row.cells[keys.usedCount]));
      if (!complete) issues.add('本次结果未完整返回所要求的有效样本数量，不将缺失样本当作零。');
    }
    if (wantsAllValues && ['trend', 'group_trend', 'cross_trend', 'compare'].includes(result.operation)) {
      const valueKeys = result.operation === 'compare' ? [keys.base, keys.current] : [keys.value];
      if (!result.table.rows.length || result.table.rows.some(row => valueKeys.some(key => !key || row.cells[key]?.kind !== 'number')))
        issues.add('部分要求的季度指标缺少有效数据，保留未知值，未以其他季度或零填补。');
    }
  }
  return [...issues];
}
