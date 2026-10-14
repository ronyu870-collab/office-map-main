import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ userId: 'user-a', role: 'editor', token: 'token-a' }));
vi.mock('../Auth', () => ({ getSessionFast: async () => state.token ? ({ user: { id: state.userId }, role: state.role, session: { access_token: state.token } }) : null }));
import { fetchBuildingTrendPayload, fetchComparePayload, fetchFutureSupplyPayload, fetchMapBuildingPayload } from '../mapDataClient';
import { clearMapReadCache } from '../mapReadCache';

const fetchMock = vi.fn();
beforeEach(() => {
  clearMapReadCache(); sessionStorage.clear();
  state.userId = 'user-a'; state.role = 'editor'; state.token = 'token-a';
  fetchMock.mockReset().mockImplementation(async () => ({ ok: true, json: async () => ({ buildings: [{ id: 'tower', building_metrics: [{ record_year: 2025 }, { record_year: 2026 }] }], future_supplies: [{ id: 'future' }] }) }));
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => { clearMapReadCache(); vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('map snapshot reuse', () => {
  it('deduplicates concurrent and repeated requests while preserving all historical metrics', async () => {
    const [first, second] = await Promise.all([fetchMapBuildingPayload('all'), fetchMapBuildingPayload('all')]);
    expect(first).toEqual(second);
    expect(first.buildings[0].building_metrics).toHaveLength(2);
    await fetchMapBuildingPayload('all');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe('/api/map/data?mode=map&metrics=all');
    const options = fetchMock.mock.calls[0][1];
    expect(options.headers.get('Authorization')).toBe('Bearer token-a');
    expect(options.cache).toBe('no-store');
    await fetchMapBuildingPayload('latest');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('expires after 30 seconds and clears immediately after an explicit edit invalidation', async () => {
    vi.useFakeTimers();
    await fetchMapBuildingPayload('all');
    await vi.advanceTimersByTimeAsync(29_999);
    await fetchMapBuildingPayload('all');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    await fetchMapBuildingPayload('all');
    clearMapReadCache();
    await fetchMapBuildingPayload('all');
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it.each(['userId', 'role', 'token'] as const)('refetches on %s changes', async (field) => {
    await fetchMapBuildingPayload('all');
    state[field] = 'changed';
    await fetchMapBuildingPayload('all');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('isolates impersonation targets and refuses cached data without a session', async () => {
    await fetchMapBuildingPayload('all');
    sessionStorage.setItem('__impersonation_state', JSON.stringify({ targetUserId: 'target-a' }));
    await fetchMapBuildingPayload('all');
    expect(fetchMock.mock.calls[1][1].headers.get('X-Colliers-Impersonate-User')).toBe('target-a');
    sessionStorage.setItem('__impersonation_state', JSON.stringify({ targetUserId: 'target-b' }));
    await fetchMapBuildingPayload('all');
    state.token = '';
    await expect(fetchMapBuildingPayload('all')).rejects.toThrow('未登录');
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('does not retain failures or let an invalidated pending request replace a newer snapshot', async () => {
    fetchMock.mockRejectedValueOnce(new Error('offline'));
    await expect(fetchMapBuildingPayload('all')).rejects.toThrow('offline');
    await fetchMapBuildingPayload('all');
    clearMapReadCache();
    let resolve!: (value: unknown) => void;
    fetchMock.mockImplementationOnce(() => new Promise((done) => { resolve = done; }));
    const old = fetchMapBuildingPayload('all');
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
    clearMapReadCache();
    const current = await fetchMapBuildingPayload('all');
    resolve({ ok: true, json: async () => ({ buildings: [{ id: 'old' }] }) });
    await old;
    expect(await fetchMapBuildingPayload('all')).toEqual(current);
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it('reuses future supply snapshots but keeps compare and trend reads fresh', async () => {
    await fetchFutureSupplyPayload(); await fetchFutureSupplyPayload();
    await fetchComparePayload(); await fetchComparePayload();
    await fetchBuildingTrendPayload('tower'); await fetchBuildingTrendPayload('tower');
    expect(fetchMock).toHaveBeenCalledTimes(5);
  });
});
