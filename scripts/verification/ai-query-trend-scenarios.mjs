import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import JSZip from 'jszip';
import * as XLSX from 'xlsx';
import { grantQuery } from '../../supabase/tests/ai-query-authority/database.mjs';
import { BUILDINGS } from '../../supabase/tests/ai-query-authority/snapshot-fixture.mjs';

export async function verifyQuarterTrend({db,check,queryAdmin,call,recover,artifact,acknowledge,exportCaps,events,decrypt}) {
  await grantQuery({setup:db},queryAdmin.id,{capabilities:exportCaps});
  const query = question => call(queryAdmin,{idempotencyKey:randomUUID(),question});
  let source;
  await check('多季度真实SQL完整保留缺期，三项指标按各期与全期间共同样本确定性计算',async()=>{
    const response=await query('CBD净有效租金2026Q1至2026Q4趋势各期样本');assert.equal(response.status,200);
    source=response.body;
    assert.equal(source.result.operation,'trend');
    assert.deepEqual(source.result.table.rows.map(r=>r.entityId),['2026-Q1','2026-Q2','2026-Q3','2026-Q4']);
    assert.deepEqual(source.result.table.rows.map(r=>r.cells.value.kind),['unknown','number','number','unknown']);
    assert.deepEqual(source.result.table.rows[1].cells.value.value.exact,{numerator:'1090',denominator:'7'});
    assert.equal(source.result.table.rows[2].cells.value.value.numeric,170);
    assert.deepEqual(source.result.analysis.periods.map(p=>p.availableCoverage.total),[4,4,4,4]);
    const paired=await query('CBD净有效租金2026Q2至2026Q3趋势全期间共同样本');assert.equal(paired.status,200);
    assert.deepEqual(paired.body.result.analysis.periods.map(p=>p.value.numeric),[154,170]);
    const empty=await query('CBD净有效租金2026Q1至2026Q4趋势全期间共同样本');assert.equal(empty.status,200);
    assert.ok(empty.body.result.table.rows.every(r=>r.cells.value.kind==='unknown'));
    for(const [metric,expected] of [['空置率',[.125,.175]],['季度总面积',[70000,70000]]]){
      const r=await query(`CBD${metric}2026Q2至2026Q3趋势全期间共同样本`);assert.equal(r.status,200);
      assert.deepEqual(r.body.result.analysis.periods.map(p=>p.value.numeric),expected);
    }
  });
  await check('趋势折线、柱图、Excel及CSV/SVG回读绑定同一个结果和原始来源',async()=>{
    const common={requestId:source.requestId,resultId:source.result.resultId};
    const chart=await artifact(queryAdmin,{...common,action:'chart',chart:{kind:'time_series'}});assert.equal(chart.status,200);
    assert.equal(chart.body.chart.kind,'line');assert.deepEqual(chart.body.chart.points.map(p=>p.y),[null,1090/7,170,null]);
    assert.equal(chart.body.chart.connectNulls,false);
    assert.deepEqual(chart.body.chart.points[2].yCell.sourceIds,source.result.table.rows[2].cells.value.sourceIds);
    const receipt=await acknowledge(queryAdmin,chart,'client_dom_committed',{surface:'chart',page:0,pageSize:25,layout:'line_all'});assert.equal(receipt.status,200);
    const bar=await artifact(queryAdmin,{...common,action:'chart',chart:{kind:'bar',field:'value'}});assert.equal(bar.status,200);
    assert.deepEqual(bar.body.chart.points.map(p=>p.y),chart.body.chart.points.map(p=>p.y));
    const excel=await artifact(queryAdmin,{...common,action:'export',format:'xlsx'});assert.equal(excel.status,200);
    const book=XLSX.read(excel.bytes,{type:'array'});assert.equal(book.Sheets['数据'].C2.t,'s');assert.equal(book.Sheets['数据'].C4.v,170);
    assert.equal(book.Sheets['口径与快照'].B2.v,source.result.resultId);
    for(const format of ['csv_zip','svg_zip']){
      const file=await artifact(queryAdmin,{...common,action:'export',format,...(format==='svg_zip'?{chart:{kind:'time_series'}}:{})});assert.equal(file.status,200);
      const zip=await JSZip.loadAsync(file.bytes),manifest=JSON.parse(await zip.file('manifest.json').async('string'));
      assert.deepEqual(manifest.sources,source.result.sources);assert.equal(manifest.resultId,source.result.resultId);
      if(format==='csv_zip')assert.match(await zip.file('data.csv').async('string'),/1090\/7/);
      else {assert.deepEqual(manifest.chart,chart.body.chart);assert.equal((await zip.file('chart.svg').async('string')).match(/<circle /g).length,2);}
    }
  });
  await check('趋势恢复不悄悄重算；任一历史参与来源撤回后拒绝恢复、作图和下载',async()=>{
    const common={requestId:source.requestId,resultId:source.result.resultId};
    await db.query('update public.building_metrics set net_effective_rent=999 where building_id=$1 and record_year=2026 and record_quarter=2',[BUILDINGS[0]]);
    try{
      const old=await recover(queryAdmin,source.requestId);assert.equal(old.status,200);assert.deepEqual(old.body.result,source.result);
      const fresh=await query('CBD净有效租金2026Q1至2026Q4趋势各期样本');assert.equal(fresh.status,200);
      assert.notEqual(fresh.body.result.table.rows[1].cells.value.value.numeric,source.result.table.rows[1].cells.value.value.numeric);
      await db.query('update public.building_metrics set is_draft=true where building_id=$1 and record_year=2026 and record_quarter=2',[BUILDINGS[0]]);
      assert.equal((await recover(queryAdmin,source.requestId)).status,403);
      assert.equal((await artifact(queryAdmin,{...common,action:'chart',chart:{kind:'time_series'}})).status,403);
      assert.equal((await artifact(queryAdmin,{...common,action:'export',format:'xlsx'})).status,403);
    }finally{await db.query('update public.building_metrics set net_effective_rent=90,is_draft=false where building_id=$1 and record_year=2026 and record_quarter=2',[BUILDINGS[0]]);}
  });
  await check('连续40期完整读取；过大或反向区间与额外未支持条件不会被忽略',async()=>{
    const result=await query('CBD净有效租金2017Q1至2026Q4趋势各期样本');assert.equal(result.status,200);
    assert.equal(result.body.result.table.rows.length,40);assert.equal(result.body.result.analysis.periods.filter(p=>p.value!==null).length,2);
    for(const question of ['CBD净有效租金2016Q4至2026Q4趋势各期样本','CBD净有效租金2026Q4至2026Q1趋势各期样本','CBD净有效租金2026Q1至2026Q4趋势各期样本只要A楼']){
      const r=await query(question);assert.equal(r.body.status,'clarification');assert.equal(r.body.result,undefined);
      const ledger=await events(r.body.requestId);
      const planning=ledger.filter(event=>event.kind==='running');
      assert.equal(planning.length,1);
      assert.equal(decrypt(planning[0]).content.phase,'planning');
      assert.ok(!ledger.some(event=>['tool_finished','response_generated','succeeded'].includes(event.kind)),
        'Clarification may enter audited planning but must never execute a trusted data snapshot or generate a factual result');
      assert.equal(ledger.filter(event=>event.kind==='denied').length,1);
    }
  });
}
