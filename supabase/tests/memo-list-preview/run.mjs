import assert from 'node:assert/strict';
import { createHmac, randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { createClient } from '@supabase/supabase-js';
import { ADMIN, VIEWER, OWNER, createLeaseTestDatabase } from '../lease-change-history/database.mjs';

const source = path => readFile(new URL(path, import.meta.url), 'utf8');
const migration = '../../migrations/20261110203000_add_memo_list_preview.sql';
const fields = 'id,title,tags,is_pinned,updated_at,updated_by';
const summaryField = 'content_preview:memo_content_preview';
const id = '55555555-5555-4555-8555-000000000001';
const body = '日报😀'.repeat(1000);
const part = value => Buffer.from(JSON.stringify(value)).toString('base64url');
const db = await createLeaseTestDatabase();
const authenticator = `memo_probe_${randomBytes(8).toString('hex')}`;
const password = randomBytes(32).toString('hex');
const secret = randomBytes(48).toString('hex');
let gateway;

try {
  const schema = await source('../../migrations/20260801110130_restore_quarterly_oss_admin.sql');
  const table = schema.slice(schema.indexOf('create table public.memos ('), schema.indexOf('create table public.admin_issues ('));
  const policies = schema.slice(schema.indexOf('create policy "admin manage memos"'), schema.indexOf('create policy "admin manage issues"'));
  assert.ok(table.includes('create table public.memo_versions') && policies.includes('admin manage memo versions'));
  await db.setup.query(table);
  await db.setup.query(`alter table public.memos enable row level security;
    alter table public.memo_versions enable row level security;
    grant select, insert, update, delete on public.memos, public.memo_versions to authenticated;
    grant usage on schema public to anon, authenticated;
    create role ${authenticator} login noinherit password '${password}';
    grant anon, authenticated to ${authenticator};`);
  await db.setup.query(policies);
  await db.asUser(ADMIN, 'insert into public.memos(id,title,content,tags,is_pinned) values($1,$2,$3,$4,true)', [id, 'Alpha memo', body, ['市场']]);
  await db.asUser(ADMIN, "insert into public.memos(title,content,tags) values('Later memo','other body',array['市场']), ('Other memo','other body',array['其他'])");

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
  const filter = (sdk, field) => sdk.from('memos').select(`${fields},${field}`)
    .contains('tags', ['市场']).order('is_pinned', { ascending: false }).order('updated_at', { ascending: false });
  const baseline = await filter(admin, 'content');
  assert.equal(baseline.error, null);
  assert.deepEqual(baseline.data.map(row => row.title), ['Alpha memo', 'Later memo']);
  const beforeMigration = await filter(admin, summaryField);
  assert.equal(beforeMigration.error?.code, '42703');
  assert.match(beforeMigration.error?.message, /\bmemo_content_preview\b/);

  await db.setup.query(await source(migration));
  let summary;
  for (let i = 0; i < 50; i++) {
    summary = await filter(admin, summaryField);
    if (!summary.error) break;
    if (summary.error.code !== '42703') break;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  assert.equal(summary?.error, null);
  assert.deepEqual(summary.data.map(({ content_preview, ...row }) => row), baseline.data.map(({ content, ...row }) => row));
  assert.equal(summary.data[0].content_preview.slice(0, 100), body.slice(0, 100));
  assert.ok(!Object.hasOwn(summary.data[0], 'content'));
  assert.ok(Buffer.byteLength(JSON.stringify(summary.data)) < Buffer.byteLength(JSON.stringify(baseline.data)) / 4);
  assert.deepEqual((await filter(admin, summaryField).ilike('title', '%Alpha%')).data.map(row => row.id), [id]);

  for (const uid of [VIEWER, OWNER]) {
    const result = await filter(client(uid), summaryField);
    assert.equal(result.error, null);
    assert.deepEqual(result.data, []);
  }
  const anonymous = await fetch(`${url}/memos?select=${encodeURIComponent(summaryField)}`);
  assert.ok([401, 403].includes(anonymous.status));
  assert.equal((await db.setup.query("select has_function_privilege('anon','public.memo_content_preview(public.memos)','execute') allowed")).rows[0].allowed, false);

  const detail = await admin.from('memos').select('*').eq('id', id).single();
  assert.equal(detail.error, null);
  assert.equal(detail.data.content, body);
  const nextBody = '新正文😀'.repeat(100);
  const saved = await admin.from('memos').update({ content: nextBody }).eq('id', id).select().single();
  assert.equal(saved.error, null);
  assert.equal(saved.data.content, nextBody);
  const history = await admin.from('memo_versions').insert({ memo_id: id, version: 1, title: saved.data.title, content: nextBody }).select().single();
  assert.equal(history.error, null);
  assert.equal(history.data.content, nextBody);
  assert.equal((await filter(admin, summaryField)).data[0].content_preview.slice(0, 100), nextBody.slice(0, 100));
  assert.equal((await admin.from('memo_versions').select('content').eq('memo_id', id).single()).data.content, nextBody);
  console.log('PASS PostgreSQL 17 + PostgREST: real summary, pre-migration fallback signal, sorting/filtering, role boundaries, body and version readback');
} finally {
  if (gateway && gateway.exitCode === null && gateway.pid) {
    const stopped = once(gateway, 'exit');
    gateway.kill('SIGTERM');
    await stopped;
  }
  await db.setup.query(`drop owned by ${authenticator}; drop role if exists ${authenticator}`).catch(() => {});
  await db.close();
}
