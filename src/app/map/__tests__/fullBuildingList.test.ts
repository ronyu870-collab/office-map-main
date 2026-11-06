import { describe, expect, it } from 'vitest';
import type { BuildingMetric } from '@/src/types';
import { finiteMetric, hasBuildingLocation, listBuildingValues, sortFullList, type FullListBuilding } from '../model/fullBuildingList';
const metric = (rent: number | null, year = 2026): BuildingMetric => ({record_year:year,record_quarter:3,net_effective_rent:rent,total_area:0,vacancy_rate:0} as BuildingMetric);
const rows: FullListBuilding[] = [
 {id:'missing',name:'无指标',metrics:[]},
 {id:'zero',name:'零值',metrics:[metric(0)]},
 {id:'same-1',name:'同价1',metrics:[metric(10)]},
 {id:'same-2',name:'同价2',metrics:[metric(10)]},
];
describe('complete list data projection',()=>{
 it('preserves zero and missing rather than coercing null/empty to zero',()=>{
  expect(finiteMetric(null)).toBeNull();expect(finiteMetric('')).toBeNull();expect(finiteMetric(0)).toBe(0);
  expect(listBuildingValues(rows[0]).rent).toBeNull();expect(listBuildingValues(rows[1])).toMatchObject({rent:0,area:0,vacancy:0,period:'2026Q3'});
 });
 it('sorts stably with missing values last without mutating the shared source',()=>{
  expect(sortFullList(rows,'rent').map(b=>b.id)).toEqual(['zero','same-1','same-2','missing']);
  expect(rows.map(b=>b.id)).toEqual(['missing','zero','same-1','same-2']);expect(sortFullList(rows,'default')).toBe(rows);
 });
 it('keeps missing values last and sorts vacancy by the displayed scale in both directions',()=>{
  const values: FullListBuilding[] = [
   {id:'future',_dataType:'future',metrics:[metric(100)]},
   {id:'zero',metrics:[metric(0)]},
   {id:'ratio',metrics:[{...metric(20),vacancy_rate:0.12}]},
   {id:'percent',metrics:[{...metric(5),vacancy_rate:2.5}]},
   {id:'missing',metrics:[]},
  ];
  expect(sortFullList(values,'rent-desc').map(b=>b.id)).toEqual(['ratio','percent','zero','future','missing']);
  expect(sortFullList(values,'vacancy-desc').map(b=>b.id)).toEqual(['ratio','percent','zero','future','missing']);
  expect(sortFullList(values,'vacancy').map(b=>b.id)).toEqual(['zero','percent','ratio','future','missing']);
 });
 it('uses the same latest-quarter helper while keeping future supply separate',()=>{
  expect(listBuildingValues({id:'stock',metrics:[metric(4,2025),metric(8)]}).rent).toBe(8);
  expect(listBuildingValues({id:'future',_dataType:'future',total_area:50000,metrics:[metric(8)]})).toMatchObject({area:50000,rent:null,period:null});
 });
 it('does not silently remove records whose coordinates are missing',()=>{
  expect(sortFullList([{id:'unknown',location_lng:null,location_lat:null}],'name')).toHaveLength(1);
  expect(hasBuildingLocation({id:'unknown',location_lng:null,location_lat:39})).toBe(false);
 });
});
