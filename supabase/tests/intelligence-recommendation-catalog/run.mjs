import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHmac, randomBytes } from 'node:crypto';
import { once } from 'node:events';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';
import { createLeaseTestDatabase } from '../lease-change-history/database.mjs';

const source = file => readFile(new URL(`../../migrations/${file}.sql`, import.meta.url), 'utf8');
const migration = '20261111023538_intelligence_recommendation_catalog';
const functionName = 'intelligence_recommendation_catalog';
const role = `catalog_probe_${randomBytes(8).toString('hex')}`;
const password = randomBytes(32).toString('hex');
const secret = randomBytes(48).toString('hex');
const project = '11111111-1111-4111-8111-111111111111';
const gatewayRowLimit = Number(process.env.PERF_CATALOG_GATEWAY_ROW_LIMIT ?? 400);
assert.ok([400, 1000].includes(gatewayRowLimit));
const offsets = gatewayRowLimit === 400 ? [0, 400] : [0];
const db = await createLeaseTestDatabase();
let gateway;
try {
  const base = await source('20260730043721_create_colliers_lite_schema');
  const table = base.slice(base.indexOf('create table public.buildings ('), base.indexOf('create table public.building_metrics ('));
  const inventory = await source('20260921020006_separate_reference_buildings_from_operational_inventory_v19');
  const scope = inventory.slice(inventory.indexOf('alter table public.buildings'), inventory.indexOf('create temp table _reference_gap_aliases'));
  assert.ok(table.includes('contact_phone text') && scope.includes('buildings_tracking_scope_check'));
  await db.setup.query(table + scope);
  await db.setup.query(`alter table public.buildings enable row level security;
    grant select on public.buildings to service_role;
    grant usage on schema public to anon, authenticated, service_role;
    create policy catalog_fixture_service_select on public.buildings for select to service_role using (true);
    create role ${role} login noinherit password '${password}';
    grant anon, authenticated, service_role to ${role};`);
  await db.setup.query(`insert into public.buildings(id,name,grade,district,submarket,contact_phone) values
    ($1,'样本 0000','A','朝阳区','望京','fixture private')`, [project]);
  await db.setup.query(`insert into public.buildings(name,grade,district,submarket)
    select '样本 ' || lpad(n::text, 4, '0'),'B','海淀区','中关村' from generate_series(1,621) n`);
  await db.setup.query(`insert into public.buildings(name,is_active,tracking_scope) values
    ('inactive fixture',false,'tracked'), ('reference fixture',true,'reference_only'); analyze public.buildings;`);

  const portProbe = createServer().listen(0, '127.0.0.1');
  await once(portProbe, 'listening');
  const port = portProbe.address().port;
  await new Promise((resolve, reject) => portProbe.close(error => error ? reject(error) : resolve()));
  const origin = `http://127.0.0.1:${port}`;
  gateway = spawn(process.env.POSTGREST_PATH || 'postgrest', [], {
    env: { PATH: process.env.PATH, PGRST_DB_URI: `postgresql://${role}:${password}@127.0.0.1:${process.env.LEASE_TEST_PG_PORT}/${db.database}`,
      PGRST_DB_SCHEMAS: 'public', PGRST_DB_ANON_ROLE: 'anon', PGRST_DB_MAX_ROWS: String(gatewayRowLimit), PGRST_JWT_SECRET: secret,
      PGRST_SERVER_HOST: '127.0.0.1', PGRST_SERVER_PORT: String(port) },
    stdio: ['ignore', 'ignore', 'ignore'],
  });
  let gatewayError;
  gateway.on('error', error => { gatewayError = error; });
  for (let i = 0; i < 60; i++) {
    if (gatewayError || gateway.exitCode !== null) throw new Error('PostgREST failed to start');
    const ready = await fetch(origin, { signal: AbortSignal.timeout(1000) }).catch(() => null);
    if (ready?.ok) break;
    assert.ok(i < 59, 'PostgREST did not become ready');
    await delay(100);
  }
  const part = value => Buffer.from(JSON.stringify(value)).toString('base64url');
  function jwt(role) {
    const claims = `${part({ alg: 'HS256', typ: 'JWT' })}.${part({ role, exp: Math.floor(Date.now() / 1000) + 300 })}`;
    return `${claims}.${createHmac('sha256', secret).update(claims).digest('base64url')}`;
  }
  const service = jwt('service_role');
  const authenticated = jwt('authenticated');
  async function read(path, init) {
    const started = performance.now();
    const response = await fetch(origin + path, { ...init, signal: AbortSignal.timeout(3000) });
    const raw = await response.text();
    return { status: response.status, data: JSON.parse(raw), bytes: Buffer.byteLength(raw), ms: performance.now() - started };
  }
  const rpc = (version = null, token = service) => read(`/rpc/${functionName}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify({ p_known_version: version }),
  });
  async function legacy() {
    const rows = [];
    let bytes = 0;
    let ms = 0;
    for (const offset of offsets) {
      const result = await read(`/buildings?select=id,name,grade,submarket,district&is_active=eq.true&tracking_scope=eq.tracked&order=name.asc,id.asc&limit=1000&offset=${offset}`,
        { headers: { Authorization: `Bearer ${service}`, ...(offset === 0 ? { Prefer: 'count=exact' } : {}) } });
      assert.ok([200, 206].includes(result.status));
      assert.equal(result.data.length, Math.min(gatewayRowLimit, 622 - offset));
      rows.push(...result.data);
      bytes += result.bytes;
      ms += result.ms;
    }
    return { rows, bytes, ms };
  }
  const before = await legacy();
  assert.equal((await rpc()).data.code, 'PGRST202');
  await db.setup.query(await source(migration));
  let first;
  for (let i = 0; i < 40; i++) {
    first = await rpc();
    if (first.data.code !== 'PGRST202') break;
    await delay(100);
  }
  assert.equal(first.status, 200);
  assert.match(first.data.version, /^[a-f0-9]{64}$/);
  assert.deepEqual(first.data.rows, before.rows);
  assert.ok(!Object.hasOwn(first.data.rows[0], 'contact_phone'));
  const warm = await rpc(first.data.version);
  assert.deepEqual(warm.data, { version: first.data.version, rows: null });
  assert.ok(warm.bytes < before.bytes / 100);
  assert.deepEqual((await rpc('invalid')).data, first.data);
  for (const token of [null, authenticated]) {
    const denied = await rpc(null, token);
    assert.ok([401, 403].includes(denied.status));
    assert.equal(denied.data.code, '42501');
  }
  assert.deepEqual((await db.setup.query(`select
    has_function_privilege('anon','public.${functionName}(text)','execute') as anon,
    has_function_privilege('authenticated','public.${functionName}(text)','execute') as authenticated,
    has_function_privilege('service_role','public.${functionName}(text)','execute') as service
  `)).rows[0], { anon: false, authenticated: false, service: true });

  const samples = { legacy: [], cold: [], warm: [] };
  for (let i = 0; i < 15; i++) {
    for (const key of i % 2 ? ['legacy', 'cold', 'warm'] : ['warm', 'cold', 'legacy']) {
      const result = await (key === 'legacy' ? legacy() : rpc(key === 'warm' ? first.data.version : null));
      samples[key].push(Number(result.ms.toFixed(3)));
    }
  }
  // Measure SQL separately from the HTTP and JSON transfer timings.
  const sqlSamples = { legacy: [], cold: [], warm: [] };
  const catalog = 'select id,name,grade,submarket,district from public.buildings where is_active and tracking_scope=\'tracked\' order by name,id';
  for (let i = 0; i < 15; i++) {
    for (const [key, statements] of Object.entries({
      legacy: [...offsets.map(offset => `${catalog} limit ${gatewayRowLimit} offset ${offset}`),
        "select count(*) from public.buildings where is_active and tracking_scope='tracked'"],
      cold: [`select public.${functionName}(null)`],
      warm: [`select public.${functionName}('${first.data.version}')`],
    })) {
      let elapsed = 0;
      for (const sql of statements) {
        const result = await db.setup.query(`explain (analyze,buffers,timing off,format json) ${sql}`);
        elapsed += result.rows[0]['QUERY PLAN'][0]['Execution Time'];
      }
      sqlSamples[key].push(Number(elapsed.toFixed(3)));
    }
  }
  async function assertChanged(previous, predicate) {
    const result = await rpc(previous);
    assert.equal(result.status, 200);
    assert.match(result.data.version, /^[a-f0-9]{64}$/);
    assert.notEqual(result.data.version, previous);
    assert.ok(Array.isArray(result.data.rows));
    assert.ok(predicate(result.data.rows));
    assert.equal((await rpc(result.data.version)).data.rows, null);
    return result.data.version;
  }
  let current = first.data.version;
  for (const [field, value] of [['name', '改名 0000'], ['grade', 'B'], ['district', '海淀区'], ['submarket', '中关村']]) {
    await db.setup.query(`update public.buildings set ${field} = $1 where id = $2`, [value, project]);
    current = await assertChanged(current, rows => rows.find(row => row.id === project)?.[field] === value);
  }
  for (const [field, value, present] of [['is_active', false, false], ['is_active', true, true],
    ['tracking_scope', 'reference_only', false], ['tracking_scope', 'tracked', true]]) {
    await db.setup.query(`update public.buildings set ${field} = $1 where id = $2`, [value, project]);
    current = await assertChanged(current, rows => rows.some(row => row.id === project) === present);
  }
  const added = (await db.setup.query("insert into public.buildings(name) values ('新增样本') returning id")).rows[0].id;
  current = await assertChanged(current, rows => rows.length === 623 && rows.some(row => row.id === added));
  await db.setup.query('delete from public.buildings where id = $1', [added]);
  current = await assertChanged(current, rows => rows.length === 622 && rows.every(row => row.id !== added));
  await db.setup.query("update public.buildings set notes = 'fixture change' where id = $1", [project]);
  assert.deepEqual((await rpc(current)).data, { version: current, rows: null });
  await db.setup.query('begin');
  try {
    await db.setup.query("update public.buildings set name = 'uncommitted fixture' where id = $1", [project]);
    assert.notEqual((await db.setup.query(`select public.${functionName}(null)->>'version' as version`)).rows[0].version, current);
    assert.deepEqual((await rpc(current)).data, { version: current, rows: null });
  } finally { await db.setup.query('rollback'); }
  assert.deepEqual((await rpc(current)).data, { version: current, rows: null });
  const summarize = groups => Object.fromEntries(Object.entries(groups).map(([key, values]) => {
    const sorted = [...values].sort((a, b) => a - b);
    return [key, { p50: sorted[7], p95: sorted[14], samples: values }];
  }));
  console.log(JSON.stringify({ status: 'pass', postgres: db.version, rows: before.rows.length, gatewayRowLimit,
    bytes: { legacy: before.bytes, cold: first.bytes, warm: warm.bytes },
    roundTripMs: summarize(samples), sqlExecutionMs: summarize(sqlSamples) }, null, 2));
} finally {
  if (gateway?.pid && gateway.exitCode === null) {
    const stopped = once(gateway, 'exit');
    gateway.kill('SIGTERM');
    await stopped;
  }
  await db.setup.query(`drop owned by ${role}; drop role if exists ${role}`).catch(() => {});
  await db.close();
}
