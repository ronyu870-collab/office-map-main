import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import * as XLSX from 'xlsx';
import JSZip from 'jszip';
import {grantQuery} from '../../supabase/tests/ai-query-authority/database.mjs';
import {BUILDINGS} from '../../supabase/tests/ai-query-authority/snapshot-fixture.mjs';

export async function verifySubmissionQueries({db,check,queryAdmin,other,call,recover,artifact,acknowledge,events,decrypt,capabilities,caps,exportCaps,newest}) {
  const ask=question=>call(queryAdmin,{idempotencyKey:randomUUID(),question});
  let saved;
  await check('主页九类填报问题经真实HTTP查询，按配置季度输出并保留完整问题与来源',async()=>{
    assert.equal((await capabilities(queryAdmin)).body.examples.length,15);
    for(const [action,view,rows] of [['填报进度','summary',4],['填报明细','buildings',4],['哪些楼还没填','missing',1],['未分配楼宇','unassigned',1],['人员填报进度','people',2],['谁还没填','missing_people',2],['填报数据质量','quality',4],['填报缺项','missing_fields',2],['填报异常','anomalies',0]]){
      const question=`当前填报季度CBD${action}`,r=await ask(question);assert.equal(r.status,200,JSON.stringify(r.body));
      assert.equal(r.body.result.operation,'submission_progress');assert.equal(r.body.result.parameters.view,view);assert.equal(r.body.result.table.rows.length,rows);
      assert.deepEqual(r.body.result.parameters.period,{year:2026,quarter:3});assert.equal(r.body.result.analysis.counts.catalogBuildings,4);
      assert.equal(decrypt((await events(r.body.requestId))[0]).content.submittedText,question);
      assert.deepEqual((await recover(queryAdmin,r.body.requestId)).body.result,r.body.result);
      if(view==='quality')saved=r;
    }
    assert.equal((await acknowledge(queryAdmin,saved)).status,200);
  });
  await check('填报图表和CSV/XLSX/SVG使用同一快照，数据库后改不覆盖旧结果',async()=>{
    const common={requestId:saved.body.requestId,resultId:saved.body.result.resultId};
    await db.query('update public.quarterly_submissions set asking_rent=99 where id=$1',[newest]);
    try{
      assert.deepEqual((await recover(queryAdmin,common.requestId)).body.result,saved.body.result);
      const c=await artifact(queryAdmin,{...common,action:'chart',chart:{kind:'bar',field:'vacancy_rate'}});assert.equal(c.status,200);assert.equal(c.body.chart.resultId,common.resultId);
      const x=await artifact(queryAdmin,{...common,action:'export',format:'xlsx'});assert.equal(x.status,200);
      const book=XLSX.read(x.bytes,{type:'array'});assert.ok(book.SheetNames.includes('填报覆盖'));assert.ok(book.SheetNames.includes('人员任务'));
      const rows=XLSX.utils.sheet_to_json(book.Sheets['填报质量'],{header:1});
      const first=rows.slice(3).find(row=>row[0]===BUILDINGS[0]);const asking=rows[2].findIndex(t=>String(t).includes('报价租金'));
      assert.equal(first[asking],'未记录');const vacancy=rows[2].findIndex(t=>String(t).includes('填报空置率'));assert.equal(first[vacancy],0.5);
      for(const format of ['csv_zip','svg_zip']){
        const f=await artifact(queryAdmin,{...common,action:'export',format,...(format==='svg_zip'?{chart:{kind:'bar',field:'vacancy_rate'}}:{})});assert.equal(f.status,200);
        const m=JSON.parse(await (await JSZip.loadAsync(f.bytes)).file('manifest.json').async('string'));assert.equal(m.resultId,common.resultId);assert.deepEqual(m.sources,saved.body.result.sources);
      }
    }finally{await db.query('update public.quarterly_submissions set asking_rent=null where id=$1',[newest]);}
  });
  await check('填报查询、恢复、作图、导出只允许当前admin本人，模拟自己也拒绝',async()=>{
    await grantQuery({setup:db},other.id,{capabilities:caps});
    const common={requestId:saved.body.requestId,resultId:saved.body.result.resultId};
    assert.equal((await recover(other,common.requestId)).status,403);
    assert.equal((await artifact(other,{...common,action:'export',format:'xlsx'})).status,403);
    for(const role of ['viewer','editor']){
      await db.query('update public.user_roles set role=$1 where user_id=$2',[role,queryAdmin.id]);
      try{
        assert.equal((await capabilities(queryAdmin)).body.enabled,false);
        assert.equal((await ask('当前填报季度CBD填报进度')).status,403);
        assert.equal((await recover(queryAdmin,common.requestId)).status,403);
        for(const action of ['chart','export'])assert.equal((await artifact(queryAdmin,{...common,action,...(action==='chart'?{chart:{kind:'bar',field:'vacancy_rate'}}:{format:'xlsx'})})).status,403);
      }finally{await db.query("update public.user_roles set role='admin' where user_id=$1",[queryAdmin.id]);}
    }
    const simulation={'X-Colliers-Impersonate-User':queryAdmin.id};
    assert.equal((await call(queryAdmin,{idempotencyKey:randomUUID(),question:'当前填报季度CBD填报进度'},simulation)).status,403);
    assert.equal((await recover(queryAdmin,common.requestId,'recover',simulation)).status,403);
    assert.equal((await artifact(queryAdmin,{...common,action:'export',format:'xlsx'},simulation)).status,403);
  });
  await check('进度权限不能读取质量，配置未知明确澄清且完整审计，明确季度不受配置猜测影响',async()=>{
    await grantQuery({setup:db},queryAdmin.id,{capabilities:[...exportCaps,'query:submission-progress']});
    const p=await ask('当前填报季度CBD填报进度');assert.equal(p.status,200);assert.equal(p.body.result.analysis.quality,null);
    assert.ok(p.body.result.sources.every(s=>s.field!=='asking_rent'));
    assert.equal((await ask('当前填报季度CBD填报数据质量')).status,403);
    assert.equal((await recover(queryAdmin,saved.body.requestId)).status,403);
    await db.query("update public.app_settings set value='未知' where key='current_submission_quarter'");
    try{
      const r=await ask('当前填报季度CBD填报进度');assert.equal(r.status,422,JSON.stringify(r.body));assert.match(r.body.message,/不知道/);assert.equal(r.body.result,undefined);
      assert.ok((await events(r.body.requestId)).some(e=>e.kind==='denied'&&decrypt(e).content.reason==='submission_period_unavailable'));
      const explicit=await ask('2026Q3CBD填报进度');assert.equal(explicit.status,200);assert.equal(explicit.body.result.analysis.configuredPeriod,null);
    }finally{await db.query("update public.app_settings set value='3' where key='current_submission_quarter'");await grantQuery({setup:db},queryAdmin.id,{capabilities:caps});}
  });
  await check('来源撤回后旧填报结果与下载拒绝，来源RPC不能由已认证浏览器直调',async()=>{
    const common={requestId:saved.body.requestId,resultId:saved.body.result.resultId};
    const changed=(await db.query('update public.building_assignments set building_id=$1 where building_id=$2 returning id',[BUILDINGS[1],BUILDINGS[0]])).rows;
    try{
      assert.equal((await recover(queryAdmin,common.requestId)).status,403);
      assert.equal((await artifact(queryAdmin,{...common,action:'export',format:'xlsx'})).status,403);
    }finally{await db.query('update public.building_assignments set building_id=$1 where id=any($2::uuid[])',[BUILDINGS[0],changed.map(r=>r.id)]);}
    const r=await queryAdmin.client.rpc('ai_query_submission_sources_allowed',{p_actor:queryAdmin.id,p_effective:queryAdmin.id,p_session:queryAdmin.sessionId,p_request_id:common.requestId,p_permission_revision:'0'.repeat(64),p_sources:[]});assert.equal(r.error?.code,'42501');
  });
  await check('填报结果生成后、首个响应之前撤回来源，最终交付闸门拒绝且追加未交付审计',async()=>{
    await db.query(`create or replace function private.withdraw_submission_source_after_prepare() returns trigger language plpgsql set search_path='' as $$ begin if new.kind='delivery_receipt' then update public.quarterly_submissions set record_quarter=4 where id='${newest}';end if;return new;end $$;
      create trigger withdraw_submission_source_after_prepare after insert on private.ai_query_audit_events for each row execute function private.withdraw_submission_source_after_prepare()`);
    try{
      const r=await ask('当前填报季度CBD填报数据质量');assert.equal(r.status,403,JSON.stringify(r.body));assert.equal(r.body.result,undefined);
      assert.ok((await events(r.body.requestId)).some(e=>e.kind==='correction'&&decrypt(e).content.delivery==='not_sent'));
    }finally{await db.query('drop trigger withdraw_submission_source_after_prepare on private.ai_query_audit_events');await db.query('update public.quarterly_submissions set record_quarter=3 where id=$1',[newest]);}
  });
}
