import type { BuildingWithMetrics } from '@/src/types';
import { getLatestMetric } from './filterBuildings';

export interface BuildingContribution {
  id: string;
  name: string;
  submarket: string;
  district: string;
  grade: string;
  totalArea: number | null;
  vacantArea: number | null;
  netEffectiveRent: number | null;
  leedCertification: string;
  metricYear: number | null;
  metricQuarter: number | null;
  rentContribution: number | null;
  excludedFromRent: boolean;
  excludedFromVacancy: boolean;
  excludeReason: string | null;
}

export interface WeightedRentBreakdown {
  formula: string;
  contributions: BuildingContribution[];
  numerator: number;
  denominator: number;
  result: number | null;
  excludedCount: number;
}

export interface VacancyRateBreakdown {
  formula: string;
  contributions: BuildingContribution[];
  numerator: number;
  denominator: number;
  result: number | null;
  excludedCount: number;
}

export interface SubmarketBreakdown {
  submarket: string;
  buildingCount: number;
  avgRent: number | null;
  vacancyRate: number | null;
  totalArea: number;
  vacantArea: number;
  rentWeightSum: number;
  rentWeightAreaSum: number;
}

export interface DebugStatsResult {
  weightedRent: WeightedRentBreakdown;
  vacancyRate: VacancyRateBreakdown;
  submarkets: SubmarketBreakdown[];
  projectCount: number;
  leedCount: number;
  leedBuildings: BuildingContribution[];
}

export function computeDebugStats(buildings: BuildingWithMetrics[]): DebugStatsResult {
  const contributions: BuildingContribution[] = [];
  const submarketMap = new Map<string, SubmarketBreakdown>();

  let rentNumerator = 0;
  let rentDenominator = 0;
  let vacancyNumerator = 0;
  let vacancyDenominator = 0;
  let rentExcluded = 0;
  let vacancyExcluded = 0;
  let leedCount = 0;
  const leedBuildings: BuildingContribution[] = [];

  const isLeed = (cert: string) => cert && cert.trim() !== '' && cert !== 'NULL';

  for (const b of buildings) {
    const latest = getLatestMetric(b.metrics);
    const area = latest ? Number(latest.total_area) : NaN;
    const rent = latest ? Number(latest.net_effective_rent) : NaN;
    const vacArea = latest ? Number(latest.vacant_area) : NaN;

    let excludedFromRent = false;
    let excludedFromVacancy = false;
    let excludeReason: string | null = null;

    if (!latest) {
      excludedFromRent = true;
      excludedFromVacancy = true;
      excludeReason = '无季度数据';
    } else {
      const validArea = Number.isFinite(area) && area > 0;
      const validRent = Number.isFinite(rent) && rent > 0;

      if (!validArea) {
        excludedFromRent = true;
        excludedFromVacancy = true;
        excludeReason = '面积无效';
      } else if (!validRent) {
        excludedFromRent = true;
        excludeReason = '租金无效';
      }
    }

    const rentContrib = !excludedFromRent && Number.isFinite(rent) && Number.isFinite(area) ? rent * area : null;

    const c: BuildingContribution = {
      id: b.id,
      name: b.name,
      submarket: b.submarket,
      district: b.district,
      grade: b.grade,
      totalArea: Number.isFinite(area) ? area : null,
      vacantArea: Number.isFinite(vacArea) ? vacArea : null,
      netEffectiveRent: Number.isFinite(rent) ? rent : null,
      leedCertification: b.leed_certification || '',
      metricYear: latest?.record_year ?? null,
      metricQuarter: latest?.record_quarter ?? null,
      rentContribution: rentContrib,
      excludedFromRent,
      excludedFromVacancy,
      excludeReason,
    };
    contributions.push(c);

    // Rent weighted average
    if (!excludedFromRent) {
      rentNumerator += rent * area;
      rentDenominator += area;
    } else {
      rentExcluded++;
    }

    // Vacancy rate
    if (!excludedFromVacancy) {
      vacancyDenominator += area;
      vacancyNumerator += Number.isFinite(vacArea) ? vacArea : 0;
    } else {
      vacancyExcluded++;
    }

    // LEED
    if (isLeed(b.leed_certification)) {
      leedCount++;
      leedBuildings.push(c);
    }

    // Submarket aggregation
    const sub = b.submarket?.trim() || '未分类';
    if (!submarketMap.has(sub)) {
      submarketMap.set(sub, {
        submarket: sub,
        buildingCount: 0,
        avgRent: null,
        vacancyRate: null,
        totalArea: 0,
        vacantArea: 0,
        rentWeightSum: 0,
        rentWeightAreaSum: 0,
      });
    }
    const agg = submarketMap.get(sub)!;
    agg.buildingCount++;
    if (!excludedFromVacancy) {
      agg.totalArea += area;
      agg.vacantArea += Number.isFinite(vacArea) ? vacArea : 0;
    }
    if (!excludedFromRent) {
      agg.rentWeightAreaSum += area;
      agg.rentWeightSum += rent * area;
    }
  }

  // Finalize submarket stats
  const submarkets = Array.from(submarketMap.values()).map(s => ({
    ...s,
    avgRent: s.rentWeightAreaSum > 0 ? s.rentWeightSum / s.rentWeightAreaSum : null,
    vacancyRate: s.totalArea > 0 ? s.vacantArea / s.totalArea : null,
  }));

  const avgRent = rentDenominator > 0 ? rentNumerator / rentDenominator : null;
  const vacancyRate = vacancyDenominator > 0 ? vacancyNumerator / vacancyDenominator : null;

  return {
    weightedRent: {
      formula: '加权平均租金 = Σ(净有效租金 × 总面积) / Σ(总面积)',
      contributions,
      numerator: rentNumerator,
      denominator: rentDenominator,
      result: avgRent,
      excludedCount: rentExcluded,
    },
    vacancyRate: {
      formula: '空置率 = Σ(空置面积) / Σ(总面积)',
      contributions,
      numerator: vacancyNumerator,
      denominator: vacancyDenominator,
      result: vacancyRate,
      excludedCount: vacancyExcluded,
    },
    submarkets,
    projectCount: buildings.length,
    leedCount,
    leedBuildings,
  };
}
