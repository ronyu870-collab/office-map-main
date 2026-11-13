// Actual local GoTrue + Data API + PostgreSQL 17 + production-built Next HTTP route.
// No browser automation, mocked authentication, production URL, or model calls.
import assert from 'node:assert/strict';
import { randomUUID, randomBytes } from 'node:crypto';
import { readFile, mkdir, writeFile, open } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import path from 'node:path';
import { createRequire } from 'node:module';
import pg from 'pg';
import { createClient } from '@supabase/supabase-js';
import { rolldown } from 'rolldown';
import { grantQuery } from '../../supabase/tests/ai-query-authority/database.mjs';
import { addSnapshotFixture, BUILDINGS } from '../../supabase/tests/ai-query-authority/snapshot-fixture.mjs';

assert.equal(process.env.AI_QUERY_AUTH_ALLOW_LOCAL,'disposable');
const settings=JSON.parse(await readFile(process.env.AI_QUERY_AUTH_STATUS,'utf8'));
const apiUrl=new URL(settings.API_URL),dbUrl=new URL(settings.DB_URL);
assert.equal(apiUrl.hostname,'127.0.0.1');assert.equal(apiUrl.port,'55991');
assert.equal(dbUrl.hostname,'127.0.0.1');assert.equal(dbUrl.port,'55992');
const root=process.cwd(),output=path.join(root,'verification/ai-query-auth'),app='http://127.0.0.1:3289';
await mkdir(output,{recursive:true});
const db=new pg.Client({connectionString:settings.DB_URL});await db.connect();
const blocker=new pg.Client({connectionString:settings.DB_URL});await blocker.connect();
const withdrawal=new pg.Client({connectionString:settings.DB_URL});await withdrawal.connect();
const load=file=>readFile(path.join(root,'supabase/migrations',file),'utf8');
const service=createClient(settings.API_URL,settings.SERVICE_ROLE_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
const people=[],results=[];let server,log;
const encryptionKey=randomBytes(32),digestKey=randomBytes(32),keyId='isolated-http-v1';
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function until(fn,label,timeout=30000){const start=Date.now();while(!await fn()){if(Date.now()-start>timeout)throw new Error('Timed out: '+label);await pause(100);}}
async function check(name,fn){await fn();results.push({scenario:name,status:'passed'});console.log('PASS '+name);}
async function person(role,label){
  const email=`ai-query-${label}-${randomUUID().slice(0,8)}@example.invalid`,password=randomBytes(24).toString('base64url')+'aA1!';
  const created=await service.auth.admin.createUser({email,password,email_confirm:true,user_metadata:{role:'admin',full_name:'合成查询 '+label}});assert.equal(created.error,null);
  const entry={id:created.data.user.id,email,password};people.push(entry);
  await db.query('update public.user_roles set role=$1 where user_id=$2',[role,entry.id]);
  entry.client=createClient(settings.API_URL,settings.ANON_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
  const signed=await entry.client.auth.signInWithPassword({email,password});assert.equal(signed.error,null);entry.token=signed.data.session.access_token;
  entry.sessionId=JSON.parse(Buffer.from(entry.token.split('.')[1],'base64url')).session_id;
  assert.ok((await db.query('select id from auth.sessions where id=$1 and user_id=$2',[entry.sessionId,entry.id])).rowCount);
  return entry;
}
const rank={operation:'rank',scope:{inventory:'tracked',submarkets:['CBD']},field:'height',period:null,direction:'desc',limit:1};
const input=(plan=rank)=>({idempotencyKey:randomUUID(),question:'CBD最高的楼是什么？',plan});
async function call(who,body=input(),headers={}){
  const response=await fetch(app+'/api/intelligence/query',{method:'POST',headers:{'Content-Type':'application/json',...(who?{Authorization:'Bearer '+who.token}:{}),...headers},body:typeof body==='string'?body:JSON.stringify(body)});
  return {status:response.status,body:await response.json(),headers:response.headers};
}
const events=async id=>(await db.query('select e.*,s.actor_id,s.effective_user_id from private.ai_query_audit_events e join private.ai_query_audit_streams s using(request_id) where request_id=$1 order by sequence',[id])).rows;
try{
  const version=(await db.query('select version() v')).rows[0].v;assert.match(version,/PostgreSQL 17\./);
  if(!(await db.query("select to_regclass('private.ai_query_ingress_events') r")).rows[0].r){
    assert.equal((await db.query("select to_regclass('public.user_roles') r")).rows[0].r,null,'Only a dedicated EMPTY local project may be initialized');
    await db.query(await load('20260730043721_create_colliers_lite_schema.sql'));
    await db.query(await load('20261113003933_ai_query_audit_foundation.sql'));
    await db.query(await load('20261113023341_ai_query_authority.sql'));
    await addSnapshotFixture({setup:db},{existingTables:true});
    await db.query(await load('20261113032515_ai_query_http_security.sql'));
  }
  await db.query('update private.ai_query_control set enabled=false');
  await db.query("notify pgrst,'reload schema'");
  await until(async()=>{const p=await service.rpc('ai_query_authority',{p_actor:randomUUID(),p_effective:randomUUID(),p_session:randomUUID()});if(p.error&&p.error.code!=='PGRST202')throw new Error(p.error.message);return !p.error;},'RPC schema cache');
  const bundle=await rolldown({input:path.join(root,'src/lib/intelligence/query/auditCrypto.ts'),platform:'node'});
  try{await bundle.write({file:path.join(output,'audit-crypto.cjs'),format:'cjs'});}finally{await bundle.close();}
  const {decryptAuditContent}=createRequire(import.meta.url)(path.join(output,'audit-crypto.cjs'));
  const decrypt=e=>JSON.parse(decryptAuditContent(e.cipher,{requestId:e.request_id,eventId:e.event_id,actorId:e.actor_id,effectiveUserId:e.effective_user_id},new Map([[keyId,encryptionKey]])));
  const viewer=await person('viewer','viewer'),admin=await person('admin','admin'),other=await person('viewer','other');
  results.push({scenario:'真实Auth创建、密码登录和会话落库',status:'passed'});
  log=await open(path.join(output,'next-local.log'),'w',0o600);
  const env={...process.env,NEXT_PUBLIC_SUPABASE_URL:settings.API_URL,NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:settings.ANON_KEY,SUPABASE_SECRET_KEY:settings.SERVICE_ROLE_KEY,
    AI_QUERY_HTTP_ENABLED:'true',AI_QUERY_AUDIT_KEY_ID:keyId,AI_QUERY_AUDIT_ENCRYPTION_KEY:encryptionKey.toString('hex'),AI_QUERY_AUDIT_DIGEST_KEY:digestKey.toString('hex'),
    DEEPSEEK_API_KEY:'',OPENAI_API_KEY:'',NEXT_PUBLIC_AMAP_KEY:'',NEXT_PUBLIC_AMAP_SECURITY_CODE:''};
  const types=spawn('npm',['run','typecheck'],{cwd:root,env,stdio:['ignore',log.fd,log.fd]});
  assert.equal((await once(types,'exit'))[0],0,'Typecheck must pass before the production build');
  const build=spawn('npm',['run','build'],{cwd:root,env,stdio:['ignore',log.fd,log.fd]});
  assert.equal((await once(build,'exit'))[0],0,'Actual Next production build must pass');
  server=spawn(process.execPath,['node_modules/next/dist/bin/next','start','--hostname','127.0.0.1','--port','3289'],{cwd:root,env,stdio:['ignore',log.fd,log.fd]});
  await until(async()=>{try{return (await fetch(app+'/api/intelligence/query')).status===405;}catch{return false;}},'Next route startup');
  await check('匿名请求不伪造身份，留有界入口事件且不进入业务查询',async()=>{
    const res=await call(null);assert.equal(res.status,401);
    const row=(await db.query('select * from private.ai_query_ingress_events where request_id=$1',[res.body.requestId])).rows[0];
    assert.equal(row.actor_id,null);assert.equal(row.reason,'unauthenticated');assert.equal((await events(res.body.requestId)).length,0);
    assert.match(res.headers.get('cache-control'),/no-store/);
  });
  await check('总开关关闭和无资格管理员仍记录正式问题后拒绝',async()=>{
    const res=await call(viewer);assert.equal(res.status,403);
    assert.deepEqual((await events(res.body.requestId)).map(e=>e.kind),['received','denied']);
    assert.equal(decrypt((await events(res.body.requestId))[0]).content.submittedText,'CBD最高的楼是什么？');
    await db.query('update private.ai_query_control set enabled=true');assert.equal((await call(admin)).status,403);
  });
  await grantQuery({setup:db},viewer.id);
  let successful;
  await check('真实用户HTTP查询最高楼，生成/准备响应审计不冒称已读',async()=>{
    successful=await call(viewer);assert.equal(successful.status,200);
    assert.equal(successful.body.result.table.rows[0].entityId,BUILDINGS[0]);assert.equal(successful.body.result.analysis.coverage.valid,2);
    assert.equal(successful.body.result.analysis.coverage.missing,1);assert.equal(successful.body.result.analysis.coverage.conflict,1);
    const stored=await events(successful.body.requestId);assert.equal(stored.at(-1).kind,'delivery_receipt');
    assert.deepEqual(decrypt(stored.at(-1)).content.clientReceipt,'unconfirmed');
    assert.equal(decrypt(stored.at(-1)).content.phase,'response_prepared');
  });
  await check('季度170/17.5%及名称目录通过真实HTTP读取',async()=>{
    for(const metric of ['rent','vacancy']){
      const res=await call(viewer,input({operation:'aggregate',scope:rank.scope,metric,period:{year:2026,quarter:3}}));assert.equal(res.status,200);
      assert.equal(res.body.result.table.rows[0].cells.value.value.numeric,metric==='rent'?170:0.175);
    }
    const list=await call(viewer,input({operation:'list',scope:rank.scope,fields:[],period:null}));assert.equal(list.status,200);assert.equal(list.body.result.table.rows.length,4);
  });
  await check('非法字段、伪造身份和畸形JSON均保留实际提交内容',async()=>{
    let nested={field:'height',operator:'gt',value:'1'};for(let i=0;i<50;i++)nested={operator:'and',terms:[nested]};
    for(const body of [input({...rank,filter:nested}),input({...rank,field:'contact_phone'}),{...input(),role:'admin'},'{"question":"不要丢掉这条坏JSON"']){
      const res=await call(viewer,body);assert.equal(res.status,403);
      const event=decrypt((await events(res.body.requestId))[0]);assert.equal(event.content.metadata.rawRequest,typeof body==='string'?body:JSON.stringify(body));
    }
    const forged=await call(viewer,input(),{'X-Colliers-Impersonate-User':admin.id});assert.equal(forged.status,403);
    const stored=(await events(forged.body.requestId))[0];assert.equal(stored.actor_id,viewer.id);assert.equal(stored.effective_user_id,viewer.id);assert.equal(decrypt(stored).content.metadata.impersonationDenied,true);
  });
  await check('真实管理员模拟取资格交集，不借目标权限扩权',async()=>{
    await grantQuery({setup:db},admin.id,{fields:['height']});
    assert.equal((await call(admin,input(),{'X-Colliers-Impersonate-User':viewer.id})).status,200);
    assert.equal((await call(admin,input({operation:'aggregate',scope:rank.scope,metric:'rent',period:{year:2026,quarter:3}}),{'X-Colliers-Impersonate-User':viewer.id})).status,403);
  });
  await check('问题和原始JSON中的明确凭证均脱敏，保留业务文字',async()=>{
    const res=await call(viewer,{...input(),question:'CBD 密码="synthetic multi word secret" 最高楼是什么？'});assert.equal(res.status,200);
    const original=decrypt((await events(res.body.requestId))[0]);
    assert.ok(!JSON.stringify(original).includes('multi word secret'));assert.ok(JSON.stringify(original).includes('最高楼是什么'));
  });
  await check('同请求并发/新登录重试不重复执行，冲突问题也单独留痕',async()=>{
    const body=input();const both=await Promise.all([call(viewer,body),call(viewer,body)]);assert.deepEqual(both.map(x=>x.status).sort(),[200,202]);
    assert.equal((await events(both[0].body.requestId)).filter(e=>e.kind==='running').length,1);
    const signed=await viewer.client.auth.signInWithPassword({email:viewer.email,password:viewer.password});assert.equal(signed.error,null);viewer.token=signed.data.session.access_token;
    assert.equal((await call(viewer,body)).status,202);
    const conflict=await call(viewer,{...body,question:'这是不同的正式问题'});assert.equal(conflict.status,409);
    assert.equal(decrypt((await events(conflict.body.requestId))[0]).content.submittedText,'这是不同的正式问题');
    await grantQuery({setup:db},other.id);const across=await call(other,body);assert.equal(across.status,200);assert.notEqual(across.body.requestId,both[0].body.requestId);
  });
  await check('超大和非法编码输入只记长度/摘要，不保存截断正文冒充完整',async()=>{
    const big=await call(viewer,'中'.repeat(10000));assert.equal(big.status,413);
    const row=(await db.query('select * from private.ai_query_ingress_events where request_id=$1',[big.body.requestId])).rows[0];
    assert.equal(row.body_complete,false);assert.equal(row.digest_scope,'prefix');assert.equal((await events(big.body.requestId)).length,0);
    const bad=await fetch(app+'/api/intelligence/query',{method:'POST',body:new Uint8Array([255]),headers:{Authorization:'Bearer '+viewer.token}});assert.equal(bad.status,400);
  });
  await check('跨源请求和不获权范围拒绝，用户metadata不能提权',async()=>{
    assert.equal((await call(viewer,input(),{Origin:'https://other.invalid'})).status,403);
    await grantQuery({setup:db},viewer.id,{allSubmarkets:false,submarkets:['CBD']});
    const denied=await call(viewer,input({...rank,scope:{inventory:'tracked',submarkets:['金融街']}}));assert.equal(denied.status,403);assert.equal(denied.body.result,undefined);
    const noRights=await person('viewer','metadata');assert.equal((await call(noRights)).status,403);
    assert.ok((await noRights.client.from('user_roles').update({role:'admin'}).eq('user_id',noRights.id)).error);
  });
  await check('入口与问答存储故障分别阻止新查询，失败不返回结果',async()=>{
    for(const table of ['ai_query_ingress_events','ai_query_audit_events']){
      await db.query(`create or replace function private.fail_query_http() returns trigger language plpgsql as $$ begin raise exception 'injected audit failure'; end $$;create trigger query_http_fault before insert on private.${table} for each row execute function private.fail_query_http()`);
      try{const res=await call(viewer);assert.equal(res.status,503);assert.equal(res.body.result,undefined);assert.equal((await events(res.body.requestId)).length,0);}
      finally{await db.query(`drop trigger query_http_fault on private.${table}`);}
    }
  });
  await check('查询在途时撤权等待快照锁，最终HTTP仍拒绝交付',async()=>{
    const parity=await load('20260927045505_viewer_readonly_editor_parity.sql');
    const helpers=parity.slice(parity.indexOf('create or replace function private.map_can_view_extended_inventory()'),parity.indexOf('drop policy if exists "role scoped read buildings"'));
    await db.query(`create or replace function private.map_building_visible(p_building_id uuid) returns boolean language plpgsql stable security definer set search_path='' as $$ begin perform pg_advisory_xact_lock(761113); return private.map_can_view_extended_inventory(); end $$`);
    await blocker.query('select pg_advisory_lock(761113)');
    let pending,change;
    try{
      pending=call(viewer);
      await until(async()=>Boolean((await db.query("select 1 from pg_stat_activity where datname=current_database() and wait_event='advisory' and query like '%ai_query_snapshot_read%' and pid<>pg_backend_pid()")).rowCount),'snapshot waiting on synthetic barrier',10000);
      change=withdrawal.query('update private.ai_query_grants set enabled=false where user_id=$1',[viewer.id]);
      await until(async()=>Boolean((await db.query('select 1 from pg_stat_activity where pid=$1 and wait_event_type=$2',[withdrawal.processID,'Lock'])).rowCount),'withdrawal waiting on in-flight read',10000);
      await blocker.query('select pg_advisory_unlock(761113)');
      await change;const res=await pending;assert.equal(res.status,403);assert.equal(res.body.result,undefined);
    }finally{
      await blocker.query('select pg_advisory_unlock_all()');
      await change?.catch(()=>{});await pending?.catch(()=>{});
      await db.query(helpers);await grantQuery({setup:db},viewer.id);
    }
  });
  await check('响应准备后缩小权限但仍保留查询资格，也不能交付旧范围结果',async()=>{
    await db.query(`create or replace function private.narrow_query_after_prepare() returns trigger language plpgsql as $$ begin if new.kind='delivery_receipt' then update private.ai_query_grants set fields=array['height'] where user_id=(select actor_id from private.ai_query_audit_streams where request_id=new.request_id); end if;return new;end $$;create trigger narrow_query_after_prepare after insert on private.ai_query_audit_events for each row execute function private.narrow_query_after_prepare()`);
    try{
      const res=await call(viewer,input({operation:'aggregate',scope:rank.scope,metric:'rent',period:{year:2026,quarter:3}}));assert.equal(res.status,403);assert.equal(res.body.result,undefined);
      assert.equal((await events(res.body.requestId)).at(-1).kind,'correction');
    }finally{await db.query('drop trigger narrow_query_after_prepare on private.ai_query_audit_events');await grantQuery({setup:db},viewer.id);}
  });
  await check('响应准备后权限服务故障明确为无法确认，不误报撤权',async()=>{
    await db.query(`create or replace function private.fail_authority_after_prepare() returns trigger language plpgsql as $$ begin if new.kind='delivery_receipt' then revoke execute on function public.ai_query_authority(uuid,uuid,uuid) from service_role; end if;return new;end $$;create trigger fail_authority_after_prepare after insert on private.ai_query_audit_events for each row execute function private.fail_authority_after_prepare()`);
    try{
      const res=await call(viewer);assert.equal(res.status,503);assert.equal(res.body.result,undefined);
      assert.equal(decrypt((await events(res.body.requestId)).at(-1)).content.reason,'authorization_unavailable_before_response');
    }finally{await db.query('drop trigger fail_authority_after_prepare on private.ai_query_audit_events;grant execute on function public.ai_query_authority(uuid,uuid,uuid) to service_role');}
  });
  await check('撤销资格和真实注销后旧JWT/重复请求均不返回历史结果',async()=>{
    const body=input();assert.equal((await call(viewer,body)).status,200);
    await db.query('update private.ai_query_grants set enabled=false where user_id=$1',[viewer.id]);assert.equal((await call(viewer,body)).status,403);
    await grantQuery({setup:db},viewer.id);const old=viewer.token;assert.equal((await viewer.client.auth.signOut({scope:'local'})).error,null);
    viewer.token=old;const revoked=await call(viewer,input());assert.ok([401,403].includes(revoked.status));assert.equal(revoked.body.result,undefined);
  });
  await check('普通用户无法直读审计/入口表或直接调用服务端RPC',async()=>{
    const direct=await other.client.rpc('ai_query_authority',{p_actor:other.id,p_effective:other.id,p_session:other.sessionId});assert.ok(direct.error);
    for(const table of ['ai_query_audit_streams','ai_query_ingress_events'])assert.ok((await other.client.schema('private').from(table).select('*')).error);
  });
  await writeFile(path.join(output,'results.json'),JSON.stringify({database:version,scenarios:results,production:false,modelCalls:false,browserValidation:false},null,2)+'\n');
  console.log(`PASS ${results.length} real Auth/HTTP scenarios; no model or production calls`);
}finally{
  if(server&&server.exitCode===null){const stopped=once(server,'exit');server.kill('SIGTERM');await stopped;}
  await log?.close();
  for(const entry of people)await service.auth.admin.deleteUser(entry.id).catch(()=>{});
  await blocker.end();await withdrawal.end();await db.end();
}
