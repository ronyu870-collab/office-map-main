// Disposable PostgreSQL 17 only; reuses the existing localhost-only harness.
// No production records or credentials are used.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import pg from 'pg';
import { spawn } from 'node:child_process';
import { runMergeRegressions } from './merges.mjs';
import { createLeaseTestDatabase, ADMIN, OWNER, VIEWER } from '../lease-change-history/database.mjs';

const source = p => readFile(new URL(p, import.meta.url), 'utf8');
const migration = '../../migrations/20261027100738_protect_building_identity_renames.sql';
const id = n => 'aaaaaaaa-aaaa-4aaa-8aaa-' + String(n).padStart(12,'0');
const fid = n => 'bbbbbbbb-bbbb-4bbb-8bbb-' + String(n).padStart(12,'0');
const db = await createLeaseTestDatabase();
let passed = 0;
const test = async (name, run) => { await run(); passed++; console.log('PASS ' + name); };
let installed = false;
const update = async (n, name, aliases) => {
  if (!installed) return db.asUser(ADMIN,'update public.buildings set name=$1 where id=$2 returning *',[name,id(n)]);
  const before=(await db.setup.query('select name,former_names from public.buildings where id=$1',[id(n)])).rows[0];
  return db.asUser(ADMIN,'select * from public.admin_rename_building($1,$2,$3::jsonb,$4,$5::jsonb)',[
    id(n),before.name,before.former_names==null?null:JSON.stringify(before.former_names),name,aliases===undefined?null:JSON.stringify(aliases),
  ]);
};
const snapshot = async () => (await db.setup.query(`
 select jsonb_build_object(
 'buildings',(select jsonb_agg(to_jsonb(b) order by id) from public.buildings b),
 'future',(select jsonb_agg(to_jsonb(f) order by id) from public.future_supplies f),
 'maps',(select jsonb_agg(to_jsonb(m) order by market_code,alias_name) from public.lease_building_name_map m),
 'audit',(select jsonb_agg(to_jsonb(a) order by id) from public.audit_logs a)) as data`)).rows[0].data;
const audit = async () => (await db.setup.query("select * from public.audit_logs where action_type='DB_UPDATE' order by id")).rows;
const preservedSources = async () => (await db.setup.query(`select jsonb_build_object(
 'live',(select jsonb_agg(to_jsonb(l) order by id) from public.lease_transactions l),
 'history',(select jsonb_agg(to_jsonb(l) order by id) from public.lease_transactions_history l),
 'assignments',(select jsonb_agg(to_jsonb(a)) from public.future_supply_assignments a),
 'submissions',(select jsonb_agg(to_jsonb(s)) from public.future_supply_submissions s)) as data`)).rows[0].data;
try {
  console.log('Database: ' + db.version);
  await db.setup.query('alter table public.user_roles add column email text,add column full_name text');
  await db.setup.query(await source('../../migrations/20261102063824_audit_actor_identity.sql'));
  const base = await source('../../migrations/20260730043721_create_colliers_lite_schema.sql');
  await db.setup.query(base.slice(base.indexOf('create table public.buildings ('),base.indexOf('create table public.building_metrics (')));
  const restoration = await source('../../migrations/20260801110130_restore_quarterly_oss_admin.sql');
  await db.setup.query(restoration.slice(restoration.indexOf('create table public.future_supplies ('),restoration.indexOf('create table public.future_supply_assignments (')));
  await db.setup.query(`
    alter table public.buildings add column tracking_scope text default 'tracked';
    alter table public.buildings enable row level security;
    alter table public.future_supplies enable row level security;
    grant select on public.buildings to authenticated;
    grant select,update on public.future_supplies to authenticated;
    create policy synthetic_building_read on public.buildings for select to authenticated using(true);
    create policy synthetic_supply_read on public.future_supplies for select to authenticated using(true);
    create policy synthetic_supply_admin on public.future_supplies for update to authenticated using(private.is_admin()) with check(private.is_admin());
    create table public.lease_transactions_history (like public.lease_transactions including defaults);
    alter table public.lease_transactions_history add column source_uid text,add column management_fee numeric,
      add column agency_company text,add column agency_person text,add column quality_status text,
      add column period_source text,add column imported_at timestamptz;
    create table public.future_supply_assignments(id uuid primary key,future_supply_id uuid references public.future_supplies(id),user_id uuid);
    create table public.future_supply_submissions(id uuid primary key,future_supply_id uuid references public.future_supplies(id),for_year int,for_quarter int);
  `);
  for (let n=1;n<=9;n++) await db.setup.query(`insert into public.buildings(id,name,city,district,project_type,is_entered_market,location_lng,location_lat,former_names,notes)
    values($1,$2,'北京','朝阳区',$3,$4,116.4,39.9,$5::jsonb,'Synthetic preserved note')`,
    [id(n),n===1?'Synthetic Tower':n===5||n===6?'Ambiguous future':'Synthetic '+n,
     [1,4,5,6].includes(n)?'future':'stock',![1,4,5,6].includes(n),JSON.stringify(n===1?['Legacy alias']:n===3?['Other legacy']:[])]);
  await db.setup.query("insert into public.future_supplies(id,name,location_lng,location_lat,launch_year,launch_quarter,total_area,former_names) values($1,'Synthetic Tower',116.4,39.9,'2027','Q2',12000,null),($2,'Ambiguous future',116.4,39.9,'2028','Q3',9000,null)",[fid(1),fid(2)]);
  await db.setup.query('update public.buildings set former_names=null where id=$1',[id(4)]);
  await db.setup.query('update public.buildings set former_names=\'""\'::jsonb where id=$1',[id(7)]);
  await db.setup.query('insert into public.future_supply_assignments values($1,$2,$3)',[id(81),fid(1),OWNER]);
  await db.setup.query('insert into public.future_supply_submissions values($1,$2,2026,3)',[id(82),fid(1)]);
  await db.setup.query("insert into public.lease_transactions_history(id,new_building,source_uid) values($1,'Synthetic Tower','synthetic-source-1')",[id(83)]);
  await db.setup.query(await source('../../migrations/20260915053000_create_historical_lease_read_layer_v1.sql'));
  const project = await source('../../migrations/20260915060530_expand_historical_building_identity_governance_v2.sql');
  await db.setup.query(project.slice(project.indexOf('create table if not exists public.lease_building_project_map'),project.indexOf('create temp table _safe_exact_aliases')));
  await test('baseline reproduces ordinary rename leaving the supply and aliases behind', async () => {
    await assert.rejects(update(1,'New Tower'),e=>e.code==='42501');
    await db.setup.query("update public.buildings set name='New Tower' where id=$1",[id(1)]);
    const baseline = await snapshot();
    assert.equal(baseline.future.find(f=>f.id===fid(1)).name,'Synthetic Tower');
    assert.ok(!baseline.buildings.find(b=>b.id===id(1)).former_names.includes('Synthetic Tower'));
    // These are the desired business assertions; the baseline must fail them.
    assert.throws(()=>assert.equal(baseline.future.find(f=>f.id===fid(1)).name,'New Tower'),assert.AssertionError);
    await db.setup.query("update public.buildings set name='Synthetic Tower' where id=$1",[id(1)]);
  });
  const sourcesBefore = await preservedSources();
  await db.setup.query('revoke usage on schema private from authenticated');
  await test('migration detects unexpected legacy-trigger writes and rolls all DDL/data back', async () => {
    const before=await snapshot();
    await db.setup.query("create function private.synthetic_backfill_side_effect() returns trigger language plpgsql as $$ begin new.notes='unexpected mutation'; return new; end $$; create trigger synthetic_backfill_side_effect before update on public.future_supplies for each row execute function private.synthetic_backfill_side_effect()");
    await assert.rejects(db.setup.query(await source(migration)),e=>e.message.includes('Existing future supply data changed'));
    await db.setup.query('rollback');
    assert.deepEqual(await snapshot(),before);
    assert.equal((await db.setup.query("select count(*)::int n from information_schema.columns where table_schema='public' and table_name='future_supplies' and column_name='building_id'")).rows[0].n,0);
    await db.setup.query('drop trigger synthetic_backfill_side_effect on public.future_supplies; drop function private.synthetic_backfill_side_effect()');
  });
  const beforeMigration=await snapshot();
  await db.setup.query(await source(migration));
  installed = true;

  await test('migration links unique exact name + coordinates and leaves ambiguity unlinked', async () => {
    const rows=(await db.setup.query('select id,building_id from public.future_supplies order by id')).rows;
    assert.equal(rows.find(f=>f.id===fid(1)).building_id,id(1));
    assert.equal(rows.find(f=>f.id===fid(2)).building_id,null);
    const after=await snapshot();
    assert.deepEqual(after.buildings,beforeMigration.buildings);
    assert.deepEqual(after.maps,beforeMigration.maps);
    assert.deepEqual(after.future.map(row=>{const previousFields={...row};delete previousFields.building_id;return previousFields}),beforeMigration.future);
    assert.deepEqual(await preservedSources(),sourcesBefore);
  });
  await test('rename capability adds neither table UPDATE/INSERT nor private-schema USAGE grants', async () => {
    const flags=(await db.setup.query("select has_table_privilege('authenticated','public.buildings','UPDATE') u,has_table_privilege('authenticated','public.buildings','INSERT') i,has_schema_privilege('authenticated','private','USAGE') s,has_function_privilege('anon','public.admin_rename_building(uuid,text,jsonb,text,jsonb)','EXECUTE') a")).rows[0];
    assert.deepEqual(flags,{u:false,i:false,s:false,a:false});
  });
  await test('unrelated edits remain allowed for unlinked projects and null/empty aliases are a no-op', async () => {
    const before=await audit();
    const result=await db.setup.query("update public.buildings set name=name,former_names='[]'::jsonb,notes='Unrelated edit' where id=$1 returning *",[id(4)]);
    assert.equal(result.rowCount,1); assert.equal(result.rows[0].former_names,null);
    assert.equal((await audit()).length,before.length);
  });
  await test('admin narrow rename RPC atomically retains aliases, supply identity, maps and trusted audit', async () => {
    await update(1,' New Tower ');
    const s=await snapshot(), b=s.buildings.find(b=>b.id===id(1)), f=s.future.find(f=>f.id===fid(1));
    assert.equal(b.name,'New Tower'); assert.equal(f.name,'New Tower');
    assert.deepEqual(b.former_names,['Legacy alias','Synthetic Tower']);
    assert.deepEqual(f.former_names,b.former_names); assert.equal(f.building_id,id(1));
    assert.equal(b.notes,'Synthetic preserved note'); assert.equal(f.launch_year,'2027');
    for (const name of ['New Tower','Synthetic Tower','Legacy alias']) assert.equal(s.maps.find(m=>m.alias_name===name).building_id,id(1));
    const events=await audit(); assert.equal(events.length,2);
    assert.ok(events.every(e=>e.user_id===ADMIN && e.request_source==='database_trigger'));
    assert.ok(events.every(e=>e.actor_kind==='user' && e.actor_name==='Synthetic admin'));
    assert.equal(events[0].details.event_group,events[1].details.event_group);
    assert.equal(events[1].old_values.name,'Synthetic Tower'); assert.equal(events[1].new_values.name,'New Tower');
    assert.deepEqual(await preservedSources(),sourcesBefore);
    const read=(await db.setup.query("select building_id from public.lease_transactions_read_v1 where new_building='Synthetic Tower'")).rows;
    assert.equal(read.length,5); assert.ok(read.every(r=>r.building_id===id(1)));
  });
  await test('unchanged save and whitespace-normalized repeat add no audit or duplicate aliases', async () => {
    const before=await snapshot();
    await update(1,'New Tower',['Legacy alias','Synthetic Tower']);
    await update(1,' New Tower ',['Synthetic Tower','Legacy alias','Legacy alias']);
    assert.deepEqual(await snapshot(),before);
  });
  await test('a lost response can retry the original request without repeating writes or audit', async () => {
    const before=await snapshot();
    const result=await db.asUser(ADMIN,"select * from public.admin_rename_building($1,'Synthetic Tower','[\"Legacy alias\"]'::jsonb,'New Tower',null)",[id(1)]);
    assert.equal(result.rows[0].name,'New Tower'); assert.deepEqual(await snapshot(),before);
  });
  await test('a second rename and rename back preserve the full prior name chain', async () => {
    await update(1,'Third Tower',[]);
    await update(1,'Synthetic Tower',[]);
    const s=await snapshot(),b=s.buildings.find(b=>b.id===id(1));
    assert.deepEqual(b.former_names,['Legacy alias','New Tower','Third Tower']);
    for(const n of ['Synthetic Tower','New Tower','Third Tower']) assert.equal(s.maps.find(m=>m.alias_name===n).building_id,id(1));
  });
  await test('legacy empty-string aliases can be renamed without losing the original name', async () => {
    await update(7,'Legacy empty renamed');
    const row=(await db.setup.query('select * from public.buildings where id=$1',[id(7)])).rows[0];
    assert.deepEqual(row.former_names,['Synthetic 7']);
  });
  await test('manual former-name additions are retained, deduplicated and mapped', async () => {
    await update(1,'Synthetic Tower',[' Confirmed alias ','Confirmed alias']);
    const s=await snapshot(); assert.equal(s.maps.find(m=>m.alias_name==='Confirmed alias').building_id,id(1));
    assert.ok(s.buildings.find(b=>b.id===id(1)).former_names.includes('New Tower'));
  });
  await test('canonical, former-name, mapping and project-scope conflicts roll back every table', async () => {
    for(const name of ['Synthetic 2','Other legacy']) {
      const before=await snapshot(); await assert.rejects(update(1,name),e=>e.code==='23505');
      assert.deepEqual(await snapshot(),before);
    }
    await db.setup.query("insert into public.lease_building_name_map values('BJ','Map occupied',$1,'former_name','MANUAL_VERIFIED',now())",[id(2)]);
    let before=await snapshot(); await assert.rejects(update(1,'Map occupied'),e=>e.code==='23505'); assert.deepEqual(await snapshot(),before);
    await db.setup.query("insert into public.lease_building_project_map(market_code,alias_name,building_id) values('BJ','Project alias',$1)",[id(1)]);
    before=await snapshot(); await assert.rejects(update(1,'Project alias'),e=>e.code==='23505'); assert.deepEqual(await snapshot(),before);
  });
  await test('blank names, malformed aliases and unlinked future identity are refused without changes', async () => {
    for(const operation of [()=>update(1,'   '),()=>update(1,'Synthetic Tower',{}),()=>update(1,'Synthetic Tower',[1]),()=>update(4,'Unlinked renamed'),()=>update(5,'Ambiguous renamed')]){
      const before=await snapshot(); await assert.rejects(operation(),e=>e.code==='22023'); assert.deepEqual(await snapshot(),before);
    }
  });
  await test('editor, viewer, anonymous and direct private-function calls cannot rename or write maps', async () => {
    const before=await snapshot();
    for(const uid of [OWNER,VIEWER]) await assert.rejects(db.asUser(uid,"select * from public.admin_rename_building($1,'Synthetic Tower','[]'::jsonb,'Unauthorized',null)",[id(1)]),e=>e.code==='42501');
    await assert.rejects(db.asUser(ADMIN,"update public.buildings set name='Bypass' where id=$1",[id(1)]),e=>e.code==='42501');
    await assert.rejects(db.asUser(OWNER,'select private.prepare_building_identity_update()'),e=>e.code==='42501');
    await assert.rejects(db.asUser(ADMIN,"insert into public.lease_building_name_map(market_code,alias_name,building_id,match_method) values('BJ','Forged',$1,'manual')",[id(1)]),e=>e.code==='42501');
    await db.setup.query('begin');
    try { await db.setup.query('set local role anon'); await assert.rejects(db.setup.query('update public.buildings set name=$1 where id=$2',['Anon',id(1)]),e=>e.code==='42501'); }
    finally { await db.setup.query('rollback'); }
    assert.deepEqual(await snapshot(),before);
  });
  await test('secondary supply edits cannot rename, remove aliases, rebind or undo a stale name', async () => {
    for(const operation of [
      ()=>db.asUser(ADMIN,'update public.future_supplies set name=$1 where id=$2',['Secondary rename',fid(1)]),
      ()=>db.asUser(ADMIN,"update public.future_supplies set former_names='{}' where id=$1",[fid(1)]),
      ()=>db.asUser(ADMIN,'update public.future_supplies set building_id=$1 where id=$2',[id(2),fid(1)]),
    ]) { const before=await snapshot(); await assert.rejects(operation(),e=>['22023','42501'].includes(e.code)); assert.deepEqual(await snapshot(),before); }
    // Non-identity maintenance remains allowed.
    assert.equal((await db.asUser(ADMIN,"update public.future_supplies set notes='Updated progress' where id=$1",[fid(1)])).rowCount,1);
  });
  await test('supply failure and audit failure roll back the master, supply and all name maps', async () => {
    await db.setup.query("alter table public.future_supplies add constraint synthetic_sync_failure check(name<>'Reject sync')");
    let before=await snapshot(); await assert.rejects(update(1,'Reject sync'),e=>e.code==='23514'); assert.deepEqual(await snapshot(),before);
    await db.setup.query('alter table public.future_supplies drop constraint synthetic_sync_failure');
    await db.setup.query("alter table public.audit_logs add constraint synthetic_identity_audit_failure check(target_name is distinct from 'Reject audit')");
    before=await snapshot(); await assert.rejects(update(1,'Reject audit'),e=>e.code==='23514'); assert.deepEqual(await snapshot(),before);
    await db.setup.query('alter table public.audit_logs drop constraint synthetic_identity_audit_failure');
  });
  await test('stale rename requests change no row and add no audit', async () => {
    const before=await snapshot();
    await assert.rejects(db.asUser(ADMIN,"select * from public.admin_rename_building($1,'New Tower','[]'::jsonb,'Stale rename',null)",[id(1)]),e=>e.code==='40001'); assert.deepEqual(await snapshot(),before);
  });
  await test('stock rename has no synthetic supply and retains assignments and source data', async () => {
    await update(2,'Renamed stock');
    assert.equal((await db.setup.query('select count(*)::int as n from public.future_supplies where building_id=$1',[id(2)])).rows[0].n,0);
    const event=(await audit()).at(-1); assert.equal(event.target_id,id(2)); assert.equal(event.details.source_records_rewritten,false);
    assert.deepEqual(await preservedSources(),sourcesBefore);
  });
  await test('concurrent buildings cannot take the same new name; loser stays entirely unchanged', async () => {
    const config={host:'127.0.0.1',port:Number(process.env.LEASE_TEST_PG_PORT),user:'postgres',password:'synthetic_ci_only',database:db.database};
    const first=new pg.Client(config),second=new pg.Client(config);
    await first.connect(); await second.connect();
    try {
      for(const client of [first,second]) {await client.query('begin');await client.query("select set_config('request.jwt.claim.sub',$1,true)",[ADMIN]);await client.query('set local role authenticated');}
      await first.query("select * from public.admin_rename_building($1,'Synthetic 8','[]'::jsonb,'Contested name',null)",[id(8)]);
      const pending=second.query("select * from public.admin_rename_building($1,'Synthetic 9','[]'::jsonb,'Contested name',null)",[id(9)]);
      const rejected=assert.rejects(pending,e=>e.code==='23505');
      let blocked=false;
      for(let n=0;n<200;n++){
        const waiting=await db.setup.query("select 1 from pg_stat_activity where pid=$1 and wait_event='advisory'",[second.processID]);
        if(waiting.rowCount){blocked=true;break;}
        await new Promise(r=>setTimeout(r,10));
      }
      assert.ok(blocked,'Second rename must wait for the identity transaction lock');
      await first.query('commit'); await rejected; await second.query('rollback');
      const s=await snapshot(); assert.equal(s.buildings.find(b=>b.id===id(8)).name,'Contested name');
      assert.equal(s.buildings.find(b=>b.id===id(9)).name,'Synthetic 9');
      assert.equal(s.maps.filter(m=>m.alias_name==='Contested name').length,1);
    } finally {await first.query('rollback').catch(()=>{});await second.query('rollback').catch(()=>{});await first.end();await second.end();}
  });
  await runMergeRegressions(db);
  const sourcesBeforeUI = await preservedSources();
  await test('real mobile editor, shared SDK HTTP write and PostgreSQL persistence regressions', async () => {
    await new Promise((resolve,reject) => {
      const child=spawn(process.execPath,['node_modules/vitest/vitest.mjs','run','--config','supabase/tests/building-renames/vitest.config.ts'],{
        stdio:'inherit',env:{...process.env,BUILDING_RENAME_TEST_DB:db.database},
      });
      child.once('error',reject);
      child.once('exit',code=>code===0?resolve():reject(new Error('UI integration exited with '+code)));
    });
    const after=await preservedSources();
    assert.deepEqual(after,sourcesBeforeUI);
  });
  if (process.env.BUILDING_RENAME_BROWSER === '1') {
    await test('actual production build desktop and mobile browser rename checks', async () => {
      await new Promise((resolve,reject)=>{
        const child=spawn(process.execPath,['scripts/check-building-rename-browser.mjs'],{stdio:'inherit',env:{...process.env,BUILDING_RENAME_TEST_DB:db.database}});
        child.once('error',reject);child.once('exit',code=>code===0?resolve():reject(new Error('Browser verification exited with '+code)));
      });
    });
  }
  if (process.env.BUILDING_RENAME_VISUAL_PAIR === '1') {
    for (const phase of ['before','after']) await test('equivalent-data browser visual comparison: '+phase, async () => {
      await new Promise((resolve,reject)=>{
        const child=spawn(process.execPath,['scripts/check-building-rename-browser.mjs'],{stdio:'inherit',env:{...process.env,
          BUILDING_RENAME_TEST_DB:db.database,BUILDING_RENAME_BROWSER_VISUAL:phase,
          BUILDING_RENAME_BROWSER_EVIDENCE:process.env.BUILDING_RENAME_BROWSER_EVIDENCE+'/visual-'+phase}});
        child.once('error',reject);child.once('exit',code=>code===0?resolve():reject(new Error('Visual verification exited with '+code)));
      });
    });
  }
  console.log('PASS all ' + passed + ' rename cases plus executed merge regressions');
} finally { await db.close(); }
