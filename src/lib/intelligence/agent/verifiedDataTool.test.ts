import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DataAuthority } from '../query/serverAuthority';
import { fixture, nameSource } from '../query/__tests__/fixtures';
import { describePlanRead } from '../query/snapshotReader';
import { parseQueryPlan, type QueryPlan } from '../query/plan';
import { executeStructuredDataTool, type VerifiedToolEnvironment } from './verifiedDataTool';
import { researchPlan } from '../research/protocol';

const mocks = vi.hoisted(() => ({ authority: vi.fn(), snapshots: vi.fn() }));
vi.mock('../query/serverAuthority', async original => ({
  ...(await original<typeof import('../query/serverAuthority')>()), loadDataAuthority: mocks.authority,
}));
vi.mock('../query/snapshotReader', async original => ({
  ...(await original<typeof import('../query/snapshotReader')>()), readQuerySnapshots: mocks.snapshots,
}));
const authority: DataAuthority = {
  actorId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', effectiveUserId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  sessionId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', sessionActive: true, policyVersion: 'test',
  permissionRevision: 'b'.repeat(64), grants: ['query:catalog', 'query:quarter'],
  fields: ['netEffectiveRent', 'totalArea'], allSubmarkets: true, submarkets: [], allBuildings: true, buildingIds: [],
};
const env = { authority, signal: new AbortController().signal } as VerifiedToolEnvironment;
const scope = { inventory: 'tracked', submarkets: ['CBD'] };

beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(new Date('2026-11-22T01:00:00Z'));
  vi.resetAllMocks(); mocks.authority.mockResolvedValue(authority);
  mocks.snapshots.mockImplementation(async (_client, _identity, _authority, plan: QueryPlan) => {
    const read = describePlanRead(plan);
    return read.periods.map(period => ({ ...fixture(period), queryScope: { ...plan.scope,
      filter: plan.filter ?? null, requestedFields: read.fields, inventoryTime: 'current_catalog',
      brochureSelection: 'all_unresolved_record_candidates', readAt: '2026-11-22T01:00:00Z' },
      rows: fixture(period).rows.map((row, i) => ({ ...row, dimensions: {
        submarket: { value: i % 2 ? '金融街' : 'CBD', source: { ...nameSource(row.id, i % 2 ? '金融街' : 'CBD'), field: 'submarket', id: 'submarket/' + row.id } },
      } })),
    }));
  });
});
afterEach(() => vi.useRealTimers());

describe('single-quarter reports use the existing authorized aggregate execution', () => {
  it('executes one completed Shanghai calendar quarter with independently checked area-weighted rent', async () => {
    const observed = await executeStructuredDataTool(env, 'query_report_market', { scope, metric: 'rent', recentCompletedQuarters: 1 });
    expect(observed.result?.operation).toBe('aggregate');
    expect(observed.result?.parameters.executedPlan).toMatchObject({ operation: 'aggregate', period: { year: 2026, quarter: 3 } });
    // (100*10000 + 200*30000 + 150*10000) / 50000 = 170; missing C rent is excluded.
    expect(observed.result?.table.rows[0].cells.value).toMatchObject({ kind: 'number', value: { numeric: 170 } });
    expect(observed.result?.parameters.reportPeriodRule).toBe('completed-shanghai-calendar-quarters/1');
    expect(mocks.authority).toHaveBeenCalledTimes(3);
    expect(mocks.snapshots).toHaveBeenCalledOnce();
  });
  it.each([{ submarkets: ['CBD'] }, { submarkets: ['CBD', '金融街'] }])('executes a one-quarter research DAG for $submarkets through governed aggregate tools', async ({ submarkets }) => {
    const task = researchPlan({ submarkets, start: { year: 2026, quarter: 3 }, end: { year: 2026, quarter: 3 }, metrics: ['rent'] },
      'cccccccc-cccc-4ccc-8ccc-cccccccccccc');
    const step = task.steps[0];
    expect(step.tool).toBe('analyze_market_trends');
    const observed = await executeStructuredDataTool(env, step.tool as 'analyze_market_trends', step.args);
    expect(observed.result?.operation).toBe(submarkets.length === 1 ? 'aggregate' : 'group_aggregate');
    expect(observed.result?.parameters.executedPlan).toMatchObject({ period: { year: 2026, quarter: 3 } });
    expect(mocks.snapshots).toHaveBeenCalledOnce();
  });
  it('preserves explicit building scope in single-quarter grouped research and rechecks authorization after reading', async () => {
    const buildingIds = ['dddddddd-dddd-4ddd-8ddd-dddddddddddd'];
    const task = researchPlan({ submarkets: ['CBD', '金融街'], start: { year: 2026, quarter: 3 },
      end: { year: 2026, quarter: 3 }, metrics: ['rent'], buildingIds }, 'cccccccc-cccc-4ccc-8ccc-cccccccccccc');
    const observed = await executeStructuredDataTool(env, 'analyze_market_trends', task.steps[0].args);
    expect(observed.result?.parameters.executedPlan).toMatchObject({ operation: 'group_aggregate',
      scope: { inventory: 'tracked', submarkets: ['CBD', '金融街'], buildingIds } });
    expect(mocks.snapshots.mock.calls[0][3].scope.buildingIds).toEqual(buildingIds);
    mocks.authority.mockReset().mockResolvedValueOnce(authority).mockResolvedValueOnce(authority)
      .mockResolvedValue({ ...authority, permissionRevision: 'c'.repeat(64) });
    await expect(executeStructuredDataTool(env, 'analyze_market_trends', task.steps[0].args)).rejects.toThrow('QUERY_DENIED');
  });
  it('retains multi-quarter trend mapping and rejects a single-quarter explicit trend contract', async () => {
    const observed = await executeStructuredDataTool(env, 'query_report_market', { scope, metric: 'rent', recentCompletedQuarters: 2 });
    expect(observed.result?.operation).toBe('trend');
    expect(observed.result?.parameters.executedPlan).toMatchObject({ start: { year: 2026, quarter: 2 }, end: { year: 2026, quarter: 3 } });
    expect(() => parseQueryPlan({ operation: 'trend', scope, metric: 'rent', mode: 'per_period',
      start: { year: 2026, quarter: 3 }, end: { year: 2026, quarter: 3 } })).toThrow('TREND_REQUIRES_2_TO_40_QUARTERS');
  });
  it('refuses changed permission revision before reading a single-quarter snapshot', async () => {
    mocks.authority.mockResolvedValue({ ...authority, permissionRevision: 'c'.repeat(64) });
    await expect(executeStructuredDataTool(env, 'query_report_market', { scope, metric: 'rent', recentCompletedQuarters: 1 })).rejects.toThrow('QUERY_DENIED');
    expect(mocks.snapshots).not.toHaveBeenCalled();
  });
});
