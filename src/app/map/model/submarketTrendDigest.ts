import type { SubmarketTrendPoint } from './submarketMarketTrend';

/**
 * Present the most recent quarter with an actual observation, not merely the
 * final time-axis slot. Never compare non-adjacent quarters as "previous quarter".
 * A real 0% vacancy rate is an observation, not a missing value.
 */
export function summarizeSubmarketTrend(series: readonly SubmarketTrendPoint[]) {
  let index = series.length - 1;
  while (index >= 0 && series[index].rent == null && series[index].vacancyPct == null) index -= 1;
  const latest = index >= 0 ? series[index] : null;
  const previous = index > 0 ? series[index - 1] : null;
  const rentChange = latest?.rent != null && previous?.rent != null
    ? latest.rent - previous.rent : null;
  const vacancyChange = latest?.vacancyPct != null && previous?.vacancyPct != null
    ? latest.vacancyPct - previous.vacancyPct : null;
  return { latest, previous, rentChange, vacancyChange, hasTrend: latest != null };
}
