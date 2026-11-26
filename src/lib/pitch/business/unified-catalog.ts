import { z } from 'zod';
import { resolveBuildingCandidates } from '@/src/lib/intelligence/query/buildingIntent';
import { normalizeMapSubmarket, officeGrade } from '@/src/app/map/model/marketIdentity';
import { hasMapCoordinates } from '@/src/lib/map-coordinates';
import type { BuildingFacts } from '@/src/lib/intelligence/query/contracts';
import type { ResultCell } from '@/src/lib/intelligence/query/result';
import type { PitchContext } from '../data/store';
import type { PitchCandidate, UnifiedPitchRequest } from './unified-context-protocol';

const metadataRow = z.object({
  id: z.uuid(), city: z.string().nullable(), submarket: z.string().nullable(),
  former_names: z.unknown(), location_lng: z.number().nullable(), location_lat: z.number().nullable(),
});
export type Metadata = z.infer<typeof metadataRow>;

/** Use the catalog RPC to admit IDs before reading the same map metadata projection. */
export async function readPitchCatalogMetadata(ctx: PitchContext, rows: readonly BuildingFacts[]) {
  const ids = rows.map(row => row.id);
  const authorizedMarkets = new Map(rows.map(row => [row.id, row.dimensions?.submarket?.value ?? null]));
  const groups = Array.from({ length: Math.ceil(ids.length / 180) }, (_, i) => ids.slice(i * 180, (i + 1) * 180));
  const results = await Promise.all(groups.map(async group => {
    const { data, error } = await ctx.client.from('buildings').select('id,city,submarket,former_names,location_lng,location_lat')
      .in('id', group).eq('is_active', true).eq('tracking_scope', 'tracked').is('merged_into_id', null)
      .or('project_type.neq.future,project_type.is.null').abortSignal(ctx.signal);
    if (error) throw new Error('QUERY_READ_UNAVAILABLE');
    const returned = metadataRow.array().parse(data);
    if (returned.length !== group.length || returned.some(row => !group.includes(row.id) || authorizedMarkets.get(row.id) !== row.submarket)
      || new Set(returned.map(row => row.id)).size !== group.length) throw new Error('QUERY_SCOPE_CHANGED');
    return returned;
  }));
  ctx.signal.throwIfAborted();
  return new Map(results.flat().map(row => [row.id, row]));
}

export const aliases = (row: Metadata) => Array.isArray(row.former_names)
  ? [...new Set(row.former_names.filter((name): name is string => typeof name === 'string' && name.trim().length > 0))]
  : null;

export async function resolvePitchBuilding(ctx: PitchContext, name: string, rows: readonly BuildingFacts[], metadata: ReadonlyMap<string, Metadata>) {
  const [exact, project] = await Promise.all([
    ctx.client.from('lease_building_name_map').select('building_id').eq('market_code', 'BJ').eq('alias_name', name)
      .in('verification_status', ['AUTO_VERIFIED', 'MANUAL_VERIFIED']).limit(21).abortSignal(ctx.signal),
    ctx.client.from('lease_building_project_map').select('building_id').eq('market_code', 'BJ').eq('alias_name', name)
      .in('verification_status', ['AUTO_VERIFIED_PROJECT', 'MANUAL_VERIFIED_PROJECT']).limit(101).abortSignal(ctx.signal),
  ]);
  if (exact.error || project.error) throw new Error('QUERY_READ_UNAVAILABLE');
  if ((exact.data?.length ?? 0) > 20 || (project.data?.length ?? 0) > 100) {
    throw new Error('QUERY_SCOPE_REQUIRES_BACKGROUND_JOB');
  }
  return resolveBuildingCandidates(name, rows.map(row => ({ id: row.id, name: row.name,
    submarket: row.dimensions?.submarket?.value ?? null, aliases: aliases(metadata.get(row.id)!) ?? [] })),
  exact.data ?? [], project.data ?? []);
}

const value = (cells: Readonly<Record<string, ResultCell>> | undefined, key: string) => {
  const value = cells?.[key];
  return value?.kind === 'number' ? value.value.numeric : null;
};
const text = (fact: BuildingFacts, key: 'submarket' | 'grade') => fact.dimensions?.[key]?.value ?? null;
const byName = (a: BuildingFacts, b: BuildingFacts) => a.name.localeCompare(b.name, 'zh-CN') || a.id.localeCompare(b.id);

type Cells = ReadonlyMap<string, Readonly<Record<string, ResultCell>>>;

export function filterPitchCandidates(rows: readonly BuildingFacts[], cells: Cells, filters: UnifiedPitchRequest['filters']) {
  if (!filters) return [...rows];
  const match = (fact: number | null, range: { min?: number; max?: number } | undefined) =>
    !range || fact !== null && fact >= (range.min ?? 0) && fact <= (range.max ?? Infinity);
  return rows.filter(row => {
    const facts = cells.get(row.id);
    const grade = text(row, 'grade');
    return (!filters.grade || grade !== null && filters.grade === officeGrade(grade))
      && match(value(facts, 'totalArea'), filters.quarterArea)
      && match(value(facts, 'netEffectiveRent'), filters.rent)
      && match(value(facts, 'vacancy'), filters.vacancy);
  });
}

function distance(a: Metadata | undefined, b: Metadata | undefined) {
  const from = a ?? null, to = b ?? null;
  if (!hasMapCoordinates(from) || !hasMapCoordinates(to)) return null;
  const radians = (n: number) => n * Math.PI / 180;
  const latA = radians(from.location_lat), latB = radians(to.location_lat);
  const dLng = radians(to.location_lng - from.location_lng);
  const h = Math.sin((latB - latA) / 2) ** 2 + Math.cos(latA) * Math.cos(latB) * Math.sin(dLng / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.sqrt(Math.min(1, h)));
}

export function shortlistPitchPeers(target: BuildingFacts, rows: readonly BuildingFacts[], cells: Cells, metadata: ReadonlyMap<string, Metadata>) {
  const targetCells = cells.get(target.id);
  const targetGrade = officeGrade(text(target, 'grade'));
  const market = normalizeMapSubmarket(text(target, 'submarket'));
  if (!market) return [];
  return rows.filter(row => row.id !== target.id && normalizeMapSubmarket(text(row, 'submarket')) === market).map(row => {
    const distanceKm = distance(metadata.get(target.id), metadata.get(row.id));
    const missing: string[] = [], reasons = ['same_submarket'];
    const grade = officeGrade(text(row, 'grade'));
    if (targetGrade === 'other' || grade === 'other') missing.push('grade');
    else if (grade === targetGrade) reasons.push('same_grade_family');
    if (distanceKm === null) missing.push('coordinates');
    else if (distanceKm <= 2) reasons.push('within_2_km');
    for (const [field, tolerance, reason] of [['netEffectiveRent', 0.25, 'rent_within_25_percent'], ['totalArea', 0.5, 'area_within_50_percent']] as const) {
      const base = value(targetCells, field), comparison = value(cells.get(row.id), field);
      if (base === null || base <= 0 || comparison === null) missing.push(field);
      else if (Math.abs(comparison / base - 1) <= tolerance) reasons.push(reason);
    }
    return { fact: row, candidate: { buildingId: row.id, name: row.name, reasons, missing, distanceKm } satisfies PitchCandidate };
  }).sort((a, b) => {
    const sameGrade = Number(b.candidate.reasons.includes('same_grade_family')) - Number(a.candidate.reasons.includes('same_grade_family'));
    return sameGrade || b.candidate.reasons.length - a.candidate.reasons.length
      || (a.candidate.distanceKm ?? Infinity) - (b.candidate.distanceKm ?? Infinity) || byName(a.fact, b.fact);
  }).slice(0, 5);
}

export function comparableGradeA(rows: readonly BuildingFacts[], cells: Cells) {
  return rows.filter(row => officeGrade(text(row, 'grade')) === 'a'
    && value(cells.get(row.id), 'netEffectiveRent') !== null && value(cells.get(row.id), 'vacancy') !== null
    && value(cells.get(row.id), 'totalArea') !== null).sort(byName).slice(0, 5);
}
