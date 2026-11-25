// Actual application adapters → Supabase JS → PostgREST 16 → PostgreSQL 17.
// The session/identity are SQL fixtures, not evidence of a real GoTrue sign-in.
import assert from 'node:assert/strict';
import { createHmac,randomBytes,randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:net';
import { mkdtemp,writeFile,rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { rolldown } from 'rolldown';
import { createClient } from '@supabase/supabase-js';
import { OWNER,ADMIN } from '../lease-change-history/database.mjs';
import { createAiQueryTestDatabase,grantQuery,SESSION } from './database.mjs';
import { loadAuditPrerequisites,applyAdminOnly } from '../ai-admin-only/database.mjs';
import { addSnapshotFixture,BUILDINGS } from './snapshot-fixture.mjs';

const db=await createAiQueryTestDatabase();
const root=process.cwd(), temporary=await mkdtemp(path.join(tmpdir(),'colliers-ai-rpc-'));
const role=`ai_gateway_${randomBytes(8).toString('hex')}`, password=randomBytes(32).toString('hex'), secret=randomBytes(48).toString('hex');
let server,passed=0;
const check=async(name,fn)=>{await fn();passed++;console.log('PASS '+name);};
try{
  await loadAuditPrerequisites(db);await applyAdminOnly(db);
  await db.setup.query("update public.user_roles set role='admin' where user_id=$1",[OWNER]);
  const bundle=await rolldown({input:'\0ai-test',platform:'node',resolve:{alias:{'@':root}},plugins:[{
    name:'actual-ai-adapters',resolveId(id){if(id==='\0ai-test')return id;},load(id){if(id==='\0ai-test')return [
      `export {createRpcAuditPort,sanitizeAuditContent} from ${JSON.stringify(root+'/src/lib/intelligence/query/auditStore.ts')};`,
      `export {loadDataAuthority} from ${JSON.stringify(root+'/src/lib/intelligence/query/serverAuthority.ts')};`,
      `export {decryptAuditContent} from ${JSON.stringify(root+'/src/lib/intelligence/query/auditCrypto.ts')};`,
      `export {decodeGeneratedArchive} from ${JSON.stringify(root+'/src/lib/intelligence/query/resultArchive.ts')};`,
      `export {runAuditedQuery} from ${JSON.stringify(root+'/src/lib/intelligence/query/admission.ts')};`,
      `export {readQuerySnapshots} from ${JSON.stringify(root+'/src/lib/intelligence/query/snapshotReader.ts')};`,
      `export {executeQueryPlan} from ${JSON.stringify(root+'/src/lib/intelligence/query/executePlan.ts')};`,
      `export {aggregateQuarter,compareQuarters,rankBuildings} from ${JSON.stringify(root+'/src/lib/intelligence/query/analytics.ts')};`,
      `export {buildListResult,buildRankResult,buildAggregateResult} from ${JSON.stringify(root+'/src/lib/intelligence/query/result.ts')};`,
    ].join('\n');},
  }]});
  let compiled;
  try{compiled=(await bundle.generate({format:'cjs'})).output.find(file=>file.type==='chunk').code;}finally{await bundle.close();}
  const modulePath=path.join(temporary,'actual-adapters.cjs');await writeFile(modulePath,compiled);
  const api=createRequire(import.meta.url)(modulePath);
  const socket=createServer();socket.listen(0,'127.0.0.1');await once(socket,'listening');const port=socket.address().port;await new Promise(resolve=>socket.close(resolve));
  const url=`http://127.0.0.1:${port}`;
  await db.setup.query(`create role ${role} login noinherit password '${password}'; grant anon,authenticated,service_role to ${role}`);
  server=spawn(process.env.POSTGREST_PATH||'postgrest',[],{env:{PATH:process.env.PATH,PGRST_DB_URI:`postgresql://${role}:${password}@127.0.0.1:${process.env.LEASE_TEST_PG_PORT}/${db.database}`,PGRST_DB_SCHEMAS:'public',PGRST_DB_ANON_ROLE:'anon',PGRST_JWT_SECRET:secret,PGRST_SERVER_HOST:'127.0.0.1',PGRST_SERVER_PORT:String(port)},stdio:['ignore','ignore','pipe']});
  server.stderr.resume();let startError;server.on('error',error=>{startError=error;});let ready=false;
  for(let i=0;i<100;i++){
    if(startError || server.exitCode!==null)throw new Error('POSTGREST_START_FAILED');
    try{if((await fetch(url,{signal:AbortSignal.timeout(1000)})).ok){ready=true;break;}}catch{}
    await new Promise(resolve=>setTimeout(resolve,100));
  }
  assert.ok(ready,'Actual PostgREST is required');
  const token=roleName=>{
    const part=value=>Buffer.from(JSON.stringify(value)).toString('base64url');
    const body=`${part({alg:'HS256',typ:'JWT'})}.${part({role:roleName,sub:OWNER,exp:Math.floor(Date.now()/1000)+300})}`;
    return `${body}.${createHmac('sha256',secret).update(body).digest('base64url')}`;
  };
  const client=roleName=>createClient(url,'synthetic-publishable',{accessToken:async()=>token(roleName),global:{fetch:(input,options)=>{
    const target=new URL(input);assert.equal(target.origin,url);assert.ok(target.pathname.startsWith('/rest/v1/'));
    target.pathname=target.pathname.slice('/rest/v1'.length);return fetch(target,options);
  }}});
  const service=client('service_role');
  const identity={actorId:OWNER,effectiveUserId:OWNER,sessionId:SESSION,expiresAt:Date.now()+300000};
  const keys={keyId:'isolated-v1',encryptionKey:randomBytes(32),digestKey:randomBytes(32)};
  const audit=api.createRpcAuditPort(service,identity,keys);
  const fresh=()=>api.loadDataAuthority(service,identity,new AbortController().signal);
  await db.setup.query('update private.ai_query_control set enabled=true');await grantQuery(db,OWNER);
  const authority=await fresh();
  const fixture=await addSnapshotFixture(db);
  // Refresh PostgREST's catalog after adding the actual snapshot RPC.
  await db.setup.query("notify pgrst,'reload schema'");
  for(let attempt=0;attempt<100;attempt++){
    const probe=await service.rpc('ai_query_snapshot_read',{p_actor:OWNER,p_effective:OWNER,p_session:SESSION,p_permission_revision:authority.permissionRevision,p_fields:[],p_periods:[],p_inventory:'tracked',p_submarkets:['CBD'],p_building_ids:null});
    if(!probe.error)break;
    if(probe.error.code!=='PGRST202'||attempt===99)throw new Error(`Snapshot RPC not ready: ${probe.error.code} ${probe.error.message}`);
    await new Promise(resolve=>setTimeout(resolve,50));
  }
  const plan={operation:'rank',scope:{inventory:'tracked',submarkets:['CBD']},field:'height',period:null,direction:'desc',limit:1};
  const request=(id=randomUUID())=>({requestId:id,submittedText:'CBD最高的楼？密码="synthetic-secret"',plan,authority,signal:new AbortController().signal});
  const events=async id=>(await db.setup.query('select * from private.ai_query_audit_events where request_id=$1 order by sequence',[id])).rows;
  const decrypt=(event)=>JSON.parse(api.decryptAuditContent(event.cipher,{requestId:event.request_id,eventId:event.event_id,actorId:OWNER,effectiveUserId:OWNER},new Map([[keys.keyId,keys.encryptionKey]])));
  let successId;
  await check('actual RPC persists encrypted question before execution and actual generated result afterward',async()=>{
    const input=request();successId=input.requestId;
    const result=await api.runAuditedQuery(input,audit,{freshAuthority:fresh,execute:async()=>{
      const stored=await events(input.requestId);assert.deepEqual(stored.map(event=>event.kind),['received','running']);
      const original=decrypt(stored[0]);assert.ok(original.content.submittedText.includes('CBD最高'));assert.ok(!original.content.submittedText.includes('synthetic-secret'));
      const snapshots=await api.readQuerySnapshots(service,identity,await fresh(),plan,new AbortController().signal);
      return {answer:'仅已知高度记录中的最高楼',result:api.executeQueryPlan(plan,snapshots)};
    }});
    assert.equal(result.status,'ready');const stored=await events(input.requestId);
    assert.deepEqual(stored.map(event=>event.kind),['received','running','response_generated','succeeded']);
    assert.equal(decrypt(stored[2]).content.result.answer,result.result.answer);
    const recovered=api.decodeGeneratedArchive(stored.filter(event=>event.kind==='response_generated').map(event=>({...event,sequence:Number(event.sequence)})),
      {requestId:input.requestId,actorId:OWNER,effectiveUserId:OWNER},new Map([[keys.keyId,keys]]));
    assert.deepEqual(recovered.result,result.result);
    assert.equal(decrypt(stored[3]).content.delivery,'not_yet_sent');
  });
  await check('same request is durable-idempotent across a newly constructed adapter',async()=>{
    let executed=false;const again=api.createRpcAuditPort(service,identity,keys);
    const result=await api.runAuditedQuery(request(successId),again,{freshAuthority:fresh,execute:async()=>{executed=true;}});
    assert.equal(result.status,'already_received');assert.equal(executed,false);assert.equal((await events(successId)).length,4);
  });
  await check('actual database audit fault prevents query execution and leaves no false receipt',async()=>{
    await db.setup.query("create function private.fail_rpc_audit() returns trigger language plpgsql as $$ begin raise exception 'injected persistence failure'; end $$; create trigger ai_fault before insert on private.ai_query_audit_events for each row execute function private.fail_rpc_audit()");
    const input=request();let executed=false;
    try{await assert.rejects(api.runAuditedQuery(input,audit,{freshAuthority:fresh,execute:async()=>{executed=true;}}),/AUDIT_PERSISTENCE_UNAVAILABLE/);assert.equal(executed,false);assert.equal((await events(input.requestId)).length,0);}
    finally{await db.setup.query('drop trigger ai_fault on private.ai_query_audit_events');}
  });
  await check('withdrawal during execution suppresses delivery and persists refusal',async()=>{
    const input=request();const result=await api.runAuditedQuery(input,audit,{freshAuthority:fresh,execute:async()=>{
      await db.setup.query('update private.ai_query_grants set enabled=false where user_id=$1',[OWNER]);return {sensitive:'not deliverable'};
    }});
    assert.deepEqual(result,{status:'denied'});assert.equal((await events(input.requestId)).at(-1).kind,'denied');await grantQuery(db,OWNER);
  });
  await check('large generated result survives chunk encryption, storage and exact reconstruction',async()=>{
    const input=request();input.authority=await fresh();await audit.receive(input);await audit.append(input.requestId,'running',{});
    const detail={result:{cells:Array.from({length:5000},(_,i)=>({id:i,value:'楼宇数据'+i}))}};
    await audit.append(input.requestId,'response_generated',detail);
    const stored=(await events(input.requestId)).filter(event=>event.kind==='response_generated').map(event=>({...event,sequence:Number(event.sequence)}));
    assert.ok(stored.length>2);
    const context={requestId:input.requestId,actorId:OWNER,effectiveUserId:OWNER},ring=new Map([[keys.keyId,keys]]);
    const recovered=api.decodeGeneratedArchive(stored,context,ring);
    assert.deepEqual(recovered.result,detail.result);
    assert.throws(()=>api.decodeGeneratedArchive(stored.slice(1),context,ring));
    assert.throws(()=>api.decodeGeneratedArchive(stored,{...context,actorId:ADMIN},ring));
  });
  await check('actual tables reproduce 170 rent, 17.5% vacancy, missing/conflicting heights and both comparisons',async()=>{
    const currentAuthority=await fresh();
    const read=plan=>api.readQuerySnapshots(service,identity,currentAuthority,plan,new AbortController().signal);
    const list=await read({operation:'list',scope:{inventory:'tracked',submarkets:['CBD']},fields:[],period:null});
    assert.equal(api.buildListResult(list[0],[]).table.rows.length,4);
    const ranked=api.rankBuildings((await read(plan))[0],'height',1,'desc');
    assert.equal(ranked.rows[0].entityId,BUILDINGS[0]);assert.equal(ranked.rows[0].value.numeric,210);
    assert.equal(ranked.coverage.valid,2);assert.equal(ranked.coverage.missing,1);assert.equal(ranked.coverage.conflict,1);
    for(const metric of ['rent','vacancy']){
      const compare={operation:'compare',scope:{inventory:'tracked',submarkets:['CBD']},metric,base:{year:2026,quarter:2},current:{year:2026,quarter:3},mode:'paired'};
      const [base,current]=await read(compare);assert.equal(base.dataVersion,current.dataVersion);
      assert.equal(api.aggregateQuarter(current,metric).value.numeric,metric==='rent'?170:0.175);
      const paired=api.compareQuarters(base,current,metric,'paired'),per=api.compareQuarters(base,current,metric,'per_period');
      assert.ok(Math.abs(paired.change.numeric-(metric==='rent'?10.38961038961039:5))<1e-9);
      assert.ok(Math.abs(per.change.numeric-(metric==='rent'?9.174311926605505:3.2142857142857144))<1e-9);
    }
  });
  await check('missing quarter and draft rows are not replaced with latest or current submissions',async()=>{
    const a=await fresh();const quarterly={operation:'aggregate',scope:{inventory:'tracked',buildingIds:[BUILDINGS[0]]},metric:'rent',period:{year:2026,quarter:1}};
    const [missing]=await api.readQuerySnapshots(service,identity,a,quarterly,new AbortController().signal);assert.equal(api.aggregateQuarter(missing,'rent').value,null);
    await db.setup.query('update public.building_metrics set is_draft=true where building_id=$1 and record_quarter=3',[BUILDINGS[0]]);
    try{const [draft]=await api.readQuerySnapshots(service,identity,a,{...quarterly,period:{year:2026,quarter:3}},new AbortController().signal);assert.equal(api.aggregateQuarter(draft,'rent').value,null);}
    finally{await db.setup.query('update public.building_metrics set is_draft=false where building_id=$1 and record_quarter=3',[BUILDINGS[0]]);}
  });
  await check('controlled executor applies filter evidence and renders same-snapshot comparisons',async()=>{
    const a=await fresh();
    const filtered={operation:'list',scope:{inventory:'tracked',submarkets:['CBD']},fields:[],period:null,filter:{field:'height',operator:'gt',value:'200'}};
    const selected=api.executeQueryPlan(filtered,await api.readQuerySnapshots(service,identity,a,filtered,new AbortController().signal));
    assert.deepEqual(selected.table.rows.map(row=>row.entityId),[BUILDINGS[0]]);
    assert.equal(selected.parameters.filterEvaluation[0].unknown,2);
    assert.ok(selected.limitations.some(text=>text.includes('有效版本优先级')));
    assert.ok(selected.sources.some(source=>source.entityId===BUILDINGS[3]&&source.field==='building_height'));
    const compared={operation:'compare',scope:{inventory:'tracked',submarkets:['CBD']},metric:'vacancy',base:{year:2026,quarter:2},current:{year:2026,quarter:3},mode:'paired'};
    const comparison=api.executeQueryPlan(compared,await api.readQuerySnapshots(service,identity,a,compared,new AbortController().signal));
    assert.equal(comparison.table.rows[0].cells.change.value.numeric,5);
    assert.equal(comparison.table.columns.find(column=>column.key==='change').unit,'percentage_point');
    assert.ok(comparison.sources.some(source=>source.period?.quarter===2));
    assert.ok(comparison.sources.some(source=>source.period?.quarter===3));
  });
  await check('snapshot reads enforce source predicate, allowed fields and current grant revision',async()=>{
    const a=await fresh();
    await db.setup.query(`create or replace function private.map_building_visible(p_building_id uuid) returns boolean language sql stable security definer set search_path='' as $$ select p_building_id<>'${BUILDINGS[3]}'::uuid and private.map_can_view_extended_inventory() $$`);
    try{const [limited]=await api.readQuerySnapshots(service,identity,a,plan,new AbortController().signal);assert.equal(limited.expectedCount,3);assert.ok(!limited.rows.some(row=>row.id===BUILDINGS[3]));}
    finally{await db.setup.query(fixture.helpers);}
    await grantQuery(db,OWNER,{fields:['height'],allSubmarkets:false,submarkets:['CBD']});
    await assert.rejects(api.readQuerySnapshots(service,identity,a,plan,new AbortController().signal),/QUERY_DENIED/);
    const scoped=await fresh();
    const response=await service.rpc('ai_query_snapshot_read',{p_actor:OWNER,p_effective:OWNER,p_session:SESSION,p_permission_revision:scoped.permissionRevision,p_fields:['height'],p_periods:[],p_inventory:'tracked',p_submarkets:['CBD'],p_building_ids:null});
    assert.equal(response.error,null);assert.deepEqual(Object.keys(response.data.rows[0].brochures[0].values),['height']);assert.equal(response.data.rows[0].metrics.length,0);
    const forbidden=await service.rpc('ai_query_snapshot_read',{p_actor:OWNER,p_effective:OWNER,p_session:SESSION,p_permission_revision:scoped.permissionRevision,p_fields:['parking'],p_periods:[],p_inventory:'tracked',p_submarkets:['CBD'],p_building_ids:null});assert.equal(forbidden.error.code,'42501');
    await assert.rejects(api.readQuerySnapshots(service,identity,scoped,{...plan,scope:{inventory:'tracked',submarkets:['金融街']}},new AbortController().signal),/QUERY_DENIED/);
    await grantQuery(db,OWNER);
  });
  await check('AI6 all-authorized quarterly groups include reference buildings and exclude ungranted rows',async()=>{
    await db.setup.query("update public.buildings set tracking_scope='reference_only',submarket='金融街' where id=$1",[BUILDINGS[2]]);
    await grantQuery(db,OWNER,{allBuildings:false,buildingIds:BUILDINGS.slice(0,3)});
    try {
      const p={operation:'group_aggregate',scope:{inventory:'all_authorized'},metric:'rent',groupBy:'submarket',period:{year:2026,quarter:2}};
      const snapshots=await api.readQuerySnapshots(service,identity,await fresh(),p,new AbortController().signal);
      assert.equal(snapshots[0].rows.length,3);
      const result=api.executeQueryPlan(p,snapshots);
      const value=market=>result.table.rows.find(r=>r.cells.name.value===market).cells.value.value.numeric;
      assert.equal(value('CBD'),157.5);assert.equal(value('金融街'),160);
      assert.ok(result.sources.some(s=>s.entityId===BUILDINGS[2]));assert.ok(!result.sources.some(s=>s.entityId===BUILDINGS[3]));
      const tracked=await api.readQuerySnapshots(service,identity,await fresh(),{...p,scope:{inventory:'tracked'}},new AbortController().signal);
      assert.equal(tracked[0].rows.length,2);
    } finally {
      await db.setup.query("update public.buildings set tracking_scope='tracked',submarket='CBD' where id=$1",[BUILDINGS[2]]);await grantQuery(db,OWNER);
    }
  });
  await check('3000-plus rows remain complete despite the gateway row limit; highest row beyond first page participates',async()=>{
    await db.setup.query("insert into public.buildings(id,name,submarket,grade) select ('77777777-7777-4777-8777-'||lpad(n::text,12,'0'))::uuid,'合成分页楼'||n,'CBD','A' from generate_series(1,3001) n");
    const highest='ffffffff-ffff-4fff-8fff-ffffffffffff';await db.setup.query("insert into public.buildings(id,name,submarket,grade) values($1,'合成末行最高楼','CBD','A')",[highest]);
    await db.setup.query('insert into public.building_brochure_data(building_id,building_height) values($1,999)',[highest]);
    const [snapshot]=await api.readQuerySnapshots(service,identity,await fresh(),plan,new AbortController().signal);
    assert.equal(snapshot.expectedCount,3006);assert.equal(snapshot.rows.length,3006);
    assert.equal(api.rankBuildings(snapshot,'height',1).rows[0].entityId,highest);
  });
  await check('actual gateway rejects end-user RPC and old deleted session',async()=>{
    const denied=await client('authenticated').rpc('ai_query_authority',{p_actor:OWNER,p_effective:OWNER,p_session:SESSION});assert.equal(denied.error.code,'42501');
    const auditRead=await service.rpc('ai_query_audit_read',{p_actor:ADMIN,p_effective:ADMIN,p_request_id:successId});assert.deepEqual(auditRead.data,{allowed:false});
    await db.setup.query('delete from auth.sessions where id=$1',[SESSION]);await assert.rejects(fresh(),/QUERY_DENIED/);
  });
  console.log(`PASS ${passed} actual SDK/PostgREST/audit adapter scenarios; no production or model calls`);
}finally{
  if(server&&server.exitCode===null){const stopped=once(server,'exit');server.kill('SIGTERM');await stopped;}
  await db.setup.query(`drop owned by ${role};drop role if exists ${role}`).catch(()=>{});
  await db.close();await rm(temporary,{recursive:true,force:true});
}
