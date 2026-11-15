import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import * as XLSX from 'xlsx';
import JSZip from 'jszip';
import {grantQuery} from '../../supabase/tests/ai-query-authority/database.mjs';
import {BUILDINGS} from '../../supabase/tests/ai-query-authority/snapshot-fixture.mjs';

export async function verifyDistribution({db,check,queryAdmin,person,call,recover,artifact,acknowledge,exportCaps}) {
  const before=(await db.query('select id,net_effective_rent,is_draft,building_id from public.building_metrics where building_id=any($1::uuid[]) and record_year=2026 and record_quarter=3',[BUILDINGS])).rows;
  const market=(await db.query('select submarket from public.buildings where id=$1',[BUILDINGS[3]])).rows[0].submarket;
  const question='2026Q3全部获权楼宇净有效租金分布',query=(text=question,who=queryAdmin)=>call(who,{idempotencyKey:randomUUID(),question:text});let first,source,common;
  try{
    await grantQuery({setup:db},queryAdmin.id,{capabilities:exportCaps});
    await check('真实分布查询使用完整有效样本与Type7，楼书未知/冲突和季度无效分开',async()=>{
      const r=await query();assert.equal(r.status,200);first=r.body;
      assert.equal(first.result.analysis.stats.median.numeric,150);assert.equal(first.result.analysis.stats.mean.numeric,150);assert.equal(first.result.analysis.stats.q1.numeric,125);assert.equal(first.result.analysis.coverage.valid,3);assert.deepEqual(first.result.analysis.bins.map(b=>b.count),[1,1,1]);
      const height=await query('全部获权楼宇建筑高度分布');assert.equal(height.status,200);assert.equal(height.body.result.analysis.stats.median.numeric,204);assert.equal(height.body.result.analysis.coverage.conflict,1);
      const vacancy=await query('2026Q3全部获权楼宇空置率分布');assert.equal(vacancy.status,200);assert.equal(vacancy.body.result.analysis.coverage.invalid,1);assert.equal(vacancy.body.result.analysis.stats.median.numeric,.15);
    });
    await check('离群值仍参与分箱/均值；数据改变后恢复保留旧分布',async()=>{
      for(let i=0;i<BUILDINGS.length;i++)await db.query('update public.building_metrics set net_effective_rent=$2 where building_id=$1 and record_year=2026 and record_quarter=3',[BUILDINGS[i],[1,2,3,100][i]]);
      const r=await query();assert.equal(r.status,200);source=r.body;common={requestId:source.requestId,resultId:source.result.resultId};
      assert.equal(source.result.analysis.stats.mean.numeric,26.5);assert.equal(source.result.analysis.stats.median.numeric,2.5);assert.equal(source.result.analysis.stats.upperWhisker.numeric,3);assert.deepEqual(source.result.analysis.bins.map(b=>b.count),[3,0,1]);assert.equal(source.result.analysis.observations.filter(o=>o.outlier).length,1);
      const old=await recover(queryAdmin,first.requestId);assert.equal(old.status,200);assert.deepEqual(old.body.result,first.result);
    });
    await check('真实直方/箱线、回执和XLSX/CSV/SVG保持同一完整分布及成员来源',async()=>{
      for(const kind of ['histogram','box_plot']){
        const c=await artifact(queryAdmin,{...common,action:'chart',chart:{kind}});assert.equal(c.status,200);assert.equal(c.body.chart.distribution.validCount,4);
        assert.equal((await acknowledge(queryAdmin,c,'client_dom_committed',{surface:'chart',page:0,pageSize:25,layout:kind==='histogram'?'histogram_all':'box_plot_all'})).status,200);
        const f=await artifact(queryAdmin,{...common,action:'export',format:'svg_zip',chart:{kind}});assert.equal(f.status,200);const zip=await JSZip.loadAsync(f.bytes),m=JSON.parse(await zip.file('manifest.json').async('string'));assert.deepEqual(m.chart,c.body.chart);assert.deepEqual(m.sources,source.result.sources);
      }
      const x=await artifact(queryAdmin,{...common,action:'export',format:'xlsx'});assert.equal(x.status,200);const book=XLSX.read(x.bytes,{type:'array'});assert.equal(book.Sheets['分位统计'].B1.v,common.resultId);assert.equal(book.Sheets['分位统计'].B6.v,2.5);assert.equal(XLSX.utils.sheet_to_json(book.Sheets['分箱成员'],{header:1}).length,6);
      const csv=await artifact(queryAdmin,{...common,action:'export',format:'csv_zip'});assert.equal(csv.status,200);const manifest=JSON.parse(await (await JSZip.loadAsync(csv.bytes)).file('manifest.json').async('string'));assert.deepEqual(manifest.analysis,source.result.analysis);
    });
    await check('分布权限先过滤全集，缺字段/普通角色与来源撤回不能绕过',async()=>{
      const narrow=await person('admin','distribution-narrow');await grantQuery({setup:db},narrow.id,{capabilities:exportCaps,allSubmarkets:false,submarkets:['CBD']});
      await db.query("update public.buildings set submarket='金融街' where id=$1",[BUILDINGS[3]]);
      const r=await query(question,narrow);assert.equal(r.status,200);assert.equal(r.body.result.analysis.coverage.total,3);assert.equal(r.body.result.analysis.stats.max.numeric,3);assert.equal(JSON.stringify(r.body.result).includes(BUILDINGS[3]),false);
      const limited=await person('admin','distribution-field');await grantQuery({setup:db},limited.id,{capabilities:exportCaps,fields:['totalArea']});assert.equal((await query(question,limited)).status,403);
      const viewer=await person('viewer','distribution-viewer');await grantQuery({setup:db},viewer.id,{capabilities:exportCaps});assert.equal((await query(question,viewer)).status,403);
      await db.query('update public.building_metrics set is_draft=true where id=$1',[before[0].id]);assert.equal((await recover(queryAdmin,source.requestId)).status,403);assert.equal((await artifact(queryAdmin,{...common,action:'export',format:'xlsx'})).status,403);
    });
  }finally{
    for(const r of before)await db.query('update public.building_metrics set net_effective_rent=$2,is_draft=$3 where id=$1',[r.id,r.net_effective_rent,r.is_draft]);
    await db.query('update public.buildings set submarket=$2 where id=$1',[BUILDINGS[3],market]);await grantQuery({setup:db},queryAdmin.id,{capabilities:exportCaps});
  }
}
