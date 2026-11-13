import assert from 'node:assert/strict';
import {randomUUID,randomBytes} from 'node:crypto';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import pg from 'pg';
import {createAiQueryTestDatabase,SESSION} from '../ai-query-authority/database.mjs';
import {OWNER,OTHER} from '../lease-change-history/database.mjs';
import {loadAuditPrerequisites,applyAdminOnly} from '../ai-admin-only/database.mjs';
const db=await createAiQueryTestDatabase(),results=[];
const config={host:'127.0.0.1',port:Number(process.env.LEASE_TEST_PG_PORT),user:'postgres',password:'synthetic_ci_only',database:db.database};
const service=new pg.Client(config);await service.connect();await service.query('set role service_role');
const check=async(scenario,fn)=>{await fn();results.push({scenario,status:'passed'});console.log('PASS '+scenario);};
const cipher=()=>({version:1,algorithm:'aes-256-gcm',keyId:'synthetic',nonce:randomBytes(12).toString('hex'),tag:randomBytes(16).toString('hex'),ciphertext:'ab'});
const target=randomUUID(),targets=[{kind:'intake',id:target}];
const call=async(phase='read',parent=null,connection=service)=>{const id=randomUUID();return {id,...(await connection.query('select public.ai_audit_export_control($1,$1,$2,$3,$4,$5,$6,$7,$8,$9) r',[OWNER,SESSION,id,phase,parent,phase==='read'?JSON.stringify(targets):null,'a'.repeat(64),phase==='read'?null:100,phase==='read'?cipher():null])).rows[0].r};};
const state=async id=>(await db.setup.query('select * from private.ai_audit_export_operations where export_id=$1',[id])).rows[0];
const expire=ids=>db.setup.query("update private.ai_audit_export_operations set due_at=clock_timestamp()-interval '1 second' where export_id=any($1)",[ids]);
const sweep=async(c=service)=>(await c.query("select public.ai_audit_export_reconcile('synthetic-worker',100) r")).rows[0].r;
const fail=async(id,actor=OWNER,session=SESSION)=>(await service.query('select public.ai_audit_export_fail($1,$2,$3) r',[id,actor,session])).rows[0].r;
try{
 await loadAuditPrerequisites(db);await applyAdminOnly(db);await db.setup.query('alter table public.user_roles add column if not exists full_name text,add column if not exists chinese_name text');
 for(const f of ['20261113130012_ai_audit_actor_directory.sql','20261113132136_ai_audit_controlled_export.sql'])await db.setup.query(await readFile(new URL('../../migrations/'+f,import.meta.url),'utf8'));
 await db.setup.query("update public.user_roles set role='admin' where user_id=$1",[OWNER]);
 await db.setup.query("insert into private.ai_audit_read_grants(user_id,valid_until,grant_reference) values($1,now()+interval '1 day','test')",[OWNER]);
 await db.setup.query("insert into private.ai_audit_export_grants(user_id,enabled,valid_until,grant_reference) values($1,true,now()+interval '1 day','test')",[OWNER]);
 await db.setup.query("insert into private.ai_query_ingress_events(event_id,request_id,actor_id,session_id,reason,bytes_observed,body_complete,body_digest,digest_scope,effective_user_id,entry,content_digest,cipher) values($1,$2,$3,$4,'request_received',1,true,$5,'complete',$3,'query_submission',$5,'{}'::jsonb)",[target,randomUUID(),OTHER,randomUUID(),'a'.repeat(64)]);
 const oldRead=await call(),oldPrepared=await call(),oldPrepare=await call('prepare',oldPrepared.id);await call('client_dispatch',oldPrepare.id);
 await check('old implementation has no durable export observation; upgrade preserves old evidence and grants grace',async()=>{
  assert.equal((await db.setup.query("select to_regclass('private.ai_audit_export_operations') r")).rows[0].r,null);
  await service.query('begin');const inFlight=await call();
  const migrationSql=await readFile(new URL('../../migrations/20261113135841_ai_audit_export_reconciliation.sql',import.meta.url),'utf8');
  const observer=new pg.Client(config);await observer.connect();
  const migrating=db.setup.query(migrationSql);let waiting=false;
  try{for(let i=0;i<100;i++){if((await observer.query("select 1 from pg_stat_activity where pid=$1 and wait_event_type='Lock'",[db.setup.processID])).rowCount){waiting=true;break;}await new Promise(resolve=>setTimeout(resolve,20));}assert.equal(waiting,true);}
  finally{await service.query('commit');await migrating;await observer.end();}
  assert.equal((await state(inFlight.id)).state,'pending_generation');
  assert.equal((await state(oldRead.id)).state,'pending_generation');assert.equal((await state(oldPrepared.id)).state,'client_dispatch_reported');
  assert.ok(new Date((await state(oldRead.id)).due_at)>new Date());assert.equal((await db.setup.query("select executor from private.ai_audit_export_lifecycle where export_id=$1",[oldRead.id])).rows[0].executor,'migration');
 });
 await check('read/prepare/report and their observation histories commit atomically; private ledger fault rolls back export',async()=>{
  const r=await call();assert.equal(r.policy,'audit-export/2');assert.equal((await state(r.id)).state,'pending_generation');
  const p=await call('prepare',r.id);assert.equal((await state(r.id)).state,'pending_report');await call('client_dispatch',p.id);await call('client_dispatch',p.id);
  assert.equal((await state(r.id)).state,'client_dispatch_reported');assert.equal((await db.setup.query('select count(*)::int n from private.ai_audit_export_lifecycle where export_id=$1',[r.id])).rows[0].n,3);
  const pending=await call();await db.setup.query("create function private.lifecycle_fault() returns trigger language plpgsql as $$begin raise exception 'synthetic lifecycle fault';end$$;create trigger lifecycle_fault before insert on private.ai_audit_export_lifecycle for each row execute function private.lifecycle_fault()");
  try{await assert.rejects(()=>call(),/synthetic lifecycle fault/);await assert.rejects(()=>call('prepare',pending.id),/synthetic lifecycle fault/);assert.equal((await state(pending.id)).state,'pending_generation');assert.equal((await db.setup.query("select count(*)::int n from private.ai_audit_export_events where parent_id=$1",[pending.id])).rows[0].n,0);}finally{await db.setup.query('drop trigger lifecycle_fault on private.ai_audit_export_lifecycle;drop function private.lifecycle_fault()');}
 });
 await check('service failure closes only bound unprepared operation; repeated/foreign failures cannot overwrite prepared facts',async()=>{
  const r=await call();assert.equal(await fail(r.id,OTHER),false);assert.equal(await fail(r.id,OWNER,randomUUID()),false);assert.equal(await fail(r.id),true);assert.equal(await fail(r.id),false);
  assert.equal((await state(r.id)).state,'generation_failed');await assert.rejects(()=>call('prepare',r.id),/no longer pending/);
  const prepared=await call();await call('prepare',prepared.id);assert.equal(await fail(prepared.id),false);assert.equal((await state(prepared.id)).state,'pending_report');
 });
 await check('deadline recovery distinguishes unknown generation/delivery and never recreates files or asserts failed saving',async()=>{
  const a=await call(),b=await call(),p=await call('prepare',b.id);await expire([a.id,b.id]);const r=await sweep();assert.equal(r.replayed,false);
  assert.equal((await state(a.id)).state,'generation_unconfirmed');assert.equal((await state(b.id)).state,'delivery_unconfirmed');await assert.rejects(()=>call('prepare',a.id),/no longer pending/);
  await call('client_dispatch',p.id);assert.equal((await state(b.id)).state,'client_dispatch_reported');
  const history=(await db.setup.query('select state from private.ai_audit_export_lifecycle where export_id=$1 order by occurred_at,event_id',[b.id])).rows.map(x=>x.state);
  assert.deepEqual(history,['pending_generation','pending_report','delivery_unconfirmed','client_dispatch_reported']);assert.equal((await sweep()).outcomes.length,0);
 });
 await check('concurrent reconcilers skip locked operations; one terminal per operation and late prepare rejects',async()=>{
  const ids=[];for(let i=0;i<8;i++)ids.push((await call()).id);await expire(ids);
  const locked=new pg.Client(config);await locked.connect();await locked.query('begin');await locked.query('select 1 from private.ai_audit_export_operations where export_id=$1 for update',[ids[0]]);
  const workers=await Promise.all(Array.from({length:3},async()=>{const c=new pg.Client(config);await c.connect();await c.query('set role service_role');return c;}));
  try{const out=(await Promise.all(workers.map(sweep))).flatMap(x=>x.outcomes);assert.equal(out.length,7);assert.equal(new Set(out.map(x=>x.exportId)).size,7);assert.equal((await state(ids[0])).state,'pending_generation');await locked.query('commit');assert.equal((await sweep()).outcomes.length,1);}finally{await locked.query('rollback');await locked.end();await Promise.all(workers.map(c=>c.end()));}
 });
 await check('crashed transaction has no partial closure; retry after actual backend termination completes once',async()=>{
  const r=await call();await expire([r.id]);const c=new pg.Client(config);await c.connect();c.on('error',()=>{});await c.query('begin');await sweep(c);
  await db.setup.query('select pg_terminate_backend($1)',[c.processID]);await c.end().catch(()=>{});assert.equal((await state(r.id)).state,'pending_generation');await sweep();assert.equal((await state(r.id)).state,'generation_unconfirmed');
  assert.equal((await db.setup.query("select count(*)::int n from private.ai_audit_export_lifecycle where export_id=$1 and executor='system_reconciler'",[r.id])).rows[0].n,1);
 });
 await check('reconciliation ledger failure rolls back closure; malformed observation is not blessed',async()=>{
  const r=await call();await expire([r.id]);await db.setup.query("create function private.reconcile_fault() returns trigger language plpgsql as $$begin if new.executor='system_reconciler' then raise exception 'synthetic reconcile fault';end if;return new;end$$;create trigger reconcile_fault before insert on private.ai_audit_export_lifecycle for each row execute function private.reconcile_fault()");
  try{await assert.rejects(()=>sweep(),/synthetic reconcile fault/);assert.equal((await state(r.id)).state,'pending_generation');}finally{await db.setup.query('drop trigger reconcile_fault on private.ai_audit_export_lifecycle;drop function private.reconcile_fault()');}
  await db.setup.query("update private.ai_audit_export_events set outcome='unavailable' where event_id=$1",[r.id]);assert.equal((await sweep()).outcomes.find(x=>x.exportId===r.id).state,'integrity_unavailable');assert.equal((await state(r.id)).state,'pending_generation');
 });
 await check('operational overview exposes counts only; user RPC/direct tables denied and arguments bounded',async()=>{
  const o=(await service.query("select public.ai_audit_export_overview(clock_timestamp()-interval '1 day') r")).rows[0].r;assert.equal(o.missing_operations,0);assert.equal(o.missing_history,0);assert.ok(o.reads>15);assert.equal(o.actorId,undefined);
  const gap=await call();await db.setup.query('begin');
  try{await db.setup.query('delete from private.ai_audit_export_lifecycle where export_id=$1',[gap.id]);await db.setup.query('delete from private.ai_audit_export_operations where export_id=$1',[gap.id]);
    const missing=(await db.setup.query("select public.ai_audit_export_overview(clock_timestamp()-interval '1 day') r")).rows[0].r;assert.equal(missing.missing_operations,1);assert.equal(missing.missing_history,1);
  }finally{await db.setup.query('rollback');}
  await assert.rejects(()=>service.query('select * from private.ai_audit_export_operations'),/permission denied/);
  await assert.rejects(()=>service.query("delete from private.ai_audit_export_lifecycle"),/permission denied/);
  await assert.rejects(()=>db.asUser(OWNER,"select public.ai_audit_export_reconcile('test',10)"),/permission denied/);
  for(const n of [0,101,null])await assert.rejects(()=>service.query("select public.ai_audit_export_reconcile('test',$1)",[n]),/bounds/);
  await assert.rejects(()=>service.query("select public.ai_audit_export_overview(now()-interval '32 days')"),/window/);
 });
 await mkdir('verification/ai-audit-export-reconciliation',{recursive:true});await writeFile('verification/ai-audit-export-reconciliation/results.json',JSON.stringify({database:db.version,scenarios:results,production:false},null,2)+'\n');console.log(`PASS ${results.length} PostgreSQL export reconciliation scenarios`);
}finally{await service.end();await db.close();}
