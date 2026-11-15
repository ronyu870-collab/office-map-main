import type { aggregateQuarter, compareQuarters } from './analytics';
import type { SourceRef } from './contracts';
import { metricDimensionKeys, metricLabels, type ResultMetric } from './multiMetricView';
import type { QueryAnalysis, QueryResult, ResultCell, ResultTable } from './result';

export const MULTI_METRIC_LIMITS = Object.freeze({ metrics: 3, tableColumns: 30, resultBytes: 15 * 1024 * 1024 });
const bytes = (value: unknown) => new TextEncoder().encode(JSON.stringify(value)).byteLength;
function freeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
}
const countCell = (value: number, sourceIds: readonly string[]): ResultCell => ({ kind: 'number',
  value: { exact: { numerator: String(value), denominator: '1' }, numeric: value }, sourceIds });

/** Add only audit-visible sample diagnostics from existing exact analyses. */
function withSampleColumns(result: QueryResult, metric: ResultMetric): ResultTable {
  const original = result.table;
  if (result.operation === 'aggregate') {
    const a = result.analysis as ReturnType<typeof aggregateQuarter>, c = a.coverage;
    const ids = [...new Set([...a.contributions.flatMap(row => row.sourceIds), ...a.excluded.flatMap(row => row.sourceIds)])];
    return { ...original, columns: [...original.columns,
      { key: 'usedCount', label: '有效样本', unit: 'building_count' },
      { key: 'denominator', label: metric === 'totalArea' ? '样本分母' : '有效面积分母', unit: a.denominatorUnit },
      { key: 'coverage', label: '候选覆盖', unit: null }],
    rows: original.rows.map(row => ({ ...row, cells: { ...row.cells, usedCount: countCell(c.valid, ids),
      denominator: { kind: 'number', value: a.denominator, sourceIds: ids },
      coverage: { kind: 'text', value: `候选 ${c.total}；缺失 ${c.missing}、无效 ${c.invalid}、冲突 ${c.conflict}、未核验 ${c.unverified}`, sourceIds: ids } } })) };
  }
  if (result.operation === 'compare') {
    const a = result.analysis as ReturnType<typeof compareQuarters>;
    return { ...original, columns: [...original.columns,
      { key: 'baseUsedCount', label: '基期参与样本', unit: 'building_count' }, { key: 'currentUsedCount', label: '比较期参与样本', unit: 'building_count' },
      { key: 'baseDenominator', label: '基期分母', unit: metric === 'totalArea' ? 'building_count' : 'm2' },
      { key: 'currentDenominator', label: '比较期分母', unit: metric === 'totalArea' ? 'building_count' : 'm2' }],
    rows: original.rows.map(row => ({ ...row, cells: { ...row.cells,
      baseUsedCount: countCell(a.base.usedEntityIds.length, a.base.sourceIds), currentUsedCount: countCell(a.current.usedEntityIds.length, a.current.sourceIds),
      baseDenominator: { kind: 'number', value: a.base.denominator, sourceIds: a.base.sourceIds },
      currentDenominator: { kind: 'number', value: a.current.denominator, sourceIds: a.current.sourceIds } } })) };
  }
  return original;
}

/** Compose existing deterministic results from ONE authorized snapshot read.
 * The source registry is deduplicated; no query, formula or joint-sample
 * calculation is introduced here. Every metric keeps its own valid cohort. */
export function combineMetricResults(parts: readonly { metric: ResultMetric; result: QueryResult }[]): QueryResult {
  if (parts.length < 2 || parts.length > MULTI_METRIC_LIMITS.metrics || new Set(parts.map(part => part.metric)).size !== parts.length)
    throw new Error('INVALID_QUERY_METRICS');
  const first = parts[0].result, sources = new Map<string, SourceRef>(), columns: ResultTable['columns'][number][] = [];
  const rows = first.table.rows.map(row => ({ entityId: row.entityId, cells: {} as Record<string, ResultCell> }));
  const metricColumns: Partial<Record<ResultMetric, Record<string, string>>> = {};
  for (const [index, { metric, result }] of parts.entries()) {
    if (result.operation !== first.operation || result.dataVersion !== first.dataVersion || result.scopeFingerprint !== first.scopeFingerprint
      || result.snapshotId !== first.snapshotId || result.parameters.metric !== metric
      || JSON.stringify(result.parameters.scope) !== JSON.stringify(first.parameters.scope)
      || ['period', 'base', 'current', 'start', 'end', 'mode', 'groupBy', 'rowGroups', 'columnGroups', 'tableVersion', 'dimensionVersion', 'groups']
        .some(key => JSON.stringify(result.parameters[key]) !== JSON.stringify(first.parameters[key]))
      || JSON.stringify(result.table.rows.map(row => row.entityId)) !== JSON.stringify(first.table.rows.map(row => row.entityId)))
      throw new Error('MULTI_METRIC_SNAPSHOT_MISMATCH');
    const table = withSampleColumns(result, metric), mapping: Record<string, string> = {};
    for (const column of table.columns) {
      const shared = metricDimensionKeys.has(column.key), key = shared || index === 0 ? column.key : `${metric}_${column.key}`;
      mapping[column.key] = key;
      if (!shared || index === 0) columns.push({ ...column, key, label: shared ? column.label : `${metricLabels[metric]} · ${column.label}` });
      for (const [rowIndex, row] of table.rows.entries()) {
        const prior = rows[rowIndex].cells[key], cell = row.cells[column.key];
        if (!cell || prior && JSON.stringify(prior) !== JSON.stringify(cell)) throw new Error('MULTI_METRIC_AXIS_MISMATCH');
        rows[rowIndex].cells[key] = cell;
      }
    }
    metricColumns[metric] = mapping;
    for (const source of result.sources) {
      const prior = sources.get(source.id);
      if (prior && JSON.stringify(prior) !== JSON.stringify(source)) throw new Error('SOURCE_ID_COLLISION');
      sources.set(source.id, source);
    }
  }
  if (columns.length > MULTI_METRIC_LIMITS.tableColumns) throw new Error('QUERY_SCOPE_REQUIRES_BACKGROUND_JOB');
  const result: QueryResult = { ...first,
    parameters: { ...first.parameters, metrics: parts.map(part => part.metric), metricColumns },
    analysis: { version: 'multi-metric/1', results: parts.map(part => ({ metric: part.metric, analysis: part.result.analysis as QueryAnalysis })) },
    table: { ...first.table, columns, rows }, sources: [...sources.values()].sort((a, b) => a.id.localeCompare(b.id)),
    limitations: [...new Set(parts.flatMap(part => part.result.limitations)),
      '各指标独立使用本指标的有效样本与分母，不代表跨指标共同有效样本；共同样本模式仅在每个指标内部跨季度取交集。',
      '所有指标来自同一次获权数据库快照；每项缺失、无效、冲突和未核验分别保留，不因另一指标有效而补值。'],
  };
  if (bytes(result) > MULTI_METRIC_LIMITS.resultBytes) throw new Error('QUERY_SCOPE_REQUIRES_BACKGROUND_JOB');
  return freeze(result);
}

/** Reserve space for audit and interpretation metadata before archive writes. */
export function assertMultiMetricResultSize(result: QueryResult): QueryResult {
  if (Array.isArray(result.parameters.metrics) && bytes(result) > MULTI_METRIC_LIMITS.resultBytes) throw new Error('QUERY_SCOPE_REQUIRES_BACKGROUND_JOB');
  return result;
}
