/**
 * Stacking Plan read-only presentation model.
 * Source-labelled occupancy is not current availability or a lease ledger.
 * Keep screen and export projections on this single selection path.
 */
export type OccupancyStatus = 'occupied' | 'vacant' | 'other' | 'unknown';
export type PlanFloor = {
  id: string;
  tower_id: string;
  floor_code: string;
  level_order: number;
  floor_area_sqm: number | string | null;
  zone: string | null;
  use_type: string;
};
export type PlanSpace = {
  id: string;
  floor_id: string;
  unit_code: string;
  occupancy_status: OccupancyStatus;
  tenant_name: string | null;
  area_sqm: number | string | null;
  verification_status: string;
};
export type SpaceFilter = 'all' | OccupancyStatus;
export type FloorRow<F extends PlanFloor = PlanFloor, S extends PlanSpace = PlanSpace> = {
  floor: F;
  spaces: S[];
};
export type FloorAreaCheck = {
  reference: number | null;
  recorded: number;
  missingUnitAreas: number;
  gap: number | null;
  overallocated: number;
  isBalanced: boolean;
};

export const OCCUPANCY_LABELS: Record<OccupancyStatus, string> = {
  occupied: '已租（来源标注）',
  vacant: '空置（来源标注）',
  other: '其他用途',
  unknown: '状态待确认',
};

export function areaNumber(value: number | string | null | undefined): number | null {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

export function areaCheck(floor: PlanFloor, spaces: PlanSpace[]): FloorAreaCheck {
  const reference = areaNumber(floor.floor_area_sqm);
  const recorded = spaces.reduce((sum, s) => sum + (areaNumber(s.area_sqm) ?? 0), 0);
  const missingUnitAreas = spaces.filter(s => areaNumber(s.area_sqm) === null).length;
  const difference = reference === null ? null : reference - recorded;
  return {
    reference,
    recorded,
    missingUnitAreas,
    gap: difference !== null && difference > 0.1 ? difference : null,
    overallocated: difference !== null && difference < -0.1 ? -difference : 0,
    isBalanced: difference !== null && Math.abs(difference) <= 0.1 && missingUnitAreas === 0,
  };
}

export function selectFloorRows<F extends PlanFloor, S extends PlanSpace>(
  floors: F[],
  spaces: S[],
  filter: SpaceFilter = 'all',
  search = '',
): FloorRow<F, S>[] {
  const query = search.trim().toLocaleLowerCase();
  const byFloor = new Map<string, S[]>();
  spaces.forEach(space => {
    const list = byFloor.get(space.floor_id) ?? [];
    list.push(space);
    byFloor.set(space.floor_id, list);
  });
  return [...floors].sort((a, b) => b.level_order - a.level_order)
    .map(floor => ({
      floor,
      spaces: (byFloor.get(floor.id) ?? []).filter(space => {
        if (filter !== 'all' && space.occupancy_status !== filter) return false;
        if (!query) return true;
        return (floor.floor_code + 'F ' + (space.tenant_name ?? '') + ' ' + space.unit_code)
          .toLocaleLowerCase().includes(query);
      }),
    }))
    .filter(row => row.spaces.length > 0 || (filter === 'all' && query === ''));
}

/** Missing positive labels are source-coverage questions, not assertions of physical floors. */
export function uncoveredFloorLabels(floors: PlanFloor[]): string[] {
  const positives = new Set(floors.filter(f => f.level_order > 0 && /^\d+$/.test(f.floor_code))
    .map(f => Number(f.floor_code)));
  if (!positives.size) return [];
  const min = Math.min(...positives);
  const max = Math.max(...positives);
  const missing: string[] = [];
  for (let n = min + 1; n < max; n++) if (!positives.has(n)) missing.push(n + 'F');
  return missing;
}

export function matchingTenant<S extends PlanSpace>(selected: S | null, unit: S): boolean {
  const name = selected?.tenant_name?.trim().toLocaleLowerCase();
  return !!name && selected?.occupancy_status === 'occupied'
    && unit.occupancy_status === 'occupied'
    && unit.tenant_name?.trim().toLocaleLowerCase() === name;
}

export type PlanSummary = {
  officeFloors: number;
  officeArea: number;
  occupiedArea: number;
  vacantArea: number;
  otherArea: number;
  verifiedUnits: number;
  allUnits: number;
  missingAreaUnits: number;
  unknownStatusUnits: number;
  areaConflicts: number;
  officeUnassignedArea: number;
};

/** Raw source sums; never infer a live vacancy rate from these numbers. */
export function summarizePlan(floors: PlanFloor[], spaces: PlanSpace[]): PlanSummary {
  const office = floors.filter(f => f.use_type === 'office');
  const officeIds = new Set(office.map(f => f.id));
  const officeSpaces = spaces.filter(s => officeIds.has(s.floor_id));
  const sumStatus = (status: OccupancyStatus) => officeSpaces
    .filter(s => s.occupancy_status === status)
    .reduce((sum, s) => sum + (areaNumber(s.area_sqm) ?? 0), 0);
  const checks = office.map(f => areaCheck(f, spaces.filter(s => s.floor_id === f.id)));
  return {
    officeFloors: office.length,
    officeArea: office.reduce((sum, f) => sum + (areaNumber(f.floor_area_sqm) ?? 0), 0),
    occupiedArea: sumStatus('occupied'),
    vacantArea: sumStatus('vacant'),
    otherArea: sumStatus('other'),
    verifiedUnits: spaces.filter(s => s.verification_status === 'verified').length,
    allUnits: spaces.length,
    missingAreaUnits: spaces.filter(s => areaNumber(s.area_sqm) === null).length,
    unknownStatusUnits: spaces.filter(s => s.occupancy_status === 'unknown').length,
    areaConflicts: checks.filter(c => c.overallocated > 0).length,
    officeUnassignedArea: checks.reduce((sum, c) => sum + (c.gap ?? 0), 0),
  };
}

/**
 * Widths represent recorded area if a floor reference exists; hidden/filter-only
 * remainder is explicitly labelled rather than falsely filling the whole floor.
 * Unknown-size units get a display-only minimum weight, not an inferred area.
 */
export function unitLayout(
  floor: PlanFloor,
  units: PlanSpace[],
  isFiltered: boolean,
): { items: { id: string; weight: number }[]; residual: number; residualLabel: string | null } {
  const check = areaCheck(floor, units);
  const known = units.filter(s => areaNumber(s.area_sqm) !== null);
  const mean = known.length ? check.recorded / known.length : 0;
  const unknownWeight = Math.max(1, mean * 0.08);
  const items = units.map(s => ({ id: s.id, weight: areaNumber(s.area_sqm) ?? unknownWeight }));
  const residual = check.reference !== null
    ? Math.max(0, check.reference - check.recorded - units.filter(s => areaNumber(s.area_sqm) === null).length * unknownWeight)
    : 0;
  return {
    items,
    residual,
    residualLabel: residual > 0.1
      ? isFiltered ? '其他未展示面积' : '面积未覆盖 / 待核'
      : null,
  };
}
