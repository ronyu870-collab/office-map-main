import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';
import { aggregateQuarter, compareQuarters, rankBuildings } from './analytics';
import { assertComplete, quarterKey, type FactSnapshot, type NumericOutput, type SourceRef } from './contracts';
import { assertFieldContext, getFact } from './facts';
import { FIELD_REGISTRY_VERSION, numericFields, type NumericField } from './registry';

const BROCHURE_LIMITATION = '楼书记录尚未确定有效版本优先级；不同值按冲突处理，相同值也不能据此确认当前现实状态。';

export type ResultCell =
  | { kind: 'text'; value: string; sourceIds: readonly string[] }
  | { kind: 'number'; value: NumericOutput; sourceIds: readonly string[] }
  | { kind: 'unknown'; state: 'missing' | 'invalid' | 'conflict' | 'unverified'; reason: string; sourceIds: readonly string[] };
export type ResultTable = {
  id: string;
  columns: readonly { key: string; label: string; unit: string | null }[];
  rows: readonly { entityId: string; cells: Readonly<Record<string, ResultCell>> }[];
};
export type QueryResult = Readonly<{
  resultId: string;
  createdAt: string;
  snapshotId: string;
  dataVersion: string;
  scopeFingerprint: string;
  registryVersion: string;
  operation: 'list' | 'rank' | 'aggregate' | 'compare';
  parameters: Readonly<Record<string, unknown>>;
  table: ResultTable;
  analysis: ReturnType<typeof rankBuildings> | ReturnType<typeof aggregateQuarter> | ReturnType<typeof compareQuarters> | null;
  sources: readonly SourceRef[];
  limitations: readonly string[];
}>;

function deepFreeze<T>(value: T): T {
  if (typeof value === 'object' && value !== null) {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

function collectSources(snapshot: FactSnapshot, fields: readonly NumericField[]): SourceRef[] {
  const sources = new Map<string, SourceRef>();
  const add = (source: SourceRef) => {
    const prior = sources.get(source.id);
    if (prior && JSON.stringify(prior) !== JSON.stringify(source)) throw new Error('SOURCE_ID_COLLISION');
    sources.set(source.id, structuredClone(source));
  };
  for (const row of snapshot.rows) add(row.nameSource);
  for (const row of snapshot.rows) for (const field of fields) for (const source of getFact(row, field).sources) {
    if (source.entityId !== row.id) throw new Error('SOURCE_BINDING_MISMATCH');
    add(source);
  }
  return [...sources.values()].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}

function envelope(snapshot: FactSnapshot, content: Pick<QueryResult, 'operation' | 'parameters' | 'table' | 'analysis'>, fields: readonly NumericField[]): QueryResult {
  const sources = collectSources(snapshot, fields);
  return deepFreeze({
    resultId: randomUUID(), createdAt: new Date().toISOString(), snapshotId: snapshot.snapshotId,
    dataVersion: snapshot.dataVersion, scopeFingerprint: snapshot.scopeFingerprint,
    registryVersion: FIELD_REGISTRY_VERSION, ...content, parameters: { ...content.parameters, scope: structuredClone(snapshot.queryScope ?? {}) }, sources,
    limitations: [
      '仅反映当前获权数据库样本，不代表现实市场全集。',
      ...(snapshot.queryScope?.inventoryTime === 'current_catalog' ? ['候选楼宇按当前目录确定；历史季度指标不代表当时的历史楼宇全集。'] : []),
      ...(snapshot.queryScope?.brochureSelection === 'all_unresolved_record_candidates' && fields.some(field => numericFields[field].temporal === 'source')
        ? [BROCHURE_LIMITATION] : []),
      ...(sources.some(source => source.verification === 'database_only') ? ['部分数据仅关联数据库记录，原始资料尚未关联。'] : []),
      ...(sources.some(source => source.verification === 'historical') ? ['包含历史来源，不能据此确认当前有效性。'] : []),
    ],
  });
}

export function buildListResult(snapshot: FactSnapshot, fields: readonly NumericField[]): QueryResult {
  assertComplete(snapshot);
  if (fields.length > 6 || new Set(fields).size !== fields.length || fields.some(field => !Object.hasOwn(numericFields, field))) throw new Error('INVALID_QUERY_FIELDS');
  assertFieldContext(snapshot, fields);
  return envelope(snapshot, {
    operation: 'list', parameters: { fields: [...fields], period: snapshot.period }, analysis: null,
    table: {
      id: 'buildings', columns: [{ key: 'name', label: '楼宇', unit: null }, ...fields.map(field => ({ key: field, label: numericFields[field].label, unit: numericFields[field].unit }))],
      rows: snapshot.rows.map(row => {
        const cells: Record<string, ResultCell> = { name: { kind: 'text', value: row.name, sourceIds: [row.nameSource.id] } };
        for (const field of fields) {
          const fact = getFact(row, field);
          const sourceIds = fact.sources.map(source => source.id);
          cells[field] = fact.state === 'valid'
            ? { kind: 'number', value: { exact: fact.value.exact(), numeric: fact.value.toNumber() }, sourceIds }
            : { kind: 'unknown', state: fact.state, reason: fact.reason, sourceIds };
        }
        return { entityId: row.id, cells };
      }),
    },
  }, fields);
}

export function buildRankResult(snapshot: FactSnapshot, field: NumericField, limit: number, direction: 'asc' | 'desc'): QueryResult {
  const analysis = rankBuildings(snapshot, field, limit, direction);
  return envelope(snapshot, {
    operation: 'rank', parameters: { field, limit, direction, period: snapshot.period }, analysis,
    table: {
      id: 'ranking', columns: [{ key: 'name', label: '楼宇', unit: null }, { key: field, label: numericFields[field].label, unit: numericFields[field].unit }],
      rows: analysis.rows.map(row => ({ entityId: row.entityId, cells: {
        name: { kind: 'text', value: row.name, sourceIds: [snapshot.rows.find(entity => entity.id === row.entityId)!.nameSource.id] }, [field]: { kind: 'number', value: row.value, sourceIds: row.sourceIds },
      } })),
    },
  }, [field]);
}

export function buildAggregateResult(snapshot: FactSnapshot, metric: Parameters<typeof aggregateQuarter>[1]): QueryResult {
  const analysis = aggregateQuarter(snapshot, metric);
  const fields: NumericField[] = metric === 'rent' ? ['totalArea', 'netEffectiveRent'] : metric === 'vacancy' ? ['totalArea', 'vacantArea'] : ['totalArea'];
  return envelope(snapshot, {
    operation: 'aggregate', parameters: { metric, period: snapshot.period }, analysis,
    table: {
      id: 'aggregate', columns: [{ key: 'value', label: metric === 'rent' ? '面积加权净有效租金' : metric === 'vacancy' ? '空置率' : '总面积', unit: analysis.unit }],
      rows: [{ entityId: 'aggregate', cells: { value: analysis.value
        ? { kind: 'number', value: analysis.value, sourceIds: analysis.contributions.flatMap(row => row.sourceIds) }
        : { kind: 'unknown', state: 'missing', reason: 'no_valid_sample', sourceIds: [] } } }],
    },
  }, fields);
}

function mergeSources(groups: readonly (readonly SourceRef[])[]): SourceRef[] {
  const sources = new Map<string, SourceRef>();
  for (const group of groups) for (const source of group) {
    const previous = sources.get(source.id);
    if (previous && JSON.stringify(previous) !== JSON.stringify(source)) throw new Error('SOURCE_ID_COLLISION');
    sources.set(source.id, structuredClone(source));
  }
  return [...sources.values()].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}

export function buildCompareResult(base: FactSnapshot, current: FactSnapshot, metric: Parameters<typeof compareQuarters>[2], mode: 'per_period' | 'paired'): QueryResult {
  if (base.dataVersion !== current.dataVersion) throw new Error('SNAPSHOT_VERSION_MISMATCH');
  const analysis = compareQuarters(base, current, metric, mode);
  const fields: NumericField[] = metric === 'rent' ? ['totalArea', 'netEffectiveRent'] : metric === 'vacancy' ? ['totalArea', 'vacantArea'] : ['totalArea'];
  const unit = metric === 'rent' ? 'CNY/m2/month' : metric === 'vacancy' ? 'ratio' : 'm2';
  const allUsed = [...new Set([...analysis.base.sourceIds, ...analysis.current.sourceIds])].sort();
  const cell = (value: NumericOutput | null, sourceIds: readonly string[], reason = 'no_valid_sample'): ResultCell => value
    ? { kind: 'number', value, sourceIds }
    : { kind: 'unknown', state: 'missing', reason, sourceIds };
  const result = envelope(current, {
    operation: 'compare', parameters: { tableVersion: 'comparison-table/2', metric, mode, base: base.period, current: current.period, baseSnapshotId: base.snapshotId, currentSnapshotId: current.snapshotId }, analysis,
    table: {
      id: 'comparison', columns: [
        { key: 'base', label: quarterKey(base.period!), unit }, { key: 'current', label: quarterKey(current.period!), unit },
        { key: 'difference', label: '数值差', unit: metric === 'vacancy' ? 'percentage_point' : unit }, { key: 'change', label: '变化', unit: analysis.changeUnit },
      ],
      rows: [{ entityId: 'aggregate', cells: {
        base: cell(analysis.base.value, analysis.base.sourceIds), current: cell(analysis.current.value, analysis.current.sourceIds),
        difference: cell(metric === 'vacancy' ? analysis.change : analysis.difference, allUsed), change: cell(analysis.change, allUsed, analysis.unavailableReason ?? 'no_valid_sample'),
      } }],
    },
  }, fields);
  return deepFreeze({ ...result, sources: mergeSources([collectSources(base, fields), result.sources]) });
}

/** Trusted executor adds the complete authorized filter decision trail, including
 * unknown candidates, without allowing a second query to change result values. */
export function attachFilterEvidence(result: QueryResult, evidence: readonly { snapshot: FactSnapshot; fields: readonly NumericField[]; decisions: readonly { entityId: string; state: 'true' | 'false' | 'unknown' }[] }[]): QueryResult {
  for (const item of evidence) {
    assertComplete(item.snapshot);
    assertFieldContext(item.snapshot, item.fields);
    if (item.snapshot.dataVersion !== result.dataVersion || item.snapshot.scopeFingerprint !== result.scopeFingerprint) throw new Error('FILTER_SNAPSHOT_MISMATCH');
    const ids = new Set(item.snapshot.rows.map(row => row.id));
    if (item.decisions.length !== ids.size || new Set(item.decisions.map(row => row.entityId)).size !== ids.size
      || item.decisions.some(row => !ids.has(row.entityId) || !['true', 'false', 'unknown'].includes(row.state))) throw new Error('FILTER_DECISION_INCOMPLETE');
  }
  return deepFreeze({ ...result,
    parameters: { ...result.parameters, filterEvaluation: evidence.map(item => ({
      snapshotId: item.snapshot.snapshotId, period: item.snapshot.period, fields: [...item.fields],
      total: item.snapshot.expectedCount, matched: item.decisions.filter(row => row.state === 'true').length,
      notMatched: item.decisions.filter(row => row.state === 'false').length, unknown: item.decisions.filter(row => row.state === 'unknown').length,
      decisions: structuredClone(item.decisions),
    })) },
    sources: mergeSources([result.sources, ...evidence.map(item => collectSources(item.snapshot, item.fields))]),
    limitations: [...new Set([
      ...result.limitations,
      ...(evidence.some(item => item.snapshot.queryScope?.brochureSelection === 'all_unresolved_record_candidates'
        && item.fields.some(field => numericFields[field].temporal === 'source')) ? [BROCHURE_LIMITATION] : []),
      '筛选缺值或冲突单列为未知，仅明确满足条件的楼宇参与结果；跨期筛选逐期执行，再按比较模式取样。',
    ])],
  });
}

/** Integrity digest is a comparison aid, not an authorization token or tamper-proof audit seal. */
export function resultDigest(result: QueryResult): string {
  return createHash('sha256').update(JSON.stringify(result)).digest('hex');
}

export type ChartBinding = { resultId: string; tableId: string; kind: 'bar' | 'line' | 'scatter'; x: string; y: string };

/** No chart-supplied numbers. Every mark references a table cell in this result. */
export function bindChart(result: QueryResult, binding: ChartBinding) {
  binding = z.strictObject({ resultId: z.uuid(), tableId: z.string(), kind: z.enum(['bar', 'line', 'scatter']), x: z.string(), y: z.string() }).parse(binding);
  if (binding.resultId !== result.resultId || binding.tableId !== result.table.id) throw new Error('RESULT_BINDING_MISMATCH');
  if (!['bar', 'line', 'scatter'].includes(binding.kind)) throw new Error('UNSUPPORTED_CHART');
  const xColumn = result.table.columns.find(column => column.key === binding.x);
  const yColumn = result.table.columns.find(column => column.key === binding.y);
  if (!xColumn || !yColumn) throw new Error('UNKNOWN_CHART_COLUMN');
  if (binding.kind === 'line') throw new Error('TIME_AXIS_REQUIRED'); // Enabled with the trend result adapter, not categorical building rows.
  return deepFreeze({
    ...binding, xUnit: xColumn.unit, yUnit: yColumn.unit, connectNulls: false,
    points: result.table.rows.map(row => {
      const x = row.cells[binding.x], y = row.cells[binding.y];
      if (y.kind === 'text' || (binding.kind === 'scatter' && x.kind === 'text')) throw new Error('NUMERIC_AXIS_REQUIRED');
      return {
        entityId: row.entityId,
        x: x.kind === 'unknown' ? null : x.kind === 'number' ? x.value.numeric : x.value,
        y: y.kind === 'number' ? y.value.numeric : null,
        state: y.kind === 'unknown' ? y.state : x.kind === 'unknown' ? x.state : 'valid',
        cells: { x: binding.x, y: binding.y },
      };
    }),
    limitations: result.limitations,
  });
}
