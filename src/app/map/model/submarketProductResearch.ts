import { normalizeMapSubmarket, officeGrade } from './marketIdentity';
import { latestFormalMetric } from './quarterlyFacts';
import { MIN_RESEARCH_MARKET_SAMPLES, type SubmarketTrendPoint } from './submarketMarketTrend';
import type { MarketBuilding } from './marketStatistics';
import type { SubmarketIntelligence } from './submarketIntelligence';
import type { ResearchMarketType } from './submarketResearchPresentation';
import { mapOptionalNumber } from './vacancyMetrics';

export type ResearchProduct = 'office' | 'park';
export type MarketProducts = { type: ResearchMarketType; officeCount: number; parkCount: number };
const parkMarkets = new Set(['上地', '北清路', '四季青', '丰台科技园', '亦庄', '通惠河传媒走廊']);

/** Explicit defaults apply only when the catalog cannot establish the market.
 * Never infer the enduring market identity from a filter or editorial focus. */
export function configuredResearchMarketType(name: string): ResearchMarketType {
  const market = normalizeMapSubmarket(name);
  return market === '望京-酒仙桥' ? 'mixed' : parkMarkets.has(market) ? 'park' : 'office';
}

export function belongsToResearchProduct(grade: unknown, product: ResearchProduct) {
  const normalized = officeGrade(grade);
  return product === 'park' ? normalized === 'park' : normalized === 'a' || normalized === 'b';
}

export function classifyResearchMarket(name: string, stock: readonly { id: string; grade?: string | null }[]): MarketProducts {
  const seen = new Set<string>();
  let officeCount = 0, parkCount = 0;
  for (const row of stock) {
    if (!row.id || seen.has(row.id)) continue;
    seen.add(row.id);
    if (belongsToResearchProduct(row.grade, 'office')) officeCount++;
    else if (belongsToResearchProduct(row.grade, 'park')) parkCount++;
  }
  return { type: officeCount && parkCount ? 'mixed' : parkCount ? 'park' : officeCount ? 'office' : configuredResearchMarketType(name), officeCount, parkCount };
}

export function representativeResearchMetric(point: SubmarketTrendPoint | undefined, metric: 'rent' | 'vacancyPct'): number | null {
  if (!point) return null;
  const count = metric === 'rent' ? point.rentSamples : point.vacancySamples;
  const value = point[metric];
  return count >= MIN_RESEARCH_MARKET_SAMPLES && value != null && Number.isFinite(value) ? value : null;
}

/** Mask sparse market points only in research presentation; preserve original observations and periods. */
export function representativeProductTrend(data: readonly SubmarketTrendPoint[]): SubmarketTrendPoint[] {
  return data.map(point => ({ ...point, rent: representativeResearchMetric(point, 'rent'),
    vacancyPct: representativeResearchMetric(point, 'vacancyPct') }));
}

export function latestProductObservation(data: readonly SubmarketTrendPoint[], metric: 'rent' | 'vacancyPct') {
  return data.findLast(point => (metric === 'rent' ? point.rentSamples : point.vacancySamples) > 0);
}

export function latestProductComparison(office: readonly SubmarketTrendPoint[], park: readonly SubmarketTrendPoint[], metric: 'rent' | 'vacancyPct') {
  const parkByPeriod = new Map(park.map(point => [point.period, point]));
  for (const point of [...office].reverse()) {
    const other = parkByPeriod.get(point.period);
    const officeValue = representativeResearchMetric(point, metric);
    const parkValue = representativeResearchMetric(other, metric);
    if (officeValue != null && parkValue != null) return { period: point.period, office: officeValue, park: parkValue };
  }
  return null;
}

/** Retain curated projects. A missing product receives a real visible catalog example,
 * not a new editorial claim; these presentation-only examples are never persisted. */
export function completeProductExamples(buildings: readonly MarketBuilding[], name: string, type: ResearchMarketType,
  curated: SubmarketIntelligence['projects'] = []): SubmarketIntelligence['projects'] {
  if (type === 'office') return curated;
  const eligible = buildings.filter(building => building.id && normalizeMapSubmarket(building.submarket) === normalizeMapSubmarket(name));
  const byId = new Map(eligible.map(building => [building.id!, building]));
  const result = curated.filter(item => byId.has(item.buildingId));
  const products: ResearchProduct[] = type === 'mixed' ? ['office', 'park'] : ['park'];
  for (const product of products) {
    if (result.some(item => belongsToResearchProduct(byId.get(item.buildingId)?.grade, product))) continue;
    const candidates = eligible.filter(building => belongsToResearchProduct(building.grade, product))
      .map(building => ({ building, metric: latestFormalMetric(building.metrics) }))
      .sort((a,b) => {
        const left = mapOptionalNumber(a.metric?.total_area), right = mapOptionalNumber(b.metric?.total_area);
        return (Number.isFinite(right) ? right : -1) - (Number.isFinite(left) ? left : -1)
          || String(a.building.id).localeCompare(String(b.building.id));
      });
    const example = candidates[0];
    if (!example) continue;
    const area = mapOptionalNumber(example.metric?.total_area);
    const label = product === 'park' ? '产业园' : '商务办公';
    result.push({ buildingId: example.building.id!, role: label + '样本',
      reason: example.metric && area > 0 ? `${example.metric.record_year}Q${example.metric.record_quarter} 已知面积 ${Math.round(area).toLocaleString('zh-CN')} ㎡。` : `项目名录归为${label}。`,
      sourceIds: [] });
  }
  return result;
}
