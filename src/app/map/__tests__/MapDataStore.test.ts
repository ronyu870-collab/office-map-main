import { describe, expect, it } from 'vitest';

import type { SidebarFilterState } from '@/src/components/SidebarFilter';
import { MAP_DISTRICTS, MAP_LEEDS, MAP_SUBMARKETS, MAP_SUBMARKETS_SECONDARY, createDefaultFilterState, filterFutureSupplies } from '@/src/app/map/model/mapDomain';
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
  it('finds reassigned Yuyuantan stock and commercial supply without relaxing other submarket filters', () => {
    const yufu = building('yufu', { name: '裕阜商务中心', submarket: '玉渊潭', district: '海淀区', grade: 'B' });
    const cetc = building('cetc', { name: '中国电科科技创新园（海淀）', submarket: '玉渊潭', district: '海淀区', grade: '' });
    const market = new MapDataStore([yufu, cetc, building('other')]);
    const supply = { id: '640', name: '玉渊潭640地块商业项目', submarket: '玉渊潭', district: '海淀区', type: '商业', grade: null, launch_year: '2027' };
    const filterState = createDefaultFilterState();

    for (const target of [yufu, cetc]) {
      expect(market.filter({ filterState, compareGroups: [], keyword: target.name })).toEqual([target]);
    }
    expect(filterFutureSupplies([supply], filterState, '640')).toEqual([supply]);
    const excluded = { ...filterState, submarkets: ['中关村'] };
    expect(market.filter({ filterState: excluded, compareGroups: [], keyword: yufu.name })).toEqual([]);
    expect(filterFutureSupplies([supply], excluded, '640')).toEqual([]);
  });


  it('finds an ungraded property by name without including it in a selected grade', () => {
    const target = building('ungraded', { name: '中国电科科技创新园（海淀）', grade: '', district: '海淀区', submarket: '', leed_certification: '' });
    const store = new MapDataStore([target]);
    const keyword = '中国电科科技创新园';
    const filterState = defaultFilter();
    expect(store.filter({ filterState, compareGroups: [], keyword }).map(row => row.id)).toEqual(['ungraded']);
    expect(store.filter({ filterState: { ...filterState, projectTypes: ['甲级写字楼'] }, compareGroups: [], keyword })).toEqual([]);
    expect(store.filter({ filterState, compareGroups: [] })).toEqual([]);
  });

  it('finds the same canonical ID by its current or former name while preserving other filters', () => {
    const store = new MapDataStore([
      building('renamed', { name: '新名称', former_names: ['Legacy Name'] }),
      building('other'),
    ]);
    for (const keyword of ['新名称', ' legacy name ']) {
      expect(store.filter({ filterState: defaultFilter(), compareGroups: [], keyword }).map(b => b.id)).toEqual(['renamed']);
    }
    const restricted = defaultFilter(); restricted.districts = ['西城区'];
    expect(store.filter({ filterState: restricted, compareGroups: [], keyword: 'Legacy' })).toEqual([]);
  });
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

    expect(viewer.map(item => item.id)).toEqual(['a', 'p', 'b', 'bp']);
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

  it('intersects configured comparison groups with global filters and role visibility', () => {
    const store = new MapDataStore([
      building('a', { grade: 'A', district: '朝阳区', submarket: 'CBD' }),
      building('a-finance', { grade: 'A', district: '西城区', submarket: '金融街' }),
      building('b', { grade: 'B', district: '西城区', submarket: '金融街' }),
    ]);

    const compareGroups = [
      {
        id: 'group-1',
        name: '金融街项目',
        color: '#000000',
        submarkets: ['金融街'],
        grades: [],
        districts: ['西城区'],
      },
    ];

    const globalCbd = defaultFilter();
    globalCbd.districts = ['朝阳区'];
    globalCbd.submarkets = ['CBD'];
    expect(store.filter({ filterState: globalCbd, role: 'editor', compareGroups })).toEqual([]);

    const globalFinance = defaultFilter();
    globalFinance.districts = ['西城区'];
    globalFinance.submarkets = ['金融街'];

    const viewer = store.filter({ filterState: globalFinance, role: 'viewer', compareGroups });
    const editor = store.filter({ filterState: globalFinance, role: 'editor', compareGroups });

    expect(viewer.map(item => item.id)).toEqual(['a-finance', 'b']);
    expect(editor.map(item => item.id)).toEqual(['a-finance', 'b']);
  });

  it('ignores empty comparison groups until the user configures a condition', () => {
    const store = new MapDataStore([
      building('a', { district: '朝阳区', submarket: 'CBD' }),
      building('finance', { district: '西城区', submarket: '金融街' }),
    ]);
    const filterState = defaultFilter();
    filterState.districts = ['朝阳区'];
    filterState.submarkets = ['CBD'];

    const result = store.filter({
      filterState,
      role: 'editor',
      compareGroups: [{
        id: 'empty',
        name: '组1',
        color: '#000000',
        submarkets: [],
        grades: [],
        districts: [],
      }],
    });

    expect(result.map(item => item.id)).toEqual(['a']);
  });

  it('searches project owner in addition to building name and submarket', () => {
    const ownerTarget = building('owner-target', { name: '普通项目', owner: '华润置地' });
    const other = building('other', { name: '另一项目', owner: '其他业主' });
    const store = new MapDataStore([ownerTarget, other]);

    const result = store.filter({
      filterState: defaultFilter(),
      compareGroups: [],
      role: 'editor',
      keyword: '华润',
    });

    expect(result.map(item => item.id)).toEqual(['owner-target']);
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
