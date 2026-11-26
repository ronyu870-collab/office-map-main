import {execFileSync} from 'node:child_process';
import assert from 'node:assert/strict';
import { mkdir,writeFile,readFile } from 'node:fs/promises';
import { createLeaseTestDatabase, OWNER, ADMIN } from '../lease-change-history/database.mjs';
import { assessLatencyBudget, assertLatencyBudgets, withLatencyRecheck, writeLatencyEvidence } from './latency-budget.mjs';

async function verifyAudit2(attempt) {
const db = await createLeaseTestDatabase();
let passed=0;
const check=async(name,run)=>{await run();passed++;console.log('PASS '+name);};
try {
 // Match Supabase's actual service_role, which bypasses RLS. This is a disposable role.
 await db.setup.query('alter role service_role bypassrls');
 await db.repair();
 await db.setup.query('alter table public.audit_logs add column actor_kind text,add column actor_name text,add column error_message text');
 await db.setup.query('alter table public.user_roles add column full_name text,add column email text');
 await db.setup.query(`create table public.building_metrics(id bigint generated always as identity primary key,building_id uuid,record_year integer,record_quarter integer,total_area double precision,asking_rent double precision,management_fee double precision,face_rent double precision,rent_free_period double precision,net_effective_rent double precision,vacancy_rate double precision,vacant_area double precision,is_locked boolean)`);
 await db.setup.query('create table public.quarterly_submission_provenance(user_id uuid,request_id uuid,entity_kind text,entity_id uuid,submission_id uuid,record_year integer,record_quarter integer,submitted_at timestamptz,submitted_payload jsonb)');
 await db.setup.query('create table public.app_settings(key text primary key,value text)');
 await db.setup.query(`create table public.auth_session_audit_context(auth_session_id uuid primary key,user_id uuid not null,last_seen_at timestamptz not null default now(),application_ip_address text,application_user_agent text,client_device_id text,ip_country text,ip_region text,ip_city text,browser_name text,browser_version text,os_name text,os_version text,device_type text)`);
 await db.setup.query('grant usage on schema public to service_role; grant insert on public.audit_logs to service_role; grant usage on sequence public.audit_logs_id_seq to service_role');
 await db.setup.query('create policy "test service insert" on public.audit_logs for insert to service_role with check(true)');
 await db.setup.query('grant select,insert,update on public.auth_session_audit_context to service_role');
 await db.setup.query('create table public.buildings(id uuid primary key default gen_random_uuid(),name text,is_active boolean default true,tracking_scope text,leasable_area numeric,grade text,submarket text)');
 await db.setup.query('alter table public.buildings enable row level security;grant select,insert,update,delete on public.buildings to authenticated');
 await db.setup.query('create policy "test admin buildings" on public.buildings to authenticated using((select private.is_admin())) with check((select private.is_admin()))');
 const actorMigration=await readFile(new URL('../../migrations/20261102063824_audit_actor_identity.sql',import.meta.url),'utf8');
 await db.setup.query(actorMigration.slice(actorMigration.indexOf('create function private.snapshot_audit_actor()'),actorMigration.indexOf('-- Classify existing rows')));
 const backendPid=(await db.setup.query('select pg_backend_pid() as pid')).rows[0].pid;
 const tickRate=process.platform==='linux'?Number(execFileSync('getconf',['CLK_TCK'],{encoding:'utf8'})):null;
 const cpuSeconds=async()=>{
  // The disposable CI database runs in a separate PID namespace. Read from
  // the measured backend itself, never interpret its PID on the runner host.
  if(tickRate){const stat=(await db.setup.query("select pg_read_file('/proc/self/stat',0,4096) as stat")).rows[0].stat;const fields=stat.slice(stat.lastIndexOf(')')+2).split(' ');const seconds=(Number(fields[11])+Number(fields[12]))/tickRate;assert.ok(Number.isFinite(seconds),'PostgreSQL backend CPU sample must be readable');return seconds;}
  return execFileSync('ps',['-p',String(backendPid),'-o','time='],{encoding:'utf8'}).trim().split(':').map(Number).reduce((seconds,part)=>seconds*60+part,0);
 };
 const measure=async(run,prepare=async()=>undefined)=>{
  const cpuBefore=await cpuSeconds();
  const samples=[];for(let i=0;i<110;i++){await prepare(i);const start=performance.now();await run(i);if(i>=10)samples.push(performance.now()-start);}
  samples.sort((a,b)=>a-b);return {samples:100,p95Ms:samples[94],medianMs:samples[49],backendCpuMs:((await cpuSeconds())-cpuBefore)*1000,meanMs:samples.reduce((a,b)=>a+b,0)/samples.length};
 };
 const businessBench=async()=>({
  ordinaryRead:await measure(()=>db.asUser(ADMIN,'select id,name from public.buildings order by name limit 50')),
  leaseInsert:await measure(()=>db.asUser(OWNER,"insert into public.lease_transactions(company,area_sqm,submitter_id,data_source) values('Synthetic',100,$1,'broker_submission')",[OWNER])),
  leaseUpdate:await measure(i=>db.asUser(OWNER,"update public.lease_transactions set area_sqm=$1 where id='55555555-5555-4555-8555-000000000001'",[500+i])),
  leaseDelete:await measure(()=>db.asUser(OWNER,"delete from public.lease_transactions where company='Synthetic delete'"),()=>db.asUser(OWNER,"insert into public.lease_transactions(company,submitter_id,data_source) values('Synthetic delete',$1,'broker_submission')",[OWNER])),
 });
 const auditBatch=()=>measure(()=>db.setup.query(`insert into public.audit_logs(user_id,action_type,event_id,details) select '${ADMIN}','VIEW_BUILDING',gen_random_uuid()::text,'{}'::jsonb from generate_series(1,20) on conflict(event_id) do nothing`));
 const beforeAuditBatch=await auditBatch();
 const beforeBusiness=await businessBench();
 await db.setup.query(`insert into public.audit_logs(user_id,action_type,target_table,target_id,occurred_at,details)
 select '${ADMIN}','VIEW_BUILDING','buildings',n::text,now()-n*interval '1 minute',jsonb_build_object('synthetic',repeat('x',512)) from generate_series(1,40000) n`);
 await db.setup.query('analyze public.audit_logs');
 const explain=async(sql)=>(await db.asUser(ADMIN,'explain(analyze,buffers,format json) '+sql)).rows[0]['QUERY PLAN'][0];
 const listQuery='select id,user_id,action_type,occurred_at,target_name,module,actor_name from public.audit_logs order by occurred_at desc,id desc limit 51';
 const beforeQuery=await explain(listQuery);
 const benchmark=async()=>{
  const cpuBefore=await cpuSeconds();
  const samples=[];
  for(let i=0;i<110;i++) {
   const start=performance.now();
   await db.asUser(ADMIN,`with b as (insert into public.buildings(name,leasable_area) values('Synthetic',100) returning id) select id from b`);
   if(i>=10)samples.push(performance.now()-start);
  }
  samples.sort((a,b)=>a-b);return {samples:100,p95Ms:samples[94],medianMs:samples[49],backendCpuMs:((await cpuSeconds())-cpuBefore)*1000,meanMs:samples.reduce((a,b)=>a+b,0)/samples.length};
 };
 const before=await benchmark();
 await db.setup.query('truncate public.buildings,public.audit_logs');
 // Same behavioral assertion fails on the original schema, before applying the new triggers.
 const baseline=(await db.asUser(ADMIN,"insert into public.buildings(name) values('baseline') returning id")).rows[0];
 assert.equal((await db.setup.query('select count(*)::int n from public.audit_logs')).rows[0].n,0);
 await db.setup.query('truncate public.buildings,public.audit_logs');
 for(const table of ['quarterly_submissions','future_supply_submissions','building_current_data','building_display_overrides','building_assignments','future_supply_assignments','future_supplies','notices','changelog']) {
  await db.setup.query(`create table if not exists public.${table}(id uuid default gen_random_uuid(),building_id uuid,user_id uuid,record_year integer,record_quarter integer,total_area numeric)`);
 }
 await db.setup.query(await readFile(new URL('../../migrations/20261121105118_audit_2_query_and_session_governance.sql',import.meta.url),'utf8'));
 await db.setup.query(await readFile(new URL('../../migrations/20261121140949_fix_audit_export_role_check.sql',import.meta.url),'utf8'));
 await mkdir('verification/audit-2',{recursive:true});
 const operation='aaaaaaaa-1111-4111-8111-111111111111';
 const after=await benchmark();
 const afterBusiness=await businessBench();
 const afterAuditBatch=await auditBatch();
 const latency=[...Object.keys(beforeBusiness).map(key=>assessLatencyBudget(key,beforeBusiness[key],afterBusiness[key])),assessLatencyBudget('buildingInsert',before,after)];
 // Save P95/median/backend CPU and all budget results even when a later assertion fails.
 await writeLatencyEvidence('postgres-performance',attempt,{version:db.version,path:'authenticated PostgreSQL transactions; 10 warmup +100 measured; localhost only',before,after,beforeBusiness,afterBusiness,beforeAuditBatch,afterAuditBatch,latency});
 await db.setup.query(`insert into public.audit_logs(user_id,action_type,target_table,target_id,occurred_at,details) select '${ADMIN}','VIEW_BUILDING','buildings',n::text,now()-n*interval '1 minute',jsonb_build_object('synthetic',repeat('x',512)) from generate_series(1,40000) n`);
 await db.setup.query('analyze public.audit_logs');
 const afterQuery=await explain(listQuery);
 await writeFile('verification/audit-2/query-plan.json',JSON.stringify({environment:'PostgreSQL 17 synthetic 40000 summary rows, authenticated admin/RLS; no production EXPLAIN ANALYZE writes',query:listQuery,before:beforeQuery,after:afterQuery},null,2));
 // Do not abort the real reliability/RLS/rollback checks on timing noise.
 // The strict original timing budgets are checked after every functional assertion.
 console.log(JSON.stringify({path:'actual building INSERT through authenticated role and RLS; local PostgreSQL 17, 10 warmup +100 measured',attempt,before,after,addedP95Ms:after.p95Ms-before.p95Ms}));
 await db.setup.query('truncate public.buildings,public.audit_logs');
 await check('critical insert/update/delete, no-op and audit-failure rollback execute through real RLS',async()=>{
  const row=(await db.asUser(ADMIN,"insert into public.buildings(name,leasable_area) values('Synthetic',100) returning id")).rows[0];
  assert.equal((await db.setup.query("select count(*)::int n from public.audit_logs where action_type='BUILDING_INSERT'")).rows[0].n,1);
  await db.asUser(ADMIN,'update public.buildings set leasable_area=110 where id=$1',[row.id]);
  const audit=(await db.setup.query("select * from public.audit_logs where action_type='BUILDING_UPDATE' order by id desc limit 1")).rows[0];
  assert.equal(audit.user_id,ADMIN);assert.deepEqual(audit.old_values,{leasable_area:100});assert.deepEqual(audit.new_values,{leasable_area:110});
  await db.asUser(ADMIN,'update public.buildings set leasable_area=110 where id=$1',[row.id]);
  assert.equal((await db.setup.query("select count(*)::int n from public.audit_logs where action_type='BUILDING_UPDATE'")).rows[0].n,1);
  await db.setup.query("alter table public.audit_logs add constraint synthetic_audit_failure check(action_type<>'BUILDING_UPDATE') not valid");
  await assert.rejects(db.asUser(ADMIN,'update public.buildings set leasable_area=120 where id=$1',[row.id]),e=>e.code==='23514');
  assert.equal(Number((await db.setup.query('select leasable_area from public.buildings where id=$1',[row.id])).rows[0].leasable_area),110);
  await db.setup.query('alter table public.audit_logs drop constraint synthetic_audit_failure');
  await db.asUser(ADMIN,'delete from public.buildings where id=$1',[row.id]);
  assert.equal((await db.setup.query("select count(*)::int n from public.audit_logs where action_type='BUILDING_DELETE'")).rows[0].n,1);
  await assert.rejects(db.asUser(OWNER,"insert into public.buildings(name) values('denied')"),e=>e.code==='42501');
 });
 await check('durable intent exists without claiming an operation success',async()=>{
  await db.setup.query("insert into public.audit_operation_receipts(id,actor_id,action_type) values($1,$2,'CREATE_USER')",[operation,ADMIN]);
  assert.equal((await db.setup.query('select state from public.audit_operation_receipts where id=$1',[operation])).rows[0].state,'pending');
  assert.equal((await db.setup.query("select count(*)::int n from public.audit_logs where action_type='CREATE_USER'")).rows[0].n,0);
 });
 await check('terminal evidence and receipt are atomic, retryable and outcome-conflict protected',async()=>{
  await db.setup.query('begin');
  await db.setup.query("select public.audit_complete_operation($1,'success')",[operation]);
  await db.setup.query('rollback');
  assert.equal((await db.setup.query('select state from public.audit_operation_receipts where id=$1',[operation])).rows[0].state,'pending');
  for(let i=0;i<2;i++) await db.setup.query("select public.audit_complete_operation($1,'success')",[operation]);
  assert.equal((await db.setup.query('select count(*)::int n from public.audit_logs where event_id=$1',[operation])).rows[0].n,1);
  await assert.rejects(db.setup.query("select public.audit_complete_operation($1,'failed')",[operation]),e=>e.code==='22023');
 });
 await check('service role executes the real completion path with least privilege',async()=>{
  await db.setup.query('begin');
  await db.setup.query('set local role service_role');
  const id='bbbbbbbb-1111-4111-8111-111111111111';
  await db.setup.query("insert into public.audit_operation_receipts(id,actor_id,action_type) values($1,$2,'CHANGE_PASSWORD')",[id,ADMIN]);
  await db.setup.query("select public.audit_complete_operation($1,'failed')",[id]);
  await db.setup.query('commit');
 });
 await check('ordinary callers cannot forge critical receipts or complete another operation',async()=>{
  await assert.rejects(db.asUser(OWNER,"insert into public.audit_operation_receipts(id,actor_id,action_type) values(gen_random_uuid(),$1,'CREATE_USER')",[ADMIN]),e=>e.code==='42501');
  await assert.rejects(db.asUser(ADMIN,"select public.audit_complete_operation($1,'success')",[operation]),e=>e.code==='42501');
  assert.equal((await db.asUser(OWNER,'select * from public.audit_operation_receipts')).rowCount,0);
  assert.ok((await db.asUser(ADMIN,'select * from public.audit_operation_receipts')).rowCount>0);
 });
 await check('session fallback skips unchanged writes, updates changed context and prevents actor reassignment',async()=>{
  const snapshot={auth_session_id:operation,user_id:OWNER,application_ip_address:'192.0.2.1',application_user_agent:'Synthetic',client_device_id:'device'};
  await db.setup.query('select public.audit_touch_session($1)',[snapshot]);
  const first=(await db.setup.query('select xmin::text from public.auth_session_audit_context')).rows[0].xmin;
  await db.setup.query('select public.audit_touch_session($1)',[snapshot]);
  assert.equal((await db.setup.query('select xmin::text from public.auth_session_audit_context')).rows[0].xmin,first);
  await db.setup.query('select public.audit_touch_session($1)',[{...snapshot,application_ip_address:'192.0.2.2'}]);
  assert.notEqual((await db.setup.query('select xmin::text from public.auth_session_audit_context')).rows[0].xmin,first);
  await db.setup.query('select public.audit_touch_session($1)',[{...snapshot,user_id:ADMIN}]);
  assert.equal((await db.setup.query('select user_id from public.auth_session_audit_context')).rows[0].user_id,OWNER);
  await assert.rejects(db.asUser(ADMIN,'select public.audit_touch_session($1)',[snapshot]),e=>e.code==='42501');
 });
 await check('metric diffs and safe configuration are transactional, sensitive settings are excluded',async()=>{
  const b='cccccccc-1111-4111-8111-111111111111';
  await db.setup.query('insert into public.building_metrics(building_id,record_year,record_quarter,net_effective_rent,vacant_area) values($1,2026,3,100,1000)',[b]);
  await db.setup.query('update public.building_metrics set net_effective_rent=110,vacant_area=900 where building_id=$1',[b]);
  const metric=(await db.setup.query("select * from public.audit_logs where action_type='METRICS_UPDATE' order by id desc limit 1")).rows[0];
  assert.deepEqual(metric.old_values,{net_effective_rent:100,vacant_area:1000});assert.deepEqual(metric.new_values,{net_effective_rent:110,vacant_area:900});assert.equal(metric.details.building_id,b);
  await db.setup.query("insert into public.app_settings values('current_submission_year','2026'),('api_secret','never logged')");
  const config=(await db.setup.query("select * from public.audit_logs where target_table='app_settings'")).rows;
  assert.equal(config.length,1);assert.equal(config[0].target_id,'current_submission_year');assert.ok(!JSON.stringify(config).includes('never logged'));
 });
 await check('lease lifecycle extends existing edit audit without merging distinct writes',async()=>{
  await db.repair();
  const row=(await db.asUser(OWNER,"insert into public.lease_transactions(company,new_building,area_sqm,submitter_id,data_source) values('Synthetic Company','Synthetic',100,$1,'broker_submission') returning id",[OWNER])).rows[0];
  await db.asUser(OWNER,'update public.lease_transactions set area_sqm=110 where id=$1',[row.id]);
  await db.asUser(OWNER,'update public.lease_transactions set area_sqm=120 where id=$1',[row.id]);
  await db.asUser(OWNER,'delete from public.lease_transactions where id=$1',[row.id]);
  const events=(await db.setup.query('select * from public.audit_logs where target_id=$1 order by id',[row.id])).rows;
  assert.equal(events.filter(e=>e.action_type==='LEASE_TRANSACTION_INSERT').length,1);
  assert.equal(events.filter(e=>e.action_type==='LEASE_TRANSACTION_UPDATE').length,2);
  assert.equal(events.filter(e=>e.action_type==='LEASE_TRANSACTION_DELETE').length,1);
  assert.equal(events[0].user_id,OWNER);assert.equal(events[0].actor_role,'editor');
 });
 await check('canonical rename reuses the actual existing atomic source without duplicate events',async()=>{
  await db.setup.query("alter table public.buildings add column former_names jsonb default '[]'");
  await db.setup.query('alter table public.future_supplies add column name text,add column former_names text[]');
  await db.setup.query('create table public.lease_building_name_map(market_code text,alias_name text,building_id uuid,match_method text,verification_status text,unique(market_code,alias_name))');
  const source=await readFile(new URL('../../migrations/20261027100738_protect_building_identity_renames.sql',import.meta.url),'utf8');
  const start=source.indexOf('create or replace function private.finish_building_identity_update()');
  await db.setup.query(source.slice(start,source.indexOf('create or replace function private.guard_future_supply_identity()',start)));
  await db.setup.query('create trigger buildings_finish_identity_update after update of name,former_names on public.buildings for each row execute function private.finish_building_identity_update()');
  const building=(await db.asUser(ADMIN,"insert into public.buildings(name) values('Original') returning id")).rows[0].id;
  await db.setup.query("insert into public.future_supplies(building_id,name,former_names) values($1,'Original',array[]::text[])",[building]);
  const before=(await db.setup.query('select max(id) as id from public.audit_logs')).rows[0].id;
  await db.asUser(ADMIN,"update public.buildings set name='Renamed',former_names='[\"Original\"]' where id=$1",[building]);
  const events=(await db.setup.query('select action_type,target_table from public.audit_logs where id>$1',[before])).rows;
  assert.deepEqual(events.map(e=>e.action_type),['DB_UPDATE','DB_UPDATE']);
  assert.deepEqual(new Set(events.map(e=>e.target_table)),new Set(['buildings','future_supplies']));
 });
 await check('dedicated quarterly adapter returns bounded metadata and enforces admin access',async()=>{
  const b='cccccccc-1111-4111-8111-111111111111';
  await db.setup.query("insert into public.quarterly_submission_provenance select $1,gen_random_uuid(),'regular',$2,gen_random_uuid(),2026,3,now(),'{\"restricted\":\"never copied\"}'::jsonb from generate_series(1,75)",[OWNER,b]);
  await assert.rejects(db.asUser(OWNER,'select * from public.admin_audit_quarterly_timeline($1)',[b]),e=>e.code==='42501');
  const page=(await db.asUser(ADMIN,'select to_jsonb(t) as event from public.admin_audit_quarterly_timeline($1) t',[b])).rows.map(r=>r.event);
  assert.equal(page.length,51);assert.ok(!JSON.stringify(page).includes('restricted'));const cursor=page[49];
  const next=(await db.asUser(ADMIN,'select to_jsonb(t) as event from public.admin_audit_quarterly_timeline($1,$2,$3,$4) t',[b,cursor.submitted_at,cursor.request_id,cursor.user_id])).rows.map(r=>r.event);
  assert.equal(next.length,25);assert.equal(new Set([...page.slice(0,50),...next].map(r=>r.request_id)).size,75);
 });
 await check('stable cursor handles equal timestamps and completion rechecks export privilege',async()=>{
  const stamp='2026-11-21T00:00:00Z';
  await db.setup.query("insert into public.audit_logs(user_id,action_type,occurred_at,details) select $1,'CURSOR_FIXTURE',$2,'{}'::jsonb from generate_series(1,75)",[ADMIN,stamp]);
  const first=(await db.asUser(ADMIN,"select id,occurred_at from public.audit_logs where action_type='CURSOR_FIXTURE' order by occurred_at desc,id desc limit 50")).rows;
  const next=(await db.asUser(ADMIN,"select id,occurred_at from public.audit_logs where action_type='CURSOR_FIXTURE' and (occurred_at,id)<($1,$2) order by occurred_at desc,id desc limit 50",[first.at(-1).occurred_at,first.at(-1).id])).rows;
  assert.equal(new Set([...first,...next].map(r=>r.id)).size,75);
  const op='cccccccc-5555-4555-8555-555555555555';
  await db.setup.query("insert into public.audit_operation_receipts(id,actor_id,action_type) values($1,$2,'AUDIT_EXPORT')",[op,OWNER]);
  await assert.rejects(db.setup.query("select public.audit_complete_operation($1,'success','{}')",[op]),e=>e.code==='42501');
  assert.equal((await db.setup.query('select state from public.audit_operation_receipts where id=$1',[op])).rows[0].state,'pending');
  await assert.rejects(db.setup.query("select public.audit_complete_operation($1,null,'{}')",[op]),e=>e.code==='22023');
  await assert.rejects(db.setup.query("select public.audit_complete_operation($1,'failed','[]')",[op]),e=>e.code==='22023');
 });
 await check('service-role export completion permits live admins and rejects revoked actors atomically',async()=>{
  // Production finalizes as service_role; current_role is the PostgreSQL SQL
  // keyword, so the old function incorrectly compared service_role to admin.
  await db.setup.query('grant select,update on public.user_roles to service_role');
  const asService=async(sql,args=[])=>{
   await db.setup.query('begin');
   try {await db.setup.query('set local role service_role');const result=await db.setup.query(sql,args);await db.setup.query('commit');return result;}
   catch(error){await db.setup.query('rollback');throw error;}
  };
  for(const action of ['AUDIT_EXPORT','EXPORT_LEASE_TRANSACTIONS','EXPORT_DATA','EXPORT_BACKUP','STACKING_PLAN_EXPORT','STACKING_PLAN_ORIGINAL_DOWNLOAD','SALES_MATERIAL_DOWNLOAD','BUILDING_PHOTO_DOWNLOAD']){
   const op=crypto.randomUUID();
   await asService('insert into public.audit_operation_receipts(id,actor_id,action_type) values($1,$2,$3)',[op,ADMIN,action]);
   for(let i=0;i<2;i++)assert.equal((await asService("select public.audit_complete_operation($1,'success','{}') as ok",[op])).rows[0].ok,true);
   assert.equal((await db.setup.query('select state from public.audit_operation_receipts where id=$1',[op])).rows[0].state,'success');
   assert.equal((await db.setup.query('select count(*)::int n from public.audit_logs where event_id=$1',[op])).rows[0].n,1);
  }
  const revoked=crypto.randomUUID();
  await asService("insert into public.audit_operation_receipts(id,actor_id,action_type) values($1,$2,'AUDIT_EXPORT')",[revoked,ADMIN]);
  await db.setup.query("update public.user_roles set role='viewer' where user_id=$1",[ADMIN]);
  await assert.rejects(asService("select public.audit_complete_operation($1,'success')",[revoked]),e=>e.code==='42501');
  assert.equal((await db.setup.query('select state from public.audit_operation_receipts where id=$1',[revoked])).rows[0].state,'pending');
  assert.equal((await db.setup.query('select count(*)::int n from public.audit_logs where event_id=$1',[revoked])).rows[0].n,0);
  assert.equal((await asService("select public.audit_complete_operation($1,'failed') as ok",[revoked])).rows[0].ok,true);
  await db.setup.query("update public.user_roles set role='admin' where user_id=$1",[ADMIN]);
 });
 await check('bounded health and retention are admin-only and revoke immediately',async()=>{
  await db.setup.query("create table if not exists auth.audit_log_entries(created_at timestamptz,payload jsonb)");
  await db.setup.query("insert into auth.audit_log_entries values(now(),'{\"action\":\"login\",\"traits\":{\"status\":\"failed\"}}'),(now(),'{\"action\":\"login\",\"status\":\"success\"}')");
  await assert.rejects(db.asUser(OWNER,'select public.admin_audit_health()'),e=>e.code==='42501');
  const result=(await db.asUser(ADMIN,'select public.admin_audit_health() as health')).rows[0].health;
  assert.equal(result.window,'latest_1000_within_24h');assert.equal(result.auth.failed_logins,1);assert.equal(result.storage_history.length,1);
  await db.asUser(ADMIN,'select public.admin_audit_health()');assert.equal((await db.setup.query('select count(*)::int n from public.audit_storage_observations')).rows[0].n,1);assert.ok(Array.isArray(result.pending_sample));assert.equal(result.retention.automatic_cleanup,false);
  await db.setup.query("insert into public.audit_logs(user_id,action_type,request_source,details) values($1,'OSS_DELETE','server','{\"outcome\":\"success\",\"business_outcome\":\"partial\"}')",[ADMIN]);
  const withPartial=(await db.asUser(ADMIN,'select public.admin_audit_health() as health')).rows[0].health;
  assert.equal(withPartial.summary.failures,result.summary.failures+1);
  await db.asUser(ADMIN,'select public.admin_set_audit_retention(60)');
  assert.equal((await db.setup.query('select ordinary_days from public.audit_retention_policy')).rows[0].ordinary_days,60);
  await assert.rejects(db.asUser(OWNER,'select public.admin_set_audit_retention(60)'),e=>e.code==='42501');
  await assert.rejects(db.asUser(ADMIN,'select public.admin_set_audit_retention(1)'),e=>e.code==='22023');
  await db.setup.query("update public.user_roles set role='viewer' where user_id=$1",[ADMIN]);
  await assert.rejects(db.asUser(ADMIN,'select public.admin_audit_health()'),e=>e.code==='42501');
 });
 console.log(`PASS ${passed} audit 2 PostgreSQL 17 scenarios (attempt ${attempt})`);
 assertLatencyBudgets(latency);
} finally {await db.close();}
}

await withLatencyRecheck(verifyAudit2);
