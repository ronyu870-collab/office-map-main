import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import * as XLSX from 'xlsx';
import JSZip from 'jszip';
export async function verifyLeaseQueryEntry({db,service,check,person,who,grant,fields,live,hist,market,call,recover,artifact,acknowledge,capabilities}){
 const caps=['query:leases','export:internal'];
 const give=(extra={})=>grant({capabilities:caps,...extra});
 const scope={inventory:'leases',sources:['live','history'],fields,submarkets:[market]};
 const ask=(view='summary',period=null,override={},actor=who)=>call(actor,{idempotencyKey:randomUUID(),question:'合成成交完整链路',plan:{operation:'lease_observation',view,period,scope:{...scope,...override}}});
 let original;
 await give();
 await check('三类查询资格同时具备时主页示例不超协议上限，存量/未来/成交各有入口',async()=>{
  await db.query("update private.ai_query_grants set capabilities=array['query:catalog','query:brochure','query:quarter','query:submission-progress','query:submission-quality','query:future-catalog','query:future-progress','query:future-quality','query:leases','export:internal'],fields=array['height','floors','parking','totalArea','vacantArea','netEffectiveRent'],all_buildings=true,all_future_supplies=true where user_id=$1",[who.id]);
  try{
   const result=await capabilities(who);assert.equal(result.status,200);assert.equal(result.body.enabled,true);assert.equal(result.body.examples.length,20);
   for(const example of ['CBD有哪些楼','CBD未来供应有哪些','CBD日常成交明细','CBD历史成交有效租金'])assert.ok(result.body.examples.includes(example));
  }finally{await give();await db.query('update private.ai_query_grants set all_future_supplies=false where user_id=$1',[who.id]);}
 });
 await check('成交专用admin通过真实HTTP查四种结果，独立入口资格不借存量或未来范围',async()=>{
  const c=await capabilities(who);assert.equal(c.status,200);assert.ok(c.body.examples.length>=6);assert.ok(c.body.examples.every(s=>s.includes('成交')));
  for(const view of ['catalog','summary','face_rent','effective_rent']){const r=await ask(view);assert.equal(r.status,200,view+JSON.stringify(r.body));assert.equal(r.body.result.operation,'lease_observation');}
  const q=await call(who,{idempotencyKey:randomUUID(),question:'企业「同名合成企业」全部来源成交明细'});assert.equal(q.status,200);assert.equal(q.body.result.table.rows.length,6);
  assert.equal((await call(who,{idempotencyKey:randomUUID(),question:'CBD有哪些楼'})).status,403);
  assert.equal((await call(who,{idempotencyKey:randomUUID(),question:'CBD未来供应有哪些'})).status,403);
  const unknown=await call(who,{idempotencyKey:randomUUID(),question:'CBD日常成交租金'});assert.equal(unknown.status,422);
  original=await ask('summary',{year:2026,quarter:3});assert.equal(original.status,200);
  assert.deepEqual(original.body.result.parameters.coverage,{candidates:6,selected:4,possible:1,outside:0,unknown:1,invalid:0,conflict:0});
  assert.deepEqual(original.body.result.table.rows.map(r=>r.cells.area.value.numeric),[400,200]);
  assert.equal((await acknowledge(who,original)).status,200);
 });
 await check('成交本人恢复、表格柱图与CSV/XLSX/SVG下载同源；数据库后改不覆盖旧快照',async()=>{
  const id=original.body.requestId,result=original.body.result,common={requestId:id,resultId:result.resultId};
  assert.deepEqual((await recover(who,id)).body.result,result);
  const chart=await artifact(who,{...common,action:'chart',chart:{kind:'bar',field:'area'}});assert.equal(chart.status,200);assert.deepEqual(chart.body.chart.points.map(p=>p.y),[400,200]);
  const excel=await artifact(who,{...common,action:'export',format:'xlsx'});assert.equal(excel.status,200);
  const book=XLSX.read(excel.bytes,{type:'array'});assert.ok(book.SheetNames.includes('查询说明'));assert.deepEqual(XLSX.utils.sheet_to_json(book.Sheets['数据'],{header:1}).slice(1).map(r=>r.at(-1)),[400,200]);
  for(const format of ['csv_zip','svg_zip']){const file=await artifact(who,{...common,action:'export',format,...(format==='svg_zip'?{chart:{kind:'bar',field:'area'}}:{})});assert.equal(file.status,200);const zip=await JSZip.loadAsync(file.bytes),manifest=JSON.parse(await zip.file('manifest.json').async('string'));assert.equal(manifest.resultId,result.resultId);assert.deepEqual(manifest.sources,result.sources);if(format==='svg_zip')assert.deepEqual(manifest.chart,chart.body.chart);}
  await db.query('update public.lease_transactions set area_sqm=9999 where id=$1',[live[0]]);
  try{assert.deepEqual((await recover(who,id)).body.result,result);assert.deepEqual((await artifact(who,{...common,action:'chart',chart:{kind:'bar',field:'area'}})).body.chart,chart.body.chart);}finally{await db.query('update public.lease_transactions set area_sqm=100 where id=$1',[live[0]]);}
 });
 await check('成交查询/恢复/作图/下载拒绝普通角色、模拟本人、另一admin及独立导出撤权',async()=>{
  const common={requestId:original.body.requestId,resultId:original.body.result.resultId};
  for(const role of ['viewer','editor']){await db.query('update public.user_roles set role=$1 where user_id=$2',[role,who.id]);try{assert.equal((await ask()).status,403);assert.equal((await recover(who,common.requestId)).status,403);assert.equal((await artifact(who,{...common,action:'chart',chart:{kind:'bar',field:'area'}})).status,403);}finally{await db.query("update public.user_roles set role='admin' where user_id=$1",[who.id]);}}
  assert.equal((await call(who,{idempotencyKey:randomUUID(),question:'CBD日常成交明细'},{'X-Colliers-Impersonate-User':who.id})).status,403);
  const other=await person('admin','lease-cross-account');
  await db.query('insert into private.ai_query_grants select (jsonb_populate_record(null::private.ai_query_grants,to_jsonb(g)||jsonb_build_object(\'user_id\',$2::text))).* from private.ai_query_grants g where user_id=$1',[who.id,other.id]);
  assert.equal((await recover(other,common.requestId)).status,403);
  await give({capabilities:['query:leases']});
  try{assert.equal((await artifact(who,{...common,action:'export',format:'xlsx'})).status,403);assert.equal((await recover(who,common.requestId)).status,200);}finally{await give();}
 });
 await check('成交来源包括未入选候选；移出范围/改期/撤字段后旧结果与导出拒绝',async()=>{
  const common={requestId:original.body.requestId,resultId:original.body.result.resultId};
  await give({allSubmarkets:false,submarkets:[market]});
  await db.query('update public.lease_transactions_history set sub_market=$2 where id=$1',[hist[2],'不可见区域']);
  try{assert.equal((await recover(who,common.requestId)).status,403);assert.equal((await artifact(who,{...common,action:'export',format:'xlsx'})).status,403);}finally{await db.query('update public.lease_transactions_history set sub_market=$2 where id=$1',[hist[2],market]);await give();}
  await db.query("update public.lease_transactions set transaction_quarter='Q4' where id=$1",[live[0]]);
  try{assert.equal((await recover(who,common.requestId)).status,403);}finally{await db.query("update public.lease_transactions set transaction_quarter='Q3' where id=$1",[live[0]]);}
  await give({fields:[]});try{assert.equal((await recover(who,common.requestId)).status,403);assert.equal((await ask('summary')).status,403);}finally{await give();}
  assert.deepEqual((await recover(who,common.requestId)).body.result,original.body.result);
 });
 await check('成交来源复查不接受伪造表/字段/记录，客户端不能直调服务端RPC',async()=>{
  const a=await service.rpc('ai_query_lease_authority',{p_actor:who.id,p_effective:who.id,p_session:who.sessionId});assert.equal(a.error,null);
  const refs=original.body.result.sources.map(s=>({entity_id:s.entityId,record_id:s.recordId,source_table:s.table,field:s.field,year:s.period?.year??null,quarter:s.period?.quarter??null}));
  const args={p_actor:who.id,p_effective:who.id,p_session:who.sessionId,p_request_id:original.body.requestId,p_permission_revision:a.data.permission_revision,p_sources:refs};
  assert.equal((await service.rpc('ai_query_lease_sources_allowed',args)).data.allowed,true);
  for(const override of [{field:'agency_person'},{source_table:'user_roles'},{record_id:randomUUID()},{entity_id:'live:'+randomUUID()}]){const r=await service.rpc('ai_query_lease_sources_allowed',{...args,p_sources:[{...refs[0],...override}]});assert.equal(r.error,null);assert.equal(r.data.allowed,false);}
  assert.equal((await who.client.rpc('ai_query_lease_sources_allowed',args)).error?.code,'42501');
  const missingAudit=await service.rpc('ai_query_lease_sources_allowed',{...args,p_request_id:randomUUID()});assert.equal(missingAudit.data.allowed,false);
 });
 await check('成交首次响应前撤回来源，最终交付门禁阻止答案并保留未交付修正',async()=>{
  await give({allSubmarkets:false,submarkets:[market]});
  await db.query(`create function private.withdraw_lease_before_delivery() returns trigger language plpgsql set search_path='' as $$ begin
    if new.kind='delivery_receipt' and exists(select 1 from private.ai_query_audit_streams s where s.request_id=new.request_id and s.actor_id='${who.id}') then
      update public.lease_transactions set sub_market='不可见区域' where id='${live[0]}';end if;return new;end $$;
    create trigger withdraw_lease_before_delivery after insert on private.ai_query_audit_events for each row execute function private.withdraw_lease_before_delivery()`);
  try{const r=await ask();assert.equal(r.status,403);assert.equal(r.body.result,undefined);}finally{await db.query('drop trigger withdraw_lease_before_delivery on private.ai_query_audit_events;drop function private.withdraw_lease_before_delivery()');await db.query('update public.lease_transactions set sub_market=$2 where id=$1',[live[0],market]);await give();}
 });
}
