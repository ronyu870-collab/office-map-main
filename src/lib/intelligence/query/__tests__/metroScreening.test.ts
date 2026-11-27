import { randomUUID } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it, vi } from 'vitest';
import map from '@/public/data/beijing_map_data.json';
import { attachMetroScreening, recheckMetroSources, screenMetroCandidates } from '../metroScreening';
import type { DataAuthority, VerifiedQueryIdentity } from '../serverAuthority';
import { buildListResult } from '../result';
import { resultViewSchema } from '../presentation';
import { sanitizeAuditContent } from '../auditStore';
import { fixture, nameSource } from './fixtures';

const read = vi.hoisted(() => vi.fn());
vi.mock('../snapshotReader', () => ({ readQuerySnapshots: read }));

const actor = {} as VerifiedQueryIdentity;
const authority = {} as DataAuthority;

describe('metro catalog distance screening', () => {
  it('uses both genuine line centers of an interchange, retains explicit zero, and rechecks archived coordinate fingerprints', async () => {
    const firstLine = map.subways.find(line => line.stations.some(station => station.name === '国贸'))!;
    const firstStation = firstLine.stations.find(station => station.name === '国贸')!;
    const otherLine = map.subways.find(line => line !== firstLine && line.stations.some(station => station.id === firstStation.id))!;
    const otherStation = otherLine.stations.find(station => station.id === firstStation.id)!;
    expect(otherStation.center).not.toEqual(firstStation.center);
    const ids = [randomUUID(), randomUUID(), randomUUID(), randomUUID()];
    const rows = [
      { id: ids[0], location_lng: firstStation.center[0], location_lat: firstStation.center[1] },
      { id: ids[1], location_lng: otherStation.center[0], location_lat: otherStation.center[1] + .001 },
      { id: ids[2], location_lng: firstStation.center[0], location_lat: firstStation.center[1] + .03 },
      { id: ids[3], location_lng: null, location_lat: null },
    ];
    const snapshot = { ...fixture(), period: null, expectedCount: ids.length,
      rows: ids.map((id, index) => ({ id, name: `合成楼宇${index}`, nameSource: nameSource(id, `合成楼宇${index}`), facts: {} })) };
    read.mockResolvedValue([snapshot]);
    const client = { from: vi.fn(() => {
      let selected: string[];
      const scope = { select: () => scope, in: (_column: string, values: string[]) => { selected = values; return scope; },
        eq: () => scope, is: () => scope, or: () => scope,
        abortSignal: async () => ({ data: rows.filter(row => selected.includes(row.id)), error: null }) };
      return scope;
    }) } as unknown as SupabaseClient;
    const signal = new AbortController().signal;
    const screen = await screenMetroCandidates(client, actor, authority, { radiusMeters: 800, stationName: '国贸', mapRequested: true }, signal);
    if (typeof screen === 'string') throw new Error(screen);
    expect(read).toHaveBeenCalledWith(client, actor, authority, expect.objectContaining({ scope: { inventory: 'tracked' } }), signal);
    expect(screen).toMatchObject({ locatedCount: 3, missingCoordinates: 1, matchedCount: 2, candidates: [
      { buildingId: ids[0], stationLine: firstLine.name, meters: 0 }, { buildingId: ids[1], stationLine: otherLine.name, meters: 111 },
    ] });
    const result = attachMetroScreening(buildListResult({ ...snapshot, rows: snapshot.rows.slice(0, 2).reverse(), expectedCount: 2 }, []), screen);
    expect(resultViewSchema.safeParse(result).success).toBe(true);
    expect(result.table.rows.map(row => row.entityId)).toEqual(ids.slice(0, 2));
    expect(result.sources.filter(source => source.field === 'location_lng / location_lat').map(source => source.rawValue)).toEqual([null, null]);
    const nearest = await screenMetroCandidates(client, actor, authority, { radiusMeters: 800, mapRequested: false }, signal);
    if (typeof nearest === 'string') throw new Error(nearest);
    expect(Object.hasOwn(nearest, 'stationName')).toBe(false);
    expect(() => sanitizeAuditContent(nearest)).not.toThrow();
    await expect(recheckMetroSources(client, signal, result.sources, result.parameters)).resolves.toEqual(result.sources.slice(0, 2));
    rows[1].location_lat! += .002;
    await expect(recheckMetroSources(client, signal, result.sources, result.parameters)).rejects.toThrow('QUERY_DENIED');
  });
});
