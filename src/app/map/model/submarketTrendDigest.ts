import { MIN_RESEARCH_MARKET_SAMPLES, type SubmarketTrendPoint } from './submarketMarketTrend';
import { quarterKey } from './quarterlyFacts';
export type MarketTrendMetric = 'rent' | 'vacancyPct';
export const marketTrendMetrics = ['rent', 'vacancyPct'] as const;
export const trendValue = (point: SubmarketTrendPoint | null, metric: MarketTrendMetric): number | null => {
  const value = point?.[metric];
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
};
export const trendSamples = (point: SubmarketTrendPoint | null, metric: MarketTrendMetric) =>
  (metric === 'rent' ? point?.rentSamples : point?.vacancySamples) ?? 0;
export const trendCoverage = (point: SubmarketTrendPoint | null, metric: MarketTrendMetric) =>
  (metric === 'rent' ? point?.rentCoverage?.area : point?.vacancyCoverage?.area) ?? null;
export const canCompareMarketSamples = (a: SubmarketTrendPoint | null, b: SubmarketTrendPoint | null, metric: MarketTrendMetric) =>
  trendValue(a, metric) != null && trendValue(b, metric) != null && trendSamples(a, metric) >= MIN_RESEARCH_MARKET_SAMPLES && trendSamples(b, metric) >= MIN_RESEARCH_MARKET_SAMPLES;
export function marketSampleCoverageChanged(a: SubmarketTrendPoint | null, b: SubmarketTrendPoint | null, metric: MarketTrendMetric) {
  const first = trendCoverage(a, metric), last = trendCoverage(b, metric);
  return first != null && last != null && Math.abs(first - last) >= 0.1 - Number.EPSILON;
}
export const pointKey = (point: SubmarketTrendPoint) => quarterKey({ record_year: point.year, record_quarter: point.quarter });

/** A real adjacent quarter is required, including when a caller supplies a sparse axis. */
export function summarizeSubmarketTrend(series: readonly SubmarketTrendPoint[]) {
  const observations = [...series].sort((a, b) => (pointKey(a) ?? 0) - (pointKey(b) ?? 0));
  const latestRent = observations.findLast(point => trendValue(point, 'rent') != null) ?? null;
  const latestVacancy = observations.findLast(point => trendValue(point, 'vacancyPct') != null) ?? null;
  const latest = observations.findLast(point => trendValue(point, 'rent') != null || trendValue(point, 'vacancyPct') != null) ?? null;
  const key = latest ? pointKey(latest) : null;
  const previous = key == null ? null : observations.find(point => pointKey(point) === key - 1) ?? null;
  const yearAgo = key == null ? null : observations.find(point => pointKey(point) === key - 4) ?? null;
  const rentChange = canCompareMarketSamples(latest, previous, 'rent') ? latest!.rent! - previous!.rent! : null;
  const vacancyChange = canCompareMarketSamples(latest, previous, 'vacancyPct') ? latest!.vacancyPct! - previous!.vacancyPct! : null;
  const rentQoqPct = rentChange != null && previous!.rent! > 0 ? rentChange / previous!.rent! * 100 : null;
  const rentYoyPct = canCompareMarketSamples(latest, yearAgo, 'rent') && yearAgo!.rent! > 0 ? (latest!.rent! / yearAgo!.rent! - 1) * 100 : null;
  const vacancyYoyPp = canCompareMarketSamples(latest, yearAgo, 'vacancyPct') ? latest!.vacancyPct! - yearAgo!.vacancyPct! : null;
  return { latest, previous, latestRent, latestVacancy, rentChange, vacancyChange, rentQoqPct, rentYoyPct, vacancyYoyPp, hasTrend: latest != null };
}
