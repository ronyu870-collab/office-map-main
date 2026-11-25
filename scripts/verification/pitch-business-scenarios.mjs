// Actual HTTP + GoTrue + PostgREST + private Storage, synthetic sources only.
import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';
import JSZip from 'jszip';
import {businessFixture,dynamicFixture,PRIVATE_CLIENT} from '../../supabase/tests/pitch-studio/business-fixtures.mjs';
import {installPitchDataFixture} from '../../supabase/tests/pitch-studio/business-data-fixture.mjs';
import {grantQuery} from '../../supabase/tests/ai-query-authority/database.mjs';
export async function verifyPitchBusiness({app,db,owner,other,admin,scope,call,library,check,until}) {
 const business=async(who,input,write=false)=>{const res=await fetch(app+'/api/intelligence/pitch/business'+(write?'':'?'+new URLSearchParams(input)),{method:write?'POST':'GET',headers:{Authorization:'Bearer '+who.token,...(write?{'Content-Type':'application/json'}:{})},...(write?{body:JSON.stringify(input)}:{})});return {status:res.status,body:await res.json()};};
 const ids={},category=(await call(owner,{action:'catalog'})).body.categories.find(c=>c.system_code==='general').id;
 await check('business HTTP imports actual sources, maintains profiles and requires explicit publication',async()=>{
  for(const [key,kind,index] of [['corporate','corporate',0],['team','team',0],['team2','team',2],['case','case',0],['case2','case',2],['research','research',0]]) {
   const f=businessFixture(kind,index),bytes=Buffer.from(f.content.title+'\n隔离业务模板 HTTP 测试，不是实际企业资料。');
   const prepared=await library(owner,{action:'prepare',requestId:randomUUID(),filename:f.content.title+'.txt',mime:'text/plain',size:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex'),metadata:{scope,categoryId:category,tags:['隔离'],language:'zh',dataAsOf:f.content.dataAsOf,source:'隔离 HTTP 工程测试',visibility:'organization',isTestData:true,allowClientExport:false,validFrom:null,validUntil:null}},true);assert.equal(prepared.status,200,JSON.stringify(prepared.body));
   const {job,documentId}=prepared.body;
   const uploaded=await fetch(app+`/api/intelligence/pitch/library?jobId=${job.id}&position=0`,{method:'PUT',headers:{Authorization:'Bearer '+owner.token,'Content-Type':'application/octet-stream'},body:bytes});assert.equal(uploaded.status,200);
   assert.equal((await library(owner,{action:'finish',jobId:job.id},true)).status,202);
   await until(async()=>{const s=await library(owner,{action:'status',jobId:job.id});assert.notEqual(s.body.job.state,'failed',JSON.stringify(s.body));if(s.body.job.state==='queued')await library(owner,{action:'step',jobId:job.id},true);return s.body.job.state==='completed';},'business parse');
   const pages=await library(owner,{action:'search',kind:'pages',documentId}),assetId=pages.body.items[0].asset_id,original=(await library(owner,{action:'asset',assetId})).body;
   for(const c of [f.profile.display,f.profile.briefDisplay,f.profile.content].filter(Boolean)){c.sources=original.version.content.sources;for(const b of c.blocks)b.sourceIds=c.sources.map(s=>s.id);}
   const saved=await business(owner,{action:'profile_save',assetId,expectedVersion:1,profile:f.profile},true);assert.equal(saved.status,200,JSON.stringify(saved.body));
   assert.equal((await library(owner,{action:'confirm',items:[{assetId,expectedVersion:2}],acknowledgePartial:true},true)).status,200);ids[key]=assetId;
  }
  const search=await business(admin,{action:'search',kind:'case'});assert.equal(search.status,200);assert.equal(search.body.items.length,2);assert.doesNotMatch(JSON.stringify(search.body),new RegExp(PRIVATE_CLIENT));
  assert.equal((await business(other,{action:'profile',assetId:ids.case})).status,403);
 });
 let projectId,exportId;
 await check('business HTTP composes corporate, multiple team members, cases, research and actual formal data into editable PPTX',async()=>{
  if(!(await db.query("select to_regprocedure('private.ai_query_authority(uuid,uuid,uuid)') fn")).rows[0].fn)await installPitchDataFixture({setup:db});
  await db.query('update private.ai_query_control set enabled=true');await grantQuery({setup:db},admin.id,{capabilities:['query:catalog','query:brochure','query:quarter','export:internal'],fields:['height','floors','parking','totalArea','vacantArea','netEffectiveRent']});
  await db.query("notify pgrst,'reload schema'");
  const part=(templateId,assetIds)=>({mode:assetIds.length>1?'semi-dynamic':'static',templateId,assetIds,length:'detailed',allowFallback:false,variant:'standard'});
  projectId=randomUUID();const input={action:'generate',projectId,title:'隔离业务混合提案 · HTTP',scope,language:'zh',themeId:'colliers-default-v1',themeVersion:2,parts:[part('corporate-overview',[ids.corporate]),part('team-multiple',[ids.team,ids.team2]),part('case-portfolio',[ids.case,ids.case2]),part('research-page',[ids.research]),{mode:'dynamic',parameters:dynamicFixture,researchAssetId:ids.research}]};
  assert.equal((await business(owner,input,true)).status,403);
  const out=await business(admin,input,true);assert.equal(out.status,200,JSON.stringify(out.body));assert.ok(out.body.pages>=8);
  assert.equal((await business(admin,input,true)).body.projectId,projectId);
  exportId=randomUUID();assert.equal((await call(admin,{action:'export_start',projectId,exportId,audience:'internal',format:'pptx'},true)).status,202);
  await until(async()=>{const s=await call(admin,{action:'export_status',projectId,exportId});assert.notEqual(s.body.state,'failed',JSON.stringify(s.body));return s.body.state==='ready';},'business mixed PPTX');
  const file=await call(admin,{action:'download',projectId,exportId,audience:'internal'});assert.equal(file.status,200);const zip=await JSZip.loadAsync(file.body),xml=(await Promise.all(Object.values(zip.files).filter(f=>!f.dir&&f.name.endsWith('.xml')).map(f=>f.async('string')))).join('');assert.match(xml,/<c:chart/);assert.match(xml,/测试成员/);assert.doesNotMatch(xml,new RegExp(PRIVATE_CLIENT));
  const receipt=await business(admin,{action:'generation',projectId});assert.equal(receipt.status,200);assert.ok(receipt.body.bindings.length>=6);assert.ok(receipt.body.snapshots.length===1);
  assert.equal((await call(admin,{action:'export_start',projectId,exportId:randomUUID(),audience:'client',format:'pptx'},true)).status,403);
 });
 await check('business HTTP revalidates independent data permissions before old preview, RLS and download',async()=>{
  await db.query('update private.ai_query_grants set enabled=false where user_id=$1',[admin.id]);
  assert.equal((await call(admin,{action:'download',projectId,exportId,audience:'internal'})).status,403);assert.equal((await call(admin,{action:'preview',projectId,page:0},true)).status,403);assert.equal((await business(admin,{action:'generation',projectId})).status,403);const raw=await admin.client.from('pitch_business_generations').select('project_id');assert.equal(raw.error,null,JSON.stringify(raw.error));assert.equal(raw.data.length,0);
 });
 return {ids,projectId,exportId};
}
