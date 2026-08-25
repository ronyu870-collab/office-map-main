import { describe, expect, it } from 'vitest';

import type { SidebarFilterState } from '@/src/components/SidebarFilter';
import { MapDataStore } from '@/src/app/map/model/MapDataStore';
import type { BuildingMetric, BuildingWithMetrics } from '@/src/types';

function makeMetrics(buildingId: string, count = 20): BuildingMetric[] {
  return Array.from({ length: count }, (_, index) => {
    const year = 2026 - Math.floor(index / 4);
    const quarter = 4 - (index % 4);
    return {
      id: `metric-${buildingId}-${index}`,
      building_id: buildingId,
      total_area: 20_000 + (index % 5) * 1000,
      asking_rent: 160 + (index % 20),
      management_fee: 28,
      face_rent: 180 + (index % 25),
      rent_free_period: 1,
      net_effective_rent: 150 + (index % 30),
      vacancy_rate: 0.05 + (index % 12) / 100,
      vacant_area: 2000 + index * 10,
      record_year: year,
      record_quarter: quarter,
    };
  });
}

const DISTRICTS = ['朝阳区', '海淀区', '西城区', '东城区', '丰台区'];
const SUBMARKETS = ['CBD', '金融街', '中关村', '望京', '丽泽'];
const LEEDS = ['Gold', 'Platinum', 'Silver', 'NULL'];
const GRADES = ['A', 'P', 'B', 'BP'];

function makeBuildings(count: number): BuildingWithMetrics[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `building-${index}`,
    name: `Building ${index}`,
    submarket: SUBMARKETS[index % SUBMARKETS.length],
    grade: GRADES[index % GRADES.length],
    city: '北京',
    district: DISTRICTS[index % DISTRICTS.length],
    location_lng: 116.25 + (index % 50) * 0.005,
    location_lat: 39.75 + (index % 40) * 0.005,
    completion_year: String(2000 + (index % 26)),
    leed_certification: LEEDS[index % LEEDS.length],
    owner: `Owner ${index % 25}`,
    property_management: `PM ${index % 12}`,
    metrics: makeMetrics(`building-${index}`),
  }));
}

function baseFilter(): SidebarFilterState {
  return {
    districts: [],
    submarkets: [],
    leeds: [],
    projectTypes: ['甲级写字楼', '乙级写字楼', '产业园区'],
    showBoundaries: false,
    subwayLine: null,
    subwayStation: null,
    subwayDistance: 1000,
    numericFilters: [],
    showFutureSupply: false,
    futureSupplyGrades: ['A', 'B', 'BP'],
    futureSupplyYears: ['2026', '2027', '2028', '2029AndAfter', 'noDate'],
  };
}

function measure(label: string, iterations: number, fn: () => unknown) {
  for (let index = 0; index < 20; index++) fn();
  const started = performance.now();
  let last: unknown;
  for (let index = 0; index < iterations; index++) last = fn();
  const totalMs = performance.now() - started;
  const avgMs = totalMs / iterations;
  console.log(`[perf-profile] ${label} total=${totalMs.toFixed(2)}ms avg=${avgMs.toFixed(4)}ms iterations=${iterations}`);
  return last;
}

class FakeMarker {
  static created = 0;
  constructor(_options: unknown) {
    FakeMarker.created += 1;
  }
  setExtData(_value: unknown) {}
  on(_event: string, _handler: (...args: any[]) => void) {}
}

class FakePixel {
  constructor(_x: number, _y: number) {}
}

describe('performance profile (non-gating timings)', () => {
  it('profiles MapDataStore index and common filters at 100/300/500 buildings', () => {
    for (const size of [100, 300, 500]) {
      const buildings = makeBuildings(size);
      const store = new MapDataStore();
      measure(`MapDataStore.replaceBuildings ${size}`, 50, () => store.replaceBuildings(buildings));

      const district = baseFilter();
      district.districts = ['朝阳区'];
      const districtResult = measure(`district filter ${size}`, 500, () =>
        store.filter({ filterState: district, compareGroups: [], role: 'editor' }),
      ) as BuildingWithMetrics[];
      expect(districtResult.length).toBeGreaterThan(0);

      const submarket = baseFilter();
      submarket.submarkets = ['CBD'];
      const submarketResult = measure(`submarket filter ${size}`, 500, () =>
        store.filter({ filterState: submarket, compareGroups: [], role: 'editor' }),
      ) as BuildingWithMetrics[];
      expect(submarketResult.length).toBeGreaterThan(0);

      const leed = baseFilter();
      leed.leeds = ['Gold'];
      const leedResult = measure(`LEED filter ${size}`, 500, () =>
        store.filter({ filterState: leed, compareGroups: [], role: 'editor' }),
      ) as BuildingWithMetrics[];
      expect(leedResult.length).toBeGreaterThan(0);

      const numeric = baseFilter();
      numeric.numericFilters = [
        { id: 'rent', field: 'net_effective_rent', operator: '>=', value: 150 },
        { id: 'vacancy', field: 'vacancy_rate', operator: '<=', value: 10 },
      ];
      const numericResult = measure(`numeric filter ${size}`, 300, () =>
        store.filter({ filterState: numeric, compareGroups: [], role: 'editor' }),
      ) as BuildingWithMetrics[];
      expect(numericResult.length).toBeGreaterThan(0);
    }
  });

  it('profiles MapController marker object construction for 500 buildings', async () => {
    const { MapController } = await import('@/src/services/MapController');
    const buildings = makeBuildings(500);
    FakeMarker.created = 0;

    const controller = new MapController({ Marker: FakeMarker, Pixel: FakePixel } as any);
    const fakeMap = {
      add: () => {},
      remove: () => {},
      on: () => {},
      getZoom: () => 11.2,
    };
    (controller as any).map = fakeMap;

    const started = performance.now();
    controller.renderMarkers(buildings, 'default');
    const totalMs = performance.now() - started;
    console.log(`[perf-profile] MapController.renderMarkers 500 total=${totalMs.toFixed(2)}ms markerObjects=${FakeMarker.created}`);

    expect(FakeMarker.created).toBeGreaterThanOrEqual(1000);
    controller.destroy();
  });
});
