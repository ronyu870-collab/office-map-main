import type { SupabaseClient } from '@supabase/supabase-js';

/** Resolve with the same caller/session; never cache identity across accounts. */
export async function resolveBuildingId(client: SupabaseClient, id: string): Promise<string> {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) return id;
  const { data, error } = await client.rpc('resolve_building_id', { p_id: id });
  if (error) throw new Error(`楼宇身份读取失败：${error.message}`);
  if (typeof data !== 'string' || !data) throw new Error('楼宇身份读取失败，请刷新后重试');
  return data;
}
