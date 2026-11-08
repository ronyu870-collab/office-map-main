import { supabase } from '@/src/services/supabaseClient';
import type { BuildingRow } from '@/src/services/apiClient';

const SELECT = 'id,name,district,submarket,completion_year,grade,leed_certification,location_lng,location_lat,owner,property_management,sort_order,leasable_area';

/** Read only an authorized user's assigned tracked buildings, retaining full reads on error. */
export async function readAssignedBuildings(assignedIds: readonly string[]): Promise<BuildingRow[]> {
  const ids = [...new Set(assignedIds)].sort();
  if (ids.length === 0) return [];

  const batches = Array.from({ length: Math.ceil(ids.length / 100) }, (_, index) =>
    ids.slice(index * 100, (index + 1) * 100),
  );
  // Each batch contains at most 100 unique primary keys, below the Data API
  // row cap. A single bounded read avoids the empty-page round trip.
  const pages = await Promise.all(batches.map(async batch => {
    const { data, error } = await supabase.from('buildings').select(SELECT)
      .eq('is_active', true).eq('tracking_scope', 'tracked')
      .in('id', batch).order('id');
    if (error) throw error;
    if (!Array.isArray(data)) throw new Error('楼宇数据返回格式异常，请重新读取。');
    return data;
  }));
  return pages.flat().map((row: any) => ({
    id: row.id,
    name: row.name,
    district: row.district,
    submarket: row.submarket,
    sort_order: row.sort_order ?? 0,
    built_year: row.completion_year?.toString() || null,
    grade: row.grade,
    leed: row.leed_certification,
    lng: row.location_lng,
    lat: row.location_lat,
    owner: row.owner,
    landlord: row.owner,
    property_management: row.property_management,
    total_area: row.leasable_area ?? null,
    owner_user: null,
    net_effective_rent: null,
    vacancy_rate: null,
    vacancy_area: null,
  })) as BuildingRow[];
}
