import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  rows: [] as Array<Record<string, unknown>>,
  calls: [] as Array<{ table: string; ids: string[] | null; rangeCalled: boolean }>,
  failId: '',
}));

vi.mock('@/src/services/supabaseClient', () => ({
  supabase: {
    from: (table: string) => {
      let ids: string[] | null = null;
      let rangeCalled = false;
      const query: Record<string, any> = {};
      query.select = () => query;
      query.eq = () => query;
      query.in = (_field: string, values: string[]) => { ids = values; return query; };
      query.order = () => query;
      query.range = () => { rangeCalled = true; return query; };
      query.then = (resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) => {
        state.calls.push({ table, ids, rangeCalled });
        const failed = ids?.includes(state.failId);
        const result = failed
          ? { data: null, error: new Error('synthetic missing batch') }
          : { data: state.rows.filter(row => ids?.includes(String(row.id))), error: null };
        return Promise.resolve(result).then(resolve, reject);
      };
      return query;
    },
  },
}));

import { readAssignedBuildings } from './readAssignedBuildings';

beforeEach(() => {
  state.calls = [];
  state.failId = '';
  state.rows = Array.from({ length: 205 }, (_, index) => ({
    id: 'id-' + String(index).padStart(3, '0'),
    name: 'Synthetic Tower ' + index,
    district: 'CBD',
    submarket: 'CBD',
    grade: 'A',
    completion_year: 2020,
    sort_order: index,
    location_lng: 116.4,
    location_lat: 39.9,
    owner: null,
    property_management: null,
    leasable_area: index === 0 ? 0 : index * 100,
  }));
});

describe('quarterly assigned-building retrieval', () => {
  it('does not request the entire active inventory for empty assignments', async () => {
    expect(await readAssignedBuildings([])).toEqual([]);
    expect(state.calls).toHaveLength(0);
  });
  it('returns all assigned buildings with bounded, unique ID batches and preserves zero', async () => {
    const ids = state.rows.map(row => String(row.id)).reverse();
    const buildings = await readAssignedBuildings([...ids, ids[0]]);
    expect(buildings).toHaveLength(205);
    expect(buildings[0]).toEqual(expect.objectContaining({ id: 'id-000', total_area: 0 }));
    expect(state.calls).toHaveLength(3);
    expect(state.calls.every(call => call.table === 'buildings' && call.ids && call.ids.length <= 100)).toBe(true);
    expect(state.calls.flatMap(call => call.ids ?? []).sort()).toEqual(ids.sort());
    expect(state.calls.every(call => call.rangeCalled === false)).toBe(true);
  });
  it('never reports partial records when a later batch fails', async () => {
    state.failId = 'id-150';
    const ids = state.rows.map(row => String(row.id));
    await expect(readAssignedBuildings(ids)).rejects.toThrow('synthetic missing batch');
  });
});
