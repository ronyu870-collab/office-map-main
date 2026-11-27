import { mapOptionalNumber } from './vacancyMetrics';

/** Subset of the existing compare fields. Brochure parameters are not
 * quarterly metrics or current available space. */
export const marketBrochureFields = [
  { key: 'gfa_office', label: '办公建筑面积', unit: '㎡' },
  { key: 'standard_floor_area', label: '标准层面积', unit: '㎡' },
  { key: 'clear_height', label: '净高', unit: 'm' },
  { key: 'floor_height', label: '层高', unit: 'm' },
  { key: 'floor_load_office', label: '办公区荷载', unit: 'kg/㎡' },
  { key: 'floor_load_equipment', label: '设备区荷载', unit: 'kg/㎡' },
  { key: 'elevator_passenger', label: '客梯', unit: '台' },
  { key: 'elevator_freight', label: '货梯', unit: '台' },
  { key: 'parking_total', label: '车位', unit: '个' },
] as const;
type FieldKey = typeof marketBrochureFields[number]['key'];
export type BrochureAsset = { buildingId: string; recordedOn: string | null; completionDate: string | null; values: Partial<Record<FieldKey, number>> };

function validDate(input: unknown): string | null {
  if (typeof input !== 'string' || !/^\d{4}-\d{2}-\d{2}(?:$|T)/.test(input)) return null;
  return Number.isFinite(Date.parse(input)) ? input.slice(0, 10) : null;
}

/** Keep one actual edition per stable ID; never fill from a different edition. */
export function projectBrochureParameters(rows: readonly unknown[], selectedIds: readonly string[]) {
  const ids = new Set(selectedIds);
  const latest = new Map<string, Record<string, unknown>>();
  const key = (row: Record<string, unknown>) => {
    const time = Date.parse(String(row.created_at ?? ''));
    return [Number.isFinite(time) ? time : -Infinity, String(row.id ?? '')] as const;
  };
  for (const raw of rows) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) continue;
    const row = raw as Record<string, unknown>;
    if (typeof row.building_id !== 'string' || !ids.has(row.building_id)) continue;
    const old = latest.get(row.building_id);
    if (!old || key(row)[0] > key(old)[0] || (key(row)[0] === key(old)[0] && key(row)[1] > key(old)[1])) latest.set(row.building_id, row);
  }
  return selectedIds.flatMap((buildingId): BrochureAsset[] => {
    const row = latest.get(buildingId);
    if (!row) return [];
    const values: BrochureAsset['values'] = {};
    for (const field of marketBrochureFields) {
      const value = mapOptionalNumber(row[field.key]);
      if (Number.isFinite(value) && (field.key.startsWith('elevator_') || field.key === 'parking_total' ? value >= 0 : value > 0)) values[field.key] = value;
    }
    return [{ buildingId, recordedOn: validDate(row.created_at), completionDate: validDate(row.completion_date), values }];
  });
}
