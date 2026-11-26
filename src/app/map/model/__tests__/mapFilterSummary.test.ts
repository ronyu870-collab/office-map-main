import type { BuildingWithMetrics } from '@/src/types';
import { expect, it } from 'vitest';
import { buildActiveFilterChips, createDefaultFilterState } from '../mapDomain';
import { filterBuildings } from '@/src/utils/filterBuildings';

it('describes text matching as containment while keeping numeric comparison and individual removal scoped', () => {
  const state = {...createDefaultFilterState(),numericFilters:[
    {id:'owner',field:'owner' as const,operator:'=' as const,value:'资产管理'},
    {id:'rent',field:'net_effective_rent' as const,operator:'>=' as const,value:120},
  ]};
  const building: BuildingWithMetrics={id:'a',name:'甲楼',district:'朝阳区',submarket:'CBD',grade:'A',leed_certification:'Gold',owner:'北京资产管理有限公司',city:'北京',location_lng:116.46,location_lat:39.91,completion_year:'2020',metrics:[{id:'m',building_id:'a',total_area:1000,asking_rent:150,face_rent:150,management_fee:10,rent_free_period:0,vacancy_rate:.1,vacant_area:100,is_locked:true,is_draft:false,record_year:2026,record_quarter:3,net_effective_rent:146}]};
  expect(filterBuildings([building],state)).toHaveLength(1);
  const chips=buildActiveFilterChips(state);
  expect(chips.find(chip=>chip.id==='numeric-owner')?.label).toBe('项目业主 含 资产管理');
  expect(chips.find(chip=>chip.id==='numeric-rent')?.label).toBe('净有效租金 >= 120');
  expect(chips.find(chip=>chip.id==='numeric-owner')?.patch.numericFilters).toEqual([state.numericFilters[1]]);
});
