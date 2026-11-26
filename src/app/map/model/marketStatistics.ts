import { hasMarketCoordinates, officeGrade } from './marketIdentity';
import { latestFormalMetric, MARKET_CONTRACT_VERSION, type QuarterlyFact } from './quarterlyFacts';
import { mapOptionalNumber, observedVacantArea } from './vacancyMetrics';
import { isEnteredFutureSupply, isPendingFutureSupply } from '@/src/lib/future-supply-status';

export type MarketMetric = QuarterlyFact & {
  total_area?: unknown; vacant_area?: unknown; vacancy_rate?: unknown; net_effective_rent?: unknown;
};
export type MarketBuilding = {
  id?: string | null; name?: string | null; submarket?: string | null; grade?: string | null;
  location_lng?: number | null; location_lat?: number | null; metrics?: MarketMetric[] | null;
};
export type MarketScope = 'authorized_market' | 'filtered_market' | 'mappable_market' | 'quarterly_market' | 'future_supply';
export type MetricFactState = 'observed' | 'not_recorded' | 'not_published' | 'not_applicable' | 'reference_estimate';

/** Pure, linear aggregate. Area always belongs to the selected observation. */
export function aggregateMarket(buildings: readonly MarketBuilding[], scope: MarketScope = 'filtered_market', officesOnly = false) {
  let projectCount = 0, mappableCount = 0, gradeACount = 0, gradeBCount = 0, parkCount = 0, otherCount = 0;
  let stockArea = 0, areaSamples = 0, rentSum = 0, rentSampleCount = 0, rentSampleArea = 0;
  let vacantArea = 0, vacancySampleCount = 0, vacancySampleArea = 0;
  const periods: Record<string, number> = {};
  const seen = new Set<string>();
  for (const building of buildings) {
    if (!building.id || seen.has(building.id)) continue;
    seen.add(building.id);
    const grade = officeGrade(building.grade);
    if (grade === 'a') gradeACount++;
    else if (grade === 'b') gradeBCount++;
    else if (grade === 'park') parkCount++;
    else otherCount++;
    if (officesOnly && grade !== 'a' && grade !== 'b') continue;
    projectCount++;
    if (hasMarketCoordinates(building)) mappableCount++;
    const metric = latestFormalMetric(building.metrics);
    if (!metric) continue;
    const period = `${metric.record_year}Q${metric.record_quarter}`;
    periods[period] = (periods[period] ?? 0) + 1;
    const area = mapOptionalNumber(metric.total_area);
    if (!(area >= 0)) continue;
    stockArea += area; areaSamples++;
    if (area === 0) continue;
    const rent = mapOptionalNumber(metric.net_effective_rent);
    if (rent >= 0) { rentSum += rent * area; rentSampleArea += area; rentSampleCount++; }
    const vacant = observedVacantArea(metric);
    if (Number.isFinite(vacant)) { vacantArea += vacant; vacancySampleArea += area; vacancySampleCount++; }
  }
  return {
    version: MARKET_CONTRACT_VERSION, scope, method: 'latest_formal_per_building' as const,
    source: 'building_metrics' as const, membershipTime: 'current_catalog' as const,
    projectCount, mappableCount, gradeACount, gradeBCount, parkCount, otherCount,
    officeCount: gradeACount + gradeBCount, stockArea, areaSamples, periods,
    rent: rentSampleArea > 0 ? rentSum / rentSampleArea : null,
    vacancyPct: vacancySampleArea > 0 ? vacantArea / vacancySampleArea * 100 : null,
    vacantArea: vacancySampleArea > 0 ? vacantArea : null,
    rentSampleCount, rentSampleArea, vacancySampleCount, vacancySampleArea,
    rentCoverage: { count: projectCount ? rentSampleCount / projectCount : null, area: stockArea > 0 ? rentSampleArea / stockArea : null },
    vacancyCoverage: { count: projectCount ? vacancySampleCount / projectCount : null, area: stockArea > 0 ? vacancySampleArea / stockArea : null },
    rentState: (rentSampleCount ? 'observed' : 'not_recorded') as MetricFactState,
    vacancyState: (vacancySampleCount ? 'observed' : 'not_recorded') as MetricFactState,
  };
}

export function aggregateFutureSupply(supplies: readonly { id?: string; total_area?: unknown; is_entered_market?: unknown; status?: unknown }[]) {
  const seen = new Set<string>();
  let count = 0, area = 0, areaSamples = 0;
  for (const supply of supplies) {
    if (!supply.id || seen.has(supply.id) || isEnteredFutureSupply(supply) || isPendingFutureSupply(supply)) continue;
    seen.add(supply.id); count++;
    const value = mapOptionalNumber(supply.total_area);
    if (value >= 0) { area += value; areaSamples++; }
  }
  return { scope: 'future_supply' as const, count, area: areaSamples ? area : null, areaSamples };
}
