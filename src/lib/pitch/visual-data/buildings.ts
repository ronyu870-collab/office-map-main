import { z } from 'zod';
import { parseQueryPlan } from '@/src/lib/intelligence/query/plan';
import { readQuerySnapshots } from '@/src/lib/intelligence/query/snapshotReader';
import { loadDataAuthority, type DataAuthority } from '@/src/lib/intelligence/query/serverAuthority';
import { submarketDatabaseNames } from '@/src/app/map/model/marketIdentity';
import { marketVisualSelectionSchema, visualBuildingIds } from '../contracts/visual-reference';
import type { PitchContext } from '../data/store';
import type { LocationBuilding } from './location';
export { marketVisualSelectionSchema, visualBuildingIds } from '../contracts/visual-reference';

const buildings = z.array(z.object({
  id: z.uuid(), name: z.string().min(1), submarket: z.string().nullable(),
  location_lat: z.number().nullable(), location_lng: z.number().nullable(), city: z.string().nullable().optional(),
}));
export type MarketVisualSelection = z.input<typeof marketVisualSelectionSchema>;
export type VisualBuildingSelection = { buildingIds: string[] } | MarketVisualSelection;

export function marketVisualSelection(input: MarketVisualSelection) {
  const { city, submarkets } = marketVisualSelectionSchema.parse(input);
  const cityName = city && /^(?:北京市?|beijing)$/iu.test(city) ? '北京' : city;
  return { city: cityName, submarkets: submarkets?.length ? [...new Set(submarkets)].sort() : undefined };
}

export async function authorizeVisualBuildings(ctx: PitchContext, selection: VisualBuildingSelection) {
  const market = 'buildingIds' in selection ? null : marketVisualSelection(selection);
  const cities = market?.city === '北京' ? ['北京', '北京市', 'Beijing', 'BEIJING', 'beijing'] : market?.city ? [market.city] : null;
  const scope = 'buildingIds' in selection ? { buildingIds: visualBuildingIds.parse(selection.buildingIds) }
    : market?.submarkets ? { submarkets: [...new Set(market.submarkets.flatMap(submarketDatabaseNames))] } : {};
  const authority = await loadDataAuthority(ctx.client, ctx.identity, ctx.signal);
  if (!authority.grants.includes('export:internal')) throw new Error('QUERY_DENIED');
  const plan = parseQueryPlan({ operation: 'list', scope: { inventory: 'tracked', ...scope }, fields: [], period: null });
  const [snapshot] = await readQuerySnapshots(ctx.client, ctx.identity, authority, plan, ctx.signal);
  const observedOn = z.iso.date().parse(String(snapshot.queryScope?.readAt ?? '').slice(0, 10));
  const permittedIds = new Set(snapshot.rows.map(row => row.id));
  if (scope.buildingIds?.some(id => !permittedIds.has(id))) throw new Error('QUERY_DENIED');
  if (permittedIds.size > 1000) throw new Error('PITCH_VISUAL_SCOPE_TOO_LARGE');
  const catalogRows: LocationBuilding[] = [];
  const ids = [...permittedIds].sort();
  for (let offset = 0; offset < ids.length; offset += 100) {
    let query = ctx.client.from('buildings').select('id,name,submarket,location_lat,location_lng,city')
      .in('id', ids.slice(offset, offset + 100)).eq('is_active', true).eq('tracking_scope', 'tracked')
      .is('merged_into_id', null).or('project_type.neq.future,project_type.is.null');
    if (cities) query = query.in('city', cities);
    const { data, error } = await query.abortSignal(ctx.signal);
    if (error) throw new Error('PITCH_VISUAL_SOURCE_UNAVAILABLE');
    for (const { city, ...row } of buildings.parse(data)) {
      if (!permittedIds.has(row.id) || (!authority.allSubmarkets && !authority.submarkets.includes(row.submarket ?? ''))
          || (scope.submarkets && !scope.submarkets.includes(row.submarket ?? ''))
          || (cities && (!city || !cities.includes(city)))) throw new Error('QUERY_DENIED');
      catalogRows.push(row);
    }
  }
  if (!scope.buildingIds) return { authority, buildings: catalogRows, observedOn };
  const byId = new Map(catalogRows.map(row => [row.id, row]));
  if (scope.buildingIds.some(id => !byId.has(id))) throw new Error('QUERY_DENIED');
  return { authority, buildings: scope.buildingIds.map(id => byId.get(id)!), observedOn };
}

export async function recheckVisualBuildings(ctx: PitchContext, previous: DataAuthority) {
  const current = await loadDataAuthority(ctx.client, ctx.identity, ctx.signal);
  if (current.permissionRevision !== previous.permissionRevision || current.policyVersion !== previous.policyVersion
      || !current.grants.includes('query:catalog') || !current.grants.includes('export:internal')) throw new Error('QUERY_DENIED');
}
