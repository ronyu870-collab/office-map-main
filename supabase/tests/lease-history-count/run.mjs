import assert from 'node:assert/strict';
import { createHmac, randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { createClient } from '@supabase/supabase-js';
import { ADMIN, recordId, createLeaseTestDatabase } from '../lease-change-history/database.mjs';

const source = file => readFile(new URL('../../migrations/' + file, import.meta.url), 'utf8');
const section = (sql, start, end) => {
  const first = sql.indexOf(start);
  const last = sql.indexOf(end, first + 1);
  assert.ok(first >= 0 && last > first, start);
  return sql.slice(first, last);
};
const part = value => Buffer.from(JSON.stringify(value)).toString('base64url');
const db = await createLeaseTestDatabase();
const authenticator = `lease_count_probe_${randomBytes(8).toString('hex')}`;
const password = randomBytes(32).toString('hex');
const secret = randomBytes(48).toString('hex');
const member = recordId(91);
const other = recordId(92);
let gateway;

try {
  const base = await source('20260730043721_create_colliers_lite_schema.sql');
  const nameMap = await source('20260915053000_create_historical_lease_read_layer_v1.sql');
  const projectMap = await source('20260915060530_expand_historical_building_identity_governance_v2.sql');
  const recordMap = await source('20260915070518_add_record_level_building_overrides_v13.sql');
  const current = await source('20260921020006_separate_reference_buildings_from_operational_inventory_v19.sql');
  await db.setup.query(section(base, 'create table public.buildings (', 'create table public.building_metrics ('));
  await db.setup.query(section(current, 'alter table public.buildings', 'create or replace view public.operational_buildings_v1'));
  await db.setup.query(`
    create table public.lease_transactions_history (like public.lease_transactions including defaults);
    alter table public.lease_transactions_history add column source_uid text unique, add column management_fee numeric,
      add column agency_company text, add column agency_person text, add column quality_status text,
      add column period_source text, add column imported_at timestamptz;
  `);
  await db.setup.query(section(nameMap, 'create table if not exists public.lease_building_name_map', 'with candidate_aliases'));
  await db.setup.query(section(projectMap, 'create table if not exists public.lease_building_project_map', 'create temp table _safe_exact_aliases'));
  await db.setup.query(section(recordMap, 'create table if not exists public.lease_building_record_map', 'insert into public.lease_building_record_map('));
  await db.setup.query(section(current, 'create or replace view public.lease_transactions_read_v1', 'do $$'));
  // In this disposable fixture the ordinary service_role lacks Supabase's BYPASSRLS.
  // Emulate that read access only on these isolated tables; don't change cluster roles.
  for (const table of ['lease_transactions', 'lease_building_name_map', 'lease_building_project_map', 'lease_building_record_map']) {
    await db.setup.query(`create policy fixture_service_read on public.${table} for select to service_role using (true);`);
  }
  await db.setup.query(`
    grant usage on schema public to anon, authenticated, service_role;
    grant select on public.lease_transactions, public.lease_transactions_history, public.buildings to service_role;
    create role ${authenticator} login noinherit password '${password}';
    grant anon, authenticated, service_role to ${authenticator};
    truncate public.lease_transactions;
  `);
  await db.setup.query("insert into public.buildings(id,name) values($1,'Tower A'),($2,'Tower B')", [member, other]);
  await db.setup.query("insert into public.lease_building_project_map(alias_name,building_id) values('Synthetic project',$1),('Synthetic project',$2)", [member, other]);
  await db.setup.query(`
    insert into public.lease_transactions(company,new_building,transaction_year,transaction_quarter,area_sqm)
    select 'Alpha live '||n,'Synthetic project',2025,'Q3',150 from generate_series(1,60) n;
    insert into public.lease_transactions_history(source_uid,company,new_building,transaction_year,transaction_quarter,area_sqm)
    select 'history-'||n,'Alpha archive '||n,'Synthetic project',2024,'Q2',160 from generate_series(1,13) n;
    insert into public.lease_transactions(company,new_building,transaction_year,transaction_quarter,area_sqm)
    select 'Noise '||n,'Unmapped',2023,'Q1',1000 from generate_series(1,10000) n;
    analyze public.lease_transactions;
    analyze public.lease_transactions_history;
  `);

  const probe = createServer().listen(0, '127.0.0.1');
  await once(probe, 'listening');
  const port = probe.address().port;
  await new Promise((resolve, reject) => probe.close(error => error ? reject(error) : resolve()));
  const url = `http://127.0.0.1:${port}`;
  gateway = spawn(process.env.POSTGREST_PATH || 'postgrest', [], {
    env: { PATH: process.env.PATH, PGRST_DB_URI: `postgresql://${authenticator}:${password}@127.0.0.1:${process.env.LEASE_TEST_PG_PORT}/${db.database}`,
      PGRST_DB_SCHEMAS: 'public', PGRST_DB_ANON_ROLE: 'anon', PGRST_JWT_SECRET: secret,
      PGRST_SERVER_HOST: '127.0.0.1', PGRST_SERVER_PORT: String(port) },
    stdio: ['ignore', 'ignore', 'inherit'],
  });
  let gatewayError;
  gateway.on('error', error => { gatewayError = error; });
  for (let i = 0; i < 60; i++) {
    if (gatewayError || gateway.exitCode !== null) throw new Error('PostgREST failed to start', { cause: gatewayError });
    const response = await fetch(url, { signal: AbortSignal.timeout(1000) }).catch(() => null);
    if (response?.ok) break;
    assert.ok(i < 59, 'PostgREST did not become ready');
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  const client = role => createClient(url, 'synthetic-publishable', {
    accessToken: async () => {
      const claims = `${part({ alg: 'HS256', typ: 'JWT' })}.${part({ role, sub: ADMIN, exp: Math.floor(Date.now() / 1000) + 300 })}`;
      return `${claims}.${createHmac('sha256', secret).update(claims).digest('base64url')}`;
    },
    global: { fetch: (input, options) => {
      const target = new URL(input);
      assert.equal(target.origin, url);
      assert.ok(target.pathname.startsWith('/rest/v1/'));
      target.pathname = target.pathname.slice('/rest/v1'.length);
      return fetch(target, options);
    } },
  });

  const sdk = client('service_role');
  const relation = () => sdk.from('lease_transactions_read_v1');
  const fields = 'read_id,record_source,company,area_sqm,building_match_scope,related_building_ids,transaction_year,transaction_quarter';
  const filtered = (query, source) => {
    let result = query.ilike('company', '%Alpha%').contains('related_building_ids', [member]).gte('transaction_year', 2024).lte('area_sqm', 200);
    if (source) result = result.eq('record_source', source);
    return result;
  };
  const ordered = query => query.order('transaction_year', { ascending: false }).order('transaction_quarter', { ascending: false }).order('read_id');
  const assertOk = result => { assert.equal(result.error, null, JSON.stringify(result.error)); return result; };
  for (const [source, expected] of [[null, 73], ['live', 60], ['history', 13]]) {
    const before = assertOk(await ordered(filtered(relation().select(fields, { count: 'exact' }), source)).range(0, 49));
    const rows = assertOk(await ordered(filtered(relation().select(fields), source)).range(0, 49));
    const total = assertOk(await filtered(relation().select('read_id', { count: 'exact', head: true }), source));
    assert.equal(before.count, expected);
    assert.equal(total.count, expected);
    assert.equal(total.data, null);
    assert.equal(rows.count, null);
    assert.deepEqual(rows.data, before.data);
    assert.ok(rows.data.every(row => row.building_match_scope === 'project' && row.related_building_ids.includes(member)));
    const next = assertOk(await ordered(filtered(relation().select(fields), source)).range(50, 99));
    assert.equal(next.data.length, Math.max(0, expected - 50));
    assert.ok(next.data.every(row => !rows.data.some(first => first.read_id === row.read_id)));
  }
  const none = assertOk(await relation().select('read_id', { count: 'exact', head: true }).ilike('company', '%no synthetic match%'));
  assert.equal(none.count, 0);
  const denied = await client('authenticated').from('lease_transactions_read_v1').select('read_id', { count: 'exact', head: true });
  assert.equal(denied.status, 403);
  assert.equal(denied.count, null);
  const anon = await fetch(`${url}/lease_transactions_read_v1?select=read_id`, { method: 'HEAD', headers: { Prefer: 'count=exact' } });
  assert.ok([401, 403].includes(anon.status));
  const predicate = "company ilike '%Alpha%' and related_building_ids @> array[$1]::uuid[] and transaction_year >= 2024 and area_sqm <= 200";
  for (const [label, sql] of [
    ['rows', `select read_id, record_source, company, building_match_scope, related_building_ids from public.lease_transactions_read_v1 where ${predicate}
      order by transaction_year desc,transaction_quarter desc,read_id asc limit 50`],
    ['exactCount', `select count(*) from public.lease_transactions_read_v1 where ${predicate}`],
  ]) {
    const result = await db.setup.query(`explain(analyze,buffers,format json) ${sql}`, [member]);
    const plan = result.rows[0]['QUERY PLAN'][0];
    console.log(JSON.stringify({ label, executionMs: plan['Execution Time'], root: plan.Plan['Node Type'], sharedHits: plan.Plan['Shared Hit Blocks'] }));
  }
  console.log(`PASS history page and exact HEAD count match the combined request, source rules and project association on ${db.version}`);
} finally {
  if (gateway && gateway.exitCode === null && gateway.pid) {
    gateway.kill();
    await once(gateway, 'exit');
  }
  await db.setup.query(`drop role if exists ${authenticator}`).catch(() => {});
  await db.close();
}
