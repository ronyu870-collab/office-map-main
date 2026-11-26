import type { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { resultViewSchema } from './presentation';
import { resultBuildingRows, type BuildingContext, buildingContextInputSchema, mapResultSelectionSchema } from './buildingCards';

export async function readBuildingContext(client: SupabaseClient, archived: unknown, input: z.infer<typeof buildingContextInputSchema>, signal: AbortSignal): Promise<BuildingContext> {
  const result = resultViewSchema.parse(archived);
  if (input.resultId && input.resultId !== result.resultId) throw new Error('QUERY_DENIED');
  let all = resultBuildingRows(result);
  if(input.mapSelection && !input.buildingId && result.parameters.agentMap) {
    const selection=mapResultSelectionSchema.parse(result.parameters.agentMap);
    const authorized = result.parameters.agentTableView === undefined ? all : resultBuildingRows({ ...result,
      parameters: { ...result.parameters, agentTableView: undefined } });
    if(selection.buildingIds.some(id=>!authorized.some(r=>r.id===id)))throw new Error('QUERY_DENIED');
    all=all.filter(row=>selection.buildingIds.includes(row.id));
  }
  if (input.buildingId && !all.some(row => row.id === input.buildingId)) throw new Error('QUERY_DENIED');
  const selected = input.buildingId ? all.filter(row => row.id === input.buildingId) : all;
  const page = selected.slice(input.offset, input.offset + input.limit), ids = page.map(row => row.id);
  const current = ids.length ? await client.from('buildings').select('id,submarket,grade,location_lng,location_lat')
    .in('id', ids).eq('is_active', true).eq('tracking_scope', 'tracked').is('merged_into_id', null)
    .or('project_type.neq.future,project_type.is.null').abortSignal(signal) : { data: [], error: null };
  if (current.error) throw new Error('QUERY_READ_UNAVAILABLE');
  // Reuse the private photo catalogue/storage service. Only actual stored photographs,
  // not rendering/unknown image types or arbitrary remote URLs, enter AI cards.
  const photos = current.data?.length ? await client.from('building_photos').select('id,building_id,caption,sha256')
    .in('building_id', current.data?.map(row => row.id) ?? []).eq('status', 'ready').not('storage_path', 'is', null)
    .in('photo_kind', ['exterior', 'interior', 'construction']).order('sort_order').order('id').limit(3000).abortSignal(signal) : { data: [], error: null };
  if (photos.error) throw new Error('QUERY_READ_UNAVAILABLE');
  signal.throwIfAborted();
  const byId = new Map(current.data?.map(row => [row.id, row]) ?? []);
  return { status: 'ready', requestId: input.requestId, resultId: result.resultId, metadataReadAt: new Date().toISOString(), total: selected.length,
    offset: input.offset, hasMore: input.offset + page.length < selected.length, buildings: page.map(row => {
      const metadata = byId.get(row.id), photo = photos.data?.find(item => item.building_id === row.id);
      const located = Boolean(metadata && typeof metadata.location_lng === 'number' && Number.isFinite(metadata.location_lng) && Math.abs(metadata.location_lng) <= 180
        && typeof metadata.location_lat === 'number' && Number.isFinite(metadata.location_lat) && Math.abs(metadata.location_lat) <= 90);
      return { id: row.id, name: row.name, submarket: metadata?.submarket ?? null, grade: metadata?.grade ?? null, located,
        unavailableReason: !metadata ? 'not_in_current_map' : !located ? 'missing_coordinates' : null,
        photo: photo ? { id: photo.id, caption: photo.caption, ...(photo.sha256 ? { sha256: photo.sha256 } : {}) } : null };
    }) };
}
