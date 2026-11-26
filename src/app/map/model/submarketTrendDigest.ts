import type { SubmarketTrendPoint } from './submarketMarketTrend';
import { quarterKey } from './quarterlyFacts';
const pointKey = (point: SubmarketTrendPoint) => quarterKey({ record_year: point.year, record_quarter: point.quarter });

/** A real adjacent quarter is required, including when a caller supplies a sparse axis. */
export function summarizeSubmarketTrend(series: readonly SubmarketTrendPoint[]) {
  const observations = [...series].sort((a, b) => (pointKey(a) ?? 0) - (pointKey(b) ?? 0));
  const latestRent = observations.findLast(point => point.rent != null) ?? null;
  const latestVacancy = observations.findLast(point => point.vacancyPct != null) ?? null;
  const latest = observations.findLast(point => point.rent != null || point.vacancyPct != null) ?? null;
  const key = latest ? pointKey(latest) : null;
  const previous = key == null ? null : observations.find(point => pointKey(point) === key - 1) ?? null;
  const yearAgo = key == null ? null : observations.find(point => pointKey(point) === key - 4) ?? null;
  const comparable = (a: SubmarketTrendPoint | null, b: SubmarketTrendPoint | null, metric: 'rent' | 'vacancyPct') =>
    a?.[metric] != null && b?.[metric] != null
      && (metric === 'rent' ? a.rentSamples >= 2 && b.rentSamples >= 2 : a.vacancySamples >= 2 && b.vacancySamples >= 2);
  const rentChange = comparable(latest, previous, 'rent') ? latest!.rent! - previous!.rent! : null;
  const vacancyChange = comparable(latest, previous, 'vacancyPct') ? latest!.vacancyPct! - previous!.vacancyPct! : null;
  const rentQoqPct = rentChange != null && previous!.rent! > 0 ? rentChange / previous!.rent! * 100 : null;
  const rentYoyPct = comparable(latest, yearAgo, 'rent') && yearAgo!.rent! > 0 ? (latest!.rent! / yearAgo!.rent! - 1) * 100 : null;
  const vacancyYoyPp = comparable(latest, yearAgo, 'vacancyPct') ? latest!.vacancyPct! - yearAgo!.vacancyPct! : null;
  return { latest, previous, latestRent, latestVacancy, rentChange, vacancyChange, rentQoqPct, rentYoyPct, vacancyYoyPp, hasTrend: latest != null };
}
