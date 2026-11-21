import { logAction } from './audit';

export interface ReadingBuilding {
  id: string;
  name?: string | null;
  _dataType?: string;
}

/** Small, explicit observations only. No contacts, document contents or signed URLs. */
export function auditBuildingReading(
  action: 'VIEW_BUILDING' | 'VIEW_BUILDING_CONTACT' | 'VIEW_BUILDING_TREND' | 'VIEW_BUILDING_SECTION',
  building: ReadingBuilding,
  state?: { metric?: 'rent' | 'vac'; section?: string },
  isDemo = false,
): void {
  if (isDemo || !building.id) return;
  logAction(undefined, action, {
    module: 'map', target_table: building._dataType === 'future' ? 'future_supplies' : 'buildings',
    building_id: building.id, building_name: building.name ?? '', data_type: building._dataType ?? 'existing',
    ...(state?.metric ? { metric: state.metric } : {}),
    ...(state?.section ? { section: state.section } : {}),
  });
}
