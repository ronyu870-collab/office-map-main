import type { SupabaseClient } from '@supabase/supabase-js';
import { BUILDING_PHOTO_TABLE, photoSummaries, type BuildingPhotoSummary } from './model';

/** Paginate instead of silently losing photographs after the Data API row cap. */
export async function readBuildingPhotoCatalog(
  admin: SupabaseClient,
  buildingIds?: readonly string[],
): Promise<Map<string, BuildingPhotoSummary[]>> {
  const catalog = new Map<string, BuildingPhotoSummary[]>();
  if (buildingIds?.length === 0) return catalog;
  const pageSize = 1000;
  for (let offset = 0; ; offset += pageSize) {
    let query = admin.from(BUILDING_PHOTO_TABLE)
      .select('id,building_id,caption,buildings!inner(id)')
      .eq('status', 'ready')
      .eq('buildings.is_active', true).eq('buildings.tracking_scope', 'tracked');
    if (buildingIds) query = query.in('building_id', [...buildingIds]);
    const { data, error } = await query
      .order('building_id').order('sort_order').order('id')
      .range(offset, offset + pageSize - 1);
    if (error) throw error;
    for (const row of data ?? []) {
      const summary = photoSummaries([row])[0];
      if (!summary || typeof row.building_id !== 'string') continue;
      const photos = catalog.get(row.building_id) ?? [];
      photos.push(summary);
      catalog.set(row.building_id, photos);
    }
    if ((data?.length ?? 0) < pageSize) return catalog;
  }
}
