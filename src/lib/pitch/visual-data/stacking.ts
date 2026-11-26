import { z } from 'zod';
import { areaNumber, OCCUPANCY_LABELS, selectFloorRows, unitLayout } from '@/src/components/stacking-plan/stackingPlanModel';
import { createStackingPresentationSvg, stackingPresentationSize, type PresentationInput } from '@/src/components/stacking-plan/stackingPlanPresentation';
import { sceneFont } from '../layout/metrics';
import { svgText } from './svg-text';

const reference = z.string().min(1).max(100);
const area = z.union([z.number(), z.string()]).nullable();
const source = z.object({
  id: reference, building_id: z.uuid(), title: z.string(), source_as_of: z.iso.date().nullable(),
  as_of_kind: z.string(), review_state: z.string(),
});
const floor = z.object({
  id: z.uuid(), tower_id: z.uuid(), floor_code: z.string(), level_order: z.number().int(),
  floor_area_sqm: area, zone: z.string().nullable(), use_type: z.string(), source_id: reference,
});
const space = z.object({
  id: z.uuid(), floor_id: z.uuid(), unit_code: z.string(),
  occupancy_status: z.enum(['occupied', 'vacant', 'other', 'unknown']), tenant_name: z.string().nullable(),
  area_sqm: area, verification_status: z.string(), source_id: reference, revision: z.number().int().min(1),
});
const snapshotSchema = z.object({
  towers: z.array(z.object({ id: z.uuid(), building_id: z.uuid(), code: z.string(), display_name: z.string() })),
  floors: z.array(floor).max(199), spaces: z.array(space).max(999), sources: z.array(source),
});
export const stackingSelectionSchema = z.strictObject({
  towerIds: z.array(z.uuid()).min(1).max(2).optional(),
  levelRange: z.tuple([z.number().int().min(-200).max(300), z.number().int().min(-200).max(300)]).optional(),
}).refine(s => (!s.levelRange || s.levelRange[0] <= s.levelRange[1])
  && (!s.towerIds || s.towerIds.length === new Set(s.towerIds).size));
export type StackingSelection = z.infer<typeof stackingSelectionSchema>;

/** Native geometry weights come from the existing workbench model. Historical status remains source-qualified. */
export function createStackingVisual(building: { id: string; name: string }, input: unknown, selection: StackingSelection) {
  const snapshot = snapshotSchema.parse(input);
  const requested = stackingSelectionSchema.parse(selection);
  if (snapshot.towers.some(tower => tower.building_id !== building.id)
      || snapshot.sources.some(item => item.building_id !== building.id)) throw new Error('PITCH_STACKING_SCOPE');
  const towers = snapshot.towers.filter(tower => !requested.towerIds || requested.towerIds.includes(tower.id))
    .sort((a, b) => a.code.localeCompare(b.code, 'en') || a.id.localeCompare(b.id, 'en'));
  if (requested.towerIds && requested.towerIds.some(id => !towers.some(tower => tower.id === id))
      || towers.length > 2) throw new Error('PITCH_STACKING_SELECTION');
  const towerIds = new Set(towers.map(tower => tower.id));
  const selectedFloors = snapshot.floors.filter(item => towerIds.has(item.tower_id) &&
    (!requested.levelRange || item.level_order >= requested.levelRange[0] && item.level_order <= requested.levelRange[1]));
  if (!selectedFloors.length) return null;
  const sourceById = new Map(snapshot.sources.map(item => [item.id, item]));
  const isApprovedDate = (id: string) => {
    const item = sourceById.get(id);
    return !!item && ['date_confirmed', 'verified'].includes(item.review_state)
      && item.as_of_kind === 'source_data_as_of' && item.source_as_of !== null;
  };
  const floorIds = new Set(selectedFloors.map(item => item.id));
  const selectedSpaces = snapshot.spaces.filter(item => floorIds.has(item.floor_id)).map(item => {
    // A date confirmation never verifies an individual tenant or unit. Preserve the
    // raw observation and project an undated/rejected vacant marking as unknown.
    const occupancy_status = item.occupancy_status === 'vacant' && !isApprovedDate(item.source_id)
      ? 'unknown' as const : item.occupancy_status;
    return { ...item, occupancy_status, source_status: item.occupancy_status };
  }).sort((a, b) => a.unit_code.localeCompare(b.unit_code, 'en', { numeric: true }) || a.id.localeCompare(b.id, 'en'));
  const sourceIds = [...new Set([...selectedFloors, ...selectedSpaces].map(item => item.source_id))].sort();
  const sources = sourceIds.map(id => {
    const item = sourceById.get(id);
    if (!item) throw new Error('PITCH_STACKING_SOURCE_MISSING');
    return { id, title: item.title, businessDate: item.source_as_of, dateKind: item.as_of_kind, reviewState: item.review_state };
  });
  const dates = [...new Set(sources.map(item => isApprovedDate(item.id) ? item.businessDate : null))];
  const businessDate = dates.length === 1 ? dates[0] : null;
  const notice = '历史来源快照 · 仅限获权管理员 · 空置标记不得作实时可租库存';
  const rows = selectFloorRows([...selectedFloors].sort((a, b) => a.id.localeCompare(b.id, 'en')), selectedSpaces);
  const structured = {
    building, businessDate, notice, sources, statusLabels: OCCUPANCY_LABELS,
    towers: towers.map(tower => ({ id: tower.id, code: tower.code, name: tower.display_name,
      floors: rows.filter(row => row.floor.tower_id === tower.id).map(row => {
        const geometry = unitLayout(row.floor, row.spaces, false);
        const weights = new Map(geometry.items.map(item => [item.id, item.weight]));
        return { id: row.floor.id, code: row.floor.floor_code, level: row.floor.level_order,
          useType: row.floor.use_type, areaSqm: areaNumber(row.floor.floor_area_sqm), sourceId: row.floor.source_id,
          uncoveredDisplayWeight: geometry.residual, uncoveredLabel: geometry.residualLabel,
          units: row.spaces.map(unit => ({ id: unit.id, code: unit.unit_code, tenantName: unit.tenant_name,
            areaSqm: areaNumber(unit.area_sqm), industry: null, status: unit.occupancy_status, sourceStatus: unit.source_status,
            verification: unit.verification_status, sourceId: unit.source_id, revision: unit.revision,
            displayWeight: weights.get(unit.id)! })),
        };
      }),
    })),
  };
  const presentation: PresentationInput = {
    projectName: building.name, sourceDate: businessDate ? `来源数据截至 ${businessDate}` : '各份来源日期见结构化资料',
    sourceNotice: notice, towers, floors: rows.map(row => row.floor), spaces: selectedSpaces, filter: 'all', search: '', onlyMatching: false,
  };
  const { width, height } = stackingPresentationSize(presentation);
  return { structured, presentation, dimensions: { width, height } };
}

export async function stackingVisualSvg(visual: NonNullable<ReturnType<typeof createStackingVisual>>) {
  return createStackingPresentationSvg(visual.presentation, svgText(await sceneFont()));
}
