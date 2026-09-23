import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  fetchMapBuildingPayload: vi.fn(),
}));

vi.mock('@/src/services/mapDataClient', () => ({
  fetchMapBuildingPayload: mocks.fetchMapBuildingPayload,
}));

import type { MapController } from '@/src/services/MapController';
import { installMapStartupOptimization } from '@/src/app/map/runtime/mapStartupOptimization';

const BUILDING_ROW = {
  id: 'building-1',
  name: 'Test Tower',
  submarket: 'CBD',
  grade: 'A',
  city: '北京',
  district: '朝阳区',
  location_lng: 116.45,
  location_lat: 39.91,
  completion_year: '2020',
  leed_certification: 'GOLD',
  owner: 'Owner',
  property_management: 'Manager',
  contact_phone: '010-00000000',
  building_metrics: [{
    id: 'metric-1',
    building_id: 'building-1',
    total_area: 100000,
    asking_rent: 300,
    management_fee: 30,
    face_rent: 280,
    rent_free_period: 2,
    net_effective_rent: 260,
    vacancy_rate: 0.12,
    vacant_area: 12000,
    record_year: 2026,
    record_quarter: 2,
  }],
};

function createController() {
  const legacyFetch = vi.fn().mockResolvedValue([]);
  const localLoader = vi.fn().mockResolvedValue({ districts: ['real'], subways: ['real'] });
  const controller = {
    _cachedMapDataPromise: null,
    _allBuildingsCache: [],
    _displayOverridesCache: new Map(),
    fetchMapData: legacyFetch,
    loadLocalMapData: localLoader,
    initMap: vi.fn(async function (this: { loadLocalMapData: () => Promise<unknown> }) {
      void this.loadLocalMapData();
    }),
  };

  return { controller: controller as unknown as MapController, raw: controller, legacyFetch, localLoader };
}

describe('map startup optimization', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.fetchMapBuildingPayload.mockResolvedValue({
      buildings: [BUILDING_ROW],
      displayOverrides: [{
        building_id: 'building-1',
        field_name: 'grade',
        display_label: '等级',
        display_value: '甲级',
      }],
    });
  });

  it('requests the role-scoped latest-metric payload and hydrates controller caches', async () => {
    const { controller, raw, legacyFetch } = createController();
    const cleanup = installMapStartupOptimization(controller);

    const buildings = await raw.fetchMapData();

    expect(mocks.fetchMapBuildingPayload).toHaveBeenCalledWith('latest');
    expect(buildings).toHaveLength(1);
    expect(buildings[0].metrics).toHaveLength(1);
    expect(buildings[0].metrics[0].record_year).toBe(2026);
    expect(raw._allBuildingsCache).toEqual(buildings);
    expect(raw._displayOverridesCache.get('building-1')?.get('grade')).toEqual({
      display_label: '等级',
      display_value: '甲级',
    });
    expect(legacyFetch).not.toHaveBeenCalled();

    cleanup();
  });

  it('suppresses only the init-time local map-data warmup', async () => {
    const { controller, raw, localLoader } = createController();
    const cleanup = installMapStartupOptimization(controller);

    await raw.initMap();
    expect(localLoader).not.toHaveBeenCalled();

    await raw.loadLocalMapData();
    expect(localLoader).toHaveBeenCalledTimes(1);

    cleanup();
  });

  it('falls back to the controller read path when the optimized role-scoped request fails', async () => {
    const { controller, raw, legacyFetch } = createController();
    legacyFetch.mockResolvedValueOnce([{ id: 'legacy-building' }]);
    mocks.fetchMapBuildingPayload.mockRejectedValueOnce(new Error('role-scoped endpoint unavailable'));
    installMapStartupOptimization(controller);

    const buildings = await raw.fetchMapData();

    expect(legacyFetch).toHaveBeenCalledTimes(1);
    expect(buildings).toEqual([{ id: 'legacy-building' }]);
  });
});
