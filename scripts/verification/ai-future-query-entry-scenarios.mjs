import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import * as XLSX from 'xlsx';
import {grantQuery} from '../../supabase/tests/ai-query-authority/database.mjs';
export async function verifyFutureQueryEntry({db,check,queryAdmin,other,grant,ids,call,recover,artifact,acknowledge,capabilities}){
 const caps=['query:future-catalog','query:future-progress','query:future-quality','export:internal'];
 const ask=(question,who=queryAdmin,headers={})=>call(who,{idempotencyKey:randomUUID(),question},headers);
 let source;
 await grant(caps);
 await check('未来专用admin通过真实HTTP提问、来源、本人恢复、图表和Excel，不需要存量权限',async()=>{
  const available=await capabilities(queryAdmin);assert.equal(available.status,200);assert.equal(available.body.enabled,true);
  assert.ok(available.body.examples.length>=4);assert.ok(available.body.examples.every(q=>q.includes('未来供应')));
  source=await ask('当前填报季度CBD未来供应填报进度');assert.equal(source.status,200);assert.equal(source.body.result.operation,'future_observation');
  assert.equal(source.body.result.analysis.catalog.records,5);assert.equal(source.body.result.analysis.progress.assignmentPairs,4);
  assert.ok(source.body.result.sources.every(s=>['future_supplies','future_supply_assignments','future_supply_submissions','app_settings'].includes(s.table)));
  const restored=await recover(queryAdmin,source.body.requestId);assert.equal(restored.status,200);assert.deepEqual(restored.body.result,source.body.result);
  assert.equal((await acknowledge(queryAdmin,source)).status,200);
  const common={requestId:source.body.requestId,resultId:source.body.result.resultId};
  const chart=await artifact(queryAdmin,{...common,action:'chart',chart:{kind:'bar',field:'count'}});assert.equal(chart.status,200);
  const workbook=await artifact(queryAdmin,{...common,action:'export',format:'xlsx'});assert.equal(workbook.status,200);
  const book=XLSX.read(workbook.bytes,{type:'array'});assert.ok(book.SheetNames.includes('未来目录'));assert.ok(book.SheetNames.includes('未来季度记录'));assert.ok(!book.SheetNames.includes('未来填报质量'));
  assert.equal((await ask('CBD有哪些楼')).status,403);
  await grantQuery({setup:db},other.id,{capabilities:caps,allBuildings:false});
  await db.query('update private.ai_query_grants set all_future_supplies=true where user_id=$1',[other.id]);
  assert.equal((await capabilities(other)).body.enabled,true);
  assert.equal((await recover(other,source.body.requestId)).status,403);
 });
 await check('未来11种视图通过HTTP保持真实期间和权限：无配置明确未知、目录不借日历补期',async()=>{
  for(const question of ['CBD未来供应有哪些','CBD未来供应预计时间精度',...['填报进度','填报明细','哪些楼还没填','未分配楼宇','人员填报进度','谁还没填','填报数据质量','填报缺项','填报异常'].map(v=>'2026Q3CBD未来供应'+v)]){
   const result=await ask(question);assert.equal(result.status,200,question);assert.equal(result.body.result.operation,'future_observation');
  }
  await db.query("update public.app_settings set value='未知' where key='current_submission_quarter'");
  try{
   const unknown=await ask('当前填报季度CBD未来供应填报进度');assert.equal(unknown.status,422);assert.equal(unknown.body.status,'clarification');assert.match(unknown.body.message,/不知道/);assert.equal(unknown.body.result,undefined);
   assert.equal((await ask('CBD未来供应有哪些')).status,200);assert.equal((await ask('2026Q3CBD未来供应填报进度')).status,200);
  }finally{await db.query("update public.app_settings set value='3' where key='current_submission_quarter'");}
 });
 await check('未来面积按原区间和核验分类完整分组，精确合计/未知与本人恢复及下载同源',async()=>{
  const original=(await db.query('select id,total_area::text from public.future_supplies where id=any($1::uuid[])',[ids.slice(0,5)])).rows;
  await db.query('update public.future_supplies set total_area=case when id=$1 then 0.1 when id=$2 then 0.2 else null end where id=any($3::uuid[])',[ids[0],ids[1],ids.slice(0,5)]);
  try{
   const area=await ask('CBD未来供应面积汇总');assert.equal(area.status,200);assert.equal(area.body.result.parameters.supply.records,5);
   assert.deepEqual(area.body.result.parameters.supply.knownArea.exact,{numerator:'3',denominator:'10'});assert.equal(area.body.result.parameters.supply.missing,3);
   assert.equal(area.body.result.parameters.supply.groups.flatMap(g=>g.memberIds).length,5);
   const common={requestId:area.body.requestId,resultId:area.body.result.resultId};
   const chart=await artifact(queryAdmin,{...common,action:'chart',chart:{kind:'bar',field:'area'}});assert.equal(chart.status,200);assert.equal(chart.body.chart.points.filter(p=>p.y===null).length,3);
   const workbook=await artifact(queryAdmin,{...common,action:'export',format:'xlsx'});assert.equal(workbook.status,200);const book=XLSX.read(workbook.bytes,{type:'array'});
   assert.ok(book.SheetNames.includes('未来记录面积'));const rows=XLSX.utils.sheet_to_json(book.Sheets['未来记录面积'],{header:1});assert.deepEqual(rows.slice(3).map(r=>r.at(-1)).filter(v=>typeof v==='number').sort(),[0.1,0.2]);
   const schedule=await ask('CBD未来供应预计入市区间');assert.equal(schedule.status,200);
   const half=schedule.body.result.table.rows.find(r=>r.entityId===ids[1]);assert.equal(half.cells.start.value,'2026Q3');assert.equal(half.cells.end.value,'2026Q4');
   const unknown=schedule.body.result.table.rows.find(r=>r.entityId===ids[3]);assert.equal(unknown.cells.start.kind,'unknown');
   await db.query('update public.future_supplies set total_area=99999 where id=$1',[ids[0]]);
   assert.deepEqual((await recover(queryAdmin,area.body.requestId)).body.result,area.body.result);
   await grant(caps,{all:false,ids:[ids[0]]});assert.equal((await recover(queryAdmin,area.body.requestId)).status,403);
   const limited=await ask('CBD未来供应面积汇总');assert.equal(limited.status,200);assert.equal(limited.body.result.parameters.supply.records,1);
   assert.equal(limited.body.result.parameters.supply.knownArea.numeric,99999);
  }finally{for(const row of original)await db.query('update public.future_supplies set total_area=$1 where id=$2',[row.total_area,row.id]);await grant(caps);}
 });
 await check('未来路径只准admin本人：viewer/editor持完整资格和旧JWT仍不能问、恢复、作图、下载或回执',async()=>{
  const common={requestId:source.body.requestId,resultId:source.body.result.resultId};
  for(const role of ['viewer','editor']){
   await db.query('update public.user_roles set role=$1 where user_id=$2',[role,queryAdmin.id]);
   try{
    assert.equal((await capabilities(queryAdmin)).body.enabled,false);
    for(const question of ['CBD未来供应面积汇总','CBD未来供应预计入市区间'])assert.equal((await ask(question)).status,403);
    const denied=await ask('CBD未来供应有哪些');assert.equal(denied.status,403);assert.equal(denied.body.result,undefined);
    assert.equal((await db.query("select count(*)::int n from private.ai_query_audit_events where request_id=$1 and kind='running'",[denied.body.requestId])).rows[0].n,0);
    assert.equal((await recover(queryAdmin,source.body.requestId)).status,403);
    assert.equal((await artifact(queryAdmin,{...common,action:'chart',chart:{kind:'bar',field:'count'}})).status,403);
    assert.equal((await artifact(queryAdmin,{...common,action:'export',format:'xlsx'})).status,403);
    assert.equal((await acknowledge(queryAdmin,source)).status,403);
   }finally{await db.query("update public.user_roles set role='admin' where user_id=$1",[queryAdmin.id]);}
  }
  for(const target of [queryAdmin.id,other.id]){
   const headers={'X-Colliers-Impersonate-User':target};assert.equal((await ask('CBD未来供应有哪些',queryAdmin,headers)).status,403);
   assert.equal((await capabilities(queryAdmin,headers)).body.enabled,false);assert.equal((await recover(queryAdmin,source.body.requestId,'recover',headers)).status,403);
  }
 });
 await check('未来恢复按原计划与来源复查；撤销导出、数据范围或未来进度权立即阻断旧结果',async()=>{
  const common={requestId:source.body.requestId,resultId:source.body.result.resultId};
  await grant(caps.filter(c=>c!=='export:internal'));assert.equal((await recover(queryAdmin,source.body.requestId)).status,200);assert.equal((await artifact(queryAdmin,{...common,action:'export',format:'xlsx'})).status,403);
  await grant(['query:future-catalog']);assert.equal((await recover(queryAdmin,source.body.requestId)).status,403);assert.equal((await ask('2026Q3CBD未来供应填报数据质量')).status,403);
  const options=await capabilities(queryAdmin);assert.equal(options.body.examples.length,2);assert.ok(options.body.examples.every(q=>!q.includes('填报')));
  await grant(caps,{all:false,ids:[ids[0]]});assert.equal((await recover(queryAdmin,source.body.requestId)).status,403);
  const limited=await ask('CBD未来供应有哪些');assert.equal(limited.status,200);assert.equal(limited.body.result.analysis.catalog.records,1);
  await grant(caps);await db.query('update public.future_supplies set is_entered_market=true where id=$1',[ids[0]]);
  try{assert.equal((await recover(queryAdmin,source.body.requestId)).status,403);}finally{await db.query('update public.future_supplies set is_entered_market=false where id=$1',[ids[0]]);}
 });
 await grant();
}
