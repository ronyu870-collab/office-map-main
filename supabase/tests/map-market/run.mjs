import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { createClient } from '@supabase/supabase-js';
import { loadMapInventory } from '../../../src/lib/server/mapInventoryRead.ts';
import { createLeaseTestDatabase, recordId } from '../lease-change-history/database.mjs';

// The shared harness only accepts an explicitly disposable localhost PostgreSQL 17.
const db = await createLeaseTestDatabase();
const role = `map_probe_${randomBytes(8).toString('hex')}`;
const password = randomBytes(32).toString('hex');
let gateway;
try {
  const base = await readFile(new URL('../../migrations/20260730043721_create_colliers_lite_schema.sql', import.meta.url), 'utf8');
  const start = base.indexOf('create table public.buildings (');
  const end = base.indexOf('create table public.lease_transactions (');
  assert.ok(start >= 0 && end > start);
  await db.setup.query(base.slice(start, end));
  await db.setup.query(`alter table public.buildings add column tracking_scope text not null default 'tracked';
    grant usage on schema public to anon;
    grant select on public.buildings, public.building_metrics to anon;
    create role ${role} login noinherit password '${password}'; grant anon to ${role};`);
  // Exact production column types and FK. Duplicate versions are synthetic
  // candidates for the deterministic selector, even if a deployment enforces uniqueness.
  await db.setup.query('alter table public.building_metrics drop constraint building_metrics_building_id_record_year_record_quarter_key');
  await db.setup.query(`insert into public.buildings(id,name)
    select ('55555555-5555-4555-8555-' || lpad(n::text,12,'0'))::uuid, '合成 ' || n
    from generate_series(1,1003) n`);
  await db.setup.query(`insert into public.buildings(id,name,is_active,tracking_scope,project_type) values
    ($1,'不在跟',false,'tracked','stock'),($2,'参考库',true,'reference_only','stock'),($3,'未入市',true,'tracked','future')`,
  [recordId(2001),recordId(2002),recordId(2003)]);
  await db.setup.query(`insert into public.building_metrics
    (id,building_id,record_year,record_quarter,is_locked,is_draft,net_effective_rent,updated_at,created_at) values
    (1,$1,2026,2,true,false,100,'2026-07-01','2026-07-01'),
    (9,$1,2026,2,true,false,110,'2026-07-02','2026-07-01'),
    (10,$1,2026,2,true,false,120,'2026-07-02','2026-07-01'),
    (11,$1,2026,2,true,false,999,null,'2026-07-03'),
    (12,$1,2026,3,false,false,888,'2026-10-01','2026-10-01'),
    (13,$1,2026,4,true,true,777,'2026-11-01','2026-11-01'),
    (14,$2,2026,2,true,null,0,'2026-07-01','2026-07-01')`, [recordId(1), recordId(2)]);
  const socket = createServer().listen(0, '127.0.0.1');
  await once(socket, 'listening');
  const port = socket.address().port;
  await new Promise(resolve => socket.close(resolve));
  const url = `http://127.0.0.1:${port}`;
  gateway = spawn(process.env.POSTGREST_PATH || 'postgrest', [], { env: {
    PATH: process.env.PATH,
    PGRST_DB_URI: `postgresql://${role}:${password}@127.0.0.1:${process.env.LEASE_TEST_PG_PORT}/${db.database}`,
    PGRST_DB_SCHEMAS: 'public', PGRST_DB_ANON_ROLE: 'anon',
    PGRST_SERVER_HOST: '127.0.0.1', PGRST_SERVER_PORT: String(port),
  }, stdio: ['ignore','ignore','pipe'] });
  gateway.stderr.resume();
  let startError;
  gateway.on('error', error => { startError = error; });
  let ready = false;
  for (let i=0; i<60; i++) {
    if (startError || gateway.exitCode !== null) throw new Error('PostgREST failed to start', { cause: startError });
    if ((await fetch(url).catch(() => null))?.ok) { ready=true; break; }
    await new Promise(resolve => setTimeout(resolve,100));
  }
  assert.ok(ready, 'Actual PostgREST required');
  const client = createClient(url,'synthetic', { global: { fetch: (input, options) => {
    const target = new URL(input); assert.equal(target.origin,url);
    target.pathname=target.pathname.replace(/^\/rest\/v1/, '');
    const headers = new Headers(options?.headers); headers.delete('authorization');
    return fetch(target,{...options,headers});
  } } });
  const projection = 'id,location_lng,location_lat,building_metrics(id,record_year,record_quarter,is_locked,is_draft,net_effective_rent,updated_at,created_at)';
  const result = await loadMapInventory(client,projection,true);
  assert.equal(result.error,null,JSON.stringify(result.error));
  assert.equal(result.data.length,1003,'Stable pagination must keep inventory beyond PostgREST default page size');
  const first = result.data.find(row => row.id === recordId(1));
  assert.equal(first.building_metrics.length,1);
  assert.equal(first.building_metrics[0].id,10,'Publication filter must precede latest/version limit; null update dates sort last');
  assert.equal(first.building_metrics[0].record_quarter,2,'No Q3 relabel');
  assert.equal(result.data.find(row => row.id === recordId(2)).building_metrics[0].net_effective_rent,0);
  assert.deepEqual(result.data.find(row => row.id === recordId(3)).building_metrics,[],'Left embedding must retain unobserved, unlocated stock');
  assert.equal(new Set(result.data.map(row=>row.id)).size,1003);
  console.log(JSON.stringify({postgres:db.version, gateway:'real PostgREST',inventory:1003,selectedMetric:10,passed:true}));
} finally {
  if (gateway && gateway.exitCode === null) { gateway.kill('SIGTERM'); await once(gateway,'exit'); }
  await db.setup.query(`drop role if exists ${role}`);
  await db.close();
}
