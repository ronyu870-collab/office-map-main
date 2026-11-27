import type { SupabaseClient } from '@supabase/supabase-js';
import { loadTrackedBuildings } from './mapInventoryRead';
import { MAP_SUBMARKETS, MAP_SUBMARKETS_SECONDARY } from '@/src/app/map/model/mapDomain';
import { normalizeMapSubmarket, submarketDatabaseNames } from '@/src/app/map/model/marketIdentity';
import { summarizeResearchDemand, type MarketAssetResearchPayload, type ResearchAsset, type ResearchLease, type ResearchSupply } from '@/src/app/map/model/marketAssetAnalytics';
import { formalAssetMetric } from '@/src/app/map/model/marketAssetAnalytics';

const allowed = new Set([...MAP_SUBMARKETS, ...MAP_SUBMARKETS_SECONDARY].filter(name => name !== '其他'));
const PAGE = 500;
const selectAssets = 'id,name,submarket,grade,completion_year,leed_certification,location_lng,location_lat,building_metrics(id,record_year,record_quarter,total_area,net_effective_rent,vacant_area,vacancy_rate,is_locked,is_draft,updated_at,created_at)';

export function parseAssetResearchRequest(params: URLSearchParams) {
  const names = [...new Set(params.getAll('submarket').map(normalizeMapSubmarket))];
  const year = Number(params.get('year')), quarter = Number(params.get('quarter'));
  if (!names.length || names.length > 3 || params.getAll('submarket').length > 3 || names.some(n => !allowed.has(n))
    || !Number.isInteger(year) || year < 1900 || year > 2200 || !Number.isInteger(quarter) || quarter < 1 || quarter > 4) return null;
  return { names, year, quarter, period: year * 4 + quarter - 1 };
}

export async function readMarketAssetResearch(admin: SupabaseClient, input: NonNullable<ReturnType<typeof parseAssetResearchRequest>>, signal: AbortSignal, canReadLive: boolean): Promise<MarketAssetResearchPayload> {
  const { names, year, quarter, period } = input;
  const aliases = [...new Set(names.flatMap(submarketDatabaseNames))];
  const assets: ResearchAsset[] = [];
  for (let offset = 0; ; offset += PAGE) {
    const result = await loadTrackedBuildings(admin, selectAssets, true).in('submarket', aliases)
      .eq('building_metrics.record_year', year).eq('building_metrics.record_quarter', quarter)
      .order('id').range(offset, offset + PAGE - 1).abortSignal(signal);
    if (result.error) throw result.error;
    const rows = result.data ?? [];
    for (const row of rows) {
      const fact = formalAssetMetric(row.building_metrics, period);
      if (!names.includes(normalizeMapSubmarket(row.submarket))) continue;
      assets.push({ id: row.id, name: row.name, submarket: normalizeMapSubmarket(row.submarket), grade: row.grade,
        completion_year: row.completion_year, leed_certification: row.leed_certification,
        location_lng: row.location_lng, location_lat: row.location_lat, metrics: fact ? [fact] : [] });
    }
    if (rows.length < PAGE) break;
  }
  async function supplyRead() {
    const supplies: ResearchSupply[] = [];
    for (let offset = 0; ; offset += PAGE) {
      const result = await admin.from('future_supplies')
        .select('id,name,building_id,submarket,grade,type,status,is_entered_market,launch_year,launch_quarter,total_area')
        .in('submarket', aliases).eq('status', 'future').or('is_entered_market.is.null,is_entered_market.eq.false')
        .order('id').range(offset, offset + PAGE - 1).abortSignal(signal);
      if (result.error) throw result.error;
      supplies.push(...(result.data ?? []));
      if ((result.data?.length ?? 0) < PAGE) return supplies;
    }
  }
  async function demandRead() {
    if (!canReadLive) throw new Error('LEASE_ACCESS_DENIED');
    const ids = new Set(assets.map(asset => asset.id));
    const rows: ResearchLease[] = [];
    // Batch by stable inventory ID; project/alias and unmapped matches are deliberately not counted.
    const all = [...ids];
    for (let start = 0; start < all.length; start += 100) {
      const batch = all.slice(start, start + 100);
      for (let offset = 0; ; offset += PAGE) {
        const result = await admin.from('lease_transactions_read_v1')
          .select('source_record_id,building_id,record_source,quality_status,building_match_scope,transaction_year,transaction_quarter,area_sqm,industry,demand_type')
          .eq('record_source', 'live').eq('quality_status', 'OPERATIONAL').eq('building_match_scope', 'exact')
          .eq('transaction_year', year).in('building_id', batch).order('read_id')
          .range(offset, offset + PAGE - 1).abortSignal(signal);
        if (result.error) throw result.error;
        rows.push(...(result.data ?? []));
        if ((result.data?.length ?? 0) < PAGE) break;
      }
    }
    return Object.fromEntries(names.map(name => [name, summarizeResearchDemand(rows, new Set(assets.filter(asset => asset.submarket === name).map(asset => asset.id)), year)]));
  }
  const [supply, demand] = await Promise.allSettled([supplyRead(), demandRead()]);
  if (signal.aborted) signal.throwIfAborted();
  return { period, assets, supplies: supply.status === 'fulfilled' ? supply.value : null,
    demand: demand.status === 'fulfilled' ? demand.value : {}, demandAvailable: demand.status === 'fulfilled' };
}
