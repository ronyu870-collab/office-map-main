// Disposable PostgreSQL 17 regression: never touches production or ambient DATABASE_URL.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import pg from 'pg';

assert.ok(process.env.GITHUB_ACTIONS === 'true' || process.env.LEASE_TEST_ALLOW_LOCAL === 'disposable',
  'Requires disposable CI service or an explicitly acknowledged local PostgreSQL 17 fixture');
const port = Number(process.env.LEASE_TEST_PG_PORT);
assert.ok(Number.isInteger(port) && port > 0 && port <= 65535, 'Missing disposable PostgreSQL service port');
const settings = { host: '127.0.0.1', port, user: 'postgres', password: 'synthetic_ci_only', connectionTimeoutMillis: 5000 };
const system = new pg.Client({ ...settings, database: 'postgres' });
const dbName = 'stacking_synthetic_' + randomUUID().replaceAll('-', '');
const targetBuilding = '9ee3e3ff-4845-41a1-a78f-390c11b1917a';
const admin = '33333333-3333-4333-8333-333333333333';
const viewer = '44444444-4444-4444-8444-444444444444';
let connection;
let created = false;
await system.connect();
try {
  const { rows: [server] } = await system.query("select current_setting('server_version_num')::int as n");
  assert.ok(server.n >= 170000 && server.n < 180000, 'PostgreSQL 17 required');
  for (const role of ['anon', 'authenticated', 'service_role']) {
    if (!(await system.query('select 1 from pg_roles where rolname=$1', [role])).rowCount) await system.query('create role ' + role);
  }
  await system.query('create database ' + dbName);
  created = true;
  connection = new pg.Client({ ...settings, database: dbName });
  await connection.connect();
  await connection.query("set statement_timeout='15s'");
  await connection.query(`
    create schema if not exists auth;
    create table auth.users(id uuid primary key);
    create table public.user_roles(user_id uuid primary key references auth.users(id),role text not null);
    create table public.buildings(id uuid primary key,name text not null);
    insert into public.buildings values ('${targetBuilding}', '霄云路33号');
    insert into auth.users values ('${admin}'),('${viewer}');
    insert into public.user_roles values ('${admin}', 'admin'),('${viewer}', 'viewer');
  `);
  const migration = await readFile(new URL('../../migrations/20261118172000_stacking_plan_xiaoyun33_pilot.sql', import.meta.url), 'utf8');
  await connection.query(migration);
  const counts = await connection.query(`
    select (select count(*) from public.stacking_plan_towers) as towers,
      (select count(*) from public.stacking_plan_floors) as floors,
      (select count(*) from public.stacking_plan_spaces) as units,
      (select count(*) from public.stacking_plan_sources where source_as_of is null) as undated;
  `);
  assert.deepEqual(Object.values(counts.rows[0]).map(Number), [2,49,64,1]);
  // Idempotent on repeat and does not change an already staged space.
  await connection.query(migration);
  assert.equal(Number((await connection.query('select count(*) n from public.stacking_plan_spaces')).rows[0].n),64);
  console.log('PASS image-seeded two towers / 49 floors / 64 source-unverified units, idempotent replay');
  // Date confirmation is a separate auditable business event, not an approval of space facts.
  const dateMigration = await readFile(new URL('../../migrations/20261118230500_stacking_plan_xiaoyun33_source_date.sql', import.meta.url), 'utf8');
  await connection.query(dateMigration);
  const dateRow = (await connection.query("select source_as_of::text,as_of_kind,review_state from public.stacking_plan_sources where id='xiaoyun33-initial-screenshot'")).rows[0];
  assert.equal(dateRow.source_as_of, '2026-11-18');
  assert.equal(dateRow.as_of_kind, 'source_data_as_of');
  assert.equal(dateRow.review_state, 'date_confirmed');
  assert.equal((await connection.query("select count(*)::integer n from public.stacking_plan_spaces where verification_status='source_unverified'")).rows[0].n,64);
  console.log('PASS confirmed source business date without approving 64 separate tenancy observations');

  const evidenceMigration = await readFile(
    new URL('../../migrations/20261119133000_stacking_plan_source_evidence.sql', import.meta.url), 'utf8'
  );
  await connection.query(evidenceMigration);
  await connection.query(evidenceMigration);
  const evidenceColumns = await connection.query(
    "select column_name from information_schema.columns where table_schema='public' and table_name='stacking_plan_sources' and column_name like 'evidence_%'"
  );
  assert.equal(evidenceColumns.rows.length,7);
  console.log('PASS evidence metadata migration is repeatable and preserves source data');

  const comparison = await connection.query(`
    select s.tenant_name,s.occupancy_status,s.area_sqm
    from public.stacking_plan_spaces s
    join public.stacking_plan_floors f on f.id=s.floor_id
    join public.stacking_plan_towers t on t.id=f.tower_id
    where t.code='B' and f.floor_code='18'
    order by s.unit_code
  `);
  assert.equal(comparison.rows.length,2);
  assert.equal(Number(comparison.rows[0].area_sqm),941.84);
  assert.equal(Number(comparison.rows[1].area_sqm),691.57);
  assert.equal(comparison.rows[1].occupancy_status,'vacant');
  assert.equal((await connection.query("select count(*) n from public.stacking_plan_spaces where verification_status='source_unverified'")).rows[0].n,'64');
  console.log('PASS B18 partial sublease and unverified-source semantics');

  const restrictions = await connection.query(`
    select relname,relrowsecurity,has_table_privilege('anon',oid,'select') as anon_read,
      has_table_privilege('authenticated',oid,'select') as user_read
    from pg_class where relnamespace='public'::regnamespace and relname like 'stacking_plan_%' and relkind='r';
  `);
  assert.equal(restrictions.rows.length,7);
  assert.ok(restrictions.rows.every(r=>r.relrowsecurity===true && !r.anon_read && !r.user_read));
  const execute = await connection.query(`
    select has_function_privilege('authenticated','public.stacking_plan_space_save(uuid,uuid,uuid,integer,jsonb)','execute') as actor,
      has_function_privilege('service_role','public.stacking_plan_space_save(uuid,uuid,uuid,integer,jsonb)','execute') as service;
  `);
  assert.deepEqual(execute.rows[0],{actor:false,service:true});
  console.log('PASS RLS/grants reject unauthenticated/editor/viewer and allow service-only write');

  // Exercise precisely the exposed service-role RPC and observe durable audit.
  const space = (await connection.query(`
    select s.id,s.revision from public.stacking_plan_spaces s
    join public.stacking_plan_floors f on f.id=s.floor_id
    join public.stacking_plan_towers t on t.id=f.tower_id
    where t.code='A' and f.floor_code='3' limit 1
  `)).rows[0];
  await connection.query('set role service_role');
  try {
    const saved = await connection.query('select public.stacking_plan_space_save($1,$2,$3,$4,$5::jsonb) as row',
      [targetBuilding,space.id,admin,space.revision,JSON.stringify({ notes:'synthetic change' })]);
    assert.equal(saved.rows[0].row.revision,space.revision+1);
    assert.equal(saved.rows[0].row.verification_status,'source_unverified');
    // Synthetic service_role has only explicit grants (not Supabase's production BYPASSRLS).
    // Read the journal as the test schema owner, then resume service-role mutation probes.
    await connection.query('reset role');
    const journal = await connection.query('select actor_id,before_record,after_record from public.stacking_plan_space_events where space_id=$1',[space.id]);
    assert.equal(journal.rows.length,1);
    assert.equal(journal.rows[0].actor_id,admin);
    assert.equal(journal.rows[0].before_record.revision,space.revision);
    assert.equal(journal.rows[0].after_record.revision,space.revision+1);
    await connection.query('set role service_role');
    await assert.rejects(
      connection.query('select public.stacking_plan_space_save($1,$2,$3,$4,$5::jsonb)',
        [targetBuilding,space.id,admin,space.revision,JSON.stringify({notes:'stale'})]),
      error => error.code==='40001',
    );
    await assert.rejects(
      connection.query('select public.stacking_plan_space_save($1,$2,$3,$4,$5::jsonb)',
        [targetBuilding,space.id,admin,space.revision+1,JSON.stringify({verification_status:'verified'})]),
      error => error.code==='22023',
    );
    await assert.rejects(
      connection.query('select public.stacking_plan_space_save($1,$2,$3,$4,$5::jsonb)',
        [targetBuilding,space.id,viewer,space.revision+1,JSON.stringify({notes:'forbidden'})]),
      error => error.code==='42501',
    );
    await connection.query('reset role');
    assert.equal(Number((await connection.query('select count(*) n from public.stacking_plan_space_events where space_id=$1',[space.id])).rows[0].n),1);
    console.log('PASS service RPC update + atomic before/after audit, stale conflict, forbidden patch, non-admin rejection');

    // A source attachment must atomically change metadata and journal old/new
    // values; replays must not add a second event or confirm tenancy.
    const sourceId = 'xiaoyun33-initial-screenshot';
    const sha256 = 'a'.repeat(64);
    const args = [
      targetBuilding, sourceId, admin,
      targetBuilding + '/' + sourceId + '/' + sha256 + '.png',
      'synthetic-original.png', 'image/png', 2030, sha256,
    ];
    const archived = await connection.query(
      'select public.stacking_plan_source_attach($1,$2,$3,$4,$5,$6,$7,$8) as item', args
    );
    assert.equal(archived.rows[0].item.evidence_sha256,sha256);
    assert.equal(archived.rows[0].item.source_as_of,'2026-11-18');
    await connection.query(
      'select public.stacking_plan_source_attach($1,$2,$3,$4,$5,$6,$7,$8)',args
    );
    await assert.rejects(
      connection.query('select public.stacking_plan_source_attach($1,$2,$3,$4,$5,$6,$7,$8)',[
        targetBuilding,sourceId,viewer,args[3],args[4],args[5],args[6],args[7],
      ]),
      error => error.code==='42501'
    );
    await assert.rejects(
      connection.query('select public.stacking_plan_source_attach($1,$2,$3,$4,$5,$6,$7,$8)',[
        targetBuilding,sourceId,admin,'other-building/source/original.png',args[4],args[5],args[6],args[7],
      ]),
      error => error.code==='22023'
    );
    await connection.query('reset role');
    const evidenceEvents = await connection.query(
      'select actor_id, before_record, after_record from public.stacking_plan_source_events where source_id=$1',
      [sourceId]
    );
    assert.equal(evidenceEvents.rows.length,1);
    assert.equal(evidenceEvents.rows[0].actor_id,admin);
    assert.equal(evidenceEvents.rows[0].before_record.evidence_storage_path,null);
    assert.equal(evidenceEvents.rows[0].after_record.evidence_sha256,sha256);
    const currentEvidence = (await connection.query(
      'select source_as_of,review_state,evidence_sha256 from public.stacking_plan_sources where id=$1',[sourceId]
    )).rows[0];
    assert.equal(currentEvidence.evidence_sha256,sha256);
    assert.equal(currentEvidence.review_state,'date_confirmed');
    assert.equal((await connection.query(
      "select count(*) n from public.stacking_plan_spaces where verification_status='source_unverified'"
    )).rows[0].n,'64');
    await connection.query('set role service_role');
    const grants = await connection.query(
      "select has_function_privilege('authenticated','public.stacking_plan_source_attach(uuid,text,uuid,text,text,text,integer,text)','execute') user_execute, has_function_privilege('service_role','public.stacking_plan_source_attach(uuid,text,uuid,text,text,text,integer,text)','execute') service_execute"
    );
    assert.deepEqual(grants.rows[0],{user_execute:false,service_execute:true});
    console.log('PASS private original attachment, idempotency, atomic audit, role and path protection');
  } finally {
    await connection.query('reset role');
  }
} finally {
  await connection?.end().catch(()=>{});
  if (created) await system.query('drop database ' + dbName + ' with (force)').catch(()=>{});
  await system.end();
}
