import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  rows: [] as Array<Record<string, unknown>>,
  calls: [] as Array<{ table: string; ids: string[] | null; from: number; to: number }>,
}));

vi.mock('@/src/services/supabaseClient', () => ({
  supabase: {
    from: (table: string) => {
      let ids: string[] | null = null;
      let from = 0, to = 499;
      const query: Record<string, any> = {};
      query.select = () => query;
      query.eq = () => query;
      query.not = () => query;
      query.in = (_column: string, values: string[]) => { ids = values; return query; };
      query.order = () => query;
      query.range = (start: number, end: number) => { from = start; to = end; return query; };
      query.then = (resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) => {
        state.calls.push({ table, ids, from, to });
        const selected = state.rows.filter(row => ids === null || ids.includes(String(row.id))).slice(from, to + 1);
        return Promise.resolve({ data: selected, error: null }).then(resolve, reject);
      };
      return query;
    },
  },
}));

import { getBuildings } from '../apiClient';

beforeEach(() => {
  state.calls = [];
  state.rows = Array.from({ length: 205 }, (_, i) => ({
    id: 'id-' + String(i).padStart(3, '0'),
    name: 'Synthetic ' + i,
    district: 'CBD', submarket: 'CBD', sort_order: i,
    grade: 'A', completion_year: 2020, leed_certification: null,
    location_lng: 116.4, location_lat: 39.9, owner: null,
    property_management: null, leasable_area: 1000,
  }));
});

describe('assigned building reads', () => {
  it('never sends a full-stock query for an empty set of assignments', async () => {
    expect(await getBuildings({ buildingIds: [] })).toEqual([]);
    expect(state.calls).toHaveLength(0);
  });
  it('reads every assigned ID in bounded IN batches and retains mapped building fields', async () => {
    const ids = state.rows.map(row => String(row.id)).reverse();
    const buildings = await getBuildings({ buildingIds: [...ids, ids[0]] });
    expect(buildings).toHaveLength(205);
    expect(buildings[0]).toEqual(expect.objectContaining({ id: 'id-000', name: 'Synthetic 0', total_area: 1000 }));
    expect(state.calls).toHaveLength(3);
    expect(state.calls.every(call => call.table === 'buildings' && call.ids && call.ids.length <= 100)).toBe(true);
    expect(state.calls.flatMap(call => call.ids ?? []).sort()).toEqual(state.rows.map(row => String(row.id)));
  });
  it('keeps the legacy unscoped read available to other workspaces', async () => {
    const buildings = await getBuildings();
    expect(buildings).toHaveLength(205);
    expect(state.calls).toHaveLength(1);
    expect(state.calls[0].ids).toBeNull();
  });
});
