import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import pg from 'pg';
import { createLeaseTestDatabase, OWNER, OTHER, ADMIN, VIEWER, recordId } from '../lease-change-history/database.mjs';
import { gatewayDrill } from './gateway.mjs';

const source = (p) => readFile(new URL(p, import.meta.url), 'utf8');
const migration = '../../migrations/20261027155909_restrict_backup_callable_write_functions.sql';
const db = await createLeaseTestDatabase();
const baseline = JSON.parse(await source('./function-baseline.json'));
const security = JSON.parse(await source('./security-baseline.json'));
const backupRole = `backup_probe_${randomBytes(8).toString('hex')}`;
const password = randomBytes(32).toString('hex');
const issue = '66666666-6666-4666-8666-666666666666';
let backupClient;
let passed = 0;
const test = async (name, run) => { await run(); console.log(`PASS ${++passed} ${name}`); };
const email = (uid) => `${uid.slice(0,8)}@synthetic.invalid`;
async function asRole(role, uid, sql, args = []) {
  await db.setup.query('begin');
  try {
    await db.setup.query("select set_config('request.jwt.claim.sub','',true),set_config('request.jwt.claims',$1,true)", [JSON.stringify(uid ? { sub: uid, email: email(uid) } : {})]);
    await db.setup.query(`set local role ${role}`);
    const result = await db.setup.query(sql, args);
    await db.setup.query('commit'); return result;
  } catch (error) { await db.setup.query('rollback'); throw error; }
}
const asUser = (uid, sql, args) => asRole('authenticated', uid, sql, args);
const snapshot = async () => (await db.setup.query(`select
 (select jsonb_agg(to_jsonb(t) order by id) from public.admin_issues t) issues,
 (select jsonb_agg(to_jsonb(t) order by id) from public.admin_issue_comments t) comments,
 (select jsonb_agg(to_jsonb(t) order by issue_id,user_id) from public.admin_issue_reads t) reads,
 (select jsonb_agg(to_jsonb(t) order by id) from public.lease_transactions t) leases,
 (select jsonb_agg(to_jsonb(t) order by id) from public.audit_logs t) audit,
 (select jsonb_agg(to_jsonb(t) order by user_id) from public.user_roles t) roles,
 (select jsonb_agg(to_jsonb(t) order by id) from public.update_drafts t) drafts,
 (select jsonb_agg(to_jsonb(t) order by id) from auth.users t) users`)).rows[0];
const catalog = async () => (await db.setup.query(`select
 (select jsonb_agg(to_jsonb(t) order by schemaname,tablename,policyname) from pg_policies t) policies,
 (select jsonb_agg(jsonb_build_object('name',tgname,'enabled',tgenabled,'definition',pg_get_triggerdef(oid)) order by oid) from pg_trigger where not tgisinternal) triggers,
 (select jsonb_agg(jsonb_build_object('name',oid::regprocedure::text,'definition',pg_get_functiondef(oid),'owner',proowner) order by oid) from pg_proc where pronamespace in ('public'::regnamespace,'private'::regnamespace)) functions,
 (select jsonb_agg(jsonb_build_object('name',oid::regclass::text,'acl',relacl,'owner',relowner,'rls',relrowsecurity) order by oid) from pg_class where relnamespace in ('public'::regnamespace,'private'::regnamespace)) relations`)).rows[0];
const acls = async () => (await db.setup.query(`select p.oid::regprocedure::text signature,
 a.grantee,a.grantor,a.privilege_type,a.is_grantable from pg_proc p,
 lateral aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
 where p.pronamespace in ('public'::regnamespace,'private'::regnamespace)
 order by p.oid,a.grantee,a.grantor,a.privilege_type`)).rows;
const denyBackup = async () => {
  await backupClient.query('begin read write');
  try {
    await backupClient.query("select set_config('request.jwt.claim.sub','',true),set_config('request.jwt.claims',$1,true)", [JSON.stringify({ sub: OWNER, email: email(OWNER) })]);
    await assert.rejects(backupClient.query('select public.feedback_mark_read($1)', [issue]), (e) => e.code === '42501');
  } finally { await backupClient.query('rollback'); }
};
try {
  await db.repair();
  await db.setup.query(`create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb);
    alter table public.user_roles add column email text,add column full_name text;
    create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb $$;
    create schema storage; create table storage.objects(bucket_id text,name text);
    alter table storage.objects enable row level security;
    create table public.app_settings(key text primary key,value text);
    insert into public.app_settings values('current_submission_year','2026'),('current_submission_quarter','3');
    create table public.update_drafts(id int primary key,user_id uuid,record_year int,record_quarter int,draft_data jsonb);
    grant usage on schema public,auth to anon,service_role;
  `);
  for (const uid of [OWNER, OTHER, ADMIN, VIEWER]) await db.setup.query('insert into auth.users values($1,$2,$3)', [uid,email(uid),{}]);
  const adminSchema = await source('../../migrations/20260801110130_restore_quarterly_oss_admin.sql');
  await db.setup.query(adminSchema.slice(adminSchema.indexOf('create table public.admin_issues ('),adminSchema.indexOf('create index building_assignments_user_idx')));
  await db.setup.query(`alter table public.admin_issues enable row level security;alter table public.admin_issue_comments enable row level security;
    grant select,insert,update,delete on public.admin_issues,public.admin_issue_comments to authenticated;
    create policy "admin manage issues" on public.admin_issues for all to authenticated using(private.is_admin()) with check(private.is_admin());
    create policy "admin manage issue comments" on public.admin_issue_comments for all to authenticated using(private.is_admin()) with check(private.is_admin());`);
  await db.setup.query(await source('../../migrations/20260911195000_add_user_feedback_access.sql'));
  await db.setup.query(await source('../../migrations/20260914110000_feedback_v2_closed_loop.sql'));
  await db.setup.query('grant select,insert,update,delete on public.admin_issue_reads to authenticated');
  // Definitions and ACLs are the reviewed source-function metadata, no records
  // or credentials. Dependencies are isolated synthetic schemas above.
  for (const fn of baseline) {
    const existing=await db.setup.query('select prosrc from pg_proc where oid=to_regprocedure($1)',[fn.signature]);
    if(existing.rowCount && fn.signature!=='private.is_admin()') {
      assert.equal(existing.rows[0].prosrc,fn.definition.split('AS $function$')[1].split('$function$')[0],`Historical migration body matches source: ${fn.signature}`);
    }
    await db.setup.query(fn.definition);
  }
  for (const fn of security) for (const acl of fn.acl) if (acl.grantee !== 'PUBLIC' && acl.grantee !== 'postgres') {
    await db.setup.query(`grant execute on function ${fn.signature} to ${acl.grantee}`);
  }
  await db.setup.query(`create trigger auth_user_created_profile after insert on auth.users for each row execute function private.handle_new_user();
    create trigger update_drafts_fill_identity_period before insert or update on public.update_drafts for each row execute function private.fill_update_draft_identity_period();
    grant select,insert,update on public.update_drafts to authenticated;
    grant insert on auth.users to service_role;
    create role ${backupRole} login inherit bypassrls nosuperuser nocreatedb nocreaterole noreplication password '${password}';
    grant pg_read_all_data to ${backupRole};
    alter role ${backupRole} set default_transaction_read_only=on;`);
  backupClient = new pg.Client({ host:'127.0.0.1',port:Number(process.env.LEASE_TEST_PG_PORT),database:db.database,user:backupRole,password });
  await backupClient.connect();
  await asUser(OWNER,"insert into public.admin_issues(id,title,description,source,created_by) values($1,'Synthetic feedback','Synthetic detail','user_feedback',$2)",[issue,email(OWNER)]);
  await test('old real feedback RPC bypasses read-table account when native claims are forged', async () => {
    await assert.rejects(denyBackup(), assert.AssertionError);
    await backupClient.query('begin read write');
    await backupClient.query("select set_config('request.jwt.claims',$1,true)",[JSON.stringify({sub:OWNER,email:email(OWNER)})]);
    await backupClient.query('select public.feedback_mark_read($1)',[issue]);
    await backupClient.query('commit');
    assert.equal((await db.setup.query('select count(*)::int n from public.admin_issue_reads')).rows[0].n,1);
    await db.setup.query('delete from public.admin_issue_reads');
  });
  await test('definition drift after an earlier revoke rolls the entire migration back', async () => {
    const fn=baseline.find(f=>f.signature==='feedback_reopen(uuid,text)');
    await db.setup.query(fn.definition.replace("feedback_not_reopenable","synthetic_definition_drift"));
    const before=await acls();
    await assert.rejects(db.setup.query(await source(migration)),/Backup permission precondition failed/);
    await db.setup.query('rollback');assert.deepEqual(await acls(),before);
    await db.setup.query(fn.definition);
  });
  await test('missing explicit application grant refuses repair and preserves existing permissions', async () => {
    await db.setup.query('revoke execute on function public.feedback_mark_read(uuid) from authenticated');
    const before=await acls();
    await assert.rejects(db.setup.query(await source(migration)),/Application EXECUTE grant missing/);
    await db.setup.query('rollback');assert.deepEqual(await acls(),before);
    await db.setup.query('grant execute on function public.feedback_mark_read(uuid) to authenticated');
  });
  const beforeData=await snapshot(),beforeCatalog=await catalog(),beforeACL=await acls();
  await db.setup.query(await source(migration));
  await test('migration changes only nine PUBLIC function grants; rows and business catalog unchanged', async () => {
    assert.deepEqual(await snapshot(),beforeData);assert.deepEqual(await catalog(),beforeCatalog);
    const after=await acls();assert.deepEqual(after.filter(a=>a.grantee!==0),beforeACL.filter(a=>a.grantee!==0));
    assert.equal(beforeACL.length-after.length,9);
  });
  await test('native backup login cannot call RPC, escalate role, or directly write despite forged claims', async () => {
    const before=await snapshot();await denyBackup();
    await assert.rejects(backupClient.query('set role authenticated'),e=>e.code==='42501');
    await backupClient.query('begin read write');
    await assert.rejects(backupClient.query('update public.admin_issues set title=title'),e=>e.code==='42501');
    await backupClient.query('rollback');assert.deepEqual(await snapshot(),before);
  });
  await test('all nine functions deny backup EXECUTE; read helpers and full row reads remain available', async () => {
    const rows=(await backupClient.query("select p.oid::regprocedure::text signature,has_function_privilege(current_user,p.oid,'EXECUTE') allowed from pg_proc p where p.pronamespace in ('public'::regnamespace,'private'::regnamespace) and p.prosecdef order by 1")).rows;
    const allowed=rows.filter(r=>r.allowed).map(r=>r.signature);
    for(const fn of baseline){const read=fn.signature.startsWith('private.current_submission_')||fn.signature==='private.is_admin()'||fn.signature.startsWith('private.is_current_submission_period(');assert.equal(allowed.includes(fn.signature),read,fn.signature);}
    assert.equal((await backupClient.query('select count(*)::int n from public.user_roles')).rows[0].n,4);
  });
  await test('authenticated owner can mark read; another owner and anonymous are denied', async () => {
    await asUser(OWNER,'select public.feedback_mark_read($1)',[issue]);
    await assert.rejects(asUser(OTHER,'select public.feedback_mark_read($1)',[issue]),e=>e.code==='42501');
    await assert.rejects(asRole('anon',null,'select public.feedback_mark_read($1)',[issue]),e=>e.code==='42501');
  });
  await test('admin reply and resolution retain nested read, status history and activity triggers', async () => {
    const result=await asUser(ADMIN,"select * from public.feedback_admin_reply($1,'Synthetic response','{}','resolved')",[issue]);
    assert.equal(result.rows[0].status,'resolved');assert.equal(result.rows[0].resolved_by,email(ADMIN));
    const comments=(await db.setup.query('select * from public.admin_issue_comments order by created_at,id')).rows;
    assert.equal(comments.filter(c=>c.kind==='comment').length,1);assert.equal(comments.filter(c=>c.kind==='status_change').length,1);
    assert.deepEqual(comments.find(c=>c.kind==='status_change').metadata,{from:'open',to:'resolved'});
    assert.ok(result.rows[0].last_admin_activity_at);
    assert.equal((await db.setup.query('select count(*)::int n from public.admin_issue_reads where user_id=$1',[ADMIN])).rows[0].n,1);
  });
  await test('owner reopens with comment; original status history and resolution clearing survive', async () => {
    const result=await asUser(OWNER,"select * from public.feedback_reopen($1,'Synthetic follow-up')",[issue]);
    assert.equal(result.rows[0].status,'open');assert.equal(result.rows[0].resolved_at,null);assert.equal(result.rows[0].resolved_by,'');assert.ok(result.rows[0].reopened_at);
    assert.equal((await db.setup.query("select count(*)::int n from public.admin_issue_comments where kind='status_change'")).rows[0].n,2);
  });
  await test('unauthorized reply and status failure leave all business rows unchanged', async () => {
    const before=await snapshot();
    await assert.rejects(asUser(OTHER,"select public.feedback_admin_reply($1,'Rejected','{}','resolved')",[issue]),e=>e.code==='42501');
    await assert.rejects(asUser(ADMIN,"select public.feedback_admin_reply($1,'Rejected','{}','invalid')",[issue]),e=>e.code==='22023');
    assert.deepEqual(await snapshot(),before);
  });
  await test('new-user profile and draft identity triggers run without caller EXECUTE', async () => {
    const signup='77777777-7777-4777-8777-777777777777';
    await asRole('service_role',null,"insert into auth.users values($1,'signup@synthetic.invalid','{\"full_name\":\"Synthetic signup\"}')",[signup]);
    const profile=(await db.setup.query('select * from public.user_roles where user_id=$1',[signup])).rows[0];
    assert.equal(profile.role,'viewer');assert.equal(profile.full_name,'Synthetic signup');
    const draft=await asUser(OWNER,"insert into public.update_drafts(id,draft_data) values(1,'{}') returning *");
    assert.equal(draft.rows[0].user_id,OWNER);assert.equal(draft.rows[0].record_year,2026);assert.equal(draft.rows[0].record_quarter,3);
  });
  await test('real lease edit still writes accurate audit without caller trigger EXECUTE', async () => {
    await asUser(OWNER,'update public.lease_transactions set face_rent=221 where id=$1',[recordId()]);
    const row=(await db.setup.query("select * from public.audit_logs where action_type='LEASE_TRANSACTION_UPDATE'")).rows[0];
    assert.equal(row.user_id,OWNER);assert.equal(row.details.change_count,1);assert.equal(row.old_values.face_rent,220);assert.equal(row.new_values.face_rent,221);
  });
  await test('backup cannot attach privileged trigger to a crafted temporary table', async () => {
    await backupClient.query('begin read write');
    await backupClient.query('create temporary table synthetic_comments(issue_id uuid,created_at timestamptz,is_admin boolean)');
    await assert.rejects(backupClient.query('create trigger synthetic_injection after insert on synthetic_comments for each row execute function public.feedback_comment_touch_activity()'),e=>e.code==='42501');
    await backupClient.query('rollback');
  });
  await test('reapplying ACL migration is idempotent and keeps data and grants unchanged', async () => {
    const data=await snapshot(),acl=await acls();await db.setup.query(await source(migration));
    assert.deepEqual(await snapshot(),data);assert.deepEqual(await acls(),acl);
  });
  await gatewayDrill(db,issue,test);
  console.log(`Backup permission regressions: ${passed} passed; PostgreSQL 17; synthetic data only.`);
} finally {
  await backupClient?.end().catch(()=>{});
  await db.setup.query('rollback').catch(()=>{});
  await db.setup.query(`drop owned by ${backupRole}; drop role if exists ${backupRole}`).catch(()=>{});
  await db.close();
}
