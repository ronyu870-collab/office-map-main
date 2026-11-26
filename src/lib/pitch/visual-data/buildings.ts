import { z } from 'zod';
import { parseQueryPlan } from '@/src/lib/intelligence/query/plan';
import { readQuerySnapshots } from '@/src/lib/intelligence/query/snapshotReader';
import { loadDataAuthority, type DataAuthority } from '@/src/lib/intelligence/query/serverAuthority';
import { submarketDatabaseNames } from '@/src/app/map/model/marketIdentity';
import type { PitchContext } from '../data/store';
import type { LocationBuilding } from './location';

export const visualBuildingIds = z.array(z.uuid()).min(1).max(20).refine(ids => new Set(ids).size === ids.length);
const marketNames = z.array(z.string().trim().min(1).max(80)).min(1).max(8);
const buildings = z.array(z.object({
  id: z.uuid(), name: z.string().min(1), submarket: z.string().nullable(),
  location_lat: z.number().nullable(), location_lng: z.number().nullable(),
}));
export type VisualBuildingSelection = { buildingIds: string[] } | { submarkets: string[] };

export async function authorizeVisualBuildings(ctx: PitchContext, selection: VisualBuildingSelection) {
  const scope = 'buildingIds' in selection ? { buildingIds: visualBuildingIds.parse(selection.buildingIds) }
    : { submarkets: [...new Set(marketNames.parse(selection.submarkets).flatMap(submarketDatabaseNames))] };
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
    const { data, error } = await ctx.client.from('buildings').select('id,name,submarket,location_lat,location_lng')
      .in('id', ids.slice(offset, offset + 100)).eq('is_active', true).eq('tracking_scope', 'tracked')
      .is('merged_into_id', null).or('project_type.neq.future,project_type.is.null').abortSignal(ctx.signal);
    if (error) throw new Error('PITCH_VISUAL_SOURCE_UNAVAILABLE');
    for (const row of buildings.parse(data)) {
      if (!permittedIds.has(row.id) || (!authority.allSubmarkets && !authority.submarkets.includes(row.submarket ?? ''))
          || (scope.submarkets && !scope.submarkets.includes(row.submarket ?? ''))) throw new Error('QUERY_DENIED');
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
