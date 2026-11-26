import { createHash } from 'node:crypto';
import type { BuildingFacts, Quarter, SourceRef } from '@/src/lib/intelligence/query/contracts';
import type { QueryResult, ResultCell } from '@/src/lib/intelligence/query/result';
import type { PitchValue } from './unified-context-protocol';

export const evidenceHash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
export const resultDataVersion = (result: QueryResult) => evidenceHash([
  result.registryVersion, result.table, [...result.sources].sort((a, b) => a.id.localeCompare(b.id)),
]);

export function quarterEnd(period: Quarter): string {
  return new Date(Date.UTC(period.year, period.quarter * 3, 0)).toISOString().slice(0, 10);
}

export function missingValue(entityId: string, fieldId: string, unit: string | null, period: Quarter | null,
  state: 'unauthorized' | 'not_reported' | 'unknown', reason: string): PitchValue {
  const withheld = state === 'unauthorized';
  return { entityId, fieldId, unit, period, state, reason, value: null, sources: [], dataVersion: null,
    businessAsOf: period ? quarterEnd(period) : null, permission: withheld ? 'denied' : 'authorized',
    disclosure: withheld ? 'withheld' : 'internal' };
}

export function projectValue(entityId: string, fieldId: string, cell: ResultCell | undefined, unit: string | null,
  period: Quarter | null, index: ReadonlyMap<string, SourceRef>): PitchValue {
  if (!cell) return missingValue(entityId, fieldId, unit, period, 'unknown', 'source_unavailable');
  const sources = cell.sourceIds.map(id => {
    const source = index.get(id);
    if (!source) throw new Error('SOURCE_BINDING_MISMATCH');
    return source;
  });
  const dates = [...new Set(sources.flatMap(source => source.businessAsOf ? [source.businessAsOf] : []))];
  const explicitUnknown = cell.kind === 'text' && /^(?:未知|unknown)$/i.test(cell.value.trim());
  const state = explicitUnknown ? 'unknown' : cell.kind === 'unknown'
    ? cell.state === 'missing' ? /no_record|missing_record|not_recorded|business_field_missing/.test(cell.reason) ? 'not_reported' : 'unknown' : cell.state
    : 'valid';
  return { entityId, fieldId, unit, period, state, sources, dataVersion: sources.length ? evidenceHash(sources.map(s => s.id).sort()) : null,
    businessAsOf: period ? quarterEnd(period) : dates.length === 1 ? dates[0] : null, permission: 'authorized', disclosure: 'internal',
    value: cell.kind === 'number' ? cell.value.numeric : cell.kind === 'text' && !explicitUnknown ? cell.value : null,
    ...(cell.kind === 'number' ? { exact: cell.value.exact } : {}), reason: cell.kind === 'unknown' ? cell.reason : explicitUnknown ? 'source_marks_unknown' : null };
}

export function catalogValue(row: BuildingFacts, fieldId: string, column: string,
  value: PitchValue['value'], unit: string | null): PitchValue {
  const version = evidenceHash([row.nameSource.recordVersion, column, value]);
  const source: SourceRef = { ...row.nameSource, id: 'buildings/' + row.id + '/' + column + '/' + version,
    recordVersion: version, field: column, rawValue: value, unit: unit ?? 'text' };
  return { entityId: row.id, fieldId, value, unit, sources: [source], dataVersion: version,
    period: null, businessAsOf: null, permission: 'authorized', disclosure: 'internal',
    state: value === null ? 'unknown' : 'valid', reason: value === null ? 'catalog_field_missing' : null };
}

export function buildingAge(completionYear: PitchValue, period: Quarter | null): PitchValue {
  const year = typeof completionYear.value === 'string' && /^\d{4}$/.test(completionYear.value.trim()) ? Number(completionYear.value) : null;
  if (completionYear.permission === 'denied') return missingValue(completionYear.entityId, 'buildingAge', 'year', period, 'unauthorized', 'completion_year_not_authorized');
  if (!period || !year || year > period.year) return {
    ...missingValue(completionYear.entityId, 'buildingAge', 'year', period, 'unknown', 'completed_calendar_year_required'),
    sources: completionYear.sources, dataVersion: completionYear.dataVersion,
  };
  return { ...completionYear, fieldId: 'buildingAge', value: period.year - year, unit: 'year', period,
    businessAsOf: quarterEnd(period), dataVersion: evidenceHash(['calendar-year-age/1', completionYear.dataVersion, period]) };
}
