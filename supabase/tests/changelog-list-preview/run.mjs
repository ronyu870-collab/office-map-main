import assert from 'node:assert/strict';
import { createHmac, randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { createClient } from '@supabase/supabase-js';
import { ADMIN, VIEWER, OWNER, createLeaseTestDatabase } from '../lease-change-history/database.mjs';

const source = path => readFile(new URL(path, import.meta.url), 'utf8');
const migration = '../../migrations/20261110220000_changelog_list_preview.sql';
const fields = 'id,code,title,status,category,module,version,released_at,created_at';
const summaryField = 'description_preview:changelog_description_preview';
const id = '55555555-5555-4555-8555-000000000001';
const body = '日报😀'.repeat(1000);
const part = value => Buffer.from(JSON.stringify(value)).toString('base64url');
const db = await createLeaseTestDatabase();
const authenticator = `changelog_probe_${randomBytes(8).toString('hex')}`;
const password = randomBytes(32).toString('hex');
const secret = randomBytes(48).toString('hex');
let gateway;

try {
  const schema = await source('../../migrations/20260801110130_restore_quarterly_oss_admin.sql');
  const table = schema.slice(schema.indexOf('create table public.changelog ('), schema.indexOf('create table public.memos ('));
  const policies = schema.slice(schema.indexOf('create policy "admin manage changelog"'), schema.indexOf('create policy "admin manage memos"'));
  assert.ok(table.includes('code text unique') && policies.includes('private.is_admin()'));
  await db.setup.query(table);
  await db.setup.query(`alter table public.changelog enable row level security;
    grant select, insert, update, delete on public.changelog to authenticated;
    grant usage on schema public to anon, authenticated;
    create role ${authenticator} login noinherit password '${password}';
    grant anon, authenticated to ${authenticator};`);
  await db.setup.query(policies);
  await db.asUser(ADMIN, "insert into public.changelog(id,code,title,description,module,sort_order) values($1,'CL-001','Alpha log',$2,'map',100)", [id, body]);
  await db.asUser(ADMIN, "insert into public.changelog(code,title,description,module,sort_order) values('CL-002','Later log','','map',90), ('CL-003','Other log','Other body','general',1)");

  const portProbe = createServer().listen(0, '127.0.0.1');
  await once(portProbe, 'listening');
  const port = portProbe.address().port;
  await new Promise((resolve, reject) => portProbe.close(error => error ? reject(error) : resolve()));
  const url = `http://127.0.0.1:${port}`;
  gateway = spawn(process.env.POSTGREST_PATH || 'postgrest', [], {
    env: { PATH: process.env.PATH, PGRST_DB_URI: `postgresql://${authenticator}:${password}@127.0.0.1:${process.env.LEASE_TEST_PG_PORT}/${db.database}`,
      PGRST_DB_SCHEMAS: 'public', PGRST_DB_ANON_ROLE: 'anon', PGRST_JWT_SECRET: secret,
      PGRST_SERVER_HOST: '127.0.0.1', PGRST_SERVER_PORT: String(port) },
    stdio: ['ignore', 'ignore', 'ignore'],
  });
  let gatewayError;
  gateway.on('error', error => { gatewayError = error; });
  for (let i = 0; i < 60; i++) {
    if (gatewayError || gateway.exitCode !== null) throw new Error('PostgREST failed to start');
    const response = await fetch(url, { signal: AbortSignal.timeout(1000) }).catch(() => null);
    if (response?.ok) break;
    assert.ok(i < 59, 'actual PostgREST did not become ready');
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

  const admin = client(ADMIN);
  const list = (sdk, field) => sdk.from('changelog').select(`${fields},${field}`)
    .order('sort_order', { ascending: false }).order('created_at', { ascending: false });
  const baseline = await list(admin, 'description');
  assert.equal(baseline.error, null);
  assert.deepEqual(baseline.data.map(row => row.title), ['Alpha log', 'Later log', 'Other log']);
  const beforeMigration = await list(admin, summaryField);
  assert.equal(beforeMigration.error?.code, '42703');
  assert.match(beforeMigration.error?.message, /\bchangelog_description_preview\b/);

  await db.setup.query(await source(migration));
  let summary;
  for (let i = 0; i < 50; i++) {
    summary = await list(admin, summaryField);
    if (!summary.error || summary.error.code !== '42703') break;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  assert.equal(summary?.error, null);
  const metadata = (rows, bodyField) => rows.map(row => Object.fromEntries(Object.entries(row).filter(([key]) => key !== bodyField)));
  assert.deepEqual(metadata(summary.data, 'description_preview'), metadata(baseline.data, 'description'));
  assert.equal(summary.data[0].description_preview, Array.from(body).slice(0, 160).join(''));
  assert.equal(summary.data[1].description_preview, '');
  assert.ok(!Object.hasOwn(summary.data[0], 'description'));
  assert.ok(Buffer.byteLength(JSON.stringify(summary.data)) < Buffer.byteLength(JSON.stringify(baseline.data)) / 4);
  assert.deepEqual((await list(admin, summaryField).eq('module', 'map')).data.map(row => row.code), ['CL-001', 'CL-002']);

  const detail = (sdk, recordId) => sdk.from('changelog')
    .select('code,title,description,status,category,module,version,released_at,sort_order').eq('id', recordId).single();
  for (const uid of [VIEWER, OWNER]) {
    const viewer = client(uid);
    const result = await list(viewer, summaryField);
    assert.equal(result.error, null);
    assert.deepEqual(result.data, []);
    assert.equal((await detail(viewer, id)).data, null);
    assert.equal((await viewer.from('changelog').update({ description: 'invalid mutation' }).eq('id', id).select('id')).data.length, 0);
  }
  const anonymous = await fetch(`${url}/changelog?select=${encodeURIComponent(summaryField)}`);
  assert.ok([401, 403].includes(anonymous.status));
  assert.deepEqual((await db.setup.query(`select
    has_function_privilege('anon','public.changelog_description_preview(public.changelog)','execute') as anon,
    has_function_privilege('service_role','public.changelog_description_preview(public.changelog)','execute') as service,
    has_function_privilege('authenticated','public.changelog_description_preview(public.changelog)','execute') as authenticated
  `)).rows[0], { anon: false, service: false, authenticated: true });

  const original = await detail(admin, id);
  assert.equal(original.error, null);
  assert.equal(original.data.description, body);
  const updated = '新正文😀'.repeat(1000);
  const save = await admin.from('changelog').update({ description: updated }).eq('id', id);
  assert.equal(save.error, null);
  assert.equal((await detail(admin, id)).data.description, updated);
  const publish = await admin.from('changelog').update({ status: 'released', released_at: '2026-11-10' }).eq('id', id);
  assert.equal(publish.error, null);
  const published = (await list(admin, summaryField)).data.find(row => row.id === id);
  assert.deepEqual([published.status, published.released_at, published.description_preview], ['released', '2026-11-10', Array.from(updated).slice(0, 160).join('')]);
  const removed = await admin.from('changelog').delete().eq('id', id);
  assert.equal(removed.error, null);
  assert.equal((await detail(admin, id)).data, null);
  assert.equal((await list(admin, summaryField)).data.length, 2);
  const version = (await db.setup.query('show server_version')).rows[0].server_version;
  console.log(`PASS changelog preview on PostgreSQL ${version}: real PostgREST projection, fallback signal, ordering, permission, body, status and delete`);
} finally {
  if (gateway && gateway.exitCode === null && gateway.pid) {
    const stopped = once(gateway, 'exit');
    gateway.kill('SIGTERM');
    await stopped;
  }
  await db.setup.query(`drop owned by ${authenticator}; drop role if exists ${authenticator}`).catch(() => {});
  await db.close();
}
