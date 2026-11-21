import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile,writeFile,mkdir } from 'node:fs/promises';
import { createLeaseTestDatabase,OWNER } from '../lease-change-history/database.mjs';
const db=await createLeaseTestDatabase();
const sql=path=>readFile(new URL(path,import.meta.url),'utf8');
try{
 // Reuse the existing isolated database owner, then load the actual quarterly
 // fixture/functions into its own disposable database. Never touches remote DBs.
 await db.setup.query('drop schema public cascade;drop schema auth cascade;drop schema private cascade;create schema public;grant usage on schema public to anon,authenticated,service_role');
 const fixture=(await sql('../quarterly-reliability/fixture.sql')).replace(/^create role (anon|authenticated|service_role);\r?\n/gm,'');
 await db.setup.query(fixture);
 await db.setup.query(await sql('../../migrations/20260928015050_harden_quarterly_period_rollover_and_submission.sql'));
 const setter=await sql('../../migrations/20260928020602_reconcile_entered_market_future_supplies.sql');
 await db.setup.query(setter.slice(setter.indexOf('create or replace function public.set_current_submission_period('),setter.lastIndexOf('commit;')));
 await db.setup.query(await sql('../../migrations/20261008075610_preserve_quarterly_drafts_and_idempotent_submission.sql'));
 await db.setup.query(await sql('../../migrations/20261009020453_restrict_quarterly_history_sequence_client_privileges.sql'));
 await db.setup.query(`select set_config('test.user_id','${OWNER}',false),set_config('test.can_write','true',false),set_config('test.is_admin','true',false)`);
 // Only unrelated dependencies for installing the additive Audit 2 migration.
 await db.setup.query(`alter table public.buildings add column name text,add column is_active boolean,add column tracking_scope text,add column leasable_area numeric,add column submarket text;
 alter table public.user_roles add column chinese_name text,add column full_name text,add column email text;
 create table public.audit_logs(id bigint generated always as identity primary key,user_id text,action_type text,request_source text,module text,target_table text,target_id text,target_name text,old_values jsonb,new_values jsonb,event_id text unique,details jsonb,occurred_at timestamptz default now(),created_at timestamptz default now(),actor_kind text,actor_name text,error_message text);
 create table public.building_metrics(id bigint primary key,building_id uuid);
 create table public.lease_transactions(id uuid primary key);
 create table public.auth_session_audit_context(auth_session_id uuid primary key,user_id uuid,last_seen_at timestamptz);`);
 const actorSource=await sql('../../migrations/20261102063824_audit_actor_identity.sql');
 await db.setup.query(actorSource.slice(actorSource.indexOf('create function private.snapshot_audit_actor()'),actorSource.indexOf('-- Classify existing rows')));
 const payload=[{building_id:'33333333-3333-4333-8333-333333333333',total_area:1000,vacant_area:100,vacancy_rate:10,asking_rent:100,management_fee:20,face_rent:90,rent_free_period:2}];
 const measure=async(run)=>{
  const durations=[];
  for(let i=0;i<110;i++){const start=performance.now();await run(i);if(i>=10)durations.push(performance.now()-start);}
  durations.sort((a,b)=>a-b);return {samples:100,p95Ms:durations[94],medianMs:durations[49]};
 };
 const benchmark=async()=>({
  draft:await measure(async()=>{
   const revision=(await db.setup.query('select revision from public.update_drafts where user_id=$1 and tab=$2',[OWNER,'GradeA'])).rows[0].revision;
   await db.asUser(OWNER,"select * from public.save_quarterly_draft_v2($1,'Synthetic owner',2026,3,'GradeA',$2::jsonb,$3)",[OWNER,JSON.stringify({synthetic_rows:payload}),revision]);
  }),
  submit:await measure(()=>db.asUser(OWNER,"select * from public.submit_quarterly_batch_v2($1,$2,'Synthetic owner',2026,3,'GradeA',$3::jsonb,'[]'::jsonb)",[randomUUID(),OWNER,JSON.stringify(payload)])),
 });
 const before=await benchmark();
 for(const table of ['quarterly_submissions','future_supply_submissions','building_current_data','building_display_overrides','building_assignments','future_supply_assignments','future_supplies','notices','changelog']) {
  await db.setup.query(`create table if not exists public.${table}(id uuid default gen_random_uuid(),building_id uuid,user_id uuid,record_year integer,record_quarter integer,total_area numeric)`);
 }
 await db.setup.query(await sql('../../migrations/20261121105118_audit_2_query_and_session_governance.sql'));
 const after=await benchmark();
 for(const operation of ['draft','submit'])assert.ok(after[operation].p95Ms-before[operation].p95Ms<=Math.max(10,before[operation].p95Ms*.03),operation+' P95 budget');
 const counts=(await db.setup.query('select (select count(*)::int from private.quarterly_submission_requests) requests,(select count(*)::int from public.quarterly_submission_provenance) provenance')).rows[0];
 assert.equal(counts.requests,220);assert.equal(counts.provenance,220);
 await mkdir('verification/audit-2',{recursive:true});
 const result={environment:'Real PostgreSQL 17; existing quarterly SQL/RPC and synthetic fixture; 10 warmup +100 measured per operation; draft includes revision read; not an HTTP or production CPU measurement',version:db.version,before,after,counts};
 await writeFile('verification/audit-2/quarterly-performance.json',JSON.stringify(result,null,2));console.log(JSON.stringify({status:'pass',...result}));
}finally{await db.close();}
