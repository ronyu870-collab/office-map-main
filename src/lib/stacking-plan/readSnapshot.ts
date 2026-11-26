import type { SupabaseClient } from '@supabase/supabase-js';

/** Shared read projection. Call only after checking the existing real-admin boundary. */
export async function readStackingSnapshot(client: SupabaseClient, id: string, signal: AbortSignal) {
  const [towerResult, sourceResult] = await Promise.all([
    client.from('stacking_plan_towers').select('id,building_id,code,display_name').eq('building_id', id).order('code').abortSignal(signal),
    client.from('stacking_plan_sources').select('id,building_id,title,source_as_of,as_of_kind,review_state,source_note,evidence_storage_path,evidence_filename,evidence_mime,evidence_size_bytes,evidence_sha256,evidence_uploaded_at').eq('building_id', id).abortSignal(signal),
  ]);
  // Preview may run before the additive production evidence migration. Keep
  // existing source snapshots readable without claiming the original is archived.
  let sources = sourceResult.data ?? [];
  let sourceError = sourceResult.error;
  let evidenceStorageReady = true;
  if (sourceError?.code === '42703') {
    evidenceStorageReady = false;
    const legacy = await client.from('stacking_plan_sources')
      .select('id,building_id,title,source_as_of,as_of_kind,review_state,source_note').eq('building_id', id).abortSignal(signal);
    sourceError = legacy.error;
    sources = (legacy.data ?? []).map(item => ({
      ...item, evidence_storage_path: null, evidence_filename: null,
      evidence_mime: null, evidence_size_bytes: null, evidence_sha256: null,
      evidence_uploaded_at: null,
    }));
  }
  if (towerResult.error || sourceError) throw towerResult.error ?? sourceError;
  const towers = towerResult.data ?? [];
  let floors: Record<string, unknown>[] = [];
  let spaces: Record<string, unknown>[] = [];
  if (towers.length) {
    const floorResult = await client.from('stacking_plan_floors')
      .select('id,tower_id,floor_code,level_order,floor_area_sqm,zone,use_type,source_id')
      .in('tower_id', towers.map(t => t.id)).order('level_order', { ascending: false }).limit(200).abortSignal(signal);
    if (floorResult.error) throw floorResult.error;
    floors = floorResult.data ?? [];
    if (floors.length) {
      const spaceResult = await client.from('stacking_plan_spaces')
        .select('id,floor_id,unit_code,occupancy_status,tenant_name,area_sqm,lease_steps,notes,verification_status,source_id,revision')
        .in('floor_id', floors.map(f => f.id as string)).order('unit_code').limit(1000).abortSignal(signal);
      if (spaceResult.error) throw spaceResult.error;
      spaces = spaceResult.data ?? [];
    }
  }
  return { towers, floors, spaces, sources, evidence_storage_ready: evidenceStorageReady, basis: 'source_snapshot_unverified' as const };
}
