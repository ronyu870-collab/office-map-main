import assert from 'node:assert/strict';
import { randomUUID, randomBytes } from 'node:crypto';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import pg from 'pg';
import { createAiQueryTestDatabase, SESSION } from '../ai-query-authority/database.mjs';
import { OWNER, OTHER, ADMIN, VIEWER } from '../lease-change-history/database.mjs';
import { loadAuditPrerequisites, applyAdminOnly } from '../ai-admin-only/database.mjs';
const db=await createAiQueryTestDatabase(), results=[];
const service=new pg.Client({host:'127.0.0.1',port:Number(process.env.LEASE_TEST_PG_PORT),user:'postgres',password:'synthetic_ci_only',database:db.database});
await service.connect();await service.query('set role service_role');
const check=async(scenario,fn)=>{await fn();results.push({scenario,status:'passed'});console.log('PASS '+scenario);};
const window=()=>({action:'list',from:new Date(Date.now()-86400000).toISOString(),to:new Date(Date.now()+1000).toISOString()});
const read=async(filter={},actor=OWNER,session=SESSION)=>{
  const accessId=randomUUID(),cipher={version:1,algorithm:'aes-256-gcm',keyId:'synthetic-person',nonce:randomBytes(12).toString('hex'),tag:randomBytes(16).toString('hex'),ciphertext:'ab'};
  return {accessId,...(await service.query('select public.ai_audit_console_read($1,$1,$2,$3,$4,$5,$6) r',[actor,session,accessId,{...window(),...filter},'a'.repeat(64),cipher])).rows[0].r};
};
const add=async(actor,effective=actor)=>{const id=randomUUID();await db.setup.query("insert into private.ai_query_ingress_events(event_id,request_id,actor_id,session_id,reason,bytes_observed,body_complete,body_digest,digest_scope,effective_user_id,entry,content_digest,cipher) values($1,$2,$3,$4,'request_received',1,true,$5,'complete',$6,'query_submission',$5,'{}'::jsonb)",[id,randomUUID(),actor,randomUUID(),'c'.repeat(64),effective]);return id;};
try{
  await loadAuditPrerequisites(db);await applyAdminOnly(db);
  // Match the actual role-directory columns used by the production base schema.
  await db.setup.query('alter table public.user_roles add column if not exists full_name text,add column if not exists chinese_name text');
  await db.setup.query("update public.user_roles set role='admin' where user_id=$1",[OWNER]);
  await db.setup.query("insert into private.ai_audit_read_grants(user_id,valid_until,grant_reference) values($1,now()+interval '1 day','synthetic directory audit')",[OWNER]);
  await db.setup.query("update public.user_roles set full_name='Ming Zhang',chinese_name='张明' where user_id in ($1,$2)",[OTHER,VIEWER]);
  await db.setup.query("update public.user_roles set full_name='Unrelated',chinese_name=null where user_id=$1",[ADMIN]);
  await add(OTHER,VIEWER);await add(VIEWER);await add(ADMIN);
  await check('old implementation has no directory contract and silently ignores a name filter',async()=>{
    const old=await read({actorSearch:'张明'});assert.equal(old.directory_policy,undefined);
    assert.ok(old.records.some(r=>r.actor_id===ADMIN));assert.throws(()=>assert.ok(old.records.every(r=>[OTHER,VIEWER].includes(r.actor_id))));
  });
  await db.setup.query(await readFile(new URL('../../migrations/20261113130012_ai_audit_actor_directory.sql',import.meta.url),'utf8'));
  await check('current bilingual names are resolved after authorization; duplicate names retain separate actor IDs',async()=>{
    for(const actorSearch of ['张明','ming zhang']){
      const r=await read({actorSearch});assert.equal(r.directory_policy,'audit-actors/1');assert.ok(Date.parse(r.directory_as_of));
      assert.deepEqual(new Set(r.records.map(r=>r.actor_id)),new Set([OTHER,VIEWER]));
      assert.ok(r.records.every(r=>r.actor_name==='张明 / Ming Zhang' && !r.actor_name_truncated));
    }
    const precise=await read({actorId:OTHER,actorSearch:'张明'});assert.equal(precise.records.length,1);assert.equal(precise.records[0].effective_name,'张明 / Ming Zhang');
  });
  await check('name matching is literal and bounded; SQL wildcard and injection text cannot broaden results',async()=>{
    for(const actorSearch of ['%', '_', "' or true --"]){assert.equal((await read({actorSearch})).records.length,0);}
    await assert.rejects(()=>read({actorSearch:'x'.repeat(121)}),/invalid actor search/);
  });
  await check('renames do not rewrite historical identities; missing or deleted directory retains the immutable ID',async()=>{
    await db.setup.query("update public.user_roles set full_name='Changed Name',chinese_name=null where user_id=$1",[OTHER]);
    assert.equal((await read({actorId:OTHER})).records[0].actor_name,'Changed Name');
    assert.equal((await read({actorSearch:'Ming Zhang'})).records.length,1);
    await db.setup.query('delete from public.user_roles where user_id=$1',[OTHER]);
    const missing=(await read({actorId:OTHER})).records[0];assert.equal(missing.actor_name,null);assert.equal(missing.actor_id,OTHER);
    await db.setup.query('update auth.users set deleted_at=now() where id=$1',[VIEWER]);
    assert.equal((await read({actorId:VIEWER})).records[0].actor_name,null);
  });
  await check('long display labels are explicitly shortened without dropping records or changing full-name matching',async()=>{
    await db.setup.query('update public.user_roles set full_name=$1 where user_id=$2',['😀'.repeat(180)+'unique-tail',ADMIN]);
    const row=(await read({actorSearch:'unique-tail'})).records[0];assert.equal(row.actor_id,ADMIN);assert.equal(row.actor_name_truncated,true);assert.equal([...row.actor_name].length,160);
  });
  await check('filtered keyset pagination is complete and returned record IDs are covered by the read ledger',async()=>{
    for(let i=0;i<53;i++)await add(ADMIN);
    const first=await read({actorSearch:'unique-tail'});assert.equal(first.records.length,50);assert.equal(first.has_more,true);
    const last=first.records.at(-1),second=await read({actorSearch:'unique-tail',beforeTime:last.occurred_at,beforeId:last.record_id});assert.equal(second.records.length,4);
    assert.equal(new Set([...first.records,...second.records].map(r=>r.record_id)).size,54);
    const ledger=(await db.setup.query('select record_ids,outcome from private.ai_audit_console_access where access_id=$1',[first.accessId])).rows[0];
    assert.equal(ledger.outcome,'allowed');assert.deepEqual(ledger.record_ids,first.records.map(r=>r.record_id));
  });
  await check('non-admin qualification, lost grant, direct clients and access-ledger failure never disclose directory labels',async()=>{
    await db.setup.query("update public.user_roles set role='viewer' where user_id=$1",[OWNER]);
    const denied=await read({actorSearch:'unique-tail'});assert.equal(denied.allowed,false);assert.equal(denied.records,undefined);
    await db.setup.query("update public.user_roles set role='admin' where user_id=$1",[OWNER]);
    await db.setup.query("update private.ai_audit_read_grants set valid_until=now()-interval '1 second' where user_id=$1",[OWNER]);assert.equal((await read()).allowed,false);
    await assert.rejects(()=>db.asUser(ADMIN,'select public.ai_audit_console_read($1,$1,$2,$3,$4,$5,$6)',[ADMIN,SESSION,randomUUID(),window(),'a'.repeat(64),{}]),/permission denied/);
    await db.setup.query("update private.ai_audit_read_grants set valid_until=now()+interval '1 day' where user_id=$1",[OWNER]);
    await db.setup.query("create function private.people_fault() returns trigger language plpgsql set search_path='' as $$begin raise exception 'synthetic ledger failure';end $$;create trigger people_fault before insert on private.ai_audit_console_access for each row execute function private.people_fault()");
    try{await assert.rejects(()=>read(),/synthetic ledger failure/);}finally{await db.setup.query('drop trigger people_fault on private.ai_audit_console_access;drop function private.people_fault()');}
  });
  await mkdir('verification/ai-audit-people',{recursive:true});await writeFile('verification/ai-audit-people/results.json',JSON.stringify({database:db.version,scenarios:results,production:false},null,2)+'\n');
  console.log(`PASS ${results.length} real PostgreSQL directory scenarios`);
}finally{await service.end();await db.close();}
