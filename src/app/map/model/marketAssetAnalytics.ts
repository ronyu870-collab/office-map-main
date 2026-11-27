import { formalQuarterRentEligible, formalQuarterVacancyEligible } from '@/src/lib/marketSamplePolicy';
import { isEnteredFutureSupply, isPendingFutureSupply, futureSupplyDate } from '@/src/lib/future-supply-status';
import { isCommercialFutureSupply } from './mapDomain';
import { normalizeMapSubmarket, officeGrade } from './marketIdentity';
import { aggregateMarket, type MarketBuilding, type MarketMetric } from './marketStatistics';
import { isFormalQuarterlyFact, latestFormalMetric, quarterKey } from './quarterlyFacts';
import { mapOptionalNumber } from './vacancyMetrics';

export const RESEARCH_PRODUCTS = ['a', 'b', 'park'] as const;
export type ResearchProduct = typeof RESEARCH_PRODUCTS[number];
export type ResearchProductScope = ResearchProduct | 'office';
export const productNames = { a: '甲级', b: '乙级', park: '产业园', office: '甲乙级办公' } as const;
export type ResearchMarketContext = { positioning: string; projects: { buildingId: string; role: string; reason: string }[] };
export type ResearchAsset = MarketBuilding & {
  id: string; name: string; submarket: string; grade: string | null;
  completion_year?: string | null; leed_certification?: string | null;
};
export type AssetObservation = {
  id: string; name: string; grade: ResearchProduct; area: number | null;
  rent: number | null; vacancy: number | null;
};
export type RentBin = { low: number; high: number; last: boolean; ids: string[] };
export type RentDistribution = {
  count: number; min: number; max: number; q1: number; median: number; q3: number;
  bins: RentBin[]; observations: AssetObservation[];
};

export function quantile(sorted: readonly number[], p: number): number {
  const i = (sorted.length - 1) * p;
  const lo = Math.floor(i), hi = Math.ceil(i);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (i - lo);
}

/** Positive, human-readable axis/bin step; never construct bins from displayed/rounded observations. */
export function niceMarketStep(raw: number): number {
  if (!Number.isFinite(raw) || raw <= 0) return 1;
  const magnitude = 10 ** Math.floor(Math.log10(raw));
  const fraction = raw / magnitude;
  return ([1, 2, 2.5, 5, 10].find(n => n >= fraction) ?? 10) * magnitude;
}

export function formalAssetMetric(rows: readonly MarketMetric[] | null | undefined, period: number) {
  return latestFormalMetric(rows?.filter(row => quarterKey(row) === period));
}

export function latestAssetQuarter(buildings: readonly MarketBuilding[], submarket: string): number | null {
  let latest = -Infinity;
  for (const building of buildings) {
    if (normalizeMapSubmarket(building.submarket) !== normalizeMapSubmarket(submarket)) continue;
    if (!RESEARCH_PRODUCTS.some(grade => grade === officeGrade(building.grade))) continue;
    for (const row of building.metrics ?? []) {
      if (isFormalQuarterlyFact(row)) latest = Math.max(latest, quarterKey(row)!);
    }
  }
  return Number.isFinite(latest) ? latest : null;
}

export function rentDistribution(points: readonly AssetObservation[]): RentDistribution | null {
  const observations = points.filter(p => p.rent !== null).sort((a, b) => a.rent! - b.rent! || a.id.localeCompare(b.id));
  if (!observations.length) return null;
  const values = observations.map(p => p.rent!);
  const min = values[0], max = values[values.length - 1];
  const q1 = quantile(values, .25), median = quantile(values, .5), q3 = quantile(values, .75);
  const bins: RentBin[] = [];
  if (values.length >= 8 && max > min) {
    const fd = 2 * (q3 - q1) / Math.cbrt(values.length);
    const target = Math.max(4, Math.min(10, Math.ceil(fd > 0 ? (max - min) / fd : Math.sqrt(values.length))));
    const step = niceMarketStep((max - min) / target);
    const start = Math.floor(min / step) * step;
    const count = Math.max(1, Math.ceil((max - start) / step));
    for (let i = 0; i < count; i++) bins.push({ low: start + i * step, high: start + (i + 1) * step, last: i === count - 1, ids: [] });
    for (const observation of observations) {
      const index = Math.max(0, Math.min(bins.length - 1, Math.floor((observation.rent! - start) / step)));
      bins[index].ids.push(observation.id);
    }
  }
  return { count: values.length, min, max, q1, median, q3, bins, observations };
}

export function analyzeMarketAssets(buildings: readonly MarketBuilding[], submarket: string, period: number, product: ResearchProductScope) {
  const seen = new Set<string>();
  const cohort: MarketBuilding[] = [];
  const points: AssetObservation[] = [];
  for (const b of buildings) {
    const grade = officeGrade(b.grade);
    if (!b.id || seen.has(b.id) || normalizeMapSubmarket(b.submarket) !== normalizeMapSubmarket(submarket)
      || grade === 'other' || (product === 'office' ? grade === 'park' : grade !== product)) continue;
    seen.add(b.id);
    const fact = formalAssetMetric(b.metrics, period);
    cohort.push({ ...b, metrics: fact ? [fact] : [] });
    if (!fact) continue;
    const area = mapOptionalNumber(fact.total_area), rent = mapOptionalNumber(fact.net_effective_rent), vacant = mapOptionalNumber(fact.vacant_area);
    points.push({ id: b.id, name: b.name?.trim() || '未命名项目', grade,
      area: area > 0 ? area : null, rent: formalQuarterRentEligible(area, rent) ? rent : null,
      vacancy: formalQuarterVacancyEligible(area, vacant) ? vacant / area * 100 : null });
  }
  const statistics = aggregateMarket(cohort, 'quarterly_market');
  const distribution = rentDistribution(points);
  const paired = points.filter(p => p.rent !== null && p.vacancy !== null);
  return { statistics, distribution, points, paired };
}

export type ResearchSupply = {
  id?: string; name?: string | null; submarket?: string | null; building_id?: string | null;
  grade?: unknown; type?: unknown; status?: unknown; is_entered_market?: unknown;
  launch_year?: unknown; launch_quarter?: unknown; total_area?: unknown;
};

export function summarizeResearchSupply(supplies: readonly ResearchSupply[], market: string) {
  const seen = new Set<string>();
  const years = new Map<string, { count: number; area: number; known: number }>();
  const products = new Map<string, number>();
  const projects: { id: string; name: string; period: string; product: string; area: number | null; year: number | null }[] = [];
  let area = 0, known = 0, enteredCount = 0;
  for (const supply of supplies) {
    if (!supply.id || seen.has(supply.id) || normalizeMapSubmarket(supply.submarket) !== normalizeMapSubmarket(market)
      || isPendingFutureSupply(supply) || supply.status !== 'future') continue;
    seen.add(supply.id);
    if (isEnteredFutureSupply(supply)) { enteredCount++; continue; }
    const yearValue = mapOptionalNumber(supply.launch_year);
    const year = Number.isInteger(yearValue) && yearValue >= 1900 && yearValue <= 2200 ? yearValue : null;
    const bucketKey = year === null ? '待定' : String(year);
    const product = isCommercialFutureSupply(supply) ? '商业' : officeGrade(supply.grade);
    const label = product === 'other' ? '类型未收录' : product === '商业' ? product : productNames[product];
    const value = mapOptionalNumber(supply.total_area);
    const validArea = value >= 0 ? value : null;
    const bucket = years.get(bucketKey) ?? { count: 0, area: 0, known: 0 };
    bucket.count++;
    if (validArea !== null) { bucket.area += validArea; bucket.known++; area += validArea; known++; }
    years.set(bucketKey, bucket);
    products.set(label, (products.get(label) ?? 0) + 1);
    projects.push({ id: supply.id, name: supply.name?.trim() || '未命名项目', period: futureSupplyDate(supply), product: label, area: validArea, year });
  }
  projects.sort((a, b) => (a.year ?? Infinity) - (b.year ?? Infinity) || a.period.localeCompare(b.period) || a.name.localeCompare(b.name, 'zh-CN'));
  return { count: projects.length, enteredCount, area: known ? area : null, known, years: [...years.entries()].sort(([a], [b]) =>
    a === '待定' ? 1 : b === '待定' ? -1 : Number(a) - Number(b)).map(([label, value]) => ({ label, count: value.count, area: value.known ? value.area : null, known: value.known })),
    products: [...products.entries()].map(([label, count]) => ({ label, count })), projects };
}

export type ResearchLease = {
  source_record_id?: string | null; building_id?: string | null; record_source?: string | null;
  quality_status?: string | null; building_match_scope?: string | null;
  transaction_year?: unknown; transaction_quarter?: unknown; area_sqm?: unknown; industry?: string | null; demand_type?: string | null;
};
type DemandBucket = { label: string; count: number; area: number };
function addBucket(map: Map<string, DemandBucket>, label: string, area: number) {
  const value = map.get(label) ?? { label, count: 0, area: 0 };
  value.count++; value.area += area; map.set(label, value);
}
/** Customer-facing aggregated operational records only. No tenant, contact, rent, remarks or history projection. */
export function summarizeResearchDemand(rows: readonly ResearchLease[], allowedIds: ReadonlySet<string>, year: number) {
  const seen = new Set<string>();
  const size = new Map<string, DemandBucket>(), industries = new Map<string, DemandBucket>(), types = new Map<string, DemandBucket>();
  const quarters = new Map<string, DemandBucket>(), projects = new Map<string, DemandBucket>();
  let area = 0, count = 0;
  for (const row of rows) {
    if (row.record_source !== 'live' || row.quality_status !== 'OPERATIONAL' || row.building_match_scope !== 'exact'
      || !row.source_record_id || seen.has(row.source_record_id) || !row.building_id || !allowedIds.has(row.building_id)
      || mapOptionalNumber(row.transaction_year) !== year) continue;
    const value = mapOptionalNumber(row.area_sqm);
    if (!(value > 0)) continue;
    seen.add(row.source_record_id); area += value; count++;
    addBucket(projects, row.building_id, value);
    addBucket(size, value < 500 ? '500㎡以下' : value < 1000 ? '500–999㎡' : value < 3000 ? '1,000–2,999㎡' : value < 5000 ? '3,000–4,999㎡' : '5,000㎡及以上', value);
    addBucket(industries, row.industry?.trim() || '行业未收录', value);
    addBucket(types, row.demand_type?.trim() || '类型未收录', value);
    const quarter = String(row.transaction_quarter ?? '').trim().toUpperCase();
    addBucket(quarters, /^Q[1-4]$/.test(quarter) ? quarter : '季度未收录', value);
  }
  // Avoid disclosure by subtraction: a suppressed remainder must contain at least
  // three transactions. Unknown industries remain unknown, never imputed.
  function protectedGroups(map: Map<string, DemandBucket>, limit = Infinity) {
    const visible = [...map.values()].filter(item => item.count >= 3)
      .sort((a, b) => b.area - a.area || a.label.localeCompare(b.label)).slice(0, limit);
    const omitted = count - visible.reduce((sum, item) => sum + item.count, 0);
    if (omitted > 0 && omitted < 3) visible.pop();
    return visible;
  }
  return count < 3 ? null : { year, count, area,
    size: protectedGroups(size), industries: protectedGroups(industries),
    types: protectedGroups(types), quarters: protectedGroups(quarters).sort((a, b) => a.label.localeCompare(b.label)),
    // These are aggregate building examples, never individual transaction details.
    projects: protectedGroups(projects, 3).map(({ label, count, area }) => ({ buildingId: label, count, area })),
  };
}

export type MarketAssetResearchPayload = {
  period: number;
  assets: ResearchAsset[];
  supplies: ResearchSupply[] | null;
  demand: Record<string, ReturnType<typeof summarizeResearchDemand>>;
  demandAvailable: boolean;
  contexts?: Record<string, ResearchMarketContext>;
};
