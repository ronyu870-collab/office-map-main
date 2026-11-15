import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import JSZip from 'jszip';
import * as XLSX from 'xlsx';
import pg from 'pg';
import {grantQuery} from '../../supabase/tests/ai-query-authority/database.mjs';
import {BUILDINGS} from '../../supabase/tests/ai-query-authority/snapshot-fixture.mjs';

export async function verifyGroupedQuarter({db,check,queryAdmin,person,call,recover,artifact,acknowledge,exportCaps,load,dataApiConnectionString}) {
  const before=(await db.query('select id,submarket,grade from public.buildings where id=any($1::uuid[])',[BUILDINGS])).rows;
  const query=(question,who=queryAdmin)=>call(who,{idempotencyKey:randomUUID(),question});
  const byLabel=(result,label)=>result.table.rows.filter(row=>row.cells.name.value===label);
  let source;
  try {
    await grantQuery({setup:db},queryAdmin.id,{capabilities:exportCaps});
    for(let i=0;i<4;i++)await db.query('update public.buildings set submarket=$2,grade=$3 where id=$1',[BUILDINGS[i],['CBD','金融街','金融街',null][i],['A','A','B',null][i]]);
    await check('同一真实快照按区域/等级分组：独立权重、未知分类和指定空区域',async()=>{
      const r=await query('全部获权楼宇净有效租金2026Q2至2026Q3按子市场趋势全期间共同样本');assert.equal(r.status,200);source=r.body;
      assert.equal(source.result.operation,'group_trend');assert.equal(source.result.table.rows.length,6);
      assert.deepEqual(byLabel(source.result,'CBD').map(row=>row.cells.value.value.numeric),[90,100]);
      assert.deepEqual(byLabel(source.result,'金融街').map(row=>row.cells.value.value.numeric),[180,200]);
      assert.equal(source.result.sources.filter(s=>s.field==='submarket').length,4);
      assert.ok(source.result.analysis.groups.find(g=>g.value===null).entityIds.includes(BUILDINGS[3]));
      const empty=await query('2026Q3CBD、金融街、丽泽净有效租金按子市场比较');assert.equal(empty.status,200);
      assert.equal(byLabel(empty.body.result,'丽泽')[0].cells.value.kind,'unknown');
      assert.equal(byLabel(empty.body.result,'丽泽')[0].cells.usedCount.value.numeric,0);
      assert.equal(empty.body.result.sources.some(s=>s.entityId===BUILDINGS[3]),false);
      const grade=await query('2026Q3全部获权楼宇空置率按等级比较');assert.equal(grade.status,200);
      assert.equal(byLabel(grade.body.result,'A')[0].cells.value.value.numeric,.175);
      const per=await query('全部获权楼宇净有效租金2026Q2至2026Q3按子市场趋势各期样本');assert.equal(per.status,200);
      assert.equal(byLabel(per.body.result,'金融街')[0].cells.value.value.numeric,172);
    });
    await check('分组趋势图与真实XLSX/SVG/CSV均保留全部组、空值和分组字段来源',async()=>{
      const common={requestId:source.requestId,resultId:source.result.resultId};
      const chart=await artifact(queryAdmin,{...common,action:'chart',chart:{kind:'grouped_time_series'}});assert.equal(chart.status,200);
      assert.equal(chart.body.chart.kind,'faceted_line');assert.equal(chart.body.chart.facets.length,3);
      assert.deepEqual(chart.body.chart.facets.find(g=>g.label==='金融街').points.map(p=>p.y),[180,200]);
      assert.equal((await acknowledge(queryAdmin,chart,'client_dom_committed',{surface:'chart',page:0,pageSize:25,layout:'faceted_line_all'})).status,200);
      const excel=await artifact(queryAdmin,{...common,action:'export',format:'xlsx'});assert.equal(excel.status,200);
      const book=XLSX.read(excel.bytes,{type:'array'}),rows=XLSX.utils.sheet_to_json(book.Sheets['数据'],{header:1});
      assert.equal(rows.length,7);assert.equal(book.Sheets['口径与快照'].B2.v,source.result.resultId);assert.ok(rows.some(r=>r[1]==='金融街'&&r[3]===200));
      for(const format of ['csv_zip','svg_zip']){
        const file=await artifact(queryAdmin,{...common,action:'export',format,...(format==='svg_zip'?{chart:{kind:'grouped_time_series'}}:{})});assert.equal(file.status,200);
        const zip=await JSZip.loadAsync(file.bytes),manifest=JSON.parse(await zip.file('manifest.json').async('string'));
        assert.equal(manifest.resultId,source.result.resultId);assert.deepEqual(manifest.sources,source.result.sources);
        if(format==='svg_zip'){assert.deepEqual(manifest.chart,chart.body.chart);assert.equal((await zip.file('chart.svg').async('string')).match(/<polyline /g).length,3);}
      }
    });
    await check('真实SQL旧来源白名单拒绝分组字段；升级后仅允许指定目录字段并保留审计/角色限制',async()=>{
      const authority=(await db.query('select private.ai_query_authority($1,$1,$2) a',[queryAdmin.id,queryAdmin.sessionId])).rows[0].a;
      const refs=source.result.sources.map(s=>({entity_id:s.entityId,record_id:s.recordId,source_table:s.table,field:s.field,year:s.period?.year??null,quarter:s.period?.quarter??null}));
      const allowed=async(input=refs)=>(await db.query('select private.ai_query_result_sources_allowed($1,$1,$2,$3,$4,$5) a',[queryAdmin.id,queryAdmin.sessionId,source.requestId,authority.permission_revision,JSON.stringify(input)])).rows[0].a;
      const old=await load('20261113042352_ai_query_result_recovery.sql'),start=old.indexOf('create function private.ai_query_result_sources_allowed('),end=old.indexOf('end $$;',start)+7;
      await db.query('begin');
      try{
        await db.query(old.slice(start,end).replace('create function','create or replace function'));
        assert.equal((await allowed()).allowed,false);
      }finally{await db.query('rollback');}
      assert.equal((await allowed()).allowed,true);assert.equal((await allowed()).source_policy,'catalog-dimensions/1');
      for(const patch of [{field:'contact_phone'},{record_id:BUILDINGS[1]},{year:2026,quarter:3}]){
        const ref=refs.find(r=>r.field==='submarket');assert.equal((await allowed([{...ref,...patch}])).allowed,false);
      }
      // Match PostgREST's session user. Supabase 17.6/aarch64 crashes on a
      // denied function call after SET ROLE from its special postgres login,
      // even for an unrelated SELECT 1 function. No privilege is relaxed here.
      const client=new pg.Client({connectionString:dataApiConnectionString});
      await client.connect();
      try{for(const role of ['anon','authenticated']){
        await client.query('begin');
        try{await client.query(`set local role ${role}`);await assert.rejects(client.query('select public.ai_query_result_sources_allowed($1,$1,$2,$3,$4,$5)',[queryAdmin.id,queryAdmin.sessionId,source.requestId,authority.permission_revision,JSON.stringify(refs)]),e=>e.code==='42501');}
        finally{await client.query('rollback');}
      }}finally{await client.end();}
    });
    await check('区域资格收紧不泄漏其他组；组成员移出当前权限后旧分组恢复/作图/下载拒绝',async()=>{
      const limited=await person('admin','group-limited');await grantQuery({setup:db},limited.id,{allSubmarkets:false,submarkets:['CBD'],capabilities:exportCaps});
      const scoped=await query('2026Q3全部获权楼宇净有效租金按子市场比较',limited);assert.equal(scoped.status,200);
      assert.equal(scoped.body.result.table.rows.length,1);assert.equal(scoped.body.result.table.rows[0].cells.name.value,'CBD');
      assert.equal(JSON.stringify(scoped.body.result).includes(BUILDINGS[1]),false);
      assert.equal((await query('2026Q3CBD、金融街净有效租金按子市场比较',limited)).status,403);
      await db.query("update public.buildings set submarket='金融街' where id=$1",[BUILDINGS[0]]);
      try{
        assert.equal((await recover(limited,scoped.body.requestId)).status,403);
        for(const action of [{action:'chart',chart:{kind:'bar',field:'value'}},{action:'export',format:'xlsx'}])assert.equal((await artifact(limited,{requestId:scoped.body.requestId,resultId:scoped.body.result.resultId,...action})).status,403);
      }finally{await db.query("update public.buildings set submarket='CBD' where id=$1",[BUILDINGS[0]]);}
    });
  }finally{for(const row of before)await db.query('update public.buildings set submarket=$2,grade=$3 where id=$1',[row.id,row.submarket,row.grade]);await grantQuery({setup:db},queryAdmin.id,{capabilities:exportCaps});}
}
