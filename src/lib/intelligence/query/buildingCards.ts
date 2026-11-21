import { z } from 'zod';
import type { QueryResultView } from './presentation';

export type QueryBuildingRow = { id: string; name: string; cells: QueryResultView['table']['rows'][number]['cells'] };
/** Only a source-bound building identity is actionable. Group and period row keys are not buildings. */
export function resultBuildingRows(result: QueryResultView): QueryBuildingRow[] {
  const names = new Map(result.sources.filter(source => source.table === 'buildings' && source.field === 'name'
    && source.entityId === source.recordId && z.uuid().safeParse(source.entityId).success && typeof source.rawValue === 'string')
    .map(source => [source.id, source]));
  const rows = result.table.rows.flatMap(row => {
    const name = row.cells.name;
    if (!name || name.kind !== 'text' || !z.uuid().safeParse(row.entityId).success
      || !name.sourceIds.some(id => names.get(id)?.entityId === row.entityId && names.get(id)?.rawValue === name.value)) return [];
    return [{ id: row.entityId, name: name.value, cells: row.cells }];
  });
  if(result.parameters.dataDomain==='business-research/1' && result.parameters.businessTool==='query_stacking_plan') {
    const bound = new Map(result.sources.filter(s => s.table === 'buildings' && s.field === 'building'
      && s.recordId === s.entityId && z.uuid().safeParse(s.entityId).success && typeof s.rawValue === 'string').map(s => [s.id, s]));
    const buildings = result.table.rows.flatMap(row => {
      const cell = row.cells.building;
      if (cell?.kind !== 'text') return [];
      const source = cell.sourceIds.map(id => bound.get(id)).find(s => s?.rawValue === cell.value);
      return source ? [{ id: source.entityId, name: cell.value, cells: {} }] : [];
    });
    return [...new Map(buildings.map(building => [building.id, building])).values()];
  }
  if (rows.length) return [...new Map(rows.map(row => [row.id, row])).values()];
  const scope = z.object({ scope: z.object({ buildingIds: z.array(z.uuid()).max(20) }) }).safeParse(result.parameters.executedPlan);
  if (!scope.success) return [];
  return scope.data.scope.buildingIds.flatMap(id => {
    const name = [...names.values()].find(source => source.entityId === id);
    return name ? [{ id, name: name.rawValue as string, cells: {} }] : [];
  });
}
export const buildingContextSchema = z.object({
  status: z.literal('ready'), requestId: z.uuid(), resultId: z.uuid(), metadataReadAt: z.iso.datetime(), total: z.number().int().nonnegative(),
  offset: z.number().int().nonnegative(), hasMore: z.boolean(),
  photoAccess: z.object({ url: z.string().url(), source_url: z.string().url(), source_name: z.string(), can_download: z.boolean(), is_preview: z.boolean(), attribution_text: z.string().nullable().optional(), license_url: z.string().nullable().optional() }).optional(),
  buildings: z.array(z.object({ id: z.uuid(), name: z.string(), submarket: z.string().nullable(), grade: z.string().nullable(),
    located: z.boolean(), unavailableReason: z.enum(['not_in_current_map', 'missing_coordinates']).nullable(),
    photo: z.object({ id: z.uuid(), caption: z.string(), sha256: z.string().regex(/^[a-f0-9]{64}$/).optional() }).nullable(),
  })).max(500),
});
export type BuildingContext = z.infer<typeof buildingContextSchema>;
export const mapResultSelectionSchema=z.strictObject({version:z.literal('map-selection/1'),buildingIds:z.array(z.uuid()).min(1).max(500),intent:z.enum(['focus','select','only'])});
export const buildingContextInputSchema = z.strictObject({ requestId: z.uuid(), action: z.literal('buildings'),
  mapSelection:z.boolean().optional(), resultId: z.uuid().optional(), buildingId: z.uuid().optional(), photoId: z.uuid().optional(), offset: z.number().int().min(0).max(20000).default(0), limit: z.number().int().min(1).max(500).default(20) });
