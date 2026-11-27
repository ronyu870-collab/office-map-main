import { officeGrade } from './marketIdentity';
import { aggregateMarket, type MarketMetric } from './marketStatistics';
import { mapOptionalNumber } from './vacancyMetrics';
import { compareQuarterlyFacts, isFormalQuarterlyFact, quarterKey } from './quarterlyFacts';

export type TrendMetricRow = MarketMetric & {
  building_id: string; record_year: number; record_quarter: number;
};
export type SameSampleChange = { samples: number; rentPct: number | null; vacancyPp: number | null };
export const MIN_RESEARCH_MARKET_SAMPLES = 2;
export type ProductDistribution = { samples: number; min: number; p25: number; median: number; p75: number; max: number };
export type SubmarketTrendPoint = {
  period: string; year: number; quarter: number; rent: number | null; vacancyPct: number | null;
  rentSamples: number; vacancySamples: number; rentArea: number; vacancyArea: number;
  // Optional only for compatibility with retained chart snapshots; new computations emit all fields.
  stockArea?: number; stockSamples?: number; rentCoverage?: { count: number | null; area: number | null };
  vacancyCoverage?: { count: number | null; area: number | null };
  source?: 'building_metrics'; membershipTime?: 'current_catalog';
  sampleQuality?: { rent: 'none' | 'single_sample' | 'multiple_samples'; vacancy: 'none' | 'single_sample' | 'multiple_samples' };
  observedRent?: boolean; observedVacancy?: boolean; continuousRent?: boolean; continuousVacancy?: boolean;
  sampleChanged?: { rent: boolean; vacancy: boolean };
  sameSampleQoq?: { rent: SameSampleChange; vacancy: SameSampleChange };
  rentDistribution?: ProductDistribution;
  sizeDistribution?: ProductDistribution;
  sameSampleYoy?: { rent: SameSampleChange; vacancy: SameSampleChange };
};
/** all remains A/P/B; BP is an independent additive product. */
export type SubmarketTrendSeries = Record<'all' | 'a' | 'b', SubmarketTrendPoint[]> & { park?: SubmarketTrendPoint[] };
type OfficeRecord = { id: string; grade?: string | null };

/** The selected observation is never forward-filled into another quarter. */
function distribution(values: number[]): ProductDistribution | undefined {
  if (values.length < MIN_RESEARCH_MARKET_SAMPLES) return undefined;
  values.sort((a, b) => a - b);
  const quantile = (q: number) => {
    const index = (values.length - 1) * q;
    const lower = Math.floor(index), upper = Math.ceil(index);
    return values[lower] + (values[upper] - values[lower]) * (index - lower);
  };
  return { samples: values.length, min: values[0], p25: quantile(.25), median: quantile(.5), p75: quantile(.75), max: values[values.length - 1] };
}

function computeProductTrends(buildings: readonly OfficeRecord[], rows: readonly TrendMetricRow[], count: number | 'available',
  product: 'office' | 'park', distributions: boolean): SubmarketTrendSeries {
  const members = new Map(buildings.map(building => [building.id, officeGrade(building.grade)] as const)
    .filter(([, grade]) => product === 'park' ? grade === 'park' : grade === 'a' || grade === 'b'));
  const byEntityPeriod = new Map<string, TrendMetricRow>();
  let first = Infinity, last = -Infinity;
  for (const row of rows) {
    if (!members.has(row.building_id) || !isFormalQuarterlyFact(row)) continue;
    const key = quarterKey(row)!;
    const entityPeriod = `${row.building_id}:${key}`;
    const previous = byEntityPeriod.get(entityPeriod);
    if (!previous || compareQuarterlyFacts(row, previous) > 0) byEntityPeriod.set(entityPeriod, row);
    first = Math.min(first, key);
    last = Math.max(last, key);
  }
  if (!Number.isFinite(last)) return { all: [], a: [], b: [] };
  const requested = count === 'available' ? last - first + 1 : count;
  const size = Number.isFinite(requested) ? Math.max(1, Math.min(20, Math.floor(requested))) : 8;
  const periodKeys = Array.from({ length: size }, (_, index) => last - size + index + 1);
  const series = (selected: 'all' | 'a' | 'b'): SubmarketTrendPoint[] => {
    const selectedMembers = [...members].filter(([, grade]) => selected === 'all' || grade === selected);
    const sampleCache = new Map<number, { rent: string[]; vacancy: string[] }>();
    const sampleIds = (key: number, metric: 'rent' | 'vacancy') => {
      const cached = sampleCache.get(key);
      if (cached) return cached[metric];
      const result = { rent: [] as string[], vacancy: [] as string[] };
      for (const [id, grade] of selectedMembers) {
        const row = byEntityPeriod.get(`${id}:${key}`);
        if (!row) continue;
        const stats = aggregateMarket([{ id, grade, metrics: [row] }], 'quarterly_market');
        if (stats.rentSampleCount > 0) result.rent.push(id);
        if (stats.vacancySampleCount > 0) result.vacancy.push(id);
      }
      sampleCache.set(key, result);
      return result[metric];
    };
    const change = (key: number, offset: number, metric: 'rent' | 'vacancy'): SameSampleChange => {
      const previousIds = new Set(sampleIds(key - offset, metric));
      const ids = sampleIds(key, metric).filter(id => previousIds.has(id));
      if (ids.length < MIN_RESEARCH_MARKET_SAMPLES) return { samples: ids.length, rentPct: null, vacancyPp: null };
      const stats = (period: number) => aggregateMarket(ids.map(id => ({ id, metrics: [byEntityPeriod.get(`${id}:${period}`)!] })), 'quarterly_market');
      const now = stats(key), before = stats(key - offset);
      return { samples: ids.length,
        rentPct: metric === 'rent' && now.rent != null && before.rent != null && before.rent > 0 ? (now.rent / before.rent - 1) * 100 : null,
        vacancyPp: metric === 'vacancy' && now.vacancyPct != null && before.vacancyPct != null ? now.vacancyPct - before.vacancyPct : null };
    };
    return periodKeys.map(key => {
      const year = Math.floor(key / 4), quarter = key % 4 + 1;
      const stats = aggregateMarket(selectedMembers.map(([id, grade]) => ({ id, grade, metrics: byEntityPeriod.has(`${id}:${key}`) ? [byEntityPeriod.get(`${id}:${key}`)!] : [] })), 'quarterly_market');
      const rentIds = sampleIds(key, 'rent'), vacancyIds = sampleIds(key, 'vacancy');
      const changed = (metric: 'rent' | 'vacancy', current: string[]) => {
        const previous = new Set(sampleIds(key - 1, metric));
        return previous.size !== current.length || current.some(id => !previous.has(id));
      };
      const rentDistribution = distributions ? distribution(rentIds.map(id => mapOptionalNumber(byEntityPeriod.get(`${id}:${key}`)?.net_effective_rent))) : undefined;
      const sizeDistribution = distributions ? distribution(selectedMembers.map(([id]) => mapOptionalNumber(byEntityPeriod.get(`${id}:${key}`)?.total_area)).filter(area => Number.isFinite(area) && area > 0)) : undefined;
      return { period: `${year}Q${quarter}`, year, quarter, rent: stats.rent, vacancyPct: stats.vacancyPct,
        rentSamples: stats.rentSampleCount, vacancySamples: stats.vacancySampleCount,
        rentArea: stats.rentSampleArea, vacancyArea: stats.vacancySampleArea,
        stockArea: stats.stockArea, stockSamples: stats.areaSamples,
        rentCoverage: stats.rentCoverage, vacancyCoverage: stats.vacancyCoverage,
        ...(rentDistribution ? { rentDistribution } : {}), ...(sizeDistribution ? { sizeDistribution } : {}),
        source: 'building_metrics', membershipTime: 'current_catalog',
        sampleQuality: { rent: stats.rentSampleCount > 1 ? 'multiple_samples' : stats.rentSampleCount ? 'single_sample' : 'none', vacancy: stats.vacancySampleCount > 1 ? 'multiple_samples' : stats.vacancySampleCount ? 'single_sample' : 'none' },
        observedRent: stats.rentSampleCount > 0, observedVacancy: stats.vacancySampleCount > 0,
        continuousRent: rentIds.length > 0 && sampleIds(key - 1, 'rent').length > 0,
        continuousVacancy: vacancyIds.length > 0 && sampleIds(key - 1, 'vacancy').length > 0,
        sampleChanged: { rent: changed('rent', rentIds), vacancy: changed('vacancy', vacancyIds) },
        sameSampleQoq: { rent: change(key, 1, 'rent'), vacancy: change(key, 1, 'vacancy') },
        sameSampleYoy: { rent: change(key, 4, 'rent'), vacancy: change(key, 4, 'vacancy') },
      };
    });
  };
  return { all: series('all'), a: product === 'office' ? series('a') : [], b: product === 'office' ? series('b') : [] };
}

/** Legacy office period axis and membership do not depend on BP observations. */
export function computeSubmarketTrends(buildings: readonly OfficeRecord[], rows: readonly TrendMetricRow[], count: number | 'available' = 8, distributions = false): SubmarketTrendSeries {
  return computeProductTrends(buildings, rows, count, 'office', distributions);
}

export function computeParkSubmarketTrend(buildings: readonly OfficeRecord[], rows: readonly TrendMetricRow[], count: number | 'available' = 8): SubmarketTrendPoint[] {
  return computeProductTrends(buildings, rows, count, 'park', true).all;
}
