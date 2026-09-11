import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const buildingsBuilder: Record<string, ReturnType<typeof vi.fn>> = {};
  buildingsBuilder.select = vi.fn(() => buildingsBuilder);
  buildingsBuilder.eq = vi.fn(() => buildingsBuilder);
  buildingsBuilder.or = vi.fn(() => buildingsBuilder);
  buildingsBuilder.order = vi.fn(() => buildingsBuilder);
  buildingsBuilder.limit = vi.fn();

  const overridesSelect = vi.fn();
  const from = vi.fn((table: string) => {
    if (table === 'buildings') return buildingsBuilder;
    if (table === 'building_display_overrides') return { select: overridesSelect };
    throw new Error(`unexpected table: ${table}`);
  });

  return { buildingsBuilder, overridesSelect, from };
});

vi.mock('@/src/services/supabaseClient', () => ({
  supabase: { from: mocks.from },
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
    mocks.buildingsBuilder.limit.mockResolvedValue({ data: [BUILDING_ROW], error: null });
    mocks.overridesSelect.mockResolvedValue({
      data: [{
        building_id: 'building-1',
        field_name: 'grade',
        display_label: '等级',
        display_value: '甲级',
      }],
      error: null,
    });
  });

  it('requests only the latest embedded metric and hydrates controller caches', async () => {
    const { controller, raw, legacyFetch } = createController();
    const cleanup = installMapStartupOptimization(controller);

    const buildings = await raw.fetchMapData();

    expect(mocks.buildingsBuilder.order).toHaveBeenNthCalledWith(1, 'record_year', {
      referencedTable: 'building_metrics',
      ascending: false,
    });
    expect(mocks.buildingsBuilder.order).toHaveBeenNthCalledWith(2, 'record_quarter', {
      referencedTable: 'building_metrics',
      ascending: false,
    });
    expect(mocks.buildingsBuilder.limit).toHaveBeenCalledWith(1, {
      referencedTable: 'building_metrics',
    });
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

  it('falls back to the legacy query when the slim query fails', async () => {
    const { controller, raw, legacyFetch } = createController();
    legacyFetch.mockResolvedValueOnce([{ id: 'legacy-building' }]);
    mocks.buildingsBuilder.limit.mockResolvedValueOnce({
      data: null,
      error: { message: 'embedded query unavailable' },
    });
    installMapStartupOptimization(controller);

    const buildings = await raw.fetchMapData();

    expect(legacyFetch).toHaveBeenCalledTimes(1);
    expect(buildings).toEqual([{ id: 'legacy-building' }]);
  });
});
