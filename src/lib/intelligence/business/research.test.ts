import {assertStackingModelObservation} from '../../../../scripts/verification/stacking-model-disclosure.mjs';
import {randomUUID} from 'node:crypto';
import {describe,it,expect} from 'vitest';
import * as XLSX from 'xlsx';
import {businessPlanSchema,businessSnapshotSchema,BUSINESS_DOMAIN,profileFieldNames,type BusinessSnapshot} from './protocol';
import {buildBusinessResult,businessModelObservation,recheckBusinessResults} from './research';
import {resultViewSchema} from '../query/presentation';
import {resultBuildingRows} from '../query/buildingCards';
import {runResultPresentationTool} from '../agent/resultTools';
import {readBuildingContext} from '../query/buildingContext';
import {AuthorizedResultWorkset} from '../agent/resultWorkset';
import {prepareExportResult} from '../agent/exportTableTool';
import {buildResultArtifact} from '../query/artifacts';
import type {SupabaseClient} from '@supabase/supabase-js';
const id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',hash='a'.repeat(64),requestId=randomUUID();
const plan=businessPlanSchema.parse({tool:'query_building_dossier',buildingIds:[id],fields:['district','address','completionYear','completionDate','leasableArea','gfaTotal','floors','parking']});
const evidence=(table:string,values:Record<string,string|null>,record=id)=>({table,id:record,version:hash,recordedAt:null,asOf:null,period:null,values});
const snap=():BusinessSnapshot=>businessSnapshotSchema.parse({allowed:true,version:BUSINESS_DOMAIN,permission_revision:hash,export:true,records:[{id,name:'合成A座',buildingId:id,data:[evidence('buildings',{name:'合成A座',district:'合成区',completionYear:'2015',leasableArea:'8800'}),evidence('building_brochure_data',{address:'=恶意公式()',completionDate:'2016-03-01',gfaTotal:'12345.670',floors:'36',parking:'0'},randomUUID())]}]});
describe('controlled business research',()=>{
 it('registers strict field/module plans without SQL, coordinates or sensitive fields',()=>{
  for(const fields of [['owner'],['contact_phone'],['tenant_name']])expect(()=>businessPlanSchema.parse({...plan,fields})).toThrow();
  expect(()=>businessPlanSchema.parse({...plan,sql:'select *'})).toThrow();
  expect(businessPlanSchema.parse({...plan,fields:profileFieldNames})).toHaveProperty('fields',profileFieldNames);
  expect(()=>businessPlanSchema.parse({...plan,fields:['address','address']})).toThrow();
  expect(()=>businessPlanSchema.parse({tool:'query_future_supply',source:'submitted_quarter',submarkets:['CBD']})).toThrow();
  expect(()=>businessPlanSchema.parse({tool:'query_stacking_plan',buildingIds:[id],patch:{tenant:'x'}})).toThrow();
 });
 it('retains canonical identity, separate source area/date bases, numeric zero and original evidence',()=>{
  const r=buildBusinessResult(snap(),plan),c=r.table.rows[0].cells;
  expect(c.gfaTotal).toMatchObject({kind:'number',value:{numeric:12345.67}});expect(c.leasableArea).toMatchObject({kind:'number',value:{numeric:8800}});
  expect(c.parking).toMatchObject({kind:'number',value:{numeric:0}});expect(c.completionYear).toMatchObject({value:'2015'});expect(c.completionDate).toMatchObject({value:'2016-03-01'});
  expect(resultBuildingRows(resultViewSchema.parse(r))).toMatchObject([{id,name:'合成A座'}]);expect(r.sources.find(s=>s.field==='gfa_total')?.table).toBe('building_brochure_data');
 });
 it('binds periods to actual metric records and physical source columns, not a fabricated building-level metric ID',()=>{
  const s=snap(),second=randomUUID(),third=randomUUID();
  s.records[0].data.push({...evidence('building_metrics',{availablePeriods:'2026Q3'},second),period:{year:2026,quarter:3}},
   {...evidence('building_metrics',{availablePeriods:'2026Q2'},third),period:{year:2026,quarter:2}});
  const r=buildBusinessResult(s,businessPlanSchema.parse({...plan,fields:['completionYear','gfaTotal','availablePeriods']}));
  expect(r.table.rows[0].cells.availablePeriods).toMatchObject({kind:'text',value:'2026Q2、2026Q3'});
  expect(r.sources.find(s=>s.table==='buildings'&&s.field==='completion_year')).toBeDefined();
  const metrics=r.sources.filter(s=>s.table==='building_metrics');
  expect(metrics.map(s=>s.recordId).sort()).toEqual([second,third].sort());
  expect(metrics.every(s=>s.field.includes('record_year')&&s.period?.year===2026&&typeof s.rawValue==='object')).toBe(true);
 });
 it('does not choose newest brochure candidate or confuse missing with zero; decimal equivalence is exact',()=>{
  const s=snap();s.records[0].data.push(evidence('building_brochure_data',{gfaTotal:'12345.67',floors:'38',parking:null},randomUUID()));
  const c=buildBusinessResult(s,plan).table.rows[0].cells;
  expect(c.gfaTotal.kind).toBe('number');expect(c.floors).toMatchObject({kind:'unknown',state:'conflict'});expect(c.parking).toMatchObject({kind:'unknown',state:'unverified'});
  s.records[0].data[1].values.gfaTotal='bogus';expect(buildBusinessResult(s,plan).table.rows[0].cells.gfaTotal).toMatchObject({state:'invalid'});
  s.records[0].data[1].values.address=null;expect(buildBusinessResult(s,plan).table.rows[0].cells.address).toMatchObject({state:'missing'});
 });
 it('reuses existing height/floor/parking numeric domains and rejects fractional counts while retaining a real zero parking count',()=>{
  const s=snap();Object.assign(s.records[0].data[1].values,{height:'0',floors:'0',parking:'0.5',floorsAbove:'36.5'});
  const fields=['height','floors','parking','floorsAbove'] as const;
  const p=businessPlanSchema.parse({...plan,fields:[...fields]});
  const invalid=buildBusinessResult(s,p).table.rows[0].cells;
  for(const key of fields)expect(invalid[key]).toMatchObject({kind:'unknown',state:'invalid'});
  Object.assign(s.records[0].data[1].values,{height:'210',floors:'36.0',parking:'0',floorsAbove:'36'});
  const valid=buildBusinessResult(s,p).table.rows[0].cells;
  expect(valid.parking).toMatchObject({kind:'number',value:{numeric:0}});expect(valid.floors).toMatchObject({kind:'number',value:{numeric:36}});
 });
 it('uses the full existing editorial release gate, including internal text in fact/insight arrays',()=>{
  const profile=businessPlanSchema.parse({tool:'query_submarket_profile',submarkets:['CBD']});const s=snap(),row=s.records[0];row.id='CBD';row.name='CBD';row.buildingId=null;
  const v={name:'CBD',published:'true',headline:'市场定位',overview:'静态介绍',industries:'产业描述',transport:'交通条件'};row.data=[evidence('map_submarket_profiles',v,'CBD')];row.editorial={...v,insights:[]};
  expect(buildBusinessResult(s,profile).table.rows).toHaveLength(1);
  row.editorial.insights=[{title:'内部草稿',body:'未确认观点',author:'合成编辑',asOf:'2026'}];expect(buildBusinessResult(s,profile).table.rows).toHaveLength(0);
  row.data[0].values.published='false';expect(buildBusinessResult(s,profile).table.rows).toHaveLength(0);
 });
 it('keeps submitted supply separate from catalog and preserves uncertain stacking source states without provider details',()=>{
  const s=snap();s.records[0].data=[evidence('future_supplies',{name:'合成供应',catalogArea:'50000'}),evidence('future_supply_submissions',{submittedArea:'49000',submissionPeriod:'2026Q3'})];
  const r=buildBusinessResult(s,businessPlanSchema.parse({tool:'query_future_supply',submarkets:['CBD'],source:'latest_submitted'}));
  expect(r.table.rows[0].cells.catalogArea).toMatchObject({value:{numeric:50000}});expect(r.table.rows[0].cells.submittedArea).toMatchObject({value:{numeric:49000}});
  s.records[0].data=[evidence('buildings',{building:'合成A座'}),evidence('stacking_plan_spaces',{unit:'1001',status:'vacant',verification:'source_unverified',unitArea:'600'}),evidence('stacking_plan_sources',{sourceDate:null,dateKind:'unknown',review:'pending_source_date'})];
  const stack=buildBusinessResult(s,businessPlanSchema.parse({tool:'query_stacking_plan',buildingIds:[id]}));expect(stack.table.rows[0].cells.sourceDate.kind).toBe('unknown');
  expect(stack.table.rows[0].cells.verification).toMatchObject({value:'来源未核验'});assertStackingModelObservation(businessModelObservation(stack));
  expect(resultBuildingRows(resultViewSchema.parse(stack))).toMatchObject([{id,name:'合成A座'}]);
  const selected=prepareExportResult([stack],{resultIds:[stack.resultId],format:'xlsx',fields:['unit','unitArea']});
  expect(resultBuildingRows(resultViewSchema.parse(selected))).toHaveLength(0);
  const empty={...stack,table:{...stack.table,rows:[]}};
  expect(resultBuildingRows(resultViewSchema.parse(empty))).toHaveLength(0);
 });
 it('maps selected source-bound buildings without arbitrary IDs, coordinate inputs or 20-row clipping',async()=>{
  const s=snap();s.records=Array.from({length:25},(_,i)=>{const key='aaaaaaaa-aaaa-4aaa-8aaa-'+String(i+1).padStart(12,'0');return {id:key,name:'合成楼'+i,buildingId:key,data:[evidence('buildings',{name:'合成楼'+i},key)]};});
  const p=businessPlanSchema.parse({tool:'query_building_dossier',buildingIds:[id],fields:['district']});const r=buildBusinessResult(s,p);
  const chosen=runResultPresentationTool('prepare_map_selection',requestId,r,{intent:'only',buildingIds:[s.records[24].id,s.records[1].id]}).result!;
  expect(chosen.parameters.agentMap).toMatchObject({intent:'only',buildingIds:[s.records[24].id,s.records[1].id]});
  expect(JSON.parse(runResultPresentationTool('prepare_map_selection',requestId,r).content).buildingCount).toBe(25);
  expect(()=>runResultPresentationTool('prepare_map_selection',requestId,r,{buildingIds:[randomUUID()]})).toThrow('QUERY_DENIED');
  expect(()=>runResultPresentationTool('prepare_map_selection',requestId,r,{intent:'focus'})).toThrow();
  const client={from:()=>({select:()=>({in:()=>({eq:()=>({eq:()=>({is:()=>({or:()=>({abortSignal:async()=>({data:[],error:null})})})})})})})})} as unknown as SupabaseClient;
  const context=await readBuildingContext(client,chosen,{requestId,action:'buildings',mapSelection:true,offset:0,limit:500},new AbortController().signal);
  expect(context.total).toBe(2);expect(context.buildings.every(b=>!b.located)).toBe(true);
 });
 it('real XLSX readback preserves full authorized cells, Chinese labels, numerical types and formula defense',async()=>{
  const r=buildBusinessResult(snap(),plan), exported=prepareExportResult([r],{resultIds:[r.resultId],format:'xlsx',singleSheet:true});
  const file=await buildResultArtifact(exported,{requestId,resultId:exported.resultId,action:'export',format:'xlsx'});expect(file.type).toBe('download');if(file.type!=='download')throw new Error();
  const book=XLSX.read(file.bytes,{type:'buffer'});expect(book.SheetNames).toHaveLength(1);const cells=Object.values(book.Sheets[book.SheetNames[0]]);
  expect(cells.some(c=>c&&typeof c==='object'&&'v'in c&&c.v===12345.67&&c.t==='n')).toBe(true);
  expect(cells.some(c=>c&&typeof c==='object'&&'v'in c&&String(c.v).includes('合成A座'))).toBe(true);
  expect(cells.some(c=>c&&typeof c==='object'&&'f'in c)).toBe(false);
 });
 it('rechecks snapshot changes and independent export revocation',async()=>{
  const s=snap(),r=buildBusinessResult(s,plan),identity={actorId:id,effectiveUserId:id,sessionId:id,expiresAt:Date.now()+60000};
  const client={rpc:()=>({abortSignal:async()=>({data:s,error:null})})} as unknown as SupabaseClient;
  await recheckBusinessResults(client,identity,new AbortController().signal,[r],true);
  s.export=false;await expect(recheckBusinessResults(client,identity,new AbortController().signal,[r],true)).rejects.toThrow('QUERY_DENIED');
  const queryOnly=buildBusinessResult(s,plan);
  await recheckBusinessResults(client,identity,new AbortController().signal,[queryOnly]);
  await expect(recheckBusinessResults(client,identity,new AbortController().signal,[queryOnly],true)).rejects.toThrow('QUERY_DENIED');
 });
});


describe('Stacking model disclosure contract assertions',()=>{
 const stackingResult=()=>{
  const s=snap();s.records[0].data=[evidence('buildings',{building:'合成A座'}),evidence('stacking_plan_spaces',{unit:'1001',status:'vacant',verification:'source_unverified',unitArea:'600'})];
  const result=buildBusinessResult(s,businessPlanSchema.parse({tool:'query_stacking_plan',buildingIds:[id]}));
  return {...result,resultId:'60010010-0000-4000-8000-000000000600'};
 };
 const observation=()=>businessModelObservation(stackingResult());
 it('accepts an actual safe observation whose result identifier contains private fixture digits',()=>{
  expect(()=>assertStackingModelObservation(observation())).not.toThrow();
 });
 it('accepts count and workset identity metadata without treating it as unit contents',()=>{
  const owner={requestId:'60010010-0000-4000-8000-000000000600',actorId:id,effectiveUserId:id,sessionId:id,permissionRevision:hash,policyVersion:'test'};
  const result={...stackingResult(),createdAt:'2026-11-23T18:00:00.600Z'};
  const safe={...businessModelObservation(result),rowCount:600,workset:new AuthorizedResultWorkset(owner).register(result,owner)};
  expect(()=>assertStackingModelObservation(safe)).not.toThrow();
  expect(()=>assertStackingModelObservation({...safe,workset:{...safe.workset,rows:[{unit:'2002'}]}})).toThrow();
 });
 it.each(['preview','rows','table','cells'])('rejects private row data through %s',key=>{
  const safe={...observation(),resultId:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'};
  expect(()=>assertStackingModelObservation({...safe,[key]:[{unit:'1001',unitArea:600}]})).toThrow();
 });
});

it('rejects Stacking rows even when the leaked record differs from the seeded private values',()=>{
 expect(()=>assertStackingModelObservation({status:'ready',resultId:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',dataDomain:'business-research/1',rowCount:1,columns:[],limitations:[],note:'管理员表格',preview:[{unit:'2002',unitArea:700}]})).toThrow();
});
