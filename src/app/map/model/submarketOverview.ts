import { normalizeMapSubmarket } from './marketIdentity';
import { aggregateMarket, type MarketBuilding } from './marketStatistics';
export { officeGrade, type OfficeGrade } from './marketIdentity';
export { latestFormalMetric as mostRecentMarketMetric } from './quarterlyFacts';
export type { MarketBuilding, MarketMetric } from './marketStatistics';
export type SubmarketSummary = ReturnType<typeof aggregateMarket> & { name: string };

export function summarizeSubmarkets(buildings: readonly MarketBuilding[]): Map<string, SubmarketSummary> {
  const groups = new Map<string, MarketBuilding[]>();
  for (const building of buildings) {
    const name = normalizeMapSubmarket(building.submarket);
    if (!name || name === '其他') continue;
    const group = groups.get(name) ?? [];
    group.push(building); groups.set(name, group);
  }
  return new Map([...groups].map(([name, group]) => [name, { name, ...aggregateMarket(group, 'filtered_market', true) }]));
}

export function submarketSummary(buildings: readonly MarketBuilding[], name: string): SubmarketSummary {
  const normalized = normalizeMapSubmarket(name);
  return { name: normalized, ...aggregateMarket(buildings.filter(building => normalizeMapSubmarket(building.submarket) === normalized), 'filtered_market', true) };
}
