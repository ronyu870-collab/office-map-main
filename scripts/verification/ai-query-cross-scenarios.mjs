import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import JSZip from 'jszip';
import * as XLSX from 'xlsx';
import {grantQuery} from '../../supabase/tests/ai-query-authority/database.mjs';
import {BUILDINGS} from '../../supabase/tests/ai-query-authority/snapshot-fixture.mjs';

export async function verifyCrossQuarter({db,check,queryAdmin,person,call,recover,artifact,acknowledge,exportCaps,load}) {
  const before=(await db.query('select id,submarket,grade from public.buildings where id=any($1::uuid[])',[BUILDINGS])).rows;
  const question='2026Q3全部获权楼宇净有效租金按子市场和等级交叉统计';
  const query=(text=question,who=queryAdmin)=>call(who,{idempotencyKey:randomUUID(),question:text});
  let source,common;
  try{
    await grantQuery({setup:db},queryAdmin.id,{capabilities:exportCaps});
    for(let i=0;i<4;i++)await db.query('update public.buildings set submarket=$2,grade=$3 where id=$1',[BUILDINGS[i],['CBD','金融街','金融街',null][i],['A','A','B',null][i]]);
    await check('真实交叉查询保留全部9格、空组合、缺失分类及每格独立分母',async()=>{
      const r=await query();assert.equal(r.status,200);source=r.body;common={requestId:source.requestId,resultId:source.result.resultId};
      assert.equal(source.result.operation,'cross_aggregate');assert.equal(source.result.table.rows.length,9);
      assert.equal(source.result.table.rows.filter(r=>r.cells.value.kind==='number').length,3);
      const row=source.result.table.rows.find(r=>r.cells.name.value==='金融街'&&r.cells.grade.value==='A');
      assert.equal(row.cells.value.value.numeric,200);assert.equal(row.cells.denominator.value.numeric,30000);
      assert.equal(source.result.sources.filter(s=>['submarket','grade'].includes(s.field)).length,8);
      const empty=await query('2026Q3CBD、金融街、丽泽净有效租金按子市场和等级交叉统计');assert.equal(empty.status,200);
      assert.equal(empty.body.result.table.rows.filter(r=>r.cells.name.value==='丽泽').length,2);
      assert.ok(empty.body.result.table.rows.filter(r=>r.cells.name.value==='丽泽').every(r=>r.cells.value.kind==='unknown'));
      const ratio=await query('2026Q3全部获权楼宇空置率按子市场和等级交叉统计');assert.equal(ratio.status,200);
      const chart=await artifact(queryAdmin,{requestId:ratio.body.requestId,resultId:ratio.body.result.resultId,action:'chart',chart:{kind:'heatmap'}});assert.equal(chart.status,200);
      assert.deepEqual(chart.body.chart.points.filter(p=>p.y!==null).map(p=>p.y).sort(),[10,20]);
      const invalid=ratio.body.result.table.rows.find(r=>r.cells.name.value==='未知（子市场未填写）'&&r.cells.grade.value==='未知（等级未填写）');assert.equal(invalid.cells.value.state,'invalid');
      assert.ok(chart.body.chart.points.filter(p=>p.y===null).every(p=>p.yText==='未知：无有效样本'));
      const ratioExcel=await artifact(queryAdmin,{requestId:ratio.body.requestId,resultId:ratio.body.result.resultId,action:'export',format:'xlsx'});assert.equal(ratioExcel.status,200);
      const ratioBook=XLSX.read(ratioExcel.bytes,{type:'array',cellNF:true});assert.equal(ratioBook.Sheets['交叉指标'].B4.v,.2);assert.equal(ratioBook.Sheets['交叉指标'].B4.z,'0.00%');
    });
    await check('真实交叉热力表、回执和XLSX/SVG/CSV共用完整快照与分类来源',async()=>{
      const chart=await artifact(queryAdmin,{...common,action:'chart',chart:{kind:'heatmap'}});assert.equal(chart.status,200);
      assert.equal(chart.body.chart.kind,'heatmap');assert.equal(chart.body.chart.points.length,9);assert.equal(chart.body.chart.unknownCount,6);
      assert.equal((await acknowledge(queryAdmin,chart,'client_dom_committed',{surface:'chart',page:0,pageSize:25,layout:'heatmap_all'})).status,200);
      const excel=await artifact(queryAdmin,{...common,action:'export',format:'xlsx'});assert.equal(excel.status,200);
      const book=XLSX.read(excel.bytes,{type:'array'}),rows=XLSX.utils.sheet_to_json(book.Sheets['数据'],{header:1});
      assert.equal(book.Sheets['交叉指标'].B1.v,common.resultId);assert.ok(XLSX.utils.sheet_to_json(book.Sheets['交叉指标'],{header:1}).some(r=>r[0]==='金融街'&&r[1]===200));
      assert.equal(rows.length,10);assert.equal(book.Sheets['口径与快照'].B2.v,common.resultId);assert.ok(rows.some(r=>r[1]==='金融街'&&r[2]==='A'&&r[3]===200));
      for(const format of ['csv_zip','svg_zip']){
        const file=await artifact(queryAdmin,{...common,action:'export',format,...(format==='svg_zip'?{chart:{kind:'heatmap'}}:{})});assert.equal(file.status,200);
        const zip=await JSZip.loadAsync(file.bytes),manifest=JSON.parse(await zip.file('manifest.json').async('string'));
        assert.equal(manifest.resultId,common.resultId);assert.deepEqual(manifest.sources,source.result.sources);
        if(format==='svg_zip'){assert.deepEqual(manifest.chart,chart.body.chart);assert.equal((await zip.file('chart.svg').async('string')).match(/<rect /g).length,10);}
      }
    });
    await check('交叉轴只来自获权区域；普通角色与撤权后的旧交叉结果均拒绝',async()=>{
      const limited=await person('admin','cross-limited');await grantQuery({setup:db},limited.id,{allSubmarkets:false,submarkets:['CBD'],capabilities:exportCaps});
      const r=await query(question,limited);assert.equal(r.status,200);assert.equal(r.body.result.table.rows.length,1);
      assert.equal(r.body.result.parameters.columnGroups.length,1);assert.equal(r.body.result.parameters.columnGroups[0].value,'A');
      assert.equal(JSON.stringify(r.body.result).includes(BUILDINGS[1]),false);
      const ordinary=await person('viewer','cross-viewer');await grantQuery({setup:db},ordinary.id,{capabilities:exportCaps});assert.equal((await query(question,ordinary)).status,403);
      await db.query("update public.buildings set submarket='金融街' where id=$1",[BUILDINGS[0]]);
      try{assert.equal((await recover(limited,r.body.requestId)).status,403);assert.equal((await artifact(limited,{requestId:r.body.requestId,resultId:r.body.result.resultId,action:'chart',chart:{kind:'heatmap'}})).status,403);}
      finally{await db.query("update public.buildings set submarket='CBD' where id=$1",[BUILDINGS[0]]);}
    });
    await check('旧来源协议不能放行交叉图表或下载；参与季度撤回后旧快照不可恢复',async()=>{
      const sql=await load('20261113145743_ai_query_group_dimensions.sql');assert.ok(sql.includes(",'source_policy','catalog-dimensions/1'"));
      await db.query(sql.replace(",'source_policy','catalog-dimensions/1'",''));
      try{
        assert.equal((await recover(queryAdmin,source.requestId)).status,503);
        for(const action of [{action:'chart',chart:{kind:'heatmap'}},{action:'export',format:'xlsx'}])assert.equal((await artifact(queryAdmin,{...common,...action})).status,503);
      }finally{await db.query(sql);}
      assert.equal((await recover(queryAdmin,source.requestId)).status,200);
      await db.query('update public.building_metrics set is_draft=true where building_id=$1 and record_year=2026 and record_quarter=3',[BUILDINGS[0]]);
      try{assert.equal((await recover(queryAdmin,source.requestId)).status,403);assert.equal((await artifact(queryAdmin,{...common,action:'export',format:'xlsx'})).status,403);}
      finally{await db.query('update public.building_metrics set is_draft=false where building_id=$1 and record_year=2026 and record_quarter=3',[BUILDINGS[0]]);}
    });
  }finally{for(const row of before)await db.query('update public.buildings set submarket=$2,grade=$3 where id=$1',[row.id,row.submarket,row.grade]);await grantQuery({setup:db},queryAdmin.id,{capabilities:exportCaps});}
}
