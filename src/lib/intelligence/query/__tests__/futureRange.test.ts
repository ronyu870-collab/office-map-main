import {describe,it,expect} from 'vitest';
import * as XLSX from 'xlsx';
import {futureSample} from './futureFixture';
import {id,hash} from './submissionFixture';
import {buildFutureResult} from '../future/result';
import {futureRangeOverviewSchema} from '../future/range';
import {futureLaunchRangeSchema,type FutureLaunchRange} from '../future/contracts';
import {futureAnalysisSchema,type FutureView} from '../future/view';
import {resolveBusinessQuestion} from '../question';
import {parseQueryPlan} from '../plan';
import {resultViewSchema,resultSummary} from '../presentation';
import {buildResultChart} from '../charts';
import {buildXlsx,buildCsvPackage} from '../exports';
import type {FutureAuthority} from '../future/reader';
const authority:FutureAuthority={actorId:id(10),effectiveUserId:id(10),sessionId:id(20),sessionActive:true,permissionRevision:hash,policyVersion:'test',grants:['query:future-catalog'],fields:[],allSubmarkets:true,submarkets:[],allFutureSupplies:true,futureSupplyIds:[]};
const range:FutureLaunchRange={start:{year:2026,quarter:3},end:{year:2026,quarter:3},selection:'within'};
function sample(){
 const raw=futureSample();Object.assign(raw,{mode:'catalog',period:null,configuredPeriod:null,periodBasis:'none',settings:[],assignments:[],submissions:[]});
 raw.supplies[0].total_area='0.1';raw.supplies[1].total_area='0.2';raw.supplies[2].total_area=null;raw.supplies[3].launch_year='2027';
 raw.supplies.push({...raw.supplies[0],id:id(5),launch_year:null,completion_year:2026});raw.expected={supplies:5,assignments:0,submissions:0};return raw;
}
function make(selection:FutureLaunchRange['selection']='within',view:FutureView='launch_schedule'){
 const raw=sample();return buildFutureResult(raw,{view,period:null,launchRange:{...range,selection}},authority,raw.requestId);
}
describe('future launch range selection',()=>{
 it('classifies every authorized candidate into disjoint states; half/year partial overlap and unknown are not definite matches',()=>{
  const result=make(),r=futureRangeOverviewSchema.parse(result.parameters.launchRange);
  expect(r).toMatchObject({candidateCount:5,selectedCount:1,within:1,partial:2,outside:1,unknown:1});
  expect(result.table.rows.map(r=>r.entityId)).toEqual([id(1)]);expect(futureAnalysisSchema.parse(result.analysis).catalog.records).toBe(1);
  expect(make('overlap').table.rows.map(r=>r.entityId)).toEqual([id(1),id(2),id(3)]);
  expect(make('unknown').table.rows.map(r=>r.entityId)).toEqual([id(5)]);expect(make('outside').table.rows.map(r=>r.entityId)).toEqual([id(4)]);
  for(const m of r.members)expect(m.sourceIds.every(x=>result.sources.some(s=>s.id===x))).toBe(true);
  expect(resultSummary(resultViewSchema.parse(result)).join(' ')).toContain('未知未计作范围外');
  expect(buildResultChart(resultViewSchema.parse(result),{kind:'launch_intervals'}).points).toHaveLength(1);
 });
 it('retains inclusive endpoints and original half/year precision without allocating area to the selected period',async()=>{
  const result=make('overlap','area_summary');expect(result.parameters.supply).toMatchObject({records:3,valid:2,missing:1,knownArea:{exact:{numerator:'3',denominator:'10'}}});
  const book=XLSX.read(await buildXlsx(result),{type:'array'}),basis=XLSX.utils.sheet_to_json(book.Sheets['预计范围筛选依据'],{header:1}) as unknown[][];
  expect(basis.slice(3)).toHaveLength(5);expect(basis.slice(3).filter(r=>r[4]==='是')).toHaveLength(3);
  const rows=XLSX.utils.sheet_to_json(book.Sheets['未来记录面积'],{header:1}) as unknown[][];expect(rows.slice(3).map(r=>r.at(-1)).filter(v=>typeof v==='number').sort()).toEqual([0.1,0.2]);
  expect(JSON.parse(buildCsvPackage(result).manifest).parameters.launchRange).toEqual(result.parameters.launchRange);
  const raw=sample();const annual=buildFutureResult(raw,{view:'catalog',period:null,launchRange:{...range,start:{year:2026,quarter:1},end:{year:2026,quarter:4}}},authority,raw.requestId);
  expect(annual.table.rows).toHaveLength(3);expect(resultViewSchema.parse(annual).parameters.launchRange).toMatchObject({within:3,partial:0});
 });
 it('keeps all-unknown and empty selected areas unknown; protects scope and rejects forged coverage',()=>{
  const raw=sample();raw.supplies.forEach(r=>r.launch_year=null);
  const result=buildFutureResult(raw,{view:'area_summary',period:null,launchRange:range},authority,raw.requestId);
  expect(result.parameters.supply).toMatchObject({records:0,knownArea:null});expect(result.parameters.launchRange).toMatchObject({candidateCount:5,unknown:5,selectedCount:0});
  expect(resultSummary(resultViewSchema.parse(result)).join(' ')).toContain('未知（没有有效面积记录）');
  const bad={...result,parameters:{...result.parameters,launchRange:{...futureRangeOverviewSchema.parse(result.parameters.launchRange),unknown:0}}};expect(resultViewSchema.safeParse(bad).success).toBe(false);
  const broken=structuredClone(result);const overview=futureRangeOverviewSchema.parse(broken.parameters.launchRange);overview.members[0].sourceIds=['missing-source'];expect(resultViewSchema.safeParse({...broken,parameters:{...broken.parameters,launchRange:overview}}).success).toBe(false);
  expect(()=>buildFutureResult(raw,{view:'catalog',period:null,launchRange:range},{...authority,allFutureSupplies:false,futureSupplyIds:[id(1)]},raw.requestId)).toThrow();
  raw.supplies=[];raw.expected.supplies=0;const empty=buildFutureResult(raw,{view:'catalog',period:null,launchRange:range},authority,raw.requestId);expect(empty.parameters.launchRange).toMatchObject({candidateCount:0,unknown:0});
 });
 it('resolves bounded range questions without treating launch range as submission quarter or ignoring additional clauses',()=>{
  expect(resolveBusinessQuestion('CBD未来供应预计在2026Q3至2027Q1入市有哪些',new Date())).toMatchObject({kind:'plan',plan:{view:'catalog',period:null,launchRange:{start:{year:2026,quarter:3},end:{year:2027,quarter:1},selection:'within'}}});
  for(const [label,selection] of [['完全在范围内','within'],['可能涉及','overlap'],['时间未知','unknown'],['范围外','outside']])for(const view of ['目录','面积汇总','预计入市区间','预计时间精度'])expect(resolveBusinessQuestion(`CBD未来供应预计入市2026年第三季度到2027年第一季度${label}的${view}`,new Date())).toMatchObject({kind:'plan',plan:{launchRange:{selection}}});
  for(const q of ['CBD未来供应预计在2027Q1至2026Q3入市有哪些','CBD未来供应预计在2026Q3至2027Q1入市有哪些并列出客户','2026Q3CBD未来供应面积汇总'])expect(resolveBusinessQuestion(q,new Date()).kind).toBe('clarification');
  expect(futureLaunchRangeSchema.safeParse({...range,end:{year:2025,quarter:4}}).success).toBe(false);
  expect(()=>parseQueryPlan({operation:'future_observation',view:'summary',period:{year:2026,quarter:3},launchRange:range,scope:{inventory:'future'}})).toThrow();
 });
});
