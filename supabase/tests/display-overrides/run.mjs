import assert from 'node:assert/strict';
import { createHmac, randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { createClient } from '@supabase/supabase-js';
import { DISPLAY_OVERRIDE_LIST_FIELDS } from '../../../src/services/displayOverrideFields.mjs';
import { ADMIN, VIEWER, OWNER, recordId, createLeaseTestDatabase } from '../lease-change-history/database.mjs';

const source = file => readFile(new URL('../../migrations/' + file, import.meta.url), 'utf8');
const section = (sql, start, end) => {
  const first = sql.indexOf(start);
  const last = sql.indexOf(end, first + 1);
  assert.ok(first >= 0 && last > first, start);
  return sql.slice(first, last);
};
const part = value => Buffer.from(JSON.stringify(value)).toString('base64url');
const db = await createLeaseTestDatabase();
const authenticator = `display_probe_${randomBytes(8).toString('hex')}`;
const password = randomBytes(32).toString('hex');
const secret = randomBytes(48).toString('hex');
const current = recordId(41);
const historical = recordId(42);
const savedRule = recordId(43);
const newRule = recordId(44);
const restricted = '22222222-2222-4222-8222-222222222222';
let gateway;

try {
  const base = await source('20260730043721_create_colliers_lite_schema.sql');
  const schema = await source('20260801110130_restore_quarterly_oss_admin.sql');
  const tracking = await source('20260921020006_separate_reference_buildings_from_operational_inventory_v19.sql');
  const parity = await source('20260927045505_viewer_readonly_editor_parity.sql');
  await db.setup.query(section(base, 'create table public.buildings (', 'create table public.building_metrics ('));
  await db.setup.query(section(tracking, 'alter table public.buildings', 'create or replace view public.operational_buildings_v1'));
  await db.setup.query(section(schema, 'create table public.building_display_overrides (', 'create table public.changelog ('));
  await db.setup.query(section(schema, 'create trigger building_display_overrides_set_updated_at', 'create trigger changelog_set_updated_at'));
  await db.setup.query(section(parity, 'create or replace function private.map_can_view_extended_inventory()', 'drop policy if exists "role scoped read building metrics"'));
  await db.setup.query(section(parity, 'drop policy if exists "role scoped read display overrides"', 'drop policy if exists "role scoped read building brochure data"'));
  await db.setup.query(section(schema, 'create policy "admin manage display overrides"', 'create policy "admin manage changelog"'));
  await db.setup.query(`
    alter table public.buildings enable row level security;
    alter table public.building_display_overrides enable row level security;
    grant select on public.buildings to authenticated;
    grant select, insert, update, delete on public.building_display_overrides to authenticated;
    grant usage on schema public to anon, authenticated;
    create role ${authenticator} login noinherit password '${password}';
    grant anon, authenticated to ${authenticator};`);
  await db.setup.query("update public.user_roles set role='user' where user_id=$1", [restricted]);
  await db.setup.query(`insert into public.buildings(id,name,grade,submarket,is_active,tracking_scope)
    values($1,'当前在跟楼宇','原始甲级','原始商圈',true,'tracked'),
    ($2,'历史楼宇','原始乙级','历史商圈',false,'reference_only')`, [current, historical]);

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
  const client = uid => createClient(url, 'synthetic-publishable', {
    accessToken: async () => {
      const claims = `${part({ alg: 'HS256', typ: 'JWT' })}.${part({ role: 'authenticated', sub: uid, exp: Math.floor(Date.now() / 1000) + 300 })}`;
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

  const read = sdk => sdk.from('building_display_overrides').select(DISPLAY_OVERRIDE_LIST_FIELDS).order('created_at', { ascending: false });
  const assertOk = result => { assert.equal(result.error, null, JSON.stringify(result.error)); return result.data; };
  const admin = client(ADMIN);
  const rules = () => admin.from('building_display_overrides');
  const historicalRule = { id: savedRule, building_id: historical, field_name: 'grade', display_label: '市场分类', display_value: '旧展示值' };
  const currentRule = { id: newRule, building_id: current, field_name: 'submarket', display_label: '行政区', display_value: '覆盖商圈' };
  assertOk(await rules().insert([
    { ...historicalRule, created_at: '2026-10-01T00:00:00Z' },
    { ...currentRule, created_at: '2026-10-02T00:00:00Z' },
  ]));
  assert.equal((await rules().insert({ ...currentRule, id: recordId(45) })).error?.code, '23505');
  const oldRows = assertOk(await rules().select('*').order('created_at', { ascending: false }));
  const oldNames = assertOk(await admin.from('buildings').select('id,name').in('id', oldRows.map(row => row.building_id)));
  const expected = oldRows.map(row => {
    const projected = { ...row };
    delete projected.updated_at;
    return { ...projected, building: { name: oldNames.find(b => b.id === row.building_id).name } };
  });
  assert.deepEqual(assertOk(await read(admin)), expected);
  assert.deepEqual(assertOk(await admin.from('buildings').select('id,name').eq('is_active', true).eq('tracking_scope', 'tracked').order('name')), [
    { id: current, name: '当前在跟楼宇' },
  ]);
  for (const uid of [VIEWER, OWNER]) {
    const sdk = client(uid);
    assert.deepEqual(assertOk(await read(sdk)), expected);
    const otherRules = () => sdk.from('building_display_overrides');
    assert.equal((await otherRules().insert({ ...historicalRule, id: recordId(46), field_name: 'submarket' })).error?.code, '42501');
    assert.deepEqual(assertOk(await otherRules().update({ display_value: '禁止修改' }).eq('id', savedRule).select('id')), []);
    assert.deepEqual(assertOk(await otherRules().delete().eq('id', savedRule).select('id')), []);
  }
  assert.deepEqual(assertOk(await read(client(restricted))), []);
  const anonymous = await fetch(`${url}/building_display_overrides?select=${encodeURIComponent(DISPLAY_OVERRIDE_LIST_FIELDS)}`);
  assert.ok([401, 403].includes(anonymous.status));
  assert.deepEqual(assertOk(await read(admin)), expected);

  const historicalRead = async () => assertOk(await read(admin).eq('id', savedRule).single());
  assertOk(await rules().update({ field_name: 'grade', display_label: '市场分类', display_value: '旧展示值' }).eq('id', savedRule));
  assert.deepEqual(await historicalRead(), expected.find(row => row.id === savedRule));
  assertOk(await rules().update({ field_name: 'grade', display_label: '市场分类', display_value: '新展示值' }).eq('id', savedRule));
  assert.equal((await historicalRead()).display_value, '新展示值');
  assert.deepEqual(assertOk(await admin.from('buildings').select('grade,submarket').eq('id', historical).single()), {
    grade: '原始乙级', submarket: '历史商圈',
  });
  assertOk(await rules().delete().eq('id', newRule));
  assert.deepEqual(assertOk(await read(admin).eq('id', newRule)), []);
  assert.deepEqual(assertOk(await admin.from('buildings').select('grade,submarket').eq('id', current).single()), {
    grade: '原始甲级', submarket: '原始商圈',
  });
  console.log(`PASS display rule SDK → PostgREST → ${db.version}: name projection, active picker, role guards, duplicate/create/edit/unchanged/delete and untouched source facts`);
} finally {
  if (gateway && gateway.exitCode === null && gateway.pid) {
    gateway.kill();
    await once(gateway, 'exit');
  }
  await db.setup.query(`drop role if exists ${authenticator}`).catch(() => {});
  await db.close();
}
