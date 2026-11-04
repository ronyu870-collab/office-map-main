import type { BuildingMetric } from '@/src/types';
import { getLatestMetric } from '@/src/utils/filterBuildings';
export type FullListBuilding = {
  id: string;
  name?: string | null;
  district?: string | null;
  submarket?: string | null;
  grade?: string | null;
  completion_year?: string | number | null;
  location_lng?: number | null;
  location_lat?: number | null;
  metrics?: BuildingMetric[];
  launch_year?: number | null;
  launch_quarter?: string | null;
  total_area?: number | null;
  _dataType?: 'existing' | 'future';
};
export type FullListSort = 'default' | 'name' | 'area' | 'rent' | 'vacancy';
/** Match the incumbent detail display only; raw grade and filtering stay unchanged. */
export function displayListGrade(grade: string | null | undefined): string {
  const value = (grade || '—').trim();
  if (!value || value === '—') return '—';
  const upper = value.toUpperCase();
  if (upper === 'BP') return value;
  return upper.includes('P') ? value.replace(/P/gi, 'A') : value;
}
export function hasBuildingLocation(building: FullListBuilding) {
  return Number.isFinite(building.location_lng) && Number.isFinite(building.location_lat);
}
export function finiteMetric(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}
export function listBuildingValues(building: FullListBuilding) {
  const future = building._dataType === 'future';
  const metric = future ? undefined : getLatestMetric(building.metrics ?? []);
  return {
    metric,
    area: finiteMetric(future ? building.total_area : metric?.total_area),
    rent: finiteMetric(metric?.net_effective_rent),
    vacancy: finiteMetric(metric?.vacancy_rate),
    period: metric ? `${metric.record_year}Q${metric.record_quarter}` : null,
  };
}
export function sortFullList(buildings: FullListBuilding[], sort: FullListSort) {
  if (sort === 'default') return buildings;
  return buildings.map((building, index) => ({ building, index, values: listBuildingValues(building) }))
    .sort((left, right) => {
      if (sort === 'name') return (left.building.name ?? '').localeCompare(right.building.name ?? '', 'zh-CN') || left.index - right.index;
      const a = left.values[sort], b = right.values[sort];
      if (a === null) return b === null ? left.index - right.index : 1;
      if (b === null) return -1;
      return (sort === 'area' ? b - a : a - b) || left.index - right.index;
    }).map(item => item.building);
}
