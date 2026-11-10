import type { SupabaseClient } from '@supabase/supabase-js';

import {
  toFiniteNumber,
  type RecommendationBuildingSource,
} from './recommendationEngine';
import { latestRecommendationMetricPeriod } from './serverContext';

type ActiveBuilding = { id: string; name: string | null; grade: string | null; submarket: string | null; district: string | null };
const BUILDING_PAGE_SIZE = 1_000;

function text(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed || null;
}

/** One complete catalog supplies both the model vocabulary and the ranking input. */
export async function loadActiveRecommendationBuildings(client: SupabaseClient, signal: AbortSignal): Promise<ActiveBuilding[]> {
  const buildings: ActiveBuilding[] = [];
  let total = 0;
  do {
    signal.throwIfAborted();
    const { data, error, count } = await client
      .from('buildings')
      .select('id,name,grade,submarket,district', buildings.length === 0 ? { count: 'exact' } : undefined)
      .eq('is_active', true)
      .eq('tracking_scope', 'tracked')
      .order('name')
      .order('id')
      .range(buildings.length, buildings.length + BUILDING_PAGE_SIZE - 1)
      .abortSignal(signal);
    signal.throwIfAborted();
    if (error || !data || (buildings.length === 0 && count === null)) throw new Error('推荐楼宇目录读取失败');
    if (buildings.length === 0) total = count ?? 0;
    if (!data.length && buildings.length < total) throw new Error('推荐楼宇目录读取不完整');
    buildings.push(...data);
  } while (buildings.length < total);
  return buildings;
}

export async function loadRecommendationEvidence(client: SupabaseClient, signal: AbortSignal) {
  const [metricResult, brochureResult] = await Promise.all([
    client
      .from('building_metrics')
      .select('building_id,record_year,record_quarter,created_at,net_effective_rent,asking_rent,vacancy_rate,management_fee')
      .order('record_year', { ascending: false })
      .order('record_quarter', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(5000)
      .abortSignal(signal),
    client
      .from('building_brochure_data')
      .select('building_id,address,developer,metro_access,standard_floor_area,property_management,leed_certification,well_certification,green_building_standard,completion_date,created_at')
      .order('created_at', { ascending: false })
      .limit(3000)
      .abortSignal(signal),
  ]);

  signal.throwIfAborted();
  const firstError = metricResult.error || brochureResult.error;
  if (firstError) throw new Error(firstError.message || '推荐楼宇数据读取失败');

  return {
    metrics: metricResult.data ?? [],
    brochures: brochureResult.data ?? [],
    latestMetricPeriod: latestRecommendationMetricPeriod(metricResult.data?.[0]),
  };
}

export function buildRecommendationUniverse(
  buildings: ActiveBuilding[],
  evidence: Awaited<ReturnType<typeof loadRecommendationEvidence>>,
): RecommendationBuildingSource[] {
  const latestMetrics = new Map<string, Record<string, unknown>>();
  for (const row of evidence.metrics) {
    const record = row as Record<string, unknown>;
    const buildingId = text(record.building_id);
    if (buildingId && !latestMetrics.has(buildingId)) latestMetrics.set(buildingId, record);
  }

  const latestBrochures = new Map<string, Record<string, unknown>>();
  for (const row of evidence.brochures) {
    const record = row as Record<string, unknown>;
    const buildingId = text(record.building_id);
    if (buildingId && !latestBrochures.has(buildingId)) latestBrochures.set(buildingId, record);
  }

  return buildings.flatMap(row => {
    if (!row.id) return [];
    const metric = latestMetrics.get(row.id) ?? null;
    const brochure = latestBrochures.get(row.id) ?? null;
    const year = toFiniteNumber(metric?.record_year);
    const quarter = toFiniteNumber(metric?.record_quarter);

    return [{
      id: row.id,
      name: row.name?.trim() || '未命名楼宇',
      grade: row.grade?.trim() || '',
      district: row.district?.trim() || '',
      submarket: row.submarket?.trim() || '',
      metricPeriod: year !== null && quarter !== null ? `${year} Q${quarter}` : null,
      metrics: {
        netEffectiveRentMonthly: toFiniteNumber(metric?.net_effective_rent),
        askingRentMonthly: toFiniteNumber(metric?.asking_rent),
        vacancyRate: toFiniteNumber(metric?.vacancy_rate),
        managementFee: toFiniteNumber(metric?.management_fee),
      },
      brochure: brochure ? {
        address: text(brochure.address),
        developer: text(brochure.developer),
        metroAccess: text(brochure.metro_access),
        standardFloorArea: toFiniteNumber(brochure.standard_floor_area),
        propertyManagement: text(brochure.property_management),
        leedCertification: text(brochure.leed_certification),
        wellCertification: text(brochure.well_certification),
        greenBuildingStandard: text(brochure.green_building_standard),
        completionDate: text(brochure.completion_date),
      } : null,
    } satisfies RecommendationBuildingSource];
  });
}
