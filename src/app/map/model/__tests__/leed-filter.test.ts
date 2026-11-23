import { expect, it } from 'vitest';
import type { BuildingWithMetrics } from '@/src/types';
import { filterBuildings } from '@/src/utils/filterBuildings';
import { MapDataStore } from '../MapDataStore';
import { buildActiveFilterChips, buildDistrictLeedStats, createDefaultFilterState } from '../mapDomain';

const row=(id:string,leed_certification:string):BuildingWithMetrics=>({id,name:id,city:'北京',district:'朝阳区',submarket:'CBD',grade:'A',completion_year:'2009',location_lng:116.46,location_lat:39.91,leed_certification,metrics:[]});
const rows=[row('gold','Gold'),row('negative','N'),row('negative-alias','未认证'),row('missing',''),row('missing-space','  '),row('missing-sentinel','UNKNOWN')];

it('keeps explicit uncertified and missing observations available in the default map filter',()=>{
  const filterState=createDefaultFilterState();
  const store=new MapDataStore(rows);
  expect(store.filter({filterState,compareGroups:[]}).map(b=>b.id)).toEqual(rows.map(b=>b.id));
  expect(filterBuildings(rows,filterState).map(b=>b.id)).toEqual(rows.map(b=>b.id));
});
it('lets uncertified and unavailable be filtered independently on both stock paths',()=>{
  const store=new MapDataStore(rows);
  for(const [leeds,expected] of [[['N'],['negative','negative-alias']],[['NULL'],['missing','missing-space','missing-sentinel']]] as const){
    const filterState={...createDefaultFilterState(),leeds:[...leeds]};
    expect(store.filter({filterState,compareGroups:[]}).map(b=>b.id)).toEqual(expected);
    expect(filterBuildings(rows,filterState).map(b=>b.id)).toEqual(expected);
  }
});
it('does not count explicit negatives or unavailable observations as LEED-certified',()=>{
  expect(buildDistrictLeedStats(rows).get('朝阳区')).toEqual({totalCount:6,leedCount:1});
});
it('names explicit uncertified separately in the active condition',()=>{
  expect(buildActiveFilterChips({...createDefaultFilterState(),leeds:['N']}).find(c=>c.id==='leeds')?.label).toContain('未认证（N）');
});

it('upgrades only the old full LEED catalog when restoring preferences',async()=>{
  const {readMapFilterPreference}=await import('../mapFilterPreference');
  const filters={...createDefaultFilterState(),leeds:['Platinum','Gold','Silver','NULL']};
  sessionStorage.setItem('leed-preference',JSON.stringify({input:'CBD',filters}));
  expect(readMapFilterPreference('leed-preference')?.filters?.leeds).toContain('N');
  sessionStorage.setItem('leed-preference',JSON.stringify({input:'CBD',filters,leedCatalogVersion:2}));
  expect(readMapFilterPreference('leed-preference')?.filters?.leeds).not.toContain('N');
  sessionStorage.setItem('leed-preference',JSON.stringify({input:'CBD',filters:{...filters,leeds:['Gold']}}));
  expect(readMapFilterPreference('leed-preference')?.filters?.leeds).toEqual(['Gold']);
});
