import type { SidebarFilterState } from '@/src/components/SidebarFilter';
import type { BuildingWithMetrics, BuildingMetric } from '@/src/types';
import { matchesMapConditions } from './mapFilterConditions';

import { latestFormalMetric } from '@/src/app/map/model/quarterlyFacts';
export function getLatestMetric(metrics: BuildingMetric[] | null | undefined): BuildingMetric | null {
  return latestFormalMetric(metrics);
}
import { officeGrade, normalizeLeed, normalizeMapSubmarket } from '@/src/app/map/model/marketIdentity';

export interface FilterOptions {
  subwayFilter?: (building: BuildingWithMetrics) => boolean;
}

export function filterBuildings(
  buildings: BuildingWithMetrics[],
  filterState: SidebarFilterState,
  options?: FilterOptions,
): BuildingWithMetrics[] {
  if ([filterState.districts, filterState.submarkets, filterState.leeds].some(values => values?.length === 0)) return [];
  return buildings.filter(b => {
    if (filterState.districts?.length > 0 && !filterState.districts.includes(b.district)) return false;
    if (filterState.submarkets?.length > 0 && b.submarket && !filterState.submarkets.map(normalizeMapSubmarket).includes(normalizeMapSubmarket(b.submarket))) return false;

    if (filterState.projectTypes) {
      if (filterState.projectTypes.length === 0) return false;
      const grade = officeGrade(b.grade);
      const isMatch = (filterState.projectTypes.includes('产业园区') && grade === 'park')
        || (filterState.projectTypes.includes('甲级写字楼') && grade === 'a')
        || (filterState.projectTypes.includes('乙级写字楼') && grade === 'b');
      if (!isMatch) return false;
    }

    if (filterState.leeds?.length > 0) {
      const bLeed = normalizeLeed(b.leed_certification);
      if (!filterState.leeds.map(normalizeLeed).includes(bLeed)) return false;
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
