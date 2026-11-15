import { describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { describePlanRead, normalizeSnapshot, readQuerySnapshots } from '../snapshotReader';
import { parseQueryPlan } from '../plan';
import { executeQueryPlan } from '../executePlan';
import { buildListResult, buildRankResult } from '../result';
import type { DataAuthority } from '../serverAuthority';

const id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1';
const version = 'a'.repeat(64);
const authority: DataAuthority = {
  actorId: id, effectiveUserId: id, sessionId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', sessionActive: true,
  policyVersion: 'test', permissionRevision: version, grants: ['query:catalog', 'query:brochure', 'query:quarter'],
  fields: ['height', 'totalArea', 'netEffectiveRent'], allSubmarkets: false, submarkets: ['CBD'], allBuildings: false, buildingIds: [id],
};
const plan = parseQueryPlan({ operation: 'rank', field: 'height', limit: 1, direction: 'desc', period: null, scope: { inventory: 'tracked', submarkets: ['CBD'] } });
function raw() {
  return {
    snapshot_id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', database_snapshot: '1:2:', read_at: '2026-11-13T00:00:00Z',
    expected_count: 1, complete: true, periods: [], fields: ['height'], inventory_time: 'current_catalog', brochure_selection: 'all_unresolved_record_candidates',
    rows: [{ id, name: '合成楼宇', submarket: 'CBD', grade: 'A', is_active: true, tracking_scope: 'tracked', version,
      metrics: [] as { id: string; year: number; quarter: number; version: string; recorded_at: string | null; values: Record<string, string | null> }[],
      brochures: [{ id: 'source-1', version, recorded_at: null as string | null, values: { height: '210.000000000000001' } as Record<string, string | null> }],
    }],
  };
}

describe('complete authorized database snapshot adapter', () => {
  it('keeps exact database text, honest source limits and immutable result context', () => {
    const input = raw();
    const [snapshot] = normalizeSnapshot(input, plan, authority);
    const result = buildRankResult(snapshot, 'height', 1, 'desc');
    expect(result.sources.find(source => source.field === 'building_height')).toMatchObject({ rawValue: '210.000000000000001', original: null, businessAsOf: null, verification: 'database_only' });
    const cell = result.table.rows[0].cells.height;
    expect(cell.kind).toBe('number');
    if (cell.kind === 'number') expect(cell.value.exact).toEqual({ numerator: '210000000000000001', denominator: '1000000000000000' });
    expect(result.limitations.some(text => text.includes('当前目录'))).toBe(true);
    expect(result.limitations.some(text => text.includes('有效版本优先级'))).toBe(true);
    input.rows[0].brochures[0].values.height = '999';
    expect(result.sources.find(source => source.field === 'building_height')?.rawValue).toBe('210.000000000000001');
  });

  it('fails closed on truncated, duplicate, cross-scope or unrequested data', () => {
    const mutations: ((input: ReturnType<typeof raw>) => void)[] = [
      input => { input.expected_count = 2; },
      input => { input.rows.push(input.rows[0]); input.expected_count = 2; },
      input => { input.complete = false; },
      input => { input.rows[0].submarket = '金融街'; },
      input => { input.rows[0].id = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'; },
      input => { input.rows[0].is_active = false; },
      input => { input.rows[0].tracking_scope = 'untracked'; },
      input => { input.rows[0].brochures.push(input.rows[0].brochures[0]); },
      input => { input.rows[0].brochures[0].values.parking = '100'; },
      input => { input.rows[0].metrics.push({ id: 'metric', year: 2026, quarter: 3, version, recorded_at: null, values: { totalArea: '100' } }); },
    ];
    for (const mutate of mutations) { const input = raw(); mutate(input); expect(() => normalizeSnapshot(input, plan, authority)).toThrow(); }
  });

  it('supports name-only catalog queries without requesting numeric fields', () => {
    const catalog = parseQueryPlan({ operation: 'list', fields: [], period: null, scope: { inventory: 'tracked' } });
    const input = raw(); input.fields = []; input.rows[0].brochures = [];
    const result = buildListResult(normalizeSnapshot(input, catalog, authority)[0], []);
    expect(result.table.columns.map(column => column.key)).toEqual(['name']);
    expect(result.sources).toHaveLength(1);
  });

  it('requires a period for quarter filters even on a catalog query', () => {
    const filtered = parseQueryPlan({ operation: 'list', fields: [], period: null, scope: { inventory: 'tracked' }, filter: { field: 'netEffectiveRent', operator: 'gt', value: '100' } });
    expect(() => describePlanRead(filtered)).toThrow('QUERY_PERIOD_REQUIRED');
    expect(describePlanRead(parseQueryPlan({ ...filtered, period: { year: 2026, quarter: 3 } }))).toEqual({ fields: ['netEffectiveRent'], periods: [{ year: 2026, quarter: 3 }] });
  });

  it('preserves missing and conflicting source states without latest-row substitution', () => {
    const input = raw(); input.rows[0].brochures.push({ id: 'source-2', version, recorded_at: '2026-11-13T12:00:00Z', values: { height: '230' } });
    expect(normalizeSnapshot(input, plan, authority)[0].rows[0].facts.height?.state).toBe('conflict');
    input.rows[0].brochures = [];
    expect(normalizeSnapshot(input, plan, authority)[0].rows[0].facts.height?.state).toBe('missing');
  });

  it('reads cross-dimensional multi-metric periods and both dimensions in one authorized snapshot call', async () => {
    const cross = parseQueryPlan({ operation: 'cross_trend', metric: 'rent', metrics: ['rent', 'vacancy'],
      start: { year: 2026, quarter: 2 }, end: { year: 2026, quarter: 3 }, mode: 'paired', scope: { inventory: 'tracked', submarkets: ['CBD'] } });
    const input = { ...raw(), fields: ['netEffectiveRent', 'totalArea', 'vacantArea'],
      periods: [{ year: 2026, quarter: 2 }, { year: 2026, quarter: 3 }] };
    input.rows[0].brochures = [];
    input.rows[0].metrics = [2, 3].map(quarter => ({ id: `quarter-${quarter}`, year: 2026, quarter, version, recorded_at: null,
      values: { netEffectiveRent: String(quarter * 50), totalArea: '10000', vacantArea: String(quarter * 1000) } }));
    const rpc = vi.fn(() => ({ abortSignal: () => Promise.resolve({ data: input, error: null }) }));
    const current: DataAuthority = { ...authority, fields: ['totalArea', 'netEffectiveRent', 'vacantArea'] };
    const identity = { actorId: id, effectiveUserId: id, sessionId: authority.sessionId, expiresAt: Date.now() + 60000 };
    const read = await readQuerySnapshots({ rpc } as unknown as SupabaseClient, identity, current, cross, new AbortController().signal);
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith('ai_query_snapshot_read', expect.objectContaining({ p_fields: input.fields, p_periods: input.periods, p_submarkets: ['CBD'] }));
    const result = executeQueryPlan(cross, read);
    expect(result.table.rows.map(row => row.cells.value)).toMatchObject([{ value: { numeric: 100 } }, { value: { numeric: 150 } }]);
    expect(result.sources.filter(source => ['submarket', 'grade'].includes(source.field))).toHaveLength(2);
    expect(result.table.rows.map(row => row.cells.vacancy_value)).toMatchObject([{ value: { numeric: .2 } }, { value: { numeric: .3 } }]);
  });
});
