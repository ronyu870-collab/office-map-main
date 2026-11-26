import type { SidebarFilterState } from '@/src/components/SidebarFilter';
import type { BuildingWithMetrics, BuildingMetric } from '@/src/types';

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

    if (filterState.numericFilters?.length > 0) {
      for (const cond of filterState.numericFilters) {
        if (cond.value === '' || cond.value === null || cond.value === undefined) continue;

        if (cond.field === 'owner' || cond.field === 'property_management') {
          const target = String(b[cond.field] || '').toLowerCase();
          const query = String(cond.value).trim().toLowerCase();
          if (query && !target.includes(query)) return false;
          continue;
        }

        if (!latest) return false;
        if (isNaN(Number(cond.value))) continue;

        const raw = latest[cond.field as keyof BuildingMetric];
        if (raw == null || raw === '') return false;
        let metricVal = Number(raw);
        const filterVal = Number(cond.value);
        if (!Number.isFinite(metricVal)) return false;

        if (cond.field === 'vacancy_rate') metricVal = metricVal * 100;

        switch (cond.operator) {
          case '>=': if (!(metricVal >= filterVal)) return false; break;
          case '<=': if (!(metricVal <= filterVal)) return false; break;
          case '=':  if (!(metricVal === filterVal)) return false; break;
          case '>':  if (!(metricVal > filterVal)) return false; break;
          case '<':  if (!(metricVal < filterVal)) return false; break;
        }
      }
    }

    if (options?.subwayFilter) {
      if (!options.subwayFilter(b)) return false;
    }

    return true;
  });
}
