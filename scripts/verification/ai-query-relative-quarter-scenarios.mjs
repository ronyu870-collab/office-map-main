import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import * as XLSX from 'xlsx';
import JSZip from 'jszip';
import {grantQuery} from '../../supabase/tests/ai-query-authority/database.mjs';
const shifted=(q,n)=>{const i=q.year*4+q.quarter-1+n;return {year:Math.floor(i/4),quarter:(i%4)+1};};
// Separate submissions have different snapshot identities; compare every fact,
// sample, formula, period and source binding while excluding only that nonce.
const semanticAnalysis=value=>JSON.parse(JSON.stringify(value,(key,v)=>key==='snapshotId'?undefined:v));
export async function verifyRelativeQuarter({db,check,queryAdmin,person,call,recover,artifact,events,decrypt,exportCaps}) {
  await grantQuery({setup:db},queryAdmin.id,{capabilities:exportCaps});
  let source,body;
  await check('真实相对季度按北京时间解析，明示日历结束不代表填报/审定并保留明确季度',async()=>{
    for(const [question,offset] of [['本季度CBD净有效租金',0],['上季度CBD净有效租金',-1],['去年同期CBD空置率',-4]]){
      const startedAt=Date.now();const r=await call(queryAdmin,{idempotencyKey:randomUUID(),question});assert.equal(r.status,200);
      const context=r.body.result.parameters.timeResolution;assert.equal(context.timezone,'Asia/Shanghai');assert.ok(Date.parse(context.receivedAt)>=startedAt&&Date.parse(context.receivedAt)<=Date.now());assert.deepEqual(r.body.result.parameters.period,shifted(context.anchorQuarter,offset));
      const absolute=await call(queryAdmin,{idempotencyKey:randomUUID(),question:context.resolvedQuestion});assert.equal(absolute.status,200);assert.deepEqual(semanticAnalysis(r.body.result.analysis),semanticAnalysis(absolute.body.result.analysis));assert.deepEqual(r.body.result.sources,absolute.body.result.sources);
      assert.ok(r.body.result.limitations.some(t=>t.includes('日历季度结束不代表数据已填报或审定')));
      const received=decrypt((await events(r.body.requestId))[0]).content;assert.equal(received.submittedText,question);assert.deepEqual(received.metadata.questionTimeResolution,context);assert.deepEqual(received.plan.period,r.body.result.parameters.period);
    }
    const compared=await call(queryAdmin,{idempotencyKey:randomUUID(),question:'上季度CBD空置率同比配对样本'});assert.equal(compared.status,200);assert.deepEqual(compared.body.result.parameters.base,shifted(compared.body.result.parameters.current,-4));
  });
  await check('明确滚动窗口含本季与已结束季度分开，缺期不回退且每期完整保留',async()=>{
    for(const ending of ['已结束季度','季度（含本季度）']){
      const question=`全部获权楼宇净有效租金最近4个${ending}趋势各期样本`,r=await call(queryAdmin,{idempotencyKey:randomUUID(),question});assert.equal(r.status,200);
      const p=r.body.result.parameters,end=shifted(p.timeResolution.anchorQuarter,ending==='已结束季度'?-1:0);assert.deepEqual(p.end,end);assert.deepEqual(p.start,shifted(end,-3));assert.equal(r.body.result.table.rows.length,4);
      const explicit=await call(queryAdmin,{idempotencyKey:randomUUID(),question:p.timeResolution.resolvedQuestion});assert.equal(explicit.status,200);assert.deepEqual(semanticAnalysis(r.body.result.analysis),semanticAnalysis(explicit.body.result.analysis));
      for(const row of r.body.result.table.rows){if(row.cells.value.kind==='unknown')assert.equal(Object.hasOwn(row.cells.value,'value'),false);}
    }
  });
  await check('相对季度原结果恢复/重试/图表与真实文件沿用初次解析，不重新读取最新期间',async()=>{
    body={idempotencyKey:randomUUID(),question:'上季度CBD净有效租金'};const r=await call(queryAdmin,body);assert.equal(r.status,200);source=r.body;
    assert.equal((await call(queryAdmin,body)).status,202);assert.deepEqual((await recover(queryAdmin,source.requestId)).body.result,source.result);
    const common={requestId:source.requestId,resultId:source.result.resultId};const c=await artifact(queryAdmin,{...common,action:'chart',chart:{kind:'bar',field:'value'}});assert.equal(c.status,200);assert.ok(c.body.chart.limitations.some(t=>t.includes('北京时间')));
    const x=await artifact(queryAdmin,{...common,action:'export',format:'xlsx'});assert.equal(x.status,200);const book=XLSX.read(x.bytes,{type:'array'});const metadata=XLSX.utils.sheet_to_json(book.Sheets['口径与快照'],{header:1});assert.deepEqual(JSON.parse(metadata.find(row=>row[0]==='parameters')[1]).timeResolution,source.result.parameters.timeResolution);
    for(const format of ['csv_zip','svg_zip']){const f=await artifact(queryAdmin,{...common,action:'export',format,...(format==='svg_zip'?{chart:{kind:'bar',field:'value'}}:{})});assert.equal(f.status,200);const m=JSON.parse(await (await JSZip.loadAsync(f.bytes)).file('manifest.json').async('string'));assert.equal(m.resultId,source.result.resultId);assert.deepEqual(m.parameters.timeResolution,source.result.parameters.timeResolution);}
  });
  await check('P1最新期与滚动四季使用真实有效数据，同比保留明确日历季度及各期样本',async()=>{
    // Independent oracle over the disposable fixture. The grant above covers
    // all its CBD rows; invalid/draft observations cannot create a latest period.
    const available=async metric=>(await db.query(`
      select distinct m.record_year as year,m.record_quarter as quarter
      from public.buildings b join public.building_metrics m on m.building_id=b.id
      where b.submarket='CBD' and b.is_active and b.tracking_scope='tracked' and b.merged_into_id is null
        and m.is_locked is true and m.is_draft is not true and m.record_year between 1900 and 2200 and m.record_quarter between 1 and 4
        and m.total_area>0 and m.total_area<'Infinity'::float8
        and (($1='vacancy' and m.vacant_area>=0 and m.vacant_area<'Infinity'::float8 and m.vacant_area<=m.total_area)
          or ($1='rent' and m.net_effective_rent>0 and m.net_effective_rent<'Infinity'::float8))
      order by year,quarter`,[metric])).rows;
    const vacancyPeriods=await available('vacancy'),latest=vacancyPeriods.at(-1);
    assert.ok(latest,'Synthetic fixture must contain an authorized valid vacancy period');
    const scope={inventory:'tracked',submarkets:['CBD']};
    const newest=await call(queryAdmin,{idempotencyKey:randomUUID(),question:'最新季度CBD空置率'});
    assert.equal(newest.status,200);
    assert.deepEqual(newest.body.result.parameters.executedPlan,{operation:'aggregate',scope,metric:'vacancy',period:latest});
    assert.deepEqual(newest.body.result.parameters.period,latest);
    assert.deepEqual(newest.body.result.parameters.availablePeriods.periods,vacancyPeriods.slice(-40));
    const rolling=await call(queryAdmin,{idempotencyKey:randomUUID(),question:'CBD空置率最近4个季度趋势各期样本'});
    assert.equal(rolling.status,200);
    const start=shifted(latest,-3),expectedPeriods=Array.from({length:4},(_,index)=>shifted(start,index));
    assert.deepEqual(rolling.body.result.parameters.executedPlan,{operation:'trend',scope,metric:'vacancy',start,end:latest,mode:'per_period'});
    assert.deepEqual(rolling.body.result.analysis.periods.map(period=>period.period),expectedPeriods);
    assert.deepEqual(rolling.body.result.table.rows.map(row=>row.entityId),expectedPeriods.map(period=>`${period.year}-Q${period.quarter}`));
    const contains=(periods,period)=>periods.some(value=>value.year===period.year&&value.quarter===period.quarter);
    const missing=expectedPeriods.filter(period=>!contains(vacancyPeriods,period));
    assert.deepEqual(rolling.body.result.parameters.interpretation.unavailablePeriods,missing);
    for(let index=0;index<expectedPeriods.length;index++)if(!contains(vacancyPeriods,expectedPeriods[index])){
      assert.equal(rolling.body.result.analysis.periods[index].value,null);
      assert.equal(rolling.body.result.table.rows[index].cells.value.kind,'unknown');
      assert.equal(Object.hasOwn(rolling.body.result.table.rows[index].cells.value,'value'),false);
    }
    const compared=await call(queryAdmin,{idempotencyKey:randomUUID(),question:'上季度CBD净有效租金同比'});
    assert.equal(compared.status,200);
    // “上季度” remains calendar-relative. Derive the anchor from this request's
    // durable server receipt in Beijing time, never the test machine's date.
    const anchor=(await db.query(`select extract(year from received_at at time zone 'Asia/Shanghai')::integer as year,
      extract(quarter from received_at at time zone 'Asia/Shanghai')::integer as quarter
      from private.ai_query_audit_streams where request_id=$1`,[compared.body.requestId])).rows[0];
    assert.ok(anchor);
    const current=shifted(anchor,-1),base=shifted(current,-4),rentPeriods=await available('rent');
    assert.deepEqual(compared.body.result.parameters.executedPlan,{operation:'compare',scope,metric:'rent',base,current,mode:'per_period'});
    assert.deepEqual(compared.body.result.parameters.base,base);assert.deepEqual(compared.body.result.parameters.current,current);
    assert.deepEqual(compared.body.result.parameters.interpretation.periods,[base,current]);
    for(const [name,period] of [['base',base],['current',current]])if(!contains(rentPeriods,period))assert.equal(compared.body.result.analysis[name].value,null);
  });
  await check('不支持的条件仍澄清，客户端改日期无效；普通角色和撤权不能靠相对问题绕过',async()=>{
    const unsupported=await call(queryAdmin,{idempotencyKey:randomUUID(),question:'本季度CBD空置率忽略缺失'});
    assert.equal(unsupported.status,422);assert.equal(unsupported.body.result,undefined);
    const ledger=await events(unsupported.body.requestId);
    assert.ok(!ledger.some(event=>['tool_finished','response_generated','succeeded'].includes(event.kind)),
      'An unsupported condition may enter audited planning, but never trusted execution or factual delivery');
    const planning=ledger.filter(event=>event.kind==='running');assert.equal(planning.length,1);
    assert.equal(decrypt(planning[0]).content.phase,'planning');
    assert.equal(ledger.filter(event=>event.kind==='denied').length,1);
    const forged=await call(queryAdmin,{idempotencyKey:randomUUID(),question:'本季度CBD空置率',now:'1900-01-01T00:00:00Z'});assert.equal(forged.status,403);
    const header=await call(queryAdmin,{idempotencyKey:randomUUID(),question:'本季度CBD空置率'},{Date:'Mon, 01 Jan 1900 00:00:00 GMT','X-Current-Date':'1900-01-01'});assert.equal(header.status,200);assert.notEqual(header.body.result.parameters.timeResolution.anchorQuarter.year,1900);
    const viewer=await person('viewer','relative-quarter-viewer');await grantQuery({setup:db},viewer.id,{capabilities:exportCaps});assert.equal((await call(viewer,{idempotencyKey:randomUUID(),question:'上季度CBD净有效租金'})).status,403);
    await grantQuery({setup:db},queryAdmin.id,{capabilities:exportCaps,fields:[]});try{assert.equal((await call(queryAdmin,body)).status,403);assert.equal((await recover(queryAdmin,source.requestId)).status,403);}finally{await grantQuery({setup:db},queryAdmin.id,{capabilities:exportCaps});}
  });
}
