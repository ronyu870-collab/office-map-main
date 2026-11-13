import assert from 'node:assert/strict';
import { randomUUID, randomBytes } from 'node:crypto';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import pg from 'pg';
import { createAiQueryTestDatabase, SESSION } from '../ai-query-authority/database.mjs';
import { OWNER, OTHER } from '../lease-change-history/database.mjs';
import { loadAuditPrerequisites, applyAdminOnly } from '../ai-admin-only/database.mjs';
const db=await createAiQueryTestDatabase(),results=[];
const config={host:'127.0.0.1',port:Number(process.env.LEASE_TEST_PG_PORT),user:'postgres',password:'synthetic_ci_only',database:db.database};
const service=new pg.Client(config);await service.connect();await service.query('set role service_role');
const check=async(scenario,fn)=>{await fn();results.push({scenario,status:'passed'});console.log('PASS '+scenario);};
const cipher=()=>({version:1,algorithm:'aes-256-gcm',keyId:'synthetic-export',nonce:randomBytes(12).toString('hex'),tag:randomBytes(16).toString('hex'),ciphertext:'ab'});
const call=async(phase='read',targets=[],parent=null,digest='a'.repeat(64),bytes=100)=>{
  const id=randomUUID();return {id,...(await service.query('select public.ai_audit_export_control($1,$1,$2,$3,$4,$5,$6,$7,$8,$9) r',[OWNER,SESSION,id,phase,parent,targets?JSON.stringify(targets):null,digest,phase==='read'||phase==='invalid'?null:bytes,phase==='read'||phase==='invalid'?cipher():null])).rows[0].r};
};
const grant=()=>db.setup.query("insert into private.ai_audit_export_grants(user_id,enabled,valid_until,grant_reference) values($1,true,now()+interval '1 day','synthetic export') on conflict(user_id) do update set enabled=true,valid_until=excluded.valid_until",[OWNER]);
try{
  await loadAuditPrerequisites(db);await applyAdminOnly(db);
  await db.setup.query('alter table public.user_roles add column if not exists full_name text,add column if not exists chinese_name text');
  for(const file of ['20261113130012_ai_audit_actor_directory.sql','20261113132136_ai_audit_controlled_export.sql','20261113135841_ai_audit_export_reconciliation.sql'])await db.setup.query(await readFile(new URL('../../migrations/'+file,import.meta.url),'utf8'));
  await db.setup.query("update public.user_roles set role='admin' where user_id=$1",[OWNER]);
  await db.setup.query("insert into private.ai_audit_read_grants(user_id,valid_until,grant_reference) values($1,now()+interval '1 day','synthetic reader')",[OWNER]);
  const ids=[randomUUID(),randomUUID()];for(const id of ids)await db.setup.query("insert into private.ai_query_ingress_events(event_id,request_id,actor_id,session_id,reason,bytes_observed,body_complete,body_digest,digest_scope,effective_user_id,entry,content_digest,cipher) values($1,$2,$3,$4,'request_received',1,true,$5,'complete',$3,'query_submission',$5,'{}'::jsonb)",[id,randomUUID(),OTHER,randomUUID(),'c'.repeat(64)]);
  const targets=ids.map(id=>({kind:'intake',id}));
  await check('read qualification is insufficient to export; denied attempts leave export history without content',async()=>{
    const denied=await call('read',targets);assert.equal(denied.allowed,false);assert.equal(denied.bundles,undefined);
    assert.equal((await db.setup.query('select outcome from private.ai_audit_export_events where event_id=$1',[denied.id])).rows[0].outcome,'denied');
  });
  await grant();
  await check('explicit export and read qualifications return every selected original with nullable orphan execution',async()=>{
    const r=await call('read',targets);assert.equal(r.allowed,true);assert.equal(r.policy,'audit-export/2');assert.equal(r.bundles.length,2);
    assert.deepEqual(r.bundles.map(x=>x.target),targets);assert.ok(r.bundles.every(x=>x.stream.stream===null && x.intake.records[0].actor_id===OTHER));
  });
  await check('zero, duplicate, over-limit, malformed targets and unknown IDs cannot become partial exports',async()=>{
    for(const t of [[],[targets[0],targets[0]],Array.from({length:51},()=>({kind:'intake',id:randomUUID()})),[{kind:'invalid',id:ids[0]}],[{...targets[0],extra:true}]])assert.equal((await call('read',t)).allowed,false);
    const missing=await call('read',[targets[0],{kind:'intake',id:randomUUID()}]);assert.equal(missing.allowed,false);assert.equal(missing.unavailable,true);assert.equal(missing.bundles,undefined);
  });
  await check('changed read or export grant, demotion and expired sessions block preparation of already-read data',async()=>{
    for(const mutate of [()=>db.setup.query("update private.ai_audit_export_grants set enabled=false where user_id=$1",[OWNER]),
      ()=>db.setup.query("update private.ai_audit_read_grants set grant_reference='updated' where user_id=$1",[OWNER]),
      ()=>db.setup.query("update public.user_roles set role='viewer' where user_id=$1",[OWNER]),
      ()=>db.setup.query("update auth.sessions set not_after=now()-interval '1 second' where id=$1",[SESSION])]){
      const r=await call('read',targets);assert.equal(r.allowed,true);await mutate();assert.equal((await call('prepare',null,r.id)).allowed,false);
      await grant();await db.setup.query("update public.user_roles set role='admin' where user_id=$1",[OWNER]);await db.setup.query('update auth.sessions set not_after=null where id=$1',[SESSION]);
    }
  });
  await check('preparation binds file bytes/hash and client-dispatch report is idempotent, never a disk-save assertion',async()=>{
    const r=await call('read',targets),p=await call('prepare',null,r.id);assert.equal(p.allowed,true);
    assert.equal((await call('client_dispatch',null,p.id)).allowed,true);assert.equal((await call('client_dispatch',null,p.id)).allowed,true);
    assert.equal((await call('client_dispatch',null,p.id,'b'.repeat(64))).allowed,false);assert.equal((await call('client_dispatch',null,p.id,'a'.repeat(64),101)).allowed,false);
    assert.equal((await db.setup.query("select count(*)::int n from private.ai_audit_export_events where parent_id=$1 and phase='client_dispatch' and outcome='allowed'",[p.id])).rows[0].n,1);
  });
  await check('role withdrawal waits for active read transaction and rejects its later file preparation',async()=>{
    const writer=new pg.Client(config);await writer.connect();let update;
    try{await service.query('begin');const r=await call('read',targets);update=writer.query("update public.user_roles set role='viewer' where user_id=$1",[OWNER]);
      let waiting=false;for(let i=0;i<100;i++){if((await db.setup.query("select 1 from pg_stat_activity where pid=$1 and wait_event_type='Lock'",[writer.processID])).rowCount){waiting=true;break;}await new Promise(resolve=>setTimeout(resolve,20));}
      assert.equal(waiting,true);await service.query('commit');await update;assert.equal((await call('prepare',null,r.id)).allowed,false);
    }finally{await service.query('rollback');await update?.catch(()=>{});await writer.end();await db.setup.query("update public.user_roles set role='admin' where user_id=$1",[OWNER]);}
  });
  await check('private raw snapshot helper, grant mutation and ledger tables remain inaccessible to clients and service role',async()=>{
    await assert.rejects(()=>service.query("select private.ai_audit_console_snapshot('{\"action\":\"list\"}')"),/permission denied/);
    await assert.rejects(()=>service.query('select * from private.ai_audit_export_events'),/permission denied/);
    await assert.rejects(()=>service.query('update private.ai_audit_export_grants set enabled=true'),/permission denied/);
    await assert.rejects(()=>db.asUser(OWNER,'select public.ai_audit_export_control($1,$1,$2,$3,$4,null,$5,$6,null,$7)',[OWNER,SESSION,randomUUID(),'read',JSON.stringify(targets),'a'.repeat(64),cipher()]),/permission denied/);
  });
  await check('read and preparation ledger faults abort the operation rather than exposing unaudited files',async()=>{
    for(const phase of ['read','prepare']){
      const r=await call('read',targets);
      await db.setup.query(`create function private.export_fault() returns trigger language plpgsql set search_path='' as $$begin if new.phase='${phase}' then raise exception 'synthetic export ledger fault';end if;return new;end $$;create trigger export_fault before insert on private.ai_audit_export_events for each row execute function private.export_fault()`);
      try{await assert.rejects(()=>phase==='read'?call('read',targets):call('prepare',null,r.id),/synthetic export ledger fault/);}finally{await db.setup.query('drop trigger export_fault on private.ai_audit_export_events;drop function private.export_fault()');}
    }
    assert.ok((await db.setup.query("select 1 from private.ai_query_policy_events where relation_name='ai_audit_export_grants'")).rowCount);
  });
  await mkdir('verification/ai-audit-export',{recursive:true});await writeFile('verification/ai-audit-export/results.json',JSON.stringify({database:db.version,scenarios:results,production:false},null,2)+'\n');
  console.log(`PASS ${results.length} PostgreSQL export scenarios`);
}finally{await service.end();await db.close();}
