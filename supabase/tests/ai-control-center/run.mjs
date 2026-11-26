import assert from 'node:assert/strict';
import { randomUUID, randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import pg from 'pg';
import { createAiQueryTestDatabase, SESSION, grantQuery } from '../ai-query-authority/database.mjs';
import { OWNER, ADMIN } from '../lease-change-history/database.mjs';
const db = await createAiQueryTestDatabase();
const connection = { host: '127.0.0.1', port: Number(process.env.LEASE_TEST_PG_PORT), user: 'postgres', password: 'synthetic_ci_only', database: db.database };
const service = new pg.Client(connection); await service.connect(); await service.query('set role service_role');
const caps = ['operations:read','models:write','budgets:write','tests:run','emergency:write','grants:write'];
const model = { id:'ds-primary',provider:'deepseek',model:'deepseek-flash',name:'Synthetic DeepSeek fixture',enabled:true,
  verification:'verified',verifiedAt:new Date().toISOString(),tools:true,structured:true,streaming:true,reasoning:null,continuation:false,
  contextLimit:null,outputLimit:null,inputRate:.3,cachedInputRate:null,outputRate:1.2,currency:'USD',priceSource:'synthetic fixture, not invoice',priceDate:'2026-11-25' };
const limits = { tokens:60000,usd:.25,outputTokens:1800,timeoutMs:18000,attempts:4,tools:4 };
const config = { protocol:'ai-control-config/1',modes:Object.fromEntries(['quick','professional','deep'].map(mode=>[mode,{model:model.id,fallback:null,limits}])),
  purposes:{semantic_intent:null,synthesis:null},budget:{kind:'observe',dailyUsd:1,monthlyUsd:10,testDailyUsd:0,warningPercent:[85],providerLimits:{deepseek:null,openai:null},modelLimits:{}},disabledTools:[] };
const manage = async (action,input={},actor=OWNER,session=SESSION,client=service) => (await client.query('select public.ai_control_manage($1,$2,$3,$4) r',[actor,session,action,input])).rows[0].r;
const admin=async(action,input={},actor=OWNER,session=SESSION)=>(await service.query('select public.ai_control_admin($1,$2,$3,$4) r',[actor,session,action,input])).rows[0].r;
const runtime = async () => (await service.query('select public.ai_control_runtime($1,$2) r',[OWNER,SESSION])).rows[0].r;
const read = () => manage('read');
const save = async (candidate=config,revision) => { const current=revision ?? (await read()).state.revision; return manage('draft',{config:candidate,expectedRevision:current}); };
const publish = async (draft,expectedRevision,reason='synthetic model switch') => manage('publish',{draftId:draft.id,expectedRevision,reason});
let n=0; const check=async (name,fn)=>{await fn();n++;console.log('PASS '+name);};
try {
  await db.setup.query(await readFile(new URL('../../migrations/20261125152942_ai_control_center.sql',import.meta.url),'utf8'));
  await check('migration preserves legacy AI state, creates no grants/config, and keeps global AI disabled',async()=>{
    assert.equal((await db.setup.query('select count(*) n from private.ai_management_grants')).rows[0].n,'0');
    assert.equal((await db.setup.query('select count(*) n from private.ai_control_versions')).rows[0].n,'0');
    assert.equal((await db.setup.query('select enabled from private.ai_query_control')).rows[0].enabled,false);
    assert.equal((await read()).allowed,false);
  });
  await db.setup.query("update public.user_roles set role='admin' where user_id=$1",[OWNER]);
  await check('admin alone has no management rights; runtime safely inherits environment with no active snapshot',async()=>{
    assert.equal((await read()).allowed,false);
    const result=await runtime();assert.equal(result.allowed,true);assert.equal(result.version,null);assert.equal(result.paused,false);
  });
  await db.setup.query("insert into private.ai_management_grants(user_id,capabilities,valid_until,reason) values($1,$2,now()+interval '1 day','isolated grant')",[OWNER,caps]);
  await db.setup.query('insert into private.ai_model_catalog(id,definition) values($1,$2)',[model.id,model]);
  await check('independent operations grant cannot publish, emergency or gain audit access',async()=>{
    await db.setup.query('update private.ai_management_grants set capabilities=$1 where user_id=$2',[['operations:read'],OWNER]);
    assert.equal((await read()).allowed,true);assert.equal((await save()).allowed,false);
    assert.equal((await manage('emergency',{})).allowed,false);
    assert.equal((await db.setup.query('select count(*) n from private.ai_audit_read_grants')).rows[0].n,'0');
    await db.setup.query('update private.ai_management_grants set capabilities=$1 where user_id=$2',[caps,OWNER]);
  });
  await check('draft/publish is atomic, records real actor, binds immutable model and assigns stable version',async()=>{
    const state=(await read()).state;const draft=(await save()).draft;
    assert.equal((await runtime()).version,null);
    const published=await publish(draft,state.revision);assert.equal(published.allowed,true);assert.ok(published.state.version);
    const active=await runtime();assert.deepEqual(active.config,config);assert.equal(active.models[0].model,model.model);
    const event=(await db.setup.query("select * from private.ai_management_events where action='publish'")).rows[0];
    assert.equal(event.actor_id,OWNER);assert.equal(event.session_id,SESSION);
  });
  await check('unverified/disabled/unknown/non-tool models cannot publish, including rollback',async()=>{
    const first=(await runtime()).version;const revision=(await read()).state.revision;
    for(const patch of [{verification:'unverified'},{enabled:false},{tools:false}]){
      await db.setup.query('update private.ai_model_catalog set definition=$1 where id=$2',[{...model,...patch},model.id]);
      await assert.rejects(()=>save(),/model not approved|model capability mismatch/);
      await assert.rejects(()=>manage('rollback',{version:first,expectedRevision:revision,reason:'synthetic rollback'}),/model not approved|model capability mismatch/);
    }
    await db.setup.query('update private.ai_model_catalog set definition=$1 where id=$2',[model,model.id]);
    await assert.rejects(()=>save({...config,modes:{...config.modes,quick:{...config.modes.quick,model:'unknown'}}}),/model not approved/);
  });
  await check('multi-admin concurrent publication cannot silently overwrite the winner',async()=>{
    const adminSession=randomUUID();
    await db.setup.query('insert into auth.sessions(id,user_id) values($1,$2)',[adminSession,ADMIN]);
    await db.setup.query("insert into private.ai_management_grants values($1,$2,now()+interval '1 day',gen_random_uuid(),'isolated second operator')",[ADMIN,caps]);
    const current=(await read()).state;
    const a=(await save(config,current.revision)).draft;
    const otherConfig={...config,disabledTools:['search_public_building_information']};
    const b=(await manage('draft',{config:otherConfig,expectedRevision:current.revision},ADMIN,adminSession)).draft;
    const second=new pg.Client(connection);await second.connect();await second.query('set role service_role');
    try {
      const replies=await Promise.all([
        publish(a,current.revision),
        manage('publish',{draftId:b.id,expectedRevision:current.revision,reason:'concurrent synthetic publish'},ADMIN,adminSession,second),
      ]);
      assert.equal(replies.filter(r=>r.conflict).length,1);
      assert.equal(replies.filter(r=>r.state?.version).length,1);
      assert.notEqual((await read()).state.revision,current.revision);
    }finally{await second.end();}
  });
  await check('rollback creates a new version and cannot undo live emergency controls',async()=>{
    const versions=await manage('history');const target=versions.versions.at(-1).version;
    let state=(await read()).state;
    const emergency=await manage('emergency',{expectedRevision:state.revision,paused:true,disabledProviders:['openai'],disabledModels:[],reason:'synthetic pause'});
    state=emergency.state;assert.equal((await runtime()).paused,true);
    const reverted=await manage('rollback',{expectedRevision:state.revision,version:target,reason:'synthetic valid rollback'});
    assert.notEqual(reverted.state.version,target);assert.equal(reverted.state.paused,true);
    const history=await manage('history');assert.equal(history.versions[0].restored_from,target);
  });
  await check('budget editing requires an independent grant at both save and publish',async()=>{
    const base=(await read()).state;const draft=(await save()).draft;
    await db.setup.query('update private.ai_management_grants set capabilities=$1 where user_id=$2',[["operations:read","models:write"],OWNER]);
    const changed={...config,budget:{...config.budget,dailyUsd:2}};
    assert.equal((await save(changed)).allowed,false);
    // A previously saved budget-changing draft cannot bypass a grant revoked before publication.
    await db.setup.query('update private.ai_control_drafts set config=$1 where id=$2',[changed,draft.id]);
    assert.equal((await publish(draft,base.revision)).allowed,false);
    await db.setup.query('update private.ai_management_grants set capabilities=$1 where user_id=$2',[caps,OWNER]);
  });
  await check('secret/URL/SQL-bearing extra config members and unknown actions are rejected',async()=>{
    for(const patch of [{apiKey:'synthetic-never-store'},{url:'https://attacker.invalid'},{sql:'select 1'}])await assert.rejects(()=>save({...config,...patch}),/invalid control config/);
    assert.equal((await manage('execute_sql',{})).allowed,false);
  });
  await check('viewer/editor/demotion, banned/deleted users and ended sessions are rejected server-side',async()=>{
    for(const role of ['viewer','editor']){
      await db.setup.query('update public.user_roles set role=$1 where user_id=$2',[role,OWNER]);
      assert.equal((await read()).allowed,false);assert.equal((await runtime()).allowed,false);
    }
    await db.setup.query("update public.user_roles set role='admin' where user_id=$1",[OWNER]);
    for(const field of ['banned_until','deleted_at']){
      await db.setup.query(`update auth.users set ${field}=now()+interval '1 day' where id=$1`,[OWNER]);
      assert.equal((await read()).allowed,false);
      await db.setup.query(`update auth.users set ${field}=null where id=$1`,[OWNER]);
    }
    await db.setup.query("update auth.sessions set not_after=now()-interval '1 second' where id=$1",[SESSION]);
    assert.equal((await read()).allowed,false);assert.equal((await runtime()).allowed,false);
    await db.setup.query('update auth.sessions set not_after=null where id=$1',[SESSION]);
    assert.equal((await manage('read',{},OWNER,randomUUID())).allowed,false);
  });
  const cipher=()=>({version:1,algorithm:'aes-256-gcm',keyId:'synthetic-operations-fixture',nonce:randomBytes(12).toString('hex'),tag:randomBytes(16).toString('hex'),ciphertext:'ab'});
  const synthetic=async (attempts,status='completed',extra={})=>{
    const requestId=randomUUID(),eventId=randomUUID();
    await service.query('select public.ai_query_audit_receive($1,$2,$3,$3,$4,$5,$6)',[requestId,eventId,OWNER,'isolated-policy','a'.repeat(64),cipher()]);
    const events=[{eventId,metadata:{protocol:'ai-operations/1',kind:'received',type:'lifecycle'}}];
    const append=async(kind,metadata)=>{
      const next=randomUUID();await service.query('select public.ai_query_audit_append($1,$2,$3,$4,$5)',[requestId,next,kind,'b'.repeat(64),cipher()]);
      events.push({eventId:next,metadata:{protocol:'ai-operations/1',kind,...metadata}});
    };
    await append('running',{type:'lifecycle',route:attempts.length?'bounded_agent':'deterministic_query',taskType:'query',mode:'professional'});
    for(const [index,attempt] of attempts.entries())await append('accounting',{type:'model_attempt',attempt:index+1,provider:'deepseek',model:'deepseek-flash',attemptState:'completed',usageStatus:'provider_reported',inputTokens:100,outputTokens:20,cachedInputTokens:40,reasoningTokens:5,estimateUsd:.001,durationMs:50,...attempt});
    await append('accounting',{type:'summary',status,formalResult:true,durationMs:100,toolCalls:1,...extra});
    await append(status==='failed'?'failed':'succeeded',{type:'lifecycle',status});
    await service.query('select public.ai_operations_project($1,$2)',[requestId,JSON.stringify(events)]);
    return {requestId,events};
  };
  const operations=async(input)=>(await service.query('select public.ai_operations_read($1,$2,$3) r',[OWNER,SESSION,input])).rows[0].r;
  const window={from:new Date(Date.now()-3600000).toISOString(),to:new Date(Date.now()+1000).toISOString()};
  let partial;
  await check('operations projections are idempotent and count requests separately from paid attempts and preflight refusals',async()=>{
    partial=await synthetic([{}, {usageStatus:'unknown_reserved',inputTokens:null,outputTokens:null,cachedInputTokens:null,reasoningTokens:null,estimateUsd:.002,fallback:true},
      {usageStatus:'not_sent',inputTokens:null,outputTokens:null,estimateUsd:0}], 'partial',{filesRequested:1,filesCompleted:0});
    await service.query('select public.ai_operations_project($1,$2)',[partial.requestId,JSON.stringify(partial.events)]);
    await synthetic([]);await synthetic([{}],'failed');
    const overview=await operations({action:'overview',...window});
    assert.equal(overview.allowed,true);assert.equal(overview.metrics.requests,3);assert.equal(overview.metrics.completed,1);assert.equal(overview.metrics.partial,1);assert.equal(overview.metrics.failed,1);
    assert.equal(overview.usage.calls,3);assert.equal(overview.usage.notSent,1);assert.equal(overview.usage.unknownUsage,1);
    assert.equal(overview.usage.inputTokens,200);assert.equal(overview.usage.outputTokens,40);assert.equal(overview.usage.cachedInputTokens,80);
    assert.equal(overview.usage.estimatedUsd,.002);assert.equal(overview.usage.reservedUnknownUsd,.002);assert.equal(overview.usage.actualBilledUsd,null);
    assert.equal(overview.metrics.fileTasksCompleted,0);assert.equal(overview.metrics.fileTasks,1);
    assert.equal(overview.coverage.missingEvents,0);
    assert.equal(overview.trend.reduce((n,p)=>n+p.requests,0),3);
  });
  await check('projection requires an actual matching audit event; unknown body fields cannot enter operational tables',async()=>{
    for(const item of [{eventId:randomUUID(),metadata:{protocol:'ai-operations/1',kind:'received',type:'lifecycle'}},
      {...partial.events[0],metadata:{...partial.events[0].metadata,question:'synthetic private text'}}])
      await assert.rejects(()=>service.query('select public.ai_operations_project($1,$2)',[partial.requestId,JSON.stringify([item])]),/audit event absent|invalid projection metadata/);
    const detail=await operations({action:'detail',requestId:partial.requestId});
    assert.equal(detail.events.length,partial.events.length);assert.ok(!JSON.stringify(detail).includes('cipher'));
    assert.ok(!JSON.stringify(detail).includes('synthetic private text'));
  });
  await check('operations lists use fixed filters and bounded pagination; full interval statistics do not use the displayed page',async()=>{
    const page=await operations({action:'tasks',...window,pageSize:1});assert.equal(page.items.length,1);assert.equal(page.hasMore,true);
    const row=page.items[0],next=await operations({action:'tasks',...window,pageSize:1,beforeTime:row.received_at,beforeId:row.request_id});
    assert.notEqual(next.items[0].request_id,row.request_id);
    const oldest=await operations({action:'tasks',...window,pageSize:1,order:'oldest'}),second=await operations({action:'tasks',...window,pageSize:1,order:'oldest',beforeTime:oldest.items[0].received_at,beforeId:oldest.items[0].request_id});assert.notEqual(oldest.items[0].request_id,second.items[0].request_id);assert.ok(Date.parse(oldest.items[0].received_at)<=Date.parse(second.items[0].received_at));
    const filtered=await operations({action:'tasks',...window,filesComplete:false});assert.equal(filtered.items.length,1);assert.equal(filtered.items[0].request_id,partial.requestId);
    await assert.rejects(()=>operations({action:'overview',from:'2025-01-01T00:00:00Z',to:window.to}),/invalid operations range/);
    await assert.rejects(()=>operations({action:'tasks',...window,pageSize:100000}),/invalid operations page/);
  });
  await check('new models without traffic remain unknown; empty intervals preserve unknown tokens and costs',async()=>{
    const empty=await operations({action:'overview',from:'2026-01-01T00:00:00Z',to:'2026-01-01T01:00:00Z'});
    assert.equal(empty.metrics.requests,0);assert.equal(empty.usage.inputTokens,null);assert.equal(empty.usage.estimatedUsd,null);assert.deepEqual(empty.models,[]);
  });
  await check('full-range model/type filters, rankings and cost dimensions preserve unknown and authorized-user boundaries',async()=>{
    const filtered=await operations({action:'overview',...window,model:'deepseek-flash',taskType:'query',costOrder:'tokens'});
    assert.equal(filtered.metrics.requests,2);assert.equal(filtered.usage.calls,3);
    assert.equal(filtered.models[0].business_requests,2);assert.equal(filtered.models[0].business_completed,0);
    assert.equal(filtered.costDimensions.find(d=>d.dimension==='taskType'&&d.value==='query').unsuccessful_usd,.002);
    assert.equal(filtered.costRanking[0].tokens,120);
    const absent=await operations({action:'overview',...window,model:'no-traffic'});assert.equal(absent.metrics.requests,0);assert.equal(absent.usage.calls,0);assert.equal(absent.usage.estimatedUsd,null);
    await db.setup.query('update private.ai_management_grants set capabilities=$1 where user_id=$2',[['operations:read'],OWNER]);
    assert.equal((await operations({action:'overview',...window,actorId:OWNER})).allowed,false);
    assert.equal((await operations({action:'overview',...window})).costDimensions.some(d=>d.dimension==='actor'),false);
    await db.setup.query('update private.ai_management_grants set capabilities=$1 where user_id=$2',[caps,OWNER]);
  });
  await check('Beijing time buckets cross month/day boundaries with inclusive start and exclusive end',async()=>{
    const from='2026-10-30T16:00:00.000Z',to='2026-11-02T16:00:00.000Z',times=['2026-10-30T15:59:59.999Z','2026-10-31T15:59:59.999Z','2026-10-31T16:00:00.000Z',to];
    for(const at of times){const item=await synthetic([{}]);await db.setup.query('update private.ai_operation_requests set received_at=$1,updated_at=$1 where request_id=$2',[at,item.requestId]);await db.setup.query('update private.ai_operation_events set at=$1 where request_id=$2',[at,item.requestId]);}
    const result=await operations({action:'overview',from,to});assert.equal(result.bucket,'day');assert.equal(result.metrics.requests,2);assert.equal(result.usage.calls,2);assert.equal(result.trend.length,3);
    assert.equal(result.trend.find(b=>Date.parse(b.at)===Date.parse('2026-10-30T16:00:00Z')).requests,1);assert.equal(result.trend.find(b=>Date.parse(b.at)===Date.parse('2026-10-31T16:00:00Z')).requests,1);
    const emptyHour=await operations({action:'overview',from:'2026-01-31T15:30:00Z',to:'2026-01-31T16:30:00Z'});assert.equal(emptyHour.bucket,'minute');assert.equal(emptyHour.trend.length,60);assert.ok(emptyHour.trend.every(b=>b.requests===0));
  });
  const budgetRequest=async()=>{
    const id=randomUUID();await service.query('select public.ai_query_audit_receive($1,$2,$3,$3,$4,$5,$6)',[id,randomUUID(),OWNER,'budget-isolated','c'.repeat(64),cipher()]);
    await service.query('select public.ai_query_audit_append($1,$2,$3,$4,$5)',[id,randomUUID(),'running','d'.repeat(64),cipher()]);return id;
  };
  const budgetCall=async(requestId,action,input,client=service)=>(await client.query('select public.ai_model_budget($1,$2,$3,$4,$5) r',[OWNER,SESSION,requestId,action,input])).rows[0].r;
  const reserve=(id,usd,client=service,more={})=>budgetCall(id,'reserve',{attempt:1,provider:'deepseek',modelId:model.id,reserveUsd:usd,...more},client);
  const applyBudget=async(budget)=>{
    const value={...config,budget:{...config.budget,...budget}};const current=(await read()).state;const draft=(await save(value,current.revision)).draft;
    return publish(draft,current.revision,'synthetic budget policy');
  };
  await db.setup.query('update private.ai_query_control set enabled=true');await grantQuery(db,OWNER);
  const currentState=(await read()).state;
  await manage('emergency',{expectedRevision:currentState.revision,paused:false,disabledProviders:[],disabledModels:[],reason:'synthetic budget enable'});
  await check('global hard budget atomically admits only one concurrent request into the last available funds',async()=>{
    await applyBudget({kind:'hard',dailyUsd:.01,monthlyUsd:.01});
    const ids=await Promise.all([budgetRequest(),budgetRequest()]);
    const second=new pg.Client(connection);await second.connect();await second.query('set role service_role');
    try{
      const results=await Promise.all([reserve(ids[0],.006),reserve(ids[1],.006,second)]);
      assert.equal(results.filter(r=>r.allowed).length,1);assert.equal(results.find(r=>!r.allowed).reason,'global_daily');
      const winner=ids[results[0].allowed?0:1],loser=ids[results[0].allowed?1:0];
      assert.equal((await reserve(winner,.006)).allowed,false);
      assert.equal((await budgetCall(winner,'settle',{attempt:1,usageStatus:'provider_reported',estimateUsd:.002})).allowed,true);
      assert.equal((await reserve(loser,.006)).allowed,true);
      assert.equal((await budgetCall(loser,'settle',{attempt:1,usageStatus:'unknown_reserved',estimateUsd:.000001})).occupiedUsd,.006);
      assert.equal((await budgetCall(loser,'settle',{attempt:1,usageStatus:'unknown_reserved',estimateUsd:.000001})).replayed,true);
      await assert.rejects(()=>budgetCall(loser,'settle',{attempt:1,usageStatus:'provider_reported',estimateUsd:0}),/settlement conflict/);
      const totals=await budgetCall(winner,'read',{});assert.equal(totals.totals.find(t=>t.scope==='global'&&t.period==='day').occupiedUsd,.008);
    }finally{await second.end();}
  });
  await check('worker interruption retains a full reservation; live budget reductions cannot reset occupancy',async()=>{
    const interrupted=await budgetRequest();assert.equal((await reserve(interrupted,.001)).allowed,true);
    await applyBudget({kind:'hard',dailyUsd:.008,monthlyUsd:1});
    assert.equal((await reserve(await budgetRequest(),.0001)).reason,'global_daily');
    await applyBudget({kind:'hard',dailyUsd:1,monthlyUsd:.009});
    assert.equal((await reserve(await budgetRequest(),.0001)).reason,'global_monthly');
  });
  await check('provider/model scopes and cross-provider fallback cannot bypass the shared global ledger',async()=>{
    for(const [limits,expected] of [
      [{providerLimits:{deepseek:{dailyUsd:.009,monthlyUsd:1},openai:null}},'provider_daily'],
      [{providerLimits:{deepseek:{dailyUsd:1,monthlyUsd:.009},openai:null}},'provider_monthly'],
      [{modelLimits:{[model.id]:{dailyUsd:.009,monthlyUsd:1}}},'model_daily'],
      [{modelLimits:{[model.id]:{dailyUsd:1,monthlyUsd:.009}}},'model_monthly'],
    ]){
      await applyBudget({kind:'hard',dailyUsd:1,monthlyUsd:1,providerLimits:{deepseek:null,openai:null},modelLimits:{},...limits});
      assert.equal((await reserve(await budgetRequest(),.0001)).reason,expected);
    }
    await applyBudget({kind:'hard',dailyUsd:.009,monthlyUsd:1});
    assert.equal((await reserve(await budgetRequest(),.0001,service,{provider:'openai',modelId:'openai-synthetic'})).reason,'global_daily');
  });
  await check('test spend has a separate mandatory bound even in observe mode; not-sent work releases its reservation exactly once',async()=>{
    await applyBudget({kind:'observe',dailyUsd:.0001,monthlyUsd:.0001,testDailyUsd:.002});
    const createTest=async()=>{await db.setup.query("update private.ai_model_tests set started_at=now()-interval '2 minutes' where actor_id=$1",[OWNER]);const id=await budgetRequest();const revision=(await admin('registry')).models.find(r=>r.id===model.id).revision;assert.equal((await admin('test_start',{requestId:id,modelId:model.id,expectedRevision:revision,kind:'connection',maxUsd:.01,reason:'fixed synthetic budget fixture'})).allowed,true);return id;};
    assert.equal((await reserve(await createTest(),.003,service,{testing:true})).reason,'test_daily');
    const test=await createTest();assert.equal((await reserve(test,.001,service,{testing:true})).allowed,true);
    const amount=(await budgetCall(test,'read',{})).totals.find(t=>t.scope==='tests'&&t.period==='day').occupiedUsd;assert.equal(amount,.001);
    assert.equal((await budgetCall(test,'settle',{attempt:1,usageStatus:'not_sent',estimateUsd:0})).occupiedUsd,0);
    assert.equal((await budgetCall(test,'settle',{attempt:1,usageStatus:'not_sent',estimateUsd:0})).replayed,true);
    assert.equal((await budgetCall(test,'read',{})).totals.find(t=>t.scope==='tests'&&t.period==='day').occupiedUsd,0);
  });
  await check('operational audit wrappers persist mandatory audit and metadata in one RPC; projection failure cannot undo the audit',async()=>{
    const id=randomUUID(),ev=randomUUID();
    await service.query('select public.ai_query_audit_receive_operational($1,$2,$3,$3,$4,$5,$6)',[id,ev,OWNER,'isolated-policy','a'.repeat(64),cipher()]);
    const append=async(kind,metadata)=>{const event=randomUUID();await service.query('select public.ai_query_audit_append_operational($1,$2,$3,$4,$5,$6)',[id,event,kind,'a'.repeat(64),cipher(),metadata]);return event;};
    await append('running',{protocol:'ai-operations/1',kind:'running',type:'lifecycle'});
    await append('accounting',{protocol:'ai-operations/1',kind:'accounting',type:'model_attempt',provider:'deepseek',model:'deepseek-flash',attempt:1,usageStatus:'provider_reported',inputTokens:30,outputTokens:10,durationMs:99999});
    assert.equal((await operations({action:'detail',requestId:id})).request.metadata.durationMs,undefined);
    const bad=await append('accounting',{protocol:'ai-operations/1',kind:'accounting',type:'model_attempt',prompt:'must never project'});
    assert.equal((await db.setup.query('select count(*) n from private.ai_query_audit_events where event_id=$1',[bad])).rows[0].n,'1');
    assert.equal((await db.setup.query('select count(*) n from private.ai_operation_events where event_id=$1',[bad])).rows[0].n,'0');
    await append('response_generated',{protocol:'ai-operations/1',kind:'response_generated',type:'lifecycle',formalResult:true});
    await append('succeeded',{protocol:'ai-operations/1',kind:'succeeded',type:'lifecycle'});
    assert.equal((await operations({action:'detail',requestId:id})).request.state,'completed');
  });
  await check('candidate edits invalidate proof; four bounded protocols and an explicit approval are required',async()=>{
    const candidate={...model,id:'candidate-protocol',verification:'verified',model:'deepseek-v4-pro'};
    const created=await admin('catalog',{definition:candidate,expectedRevision:null,reason:'synthetic candidate'});
    assert.equal(created.result.definition.verification,'unverified');
    assert.equal((await admin('approve',{modelId:candidate.id,expectedRevision:created.result.revision,reason:'cannot approve without proof'})).allowed,false);
    for(const kind of ['connection','structured','tools','stream']){
      await db.setup.query("update private.ai_model_tests set started_at=now()-interval '2 minutes'");
      const requestId=randomUUID();assert.equal((await admin('test_start',{requestId,modelId:candidate.id,expectedRevision:created.result.revision,kind,maxUsd:.001,reason:'fixed synthetic test'})).allowed,true);
      assert.equal((await admin('test_finish',{requestId,state:'passed',summary:{scope:'synthetic_protocol_only'}})).allowed,true);
    }
    const approved=await admin('approve',{modelId:candidate.id,expectedRevision:created.result.revision,reason:'explicit approval after protocol verification'});
    assert.equal(approved.result.definition.verification,'verified');
    const changed=await admin('catalog',{definition:{...approved.result.definition,inputRate:.5},expectedRevision:approved.result.revision,reason:'changed rates require new proof'});
    assert.equal(changed.result.definition.verification,'unverified');
    assert.equal((await admin('approve',{modelId:candidate.id,expectedRevision:changed.result.revision,reason:'old proofs cannot be reused'})).allowed,false);
    assert.equal((await admin('catalog',{definition:candidate,expectedRevision:null,reason:'stale creator'})).conflict,true);
    const events=(await db.setup.query("select actor_id,session_id,action from private.ai_management_events where after_state->>'id'=$1",[candidate.id])).rows;
    assert.ok(events.some(e=>e.actor_id===OWNER&&e.session_id===SESSION&&e.action==='approve'));
  });
  await check('grant management preserves domain separation, target revision, actual human audit and denies self escalation',async()=>{
    await db.setup.query("alter table auth.users add column if not exists raw_user_meta_data jsonb default '{}'");
    // Exact grant-table DDL from the real feature migrations; no synthetic permissive replacement.
    for(const [file,table] of [['20261113132136_ai_audit_controlled_export.sql','ai_audit_export_grants'],['20261121131205_ai_lease_research.sql','ai_lease_research_grants'],['20261121142158_ai_business_research.sql','ai_business_research_grants'],['20261121154026_ai_knowledge_retrieval.sql','ai_knowledge_grants']]){
      const source=await readFile(new URL('../../migrations/'+file,import.meta.url),'utf8'),a=source.indexOf('create table private.'+table+' (');
      await db.setup.query(source.slice(a,source.indexOf('\n);',a)+4));
    }
    await db.setup.query('alter table private.ai_audit_read_grants add column revision uuid not null default gen_random_uuid()');
    const policy={valid_until:new Date(Date.now()+3600000).toISOString(),capabilities:['operations:read']};
    assert.equal((await admin('grant',{domain:'management',targetId:OWNER,policy,expectedRevision:null,reason:'self escalation forbidden'})).allowed,false);
    const old=(await admin('grants',{search:ADMIN})).users[0].management;
    const modified=await admin('grant',{domain:'management',targetId:ADMIN,policy,expectedRevision:old.revision,reason:'temporary read-only operator'});
    assert.equal(modified.allowed,true);assert.deepEqual(modified.result.capabilities,['operations:read']);
    assert.equal((await admin('grant',{domain:'management',targetId:ADMIN,policy,expectedRevision:old.revision,reason:'stale edit'})).conflict,true);
    assert.equal((await admin('grant',{domain:'audit_read',targetId:ADMIN,policy:{valid_until:policy.valid_until},expectedRevision:null,reason:'independent audit read approval'})).allowed,true);
    const returned=(await admin('grants',{search:ADMIN})).users[0];assert.ok(returned.audit_read.revision);assert.equal(returned.audit_export,null);assert.equal(returned.knowledge,null);
    const audit=(await db.setup.query("select * from private.ai_management_events where action='grant' order by id desc limit 1")).rows[0];
    assert.equal(audit.actor_id,OWNER);assert.equal(audit.session_id,SESSION);assert.equal(audit.after_state.user_id,ADMIN);assert.equal(audit.reason,'independent audit read approval');
  });
  await check('all fixed qualification domains retain independent revisions and reject self changes',async()=>{
    const base={enabled:true,valid_until:new Date(Date.now()+3600000).toISOString()},scope={all_submarkets:false,submarkets:['CBD'],all_buildings:false,building_ids:[]};
    const policies={query:{...base,...scope,capabilities:['query:catalog'],fields:['height']},audit_export:base,lease:{...base,...scope,sources:['live'],allow_details:false,allow_financials:false,allow_export:false,min_group_size:3},business:{...base,...scope,modules:['profile','stacking'],profile_fields:['height'],allow_submissions:false,allow_export:false},knowledge:{...base,document_ids:[],allow_public_search:false}};
    for(const [domain,policy] of Object.entries(policies)){
      const before=(await admin('grants',{search:ADMIN})).users[0][domain];
      assert.equal((await admin('grant',{domain,targetId:OWNER,policy,expectedRevision:null,reason:'self change must fail'})).allowed,false);
      const value=await admin('grant',{domain,targetId:ADMIN,policy,expectedRevision:before?.revision??null,reason:'synthetic fixed-domain grant '+domain});assert.equal(value.allowed,true);assert.equal(value.result.enabled,true);
      assert.equal((await admin('grant',{domain,targetId:ADMIN,policy,expectedRevision:before?.revision??null,reason:'stale same domain'})).conflict,true);
      assert.equal((await admin('grants',{search:ADMIN})).users[0].management.capabilities[0],'operations:read');
    }
    await db.setup.query('update private.ai_management_grants set capabilities=$1 where user_id=$2',[['operations:read'],OWNER]);
    assert.equal((await admin('grant',{domain:'knowledge',targetId:ADMIN,policy:policies.knowledge,reason:'no manager qualification'})).allowed,false);
    await db.setup.query('update private.ai_management_grants set capabilities=$1 where user_id=$2',[caps,OWNER]);
  });
  await check('registered offline evaluation summaries persist separately and require an independent read/test qualification',async()=>{
    const summary={suiteVersion:'ai6-control-1',scope:'synthetic_offline_only',paidCalls:0,actualBilledUsd:null,durationMs:1,results:[{name:'fixed synthetic fixture',state:'offline_passed',scope:'production_router'}]};
    const saved=await admin('evaluation_save',{summary,configurationVersion:(await read()).state.version});assert.equal(saved.run.actor_id,OWNER);assert.equal(saved.run.session_id,SESSION);
    assert.deepEqual((await admin('evaluations')).runs[0].summary,summary);
    await db.setup.query('update private.ai_management_grants set capabilities=$1 where user_id=$2',[['budgets:write'],OWNER]);assert.equal((await admin('evaluations')).allowed,false);
    await db.setup.query('update private.ai_management_grants set capabilities=$1 where user_id=$2',[caps,OWNER]);
  });
  await check('alerts use minimum samples, deduplicate concurrent refreshes, keep acknowledgement and recover with real later evidence',async()=>{
    const rule={id:'synthetic-error-threshold',metric:'failure_rate',enabled:true,threshold:1,minimumSamples:10000,windowMinutes:60,cooldownMinutes:1};
    const saved=await admin('alert_rule',{rule,expectedRevision:null,reason:'synthetic alert configuration'});assert.equal(saved.allowed,true);
    assert.equal((await admin('diagnostics')).alerts.length,0);
    const updated=await admin('alert_rule',{rule:{...rule,minimumSamples:1},expectedRevision:saved.result.revision,reason:'synthetic lower sample bound'});
    assert.equal(updated.allowed,true);const first=await admin('diagnostics');assert.equal(first.alerts.length,1);
    await Promise.all([admin('diagnostics'),admin('diagnostics')]);assert.equal((await admin('diagnostics')).alerts.length,1);
    const alert=first.alerts[0];assert.equal((await admin('alert_action',{alertId:alert.id,state:'silenced',until:new Date(Date.now()+3600000).toISOString(),reason:'one-hour maintenance'})).allowed,true);
    assert.equal((await admin('diagnostics')).alerts[0].state,'silenced');
    await db.setup.query("update private.ai_alerts set last_at=now()-interval '2 minutes',silenced_until=now()-interval '1 minute'");
    await admin('alert_rule',{rule:{...rule,minimumSamples:1,threshold:100},expectedRevision:updated.result.revision,reason:'synthetic recovery evidence threshold'});
    assert.equal((await admin('diagnostics')).alerts[0].state,'recovered');
  });
  await check('background alerts run without a management read and are coalesced across instances',async()=>{
    await db.setup.query("update private.ai_alert_rules set definition=jsonb_set(definition,'{threshold}','1')");await db.setup.query("update private.ai_alerts set last_at=now()-interval '2 minutes'");await db.setup.query("update private.ai_alert_clock set last_at='epoch'");
    const tick=(client=service)=>client.query('select public.ai_control_alert_tick() r');
    const peers=[new pg.Client(connection),new pg.Client(connection)];
    try {
      await Promise.all(peers.map(async client=>{await client.connect();await client.query('set role service_role');}));
      const outcomes=await Promise.all([tick(),...peers.map(client=>tick(client))]);
      assert.equal(outcomes.filter(r=>r.rows[0].r.evaluated).length,1);
    }finally{await Promise.all(peers.map(client=>client.end()));}
    assert.ok((await db.setup.query("select state from private.ai_alerts")).rows.some(r=>['new','ongoing'].includes(r.state)));
    assert.equal((await tick()).rows[0].r.evaluated,false);await assert.rejects(()=>db.asUser(OWNER,'select public.ai_control_alert_tick()'),/permission denied/);
  });
  await check('emergency pause and current query revocation stop subsequent atomic admissions',async()=>{
    const state=(await read()).state;
    await manage('emergency',{expectedRevision:state.revision,paused:true,disabledProviders:[],disabledModels:[],reason:'synthetic stop after first attempt'});
    assert.equal((await reserve(await budgetRequest(),.0001)).allowed,false);
    const next=(await read()).state;
    await manage('emergency',{expectedRevision:next.revision,paused:false,disabledProviders:[],disabledModels:[],reason:'synthetic restore'});
    await db.setup.query('update private.ai_query_grants set enabled=false where user_id=$1',[OWNER]);
    assert.equal((await reserve(await budgetRequest(),.0001)).allowed,false);
    await db.setup.query('update private.ai_query_control set enabled=false');
  });
  await check('management API admission is atomic and bounded across instances, without charging final authorization rechecks',async()=>{
    await db.setup.query('delete from private.ai_management_windows where actor_id=$1',[OWNER]);
    for(let i=0;i<60;i++)assert.equal((await manage('read',{admit:true})).allowed,true);
    assert.equal((await manage('read',{admit:true})).reason,'rate_limit');
    assert.equal((await read()).allowed,true);
  });
  await check('request recovery metrics distinguish legal prepared results from suppressed delivery',async()=>{
    const ok=await synthetic([]),denied=await synthetic([]);
    for(const [item,state,completed] of [[ok,'completed',true],[denied,'denied',false]])await db.setup.query("update private.ai_operation_requests set state=$2,metadata=metadata||jsonb_build_object('recoveryRequested',true,'recoveryCompleted',$3::boolean) where request_id=$1",[item.requestId,state,completed]);
    const result=await operations({action:'overview',...window});assert.equal(result.efficiency.recoveryRequests,2);assert.equal(result.efficiency.recoveryCompleted,1);assert.equal(result.efficiency.legalRecoveryRate,50);
  });
  await check('a failed management audit rolls back emergency state instead of falsely reporting success',async()=>{
    const before=(await read()).state;
    await db.setup.query("create function private.synthetic_management_audit_failure() returns trigger language plpgsql as $$begin raise exception 'synthetic management audit unavailable';end$$;create trigger synthetic_management_audit_failure before insert on private.ai_management_events for each row execute function private.synthetic_management_audit_failure()");
    try{await assert.rejects(()=>manage('emergency',{expectedRevision:before.revision,paused:!before.paused,disabledProviders:[],disabledModels:[],reason:'audit failure rollback'}),/synthetic management audit unavailable/);assert.deepEqual((await read()).state,before);}
    finally{await db.setup.query('drop trigger synthetic_management_audit_failure on private.ai_management_events;drop function private.synthetic_management_audit_failure()');}
  });
  await check('operational projection adds no extra audit roundtrip and records comparable synthetic PostgreSQL timings',async()=>{
    const requestId=await budgetRequest(),baseline=[],projected=[];
    const metadata={protocol:'ai-operations/1',kind:'accounting',type:'summary',durationMs:1,paidModelCalls:0};
    for(let i=0;i<25;i++){
      let start=performance.now();await service.query('select public.ai_query_audit_append($1,$2,$3,$4,$5)',[requestId,randomUUID(),'accounting','b'.repeat(64),cipher()]);baseline.push(performance.now()-start);
      start=performance.now();await service.query('select public.ai_query_audit_append_operational($1,$2,$3,$4,$5,$6)',[requestId,randomUUID(),'accounting','b'.repeat(64),cipher(),metadata]);projected.push(performance.now()-start);
    }
    const stats=values=>{values.sort((a,b)=>a-b);return {medianMs:values[Math.floor(values.length/2)],p95Ms:values[Math.ceil(values.length*.95)-1]};};
    const plan=(await db.setup.query('explain (analyze,buffers,format json) select event_id,sequence,at,metadata from private.ai_operation_events where request_id=$1 order by sequence limit 512',[requestId])).rows[0]['QUERY PLAN'][0];
    console.log('PERF '+JSON.stringify({scope:'isolated PG17 synthetic audit append; not provider or production latency',samples:25,roundtripsPerAppend:{baseline:1,operational:1},baseline:stats(baseline),operational:stats(projected),detailPlan:plan.Plan,executionMs:plan['Execution Time']}));
  });
  await check('expired/revoked management grants deny actions while service remains disabled',async()=>{
    await db.setup.query("update private.ai_management_grants set valid_until=now()-interval '1 second' where user_id=$1",[OWNER]);
    assert.equal((await read()).allowed,false);
    assert.equal((await db.setup.query('select enabled from private.ai_query_control')).rows[0].enabled,false);
  });
  await check('authenticated and anonymous roles cannot directly invoke control RPCs or read private data',async()=>{
    for(const command of ['select public.ai_control_runtime($1,$2)',"select public.ai_control_manage($1,$2,'read','{}')"])
      await assert.rejects(()=>db.asUser(OWNER,command,[OWNER,SESSION]),/permission denied/);
    await assert.rejects(()=>db.asUser(OWNER,'select * from private.ai_control_versions'),/permission denied/);
  });
  console.log(`PASS ${n} real PostgreSQL 17 control-plane scenarios`);
} finally { await service.end(); await db.close(); }
