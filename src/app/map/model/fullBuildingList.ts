import type { BuildingMetric } from '@/src/types';
import { getLatestMetric } from '@/src/utils/filterBuildings';
export type FullListBuilding = {
  id: string;
  name?: string | null;
  district?: string | null;
  submarket?: string | null;
  grade?: string | null;
  type?: string | null;
  completion_year?: string | number | null;
  location_lng?: number | null;
  location_lat?: number | null;
  metrics?: BuildingMetric[];
  launch_year?: number | null;
  launch_quarter?: string | null;
  total_area?: number | null;
  _dataType?: 'existing' | 'future';
};
export type FullListSort = 'default' | 'name' | 'area' | 'rent' | 'rent-desc' | 'vacancy' | 'vacancy-desc';
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
export function listVacancyPercent(value: number | null) {
  return value === null ? null : value <= 1 ? value * 100 : value;
}
export function sortFullList(buildings: FullListBuilding[], sort: FullListSort) {
  if (sort === 'default') return buildings;
  if (sort === 'name') {
    return [...buildings].sort((left, right) => (left.name ?? '').localeCompare(right.name ?? '', 'zh-CN'));
  }
  const field = sort === 'rent-desc' ? 'rent' : sort === 'vacancy-desc' ? 'vacancy' : sort;
  const descending = sort === 'area' || sort === 'rent-desc' || sort === 'vacancy-desc';
  return buildings.map((building, index) => {
    const value = listBuildingValues(building)[field];
    return { building, index, value: field === 'vacancy' ? listVacancyPercent(value) : value };
  })
    .sort((left, right) => {
      const { value: a } = left, { value: b } = right;
      if (a === null) return b === null ? left.index - right.index : 1;
      if (b === null) return -1;
      return (descending ? b - a : a - b) || left.index - right.index;
    }).map(item => item.building);
}
