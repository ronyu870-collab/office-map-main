import { createHash } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';
import type { SourceRef } from './contracts';
import type { DataAuthority, VerifiedQueryIdentity } from './serverAuthority';
import { readQuerySnapshots } from './snapshotReader';
import { parseQueryPlan } from './plan';
import { metroSource } from './presentation';
import type { QueryResult, ResultCell } from './result';

type Point = readonly [number, number];
export type MetroScreeningRequest = { radiusMeters: number; stationName?: string; submarkets?: string[]; mapRequested: boolean };
type Station = { id: string; name: string; line: string; center: Point };
const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const digest = z.string().regex(/^[0-9a-f]{64}$/);
const screeningSchema = z.strictObject({
  radiusMeters: z.number().int().min(1).max(10000),
  stationName: z.string().max(35).optional(),
  datasetVersion: digest,
  generatedAt: z.iso.datetime(),
  locatedCount: z.number().int().nonnegative(),
  missingCoordinates: z.number().int().nonnegative(),
  matchedCount: z.number().int().nonnegative(),
  candidates: z.array(z.strictObject({ buildingId: z.uuid(), locationVersion: digest,
    stationId: z.string().min(1).max(100), stationName: z.string().min(1).max(35), stationLine: z.string().min(1).max(80),
    stationCenter: z.tuple([z.number().min(-180).max(180), z.number().min(-90).max(90)]).readonly(),
    meters: z.number().int().nonnegative() })).min(1).max(20),
});
export type MetroScreening = z.infer<typeof screeningSchema>;

const validPoint = (point: Point) => Number.isFinite(point[0]) && Math.abs(point[0]) <= 180
  && Number.isFinite(point[1]) && Math.abs(point[1]) <= 90 && !(point[0] === 0 && point[1] === 0);

function straightLineMeters(first: Point, second: Point): number {
  const rad = Math.PI / 180;
  const lat = (second[1] - first[1]) * rad, lng = (second[0] - first[0]) * rad;
  const arc = Math.sin(lat / 2) ** 2 + Math.cos(first[1] * rad) * Math.cos(second[1] * rad) * Math.sin(lng / 2) ** 2;
  return 6378137 * 2 * Math.asin(Math.sqrt(Math.max(0, Math.min(1, arc))));
}

async function transitCatalog() {
  const { default: data } = await import('@/public/data/beijing_map_data.json');
  const byStationLine = new Map<string, Station>();
  const conflicting = new Set<string>();
  for (const line of data.subways) for (const station of line.stations) {
    if (!station.id || !station.name || !line.name || station.center.length !== 2) continue;
    const center: Point = [station.center[0], station.center[1]];
    if (!validPoint(center)) continue;
    // The map preserves per-line centers at interchange stations.
    const key = `${station.id}/${line.name}`;
    const previous = byStationLine.get(key);
    if (previous && (previous.name !== station.name || straightLineMeters(previous.center, center) > 10)) conflicting.add(key);
    else if (!previous) byStationLine.set(key, { id: station.id, name: station.name, line: line.name, center });
  }
  const stations = [...byStationLine.entries()].filter(([key]) => !conflicting.has(key)).map(([, station]) => station);
  return { stations, generatedAt: z.iso.datetime().parse(data.generatedAt), version: hash([data.generatedAt, stations]) };
}

async function readTrackedCoordinates(client: SupabaseClient, ids: readonly string[], signal: AbortSignal) {
  const locations = new Map<string, Point>();
  // IDs come exclusively from the verified catalog or a sealed archive.
  for (let start = 0; start < ids.length; start += 100) {
    const requested = ids.slice(start, start + 100);
    const { data, error } = await client.from('buildings').select('id,location_lng,location_lat')
      .in('id', requested).eq('is_active', true).eq('tracking_scope', 'tracked').is('merged_into_id', null)
      .or('project_type.neq.future,project_type.is.null').abortSignal(signal);
    signal.throwIfAborted();
    if (error) throw new Error('QUERY_READ_UNAVAILABLE');
    for (const row of data ?? []) {
      if (!requested.includes(row.id)) throw new Error('QUERY_DENIED');
      if (typeof row.location_lng !== 'number' || typeof row.location_lat !== 'number') continue;
      const point: Point = [row.location_lng, row.location_lat];
      if (validPoint(point)) locations.set(row.id, point);
    }
  }
  return locations;
}

export async function screenMetroCandidates(client: SupabaseClient, actor: VerifiedQueryIdentity, authority: DataAuthority,
  request: MetroScreeningRequest, signal: AbortSignal): Promise<MetroScreening | string> {
  const catalog = await transitCatalog();
  const stations = request.stationName ? catalog.stations.filter(station => station.name.replace(/站$/u, '') === request.stationName) : catalog.stations;
  if (!stations.length) return request.stationName ? `现有北京站点目录未找到「${request.stationName}」的可靠坐标。请核对站名。`
    : '现有站点目录缺少可核验坐标，暂时无法初筛。';
  if (request.stationName && new Set(stations.map(station => station.id)).size > 1) return `「${request.stationName}」对应多个站点，暂时无法唯一定位。`;
  const [snapshot] = await readQuerySnapshots(client, actor, authority, parseQueryPlan({ operation: 'list', fields: [], period: null,
    scope: { inventory: 'tracked', ...(request.submarkets?.length ? { submarkets: request.submarkets } : {}) } }), signal);
  const ids = snapshot.rows.map(row => row.id);
  const locations = await readTrackedCoordinates(client, ids, signal);
  const candidates: MetroScreening['candidates'] = [];
  for (const [buildingId, point] of locations) {
    let closest: Station | undefined;
    let distance = Infinity;
    for (const station of stations) {
      const meters = straightLineMeters(point, station.center);
      if (meters < distance || meters === distance && closest && station.id < closest.id) {
        distance = meters;
        closest = station;
      }
    }
    if (closest && distance <= request.radiusMeters) candidates.push({ buildingId, locationVersion: hash(point),
      stationId: closest.id, stationName: closest.name, stationLine: closest.line, stationCenter: closest.center, meters: Math.round(distance) });
  }
  const missingCoordinates = ids.length - locations.size;
  if (!candidates.length) return `在 ${locations.size} 栋有坐标的获权楼宇中，未找到距${request.stationName ? `「${request.stationName}」站` : '目录地铁站'}直线 ${request.radiusMeters} 米以内的楼宇。另有 ${missingCoordinates} 栋缺少有效坐标，实际步行路线待核验。`;
  candidates.sort((a, b) => a.meters - b.meters || a.buildingId.localeCompare(b.buildingId));
  return screeningSchema.parse({ radiusMeters: request.radiusMeters, stationName: request.stationName, datasetVersion: catalog.version,
    generatedAt: catalog.generatedAt, locatedCount: locations.size, missingCoordinates, matchedCount: candidates.length, candidates: candidates.slice(0, 8) });
}

const locationRef = (item: MetroScreening['candidates'][number]) => `metro:building:${item.buildingId}:${item.locationVersion}`;
const stationRef = (screen: MetroScreening, item: MetroScreening['candidates'][number]) => `metro:station:${hash([item.stationId, item.stationLine])}:${screen.datasetVersion}`;
const stationLabel = (name: string) => name.endsWith('站') ? name : name + '站';

export function attachMetroScreening(result: QueryResult, screen: MetroScreening): QueryResult {
  const byId = new Map(result.table.rows.map(row => [row.entityId, row]));
  // A disappearing or newly hidden building cannot be replaced with wider scope.
  if (byId.size !== screen.candidates.length || screen.candidates.some(item => !byId.has(item.buildingId))) throw new Error('QUERY_DENIED');
  const sources = new Map<string, SourceRef>();
  const rows = screen.candidates.map(item => {
    const coordinateId = locationRef(item), transitId = stationRef(screen, item);
    sources.set(coordinateId, { id: coordinateId, table: 'buildings', recordId: item.buildingId, entityId: item.buildingId,
      field: metroSource.locationField, recordVersion: item.locationVersion, rawValue: null, unit: 'coordinate', period: null,
      recordedAt: null, businessAsOf: null, verification: 'database_only', original: null });
    sources.set(transitId, { id: transitId, table: metroSource.table, recordId: item.stationId, entityId: item.stationId,
      field: 'center', recordVersion: screen.datasetVersion,
      rawValue: `${stationLabel(item.stationName)} · ${item.stationLine} · ${item.stationCenter.join(', ')}`, unit: 'coordinate', period: null,
      recordedAt: screen.generatedAt, businessAsOf: null, verification: 'historical', original: null });
    const distance: ResultCell = { kind: 'number', value: { numeric: item.meters, exact: { numerator: String(item.meters), denominator: '1' } },
      sourceIds: [coordinateId, transitId] };
    const station: ResultCell = { kind: 'text', value: stationLabel(item.stationName), sourceIds: [transitId] };
    const row = byId.get(item.buildingId)!;
    return { ...row, cells: { ...row.cells, metroStation: station, metroStraightLine: distance } };
  });
  const basis = `直线距离使用当前楼宇定位与北京地图站点目录（${screen.generatedAt.slice(0, 10)}）。换乘站采用距楼宇最近的线路站点中心，实际步行路线待核验。`;
  return { ...result, dataVersion: hash([result.dataVersion, screen]), sources: [...result.sources, ...sources.values()],
    parameters: { ...result.parameters, metroScreening: screen, metroDataset: metroSource.path }, limitations: [...result.limitations, basis],
    table: { ...result.table, rows, columns: [...result.table.columns, { key: 'metroStation', label: '参考地铁站', unit: null },
      { key: 'metroStraightLine', label: '距站点直线距离', unit: 'm' }] } };
}

export function metroScreeningBindings(parameters: Readonly<Record<string, unknown>>): MetroScreening[] {
  if (parameters.metroScreeningBindings !== undefined)
    return screeningSchema.array().min(1).max(64).parse(parameters.metroScreeningBindings);
  return parameters.metroScreening === undefined ? [] : [screeningSchema.parse(parameters.metroScreening)];
}

/** Private building coordinates stay out of the archive. Re-read the row's location
 * fingerprint and keep the corresponding catalog identity in the existing ACL. */
export async function recheckMetroSources(client: SupabaseClient, signal: AbortSignal, sources: readonly SourceRef[], parameters: Readonly<Record<string, unknown>>) {
  const screenings = metroScreeningBindings(parameters);
  if (!screenings.length) return sources;
  const boundIds = [...new Set(screenings.flatMap(screen => screen.candidates.map(item => item.buildingId)))];
  const points = await readTrackedCoordinates(client, boundIds, signal);
  const formalIds = new Set(sources.filter(source => source.table === 'buildings' && source.field === 'name'
    && source.entityId === source.recordId).map(source => source.entityId));
  const locationIds = new Map<string, string>(), stationIds = new Map<string, string>();
  for (const screen of screenings) for (const item of screen.candidates) {
    const point = points.get(item.buildingId);
    if (!point || hash(point) !== item.locationVersion || !formalIds.has(item.buildingId)) throw new Error('QUERY_DENIED');
    const measured = straightLineMeters(point, item.stationCenter);
    if (!validPoint(item.stationCenter) || measured > screen.radiusMeters || Math.round(measured) !== item.meters) throw new Error('QUERY_DENIED');
    locationIds.set(locationRef(item), item.buildingId); stationIds.set(stationRef(screen, item), item.stationId);
  }
  return sources.filter(source => !(source.table === 'buildings' && source.field === metroSource.locationField
    && locationIds.get(source.id) === source.entityId && source.recordId === source.entityId && source.rawValue === null)
    && !(source.table === metroSource.table && source.field === 'center'
      && stationIds.get(source.id) === source.entityId && source.recordId === source.entityId));
}
