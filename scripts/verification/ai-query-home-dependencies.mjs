import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

// The query integration intentionally loads only its direct migrations. A real
// homepage also reads feedback/mentions and writes the existing frontend audit.
// Load those already-committed schemas in the disposable database; never patch
// the browser, intercept HTTP, broaden a production policy or hide a failure.
const section = (source, from, to) => {
  const begin = source.indexOf(from), end = source.indexOf(to, begin + from.length);
  assert.ok(begin >= 0 && end > begin, 'Existing migration boundary must remain explicit');
  return source.slice(begin, end);
};

export async function loadQueryHomeDependencies(db, load) {
  const audit = await load('20260909065734_extend_audit_log_context.sql');
  await db.query(section(audit, 'alter table public.audit_logs', 'create or replace function public.admin_get_auth_audit_logs('));
  const context = await load('20260909084827_fix_auth_audit_session_context.sql');
  await db.query(section(context, 'create table if not exists public.auth_session_audit_context', 'create or replace function public.admin_get_auth_audit_logs('));
  await db.query(await load('20260909084927_sync_auth_session_audit_context.sql'));
  await db.query(await load('20261102063824_audit_actor_identity.sql'));

  const admin = await load('20260801110130_restore_quarterly_oss_admin.sql');
  await db.query(section(admin, 'create table public.admin_issues (', 'create index building_assignments_user_idx'));
  // The original migration groups these grants with unrelated administrative
  // tables. Preserve its exact privileges for only these loaded dependencies.
  await db.query(`alter table public.admin_issues enable row level security;
    alter table public.admin_issue_comments enable row level security;
    revoke all on public.admin_issues,public.admin_issue_comments from anon,authenticated;
    grant select,insert,update,delete on public.admin_issues,public.admin_issue_comments to authenticated;`);
  await db.query(section(admin, 'create policy "admin manage issues"', 'create policy "public read issue images"'));
  const access = await load('20260911195000_add_user_feedback_access.sql');
  await db.query(section(access, 'begin;', 'drop policy if exists "users upload own feedback images"') + '\ncommit;');
  await db.query(await load('20260914110000_feedback_v2_closed_loop.sql'));
  // Supabase default schema privileges expose this table; its actual own-user
  // RLS remains the restriction. Only SELECT is needed by this homepage path.
  await db.query('grant select on public.admin_issue_reads to authenticated');
  const communication = await load('20261113195000_market_communication_p0.sql');
  await db.query(section(communication, '-- Additive market communication upgrade.', '-- Legacy clients can still insert'));
}

/** Run the same actual Auth -> HTTP -> PostgREST reads/writes before and after
 * repairing the incomplete test schema. This attributes the old failure class;
 * old URL-free performance samples themselves cannot retrospectively be named. */
export async function verifyQueryHomeDependencies({ db, load, check, person, app, until }) {
  assert.equal(process.env.AI_QUERY_AUTH_ALLOW_LOCAL, 'disposable');
  assert.equal(db.connectionParameters.host, '127.0.0.1');
  assert.equal(Number(db.connectionParameters.port), 55992);
  const owner = await person('admin', 'home-background');
  const readQueries = () => [
    owner.client.from('message_notifications').select('message_id').is('read_at', null).order('created_at', { ascending: false }).limit(100),
    owner.client.from('admin_issues').select('id,title,description,status,priority,category,module,images,created_at,created_by,resolved_at,resolved_by,reopened_at,source,context,last_activity_at,last_admin_activity_at,last_user_activity_at')
      .eq('source', 'user_feedback').eq('created_by', owner.email).order('last_activity_at', { ascending: false, nullsFirst: false }).order('created_at', { ascending: false }),
    owner.client.from('admin_issue_reads').select('issue_id,last_read_at').eq('user_id', owner.id),
  ];
  const eventId = randomUUID();
  const auditRequest = () => fetch(app + '/api/audit-events', {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + owner.token },
    body: JSON.stringify({ events: [{ event_id: eventId, action_type: 'PAGE_VIEW',
      origin_schema_version: 2, origin_user_id: owner.id, origin_auth_session_id: owner.sessionId,
      details: { synthetic: true, page: '/', verification: 'query_home_dependencies' }, module: 'home', occurred_at: '2026-11-15T00:00:00.000Z' }] }),
  });
  await check('主页依赖旧夹具复现：三个真实Data API读取404，原审计HTTP写入500', async () => {
    const reads = await Promise.all(readQueries());
    for (const read of reads) {
      assert.equal(read.status, 404); assert.equal(read.error?.code, 'PGRST205');
    }
    assert.equal((await auditRequest()).status, 500);
    assert.equal((await db.query('select count(*)::int n from public.audit_logs where event_id=$1', [eventId])).rows[0].n, 0);
  });
  await loadQueryHomeDependencies(db, load);
  await db.query("notify pgrst,'reload schema'");
  await until(async () => (await Promise.all(readQueries())).every(result => result.error === null), 'Existing homepage dependency schema cache');
  await check('主页依赖原始迁移补齐：同一真实请求200，审计持久化/重试幂等和原身份保留', async () => {
    for (const read of await Promise.all(readQueries())) { assert.equal(read.status, 200); assert.equal(read.error, null); assert.deepEqual(read.data, []); }
    for (let i = 0; i < 2; i++) {
      const response = await auditRequest(); assert.equal(response.status, 200);
      assert.deepEqual((await response.json()).accepted_event_ids, [eventId]);
    }
    const rows = (await db.query('select user_id,auth_session_id,actor_kind,action_type from public.audit_logs where event_id=$1', [eventId])).rows;
    assert.deepEqual(rows, [{ user_id: owner.id, auth_session_id: owner.sessionId, actor_kind: 'user', action_type: 'PAGE_VIEW' }]);
    assert.equal((await db.query('select count(*)::int n from public.auth_session_audit_context where user_id=$1 and auth_session_id=$2', [owner.id, owner.sessionId])).rows[0].n, 1);
    for (const table of ['admin_issues', 'admin_issue_comments', 'admin_issue_reads', 'message_notifications', 'audit_logs', 'auth_session_audit_context']) {
      const row = (await db.query('select relrowsecurity from pg_class where oid=$1::regclass', ['public.' + table])).rows[0];
      assert.equal(row.relrowsecurity, true);
    }
  });
  await check('主页依赖保留原RLS：普通用户只见自己反馈和提醒，不能读取其他会话审计', async () => {
    const a = await person('viewer', 'home-viewer-a'), b = await person('viewer', 'home-viewer-b');
    const issue = randomUUID();
    await db.query("insert into public.admin_issues(id,title,source,created_by) values($1,'合成私有反馈','user_feedback',$2)", [issue, a.email]);
    const message = (await db.query("insert into public.messages(user_email,user_name,content) values($1,'合成','合成提醒') returning id", [a.email])).rows[0].id;
    await db.query('insert into public.message_notifications(message_id,recipient_user_id) values($1,$2)', [message, a.id]);
    await db.query('insert into public.admin_issue_reads(issue_id,user_id) values($1,$2)', [issue, a.id]);
    for (const [table, field, value] of [['admin_issues', 'id', issue], ['message_notifications', 'message_id', message], ['admin_issue_reads', 'issue_id', issue]]) {
      const own = await a.client.from(table).select(field).eq(field, value), other = await b.client.from(table).select(field).eq(field, value);
      assert.equal(own.error, null); assert.equal(own.data.length, 1);
      assert.equal(other.error, null); assert.deepEqual(other.data, []);
    }
    assert.ok((await b.client.from('auth_session_audit_context').select('auth_session_id')).error);
    await db.query('delete from public.messages where id=$1', [message]);
    await db.query('delete from public.admin_issues where id=$1', [issue]);
  });
}
