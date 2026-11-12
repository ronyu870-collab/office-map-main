import assert from 'node:assert/strict';
import { createLeaseTestDatabase, OWNER, OTHER, ADMIN, VIEWER, recordId } from './database.mjs';

const db = await createLeaseTestDatabase();
let passed = 0;
async function test(name, run) { await run(); passed++; console.log(`PASS ${name}`); }
const snapshot = async () => (await db.setup.query('select to_jsonb(t) as row from public.lease_transactions t where id=$1', [recordId()])).rows[0].row;
const history = async () => (await db.setup.query('select * from public.audit_logs order by id')).rows;
const update = (uid, set, values = [], n = 1) => db.asUser(uid, `update public.lease_transactions set ${set} where id=$${values.length + 1} returning *`, [...values, recordId(n)]);
const catalog = async () => (await db.setup.query(`select
  (select jsonb_agg(to_jsonb(p) order by policyname) from pg_policies p where schemaname='public') as policies,
  (select jsonb_agg(jsonb_build_object('oid',oid,'name',tgname,'enabled',tgenabled,'definition',pg_get_triggerdef(oid)) order by tgname) from pg_trigger where tgrelid='public.lease_transactions'::regclass and not tgisinternal) as triggers,
  (select jsonb_build_object('owner',proowner,'acl',proacl,'security_definer',prosecdef,'config',proconfig) from pg_proc where oid='private.audit_lease_transaction_update()'::regprocedure) as function_security`)).rows[0];

try {
  console.log(`Database: ${db.version}`);
  await test('unchanged save succeeds before repair and produces no audit', async () => {
    assert.equal((await update(OWNER, 'face_rent=face_rent')).rowCount, 1);
    assert.equal((await history()).length, 0);
  });
  await test('original actual edit fails with 42883 and rolls back the entire row', async () => {
    const before = await snapshot();
    await assert.rejects(update(OWNER, 'face_rent=$1', [230]), (e) => e.code === '42883' && e.message.includes('jsonb_object_length(jsonb) does not exist'));
    assert.deepEqual(await snapshot(), before);
    assert.equal((await history()).length, 0);
  });
  const beforeCatalog = await catalog();
  await db.repair();
  await test('repair preserves policies, trigger identities and function security', async () => {
    assert.deepEqual(await catalog(), beforeCatalog);
  });
  await test('owner edits one field, reads it back and gets authoritative audit snapshots', async () => {
    assert.equal((await update(OWNER, 'face_rent=$1', [230])).rowCount, 1);
    assert.equal((await db.asUser(OWNER, 'select face_rent::text as rent from public.lease_transactions where id=$1', [recordId()])).rows[0].rent, '230');
    const [event] = await history();
    assert.equal(event.user_id, OWNER);
    assert.equal(event.action_type, 'LEASE_TRANSACTION_UPDATE');
    assert.equal(event.target_id, recordId());
    assert.equal(event.target_table, 'lease_transactions');
    assert.equal(event.request_source, 'database_trigger');
    assert.equal(event.module, 'lease-submission');
    assert.equal(event.details.change_count, 1);
    assert.deepEqual(event.details.changed_fields, { face_rent: { old: 220, new: 230 } });
    assert.equal(event.old_values.face_rent, 220);
    assert.equal(event.new_values.face_rent, 230);
    assert.ok(!('updated_at' in event.old_values));
    assert.ok(!('updated_at' in event.new_values));
    assert.match(event.event_id, /^[0-9a-f-]{36}$/);
  });
  await test('multiple fields and null to value produce the exact field count', async () => {
    await update(OWNER, 'face_rent=$1, remarks=$2', [240, 'Synthetic note']);
    const event = (await history()).at(-1);
    assert.equal(event.details.change_count, 2);
    assert.deepEqual(event.details.changed_fields, { face_rent: { old: 230, new: 240 }, remarks: { old: null, new: 'Synthetic note' } });
  });
  await test('value to null is audited; unchanged and timestamp-only saves add no history', async () => {
    await update(OWNER, 'remarks=null');
    const events = await history();
    assert.equal(events.at(-1).details.change_count, 1);
    assert.deepEqual(events.at(-1).details.changed_fields, { remarks: { old: 'Synthetic note', new: null } });
    await update(OWNER, 'face_rent=face_rent');
    await update(OWNER, 'updated_at=now()');
    assert.equal((await history()).length, events.length);
  });
  await test('other editor and viewer cannot update, or read/write private audit history', async () => {
    const before = await snapshot();
    const events = (await history()).length;
    assert.equal((await update(OTHER, 'face_rent=300')).rowCount, 0);
    assert.equal((await update(VIEWER, 'face_rent=300', [], 3)).rowCount, 0);
    assert.equal((await db.asUser(OWNER, 'select * from public.audit_logs')).rowCount, 0);
    await assert.rejects(db.asUser(OWNER, "insert into public.audit_logs(user_id,action_type) values ($1,'FAKE')", [OWNER]), (e) => e.code === '42501');
    assert.deepEqual(await snapshot(), before);
    assert.equal((await history()).length, events);
  });
  await test('viewer and editor read the same transaction rows; viewer cannot insert, change or delete even own records', async () => {
    const sql = 'select id, company, data_source, face_rent from public.lease_transactions order by id';
    const editor = await db.asUser(OWNER, sql);
    const viewer = await db.asUser(VIEWER, sql);
    assert.deepEqual(viewer.rows, editor.rows);
    assert.deepEqual(viewer.rows.map(row => row.id), [recordId(1), recordId(2), recordId(3), recordId(4)]);
    const auditCount = (await history()).length;
    await assert.rejects(db.asUser(VIEWER, "insert into public.lease_transactions (id, company, submitter_id, data_source) values ($1,'Synthetic deny',$2,'broker_submission')", [recordId(9), VIEWER]), error => error.code === '42501');
    assert.equal((await update(VIEWER, 'face_rent=1', [], 3)).rowCount, 0);
    assert.equal((await db.asUser(VIEWER, 'delete from public.lease_transactions where id=$1 returning id', [recordId(3)])).rowCount, 0);
    assert.deepEqual((await db.asUser(VIEWER, sql)).rows, viewer.rows);
    assert.equal((await history()).length, auditCount);
  });
  await test('ownership and source changes remain denied by WITH CHECK', async () => {
    const before = await snapshot();
    await assert.rejects(update(OWNER, 'submitter_id=$1', [OTHER]), (e) => e.code === '42501');
    await assert.rejects(update(OWNER, "data_source='historical_import'"), (e) => e.code === '42501');
    await assert.rejects(update(ADMIN, 'face_rent=230', [], 4), (e) => e.code === '42501');
    assert.deepEqual(await snapshot(), before);
  });
  await test('admin can edit another submitter; history identifies the admin actor', async () => {
    assert.equal((await update(ADMIN, 'face_rent=250', [], 2)).rowCount, 1);
    const event = (await history()).at(-1);
    assert.equal(event.user_id, ADMIN);
    assert.equal(event.target_id, recordId(2));
    assert.equal(event.new_values.submitter_id, OTHER);
    assert.equal((await db.asUser(ADMIN, 'select * from public.audit_logs')).rowCount, (await history()).length);
  });
  await test('stale optimistic-lock timestamp changes no row and adds no audit', async () => {
    const count = (await history()).length;
    const result = await db.asUser(OWNER, "update public.lease_transactions set face_rent=260 where id=$1 and updated_at='2000-01-01' returning id", [recordId()]);
    assert.equal(result.rowCount, 0);
    assert.equal((await history()).length, count);
  });
  await test('audit insertion failure rolls back business fields and updated_at', async () => {
    const before = await snapshot();
    const count = (await history()).length;
    await db.setup.query("alter table public.audit_logs add constraint synthetic_audit_failure check ((new_values->>'remarks') is distinct from 'reject-history')");
    await assert.rejects(update(OWNER, "remarks='reject-history', face_rent=999"), (e) => e.code === '23514' && e.constraint === 'synthetic_audit_failure');
    assert.deepEqual(await snapshot(), before);
    assert.equal((await history()).length, count);
    await db.setup.query('alter table public.audit_logs drop constraint synthetic_audit_failure');
  });
  await test('repair is reapplicable and retains system-actor fallback', async () => {
    await db.repair();
    await db.setup.query('update public.lease_transactions set face_rent=245 where id=$1', [recordId()]);
    assert.equal((await history()).at(-1).user_id, 'system');
    assert.deepEqual(await catalog(), beforeCatalog);
  });
  console.log(`PASS all ${passed} lease audit PostgreSQL regression cases`);
} finally {
  await db.close();
}
