import { mapOptionalNumber, observedVacantArea } from './vacancyMetrics';
import { officeGrade } from './submarketOverview';

export type TrendMetricRow = {
  building_id: string;
  record_year: number;
  record_quarter: number;
  total_area?: unknown;
  net_effective_rent?: unknown;
  vacant_area?: unknown;
  vacancy_rate?: unknown;
  is_draft?: boolean | null;
  is_locked?: boolean | null;
  updated_at?: string | null;
};

export type SubmarketTrendPoint = {
  period: string;
  year: number;
  quarter: number;
  rent: number | null;
  vacancyPct: number | null;
  rentSamples: number;
  vacancySamples: number;
  rentArea: number;
  vacancyArea: number;
};

export type SubmarketTrendSeries = Record<'all' | 'a' | 'b', SubmarketTrendPoint[]>;

type OfficeRecord = { id: string; grade?: string | null };

function recentQuarterKeys(last: number, size: number) {
  return Array.from({ length: size }, (_, index) => last - size + index + 1);
}

/** Same-quarter weighted aggregation, never a mixture of each building's latest quarter. */
export function computeSubmarketTrends(
  buildings: readonly OfficeRecord[],
  rows: readonly TrendMetricRow[],
  count = 8,
): SubmarketTrendSeries {
  const empty: SubmarketTrendSeries = { all: [], a: [], b: [] };
  const members = new Map(buildings
    .map(building => [building.id, officeGrade(building.grade)] as const)
    .filter((entry): entry is readonly [string, 'a' | 'b'] => entry[1] === 'a' || entry[1] === 'b'));
  const byEntityPeriod = new Map<string, TrendMetricRow>();
  let last = -Infinity;

  for (const row of rows) {
    if (!members.has(row.building_id) || row.is_draft === true) continue;
    const year = Number(row.record_year);
    const quarter = Number(row.record_quarter);
    if (!Number.isInteger(year) || year < 2000 || !Number.isInteger(quarter) || quarter < 1 || quarter > 4) continue;
    const key = year * 4 + quarter - 1;
    const groupKey = `${row.building_id}:${key}`;
    const previous = byEntityPeriod.get(groupKey);
    // Deterministically prefer locked records and then the last updated version.
    if (previous && (Number(previous.is_locked === true) > Number(row.is_locked === true) ||
      (previous.is_locked === row.is_locked && String(previous.updated_at ?? '') >= String(row.updated_at ?? '')))) continue;
    byEntityPeriod.set(groupKey, row);
    if (key > last) last = key;
  }
  if (!Number.isFinite(last)) return empty;
  const periodKeys = recentQuarterKeys(last, Math.max(1, Math.min(20, Math.floor(count))));

  const series = (selected: 'all' | 'a' | 'b'): SubmarketTrendPoint[] => periodKeys.map(key => {
    const year = Math.floor(key / 4);
    const quarter = (key % 4) + 1;
    let rentSum = 0, rentArea = 0, vacantSum = 0, vacancyArea = 0;
    let rentSamples = 0, vacancySamples = 0;

    for (const [buildingId, grade] of members) {
      if (selected !== 'all' && grade !== selected) continue;
      const row = byEntityPeriod.get(`${buildingId}:${key}`);
      if (!row) continue;
      const area = mapOptionalNumber(row.total_area);
      if (!(area > 0)) continue;
      const rent = mapOptionalNumber(row.net_effective_rent);
      if (rent > 0) { rentSum += rent * area; rentArea += area; rentSamples++; }
      const vacant = observedVacantArea(row);
      if (Number.isFinite(vacant)) {
        vacantSum += vacant;
        vacancyArea += area;
        vacancySamples++;
      }
    }

    return {
      period: `${year}Q${quarter}`, year, quarter,
      rent: rentArea > 0 ? rentSum / rentArea : null,
      vacancyPct: vacancyArea > 0 ? vacantSum / vacancyArea * 100 : null,
      rentSamples, vacancySamples, rentArea, vacancyArea,
    };
  });

  return { all: series('all'), a: series('a'), b: series('b') };
}
