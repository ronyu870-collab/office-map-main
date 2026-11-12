import assert from 'node:assert/strict';
import { createHmac, randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { createClient } from '@supabase/supabase-js';
import { ADMIN, VIEWER, OWNER, createLeaseTestDatabase } from '../lease-change-history/database.mjs';

const source = path => readFile(new URL(path, import.meta.url), 'utf8');
const migration = '../../migrations/20261110221500_notice_content_preview.sql';
const fields = 'id,updated_at,updated_by';
const summaryField = 'content_preview:notice_content_preview';
const id = '55555555-5555-4555-8555-000000000001';
const body = '公告😀'.repeat(600);
const part = value => Buffer.from(JSON.stringify(value)).toString('base64url');
const db = await createLeaseTestDatabase();
const authenticator = `notice_probe_${randomBytes(8).toString('hex')}`;
const password = randomBytes(32).toString('hex');
const secret = randomBytes(48).toString('hex');
let gateway;

try {
  const schema = await source('../../migrations/20260730043721_create_colliers_lite_schema.sql');
  const table = schema.slice(schema.indexOf('create table public.notices ('), schema.indexOf('create table public.audit_logs ('));
  const policies = schema.slice(schema.indexOf('create policy "authenticated users read notices"'), schema.indexOf('create policy "admins read audit logs"'));
  const trigger = schema.slice(schema.indexOf('create trigger notices_set_updated_at'), schema.indexOf('create trigger auth_user_created_profile'));
  assert.ok(table.includes('char_length(content)') && policies.includes('private.is_admin()') && trigger.includes('private.set_updated_at()'));
  await db.setup.query(table);
  await db.setup.query(trigger);
  await db.setup.query(`alter table public.notices enable row level security;
    grant select, insert, update, delete on public.notices to authenticated;
    grant usage on schema public to anon, authenticated;
    create role ${authenticator} login noinherit password '${password}';
    grant anon, authenticated to ${authenticator};`);
  await db.setup.query(policies);
  await db.asUser(ADMIN, "insert into public.notices(id,content,updated_at,updated_by) values($1,$2,'2026-11-01','fixture-admin')", [id, body]);
  await db.asUser(ADMIN, "insert into public.notices(content,updated_at,is_active) values('短公告','2026-11-02',true), ('已撤回','2026-10-01',false)");

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
  const list = (sdk, field) => sdk.from('notices').select(`${fields},${field}`)
    .eq('is_active', true).order('updated_at', { ascending: true }).limit(3);
  const detail = (sdk, noticeId) => sdk.from('notices').select('content').eq('id', noticeId).eq('is_active', true).single();
  const deactivate = (sdk, noticeId) => sdk.from('notices').update({ is_active: false })
    .eq('id', noticeId).eq('is_active', true).select('id').single();
  const baseline = await list(admin, 'content');
  assert.equal(baseline.error, null);
  assert.deepEqual(baseline.data.map(row => row.content), [body, '短公告']);
  const beforeMigration = await list(admin, summaryField);
  assert.equal(beforeMigration.error?.code, '42703');
  assert.match(beforeMigration.error?.message, /\bnotice_content_preview\b/);

  await db.setup.query(await source(migration));
  let summary;
  for (let i = 0; i < 50; i++) {
    summary = await list(admin, summaryField);
    if (!summary.error || summary.error.code !== '42703') break;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  assert.equal(summary?.error, null);
  assert.deepEqual(summary.data.map(row => row.id), baseline.data.map(row => row.id));
  assert.deepEqual(summary.data.map(row => row.content_preview), [Array.from(body).slice(0, 161).join(''), '短公告']);
  assert.ok(!Object.hasOwn(summary.data[0], 'content'));
  assert.ok(Buffer.byteLength(JSON.stringify(summary.data)) < Buffer.byteLength(JSON.stringify(baseline.data)) / 4);

  for (const uid of [VIEWER, OWNER]) {
    const member = client(uid);
    assert.deepEqual((await list(member, summaryField)).data, summary.data, 'existing signed-in read permission is retained');
    assert.equal((await detail(member, id)).data.content, body);
    assert.equal((await member.from('notices').insert({ content: '越权发布' })).error?.code, '42501');
    assert.equal((await deactivate(member, id)).data, null);
    assert.equal((await detail(admin, id)).data.content, body);
  }
  const anonymous = await fetch(`${url}/notices?select=${encodeURIComponent(summaryField)}`);
  assert.ok([401, 403].includes(anonymous.status));
  assert.deepEqual((await db.setup.query(`select
    has_function_privilege('anon','public.notice_content_preview(public.notices)','execute') as anon,
    has_function_privilege('service_role','public.notice_content_preview(public.notices)','execute') as service,
    has_function_privilege('authenticated','public.notice_content_preview(public.notices)','execute') as authenticated
  `)).rows[0], { anon: false, service: false, authenticated: true });

  const created = await admin.from('notices').insert({
    content: '新增有效公告', is_active: true, updated_at: '2026-11-03T00:00:00Z', updated_by: 'fixture-admin',
  }).select().single();
  assert.equal(created.error, null);
  assert.equal((await list(client(VIEWER), 'content')).data.at(-1).content, '新增有效公告');
  const removed = await deactivate(admin, id);
  assert.equal(removed.error, null);
  assert.equal(removed.data.id, id);
  assert.equal((await deactivate(admin, id)).data, null, 'an already inactive notice is not acknowledged twice');
  assert.equal((await detail(admin, id)).data, null);
  assert.deepEqual((await list(client(VIEWER), 'content')).data.map(row => row.content), ['短公告', '新增有效公告']);
  const stored = (await db.setup.query('select content,is_active,updated_at from public.notices where id = $1', [id])).rows[0];
  assert.deepEqual([stored.content, stored.is_active], [body, false]);
  assert.ok(stored.updated_at > new Date('2026-11-01'), 'the original update trigger still runs');
  const version = (await db.setup.query('show server_version')).rows[0].server_version;
  console.log(`PASS notice preview on PostgreSQL ${version}: real gateway, preview, permission, publish, active-only read and verified deactivation`);
} finally {
  if (gateway && gateway.exitCode === null && gateway.pid) {
    const stopped = once(gateway, 'exit');
    gateway.kill('SIGTERM');
    await stopped;
  }
  await db.setup.query(`drop owned by ${authenticator}; drop role if exists ${authenticator}`).catch(() => {});
  await db.close();
}
