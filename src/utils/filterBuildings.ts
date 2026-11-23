import type { SidebarFilterState } from '@/src/components/SidebarFilter';
import type { BuildingWithMetrics, BuildingMetric } from '@/src/types';
import { matchesMapConditions } from './mapFilterConditions';

export function getLatestMetric(metrics: BuildingMetric[]): BuildingMetric | null {
  if (!Array.isArray(metrics) || metrics.length === 0) return null;
  let latest: BuildingMetric | null = null;
  for (const m of metrics) {
    const yr = typeof m?.record_year === 'number' ? m.record_year : 0;
    const q = typeof m?.record_quarter === 'number' ? m.record_quarter : 0;
    if (!latest) { latest = m; continue; }
    const lyr = typeof latest.record_year === 'number' ? latest.record_year : 0;
    const lq = typeof latest.record_quarter === 'number' ? latest.record_quarter : 0;
    if (yr > lyr || (yr === lyr && q > lq)) latest = m;
  }
  return latest;
}

export interface FilterOptions {
  subwayFilter?: (building: BuildingWithMetrics) => boolean;
}

export function filterBuildings(
  buildings: BuildingWithMetrics[],
  filterState: SidebarFilterState,
  options?: FilterOptions,
): BuildingWithMetrics[] {
  return buildings.filter(b => {
    if (filterState.districts?.length > 0 && !filterState.districts.includes(b.district)) return false;
    if (filterState.submarkets?.length > 0 && b.submarket && !filterState.submarkets.includes(b.submarket)) return false;

    if (filterState.projectTypes) {
      if (filterState.projectTypes.length === 0) return false;
      const bGrade = (b.grade || '').toUpperCase();
      let isMatch = false;
      if (filterState.projectTypes.includes('产业园区') && bGrade.includes('BP')) isMatch = true;
      else if (filterState.projectTypes.includes('甲级写字楼') && (bGrade.includes('A') || bGrade.includes('P')) && !bGrade.includes('BP')) isMatch = true;
      else if (filterState.projectTypes.includes('乙级写字楼') && bGrade.includes('B') && !bGrade.includes('BP')) isMatch = true;
      if (!isMatch) return false;
    }

    if (filterState.leeds?.length > 0) {
      const bLeed = !b.leed_certification || b.leed_certification === '' ? 'NULL' : b.leed_certification;
      if (!filterState.leeds.includes(bLeed)) return false;
    }

    const latest = getLatestMetric(b.metrics);

    if (!matchesMapConditions(filterState.numericFilters, field =>
      field === 'owner' || field === 'property_management' ? b[field] : latest?.[field],
    )) return false;

    if (options?.subwayFilter) {
      if (!options.subwayFilter(b)) return false;
    }

    return true;
  });
}
