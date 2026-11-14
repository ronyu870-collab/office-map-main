import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import * as XLSX from 'xlsx';
import JSZip from 'jszip';

export async function verifyLeaseAnalytics({db,who,grant,check,call,recover,artifact,acknowledge,capabilities,read}){
 const live=Array.from({length:5},()=>randomUUID()),history=randomUUID(),market='CBD';
 const fields=['area_sqm','industry','sub_industry','demand_type'];
 const give=extra=>grant({capabilities:['query:leases','export:internal'],fields,allSubmarkets:false,submarkets:[market],...extra});
 const ask=question=>call(who,{idempotencyKey:randomUUID(),question});
 const common=r=>({requestId:r.body.requestId,resultId:r.body.result.resultId});
 const trendQuestion='CBD全部来源成交2026Q1至2026Q4趋势';
 let grouped,trend;
 try{
  await give();
  const data=[['Acme','金融','银行','新租',100,2026,'Q1'],['ACME','科技','软件','扩租',300,2026,'Q3'],['Other',null,null,null,null,2026,'Q3'],[null,'金融','银行','续租',0,2026,'Q3'],['Other','科技','软件','新租',50,2026,null]];
  for(let i=0;i<live.length;i++)await db.query('insert into public.lease_transactions(id,new_building,sub_market,company,industry,sub_industry,demand_type,area_sqm,transaction_year,transaction_quarter) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',[live[i],'合成统计楼宇',market,...data[i]]);
  await db.query("insert into public.lease_transactions_history(id,source_uid,new_building,sub_market,company,industry,sub_industry,demand_type,area_sqm,transaction_year,transaction_quarter) values($1,$2,'合成统计历史楼宇','CBD','History','金融','银行','新租',100,2026,'Q3')",[history,'analytics-'+history]);
  await check('成交四类分组保留原分类与缺失，记录数/名称数/已知面积占比分开且逐来源计算',async()=>{
   grouped=await ask('CBD全部来源成交行业占比');assert.equal(grouped.status,200);const r=grouped.body.result;
   const row=value=>r.table.rows.find(x=>x.entityId===JSON.stringify(['live','industry',value]));
   assert.equal(row('金融').cells.count.value.numeric,2);assert.deepEqual(row('金融').cells.areaShare.value.exact,{numerator:'2',denominator:'9'});
   assert.deepEqual(row('科技').cells.areaShare.value.exact,{numerator:'7',denominator:'9'});assert.equal(row(null).cells.areaShare.kind,'unknown');
   assert.equal(r.parameters.leaseAnalytics.sourceTotals.find(s=>s.source==='live').distinctRecordedNames,2);
   assert.equal(row('金融').cells.names.value.numeric+row('科技').cells.names.value.numeric+row(null).cells.names.value.numeric,4);
   for(const question of ['2026Q3CBD日常成交子行业占比','CBD历史成交需求类型占比','CBD全部来源成交子市场占比'])assert.equal((await ask(question)).status,200);
   const chart=await artifact(who,{...common(grouped),action:'chart',chart:{kind:'bar',field:'areaShare'}});assert.equal(chart.status,200);
   assert.ok(chart.body.chart.points.some(p=>p.state==='unknown'));assert.equal((await acknowledge(who,grouped)).status,200);
  });
  await check('成交季度趋势只分配明确季度，保留连续空期与年份候选，折线/Excel/SVG和恢复使用同一快照',async()=>{
   trend=await ask(trendQuestion);assert.equal(trend.status,200);const r=trend.body.result;
   assert.deepEqual(r.parameters.coverage,{candidates:6,selected:5,possible:1,outside:0,unknown:0,invalid:0,conflict:0});
   const chart=await artifact(who,{...common(trend),action:'chart',chart:{kind:'lease_time_series',field:'area'}});assert.equal(chart.status,200);
   assert.deepEqual(chart.body.chart.facets.map(f=>f.points.map(p=>p.y)),[[100,null,300,null],[null,null,100,null]]);assert.equal(chart.body.chart.connectNulls,false);
   for(const field of ['count','names'])assert.equal((await artifact(who,{...common(trend),action:'chart',chart:{kind:'lease_time_series',field}})).status,200);
   const excel=await artifact(who,{...common(trend),action:'export',format:'xlsx'});assert.equal(excel.status,200);
   const book=XLSX.read(excel.bytes,{type:'array'});assert.deepEqual(XLSX.utils.sheet_to_json(book.Sheets['数据'],{header:1}).slice(1).map(row=>row[1+r.table.columns.findIndex(c=>c.key==='area')]),[100,'未记录',300,'未记录','未记录','未记录',100,'未记录']);
   const svg=await artifact(who,{...common(trend),action:'export',format:'svg_zip',chart:{kind:'lease_time_series',field:'area'}});assert.equal(svg.status,200);
   const zip=await JSZip.loadAsync(svg.bytes),manifest=JSON.parse(await zip.file('manifest.json').async('string'));assert.deepEqual(manifest.chart,chart.body.chart);assert.equal(manifest.resultId,r.resultId);
   await db.query('update public.lease_transactions set area_sqm=9999 where id=$1',[live[0]]);
   try{assert.deepEqual((await recover(who,trend.body.requestId)).body.result,r);}finally{await db.query('update public.lease_transactions set area_sqm=100 where id=$1',[live[0]]);}
  });
  await check('成交分组与趋势拒绝越字段/来源及普通身份，记录范围先过滤分母且不泄漏其他候选数量',async()=>{
   await give({fields:['area_sqm']});
   try{assert.equal((await ask('CBD日常成交行业占比')).status,403);assert.equal((await recover(who,grouped.body.requestId)).status,403);assert.equal((await recover(who,trend.body.requestId)).status,200);assert.ok(!(await capabilities(who)).body.examples.some(q=>q.includes('行业')));}finally{await give();}
   await give({sources:['live'],all:false,ids:live.slice(0,2).map(id=>'live:'+id)});
   try{assert.equal((await ask('CBD历史成交行业占比')).status,403);const scoped=await ask('CBD日常成交行业占比');assert.equal(scoped.status,200);assert.equal(scoped.body.result.parameters.coverage.candidates,2);assert.deepEqual(scoped.body.result.table.rows.map(r=>r.cells.areaShare.value.numeric).sort(),[0.25,0.75]);}finally{await give();}
   for(const role of ['viewer','editor']){await db.query('update public.user_roles set role=$1 where user_id=$2',[role,who.id]);try{assert.equal((await ask(trendQuestion)).status,403);assert.equal((await recover(who,grouped.body.requestId)).status,403);assert.equal((await artifact(who,{...common(trend),action:'chart',chart:{kind:'lease_time_series',field:'area'}})).status,403);}finally{await db.query("update public.user_roles set role='admin' where user_id=$1",[who.id]);}}
  });
  await check('成交趋势的年份候选撤回也阻断旧图表/导出，独立导出权仍须有效',async()=>{
   await db.query("update public.lease_transactions set sub_market='未授权市场' where id=$1",[live[4]]);
   try{assert.equal((await recover(who,trend.body.requestId)).status,403);assert.equal((await artifact(who,{...common(trend),action:'export',format:'xlsx'})).status,403);}finally{await db.query('update public.lease_transactions set sub_market=$2 where id=$1',[live[4],market]);}
   await give({capabilities:['query:leases']});try{assert.equal((await artifact(who,{...common(trend),action:'export',format:'xlsx'})).status,403);}finally{await give();}
   assert.equal((await recover(who,trend.body.requestId)).status,200);
  });
  await check('成交读层完整读取1005条；超出同步归档容量时审计失败且不截断交付',async()=>{
   const ids=Array.from({length:1005},()=>randomUUID());
   try{
    await db.query("insert into public.lease_transactions(id,company,new_building,sub_market,industry,area_sqm,transaction_year,transaction_quarter) select x,'批量样本','合成统计批量楼宇','AI统计完整','金融',1,2026,'Q3' from unnest($1::uuid[]) x",[ids]);
    await give({submarkets:['AI统计完整']});const complete=await read({sources:['live'],fields:['area_sqm','industry'],submarkets:['AI统计完整']});assert.equal(complete.records.length,1005);assert.equal(complete.expected,1005);const result=await call(who,{idempotencyKey:randomUUID(),question:'隔离完整行业统计',plan:{operation:'lease_observation',view:'industry',period:null,scope:{inventory:'leases',sources:['live'],fields:['area_sqm','industry'],submarkets:['AI统计完整']}}});
    // Full provenance exceeds the existing 16 MiB synchronous archive. Never lower the count or drop evidence to return a partial success.
    assert.equal(result.status,503);assert.equal(result.body.result,undefined);
    assert.equal((await db.query('select state from private.ai_query_audit_streams where request_id=$1',[result.body.requestId])).rows[0].state,'failed');
    assert.equal((await db.query("select count(*)::int n from private.ai_query_audit_events where request_id=$1 and kind='succeeded'",[result.body.requestId])).rows[0].n,0);
   }finally{await give();await db.query('delete from public.lease_transactions where id=any($1::uuid[])',[ids]);}
  });
 }finally{await db.query('delete from public.lease_transactions where id=any($1::uuid[])',[live]);await db.query('delete from public.lease_transactions_history where id=$1',[history]);await grant();}
}
