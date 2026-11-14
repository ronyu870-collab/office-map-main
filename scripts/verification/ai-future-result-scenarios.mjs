import {grantQuery} from '../../supabase/tests/ai-query-authority/database.mjs';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import * as XLSX from 'xlsx';

/** Real persisted future snapshots/AEAD archives/artifacts; public homepage integration follows separately. */
export async function verifyFutureResults({db,service,check,queryAdmin,identity,grant,ids,buildings,other,latest,api,keyId,encryptionKey,digestKey}){
  const signal=()=>new AbortController().signal;
  const complete=async(view='quality')=>{
    const who=await identity(queryAdmin),authority=await api.loadFutureAuthority(service,who,signal()),requestId=randomUUID();
    const audit=api.createRpcAuditPort(service,who,{keyId,encryptionKey,digestKey});
    const mode=['catalog','launch_summary'].includes(view)?'catalog':['quality','missing_fields','anomalies'].includes(view)?'quality':'progress';
    const selection={view,period:null};
    await audit.receive({requestId,submittedText:'合成验收：未来供应结果与文件',plan:selection,authority});await audit.append(requestId,'running',{entry:'isolated_future_result'});
    const raw=await api.readFutureSnapshot(service,who,requestId,{mode,period:null},signal()),result=api.buildFutureResult(raw,selection,authority,requestId);
    await audit.append(requestId,'response_generated',{result});await audit.append(requestId,'succeeded',{delivery:'not_yet_sent'});
    const refs=result.sources.map(s=>({entity_id:s.table==='app_settings'?null:s.entityId,record_id:s.recordId,source_table:s.table,field:s.field,year:s.period?.year??null,quarter:s.period?.quarter??null}));
    const allowed=async(overrides={})=>{
      const current=await api.loadFutureAuthority(service,who,signal());
      const {data,error}=await service.rpc('ai_query_future_sources_allowed',{p_actor:who.actorId,p_effective:who.effectiveUserId,p_session:who.sessionId,p_request_id:requestId,p_permission_revision:current.permissionRevision,p_sources:refs,...overrides});
      if(error)throw error;return data.allowed;
    };
    const gate=async()=>api.authorizeFutureSources(service,who,requestId,await api.loadFutureAuthority(service,who,signal()),result.sources,signal());
    await gate();return {who,authority,requestId,result,refs,allowed,gate};
  };
  await grant();
  const full=await complete();
  await check('未来结果真实加密归档与XLSX/CSV/SVG复用快照，数据库后改不覆写旧值或日期精度',async()=>{
    const events=(await db.query("select e.*,e.sequence::integer as sequence from private.ai_query_audit_events e where request_id=$1 and kind='response_generated' order by e.sequence",[full.requestId])).rows;
    const archive=api.decodeGeneratedArchive(events,{requestId:full.requestId,actorId:full.who.actorId,effectiveUserId:full.who.effectiveUserId},new Map([[keyId,{encryptionKey,digestKey}]]));
    assert.deepEqual(archive.result,full.result);assert.ok(!('sources' in archive.result.analysis));
    await db.query('update public.future_supply_submissions set vacancy_rate=99 where id=$1',[latest]);
    try{
      await full.gate();const book=XLSX.read(await api.buildXlsx(archive.result),{type:'array'}),rows=XLSX.utils.sheet_to_json(book.Sheets['未来填报质量'],{header:1});
      const column=rows[2].findIndex(c=>String(c).startsWith('填报空置率')),row=rows.slice(3).find(r=>r[0]===ids[0]);assert.equal(row[column],0.5);
      const catalog=XLSX.utils.sheet_to_json(book.Sheets['未来目录'],{header:1});assert.ok(catalog.some(r=>r.includes('2026年下半年（季度未定）')));assert.ok(catalog.some(r=>r.includes('未知：未记录预计年份')));
      const csv=api.buildCsvPackage(archive.result),manifest=JSON.parse(csv.manifest);assert.equal(manifest.resultId,full.result.resultId);assert.deepEqual(manifest.sources,full.result.sources);
      const chart=api.buildResultChart(api.resultViewSchema.parse(archive.result),{kind:'bar',field:'vacancy_rate'});assert.equal(chart.points.find(p=>p.yCell.entityId===ids[0]).y,0.5);assert.ok(api.renderChartSvg(chart).includes(full.result.resultId));
    }finally{await db.query('update public.future_supply_submissions set vacancy_rate=0.5 where id=$1',[latest]);}
  });
  await check('未来来源字段/归属/期间伪造与普通角色、他人、无成功审计或浏览器直调均拒绝',async()=>{
    const source=full.refs.find(r=>r.source_table==='future_supply_submissions');
    for(const forged of [{...source,field:'notes'},{...source,quarter:2},{...source,entity_id:ids[2]},{...source,source_table:'quarterly_submissions'}])assert.equal(await full.allowed({p_sources:[forged]}),false);
    assert.equal(await full.allowed({p_request_id:randomUUID()}),false);assert.equal(await full.allowed({p_permission_revision:'0'.repeat(64)}),false);
    await grantQuery({setup:db},other.id,{capabilities:['query:future-catalog','query:future-progress','query:future-quality'],allBuildings:false});
    await db.query('update private.ai_query_grants set all_future_supplies=true where user_id=$1',[other.id]);
    const otherId=await identity(other),otherAuthority=await api.loadFutureAuthority(service,otherId,signal());assert.equal(await full.allowed({p_actor:otherId.actorId,p_effective:otherId.effectiveUserId,p_session:otherId.sessionId,p_permission_revision:otherAuthority.permissionRevision}),false);
    for(const role of ['viewer','editor']){await db.query('update public.user_roles set role=$1 where user_id=$2',[role,queryAdmin.id]);try{await assert.rejects(full.gate(),/QUERY_DENIED/);}finally{await db.query("update public.user_roles set role='admin' where user_id=$1",[queryAdmin.id]);}}
    assert.equal((await queryAdmin.client.rpc('ai_query_future_sources_allowed',{p_actor:full.who.actorId,p_effective:full.who.effectiveUserId,p_session:full.who.sessionId,p_request_id:full.requestId,p_permission_revision:full.authority.permissionRevision,p_sources:[]})).error?.code,'42501');
    const acl=(await db.query("select n.nspname,p.prosecdef,p.proconfig,has_function_privilege('anon',p.oid,'execute') anon,has_function_privilege('authenticated',p.oid,'execute') authenticated,has_function_privilege('service_role',p.oid,'execute') service from pg_proc p join pg_namespace n on n.oid=p.pronamespace where p.proname='ai_query_future_sources_allowed'")).rows;
    assert.equal(acl.length,2);for(const f of acl){assert.equal(f.anon,false);assert.equal(f.authenticated,false);assert.equal(f.service,true);assert.equal(f.prosecdef,f.nspname==='private');assert.ok(f.proconfig.includes('search_path=""'));}
    const outcomes=(await db.query("select distinct outcome from private.ai_query_result_access where request_id=$1 and action='sources'",[full.requestId])).rows.map(r=>r.outcome);assert.ok(outcomes.includes('allowed'));assert.ok(outcomes.includes('denied'));
  });
  await check('未来记录入市/关联转存量/任务或提交改期/配置删除立即撤回旧来源，恢复条件后仍用旧快照',async()=>{
    await db.query('update public.future_supplies set is_entered_market=true where id=$1',[ids[0]]);assert.equal(await full.allowed(),false);await db.query('update public.future_supplies set is_entered_market=false where id=$1',[ids[0]]);
    await db.query("update public.buildings set project_type='stock' where id=$1",[buildings[0]]);assert.equal(await full.allowed(),false);await db.query("update public.buildings set project_type='future' where id=$1",[buildings[0]]);
    const assignment=full.refs.find(r=>r.source_table==='future_supply_assignments');
    await db.query('update public.future_supply_assignments set record_quarter=4 where id=$1',[assignment.record_id]);assert.equal(await full.allowed(),false);await db.query('update public.future_supply_assignments set record_quarter=3 where id=$1',[assignment.record_id]);
    await db.query('update public.future_supply_submissions set record_quarter=4 where id=$1',[latest]);assert.equal(await full.allowed(),false);await db.query('update public.future_supply_submissions set record_quarter=3 where id=$1',[latest]);
    const config=(await db.query("delete from public.app_settings where key='current_submission_quarter' returning *")).rows[0];assert.equal(await full.allowed(),false);
    await db.query('insert into public.app_settings(key,value,updated_at) values($1,$2,$3)',[config.key,config.value,config.updated_at]);assert.equal(await full.allowed(),true);
  });
  await check('未来目录/进度不能借结果投影读取人员/质量，撤回字段资格或缩小实体范围拒绝旧来源',async()=>{
    const catalog=await complete('catalog'),progress=await complete('summary');
    await grant(['query:future-catalog','query:future-progress']);await progress.gate();await assert.rejects(full.gate(),/QUERY_DENIED/);
    let book=XLSX.read(await api.buildXlsx(progress.result),{type:'array'});assert.ok(!book.SheetNames.includes('未来填报质量'));
    await grant(['query:future-catalog']);await catalog.gate();await assert.rejects(progress.gate(),/QUERY_DENIED/);
    book=XLSX.read(await api.buildXlsx(catalog.result),{type:'array'});assert.ok(!book.SheetNames.includes('未来人员任务'));
    await grant(undefined,{all:false,ids:[ids[0]]});await assert.rejects(catalog.gate(),/QUERY_DENIED/);await grant();
    assert.equal((await db.query('select private.ai_query_audit_verify(request_id,head_hash,head_sequence) valid from private.ai_query_audit_streams where request_id=$1',[full.requestId])).rows[0].valid,true);
  });
}
