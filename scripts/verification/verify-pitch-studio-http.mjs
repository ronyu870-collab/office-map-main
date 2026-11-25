// Actual GoTrue, PostgREST, Storage and production-built Next route. This accepts
// only the disposable localhost stack; keys never enter argv or printed output.
import assert from 'node:assert/strict';
import { randomUUID, randomBytes } from 'node:crypto';
import { readFile, mkdir, open } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createClient } from '@supabase/supabase-js';
import pg from 'pg';
import JSZip from 'jszip';
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
 await db.query(await readFile('supabase/migrations/20261125165826_pitch_studio_foundation.sql','utf8'));
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
   const theme={...row.definition,version:2};
   await db.query('insert into pitch_theme_versions(theme_id,version,definition,sha256) values($1,2,$2,$3)',['colliers-default-v1',theme,'a'.repeat(64)]);
   await db.query('update pitch_design_themes set current_version=2 where id=$1',['colliers-default-v1']);
   const upgraded=randomUUID();const out=await call(owner,{action:'project_theme_upgrade',sourceProjectId:projectId,projectId:upgraded,expectedVersion:1,themeId:'colliers-default-v1',themeVersion:2},true);
   assert.equal(out.status,200,JSON.stringify(out.body));
   assert.equal((await call(owner,{action:'get_project',projectId})).body.slides[0].theme_version,1);
   assert.equal((await call(owner,{action:'get_project',projectId:upgraded})).body.slides[0].theme_version,2);
   assert.equal((await call(owner,{action:'export',projectId:upgraded,audience:'internal'},true)).status,200);
 });
 await check('revoked grants block recovery, raw RLS and previously archived download',async()=>{
   await db.query('update private.pitch_grants set enabled=false where user_id=$1',[owner.id]);
   assert.equal((await call(owner,{action:'get_project',projectId})).status,403);
   assert.equal((await call(owner,{action:'download',projectId,exportId:artifact.exportId,audience:'internal'})).status,403);
   assert.equal((await owner.client.from('pitch_projects').select('id')).data.length,0);
 });
 console.log(`PASS ${count} real Auth/PostgREST/Storage/production Next HTTP scenarios; isolated synthetic data only`);
}finally{
 if(server&&server.exitCode===null){const stopped=once(server,'exit');server.kill('SIGTERM');await stopped;}
 await log.close();await db.end();
}
