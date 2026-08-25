import { describe, expect, it } from 'vitest';

import type { SidebarFilterState } from '@/src/components/SidebarFilter';
import { MAP_DISTRICTS, MAP_LEEDS, MAP_SUBMARKETS, MAP_SUBMARKETS_SECONDARY } from '@/src/app/map/model/mapDomain';
import { MapDataStore } from '@/src/app/map/model/MapDataStore';
import type { BuildingWithMetrics } from '@/src/types';

function building(
  id: string,
  overrides: Partial<BuildingWithMetrics> = {},
): BuildingWithMetrics {
  return {
    id,
    name: `Building ${id}`,
    submarket: 'CBD',
    grade: 'A',
    city: '北京',
    district: '朝阳区',
    location_lng: 116.4,
    location_lat: 39.9,
    completion_year: '2020',
    leed_certification: 'Gold',
    metrics: [
      {
        id: `metric-${id}`,
        building_id: id,
        total_area: 10000,
        asking_rent: 110,
        management_fee: 30,
        face_rent: 120,
        rent_free_period: 1,
        net_effective_rent: 100,
        vacancy_rate: 0.1,
        vacant_area: 1000,
        record_year: 2026,
        record_quarter: 2,
      },
    ],
    ...overrides,
  };
}

function defaultFilter(): SidebarFilterState {
  return {
    districts: [...MAP_DISTRICTS],
    submarkets: [...MAP_SUBMARKETS, ...MAP_SUBMARKETS_SECONDARY],
    leeds: [...MAP_LEEDS],
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

describe('MapDataStore', () => {
  it('builds stable lookup indexes when the dataset is replaced', () => {
    const cbd = building('a');
    const finance = building('b', { district: '西城区', submarket: '金融街', grade: 'P', leed_certification: '' });
    const store = new MapDataStore([cbd, finance]);

    expect(store.getById('b')).toBe(finance);
    expect(store.getIndexSnapshot().districtIndex.get('西城区')).toEqual(new Set(['b']));
    expect(store.getIndexSnapshot().submarketIndex.get('金融街')).toEqual(new Set(['b']));
    expect(store.getIndexSnapshot().leedIndex.get('NULL')).toEqual(new Set(['b']));
    expect(store.getIndexSnapshot().projectTypeIndex.get('甲级写字楼')).toEqual(new Set(['a', 'b']));
  });

  it('preserves current role visibility before global filtering', () => {
    const store = new MapDataStore([
      building('a', { grade: 'A' }),
      building('p', { grade: 'P' }),
      building('b', { grade: 'B' }),
      building('bp', { grade: 'BP' }),
    ]);

    const viewer = store.filter({ filterState: defaultFilter(), compareGroups: [], role: 'viewer' });
    const editor = store.filter({ filterState: defaultFilter(), compareGroups: [], role: 'editor' });

    expect(viewer.map(item => item.id)).toEqual(['a', 'p']);
    expect(editor.map(item => item.id)).toEqual(['a', 'p', 'b', 'bp']);
  });

  it('applies district, project type, LEED, keyword and numeric filters together', () => {
    const target = building('target', {
      name: '国贸中心',
      district: '朝阳区',
      submarket: 'CBD',
      grade: 'A',
      leed_certification: 'Gold',
    });
    target.metrics[0].net_effective_rent = 280;
    target.metrics[0].vacancy_rate = 0.08;

    const store = new MapDataStore([
      target,
      building('wrong-district', { district: '西城区', submarket: '金融街' }),
      building('wrong-grade', { grade: 'BP' }),
    ]);

    const filterState = defaultFilter();
    filterState.districts = ['朝阳区'];
    filterState.submarkets = ['CBD'];
    filterState.leeds = ['Gold'];
    filterState.projectTypes = ['甲级写字楼'];
    filterState.numericFilters = [
      { id: 'rent', field: 'net_effective_rent', operator: '>=', value: 250 },
      { id: 'vacancy', field: 'vacancy_rate', operator: '<=', value: 10 },
    ];

    const result = store.filter({ filterState, compareGroups: [], role: 'editor', keyword: '国贸' });
    expect(result.map(item => item.id)).toEqual(['target']);
  });

  it('preserves comparison mode semantics by ignoring global filters and using the fetched full dataset', () => {
    const store = new MapDataStore([
      building('a', { grade: 'A', district: '朝阳区', submarket: 'CBD' }),
      building('b', { grade: 'B', district: '西城区', submarket: '金融街' }),
    ]);

    const filterState = defaultFilter();
    filterState.districts = ['朝阳区'];
    filterState.projectTypes = ['甲级写字楼'];

    const result = store.filter({
      filterState,
      role: 'viewer',
      compareGroups: [
        {
          id: 'group-1',
          name: '乙级金融街',
          color: '#000000',
          submarkets: ['金融街'],
          grades: ['乙级'],
          districts: ['西城区'],
        },
      ],
    });

    expect(result.map(item => item.id)).toEqual(['b']);
  });

  it('delegates subway distance math without coupling the store to AMap', () => {
    const store = new MapDataStore([building('near'), building('far', { location_lng: 117 })]);
    const filterState = defaultFilter();
    filterState.subwayStation = { center: [116.4, 39.9] };
    filterState.subwayDistance = 1000;

    const result = store.filter({
      filterState,
      compareGroups: [],
      role: 'editor',
      calculateDistance: ([lng]) => (lng > 116.5 ? 5000 : 200),
    });

    expect(result.map(item => item.id)).toEqual(['near']);
  });
});
