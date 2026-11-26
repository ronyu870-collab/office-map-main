import { cellText, units, type QueryResultView } from '@/src/lib/intelligence/query/presentation';
import type { PitchDataSnapshot } from '../business/adapter';
import type { BusinessDataBinding, VisualAssetReference } from '../integration-contracts';
import type { BoundBuilding, Evidence, Field, LocationReference, Period, Photo } from './projection';
import { periodOrder } from './page-content';

export function proposalDataBinding(snapshot: PitchDataSnapshot): BusinessDataBinding {
  return { ...snapshot.binding, dataAsOf: snapshot.dataAsOf, dataVersion: snapshot.dataVersion };
}

/** Project a previously authorized exact-quarter result, keeping its result locator for audit and refresh. */
function resultRecord<T>(value: T, snapshot: PitchDataSnapshot, result: QueryResultView): Evidence<T> {
  return { value, disclosure: 'internal', data: [proposalDataBinding(snapshot)], sources: [{
    id: result.resultId,
    kind: 'record',
    label: '正式季度库',
    recordId: result.resultId,
    locator: `Pitch 季度查询结果 ${result.resultId}`,
    version: result.dataVersion,
    dataAsOf: snapshot.dataAsOf,
  }] };
}

/** Use the business adapter’s official per-building vacancy calculation when supplied.
 * An absent row, column, type or unit leaves the value unknown. */
export function projectQuarterBuildings(profile: PitchDataSnapshot, period: Period, vacancy?: PitchDataSnapshot): BoundBuilding[] {
  const profileIsSuitable = profile.binding.domain === 'quarter' && ['building-profile', 'project-comparison'].includes(profile.parameters.templateId);
  if (!profileIsSuitable || periodOrder(profile.parameters.period) !== periodOrder(period)) return [];
  const result = profile.results.find(item => item.operation === 'list');
  if (!result) return [];
  const vacancyResult = vacancy?.binding.domain === 'quarter' && vacancy.parameters.templateId === 'vacancy-comparison'
    && periodOrder(vacancy.parameters.period) === periodOrder(period)
    ? vacancy.results.find(item => item.operation === 'list') : undefined;
  const numeric = (record: QueryResultView, row: QueryResultView['table']['rows'][number], key: string, unit: string) => {
    const cell = row.cells[key];
    return cell?.kind === 'number' && record.table.columns.find(column => column.key === key)?.unit === unit ? cell.value.numeric : null;
  };
  const exact = (record: QueryResultView, id: string) => record.sources.some(source => source.entityId === id && source.period
    && periodOrder(source.period) === periodOrder(period));
  const selected = new Set(profile.parameters.buildingIds);
  return result.table.rows.flatMap(row => {
    const name = row.cells.name;
    if (!selected.has(row.entityId) || name?.kind !== 'text' || !exact(result, row.entityId)) return [];
    const identity = resultRecord({ name: name.value }, profile, result);
    const matched = vacancyResult?.table.rows.find(candidate => candidate.entityId === row.entityId);
    const other = matched && vacancyResult && exact(vacancyResult, row.entityId) && vacancy ? resultRecord(
      numeric(vacancyResult, matched, 'vacancyRatio', 'ratio'), vacancy, vacancyResult,
    ) : undefined;
    const quarter = resultRecord({ period, netEffectiveRent: numeric(result, row, 'netEffectiveRent', 'CNY/m2/month'),
      trackedArea: numeric(result, row, 'totalArea', 'm2'), vacancyRate: other?.value ?? null }, profile, result);
    const technical: Field[] = result.table.columns.flatMap(column => {
      const cell = row.cells[column.key];
      if (!['height', 'floors', 'parking'].includes(column.key) || !cell || cell.kind === 'unknown') return [];
      return [{ label: column.label, value: cellText(cell, column.unit), unit: units[column.unit ?? ''] ?? column.unit ?? undefined }];
    });
    return [{ id: row.entityId, name: name.value, identity, technical: technical.length ? resultRecord(technical, profile, result) : undefined,
      quarter: { ...quarter, sources: [...quarter.sources, ...(other?.sources ?? [])], data: [...(quarter.data ?? []), ...(other?.data ?? [])] } }];
  });
}

/** Resolve bytes separately with the original media provider. These helpers only translate pinned references. */
export function proposalPhoto(visual: VisualAssetReference, kind: Photo['kind'], alt: string): Evidence<Photo> {
  if (visual.kind !== 'photo') throw new Error('PITCH_PROPOSAL_VISUAL_KIND');
  return { visual, disclosure: visual.disclosure, sources: [visual.source],
    value: { kind, block: { kind: 'image', mediaAssetId: visual.id, mediaVersion: visual.version, alt } } };
}

export function proposalMapImage(visual: VisualAssetReference, alt: string): LocationReference {
  if (visual.kind !== 'map') throw new Error('PITCH_PROPOSAL_VISUAL_KIND');
  return { visual, disclosure: visual.disclosure, sources: [visual.source], value: { kind: 'image', mediaAssetId: visual.id, mediaVersion: visual.version, alt } };
}

export function proposalStackingImage(visual: VisualAssetReference, alt: string, businessDate: string | null): NonNullable<BoundBuilding['stackingPlan']> {
  if (visual.kind !== 'stacking-plan') throw new Error('PITCH_PROPOSAL_VISUAL_KIND');
  return { visual, disclosure: visual.disclosure, sources: [visual.source], value: {
    businessDate, sources: [visual.source],
    blocks: [{ kind: 'image', mediaAssetId: visual.id, mediaVersion: visual.version, alt, sourceIds: [visual.source.id] }],
  } };
}
