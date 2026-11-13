import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFile,writeFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import path from 'node:path';
import {rolldown} from 'rolldown';
import {grantQuery} from '../../supabase/tests/ai-query-authority/database.mjs';
import {BUILDINGS} from '../../supabase/tests/ai-query-authority/snapshot-fixture.mjs';

export async function setupFutureObservation(db){
  if(!(await db.query("select to_regclass('public.future_supplies') t")).rows[0].t){
    const source=await readFile('supabase/migrations/20260801110130_restore_quarterly_oss_admin.sql','utf8');
    const ddl=source.slice(source.indexOf('create table public.future_supplies ('),source.indexOf('create table public.building_current_data ('));
    assert.ok(ddl.includes('create table public.future_supply_submissions'));await db.query(ddl);
    await db.query(`alter table public.future_supplies add column building_id uuid references public.buildings(id) on delete restrict;
      create unique index future_supplies_building_identity_unique on public.future_supplies(building_id) where building_id is not null;
      create unique index future_supply_assignments_period_owner_uidx on public.future_supply_assignments(future_supply_id,user_id,record_year,record_quarter);
      alter table public.future_supplies add constraint future_supplies_launch_quarter_valid check(launch_quarter is null or launch_quarter in ('Q1','Q2','Q3','Q4','H1','H2'));
      alter table public.future_supplies enable row level security;alter table public.future_supply_assignments enable row level security;alter table public.future_supply_submissions enable row level security;
      revoke all on public.future_supplies,public.future_supply_assignments,public.future_supply_submissions from public,anon,authenticated,service_role;`);
  }
  await db.query(await readFile('supabase/migrations/20261113213152_ai_future_observation.sql','utf8'));
}

export async function verifyFutureObservation({db,service,check,queryAdmin,person,call,exportCaps,output,keyId,encryptionKey,digestKey}){
  const entry=path.join(output,'future-entry.mjs'),file=path.join(output,'future-adapter.cjs');
  await writeFile(entry,`export {readFutureSnapshot,loadFutureAuthority} from '../../src/lib/intelligence/query/future/reader.ts';
    export {analyzeFutureSnapshot} from '../../src/lib/intelligence/query/future/analyze.ts';
    export {verifyQueryIdentity,loadDataAuthority} from '../../src/lib/intelligence/query/serverAuthority.ts';
    export {createRpcAuditPort} from '../../src/lib/intelligence/query/auditStore.ts';`);
  const bundle=await rolldown({input:entry,platform:'node'});try{await bundle.write({file,format:'cjs'});}finally{await bundle.close();}
  const {readFutureSnapshot,loadFutureAuthority,analyzeFutureSnapshot,verifyQueryIdentity,loadDataAuthority,createRpcAuditPort}=createRequire(import.meta.url)(file);
  const futureCaps=['query:future-catalog','query:future-progress','query:future-quality'];
  const sig=()=>new AbortController().signal;
  const identity=who=>verifyQueryIdentity(new Request('http://127.0.0.1:3289/api/intelligence/query',{headers:{Authorization:'Bearer '+who.token}}),service);
  const grant=async(caps=futureCaps,scope={})=>{await grantQuery({setup:db},queryAdmin.id,{capabilities:caps,allBuildings:scope.stock??false});await db.query('update private.ai_query_grants set all_future_supplies=$2,future_supply_ids=$3 where user_id=$1',[queryAdmin.id,scope.all??true,scope.ids??[]]);};
  const read=async(spec={mode:'quality',period:null},afterRead)=>{
    const who=await identity(queryAdmin),authority=await loadFutureAuthority(service,who,sig()),audit=createRpcAuditPort(service,who,{keyId,encryptionKey,digestKey}),requestId=randomUUID();
    await audit.receive({requestId,submittedText:'隔离验收：未来供应与季度任务',plan:spec,authority});await audit.append(requestId,'running',{entry:'isolated_future_adapter'});
    const client=afterRead?{rpc(name,args){const r=service.rpc(name,args);return name==='ai_query_future_snapshot_read'?{abortSignal:async s=>{const response=await r.abortSignal(s);await afterRead();return response;}}:r;}}:service;
    try{return await readFutureSnapshot(client,who,requestId,spec,sig());}finally{await audit.append(requestId,'cancelled',{reason:'isolated_adapter_check_finished_without_user_delivery'});}
  };
  const other=await person('admin','future-owner'),ids=Array.from({length:9},()=>randomUUID()),buildings=[randomUUID(),randomUUID()];
  const settings=(await db.query("select * from public.app_settings where key in ('current_submission_year','current_submission_quarter')")).rows;
  let latest;
  try{
    await db.query("insert into public.app_settings(key,value) values('current_submission_year','2026'),('current_submission_quarter','3') on conflict(key) do update set value=excluded.value");
    await db.query("insert into public.buildings(id,name,submarket,grade,project_type,is_active) values($1,'合成未来关联','CBD','A','future',true),($2,'合成未来停用','CBD','A','future',false)",[...buildings]);
    for(let i=0;i<ids.length;i++)await db.query(`insert into public.future_supplies(id,name,submarket,grade,launch_year,launch_quarter,total_area,location_lng,location_lat,status,is_entered_market,building_id,completion_year,notes,contact_phone)
      values($1,'同名合成未来项目','CBD','A',$2,$3,10000,116.4,39.9,$4,$5,$6,2025,'不可读取的内部备注','不可读取的联系方式')`,[ids[i],i===3?null:'2026',['Q3','H2',null,'Q3','Q4','Q3','Q3','Q3','Q3'][i],i===2?'pending':'future',i===5?true:i===6?null:false,i===4?buildings[0]:i===7?BUILDINGS[0]:i===8?buildings[1]:null]);
    for(const [f,u,q] of [[0,queryAdmin.id,3],[0,other.id,3],[1,queryAdmin.id,3],[2,other.id,3],[1,queryAdmin.id,2]])await db.query('insert into public.future_supply_assignments(future_supply_id,user_id,user_name,record_year,record_quarter) values($1,$2,$3,2026,$4)',[ids[f],u,'同名合成人员',q]);
    for(const [f,u,micro,asking] of [[0,queryAdmin.id,'000002',null],[0,queryAdmin.id,'000001',10],[1,other.id,'000000',10],[3,null,'000000',10]]){
      const row=await db.query(`insert into public.future_supply_submissions(future_supply_id,user_id,user_name,record_year,record_quarter,created_at,total_area,vacant_area,vacancy_rate,asking_rent,management_fee,face_rent,rent_free_period,net_effective_rent,notes)
        values($1,$2,'提交时姓名',2026,3,$3,10000,50,0.5,$4,30,120,6,100,'内部备注不能读取') returning id`,[ids[f],u,`2026-09-30T00:00:00.${micro}Z`,asking]);if(f===0&&micro==='000002')latest=row.rows[0].id;
    }
    await check('未来供应资格和实体范围默认不继承存量权限，未来专用账号也不借权查存量',async()=>{
      const who=await identity(queryAdmin);await assert.rejects(loadFutureAuthority(service,who,sig()),/QUERY_DENIED/);
      await grant(futureCaps,{all:false,ids:[]});await assert.rejects(loadFutureAuthority(service,who,sig()),/QUERY_DENIED/);
      await grant();assert.equal((await loadFutureAuthority(service,who,sig())).allFutureSupplies,true);await assert.rejects(loadDataAuthority(service,who,sig()),/QUERY_DENIED/);
      assert.equal((await call(queryAdmin)).status,403);
      await grant([...exportCaps,...futureCaps],{stock:true});assert.equal((await call(queryAdmin)).status,200);await grant();
    });
    await check('未来目录真实完整读取保留半年/未知与pending，排除已入市、状态未知及关联存量/停用',async()=>{
      const raw=await read({mode:'catalog',period:null}),a=analyzeFutureSnapshot(raw);assert.equal(a.catalog.records,5);assert.equal(a.catalog.pending,1);assert.equal(a.catalog.launchUnknown,1);assert.equal(a.catalog.launchHalfYear,1);
      assert.equal(raw.assignments.length,0);assert.equal(raw.submissions.length,0);assert.equal(a.progress,null);assert.equal(a.catalog.unlinkedIdentities,4);
      assert.ok(raw.supplies.every(r=>!Object.hasOwn(r,'notes')&&!Object.hasOwn(r,'contact_phone')));
      await db.query("update public.future_supplies set notes='隐私变更不影响可见字段版本' where id=$1",[ids[0]]);
      assert.equal((await read({mode:'catalog',period:null})).supplies.find(r=>r.id===ids[0]).version,raw.supplies.find(r=>r.id===ids[0]).version);
      assert.ok(a.sources.every(r=>r.table==='future_supplies'&&r.original===null));
    });
    await check('未来季度任务按期间分配，跨季预计入市和半年任务仍保留；真实质量复用原百分数与整条选择',async()=>{
      const raw=await read(),a=analyzeFutureSnapshot(raw);assert.equal(raw.assignments.length,4);assert.equal(raw.submissions.length,4);
      assert.deepEqual(a.progress.coverage,{numerator:'2',denominator:'3'});assert.equal(a.progress.assignmentPairs,4);assert.equal(a.progress.submittedOwnerPairs,1);assert.equal(a.progress.unknownSubmitterRows,1);
      assert.equal(a.rows.find(r=>r.futureId===ids[0]).latestSubmissionId,latest);assert.deepEqual(a.rows.find(r=>r.futureId===ids[0]).quality.missingRequired,['asking_rent']);
      assert.ok(a.rows.every(r=>!r.quality?.issues.some(i=>i.code==='stored_percentage_differs_from_areas')));
      assert.ok(a.sources.filter(r=>r.table==='future_supply_assignments').every(r=>r.period.quarter===3));assert.equal(a.people.length,2);
      await db.query('update public.future_supply_submissions set asking_rent=99 where id=$1',[latest]);assert.equal(analyzeFutureSnapshot(raw).rows.find(r=>r.futureId===ids[0]).quality.requiredComplete,false);
      await db.query('update public.future_supply_submissions set asking_rent=null where id=$1',[latest]);
    });
    await check('未来进度不读取数值和隐藏哈希；配置未知明确不可确定，指定季度与目录仍可读取',async()=>{
      await grant(['query:future-catalog','query:future-progress']);const raw=await read({mode:'progress',period:null});assert.ok(raw.submissions.every(r=>Object.keys(r.values).length===0));await assert.rejects(read(),/QUERY_DENIED/);
      await db.query('update public.future_supply_submissions set asking_rent=99 where id=$1',[latest]);assert.equal((await read({mode:'progress',period:null})).submissions.find(r=>r.id===latest).version,raw.submissions.find(r=>r.id===latest).version);
      await db.query("update public.app_settings set value='未知' where key='current_submission_quarter'");
      try{await assert.rejects(read({mode:'progress',period:null}),/SUBMISSION_PERIOD_UNAVAILABLE/);assert.equal((await read({mode:'catalog',period:null})).supplies.length,5);assert.equal((await read({mode:'progress',period:{year:2026,quarter:2}})).assignments.length,1);}
      finally{await db.query("update public.app_settings set value='3' where key='current_submission_quarter'");await db.query('update public.future_supply_submissions set asking_rent=null where id=$1',[latest]);await grant();}
    });
    await check('未来实体范围先过滤全集，普通角色持全资格、模拟本人、缺持久审计和直调RPC均拒绝',async()=>{
      await grant(futureCaps,{all:false,ids:[ids[0]]});const raw=await read();assert.equal(raw.supplies.length,1);assert.equal(raw.assignments.length,2);assert.ok(analyzeFutureSnapshot(raw).sources.every(r=>r.entityId===''||r.entityId===ids[0]));
      await assert.rejects(read({mode:'quality',period:null,futureIds:[ids[1]]}),/QUERY_DENIED/);await grant();
      const who=await identity(queryAdmin);await assert.rejects(readFutureSnapshot(service,who,randomUUID(),{mode:'catalog',period:null},sig()),/QUERY_DENIED/);
      for(const role of ['viewer','editor']){await db.query('update public.user_roles set role=$1 where user_id=$2',[role,queryAdmin.id]);try{await assert.rejects(read(),/QUERY_DENIED/);}finally{await db.query("update public.user_roles set role='admin' where user_id=$1",[queryAdmin.id]);}}
      await assert.rejects(verifyQueryIdentity(new Request('http://127.0.0.1:3289/',{headers:{Authorization:'Bearer '+queryAdmin.token,'X-Colliers-Impersonate-User':queryAdmin.id}}),service),/QUERY_UNAUTHENTICATED/);
      assert.equal((await queryAdmin.client.rpc('ai_query_future_authority',{p_actor:who.actorId,p_effective:who.effectiveUserId,p_session:who.sessionId})).error?.code,'42501');
      assert.ok((await queryAdmin.client.from('future_supplies').select('*')).error);
      const functions=(await db.query("select n.nspname,p.proname,p.prosecdef,p.proconfig,has_function_privilege('anon',p.oid,'execute') anon,has_function_privilege('authenticated',p.oid,'execute') authenticated,has_function_privilege('service_role',p.oid,'execute') service from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('public','private') and p.proname in ('ai_query_future_authority','ai_query_future_snapshot_read','ai_query_principal')")).rows;
      assert.equal(functions.length,5);for(const f of functions){assert.equal(f.anon,false);assert.equal(f.authenticated,false);assert.equal(f.service,f.proname!=='ai_query_principal');assert.equal(f.prosecdef,f.nspname==='private');assert.ok(f.proconfig.includes('search_path=""'));}
    });
    await check('未来供应超过1000行完整读回，单条范围不会泄漏范围外目录分母',async()=>{
      const bulk=(await db.query("insert into public.future_supplies(name,submarket,grade,launch_year,launch_quarter,total_area,location_lng,location_lat) select '合成完整未来'||n,'合成完整未来','A','2027','H1',10000,116.4,39.9 from generate_series(1,1205) n returning id")).rows.map(r=>r.id);
      try{const full=analyzeFutureSnapshot(await read({mode:'catalog',period:null,submarkets:['合成完整未来']}));assert.equal(full.catalog.records,1205);assert.equal(full.catalog.launchHalfYear,1205);
        await grant(futureCaps,{all:false,ids:[bulk[0]]});assert.equal(analyzeFutureSnapshot(await read({mode:'catalog',period:null,submarkets:['合成完整未来']})).catalog.records,1);
      }finally{await db.query('delete from public.future_supplies where id=any($1::uuid[])',[bulk]);await grant();}
    });
    await check('真实未来快照读取后撤销资格或范围，最终授权复查阻止交付已读取数据',async()=>{
      await assert.rejects(read({mode:'quality',period:null},async()=>{await grant(['query:future-catalog']);}),/QUERY_DENIED/);await grant();
      await assert.rejects(read({mode:'catalog',period:null},async()=>{await grant(futureCaps,{all:false,ids:[]});}),/QUERY_DENIED/);await grant();
      await db.query("update public.buildings set project_type='stock' where id=$1",[buildings[0]]);assert.equal((await read({mode:'catalog',period:null})).supplies.length,4);
      await db.query("update public.buildings set project_type='future' where id=$1",[buildings[0]]);
    });
  }finally{
    await db.query('delete from public.future_supplies where id=any($1::uuid[])',[ids]);await db.query('delete from public.buildings where id=any($1::uuid[])',[buildings]);
    await db.query("delete from public.app_settings where key in ('current_submission_year','current_submission_quarter')");for(const r of settings)await db.query('insert into public.app_settings(key,value,updated_at) values($1,$2,$3)',[r.key,r.value,r.updated_at]);
    await grantQuery({setup:db},queryAdmin.id,{capabilities:exportCaps});await db.query("update private.ai_query_grants set all_future_supplies=false,future_supply_ids='{}' where user_id=$1",[queryAdmin.id]);
  }
}
