import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
export async function verifyAiControlCenter({db,app,check,person}){
 const operator=await person('admin','control-operator'),reader=await person('admin','control-reader'),ordinary=await person('viewer','control-viewer');
 const caps=['operations:read','models:write','budgets:write','tests:run','emergency:write','grants:write'];
 const call=async(who,input,headers={})=>{const res=await fetch(app+'/api/intelligence/management',{method:'POST',headers:{'Content-Type':'application/json',...(who?{Authorization:'Bearer '+who.token}:{}),...headers},body:JSON.stringify(input)});return {status:res.status,body:await res.json()};};
 try{
  await check('AI Control / 真实 Auth 本人、独立管理资格与模拟身份隔离',async()=>{
   assert.equal((await call(null,{action:'read'})).status,401);assert.equal((await call(ordinary,{action:'read'})).status,403);assert.equal((await call(operator,{action:'read'})).status,403);
   await db.query("insert into private.ai_management_grants(user_id,capabilities,valid_until,reason) values($1,$2,now()+interval '1 day','synthetic HTTP operator'),($3,$4,now()+interval '1 day','synthetic read-only operator')",[operator.id,caps,reader.id,['operations:read']]);
   assert.equal((await call(operator,{action:'read'})).status,200);
   assert.equal((await call(operator,{action:'read'},{'x-colliers-impersonate-user':operator.id})).status,401);
   assert.equal((await call(operator,{action:'read'},{'x-colliers-impersonate-user':reader.id})).status,401);
   const read=await call(reader,{action:'read'});assert.equal(read.status,200);
   assert.equal((await call(reader,{action:'emergency',expectedRevision:read.body.data.state.revision,paused:true,disabledProviders:[],disabledModels:[],reason:'must reject read-only operator'})).status,403);
   assert.equal((await call(reader,{action:'grants',search:''})).status,403);
  });
  await check('AI Control / 全区间运营查询与安全详情不读取审计正文',async()=>{
   const input={from:new Date(Date.now()-3600000).toISOString(),to:new Date().toISOString()};
   const overview=await call(reader,{action:'overview',...input});assert.equal(overview.status,200,JSON.stringify(overview.body));
   assert.ok(overview.body.data.metrics.requests>0);assert.equal(overview.body.data.usage.actualBilledUsd,null);
   const tasks=await call(reader,{action:'tasks',...input,pageSize:1});assert.equal(tasks.status,200);assert.ok(tasks.body.data.items.length<=1);
   if(tasks.body.data.items[0]){const detail=await call(reader,{action:'detail',requestId:tasks.body.data.items[0].request_id});assert.equal(detail.status,200);assert.ok(detail.body.data.events.length);assert.doesNotMatch(JSON.stringify(detail.body.data),/cipher|submittedText|rawRequest|api[_-]?key/i);}
   assert.equal((await call(reader,{action:'overview',from:'2025-01-01T00:00:00Z',to:'2026-01-01T00:00:00Z'})).status,400);
   assert.equal((await call(reader,{action:'detail',requestId:'invalid'})).status,400);
   assert.equal((await db.query('select count(*) n from private.ai_audit_read_grants where user_id=$1',[reader.id])).rows[0].n,'0');
  });
  await check('AI Control / 离线路由评估、受控目录与付费确认边界',async()=>{
   const result=await call(operator,{action:'evaluate'});assert.equal(result.status,200);assert.equal(result.body.data.run.summary.paidCalls,0);assert.ok(result.body.data.run.summary.results.every(r=>r.state==='offline_passed'));
   assert.equal((await call(operator,{action:'registry'})).status,200);
   assert.equal((await call(operator,{action:'test_run',modelId:'unregistered',expectedRevision:randomUUID(),kind:'connection',confirmed:false,maxUsd:.01,reason:'no paid consent'})).status,400);
   assert.equal((await call(operator,{action:'read',actorId:reader.id})).status,400);
  });
  await check('AI Control / 原子紧急控制、旧修订冲突及真实操作审计',async()=>{
   const before=(await call(operator,{action:'read'})).body.data;
   const paused=await call(operator,{action:'emergency',expectedRevision:before.state.revision,paused:true,disabledProviders:[],disabledModels:[],reason:'synthetic HTTP pause'});assert.equal(paused.status,200);
   assert.equal((await call(operator,{action:'emergency',expectedRevision:before.state.revision,paused:false,disabledProviders:[],disabledModels:[],reason:'stale conflicting restore'})).status,409);
   const audit=(await db.query("select * from private.ai_management_events where action='emergency' and actor_id=$1 order by id desc limit 1",[operator.id])).rows[0];assert.equal(audit.session_id,operator.sessionId);assert.equal(audit.reason,'synthetic HTTP pause');
   const current=(await call(operator,{action:'read'})).body.data;
   assert.equal((await call(operator,{action:'emergency',expectedRevision:current.state.revision,paused:before.state.paused,disabledProviders:before.state.disabled_providers,disabledModels:before.state.disabled_models,reason:'restore synthetic HTTP control'})).status,200);
  });
  await check('AI Control / 实时撤权、降级和注销拒绝',async()=>{
   await db.query('delete from private.ai_management_grants where user_id=$1',[reader.id]);assert.equal((await call(reader,{action:'read'})).status,403);
   await db.query("update public.user_roles set role='viewer' where user_id=$1",[operator.id]);assert.equal((await call(operator,{action:'read'})).status,403);
   await db.query("update public.user_roles set role='admin' where user_id=$1",[operator.id]);assert.equal((await call(operator,{action:'read'})).status,200);
   await operator.client.auth.signOut();assert.ok([401,403].includes((await call(operator,{action:'read'})).status));
  });
 }finally{await db.query('delete from private.ai_management_grants where user_id=any($1::uuid[])',[[operator.id,reader.id]]);}
}
