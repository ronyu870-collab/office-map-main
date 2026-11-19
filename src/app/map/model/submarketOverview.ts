import { normalizeMapSubmarket } from './mapDomain';
import { mapOptionalNumber, observedVacantArea } from './vacancyMetrics';

export type OfficeGrade = 'a' | 'b' | 'park' | 'other';
export type MarketMetric = {
  total_area?: unknown;
  vacant_area?: unknown;
  vacancy_rate?: unknown;
  net_effective_rent?: unknown;
  record_year?: unknown;
  record_quarter?: unknown;
};
export type MarketBuilding = {
  id?: string | null;
  name?: string | null;
  submarket?: string | null;
  grade?: string | null;
  location_lng?: number | null;
  location_lat?: number | null;
  metrics?: MarketMetric[] | null;
};
export type SubmarketSummary = {
  name: string;
  officeCount: number;
  gradeACount: number;
  gradeBCount: number;
  parkCount: number;
  rent: number | null;
  vacancyPct: number | null;
  rentSampleCount: number;
  vacancySampleCount: number;
  rentSampleArea: number;
  vacancySampleArea: number;
};

export function officeGrade(grade: unknown): OfficeGrade {
  const value = String(grade ?? '').trim().toUpperCase();
  // BP contains P: industrial parks must never be classified as Grade A.
  if (value.includes('BP')) return 'park';
  if (value.includes('A') || value.includes('P')) return 'a';
  if (value.includes('B')) return 'b';
  return 'other';
}

export function mostRecentMarketMetric(metrics: MarketMetric[] | null | undefined): MarketMetric | null {
  if (!Array.isArray(metrics)) return null;
  let result: MarketMetric | null = null;
  let period = -Infinity;
  for (const metric of metrics) {
    const year = mapOptionalNumber(metric.record_year);
    const quarter = mapOptionalNumber(metric.record_quarter);
    if (!(year > 0) || !(quarter >= 1 && quarter <= 4)) continue;
    const current = year * 4 + quarter;
    if (current > period) { period = current; result = metric; }
  }
  return result;
}

type Accumulator = {
  summary: SubmarketSummary;
  rentSum: number;
  vacantSum: number;
  seen: Set<string>;
};

export function summarizeSubmarkets(buildings: readonly MarketBuilding[]): Map<string, SubmarketSummary> {
  const groups = new Map<string, Accumulator>();
  for (const building of buildings) {
    const name = normalizeMapSubmarket(building.submarket);
    if (!name || name === '其他') continue;
    const id = String(building.id ?? '').trim();
    if (!id) continue;
    let entry = groups.get(name);
    if (!entry) {
      entry = {
        summary: { name, officeCount: 0, gradeACount: 0, gradeBCount: 0,
          parkCount: 0, rent: null, vacancyPct: null, rentSampleCount: 0,
          vacancySampleCount: 0, rentSampleArea: 0, vacancySampleArea: 0 },
        seen: new Set(), rentSum: 0, vacantSum: 0,
      };
      groups.set(name, entry);
    }
    if (entry.seen.has(id)) continue;
    entry.seen.add(id);
    const grade = officeGrade(building.grade);
    if (grade === 'park') { entry.summary.parkCount++; continue; }
    if (grade !== 'a' && grade !== 'b') continue;
    entry.summary.officeCount++;
    if (grade === 'a') entry.summary.gradeACount++;
    else entry.summary.gradeBCount++;

    const metric = mostRecentMarketMetric(building.metrics);
    if (!metric) continue;
    const area = mapOptionalNumber(metric.total_area);
    if (!(area > 0)) continue;
    const rent = mapOptionalNumber(metric.net_effective_rent);
    if (rent > 0) {
      entry.summary.rentSampleCount++;
      entry.summary.rentSampleArea += area;
      entry.rentSum += rent * area;
    }
    const vacant = observedVacantArea(metric);
    if (Number.isFinite(vacant)) {
      entry.summary.vacancySampleCount++;
      entry.summary.vacancySampleArea += area;
      entry.vacantSum += vacant;
    }
  }
  return new Map([...groups].map(([name, entry]) => {
    const { summary } = entry;
    if (summary.rentSampleArea > 0) summary.rent = entry.rentSum / summary.rentSampleArea;
    if (summary.vacancySampleArea > 0) {
      summary.vacancyPct = entry.vacantSum / summary.vacancySampleArea * 100;
    }
    return [name, summary];
  }));
}

export function submarketSummary(buildings: readonly MarketBuilding[], name: string): SubmarketSummary {
  const normalized = normalizeMapSubmarket(name);
  return summarizeSubmarkets(buildings).get(normalized) ?? {
    name: normalized, officeCount: 0, gradeACount: 0, gradeBCount: 0,
    parkCount: 0, rent: null, vacancyPct: null, rentSampleCount: 0,
    vacancySampleCount: 0, rentSampleArea: 0, vacancySampleArea: 0,
  };
}
