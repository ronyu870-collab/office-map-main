// Actual GoTrue account + service-only Data API + database snapshot + application adapter.
// Internal Q13 foundation and user-facing audited query integration.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { rolldown } from 'rolldown';
import { grantQuery } from '../../supabase/tests/ai-query-authority/database.mjs';
import { BUILDINGS } from '../../supabase/tests/ai-query-authority/snapshot-fixture.mjs';
import { verifySubmissionQueries } from './ai-submission-query-scenarios.mjs';

export async function setupSubmissionObservation(db) {
  if (!(await db.query("select to_regclass('public.quarterly_submissions') t")).rows[0].t) {
    const original=await readFile('supabase/migrations/20260801110130_restore_quarterly_oss_admin.sql','utf8');
    const ddl=original.slice(original.indexOf('create table public.app_settings ('),original.indexOf('create table public.quarterly_updates ('));
    assert.ok(ddl.includes('create table public.quarterly_submissions'));
    await db.query(ddl);
    await db.query(`alter table public.app_settings enable row level security;
      alter table public.building_assignments enable row level security;
      alter table public.quarterly_submissions enable row level security;
      revoke all on public.app_settings,public.building_assignments,public.quarterly_submissions from public,anon,authenticated,service_role;`);
  }
  await db.query(await readFile('supabase/migrations/20261113203807_ai_submission_observation.sql','utf8'));
}

export async function verifySubmissionObservation({db,service,check,queryAdmin,person,exportCaps,output,keyId,encryptionKey,digestKey,...http}) {
  const entry=path.join(output,'submission-entry.mjs');
  await writeFile(entry,`export { readSubmissionSnapshot } from '../../src/lib/intelligence/query/submissions/reader.ts';
    export { analyzeSubmissionSnapshot } from '../../src/lib/intelligence/query/submissions/analyze.ts';
    export { verifyQueryIdentity, loadDataAuthority } from '../../src/lib/intelligence/query/serverAuthority.ts';
    export { createRpcAuditPort } from '../../src/lib/intelligence/query/auditStore.ts';`);
  const bundle=await rolldown({input:entry,platform:'node'}), file=path.join(output,'submission-adapter.cjs');
  try{await bundle.write({file,format:'cjs'});}finally{await bundle.close();}
  const {readSubmissionSnapshot,analyzeSubmissionSnapshot,verifyQueryIdentity,loadDataAuthority,createRpcAuditPort}=createRequire(import.meta.url)(file);
  const caps=[...exportCaps,'query:submission-progress','query:submission-quality'];
  const other=await person('admin','submission-owner');
  const identity=who=>verifyQueryIdentity(new Request('http://127.0.0.1:3289/api/intelligence/query',{headers:{Authorization:'Bearer '+who.token}}),service);
  const signal=()=>new AbortController().signal;
  const read=async(spec={period:null,quality:true},who=queryAdmin,afterRead)=>{
    const verified=await identity(who),authority=await loadDataAuthority(service,verified,signal());
    const audit=createRpcAuditPort(service,verified,{keyId,encryptionKey,digestKey});
    const requestId=randomUUID();
    await audit.receive({requestId,submittedText:'隔离验收：季度填报进度与质量',plan:spec,authority});
    await audit.append(requestId,'running',{entry:'isolated_submission_adapter_verification'});
    // Fault-inject only after a real Data API read; authentication and database are not mocked.
    const readClient=afterRead?{rpc(name,args){const request=service.rpc(name,args);return name==='ai_query_submission_snapshot_read'
      ?{abortSignal:async s=>{const response=await request.abortSignal(s);await afterRead();return response;}}:request;}}:service;
    try{return await readSubmissionSnapshot(readClient,verified,requestId,spec,signal());}
    finally{await audit.append(requestId,'cancelled',{reason:'isolated_adapter_check_finished_without_user_delivery'});}
  };
  const ids=[];
  const assignment=async(b,u)=>{const id=randomUUID();ids.push(id);await db.query(`insert into public.building_assignments(id,building_id,project_name,user_id,user_name) values($1,$2,'合成任务',$3,'同名人员')`,[id,b,u]);return id;};
  const submission=async(b,u,stamp,extra={})=>{const id=randomUUID();ids.push(id);await db.query(`insert into public.quarterly_submissions
    (id,building_id,user_id,user_name,record_year,record_quarter,created_at,total_area,vacant_area,vacancy_rate,asking_rent,management_fee,face_rent,rent_free_period,net_effective_rent)
    values($1,$2,$3,'合成提交者',2026,3,$4,10000,50,0.5,$5,30,120,6,100)`,[id,b,u,stamp,extra.asking===undefined?'10':extra.asking]);return id;};
  const settings=(await db.query("select * from public.app_settings where key in ('current_submission_year','current_submission_quarter')")).rows;
  try{
    await db.query("insert into public.app_settings(key,value) values('current_submission_year','2026'),('current_submission_quarter','3') on conflict(key) do update set value=excluded.value");
    await assignment(BUILDINGS[0],queryAdmin.id);await assignment(BUILDINGS[0],queryAdmin.id);await assignment(BUILDINGS[0],other.id);
    await assignment(BUILDINGS[1],queryAdmin.id);await assignment(BUILDINGS[2],other.id);
    const newest=await submission(BUILDINGS[0],queryAdmin.id,'2026-09-30T00:00:00.000002Z',{asking:null});
    await submission(BUILDINGS[0],queryAdmin.id,'2026-09-30T00:00:00.000001Z');
    await submission(BUILDINGS[1],other.id,'2026-09-30T00:00:00Z');await submission(BUILDINGS[3],other.id,'2026-09-30T00:00:00Z');
    await check('填报只读适配器要求独立资格及已持久化审计，不能借历史查数权读取',async()=>{
      const verified=await identity(queryAdmin);
      await assert.rejects(readSubmissionSnapshot(service,verified,randomUUID(),{period:null,quality:false},signal()),/QUERY_DENIED/);
      await grantQuery({setup:db},queryAdmin.id,{capabilities:caps});
      await assert.rejects(readSubmissionSnapshot(service,verified,randomUUID(),{period:null,quality:false},signal()),/QUERY_DENIED/);
      const authority=await loadDataAuthority(service,verified,signal());
      const denied=await queryAdmin.client.rpc('ai_query_submission_snapshot_read',{p_actor:queryAdmin.id,p_effective:queryAdmin.id,p_session:verified.sessionId,
        p_permission_revision:authority.permissionRevision,p_request_id:randomUUID(),p_year:2026,p_quarter:3,p_quality:false,p_submarkets:null,p_building_ids:null});
      assert.equal(denied.error?.code,'42501');
    });
    await check('真实同快照区分楼宇覆盖、人员任务、重复提交与当前分配，最新整条不补空值',async()=>{
      const raw=await read(), result=analyzeSubmissionSnapshot(raw);
      assert.equal(result.period.quarter,3);assert.equal(result.periodBasis,'configured');
      assert.deepEqual(result.counts,{catalogBuildings:4,assignedBuildings:3,unassignedBuildings:1,submittedBuildings:3,assignedSubmittedBuildings:2,
        missingAssignedBuildings:1,unassignedSubmittedBuildings:1,assignmentPairs:4,submittedOwnerPairs:1,missingOwnerPairs:3,
        duplicateAssignmentRows:1,invalidAssignmentRows:0,rawSubmissions:4,repeatSubmissionRows:1,latestUnresolvedBuildings:0});
      const first=result.rows.find(r=>r.buildingId===BUILDINGS[0]);assert.equal(first.latestSubmissionId,newest);assert.deepEqual(first.quality.missingRequired,['asking_rent']);
      assert.equal(result.people.length,2);assert.equal(result.quality.requiredCompleteBuildings,2);
      assert.ok(!result.rows.some(r=>r.quality?.issues.some(i=>i.code==='stored_percentage_differs_from_areas')));
      assert.ok(result.sources.every(r=>r.table!=='building_metrics'&&r.original===null));
      await db.query('update public.quarterly_submissions set asking_rent=99 where id=$1',[newest]);
      assert.equal(analyzeSubmissionSnapshot(raw).rows.find(r=>r.buildingId===BUILDINGS[0]).quality.requiredComplete,false);
      assert.equal(analyzeSubmissionSnapshot(await read()).rows.find(r=>r.buildingId===BUILDINGS[0]).quality.requiredComplete,true);
      await db.query('update public.quarterly_submissions set asking_rent=null where id=$1',[newest]);
    });
    await check('进度资格不返回填报数值，配置季度未知不猜测；明确季度仍独立可读',async()=>{
      await grantQuery({setup:db},queryAdmin.id,{capabilities:[...exportCaps,'query:submission-progress']});
      const raw=await read({period:null,quality:false});assert.ok(raw.submissions.every(r=>Object.keys(r.values).length===0));
      await assert.rejects(read(),/QUERY_DENIED/);
      await db.query("update public.app_settings set value='未知' where key='current_submission_quarter'");
      await assert.rejects(read({period:null,quality:false}),/SUBMISSION_PERIOD_UNAVAILABLE/);
      const explicit=await read({period:{year:2026,quarter:3},quality:false});assert.equal(explicit.configuredPeriod,null);assert.equal(explicit.submissions.length,4);
      const missing=analyzeSubmissionSnapshot(await read({period:{year:2026,quarter:4},quality:false}));assert.equal(missing.counts.submittedBuildings,0);assert.equal(missing.counts.missingAssignedBuildings,3);
      await db.query("update public.app_settings set value='3' where key='current_submission_quarter'");
      await grantQuery({setup:db},queryAdmin.id,{capabilities:caps});
    });
    await check('填报权限先过滤完整候选；非admin及撤权不能读取，停用和非存量不计入任务',async()=>{
      await grantQuery({setup:db},queryAdmin.id,{capabilities:caps,allBuildings:false,buildingIds:[BUILDINGS[0]]});
      const a=analyzeSubmissionSnapshot(await read());assert.equal(a.counts.catalogBuildings,1);assert.equal(a.counts.rawSubmissions,2);assert.ok(a.sources.every(r=>r.entityId===''||r.entityId===BUILDINGS[0]));
      await assert.rejects(read({period:null,quality:true,buildingIds:[BUILDINGS[1]]}),/QUERY_DENIED/);
      await grantQuery({setup:db},queryAdmin.id,{capabilities:caps});
      await db.query("update public.user_roles set role='viewer' where user_id=$1",[queryAdmin.id]);
      try{await assert.rejects(read(),/QUERY_DENIED/);}finally{await db.query("update public.user_roles set role='admin' where user_id=$1",[queryAdmin.id]);}
      await db.query("update public.buildings set project_type='future' where id=$1",[BUILDINGS[0]]);
      try{assert.equal(analyzeSubmissionSnapshot(await read()).counts.catalogBuildings,3);}finally{await db.query("update public.buildings set project_type='stock' where id=$1",[BUILDINGS[0]]);}
      await grantQuery({setup:db},queryAdmin.id,{capabilities:exportCaps});await assert.rejects(read(),/QUERY_DENIED/);
    });
    await check('超过Data API默认1000行仍完整统计，不因当前权限隐藏的楼宇泄漏分母',async()=>{
      await grantQuery({setup:db},queryAdmin.id,{capabilities:caps});
      const bulk=(await db.query("insert into public.buildings(name,submarket,grade) select '合成完整读取'||n,'合成完整读取','A' from generate_series(1,1205) n returning id")).rows.map(r=>r.id);
      try{
        await db.query("insert into public.building_assignments(building_id,project_name,user_id,user_name) select x,'合成完整读取',$2,'合成负责人' from unnest($1::uuid[]) x",[bulk,queryAdmin.id]);
        await db.query("insert into public.quarterly_submissions(building_id,user_id,user_name,record_year,record_quarter) select x,$2,'合成负责人',2026,3 from unnest($1::uuid[]) x",[bulk.slice(0,1101),queryAdmin.id]);
        const full=analyzeSubmissionSnapshot(await read({period:null,quality:false,submarkets:['合成完整读取']}));
        assert.equal(full.counts.catalogBuildings,1205);assert.equal(full.counts.rawSubmissions,1101);assert.equal(full.counts.missingAssignedBuildings,104);
        assert.deepEqual(full.submittedCoverage,{numerator:'1101',denominator:'1205'});
        await grantQuery({setup:db},queryAdmin.id,{capabilities:caps,allBuildings:false,buildingIds:[bulk[0]]});
        const scoped=analyzeSubmissionSnapshot(await read({period:null,quality:false,submarkets:['合成完整读取']}));
        assert.equal(scoped.counts.catalogBuildings,1);assert.equal(scoped.counts.rawSubmissions,1);
      }finally{await db.query('delete from public.buildings where id=any($1::uuid[])',[bulk]);await grantQuery({setup:db},queryAdmin.id,{capabilities:caps});}
    });
    await check('真实读取完成后撤销填报资格，适配器最终复查拒绝交付已取到的数据',async()=>{
      await assert.rejects(read({period:null,quality:true},queryAdmin,async()=>{
        await grantQuery({setup:db},queryAdmin.id,{capabilities:exportCaps});
      }),/QUERY_DENIED/);
      await grantQuery({setup:db},queryAdmin.id,{capabilities:caps});
      const raw=await read();assert.equal(raw.submissions.length,4);
    });
    await verifySubmissionQueries({db,check,queryAdmin,other,caps,exportCaps,newest,...http});
  }finally{
    await db.query('delete from public.quarterly_submissions where id=any($1::uuid[])',[ids]);
    await db.query('delete from public.building_assignments where id=any($1::uuid[])',[ids]);
    await db.query("delete from public.app_settings where key in ('current_submission_year','current_submission_quarter')");
    for(const s of settings)await db.query('insert into public.app_settings(key,value,updated_at) values($1,$2,$3)',[s.key,s.value,s.updated_at]);
    await grantQuery({setup:db},queryAdmin.id,{capabilities:exportCaps});
  }
}
