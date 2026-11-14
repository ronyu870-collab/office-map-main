import {describe,it,expect} from 'vitest';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import JSZip from 'jszip';
import {futureSample} from './futureFixture';
import {id,hash} from './submissionFixture';
import {buildFutureResult} from '../future/result';
import type {FutureAuthority} from '../future/reader';
import {buildResultChart,renderChartSvg} from '../charts';
import {fitMap,mapGeometry,moveMap} from '../future/map';
import {loadMapBase} from '../future/mapBaseServer';
import {mapBaseDescriptor} from '../future/mapBaseDescriptor';
import {buildResultArtifact} from '../artifacts';
import {resultViewSchema} from '../presentation';

const authority:FutureAuthority={actorId:id(10),effectiveUserId:id(10),sessionId:id(20),sessionActive:true,permissionRevision:hash,policyVersion:'test',grants:['query:future-catalog'],fields:[],allSubmarkets:true,submarkets:[],allFutureSupplies:true,futureSupplyIds:[]};
function sample(coords:([string|null,string|null])[]=[['116.4','39.9'],['116.4','39.9'],[null,'39.9'],['999','39.9']]){
 const raw=futureSample();raw.mode='catalog';raw.period=null;raw.configuredPeriod=null;raw.periodBasis='none';raw.settings=[];raw.assignments=[];raw.submissions=[];
 raw.supplies=coords.map(([lng,lat],i)=>({...raw.supplies[0],id:id(i+1),location_lng:lng,location_lat:lat}));raw.expected={supplies:coords.length,assignments:0,submissions:0};
 return buildFutureResult(raw,{view:'catalog',period:null},authority,raw.requestId);
}
const chart=(result=sample())=>buildResultChart(resultViewSchema.parse(result),{kind:'future_locations'});
describe('future map from immutable, authorized original coordinates',()=>{
 it('reproduces the versioned geometry from the checked-in source without network',()=>{expect(()=>execFileSync(process.execPath,['scripts/maps/generate-query-base.mjs','--check'])).not.toThrow();});
 it('keeps records and exact original source values; does not invent missing positions or merge same names',()=>{
  const result=sample(),c=chart(result);expect(c.kind).toBe('map');expect(c.renderedCount).toBe(2);expect(c.unknownCount).toBe(2);expect(c.points.map(p=>p.coordinateState)).toEqual(['valid','valid','unknown','invalid']);
  expect(c.points.slice(2).every(p=>p.x===null&&p.y===null)).toBe(true);expect(new Set(c.points.map(p=>p.label)).size).toBe(4);
  expect(c.points[0].yText).toBe('经度 116.4，纬度 39.9');expect(c.mapBase).toEqual(mapBaseDescriptor);
  for(const p of c.points)expect(p.yCell.sourceIds.every(id=>result.sources.some(s=>s.id===id))).toBe(true);
  const g=mapGeometry(c,null,fitMap(c,390,360)!,390,360);expect(g.groups).toHaveLength(1);expect(g.groups[0].indices).toEqual([0,1]);
 });
 it('rejects missing, wrong entity/field and modified numeric evidence, plus unrelated operations',()=>{
  const r=resultViewSchema.parse(sample());expect(()=>buildResultChart({...r,operation:'list'},{kind:'future_locations'})).toThrow('CHART_FUTURE_CATALOG_REQUIRED');
  for(const mutate of [(s:typeof r.sources)=>s.splice(s.findIndex(s=>s.field==='location_lng'),1),(s:typeof r.sources)=>{s.find(s=>s.field==='location_lng')!.rawValue='116.5';},(s:typeof r.sources)=>{s.find(s=>s.field==='location_lng')!.entityId=id(99);}]){
   const copy=structuredClone(r);mutate(copy.sources);expect(()=>buildResultChart(copy,{kind:'future_locations'})).toThrow('CHART_LOCATION_SOURCE_MISMATCH');
  }
 });
 it('handles no rows, all unknown, zero pair, a valid zero longitude, global extents and bounded zoom',()=>{
  for(const c of [chart(sample([])),chart(sample([[null,null],['0','0']]))]){expect(fitMap(c,320,360)).toBe(null);expect(c.renderedCount).toBe(0);}
  const c=chart(sample([['0','30'],['180','90'],['-180','-90']])),v=fitMap(c,320,360)!;expect(c.renderedCount).toBe(3);
  expect(mapGeometry(c,null,v,320,360).groups.flatMap(g=>g.indices)).toHaveLength(3);
  expect(moveMap(v,1000,-1000,1e9)).toEqual({cx:400,cy:-200,span:1000});expect(moveMap(v,0,0,1e-9).span).toBe(0.0001);
 });
 it('preserves every overlapping and adjacent cell record, with no grid bucket overwrite',()=>{
  const c=chart(sample(Array.from({length:200},(_,i)=>[String(116.3+(i%20)*0.01),String(39.8+Math.floor(i/20)*0.01)]))),g=mapGeometry(c,null,fitMap(c,1280,360)!,1280,360);
  expect(mapGeometry(c,null,fitMap(c,254,360)!,254,360).groups.flatMap(g=>g.indices)).toHaveLength(200);
  const all=g.groups.flatMap(g=>g.indices);expect(new Set(all).size).toBe(200);expect(all).toHaveLength(200);
 });
 it('exports standalone geometry, full list including unknown and original source manifest; validates base hash',async()=>{
  const result=sample(),c=chart(result),base=await loadMapBase();expect(createHash('sha256').update(JSON.stringify(base)).digest('hex')).toBe(c.mapBase?.sha256);
  expect(()=>renderChartSvg(c)).toThrow('CHART_MAP_BASE_REQUIRED');
  const artifact=await buildResultArtifact(result,{action:'export',requestId:id(91),resultId:result.resultId,format:'svg_zip',chart:{kind:'future_locations'}});if(artifact.type!=='download')throw Error();
  const zip=await JSZip.loadAsync(artifact.bytes),manifest=JSON.parse(await zip.file('manifest.json')!.async('string')),svg=await zip.file('chart.svg')!.async('string');
  expect(manifest.chart).toEqual(c);expect(manifest.sources).toEqual(result.sources);expect(JSON.parse(await zip.file('map-base.json')!.async('string'))).toEqual(base);
  expect(svg).toContain('坐标无效');expect(svg).toContain('坐标缺失');expect(svg).toContain('位置及坐标系未逐条核实');expect(svg).toContain(result.resultId);expect(svg).toContain('<path');expect(svg).not.toMatch(/NaN|Infinity|<script|<image|href=/);
  c.points[0].label='<script>alert(1)</script>';expect(renderChartSvg(c,base)).not.toContain('<script>');
  c.points=Array(1001).fill(c.points[0]);expect(()=>renderChartSvg(c,base)).toThrow('CHART_SIZE_LIMIT');
 });
});
