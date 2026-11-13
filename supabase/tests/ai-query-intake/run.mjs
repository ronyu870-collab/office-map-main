import assert from 'node:assert/strict';
import { randomUUID, randomBytes } from 'node:crypto';
import { readFile, mkdir, writeFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { createRequire } from 'node:module';
import path from 'node:path';
import pg from 'pg';
import { rolldown } from 'rolldown';
import { createLeaseTestDatabase, OWNER, OTHER } from '../lease-change-history/database.mjs';
const db=await createLeaseTestDatabase(),results=[];
const output=path.resolve('verification/ai-query-intake');await mkdir(output,{recursive:true});
const compiled=await mkdtemp(path.join(tmpdir(),'ai-query-intake-test-'));
const config={host:'127.0.0.1',port:Number(process.env.LEASE_TEST_PG_PORT),user:'postgres',password:'synthetic_ci_only',database:db.database};
const service=new pg.Client(config);await service.connect();await service.query('set role service_role');
const check=async(name,fn)=>{await fn();results.push({scenario:name,status:'passed'});console.log('PASS '+name);};
let captured;
const rpc={rpc(name,args){captured={name,args};return {abortSignal:async()=>{
  try{assert.ok(['ai_query_record_intake','ai_query_record_ingress'].includes(name));
    const r=await service.query(`select public.${name}(${Object.keys(args).map((k,i)=>k+'=> $'+(i+1)).join(',')})`,Object.values(args));return {data:r.rows[0],error:null};
  }catch(error){return {data:null,error};}
}};}};
const keys={keyId:'isolated-intake',encryptionKey:randomBytes(32),digestKey:randomBytes(32)};
try{
  for(const name of ['intake','auditCrypto']){const bundle=await rolldown({input:path.resolve('src/lib/intelligence/query/'+name+'.ts'),platform:'node'});try{await bundle.write({file:path.join(compiled,name+'.cjs'),format:'cjs'});}finally{await bundle.close();}}
  const require=createRequire(import.meta.url),{recordQueryIntake,decodeIntakeDocument}=require(path.join(compiled,'intake.cjs'));
  const {decryptAuditContent,auditPayloadDigest}=require(path.join(compiled,'auditCrypto.cjs'));
  const decrypt=row=>decodeIntakeDocument(decryptAuditContent(row.cipher,{requestId:row.request_id,eventId:row.event_id,actorId:row.actor_id,effectiveUserId:row.effective_user_id},new Map([[keys.keyId,keys.encryptionKey]])));
  const identity={actorId:OWNER,effectiveUserId:OTHER,sessionId:randomUUID(),expiresAt:Date.now()+60000};
  const request=(text='CBD最高的楼是什么？')=>({requestId:randomUUID(),identity,entry:'query_submission',impersonationDenied:false,
    body:{text,bytesObserved:Buffer.byteLength(text),complete:true,digest:auditPayloadDigest(text,keys.digestKey),digestScope:'complete',rejection:null}});
  const rows=async id=>(await db.setup.query('select * from private.ai_query_ingress_events where request_id=$1',[id])).rows;
  for(const f of ['20261113003933_ai_query_audit_foundation.sql','20261113032515_ai_query_http_security.sql','20261113080906_ai_query_execution_reconciliation.sql'])await db.setup.query(await readFile(new URL('../../migrations/'+f,import.meta.url),'utf8'));
  const original=request();
  await check('old two-step ingress loses original content if execution ends before audit receive',async()=>{
    await service.query("select public.ai_query_record_ingress($1,$2,$3,$4,'request_received',$5,true,$6,'complete')",[randomUUID(),original.requestId,OWNER,identity.sessionId,original.body.bytesObserved,original.body.digest]);
    const intact=r=>assert.ok(r.cipher,'accepted ingress must retain protected submitted content');
    const row=(await rows(original.requestId))[0];
    assert.throws(()=>intact(row),/accepted ingress/);
    assert.equal((await rows(original.requestId)).length,1);
    assert.equal((await db.setup.query('select count(*)::int n from private.ai_query_audit_events where request_id=$1',[original.requestId])).rows[0].n,0);
  });
  await db.setup.query(await readFile(new URL('../../migrations/20261113084732_ai_query_atomic_intake.sql',import.meta.url),'utf8'));
  await check('actual application intake commits identity, observation and decryptable original body together',async()=>{
    const input=request();await recordQueryIntake(rpc,keys,input);const row=(await rows(input.requestId))[0];
    assert.ok(row.cipher,'accepted ingress must retain protected submitted content');assert.equal(decrypt(row).content.payload.rawRequest,input.body.text);
    assert.equal(row.actor_id,OWNER);assert.equal(row.effective_user_id,OTHER);assert.equal(decrypt(row).content.authorization,'not_evaluated');
    assert.equal((await rows(original.requestId))[0].cipher,null,'historical unknown body is not invented');
    assert.throws(()=>decrypt({...row,effective_user_id:OWNER}));
  });
  await check('credential masking decodes JSON escapes and leaves business question intact',async()=>{
    const input=request('{"question":"CBD有哪些楼？ password=\\u0073yntheticSecret"}');await recordQueryIntake(rpc,keys,input);
    const content=decrypt((await rows(input.requestId))[0]);assert.ok(!JSON.stringify(content).includes('syntheticSecret'));
    assert.match(content.content.payload.rawRequest,/CBD有哪些楼/);assert.ok(content.redactionTypes.length>0);
  });
  await check('full bounded malformed control-character input survives JSON expansion without truncation',async()=>{
    const input=request('\u0000'.repeat(24576));await recordQueryIntake(rpc,keys,input);
    assert.equal(decrypt((await rows(input.requestId))[0]).content.payload.rawRequest,input.body.text);
  });
  await check('transaction failure leaves neither accepted count nor content; later retry commits both',async()=>{
    const input=request();await db.setup.query("create function private.fail_intake() returns trigger language plpgsql set search_path='' as $$begin raise exception 'intake fault';end $$;create trigger fail_intake after insert on private.ai_query_ingress_events for each row execute function private.fail_intake()");
    try{await assert.rejects(recordQueryIntake(rpc,keys,input),/AUDIT_PERSISTENCE_UNAVAILABLE/);assert.equal((await rows(input.requestId)).length,0);}
    finally{await db.setup.query('drop trigger fail_intake on private.ai_query_ingress_events;drop function private.fail_intake()');}
    await recordQueryIntake(rpc,keys,input);assert.equal(decrypt((await rows(input.requestId))[0]).content.payload.rawRequest,input.body.text);
  });
  await check('same HTTP request retried creates separate attempts; same event transport replay is exact and concurrent-safe',async()=>{
    const input=request();await recordQueryIntake(rpc,keys,input);const {args}=captured;
    // Fixture reset lets four real connections race the first insert using one
    // unchanged, correctly AEAD-bound transport envelope.
    await db.setup.query('delete from private.ai_query_ingress_events where event_id=$1',[args.p_event_id]);
    const sql=`select public.ai_query_record_intake(${Object.keys(args).map((k,i)=>k+'=> $'+(i+1)).join(',')})`,values=Object.values(args);
    const clients=Array.from({length:4},()=>new pg.Client(config));
    try{await Promise.all(clients.map(async c=>{await c.connect();await c.query('set role service_role');await c.query(sql,values);}));}
    finally{await Promise.all(clients.map(c=>c.end()));}
    assert.equal((await rows(input.requestId)).length,1);
    assert.equal(decrypt((await rows(input.requestId))[0]).content.payload.rawRequest,input.body.text);
    await assert.rejects(service.query(sql,Object.values({...args,p_content_digest:'0'.repeat(64)})),/intake idempotency conflict/);
    await recordQueryIntake(rpc,keys,input);assert.equal((await rows(input.requestId)).length,2);
    await recordQueryIntake(rpc,keys,{...request('同幂等键的不同问题'),requestId:input.requestId});assert.equal((await rows(input.requestId)).length,3);
  });
  await check('anonymous and incomplete bodies stay bounded digest-only; invalid technical receipts never retain tokens',async()=>{
    const input=request('secret arbitrary technical text');await recordQueryIntake(rpc,keys,{...input,identity:undefined});assert.equal((await rows(input.requestId))[0].cipher,null);
    const bad=request();bad.body={...bad.body,text:null,rejection:'body_too_large',complete:false,digestScope:'prefix'};await recordQueryIntake(rpc,keys,bad);assert.equal((await rows(bad.requestId))[0].cipher,null);
    const report=request('deliveryToken secret');await recordQueryIntake(rpc,keys,{...report,entry:'query_delivery_report'});
    const content=decrypt((await rows(report.requestId))[0]);assert.equal(content.content.payload.inputValid,false);assert.ok(!JSON.stringify(content).includes('deliveryToken secret'));
  });
  await check('orphan overview distinguishes retained new content from missing historical originals',async()=>{
    await db.setup.query("update private.ai_query_ingress_events set occurred_at=clock_timestamp()-interval '4 minutes'");
    const result=(await service.query("select public.ai_query_reconcile_overview(clock_timestamp()-interval '1 day') r")).rows[0].r;
    assert.ok(result.orphan_content_retained>0);assert.ok(result.orphan_ingress_attempts>result.orphan_content_retained);
    assert.equal(result.orphan_sample.find(r=>r.request_id===original.requestId).content_retained,false);
    assert.ok(result.orphan_sample.some(r=>r.content_retained));assert.ok(!JSON.stringify(result).includes('ciphertext'));
  });
  await check('ordinary roles cannot invoke intake and service cannot read, update or delete raw bodies',async()=>{
    const input=request();await recordQueryIntake(rpc,keys,input);const {args}=captured;
    for(const role of ['anon','authenticated']){await db.setup.query('set role '+role);try{await assert.rejects(db.setup.query(`select public.ai_query_record_intake(${Object.keys(args).map((k,i)=>k+'=> $'+(i+1)).join(',')})`,Object.values(args)),e=>e.code==='42501');}finally{await db.setup.query('reset role');}}
    await assert.rejects(service.query("select public.ai_query_record_ingress($1,$2,$3,$4,'request_received',1,true,$5,'complete')",[randomUUID(),randomUUID(),OWNER,identity.sessionId,'a'.repeat(64)]),/protected intake required/);
    for(const sql of ['select * from private.ai_query_ingress_events','delete from private.ai_query_ingress_events','update private.ai_query_ingress_events set cipher=null'])await assert.rejects(service.query(sql),e=>e.code==='42501');
    await assert.rejects(service.query(`select public.ai_query_record_intake(${Object.keys(args).map((k,i)=>k+'=> $'+(i+1)).join(',')})`,Object.values({...args,p_event_id:randomUUID(),p_cipher:{text:'unprotected'}})),/invalid audit ciphertext/);
  });
  await writeFile(path.join(output,'results.json'),JSON.stringify({database:db.version,scenarios:results,production:false,modelCalls:false},null,2)+'\n');
  console.log(`PASS ${results.length} atomic intake PostgreSQL 17 scenarios`);
}finally{try{await service.end();await db.close();}finally{await rm(compiled,{recursive:true,force:true});}}
