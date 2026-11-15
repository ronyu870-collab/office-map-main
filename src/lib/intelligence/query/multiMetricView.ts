import { z } from 'zod';
import type { QueryResultView } from './presentation';

export const metricSchema = z.enum(['rent', 'vacancy', 'totalArea']);
export type ResultMetric = z.infer<typeof metricSchema>;
export const metricLabels: Readonly<Record<ResultMetric, string>> = { rent: '净有效租金', vacancy: '空置率', totalArea: '季度总面积' };
const metricsSchema = z.array(metricSchema).min(2).max(3);
const supported = new Set(['aggregate', 'compare', 'trend', 'group_aggregate', 'group_trend', 'cross_aggregate']);
export const metricDimensionKeys: ReadonlySet<string> = new Set(['name', 'grade', 'period']);
const valueKeys = new Set(['value', 'usedCount', 'availableCount', 'denominator', 'coverage', 'base', 'current', 'difference', 'change',
  'baseUsedCount', 'currentUsedCount', 'baseDenominator', 'currentDenominator']);
const operationKeys: Readonly<Record<string, readonly string[]>> = {
  aggregate: ['value', 'usedCount', 'denominator', 'coverage'],
  compare: ['base', 'current', 'difference', 'change', 'baseUsedCount', 'currentUsedCount', 'baseDenominator', 'currentDenominator'],
  trend: ['period', 'value', 'usedCount', 'availableCount', 'denominator', 'coverage'],
  group_aggregate: ['name', 'period', 'value', 'usedCount', 'availableCount', 'denominator', 'coverage'],
  group_trend: ['name', 'period', 'value', 'usedCount', 'availableCount', 'denominator', 'coverage'],
  cross_aggregate: ['name', 'grade', 'value', 'usedCount', 'denominator', 'coverage'],
};

/** Reads saved metadata only. No field, sample or value is inferred by the UI. */
export function resultMetrics(result: Pick<QueryResultView, 'operation' | 'parameters'>): ResultMetric[] {
  if (result.parameters.metrics !== undefined) {
    const metrics = metricsSchema.parse(result.parameters.metrics);
    if (!supported.has(result.operation) || metrics[0] !== result.parameters.metric || new Set(metrics).size !== metrics.length)
      throw new Error('MULTI_METRIC_METADATA_INVALID');
    return metrics;
  }
  const single = metricSchema.safeParse(result.parameters.metric);
  return single.success ? [single.data] : [];
}

/** Canonical column mapping prevents an option from relabeling another metric. */
export function resultMetricColumns(result: QueryResultView, metric: ResultMetric): Record<string, string> {
  const metrics = resultMetrics(result), index = metrics.indexOf(metric);
  if (index < 0) throw new Error('RESULT_METRIC_NOT_AVAILABLE');
  if (metrics.length === 1) return Object.fromEntries(result.table.columns.map(column => [column.key, column.key]));
  const all = z.partialRecord(metricSchema, z.record(z.string().max(80), z.string().max(80))).parse(result.parameters.metricColumns);
  const columns = all[metric];
  if (!columns || JSON.stringify(Object.keys(all).sort()) !== JSON.stringify([...metrics].sort())
    || JSON.stringify(Object.keys(columns)) !== JSON.stringify(operationKeys[result.operation])) throw new Error('MULTI_METRIC_COLUMNS_INVALID');
  for (const [key, mapped] of Object.entries(columns)) {
    const expected = metricDimensionKeys.has(key) || index === 0 ? key : `${metric}_${key}`;
    if ((!metricDimensionKeys.has(key) && !valueKeys.has(key)) || mapped !== expected
      || !result.table.columns.some(column => column.key === mapped)
      || result.table.rows.some(row => !Object.hasOwn(row.cells, mapped))) throw new Error('MULTI_METRIC_COLUMNS_INVALID');
  }
  return columns;
}

export function resultMetricAnalysis(result: QueryResultView, metric: ResultMetric): unknown {
  const metrics = resultMetrics(result);
  if (!metrics.includes(metric)) throw new Error('RESULT_METRIC_NOT_AVAILABLE');
  if (metrics.length === 1) return result.analysis;
  const analysis = z.strictObject({ version: z.literal('multi-metric/1'),
    results: z.array(z.strictObject({ metric: metricSchema, analysis: z.unknown() })).min(2).max(3) }).parse(result.analysis);
  if (JSON.stringify(analysis.results.map(item => item.metric)) !== JSON.stringify(metrics)) throw new Error('MULTI_METRIC_ANALYSIS_INVALID');
  const selected = analysis.results.find(item => item.metric === metric)!.analysis;
  if (!selected || typeof selected !== 'object' || !('metric' in selected) || selected.metric !== metric) throw new Error('MULTI_METRIC_ANALYSIS_INVALID');
  return selected;
}

/** Pure projection of the saved wide table for a single metric renderer.
 * Callers must map column bindings back through resultMetricColumns before
 * presenting a chart; the result identity and complete source registry stay put. */
export function selectResultMetric(result: QueryResultView, metric: ResultMetric): QueryResultView {
  const columns = resultMetricColumns(result, metric);
  const parameters: Record<string, unknown> = { ...result.parameters, metric };
  delete parameters.metrics; delete parameters.metricColumns;
  return { ...result, parameters, analysis: resultMetricAnalysis(result, metric), table: { ...result.table,
    columns: Object.entries(columns).map(([key, mapped]) => {
      const column = result.table.columns.find(item => item.key === mapped)!;
      return { ...column, key, label: column.label.replace(`${metricLabels[metric]} · `, '') };
    }), rows: result.table.rows.map(row => ({ ...row, cells: Object.fromEntries(Object.entries(columns).map(([key, mapped]) => [key, row.cells[mapped]])) })),
  } };
}
