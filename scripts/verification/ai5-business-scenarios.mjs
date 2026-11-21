// Synthetic records only. Real Auth, PostgREST, encrypted audit, production-built recovery/file/map HTTP.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { once } from 'node:events';
import * as XLSX from 'xlsx';
import { loadAgentHandler } from './ai5-export-scenarios.mjs';
import { grantQuery } from '../../supabase/tests/ai-query-authority/database.mjs';
import { grantBusiness, seedBusiness } from '../../supabase/tests/ai-business-research/fixture.mjs';
export async function verifyAi5Business({db,app,service,keys,output,check,person,artifact,recover,events,decrypt,exportCaps,buildingIds}) {
 const handle=await loadAgentHandler(output);let scenario;
 let who=await person('admin','ai5-business');
 const other=await person('admin','ai5-business-other');
 await grantQuery({setup:db},other.id,{capabilities:exportCaps,fields:['height','floors','parking','totalArea','netEffectiveRent','vacantArea']});
 await grantBusiness(db,other.id);
 const seeded=await seedBusiness(db,buildingIds,who.id);
 const plan={buildingIds:[buildingIds[0]],fields:['district','address','completionYear','completionDate','leasableArea','gfaTotal','floors','parking','availablePeriods']};
 const tool=(name,args)=>({id:randomUUID(),type:'function',function:{name,arguments:JSON.stringify(args)}});
 const complete=calls=>({model:'synthetic-business-planner',inputTokens:20,outputTokens:20,message:{role:'assistant',content:calls?null:'资料已准备，请查看来源和限制。',...(calls?{tool_calls:calls}:{})}});
 const server=createServer(async(req,res)=>{try{
  const chunks=[];for await(const c of req)chunks.push(c);
  const response=await handle(new Request('http://127.0.0.1'+req.url,{method:req.method,headers:req.headers,body:Buffer.concat(chunks)}),{client:service,keys,enabled:true,invokeModel:async messages=>{
   const content=JSON.stringify(messages);
   for(const secret of ['合成租户_不得传播','合成保密备注','tenant_name','lease_steps','evidence_storage_path'])assert.equal(content.includes(secret),false);
   const step=scenario.round++;
   if(step===0)return scenario.textOnly?complete():complete([tool(scenario.name,scenario.args)]);
   const observations=messages.filter(m=>m.role==='tool').map(m=>JSON.parse(m.content));
   const resultId=observations.find(o=>o.resultId)?.resultId;
   if(step===1){
    if(scenario.name==='query_stacking_plan'){assert.equal(JSON.stringify(observations[0]).includes('1001'),false);assert.equal(JSON.stringify(observations[0]).includes('600'),false);}
    await scenario.beforeFollowup?.();
    if(scenario.followup)return complete([tool(scenario.followup,{...scenario.followupArgs,...(scenario.followup==='export_table'?{resultIds:[resultId],format:'xlsx'}:scenario.followup==='list_buildings'?{}:{resultId})})]);
   }
   await scenario.beforeAnswer?.();return complete();
  }});
  res.writeHead(response.status,Object.fromEntries(response.headers));res.end(Buffer.from(await response.arrayBuffer()));
 }catch(e){console.error('Synthetic business scenario:',e.message);res.writeHead(500);res.end(JSON.stringify({error:'synthetic scenario failed'}));}});
 server.listen(0,'127.0.0.1');await once(server,'listening');const endpoint='http://127.0.0.1:'+server.address().port;
 const grant=async(options={})=>{await grantQuery({setup:db},who.id,{capabilities:exportCaps,fields:['height','floors','parking','totalArea','netEffectiveRent','vacantArea']});await grantBusiness(db,who.id,options);};
 const next=async label=>{who=await person('admin','ai5-business-'+label);await grant();};
 async function submit(name='query_building_dossier',args=plan,options={},actor=who,conversation={id:randomUUID()}){
  scenario={name,args,round:0,...options};const r=await fetch(endpoint+'/api/intelligence/query/agent',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+actor.token},body:JSON.stringify({idempotencyKey:randomUUID(),question:options.question??'介绍这栋楼的面积、层数和竣工时间，注明来源区别和缺失。',conversation})});
  return {status:r.status,body:await r.json(),actor};
 }
 const download=(r,actor=r.actor)=>artifact(actor,{requestId:r.body.requestId,resultId:r.body.result.resultId,action:'export',format:'xlsx'});
 async function buildings(r,extra={},actor=r.actor){const x=await fetch(app+'/api/intelligence/query/buildings',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+actor.token},body:JSON.stringify({requestId:r.body.requestId,resultId:r.body.result.resultId,action:'buildings',...extra})});return {status:x.status,body:await x.json()};}
 try{
  await grantQuery({setup:db},who.id,{capabilities:exportCaps});
  await check('AI5业务 / 独立默认关闭，现有AI管理员资格不自动开放业务模块',async()=>assert.equal((await submit()).status,403));
  await grant();let dossier,history,exported;
  await check('AI5业务 / 完整楼宇参数区分GFA、可租面积与两种日期，零和缺失保留',async()=>{
   dossier=await submit();assert.equal(dossier.status,200,JSON.stringify(dossier.body));const c=dossier.body.result.table.rows[0].cells;
   assert.equal(c.gfaTotal.value.numeric,12345.67);assert.equal(c.leasableArea.value.numeric,8800);assert.equal(c.completionYear.value,'2015');assert.equal(c.completionDate.value,'2016-03-01');assert.equal(c.floors.value.numeric,36);assert.equal(c.parking.value.numeric,0);
   assert.ok(dossier.body.result.sources.some(s=>s.table==='building_brochure_data'));assert.ok(c.availablePeriods.value.includes('2026Q3'));
   history=await submit('query_building_dossier',plan,{textOnly:true},who,{...dossier.body.conversation,parentRequestId:dossier.body.requestId});assert.equal(history.status,200);assert.ok(history.body.result.parameters.businessBindings.length);
  });
  await check('AI5业务 / 楼书多候选不取最新覆盖，冲突明确未知',async()=>{
   const id=randomUUID();await db.query('insert into public.building_brochure_data(id,building_id,gfa_total) values($1,$2,999)',[id,buildingIds[0]]);
   try{const r=await submit();assert.equal(r.status,200);assert.equal(r.body.result.table.rows[0].cells.gfaTotal.state,'conflict');}finally{await db.query('delete from public.building_brochure_data where id=$1',[id]);}
  });
  await check('AI5业务 / 卡片与地图基于正式ID，单栋定位与多栋只看均保留真实身份',async()=>{
   const context=await buildings(dossier);assert.equal(context.status,200,JSON.stringify(context.body));assert.equal(context.body.buildings[0].id,buildingIds[0]);assert.equal(context.body.buildings[0].located,true);assert.equal(context.body.buildings[0].location_lng,undefined);
   const multi=await submit('query_building_dossier',{...plan,buildingIds:buildingIds.slice(0,3),fields:['submarket']},{followup:'prepare_map_selection',followupArgs:{buildingIds:buildingIds.slice(0,2),intent:'only'},question:'只在地图上查看这些楼宇。'});
   assert.equal(multi.status,200,JSON.stringify(multi.body));assert.deepEqual(multi.body.result.parameters.agentMap.buildingIds,buildingIds.slice(0,2));assert.match(multi.body.message,/尚未/);
   assert.equal((await buildings(multi)).body.total,3);const selected=await buildings(multi,{mapSelection:true});assert.equal(selected.status,200);assert.deepEqual(selected.body.buildings.map(b=>b.id),buildingIds.slice(0,2));
   const focus=await submit('query_building_dossier',plan,{followup:'prepare_map_selection',followupArgs:{intent:'focus'}});assert.equal(focus.status,200);assert.equal((await buildings(focus,{mapSelection:true})).body.total,1);
   assert.equal((await buildings(dossier,{buildingId:buildingIds[1]})).status,403);assert.equal((await buildings(dossier,{},other)).status,403);
  });
  await check('AI5业务 / 子市场仅已发布且通过完整编辑校验的资料，草稿不交付',async()=>{
   await next('submarket');const args={submarkets:['CBD']};const r=await submit('query_submarket_profile',args);assert.equal(r.status,200);assert.equal(r.body.result.table.rows[0].cells.headline.value,'合成区域定位');
   await db.query("update public.map_submarket_profiles set is_published=false where submarket='CBD'");const draft=await submit('query_submarket_profile',args);assert.equal(draft.status,200);assert.equal(draft.body.result.table.rows.length,0);
   await db.query("update public.map_submarket_profiles set is_published=true where submarket='CBD'");
   const noMap=await submit('query_submarket_profile',args,{followup:'prepare_map_selection'});assert.equal(noMap.status,200);assert.match(noMap.body.message,/未准备地图操作/);assert.equal(noMap.body.result.parameters.agentMap,undefined);
  });
  await check('AI5业务 / 未来供应目录、明确季度提交、最新所属季度分离，不带提交人',async()=>{
   for(const [source,expected] of [['catalog',null],['submitted_quarter',48000],['latest_submitted',49000]]){
    const r=await submit('query_future_supply',{submarkets:['CBD'],source,...(source==='submitted_quarter'?{period:{year:2026,quarter:2}}:{})});assert.equal(r.status,200,JSON.stringify(r.body));const c=r.body.result.table.rows[0].cells;assert.equal(c.catalogArea.value.numeric,50000);assert.equal(c.linkedBuilding.value,buildingIds[0]);if(expected!==null)assert.equal(c.submittedArea.value.numeric,expected);assert.equal(JSON.stringify(r.body).includes('合成填报人'),false);
   }
  });
  await check('AI5业务 / 普通角色不能经AI读取Stacking，管理员读真实楼座层单元但不向模型发送明细',async()=>{
   await next('stacking');const args={buildingIds:[buildingIds[0]]};
   for(const role of ['viewer','editor']){const actor=await person(role,'business-'+role);await grantQuery({setup:db},actor.id,{capabilities:exportCaps});await grantBusiness(db,actor.id);assert.equal((await submit('query_stacking_plan',args,{},actor)).status,403);assert.equal((await fetch(app+'/api/stacking-plan/'+buildingIds[0],{headers:{Authorization:'Bearer '+actor.token}})).status,403);}
   const r=await submit('query_stacking_plan',args,{followup:'read_result_page',followupArgs:{offset:0,limit:100}});assert.equal(r.status,200,JSON.stringify(r.body));const c=r.body.result.table.rows[0].cells;assert.equal(c.unit.value,'1001');assert.equal(c.unitArea.value.numeric,600);assert.equal(c.sourceDate.kind,'unknown');assert.equal(c.review.value,'等待资料日期');assert.equal(JSON.stringify(r.body).includes('合成租户'),false);
   const context=await buildings(r);assert.equal(context.status,200);assert.equal(context.body.buildings[0].id,buildingIds[0]);
   const native=await fetch(app+'/api/stacking-plan/'+buildingIds[0],{headers:{Authorization:'Bearer '+who.token}});assert.equal(native.status,200);assert.equal((await native.json()).spaces[0].id,seeded.space);
  });
  await check('AI5业务 / 单独字段与模块资格限制，未获权联系方式不能请求',async()=>{
   await grant({fields:['address'],modules:['profile']});assert.equal((await submit()).status,403);assert.equal((await submit('query_stacking_plan',{buildingIds:[buildingIds[0]]})).status,403);
   const invalid=await submit('query_building_dossier',{buildingIds:[buildingIds[0]],fields:['contact_phone']});assert.equal(invalid.status,200);assert.equal(invalid.body.agent.executionStatus,'limited');assert.ok(invalid.body.agent.unresolvedFailures.some(f=>f.code==='invalid_arguments'));assert.equal(invalid.body.result,undefined);await grant();
  });
  await check('AI5业务 / Excel真实生成下载回读，中文、数值、来源审计保留',async()=>{
   await next('exports');exported=await submit('query_building_dossier',plan,{followup:'export_table',followupArgs:{fields:['name','address','gfaTotal','leasableArea','parking'],singleSheet:true}});assert.equal(exported.status,200,JSON.stringify(exported.body));
   const file=await download(exported);assert.equal(file.status,200,JSON.stringify(file.body));const book=XLSX.read(file.bytes,{type:'array'});assert.equal(book.SheetNames.length,1);const sheet=book.Sheets[book.SheetNames[0]],rows=XLSX.utils.sheet_to_json(sheet,{header:1,range:sheet['!autofilter'].ref});assert.equal(rows.length,2);assert.equal(rows[1][1],'合成路1号');assert.equal(rows[1][2],12345.67);assert.equal(rows[1][3],8800);assert.equal(rows[1][4],0);
   assert.ok((await events(file.headers.get('x-audit-attempt-id'))).map(decrypt).some(e=>e.content?.result?.artifact?.kind==='download'));assert.equal((await download(exported,other)).status,403);
  });
  await check('AI5业务 / 导出资格撤销、业务撤权、历史及跨用户恢复均拒绝',async()=>{
   await db.query('update private.ai_business_research_grants set allow_export=false where user_id=$1',[who.id]);assert.equal((await download(exported)).status,403);
   const queryOnly=await submit();assert.equal(queryOnly.status,200);assert.equal((await download(queryOnly)).status,403);await grant();
   const fresh=await submit();assert.equal(fresh.status,200);await db.query('update private.ai_business_research_grants set enabled=false where user_id=any($1::uuid[])',[[who.id,dossier.actor.id]]);
   assert.equal((await recover(who,fresh.body.requestId)).status,403);assert.equal((await recover(history.actor,history.body.requestId)).status,403);assert.equal((await buildings(dossier)).status,403);assert.equal((await recover(other,dossier.body.requestId)).status,403);
  });
  await check('AI5业务 / 生成后最终回答前撤权不交付文件，真实审计拒绝',async()=>{
   await next('midflight');let changed=false;const r=await submit('query_building_dossier',plan,{followup:'export_table',beforeAnswer:async()=>{if(!changed){changed=true;await db.query('update private.ai_business_research_grants set enabled=false where user_id=$1',[who.id]);}}});assert.equal(r.status,403);assert.equal(r.body.result,undefined);assert.ok((await events(r.body.requestId)).some(e=>e.kind==='denied'));
  });
  await check('AI5业务 / 混合季度与资料任务的最终档案保留业务撤权约束',async()=>{
   await next('mixed');const mixed=await submit('query_building_dossier',plan,{followup:'list_buildings',followupArgs:{scope:{inventory:'all_authorized',buildingIds},fields:[],period:null}});assert.equal(mixed.status,200,JSON.stringify(mixed.body));assert.equal(mixed.body.result.parameters.dataDomain,undefined);assert.ok(mixed.body.result.parameters.businessBindings.length);
   await db.query('update private.ai_business_research_grants set enabled=false where user_id=$1',[who.id]);assert.equal((await recover(who,mixed.body.requestId)).status,403);
  });
  await check('AI5业务 / 来源变化使旧文件失效，客户端不能直调业务RPC或跨会话',async()=>{
   await next('source');const r=await submit('query_building_dossier',plan,{followup:'export_table'});assert.equal(r.status,200);
   await db.query("update public.building_brochure_data set address='合成更新地址' where building_id=$1",[buildingIds[0]]);assert.equal((await download(r)).status,403);
   assert.ok((await who.client.rpc('ai_business_research_snapshot',{p_actor:who.id,p_effective:who.id,p_session:who.sessionId,p_plan:{tool:'query_building_dossier',...plan}})).error);
   const bad=await service.rpc('ai_business_research_snapshot',{p_actor:who.id,p_effective:who.id,p_session:other.sessionId,p_plan:{tool:'query_building_dossier',...plan}});assert.equal(bad.data.allowed,false);
  });
 }finally{server.close();await once(server,'close');await db.query('delete from public.future_supply_submissions where future_supply_id=$1',[seeded.supply]);await db.query('delete from public.future_supplies where id=$1',[seeded.supply]);await db.query('delete from public.stacking_plan_towers where id=$1',[seeded.tower]);await db.query("delete from public.stacking_plan_sources where id='synthetic-business-source'");}
}
