import assert from 'node:assert/strict';
import { randomUUID, randomBytes } from 'node:crypto';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import pg from 'pg';
import { createAiQueryTestDatabase, SESSION } from '../ai-query-authority/database.mjs';
import { OWNER, OTHER, ADMIN } from '../lease-change-history/database.mjs';
const db=await createAiQueryTestDatabase(),results=[];
const config={host:'127.0.0.1',port:Number(process.env.LEASE_TEST_PG_PORT),user:'postgres',password:'synthetic_ci_only',database:db.database};
const service=new pg.Client(config);await service.connect();await service.query('set role service_role');
const check=async(name,fn)=>{await fn();results.push({scenario:name,status:'passed'});console.log('PASS '+name);};
const cipher=()=>({version:1,algorithm:'aes-256-gcm',keyId:'isolated-db-shape',nonce:randomBytes(12).toString('hex'),tag:randomBytes(16).toString('hex'),ciphertext:'ab'});
const read=async(filter={action:'list',from:new Date(Date.now()-86400000).toISOString(),to:new Date(Date.now()+1000).toISOString()},actor=OWNER,session=SESSION,effective=actor)=>{
  const id=randomUUID(),body=(await service.query('select public.ai_audit_console_read($1,$2,$3,$4,$5,$6,$7) r',[actor,effective,session,id,filter,'a'.repeat(64),cipher()])).rows[0].r;return {id,...body};
};
const prepare=async(parent,returned=[],actor=OWNER,session=SESSION)=>(await service.query('select public.ai_audit_console_prepare($1,$1,$2,$3,$4,$5,$6) r',[actor,session,randomUUID(),parent,returned,'b'.repeat(64)])).rows[0].r;
try{
  for(const f of ['20261113032515_ai_query_http_security.sql','20261113084732_ai_query_atomic_intake.sql'])await db.setup.query(await readFile(new URL('../../migrations/'+f,import.meta.url),'utf8'));
  await db.setup.query("insert into private.ai_audit_read_grants(user_id,valid_until,grant_reference) values($1,now()+interval '1 day','synthetic explicit auditor')",[OWNER]);
  await check('old sessionless audit read bypasses revoked-session boundary; reproduce before upgrade',async()=>{
    await db.setup.query('delete from auth.sessions where id=$1',[SESSION]);
    const prior=(await service.query('select public.ai_query_audit_read($1,$1,$2) r',[OWNER,randomUUID()])).rows[0].r;
    assert.throws(()=>assert.equal(prior.allowed,false));assert.equal(prior.allowed,true);
  });
  await db.setup.query(await readFile(new URL('../../migrations/20261113090954_ai_audit_console_read.sql',import.meta.url),'utf8'));
  await check('old entry is closed and new entry requires a current live session even for explicit auditors',async()=>{
    assert.equal((await service.query('select public.ai_query_audit_read($1,$1,$2) r',[OWNER,randomUUID()])).rows[0].r.allowed,false);
    assert.equal((await read()).allowed,false);
    await db.setup.query('insert into auth.sessions(id,user_id) values($1,$2)',[SESSION,OWNER]);assert.equal((await read()).allowed,true);
  });
  await check('admin, simulation, missing grant, expired session, banned user and expired grant are denied with access history',async()=>{
    const adminSession=randomUUID();await db.setup.query('insert into auth.sessions(id,user_id) values($1,$2)',[adminSession,ADMIN]);
    assert.equal((await read(undefined,ADMIN,adminSession)).allowed,false);assert.equal((await read(undefined,OWNER,SESSION,OTHER)).allowed,false);
    await db.setup.query("update auth.sessions set not_after=now()-interval '1 second' where id=$1",[SESSION]);assert.equal((await read()).allowed,false);
    await db.setup.query('update auth.sessions set not_after=null where id=$1',[SESSION]);
    await db.setup.query("update auth.users set banned_until=now()+interval '1 day' where id=$1",[OWNER]);assert.equal((await read()).allowed,false);
    await db.setup.query('update auth.users set banned_until=null where id=$1',[OWNER]);
    await db.setup.query("update private.ai_audit_read_grants set valid_until=now()-interval '1 second' where user_id=$1",[OWNER]);assert.equal((await read()).allowed,false);
    await db.setup.query("update private.ai_audit_read_grants set valid_until=now()+interval '1 day' where user_id=$1",[OWNER]);
    assert.ok((await db.setup.query("select count(*)::int n from private.ai_audit_console_access where outcome='denied'")).rows[0].n>=6);
  });
  await check('grant change rotates revision, is audited, and prevents prepared data from being delivered',async()=>{
    const first=await read();assert.equal((await prepare(first.id)).allowed,true);
    await db.setup.query("update private.ai_audit_read_grants set grant_reference='synthetic changed scope' where user_id=$1",[OWNER]);
    const second=await read();assert.notEqual(second.revision,first.revision);assert.equal((await prepare(first.id)).allowed,false);
    assert.ok((await db.setup.query("select 1 from private.ai_query_policy_events where relation_name='ai_audit_read_grants'")).rowCount>0);
    assert.equal((await prepare(randomUUID())).allowed,false);
  });
  await check('keyset pagination retains identical timestamps and every intake attempt without pretending they executed',async()=>{
    const at=new Date(),ids=[];
    for(let i=0;i<53;i++){const id=randomUUID();ids.push(id);await db.setup.query("insert into private.ai_query_ingress_events(event_id,request_id,actor_id,session_id,reason,bytes_observed,body_complete,body_digest,digest_scope,occurred_at) values($1,$2,$3,$4,'request_received',1,true,$5,'complete',$6)",[id,randomUUID(),OTHER,randomUUID(),'c'.repeat(64),at]);}
    const filter={action:'list',from:new Date(Date.now()-86400000).toISOString(),to:new Date(Date.now()+1000).toISOString(),actorId:OTHER};
    const page1=await read(filter);assert.equal(page1.records.length,50);assert.equal(page1.has_more,true);assert.ok(page1.records.every(r=>r.related_state==='unstarted'));
    const last=page1.records.at(-1),page2=await read({...filter,beforeTime:last.occurred_at,beforeId:last.record_id});assert.equal(page2.records.length,3);assert.equal(page2.has_more,false);
    assert.equal(new Set([...page1.records,...page2.records].map(r=>r.record_id)).size,53);
    assert.equal((await prepare(page1.id,page1.records.map(r=>r.record_id))).allowed,true);
    assert.equal((await prepare(page1.id,[page2.records[0].record_id])).allowed,false);
  });
  await check('chain damage blocks stream content and access-history failures roll back read receipts',async()=>{
    const id=randomUUID();await service.query('select public.ai_query_audit_receive($1,$2,$3,$3,$4,$5,$6)',[id,randomUUID(),OTHER,'synthetic','d'.repeat(64),cipher()]);
    assert.equal((await read({action:'stream',id})).records.length,1);
    await db.setup.query("update private.ai_query_audit_events set event_hash=repeat('0',64) where request_id=$1",[id]);assert.equal((await read({action:'stream',id})).unavailable,true);
    await db.setup.query("create function private.fail_console_access() returns trigger language plpgsql set search_path='' as $$begin raise exception 'access failure';end $$;create trigger fail_console_access before insert on private.ai_audit_console_access for each row execute function private.fail_console_access()");
    try{await assert.rejects(read(),/access failure/);}finally{await db.setup.query('drop trigger fail_console_access on private.ai_audit_console_access;drop function private.fail_console_access()');}
  });
  await check('session and grant revocation serialize against read transactions and recheck before delivery',async()=>{
    const held=new pg.Client(config);await held.connect();await held.query('begin');await held.query('set local role service_role');
    const id=randomUUID();await held.query('select public.ai_audit_console_read($1,$1,$2,$3,$4,$5,$6)',[OWNER,SESSION,id,{action:'list',from:new Date(Date.now()-86400000).toISOString(),to:new Date(Date.now()+1000).toISOString()},'f'.repeat(64),cipher()]);
    const revoker=new pg.Client(config);await revoker.connect();let pending;
    try{pending=revoker.query('delete from auth.sessions where id=$1',[SESSION]);
      for(let i=0;i<100;i++){const waiting=(await db.setup.query("select 1 from pg_stat_activity where pid=$1 and wait_event_type='Lock'",[revoker.processID])).rowCount;if(waiting)break;await new Promise(resolve=>setTimeout(resolve,10));}
      assert.equal((await db.setup.query("select wait_event_type from pg_stat_activity where pid=$1",[revoker.processID])).rows[0].wait_event_type,'Lock');
      await held.query('commit');await pending;assert.equal((await prepare(id)).allowed,false);
    }finally{await held.query('rollback');await held.end();await pending;await revoker.end();}
  });
  await check('anonymous/authenticated RPC execution and raw service table access are denied',async()=>{
    for(const role of ['anon','authenticated']){await db.setup.query('set role '+role);try{await assert.rejects(db.setup.query('select public.ai_audit_console_read($1,$1,$2,$3,$4,$5,$6)',[OWNER,SESSION,randomUUID(),{action:'invalid'},'a'.repeat(64),cipher()]),e=>e.code==='42501');}finally{await db.setup.query('reset role');}}
    for(const sql of ['select * from private.ai_audit_console_access','delete from private.ai_audit_console_access','select * from private.ai_audit_read_grants',"update private.ai_audit_read_grants set valid_until=now()+interval '1 year'"])await assert.rejects(service.query(sql),e=>e.code==='42501');
    const defs=(await db.setup.query("select n.nspname,p.prosecdef,p.proconfig,has_function_privilege('authenticated',p.oid,'execute') granted from pg_proc p join pg_namespace n on n.oid=p.pronamespace where p.proname in ('ai_audit_console_read','ai_audit_console_prepare')")).rows;
    assert.equal(defs.length,4);for(const d of defs){assert.equal(d.prosecdef,d.nspname==='private');assert.equal(d.granted,false);assert.ok(d.proconfig.includes('search_path=""'));}
  });
  await mkdir('verification/ai-audit-console',{recursive:true});await writeFile('verification/ai-audit-console/results.json',JSON.stringify({database:db.version,scenarios:results,production:false,modelCalls:false},null,2)+'\n');
  console.log(`PASS ${results.length} audit console PostgreSQL 17 scenarios`);
}finally{await service.end();await db.close();}
