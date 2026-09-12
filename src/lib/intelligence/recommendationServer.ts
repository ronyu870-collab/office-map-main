import type { SupabaseClient } from '@supabase/supabase-js';

import {
  toFiniteNumber,
  type RecommendationBuildingSource,
} from './recommendationEngine';

function text(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed || null;
}

export async function loadRecommendationUniverse(client: SupabaseClient): Promise<RecommendationBuildingSource[]> {
  const [buildingResult, metricResult, brochureResult] = await Promise.all([
    client
      .from('buildings')
      .select('id,name,grade,submarket,district')
      .eq('is_active', true)
      .order('name')
      .limit(3000),
    client
      .from('building_metrics')
      .select('building_id,record_year,record_quarter,created_at,net_effective_rent,asking_rent,vacancy_rate,management_fee')
      .order('record_year', { ascending: false })
      .order('record_quarter', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(5000),
    client
      .from('building_brochure_data')
      .select('building_id,address,developer,metro_access,standard_floor_area,property_management,leed_certification,well_certification,green_building_standard,completion_date,created_at')
      .order('created_at', { ascending: false })
      .limit(3000),
  ]);

  const firstError = buildingResult.error || metricResult.error || brochureResult.error;
  if (firstError) throw new Error(firstError.message || '推荐楼宇数据读取失败');

  const latestMetrics = new Map<string, Record<string, unknown>>();
  for (const row of metricResult.data || []) {
    const record = row as Record<string, unknown>;
    const buildingId = text(record.building_id);
    if (buildingId && !latestMetrics.has(buildingId)) latestMetrics.set(buildingId, record);
  }

  const latestBrochures = new Map<string, Record<string, unknown>>();
  for (const row of brochureResult.data || []) {
    const record = row as Record<string, unknown>;
    const buildingId = text(record.building_id);
    if (buildingId && !latestBrochures.has(buildingId)) latestBrochures.set(buildingId, record);
  }

  return (buildingResult.data || []).flatMap(row => {
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
