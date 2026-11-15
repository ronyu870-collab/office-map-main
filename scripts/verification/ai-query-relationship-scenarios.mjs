import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import * as XLSX from 'xlsx';
import JSZip from 'jszip';
import { grantQuery } from '../../supabase/tests/ai-query-authority/database.mjs';
import { BUILDINGS } from '../../supabase/tests/ai-query-authority/snapshot-fixture.mjs';

export async function verifyRelationship({db,check,queryAdmin,person,call,recover,artifact,acknowledge,exportCaps}) {
  const before=(await db.query('select id,net_effective_rent,vacant_area,is_draft from public.building_metrics where building_id=$1 and record_year=2026 and record_quarter=3',[BUILDINGS[2]])).rows;
  const question='2026Q3全部获权楼宇净有效租金与空置率关系';
  const query=(who=queryAdmin)=>call(who,{idempotencyKey:randomUUID(),question});
  let first,source,common;
  try{
    await grantQuery({setup:db},queryAdmin.id,{capabilities:exportCaps});
    await check('真实联合关系查询区分候选与各指标有效数；不足3栋不报告系数',async()=>{
      const r=await query();assert.equal(r.status,200);first=r.body;
      assert.deepEqual(first.result.analysis.coverage,{candidates:4,rentValid:3,vacancyValid:2,jointValid:2,excluded:2});
      assert.equal(first.result.analysis.correlation.value,null);assert.equal(first.result.table.rows.find(r=>r.entityId===BUILDINGS[3]).cells.vacancy.state,'invalid');
    });
    await check('真实同季度联合样本使用未舍入矩计算Pearson；恢复保持旧快照',async()=>{
      await db.query('update public.building_metrics set net_effective_rent=300,vacant_area=8000 where id=any($1::bigint[])',[before.map(r=>r.id)]);
      const r=await query();assert.equal(r.status,200);source=r.body;common={requestId:source.requestId,resultId:source.result.resultId};
      assert.equal(source.result.analysis.coverage.jointValid,3);assert.equal(source.result.analysis.correlation.value,.981981);
      assert.deepEqual(source.result.analysis.correlation.squaredExact,{numerator:'27',denominator:'28'});
      const old=await recover(queryAdmin,first.requestId);assert.equal(old.status,200);assert.deepEqual(old.body.result,first.result);
    });
    await check('联合散点、回执与XLSX/CSV/SVG均保持原结果及参与来源',async()=>{
      const request={kind:'scatter',x:'rent',y:'vacancy'};
      const chart=await artifact(queryAdmin,{...common,action:'chart',chart:request});assert.equal(chart.status,200);
      assert.equal(chart.body.chart.renderedCount,3);assert.equal(chart.body.chart.unknownCount,1);
      assert.equal((await acknowledge(queryAdmin,chart,'client_dom_committed',{surface:'chart',page:0,pageSize:25,layout:'scatter_all'})).status,200);
      const excel=await artifact(queryAdmin,{...common,action:'export',format:'xlsx'});assert.equal(excel.status,200);
      const book=XLSX.read(excel.bytes,{type:'array'});assert.equal(book.Sheets['联合统计'].B1.v,common.resultId);assert.match(book.Sheets['联合统计'].B3.v,/0.981981/);
      assert.ok(XLSX.utils.sheet_to_json(book.Sheets['数据'],{header:1}).some(r=>r[0]===BUILDINGS[2]&&r[2]===300&&r[3]===.4));
      for(const format of ['csv_zip','svg_zip']){
        const a=await artifact(queryAdmin,{...common,action:'export',format,...(format==='svg_zip'?{chart:request}:{})});assert.equal(a.status,200);
        const zip=await JSZip.loadAsync(a.bytes),m=JSON.parse(await zip.file('manifest.json').async('string'));
        assert.equal(m.resultId,common.resultId);assert.deepEqual(m.analysis,source.result.analysis);assert.deepEqual(m.sources,source.result.sources);
        if(format==='svg_zip')assert.equal((await zip.file('chart.svg').async('string')).match(/<circle /g).length,3);
      }
    });
    await check('联合关系必须同时获准全部输入字段；普通角色和来源撤回拒绝',async()=>{
      const limited=await person('admin','relation-limited');await grantQuery({setup:db},limited.id,{capabilities:exportCaps,fields:['totalArea','netEffectiveRent']});assert.equal((await query(limited)).status,403);
      const viewer=await person('viewer','relation-viewer');await grantQuery({setup:db},viewer.id,{capabilities:exportCaps});assert.equal((await query(viewer)).status,403);
      await db.query('update public.building_metrics set is_draft=true where id=any($1::bigint[])',[before.map(r=>r.id)]);
      assert.equal((await recover(queryAdmin,source.requestId)).status,403);assert.equal((await artifact(queryAdmin,{...common,action:'export',format:'xlsx'})).status,403);
    });
  } finally {
    for(const row of before)await db.query('update public.building_metrics set net_effective_rent=$2,vacant_area=$3,is_draft=$4 where id=$1',[row.id,row.net_effective_rent,row.vacant_area,row.is_draft]);
    await grantQuery({setup:db},queryAdmin.id,{capabilities:exportCaps});
  }
}
