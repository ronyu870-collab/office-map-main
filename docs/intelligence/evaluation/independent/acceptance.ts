import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
const outputDir=process.env.COLLIERS_INDEPENDENT_OUTPUT!;
import * as XLSX from 'xlsx';
import { aggregateQuarter, rankBuildings } from '../../../../src/lib/intelligence/query/analytics';
import { fixture, source, nameSource } from '../../../../src/lib/intelligence/query/__tests__/fixtures';
import { resolveNumericFact } from '../../../../src/lib/intelligence/query/facts';
import { buildListResult } from '../../../../src/lib/intelligence/query/result';
import { buildXlsx } from '../../../../src/lib/intelligence/query/exports';
import { authorizePlan } from '../../../../src/lib/intelligence/query/admission';
import { AuthorizedResultWorkset } from '../../../../src/lib/intelligence/agent/resultWorkset';
import { resolveSemanticQuestion } from '../../../../src/lib/intelligence/query/semanticPlanner';

let blockedFetches = 0;
globalThis.fetch = async () => { blockedFetches++; throw Error('INDEPENDENT_OFFLINE_NETWORK_DENIED'); };
const results: {id:string,status:string,error?:string}[] = [];
const check=async(id:string,fn:()=>unknown)=>{try{await fn();results.push({id,status:'PASS'});}catch(e){results.push({id,status:'FAIL',error:e instanceof Error?e.message:String(e)});}};
const period={year:2026,quarter:1};
const ids=['00000000-0000-4000-8000-000000000081','00000000-0000-4000-8000-000000000082','00000000-0000-4000-8000-000000000083'];
const snap={...fixture(period),snapshotId:'independent-2026Q1-v1',dataVersion:'holdout-v1',expectedCount:3,rows:ids.map((id,i)=>({
 id,name:['=中文楼甲','中文楼乙','中文楼丙'][i],nameSource:nameSource(id,['=中文楼甲','中文楼乙','中文楼丙'][i]),facts:{
 totalArea:resolveNumericFact('totalArea',id,[source(id,'totalArea',[100,300,600][i],period)],period),
 netEffectiveRent:resolveNumericFact('netEffectiveRent',id,[source(id,'netEffectiveRent',[120,240,null][i],period)],period),
 vacantArea:resolveNumericFact('vacantArea',id,[source(id,'vacantArea',[0,60,null][i],period)],period),
 }}))};
const ready=(r:ReturnType<typeof resolveSemanticQuestion>)=>{assert.equal(r.kind,'plan');if(r.kind!=='plan')throw Error('Not a plan');return r;};
// Accessors preserve JavaScript's undefined for plans without this field.
const periodOf=(plan: ReturnType<typeof ready>['plan']) => 'period' in plan ? plan.period : undefined;
const metricOf=(plan: ReturnType<typeof ready>['plan']) => 'metric' in plan ? plan.metric : undefined;
const main=async()=>{
await check('H1',()=>{
 for(const rows of [snap.rows,[...snap.rows].reverse()]){
 const input={...snap,rows};
 const rent=aggregateQuarter(input,'rent'),vacancy=aggregateQuarter(input,'vacancy'),area=aggregateQuarter(input,'totalArea');
 assert.equal(rent.value?.numeric,210);assert.equal(rent.denominator.numeric,400);
 assert.equal(vacancy.value?.numeric,.15);assert.equal(vacancy.coverage.valid,2);assert.equal(vacancy.coverage.missing,1);
 assert.equal(area.value?.numeric,1000);assert.equal(rent.unit,'CNY/m2/month');assert.equal(vacancy.unit,'ratio');
 }
});
await check('H2',()=>{
 const rows=[170,160,160,null].map((value,i)=>{const id='holdout-'+i;return {id,name:id,nameSource:nameSource(id,id),facts:{height:resolveNumericFact('height',id,[source(id,'height',value,null)],null)}}});
 for(const order of [rows,[rows[3],rows[2],rows[0],rows[1]]]){
 const ranked=rankBuildings({...fixture(period),rows:order,expectedCount:4},'height',2,'desc');
 assert.deepEqual(ranked.rows.map(x=>x.entityId),['holdout-0','holdout-1','holdout-2']);assert.deepEqual(ranked.rows.map(x=>x.rank),[1,2,2]);assert.equal(ranked.coverage.missing,1);
 }
});
await check('H3',()=>{
 const authority={actorId:'actor',effectiveUserId:'actor',sessionActive:true,policyVersion:'p',permissionRevision:'r',grants:['query:catalog','query:brochure'] as const,fields:['height'] as const};
 const plan={operation:'rank' as const,scope:{inventory:'tracked' as const,submarkets:['CBD']},field:'height' as const,period:null,direction:'desc' as const,limit:2};
 assert.doesNotThrow(()=>authorizePlan(plan,authority));
 assert.throws(()=>authorizePlan({...plan,filter:{field:'netEffectiveRent',operator:'gt',value:'200'}},authority),/QUERY_DENIED/);
 const owner={requestId:'request',actorId:'actor',effectiveUserId:'actor',sessionId:'session',permissionRevision:'r',policyVersion:'p'};
 const workset=new AuthorizedResultWorkset(owner),result=buildListResult(snap,['totalArea','netEffectiveRent']);workset.register(result,owner);
 assert.equal(workset.read(result.resultId,owner),result);
 for(const change of [{sessionId:'foreign'},{permissionRevision:'revoked'},{actorId:'foreign'}])assert.throws(()=>workset.read(result.resultId,{...owner,...change}),/QUERY_DENIED/);
});
await check('H4',async()=>{
 const result=buildListResult(snap,['netEffectiveRent','totalArea']);
 const bytes=await buildXlsx(result);await writeFile(join(outputDir,'holdout.xlsx'),bytes);
 const workbook=XLSX.read(bytes,{type:'array'}),sheet=workbook.Sheets['数据'];
 const rows=XLSX.utils.sheet_to_json<(string|number)[]>(sheet,{header:1});
 assert.equal(rows.length,4);assert.deepEqual(rows[0],['entity_id','楼宇','净有效租金 (CNY/m2/month)','季度总面积 (m2)']);
 assert.deepEqual(rows[1],[ids[0],'=中文楼甲',120,100]);assert.deepEqual(rows[2],[ids[1],'中文楼乙',240,300]);assert.deepEqual(rows[3],[ids[2],'中文楼丙','未记录',600]);
 assert.equal(sheet.B2.t,'s');assert.equal(sheet.B2.f,undefined);assert.equal(sheet.C2.t,'n');
 const metadata=JSON.stringify(XLSX.utils.sheet_to_json(workbook.Sheets['口径与快照'],{header:1}));assert.ok(metadata.includes('holdout-v1'));assert.ok(metadata.includes('2026'));
 const sources=JSON.stringify(XLSX.utils.sheet_to_json(workbook.Sheets['来源'],{header:1}));assert.ok(sources.includes(ids[0]));assert.ok(sources.includes('net_effective_rent'));
});
await check('H5',()=>{
 const options={now:new Date('2026-12-31T16:00:00Z'),availablePeriods:[{year:2026,quarter:3}]};
 const previous=ready(resolveSemanticQuestion({...options,question:'上季度CBD净有效租金'}));
 const latest=ready(resolveSemanticQuestion({...options,question:'最新有数据季度CBD净有效租金'}));
 assert.deepEqual(periodOf(previous.plan),{year:2026,quarter:4});assert.deepEqual(periodOf(latest.plan),{year:2026,quarter:3});
});
await check('H6',()=>{
 const options={now:new Date('2026-11-22T04:00:00Z'),availablePeriods:[{year:2026,quarter:1},{year:2026,quarter:2},{year:2026,quarter:3}]};
 const first=ready(resolveSemanticQuestion({...options,question:'2026Q1 CBD空置率'}));
 const second=ready(resolveSemanticQuestion({...options,question:'改到2026Q2',context:first.context}));
 const third=ready(resolveSemanticQuestion({...options,question:'金融街呢',context:second.context}));
 assert.equal(second.plan.operation,'aggregate');assert.equal(metricOf(second.plan),'vacancy');assert.deepEqual(periodOf(second.plan),{year:2026,quarter:2});assert.deepEqual(second.plan.scope.submarkets,['CBD']);
 assert.equal(metricOf(third.plan),'vacancy');assert.deepEqual(periodOf(third.plan),{year:2026,quarter:2});assert.deepEqual(third.plan.scope.submarkets,['金融街']);
 assert.equal(resolveSemanticQuestion({...options,question:'两者比较'}).kind,'clarification');
});
await writeFile(join(outputDir,'results.json'),JSON.stringify({planSha256:'4dffcb92c36a55ef9738a69d2071bc6e32403eeeb871d6aee2b799049b5c288d',evidence:'deterministic-typescript-real-file-no-auth-no-model',blockedFetches,results},null,2));
console.log(JSON.stringify({blockedFetches,results},null,2));
if(results.some(r=>r.status==='FAIL'))process.exitCode=1;
};
void main();
