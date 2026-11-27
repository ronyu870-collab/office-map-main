// Actual GoTrue, PostgREST, Storage and production-built Next route. This accepts
// only the disposable localhost stack; keys never enter argv or printed output.
import assert from 'node:assert/strict';
import {verifyPitchEcosystem} from './pitch-ecosystem-scenarios.mjs';
import {verifyPitchAi} from './verify-pitch-ai-http.mjs';
import {verifyPitchWorkspace} from './pitch-workspace-scenarios.mjs';
import {verifyPitchBusiness} from './pitch-business-scenarios.mjs';
import {verifyPitchDocumentDelivery} from './pitch-document-delivery-scenarios.mjs';
import { loadPitchMigrations } from '../../supabase/tests/pitch-studio/migrations.mjs';
import { randomUUID, randomBytes, createHash } from 'node:crypto';
import { readFile, mkdir, open } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createClient } from '@supabase/supabase-js';
import pg from 'pg';
import JSZip from 'jszip';
import { PDFDocument } from 'pdf-lib';
import { materialFixtures, NOTE_SECRET, HIDDEN_SECRET } from '../../supabase/tests/pitch-studio/library-fixtures.mjs';
assert.equal(process.env.PITCH_TEST_ALLOW_LOCAL,'disposable');
const settings=JSON.parse(await readFile(process.env.PITCH_AUTH_STATUS,'utf8'));
for(const value of [settings.API_URL,settings.DB_URL])assert.equal(new URL(value).hostname,'127.0.0.1');
const service=createClient(settings.API_URL,settings.SERVICE_ROLE_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
const db=new pg.Client({connectionString:settings.DB_URL});await db.connect();
assert.equal(Math.floor(Number((await db.query("select current_setting('server_version_num') n")).rows[0].n)/10000),17);
const app='http://127.0.0.1:3291',scope={organizationId:'synthetic-org',region:'test-region',city:'test-city',businessLine:'test-line'};
await mkdir('tmp',{recursive:true});const log=await open('tmp/pitch-http.log','w',0o600);let server;let count=0;
const check=async(name,fn)=>{await fn();count++;console.log('PASS '+name);};
const pause=ms=>new Promise(r=>setTimeout(r,ms));
async function until(fn,label){const start=Date.now();while(!await fn()){assert.ok(Date.now()-start<60000,'Timeout: '+label);await pause(200);}}
async function person(role){
 const email=`pitch-${randomUUID()}@example.invalid`,password=randomBytes(24).toString('base64url')+'aA1!';
 const created=await service.auth.admin.createUser({email,password,email_confirm:true,user_metadata:{role:'admin'}});assert.equal(created.error,null);
 const id=created.data.user.id;
 await db.query('insert into public.user_roles(user_id,role) values($1,$2) on conflict(user_id) do update set role=excluded.role',[id,role]);
 const client=createClient(settings.API_URL,settings.ANON_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
 const signed=await client.auth.signInWithPassword({email,password});assert.equal(signed.error,null);
 return {id,token:signed.data.session.access_token,client};
}
async function call(who,input,write=false,extra={}){
 const res=await fetch(app+'/api/intelligence/pitch'+(write?'':'?'+new URLSearchParams(input)),{method:write?'POST':'GET',headers:{...(who?{Authorization:'Bearer '+who.token}:{}),...(write?{'Content-Type':'application/json'}:{}),...extra},...(write?{body:JSON.stringify(input)}:{})});
 const body=res.headers.get('content-type')?.includes('application/json')?await res.json():new Uint8Array(await res.arrayBuffer());
 return {status:res.status,body,headers:res.headers};
}
try {
 await db.query(`create schema if not exists private;
   create table if not exists public.user_roles(user_id uuid primary key references auth.users(id),role text not null,email text,chinese_name text,full_name text);
   grant select on public.user_roles to service_role;
 `);
 await loadPitchMigrations(db);
 await db.query("notify pgrst,'reload schema'");
 const owner=await person('editor'),other=await person('editor'),viewer=await person('viewer'),admin=await person('admin');
 const env={...process.env,NEXT_PUBLIC_SUPABASE_URL:settings.API_URL,NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:settings.ANON_KEY,SUPABASE_SECRET_KEY:settings.SERVICE_ROLE_KEY,PITCH_STUDIO_ENABLED:'true',DEEPSEEK_API_KEY:'',OPENAI_API_KEY:'',NEXT_PUBLIC_AMAP_KEY:'syntheticfixture'};
 if(process.env.PITCH_TEST_REUSE_BUILD!=='true'){
   const build=spawn('npm',['run','build'],{env,stdio:['ignore',log.fd,log.fd]});assert.equal((await once(build,'exit'))[0],0,'Production build');
 }
 server=spawn(process.execPath,['node_modules/next/dist/bin/next','start','--hostname','127.0.0.1','--port','3291'],{env,stdio:['ignore',log.fd,log.fd]});
 await until(async()=>{try{return (await call(null,{action:'catalog'})).status===401;}catch{return false;}},'Next startup');
 await check('real Auth denies anonymous, malformed, forged and simulated identities',async()=>{
   assert.equal((await call(null,{action:'catalog'})).status,401);
   assert.equal((await call({token:'invalid'},{action:'catalog'})).status,401);
   assert.equal((await call(owner,{action:'catalog'},false,{'x-colliers-impersonate-user':owner.id})).status,401);
   assert.equal((await call(admin,{action:'catalog'},false,{'x-colliers-impersonate-user':owner.id})).status,401);
 });
 await check('default closed pilot and ungranted role ignore forged user_metadata admin',async()=>{
   assert.equal((await call(owner,{action:'catalog'})).status,403);await db.query('update private.pitch_control set enabled=true');
   assert.equal((await call(owner,{action:'catalog'})).status,403);
 });
 for(const who of [owner,other,viewer,admin])await db.query(`insert into private.pitch_grants(user_id,organization_id,region,city,business_line,can_generate,maintainer,valid_until,granted_by)
   values($1,'synthetic-org',$2,'test-city','test-line',true,false,now()+interval '1 day',$3)`,[who.id,who===other?'other-region':'test-region',admin.id]);
 await check('real PostgREST permissions/RLS hide raw writes and private storage',async()=>{
   const catalog=await call(owner,{action:'catalog'});assert.equal(catalog.status,200,JSON.stringify(catalog.body));
   const mutation=await owner.client.from('pitch_content_assets').insert({});assert.ok(mutation.error);
   const direct=await owner.client.rpc('pitch_studio_access',{p_actor:owner.id,p_session:randomUUID(),p_input:{action:'catalog'}});assert.ok(direct.error);
   assert.match(catalog.headers.get('cache-control'),/no-store/);
 });
 let assetId,projectId,artifact;
 await check('actual Storage original/media upload and sample asset transaction',async()=>{
   const requestId=randomUUID();const out=await call(owner,{action:'sample_create',requestId,scope},true);assert.equal(out.status,200,JSON.stringify(out.body));assetId=out.body.assetId;
   assert.equal((await call(owner,{action:'sample_create',requestId,scope},true)).body.assetId,assetId);
   const docs=(await db.query('select storage_path from pitch_source_documents where created_by=$1',[owner.id])).rows;
   assert.equal(docs.length,1);
   const denied=await owner.client.storage.from('pitch-studio-private').download(docs[0].storage_path);assert.ok(denied.error);
   assert.equal((await call(viewer,{action:'sample_create',requestId:randomUUID(),scope},true)).status,403);
 });
 await check('API rejects extra code, wrong language, oversized body and cross-origin writes',async()=>{
   const input={action:'project_create',projectId:randomUUID(),assetId,title:'Synthetic Pitch',templateId:'basic-text-image',templateVersion:1,themeId:'colliers-default-v1',themeVersion:1,parameters:{language:'zh'}};
   assert.equal((await call(owner,{...input,parameters:{language:'zh',execute:'SQL'}},true)).status,400);
   assert.equal((await call(owner,{...input,parameters:{language:'en'}},true)).status,422);
   assert.equal((await call(owner,{...input,title:'x'.repeat(30000)},true)).status,413);
   assert.equal((await call(owner,input,true,{Origin:'https://foreign.invalid'})).status,403);
 });
 await check('create / reopen standard page fixes source, layout and theme versions',async()=>{
   projectId=randomUUID();const out=await call(owner,{action:'project_create',projectId,assetId,title:'测试 Pitch · 非真实案例',templateId:'basic-text-image',templateVersion:1,themeId:'colliers-default-v1',themeVersion:1,parameters:{language:'zh'}},true);
   assert.equal(out.status,200,JSON.stringify(out.body));
   const opened=await call(owner,{action:'get_project',projectId});assert.equal(opened.status,200);assert.equal(opened.body.slides.length,1);assert.equal(opened.body.slides[0].theme_version,1);
   assert.equal((await call(other,{action:'get_project',projectId})).status,403);
   assert.equal((await other.client.from('pitch_projects').select('id')).data.length,0);
 });
 await check('actual PPTX renders, archives to Storage, downloads and verifies editable XML',async()=>{
   const out=await call(owner,{action:'export',projectId,audience:'internal'},true);assert.equal(out.status,200,JSON.stringify(out.body));artifact=out.body;
   const download=await call(owner,{action:'download',projectId,exportId:artifact.exportId,audience:'internal'});assert.equal(download.status,200,JSON.stringify(download.body));
   const zip=await JSZip.loadAsync(download.body);assert.ok(zip.file('ppt/slides/slide1.xml'));
   assert.match(await zip.file('ppt/slides/slide1.xml').async('string'),/测试数据/);
   const stored=await db.query('select state,sha256 from pitch_exports where id=$1',[artifact.exportId]);assert.equal(stored.rows[0].state,'ready');assert.equal(stored.rows[0].sha256,artifact.sha256);
   assert.equal((await call(owner,{action:'export',projectId,audience:'client'},true)).status,403);
 });
 await check('explicit theme upgrade preserves original and re-renders an archived new version',async()=>{
   const row=(await db.query('select definition from pitch_theme_versions where theme_id=$1 and version=1',['colliers-default-v1'])).rows[0];
   const theme={...row.definition,version:3};
   await db.query('insert into pitch_theme_versions(theme_id,version,definition,sha256) values($1,3,$2,$3)',['colliers-default-v1',theme,'a'.repeat(64)]);
   await db.query('update pitch_design_themes set current_version=3 where id=$1',['colliers-default-v1']);
   const upgraded=randomUUID();const out=await call(owner,{action:'project_theme_upgrade',sourceProjectId:projectId,projectId:upgraded,expectedVersion:1,themeId:'colliers-default-v1',themeVersion:3},true);
   assert.equal(out.status,200,JSON.stringify(out.body));
   assert.equal((await call(owner,{action:'get_project',projectId})).body.slides[0].theme_version,1);
   assert.equal((await call(owner,{action:'get_project',projectId:upgraded})).body.slides[0].theme_version,3);
   assert.equal((await call(owner,{action:'export',projectId:upgraded,audience:'internal'},true)).status,200);
 });
 let studioProject, studioExport;
 await check('all twelve real fixture assets compose into persisted editable pages and authorized scene previews',async()=>{
   const layouts=['cover','section-divider','image-text','two-columns','kpi','team-profile','case-study','data-table','chart-insight','comparison','map-analysis','strategy-framework'],parts=[];
   for(const [i,layoutId] of layouts.entries()){
     const out=await call(owner,{action:'sample_create',requestId:randomUUID(),scope,fixture:layoutId,language:i%2?'en':'zh'},true);assert.equal(out.status,200,JSON.stringify(out.body));parts.push({assetId:out.body.assetId,layoutId,variant:'standard'});
   }
   studioProject=randomUUID();const out=await call(owner,{action:'project_compose',projectId:studioProject,title:'十二类布局 Test Deck',parts,themeId:'colliers-default-v1',themeVersion:2},true);assert.equal(out.status,200,JSON.stringify(out.body));
   const opened=await call(owner,{action:'get_project',projectId:studioProject});assert.equal(opened.body.slides.length,12);assert.equal(opened.body.slides[11].scene.elements.find(e=>e.purpose==='footer').text,'12');
   const preview=await call(owner,{action:'preview',projectId:studioProject,page:8,layoutId:'chart-insight',variant:'alternate',themeId:'colliers-render-verification',themeVersion:1},true);assert.equal(preview.status,200,JSON.stringify(preview.body));assert.match(preview.body.svg,/<svg/);assert.equal(preview.body.scene.themeId,'colliers-render-verification');
   assert.equal((await call(other,{action:'preview',projectId:studioProject,page:0},true)).status,403);
   assert.equal((await call(owner,{action:'preview',projectId:studioProject,page:0,scene:{execute:'JS'}},true)).status,400);
   assert.equal((await call(owner,{action:'export',projectId:studioProject,audience:'internal'},true)).status,422);
 });
 for(const format of ['pptx','pdf','png','svg','xlsx'])await check(`real background ${format} export acknowledges HTTP, records durable progress and downloads exact archived bytes`,async()=>{
   const exportId=randomUUID(),input={action:'export_start',projectId:studioProject,exportId,audience:'internal',format,...(['pptx','pdf'].includes(format)?{}:{page:7})};
   const out=await call(owner,input,true);assert.equal(out.status,202,JSON.stringify(out.body));
   let status;await until(async()=>{status=await call(owner,{action:'export_status',projectId:studioProject,exportId});assert.equal(status.status,200,JSON.stringify(status.body));assert.notEqual(status.body.state,'failed',JSON.stringify(status.body));return status.body.state==='ready';},'durable '+format);
   assert.equal(status.body.progress,100);assert.ok(status.body.filename.endsWith('.'+format));
   const file=await call(owner,{action:'download',projectId:studioProject,exportId,audience:'internal'});assert.equal(file.status,200,JSON.stringify(file.body));assert.match(file.headers.get('content-disposition'),/filename\*=UTF-8/);
   if(format==='pptx'){const zip=await JSZip.loadAsync(file.body);assert.equal(Object.keys(zip.files).filter(n=>/^ppt\/slides\/slide\d+[.]xml$/.test(n)).length,12);studioExport=exportId;}
   if(format==='pdf'){assert.equal(file.headers.get('content-type'),'application/pdf');assert.equal((await PDFDocument.load(file.body)).getPageCount(),12);}
   if(format==='png')assert.deepEqual([...file.body.slice(0,8)],[137,80,78,71,13,10,26,10]);
   if(format==='svg')assert.match(new TextDecoder().decode(file.body),/<svg/);
   if(format==='xlsx'){const zip=await JSZip.loadAsync(file.body);assert.ok(zip.file('xl/workbook.xml'));}
 });
 await verifyPitchDocumentDelivery({app,db,owner,other,viewer,scope,call,check,until,studioProject,studioExport});
 async function library(who,input,write=false){
  const res=await fetch(app+'/api/intelligence/pitch/library'+(write?'':'?'+new URLSearchParams(input)),{method:write?'POST':'GET',headers:{Authorization:'Bearer '+who.token,...(write?{'Content-Type':'application/json'}:{})},...(write?{body:JSON.stringify(input)}:{})});
  return {status:res.status,body:res.headers.get('content-type')?.includes('application/json')?await res.json():new Uint8Array(await res.arrayBuffer())};
 }
 await check('real library chunk upload, hash preservation and resumable after-response page parser',async()=>{
  await db.query('update private.pitch_grants set maintainer=true where user_id=$1',[owner.id]);
  const f=await materialFixtures(),category=(await call(owner,{action:'catalog'})).body.categories.find(c=>c.system_code==='general');
  const input={action:'prepare',requestId:randomUUID(),filename:'隔离历史素材.pptx',mime:'application/vnd.openxmlformats-officedocument.presentationml.presentation',size:f.pptx.length,sha256:createHash('sha256').update(f.pptx).digest('hex'),metadata:{scope,language:'zh',dataAsOf:'2025-12-31',validFrom:null,validUntil:null,visibility:'organization',source:'隔离 HTTP 测试，无真实客户',tags:['隔离测试'],categoryId:category.id,isTestData:true,allowClientExport:false}};
  assert.equal((await library(viewer,input,true)).status,403);
  const prepared=await library(owner,input,true);assert.equal(prepared.status,200,JSON.stringify(prepared.body));const {job,documentId}=prepared.body;
  for(let position=0;position<Math.ceil(f.pptx.length/786432);position++){const res=await fetch(app+`/api/intelligence/pitch/library?jobId=${job.id}&position=${position}`,{method:'PUT',headers:{Authorization:'Bearer '+owner.token,'Content-Type':'application/octet-stream'},body:f.pptx.slice(position*786432,(position+1)*786432)});assert.equal(res.status,200,await res.text());}
  assert.equal((await library(owner,{action:'finish',jobId:job.id},true)).status,202);
  let status;await until(async()=>{status=await library(owner,{action:'status',jobId:job.id});assert.equal(status.status,200,JSON.stringify(status.body));assert.notEqual(status.body.job.state,'failed',JSON.stringify(status.body));if(status.body.job.state==='queued')await library(owner,{action:'step',jobId:job.id},true);return ['completed','partially_completed'].includes(status.body.job.state);},'library parser');assert.equal(status.body.job.cursor,4);
  assert.equal((await library(owner,input,true)).body.documentId,documentId);
  const original=await library(owner,{action:'original',documentId});assert.equal(original.status,200);assert.equal(createHash('sha256').update(original.body).digest('hex'),input.sha256);
  const pages=await library(owner,{action:'search',kind:'pages',documentId});assert.equal(pages.body.items.length,4);assert.equal((await library(viewer,{action:'search',kind:'pages',documentId})).body.items.length,0);
  const items=pages.body.items.map(p=>({assetId:p.asset_id,expectedVersion:1}));assert.equal((await library(owner,{action:'confirm',items,acknowledgePartial:false},true)).status,409);assert.equal((await library(owner,{action:'confirm',items,acknowledgePartial:true},true)).status,200);
  const results=await library(viewer,{action:'search',kind:'pages',documentId,q:'案例'});assert.equal(results.status,200);assert.equal(results.body.items.length,1);assert.equal((await library(viewer,{action:'original',documentId})).status,403);
  const sourcePage=results.body.items[0],detail=await library(viewer,{action:'page',pageId:sourcePage.id});assert.equal(detail.body.document.sha256,input.sha256);assert.doesNotMatch(JSON.stringify(detail.body.page),new RegExp(NOTE_SECRET+'|'+HIDDEN_SECRET));
  const assetId=sourcePage.asset_id,prior=await library(owner,{action:'asset',assetId,version:2});
  assert.equal(prior.status,200,JSON.stringify(prior.body));
  const {asset}=prior.body,title='新发布的隔离案例标题';
  const revised={scope,categoryId:asset.category_id,tags:asset.tags,names:{zh:title},content:{...prior.body.version.content,title},
   state:'published',visibility:asset.visibility,allowInternalGeneration:asset.allow_internal_generation,
   allowClientExport:asset.allow_client_export,allowExternalAi:asset.allow_external_ai,validFrom:asset.valid_from,validUntil:asset.valid_until};
  const published=await library(owner,{action:'save_asset',assetId,expectedVersion:2,asset:revised,acknowledgePartial:true},true);
  assert.equal(published.status,200,JSON.stringify(published.body));
  const normalized=randomUUID(),request={action:'normalize',assetId,assetVersion:2,projectId:normalized,
   title:'隔离历史案例标准化',themeId:'colliers-default-v1',themeVersion:2};
  assert.equal((await library(owner,{...request,assetVersion:'2'},true)).status,400);
  const generated=await library(owner,request,true);assert.equal(generated.status,200,JSON.stringify(generated.body));
  const replay=await library(owner,request,true);assert.equal(replay.status,200,JSON.stringify(replay.body));assert.equal(replay.body.replayed,true);
  assert.equal((await library(owner,{...request,assetVersion:3},true)).status,409);
  const opened=await call(owner,{action:'get_project',projectId:normalized});
  assert.equal(opened.body.slides[0].source_snapshot[0].pageId,sourcePage.id);
  assert.ok(opened.body.slides.every(slide=>slide.asset_version===2&&slide.content.title===prior.body.version.content.title));
  const exportId=randomUUID();assert.equal((await call(owner,{action:'export_start',projectId:normalized,exportId,format:'pptx',audience:'internal'},true)).status,202);await until(async()=>{const value=await call(owner,{action:'export_status',projectId:normalized,exportId});assert.notEqual(value.body.state,'failed',JSON.stringify(value.body));return value.body.state==='ready';},'normalized export');const file=await call(owner,{action:'download',projectId:normalized,exportId,audience:'internal'});assert.equal(file.status,200);const zip=await JSZip.loadAsync(file.body),xml=(await Promise.all(Object.keys(zip.files).filter(n=>/^ppt\/slides\/slide\d+[.]xml$/.test(n)).map(n=>zip.file(n).async('string')))).join('');assert.match(xml,/<a:tbl>/);assert.match(xml,/测试楼 A/);
  const media=(await db.query('select m.storage_path from pitch_media_assets m join pitch_source_pages p on p.id=m.source_page_id where p.document_id=$1',[documentId])).rows;assert.ok((await viewer.client.storage.from('pitch-studio-private').download(media[0].storage_path)).error);
  await db.query('update private.pitch_grants set enabled=false where user_id=$1',[viewer.id]);assert.equal((await library(viewer,{action:'page',pageId:sourcePage.id})).status,403);
 });
 const businessResult=await verifyPitchBusiness({app,db,owner,other,admin,scope,call,library,check,until});
 await verifyPitchEcosystem({app,owner,other,scope,call,check,until});
 await verifyPitchWorkspace({app,db,owner,other,admin,scope,call,library,check,until,...businessResult});
 await verifyPitchAi({app,db,owner,other,admin,check,until});
 await check('revoked grants block recovery, raw RLS and previously archived download',async()=>{
   await db.query('update private.pitch_grants set enabled=false where user_id=$1',[owner.id]);
   assert.equal((await call(owner,{action:'download',projectId:studioProject,exportId:studioExport,audience:'internal'})).status,403);
   assert.equal((await call(owner,{action:'preview',projectId:studioProject,page:0},true)).status,403);
   assert.equal((await call(owner,{action:'get_project',projectId})).status,403);
   assert.equal((await call(owner,{action:'download',projectId,exportId:artifact.exportId,audience:'internal'})).status,403);
   assert.equal((await owner.client.from('pitch_projects').select('id')).data.length,0);
 });
 console.log(`PASS ${count} real Auth/PostgREST/Storage/production Next HTTP scenarios; isolated synthetic data only`);
}finally{
 if(server&&server.exitCode===null){const stopped=once(server,'exit');server.kill('SIGTERM');await stopped;}
 await log.close();await db.end();
}
