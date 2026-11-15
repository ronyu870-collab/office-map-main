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
  await check('含糊期间明确澄清，客户端改日期无效；普通角色和撤权不能靠相对问题绕过',async()=>{
    for(const question of ['最新季度CBD空置率','CBD空置率最近4个季度趋势各期样本','上季度CBD净有效租金同比','本季度CBD空置率忽略缺失']){const r=await call(queryAdmin,{idempotencyKey:randomUUID(),question});assert.equal(r.status,422);assert.deepEqual((await events(r.body.requestId)).filter(e=>e.kind==='response_generated'),[]);}
    const forged=await call(queryAdmin,{idempotencyKey:randomUUID(),question:'本季度CBD空置率',now:'1900-01-01T00:00:00Z'});assert.equal(forged.status,403);
    const header=await call(queryAdmin,{idempotencyKey:randomUUID(),question:'本季度CBD空置率'},{Date:'Mon, 01 Jan 1900 00:00:00 GMT','X-Current-Date':'1900-01-01'});assert.equal(header.status,200);assert.notEqual(header.body.result.parameters.timeResolution.anchorQuarter.year,1900);
    const viewer=await person('viewer','relative-quarter-viewer');await grantQuery({setup:db},viewer.id,{capabilities:exportCaps});assert.equal((await call(viewer,{idempotencyKey:randomUUID(),question:'上季度CBD净有效租金'})).status,403);
    await grantQuery({setup:db},queryAdmin.id,{capabilities:exportCaps,fields:[]});try{assert.equal((await call(queryAdmin,body)).status,403);assert.equal((await recover(queryAdmin,source.requestId)).status,403);}finally{await grantQuery({setup:db},queryAdmin.id,{capabilities:exportCaps});}
  });
}
