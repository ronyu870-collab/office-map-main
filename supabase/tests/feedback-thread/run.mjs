import assert from 'node:assert/strict';
import { createHmac, randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';
import { createClient } from '@supabase/supabase-js';
import { ADMIN, OWNER, OTHER, VIEWER, recordId, createLeaseTestDatabase } from '../lease-change-history/database.mjs';

const migration = file => readFile(new URL(`../../migrations/${file}`, import.meta.url), 'utf8');
const section = (sql, start, end) => {
  const a = sql.indexOf(start), b = sql.indexOf(end, a + 1);
  assert.ok(a >= 0 && b > a, start);
  return sql.slice(a, b);
};
const db = await createLeaseTestDatabase();
const dbLogin = `feedback_probe_${randomBytes(7).toString('hex')}`;
const password = randomBytes(24).toString('hex');
const secret = randomBytes(48).toString('hex');
const issue = recordId(81), empty = recordId(82), internal = recordId(83);
const ownerEmail = 'owner@example.test';
const adminEmail = 'admin@example.test';
const encode = value => Buffer.from(JSON.stringify(value)).toString('base64url');
const ok = result => { assert.equal(result.error, null, JSON.stringify(result.error)); return result.data; };
let gateway;

try {
  const original = await migration('20260801110130_restore_quarterly_oss_admin.sql');
  await db.setup.query(section(original, 'create table public.admin_issues (', 'create index building_assignments_user_idx'));
  await db.setup.query(`
    create table auth.users(id uuid primary key);
    create schema storage;
    create table storage.objects(bucket_id text, name text);
    create function auth.jwt() returns jsonb language sql stable as $$
      select nullif(current_setting('request.jwt.claims', true), '')::jsonb
    $$;
    alter table public.admin_issues enable row level security;
    alter table public.admin_issue_comments enable row level security;
    alter table storage.objects enable row level security;
    create index admin_issue_comments_issue_idx on public.admin_issue_comments (issue_id, created_at);
    create role ${dbLogin} login noinherit password '${password}';
    grant anon, authenticated, service_role to ${dbLogin};
    grant usage on schema public to anon, authenticated, service_role;
  `);
  await db.setup.query(section(original, 'create policy "admin manage issues"', 'create policy "public read issue images"'));
  await db.setup.query(await migration('20260911195000_add_user_feedback_access.sql'));
  await db.setup.query(await migration('20260914110000_feedback_v2_closed_loop.sql'));
  await db.setup.query(`
    revoke execute on function public.feedback_mark_read(uuid), public.feedback_admin_reply(uuid,text,text[],text), public.feedback_reopen(uuid,text) from public;
    grant select, insert, update, delete on public.admin_issues, public.admin_issue_comments to authenticated;
    grant select on public.admin_issue_reads to authenticated;
  `);
  await db.setup.query('insert into auth.users(id) select unnest($1::uuid[])', [[OWNER, OTHER, ADMIN, VIEWER]]);
  await db.setup.query(`insert into public.admin_issues(id,title,created_by,source,last_user_activity_at) values
    ($1,'Synthetic feedback',$4,'user_feedback',now()), ($2,'Empty feedback',$4,'user_feedback',now()),
    ($3,'Internal issue',$5,'admin',null)`, [issue, empty, internal, ownerEmail, adminEmail]);
  await db.setup.query(`insert into public.admin_issue_comments(issue_id,content,images,created_by,is_admin,created_at) values
    ($1,'Initial reply',array['https://synthetic.example.test/attachment'],$3,true,now() - interval '2 days'),
    ($1,'Initial follow-up',array[]::text[],$2,false,now() - interval '1 day'),
    ($4,'Internal comment',array[]::text[],$3,true,now())`, [issue, ownerEmail, adminEmail, internal]);

  const socket = createServer().listen(0, '127.0.0.1');
  await once(socket, 'listening');
  const port = socket.address().port;
  await new Promise((resolve, reject) => socket.close(error => error ? reject(error) : resolve()));
  const url = `http://127.0.0.1:${port}`;
  gateway = spawn(process.env.POSTGREST_PATH || 'postgrest', [], {
    env: { PATH: process.env.PATH, PGRST_DB_URI: `postgresql://${dbLogin}:${password}@127.0.0.1:${process.env.LEASE_TEST_PG_PORT}/${db.database}`,
      PGRST_DB_SCHEMAS: 'public', PGRST_DB_ANON_ROLE: 'anon', PGRST_DB_MAX_ROWS: '1000', PGRST_JWT_SECRET: secret,
      PGRST_SERVER_HOST: '127.0.0.1', PGRST_SERVER_PORT: String(port) }, stdio: ['ignore', 'ignore', 'inherit'],
  });
  let gatewayError;
  gateway.on('error', error => { gatewayError = error; });
  for (let attempt = 0; attempt < 60; attempt++) {
    if (gatewayError || gateway.exitCode !== null) throw new Error('PostgREST failed to start', { cause: gatewayError });
    if ((await fetch(url, { signal: AbortSignal.timeout(1000) }).catch(() => null))?.ok) break;
    assert.ok(attempt < 59, 'PostgREST did not become ready');
    await delay(100);
  }
  const requests = [];
  const client = (sub, email, role = 'authenticated') => createClient(url, 'synthetic-publishable', {
    accessToken: async () => {
      const claims = `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode({ sub, email, role, exp: Math.floor(Date.now() / 1000) + 300 })}`;
      return `${claims}.${createHmac('sha256', secret).update(claims).digest('base64url')}`;
    },
    global: { fetch: (input, options) => {
      const target = new URL(input);
      assert.equal(target.origin, url);
      assert.ok(target.pathname.startsWith('/rest/v1/'));
      target.pathname = target.pathname.slice('/rest/v1'.length);
      requests.push(`${options.method} ${target.pathname}`);
      return fetch(target, options);
    } },
  });
  const owner = client(OWNER, ownerEmail);
  const admin = client(ADMIN, adminEmail);
  const other = client(OTHER, 'other@example.test');
  const viewer = client(VIEWER, 'viewer@example.test');
  const thread = (sdk, id) => sdk.rpc('feedback_open_thread', { p_issue_id: id }).select('read_at,comment,comment_created_at').order('comment_created_at');
  const readAt = async (id, uid) => (await db.setup.query('select last_read_at::text as at from public.admin_issue_reads where issue_id=$1 and user_id=$2', [id, uid])).rows[0]?.at;
  assert.equal((await thread(owner, issue)).error?.code, 'PGRST202');
  requests.length = 0;
  ok(await owner.rpc('feedback_mark_read', { p_issue_id: issue }));
  const previous = ok(await owner.from('admin_issue_comments').select('id,issue_id,content,images,created_by,is_admin,created_at,kind,metadata').eq('issue_id', issue).order('created_at'));
  assert.deepEqual(requests, ['POST /rpc/feedback_mark_read', 'GET /admin_issue_comments']);
  assert.equal(previous.length, 2);

  await db.setup.query(await migration('20261110213500_feedback_open_thread.sql'));
  for (let attempt = 0; ; attempt++) {
    const result = await thread(owner, empty);
    if (result.error?.code !== 'PGRST202') {
      const rows = ok(result);
      assert.equal(rows.length, 1);
      assert.equal(rows[0].comment, null);
      assert.equal(Date.parse(rows[0].read_at), Date.parse(await readAt(empty, OWNER)));
      break;
    }
    assert.ok(attempt < 39, 'PostgREST did not reload the migration');
    await delay(100);
  }
  requests.length = 0;
  const next = ok(await thread(owner, issue));
  assert.deepEqual(requests, ['POST /rpc/feedback_open_thread']);
  assert.deepEqual(next.map(row => row.comment), previous);
  assert.equal(Date.parse(next[0].read_at), Date.parse(await readAt(issue, OWNER)));

  for (const [sdk, id] of [[other, issue], [viewer, issue], [owner, internal], [client(ADMIN, adminEmail, 'service_role'), issue]]) {
    assert.equal((await thread(sdk, id)).error?.code, '42501');
  }
  const anonymous = await fetch(`${url}/rpc/feedback_open_thread`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ p_issue_id: issue }) });
  assert.ok([401, 403].includes(anonymous.status));
  assert.equal(await readAt(issue, OTHER), undefined);
  assert.equal(await readAt(internal, OWNER), undefined);
  assert.equal(ok(await thread(admin, internal))[0].comment.content, 'Internal comment');
  const adminRead = ok(await thread(admin, issue));
  assert.deepEqual(adminRead.map(row => row.comment), previous);

  const beforeFailure = await readAt(issue, OWNER);
  await db.setup.query('revoke select on public.admin_issue_comments from authenticated');
  assert.equal((await thread(owner, issue)).error?.code, '42501');
  assert.equal(await readAt(issue, OWNER), beforeFailure, 'timeline failure must roll back its acknowledgement');
  await db.setup.query('grant select on public.admin_issue_comments to authenticated');

  ok(await admin.rpc('feedback_admin_reply', { p_issue_id: issue, p_content: 'Resolved reply', p_next_status: 'resolved' }));
  const beforeRead = (await db.setup.query('select last_admin_activity_at > (select last_read_at from public.admin_issue_reads where issue_id=$1 and user_id=$2) as unread from public.admin_issues where id=$1', [issue, OWNER])).rows[0];
  assert.equal(beforeRead.unread, true, 'activity after the previous receipt stays unread');
  const resolved = ok(await thread(owner, issue));
  assert.ok(resolved.some(row => row.comment.content === 'Resolved reply'));
  assert.ok(resolved.some(row => row.comment.kind === 'status_change' && row.comment.metadata.to === 'resolved'));
  ok(await owner.rpc('feedback_reopen', { p_issue_id: issue, p_message: 'Issue remains' }));
  const reopened = ok(await thread(admin, issue));
  assert.ok(reopened.some(row => row.comment.content === 'Issue remains' && !row.comment.is_admin));
  assert.ok(reopened.some(row => row.comment.kind === 'status_change' && row.comment.metadata.to === 'open'));
  assert.equal((await db.setup.query('select status from public.admin_issues where id=$1', [issue])).rows[0].status, 'open');
  console.log(`PASS feedback thread: 2→1 real PostgREST requests; RLS, receipts, rollback, reply and reopen on ${db.version}`);
} finally {
  if (gateway?.pid && gateway.exitCode === null) { gateway.kill(); await once(gateway, 'exit'); }
  await db.setup.query(`drop role if exists ${dbLogin}`).catch(() => {});
  await db.close();
}
