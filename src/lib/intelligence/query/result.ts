import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';
import { aggregateQuarter, rankBuildings } from './analytics';
import { assertComplete, type FactSnapshot, type NumericOutput, type SourceRef } from './contracts';
import { assertFieldContext, getFact } from './facts';
import { FIELD_REGISTRY_VERSION, numericFields, type NumericField } from './registry';

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
  operation: 'list' | 'rank' | 'aggregate';
  parameters: Readonly<Record<string, unknown>>;
  table: ResultTable;
  analysis: ReturnType<typeof rankBuildings> | ReturnType<typeof aggregateQuarter> | null;
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
    registryVersion: FIELD_REGISTRY_VERSION, ...content, sources,
    limitations: [
      '仅反映当前获权数据库样本，不代表现实市场全集。',
      ...(sources.some(source => source.verification === 'database_only') ? ['部分数据仅关联数据库记录，原始资料尚未关联。'] : []),
      ...(sources.some(source => source.verification === 'historical') ? ['包含历史来源，不能据此确认当前有效性。'] : []),
    ],
  });
}

export function buildListResult(snapshot: FactSnapshot, fields: readonly NumericField[]): QueryResult {
  assertComplete(snapshot);
  if (!fields.length || fields.length > 6 || new Set(fields).size !== fields.length || fields.some(field => !Object.hasOwn(numericFields, field))) throw new Error('INVALID_QUERY_FIELDS');
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
