import type { SupabaseClient } from '@supabase/supabase-js';
type Row = Record<string, any>;

/** Shared inventory query; publication filters must precede the per-building limit. */
export function loadTrackedBuildings(
  admin: SupabaseClient,
  selectClause: string,
  latestMetricsOnly: boolean,
) {
  let query = admin
    .from('buildings')
    .select(selectClause)
    .eq('is_active', true)
    .eq('tracking_scope', 'tracked')
    .or('project_type.neq.future,project_type.is.null');

  if (selectClause.includes('building_metrics')) {
    query = query.eq('building_metrics.is_locked', true)
      .or('is_draft.is.null,is_draft.eq.false', { referencedTable: 'building_metrics' });
  }

  if (latestMetricsOnly) {
    query = query
      .order('record_year', { referencedTable: 'building_metrics', ascending: false })
      .order('record_quarter', { referencedTable: 'building_metrics', ascending: false })
      .order('updated_at', { referencedTable: 'building_metrics', ascending: false, nullsFirst: false })
      .order('created_at', { referencedTable: 'building_metrics', ascending: false, nullsFirst: false })
      .order('id', { referencedTable: 'building_metrics', ascending: false })
      .limit(1, { referencedTable: 'building_metrics' });
  }

  return query;
}

export async function loadMapInventory(admin: SupabaseClient, selectClause: string, latestOnly: boolean) {
  const rows: Row[] = [];
  for (let offset = 0; offset < 20_000; offset += 1000) {
    const result = await loadTrackedBuildings(admin, selectClause, latestOnly)
      .order('id').range(offset, offset + 999);
    if (result.error) return result;
    rows.push(...(result.data ?? []));
    if ((result.data?.length ?? 0) < 1000) return { data: rows, error: null };
  }
  throw new Error('MAP_INVENTORY_TOO_LARGE');
}
