import type { SupabaseClient } from '@supabase/supabase-js';
import { loadTrackedBuildings } from './mapInventoryRead';
import { MAP_SUBMARKETS, MAP_SUBMARKETS_SECONDARY } from '@/src/app/map/model/mapDomain';
import { normalizeMapSubmarket, submarketDatabaseNames } from '@/src/app/map/model/marketIdentity';
import { summarizeResearchDemand, type MarketAssetResearchPayload, type ResearchAsset, type ResearchLease, type ResearchSupply } from '@/src/app/map/model/marketAssetAnalytics';
import { formalAssetMetric, type ResearchMarketContext } from '@/src/app/map/model/marketAssetAnalytics';
import type { MarketMetric } from '@/src/app/map/model/marketStatistics';
import { readSubmarketProfileRow } from '@/src/app/map/model/submarketProfile';
import { visibleSubmarketProfile } from '@/src/app/map/model/submarketPublication';
import { buildResearchPresentation } from '@/src/app/map/model/submarketResearchPresentation';
import { classifyResearchMarket } from '@/src/app/map/model/submarketProductResearch';

type AssetInventoryRow = Omit<ResearchAsset, 'metrics'> & { building_metrics?: MarketMetric[] | null };

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
    if (offset >= 20_000) throw new Error('MARKET_RESEARCH_TOO_LARGE');
    const result = await loadTrackedBuildings(admin, selectAssets, true).in('submarket', aliases)
      .eq('building_metrics.record_year', year).eq('building_metrics.record_quarter', quarter)
      .order('id').range(offset, offset + PAGE - 1).abortSignal(signal);
    if (result.error) throw result.error;
    // The shared inventory helper accepts a dynamic select string, so PostgREST cannot infer its shape.
    const rows = (result.data ?? []) as unknown as AssetInventoryRow[];
    for (const row of rows) {
      if (typeof row.id !== 'string' || !row.id || typeof row.name !== 'string') continue;
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
      if (offset >= 20_000) throw new Error('MARKET_SUPPLY_TOO_LARGE');
      const result = await admin.from('future_supplies')
        .select('id,name,building_id,submarket,grade,type,status,is_entered_market,launch_year,launch_quarter,total_area')
        .in('submarket', aliases).eq('status', 'future')
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
        if (offset >= 20_000) throw new Error('MARKET_DEMAND_TOO_LARGE');
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
  async function contextRead() {
    const result = await admin.from('map_submarket_profiles')
      .select('*').in('submarket', names).eq('is_published', true).abortSignal(signal);
    if (result.error) throw result.error;
    const contexts: Record<string, ResearchMarketContext> = {};
    for (const row of result.data ?? []) {
      const name = normalizeMapSubmarket(row.submarket);
      if (!names.includes(name)) continue;
      const profile = visibleSubmarketProfile(readSubmarketProfileRow(row, name), row.is_published === true);
      if (!profile.research) continue;
      const members = assets.filter(asset => asset.submarket === name);
      const validIds = new Set(members.map(asset => asset.id));
      const presentation = buildResearchPresentation(profile.research, classifyResearchMarket(name, members).type);
      contexts[name] = { positioning: presentation.positioning,
        projects: presentation.projects.filter(project => validIds.has(project.buildingId))
          .map(({ buildingId, role, reason }) => ({ buildingId, role, reason })) };
    }
    return contexts;
  }
  const [supply, demand, context] = await Promise.allSettled([supplyRead(), demandRead(), contextRead()]);
  if (signal.aborted) signal.throwIfAborted();
  return { period, assets, supplies: supply.status === 'fulfilled' ? supply.value : null,
    demand: demand.status === 'fulfilled' ? demand.value : {}, demandAvailable: demand.status === 'fulfilled', contexts: context.status === 'fulfilled' ? context.value : {} };
}
