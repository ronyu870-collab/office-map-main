import assert from 'node:assert/strict';
import { randomUUID, randomBytes } from 'node:crypto';
import { readFile, mkdir, writeFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import path from 'node:path';
import pg from 'pg';
import { rolldown } from 'rolldown';
import { createLeaseTestDatabase, OWNER } from '../lease-change-history/database.mjs';
const db=await createLeaseTestDatabase(),results=[];
const output=path.resolve('verification/ai-query-reconciliation');await mkdir(output,{recursive:true});
const compiled=await mkdtemp(path.join(tmpdir(),'ai-query-reconciliation-test-'));
const bundle=await rolldown({input:path.resolve('src/lib/intelligence/query/reconciliation.ts'),platform:'node'});
try{await bundle.write({file:path.join(compiled,'worker.cjs'),format:'cjs'});}finally{await bundle.close();}
const cryptoBundle=await rolldown({input:path.resolve('src/lib/intelligence/query/auditCrypto.ts'),platform:'node'});
try{await cryptoBundle.write({file:path.join(compiled,'crypto.cjs'),format:'cjs'});}finally{await cryptoBundle.close();}
const {reconciliationEnvelope,reconcileQueryAudits}=createRequire(import.meta.url)(path.join(compiled,'worker.cjs'));
const {encryptAuditContent,decryptAuditContent,auditPayloadDigest}=createRequire(import.meta.url)(path.join(compiled,'crypto.cjs'));
const keys={keyId:'isolated-reconcile',encryptionKey:randomBytes(32),digestKey:randomBytes(32)};
const check=async(name,fn)=>{await fn();results.push({scenario:name,status:'passed'});console.log('PASS '+name);};
const config={host:'127.0.0.1',port:Number(process.env.LEASE_TEST_PG_PORT),user:'postgres',password:'synthetic_ci_only',database:db.database};
const service=new pg.Client(config);await service.connect();await service.query('set role service_role');
const seal=(id,event,text='synthetic question')=>({digest:auditPayloadDigest(text,keys.digestKey),cipher:encryptAuditContent(text,{requestId:id,eventId:event,actorId:OWNER,effectiveUserId:OWNER},keys.keyId,keys.encryptionKey)});
async function seed(running=true){const id=randomUUID(),e=randomUUID(),body=seal(id,e);await service.query('select public.ai_query_audit_receive($1,$2,$3,$3,$4,$5,$6)',[id,e,OWNER,'synthetic',body.digest,body.cipher]);if(running)await append(id,'running');return id;}
async function append(id,kind){const e=randomUUID(),body=seal(id,e);return service.query('select public.ai_query_audit_append($1,$2,$3,$4,$5)',[id,e,kind,body.digest,body.cipher]);}
const expire=ids=>db.setup.query("update private.ai_query_execution_watch set due_at=case when request_id=any($1::uuid[]) then clock_timestamp()-interval '1 second' else clock_timestamp()+interval '180 seconds' end where state='pending'",[ids]);
const claim=async(worker='worker-1',limit=20,client=service)=>(await client.query('select public.ai_query_reconcile_claim($1,$2) result',[worker,limit])).rows[0].result;
const settle=async(c,body=reconciliationEnvelope(c,keys))=>(await service.query('select public.ai_query_reconcile_settle($1,$2,$3,$4,$5,$6) result',[body.p_request_id,body.p_lease_token,body.p_worker_ref,body.p_event_id,body.p_payload_digest,body.p_cipher])).rows[0].result;
const state=async id=>(await db.setup.query('select s.state,w.state watch,w.lease_token from private.ai_query_audit_streams s join private.ai_query_execution_watch w using(request_id) where request_id=$1',[id])).rows[0];
const rpc={rpc(name,args){return {abortSignal:async()=>{try{const names=Object.keys(args),values=Object.values(args);assert.ok(['ai_query_reconcile_claim','ai_query_reconcile_settle'].includes(name));const r=await service.query(`select public.${name}(${names.map((_,i)=>'$'+(i+1)).join(',')}) result`,values);return {data:r.rows[0].result,error:null};}catch(error){return {data:null,error};}}};}};
try{
  for(const f of ['20261113003933_ai_query_audit_foundation.sql','20261113032515_ai_query_http_security.sql'])await db.setup.query(await readFile(new URL('../../migrations/'+f,import.meta.url),'utf8'));
  const old=await seed();
  await db.setup.query(await readFile(new URL('../../migrations/20261113080906_ai_query_execution_reconciliation.sql',import.meta.url),'utf8'));
  await check('upgrade backfills pending streams with grace, normal transitions settle the same durable watch',async()=>{
    assert.equal((await state(old)).watch,'pending');assert.deepEqual(await claim(),[]);
    const id=await seed(false);assert.equal((await state(id)).watch,'pending');await append(id,'denied');assert.equal((await state(id)).watch,'settled');
    await append(old,'succeeded');assert.equal((await state(old)).watch,'settled');
  });
  await check('queue registration failure rolls back durable reception atomically',async()=>{
    await db.setup.query("create function private.fail_watch() returns trigger language plpgsql set search_path='' as $$ begin raise exception 'watch fault';end $$;create trigger fail_watch before insert on private.ai_query_execution_watch for each row execute function private.fail_watch()");
    const before=(await db.setup.query('select count(*)::int n from private.ai_query_audit_streams')).rows[0].n;
    try{await assert.rejects(seed(),/watch fault/);}finally{await db.setup.query('drop trigger fail_watch on private.ai_query_execution_watch;drop function private.fail_watch()');}
    assert.equal((await db.setup.query('select count(*)::int n from private.ai_query_audit_streams')).rows[0].n,before);
  });
  await check('expired execution is reconciled by the actual worker with unknown outcome and original identity intact',async()=>{
    const id=await seed();await expire([id]);const result=await reconcileQueryAudits(rpc,keys,'actual-worker');
    assert.equal(result.claimed,1);assert.equal(result.outcomes[0].status,'settled');assert.equal((await state(id)).state,'failed');assert.equal((await state(id)).watch,'settled');
    const e=(await db.setup.query("select * from private.ai_query_audit_events where request_id=$1 and kind='failed'",[id])).rows[0];
    const content=JSON.parse(decryptAuditContent(e.cipher,{requestId:id,eventId:e.event_id,actorId:OWNER,effectiveUserId:OWNER},new Map([[keys.keyId,keys.encryptionKey]]))).content;
    assert.equal(content.executionOutcome,'unknown');assert.equal(content.providerCost,'unknown_not_zero');assert.equal(content.delivery,'unconfirmed');assert.equal(content.executor.kind,'system_reconciler');assert.equal(content.originalActorId,OWNER);
    await assert.rejects(append(id,'succeeded'),/invalid audit transition/);
  });
  await check('renewed progress or normal success fences a previously claimed repair',async()=>{
    const id=await seed();await expire([id]);const c=(await claim())[0];await append(id,'response_generated');
    assert.deepEqual(await settle(c),{settled:false,reason:'stale'});assert.equal((await state(id)).state,'running');
    await expire([id]);const again=(await claim())[0];await append(id,'succeeded');
    assert.equal((await settle(again)).settled,false);assert.equal((await state(id)).state,'succeeded');
  });
  await check('a killed claimer leaves a lease, replacement fences the old worker and retry is idempotent',async()=>{
    const id=await seed();await expire([id]);
    const code=`const pg=require('pg');(async()=>{const c=new pg.Client(${JSON.stringify(config)});await c.connect();await c.query('set role service_role');const r=await c.query("select public.ai_query_reconcile_claim('crashed-worker',1) result");process.stdout.write(JSON.stringify(r.rows[0].result)+'\\n');setInterval(()=>{},10000);})().catch(()=>process.exit(2));`;
    const child=spawn(process.execPath,['-e',code],{stdio:['ignore','pipe','pipe']});
    const exited=once(child,'exit');let abandoned;
    try{const [chunk]=await once(child.stdout,'data',{signal:AbortSignal.timeout(10000)});abandoned=JSON.parse(chunk.toString())[0];}
    finally{child.kill('SIGKILL');assert.equal((await exited)[1],'SIGKILL');}
    assert.deepEqual(await claim('replacement'),[]);
    await db.setup.query("update private.ai_query_execution_watch set lease_until=clock_timestamp()-interval '1 second' where request_id=$1",[id]);
    const c=(await claim('replacement'))[0];assert.notEqual(c.lease_token,abandoned.lease_token);assert.equal((await settle(abandoned)).settled,false);
    const payload=reconciliationEnvelope(c,keys);assert.equal((await settle(c,payload)).replayed,false);assert.equal((await settle(c,payload)).replayed,true);
    await assert.rejects(settle(c,{...payload,p_payload_digest:'0'.repeat(64)}),/idempotency conflict/);
    assert.equal((await db.setup.query("select count(*)::int n from private.ai_query_audit_events where request_id=$1 and kind='failed'",[id])).rows[0].n,1);
  });
  await check('multiple claimers partition work; locked live streams are skipped without deadlock',async()=>{
    const ids=[];for(let i=0;i<8;i++)ids.push(await seed());await expire(ids);
    const lock=new pg.Client(config);await lock.connect();await lock.query('begin');await lock.query('select * from private.ai_query_audit_streams where request_id=$1 for update',[ids[0]]);
    const clients=Array.from({length:4},()=>new pg.Client(config));let claimed=[];
    try{await Promise.all(clients.map(async c=>{await c.connect();await c.query('set role service_role');}));claimed=(await Promise.all(clients.map((c,i)=>claim('parallel-'+i,2,c)))).flat();assert.equal(claimed.length,7);assert.equal(new Set(claimed.map(x=>x.request_id)).size,7);assert.ok(claimed.every(x=>x.request_id!==ids[0]));}
    finally{await lock.query('rollback');await lock.end();await Promise.all(clients.map(c=>c.end()));}
    for(const c of claimed)await settle(c);const last=(await claim())[0];assert.equal(last.request_id,ids[0]);await settle(last);
  });
  await check('terminal audit failure rolls back settlement and a later retry closes exactly once',async()=>{
    const id=await seed();await expire([id]);const c=(await claim())[0];const payload=reconciliationEnvelope(c,keys);
    await db.setup.query("create function private.fail_settlement() returns trigger language plpgsql set search_path='' as $$ begin if new.action='settled' then raise exception 'settlement fault';end if;return new;end $$;create trigger fail_settlement before insert on private.ai_query_reconciliation_events for each row execute function private.fail_settlement()");
    try{await assert.rejects(settle(c,payload),/settlement fault/);}finally{await db.setup.query('drop trigger fail_settlement on private.ai_query_reconciliation_events;drop function private.fail_settlement()');}
    assert.equal((await state(id)).state,'running');assert.equal((await state(id)).lease_token,c.lease_token);
    assert.equal((await db.setup.query("select count(*)::int n from private.ai_query_audit_events where request_id=$1 and kind='failed'",[id])).rows[0].n,0);
    assert.equal((await settle(c,payload)).settled,true);
  });
  await check('corrupt event chain is reported, never silently repaired into a trustworthy answer',async()=>{
    const id=await seed();await expire([id]);const c=(await claim())[0];
    await db.setup.query("update private.ai_query_audit_events set event_hash=repeat('0',64) where request_id=$1 and sequence=1",[id]);
    assert.deepEqual(await settle(c),{settled:false,reason:'integrity_unavailable'});assert.equal((await state(id)).state,'running');
  });
  await check('forged runtime state and corrupted settled replays cannot be certified by the repair worker',async()=>{
    const id=await seed();await append(id,'succeeded');
    await db.setup.query("update private.ai_query_audit_streams set state='running' where request_id=$1",[id]);await expire([id]);const c=(await claim())[0];
    assert.deepEqual(await settle(c),{settled:false,reason:'integrity_unavailable'});
    const another=await seed();await expire([another]);const valid=(await claim())[0];await settle(valid);
    await db.setup.query("update private.ai_query_audit_events set event_hash=repeat('0',64) where request_id=$1 and sequence=1",[another]);
    assert.deepEqual(await settle(valid),{settled:false,reason:'integrity_unavailable'});
  });
  await check('ingress reconciliation exposes missing accepted request content without inventing it',async()=>{
    const orphan=randomUUID();for(let i=0;i<2;i++)await db.setup.query("insert into private.ai_query_ingress_events(event_id,request_id,actor_id,session_id,reason,bytes_observed,body_complete,body_digest,digest_scope,occurred_at) values($1,$2,$3,$4,'request_received',30,true,$5,'complete',clock_timestamp()-interval '4 minutes')",[randomUUID(),orphan,OWNER,randomUUID(),'a'.repeat(64)]);
    const overview=(await service.query("select public.ai_query_reconcile_overview(clock_timestamp()-interval '1 day') result")).rows[0].result;
    assert.equal(overview.ingress_attempts,2);assert.equal(overview.distinct_authenticated_requests,1);assert.equal(overview.orphan_ingress_attempts,2);assert.equal(overview.orphan_sample.length,2);assert.equal(overview.missing_watch,0);
    await assert.rejects(service.query("select public.ai_query_reconcile_overview(clock_timestamp()-interval '40 days')"),/invalid reconciliation range/);
  });
  await check('ordinary/admin JWT roles and raw service table access cannot operate repair queues',async()=>{
    for(const role of ['anon','authenticated']){const c=new pg.Client(config);await c.connect();try{await c.query('set role '+role);await assert.rejects(c.query("select public.ai_query_reconcile_claim('forged',1)"),e=>e.code==='42501');await assert.rejects(c.query("select public.ai_query_reconcile_overview(clock_timestamp()-interval '1 day')"),e=>e.code==='42501');}finally{await c.end();}}
    for(const sql of ['select * from private.ai_query_execution_watch','delete from private.ai_query_reconciliation_events',"update private.ai_query_execution_watch set state='settled'"])await assert.rejects(service.query(sql),e=>e.code==='42501');
    const functions=(await db.setup.query("select n.nspname,p.prosecdef,p.proconfig,has_function_privilege('anon',p.oid,'execute') anon,has_function_privilege('authenticated',p.oid,'execute') authenticated from pg_proc p join pg_namespace n on n.oid=p.pronamespace where p.proname like 'ai_query_reconcile_%' and n.nspname in ('public','private')")).rows;
    assert.equal(functions.length,6);for(const f of functions){assert.equal(f.prosecdef,f.nspname==='private');assert.equal(f.anon,false);assert.equal(f.authenticated,false);assert.ok(f.proconfig.includes('search_path=""'));}
  });
  await writeFile(path.join(output,'results.json'),JSON.stringify({database:db.version,scenarios:results,production:false,modelCalls:false},null,2)+'\n');
  console.log(`PASS ${results.length} execution reconciliation PostgreSQL 17 scenarios`);
}finally{try{await service.end();await db.close();}finally{await rm(compiled,{recursive:true,force:true});}}
