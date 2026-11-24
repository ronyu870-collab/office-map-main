import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import pg from 'pg';
import { createLeaseTestDatabase, OWNER, OTHER, ADMIN, VIEWER, recordId } from '../lease-change-history/database.mjs';

const db = await createLeaseTestDatabase();
const THIRD = '66666666-6666-4666-8666-666666666666';
const MISSING = '99999999-9999-4999-8999-999999999999';
const migration = new URL('../../migrations/20261027013818_secure_lease_submission_transfer.sql', import.meta.url);
const sql = 'select public.transfer_lease_submission_v1($1,$2,$3,$4,$5,$6) as result';
const baselineTimestamp = '2026-10-26T01:02:03.123456Z';
let count = 0;
let seedRow;
async function test(name, run) { await run(); count++; console.log(`PASS ${name}`); }
const snapshot = async (n = 1) => (await db.setup.query('select to_jsonb(t) as row from public.lease_transactions t where id=$1', [recordId(n)])).rows[0]?.row;
const stats = async () => (await db.setup.query(`select (select count(*)::int from public.audit_logs) as audits,(select count(*)::int from private.lease_transfer_requests) as receipts`)).rows[0];
const input = (patch = {}) => ({ requestId: randomUUID(), actor: OWNER, id: recordId(), target: OTHER, expectedOwner: OWNER, expectedAt: baselineTimestamp, ...patch });
const values = (p) => [p.requestId,p.actor,p.id,p.target,p.expectedOwner,p.expectedAt];
async function connection() {
  const c = new pg.Client({ host: '127.0.0.1', port: Number(process.env.LEASE_TEST_PG_PORT), database: db.database, user: 'postgres', password: 'synthetic_ci_only', connectionTimeoutMillis: 5000 });
  await c.connect();
  await c.query("set statement_timeout='8s'");
  return c;
}
// Observe a real PostgreSQL lock wait, including another waiter ahead of this
// backend. A timer is only a bounded poll budget, never the synchronization.
async function blockedBy(client, blocker) {
  const result=await db.setup.query(`with recursive chain(pid,path) as (
    select $1::int,array[$1::int]
    union all select b.pid,c.path||b.pid from chain c,
      lateral unnest(pg_catalog.pg_blocking_pids(c.pid)) b(pid)
      where not b.pid=any(c.path)
  ) select exists(select 1 from chain where pid=$2::int) as blocked`,[client.processID,blocker.processID]);
  return result.rows[0].blocked;
}
async function waitBlocked(client,blocker,label) {
  const deadline=performance.now()+1500;
  while(performance.now()<deadline) {
    if(await blockedBy(client,blocker)) return;
    await new Promise(resolve=>setTimeout(resolve,5));
  }
  assert.fail(`Did not observe PostgreSQL lock wait: ${label}`);
}
function observe(promise) {
  const tracked={settled:false,result:null,promise:null};
  tracked.promise=promise.then(value=>({status:'fulfilled',value}),reason=>({status:'rejected',reason}))
    .then(result=>{tracked.result=result;tracked.settled=true;return result;});
  return tracked;
}
async function waitSettledOrBlocked(tracked,client,blocker,label) {
  const deadline=performance.now()+1500;
  while(performance.now()<deadline) {
    if(tracked.settled || await blockedBy(client,blocker)) return;
    await new Promise(resolve=>setTimeout(resolve,5));
  }
  assert.fail(`Did not observe completion or PostgreSQL lock wait: ${label}`);
}
async function call(p, client = db.setup, role = 'service_role') {
  await client.query('begin');
  try {
    assert.ok(['service_role','authenticated','anon'].includes(role));
    await client.query(`set local role ${role}`);
    const result = (await client.query(sql,values(p))).rows[0].result;
    await client.query('commit');
    return result;
  } catch (e) { await client.query('rollback'); throw e; }
}
async function reset() {
  await db.setup.query('truncate private.lease_transfer_requests,public.audit_logs');
  await db.setup.query('update auth.users set banned_until=null,deleted_at=null');
  await db.setup.query("update public.user_roles set role=case when user_id=$1 then 'admin' when user_id=$2 then 'viewer' else 'editor' end,chinese_name='Synthetic name',full_name='Verified recipient',email='synthetic@example.invalid'", [ADMIN,VIEWER]);
  await replaceRow({ ...seedRow, submitter_id: OWNER, submitter_name: 'Previous owner', original_submitter_id: 'legacy:original', original_submitter_name: 'Original evidence', updated_at: baselineTimestamp });
  await db.setup.query('truncate public.audit_logs');
}
async function replaceRow(row) {
  // Fixture preparation uses INSERT, so both UPDATE triggers remain enabled
  // for every mutation and concurrency/failure assertion.
  await db.setup.query('delete from public.lease_transactions where id=$1',[row.id]);
  await db.setup.query('insert into public.lease_transactions select * from jsonb_populate_record(null::public.lease_transactions,$1::jsonb)',[JSON.stringify(row)]);
}
const rejection = (p, message, client, role) => assert.rejects(call(p,client,role),(e)=>e.message===message);
const catalog = async () => (await db.setup.query(`select
 (select jsonb_agg(to_jsonb(p) order by policyname) from pg_policies p where schemaname='public') as policies,
 (select jsonb_agg(jsonb_build_object('oid',oid,'def',pg_get_triggerdef(oid),'enabled',tgenabled) order by tgname) from pg_trigger where tgrelid='public.lease_transactions'::regclass and not tgisinternal) as triggers,
 (select jsonb_build_object('source',prosrc,'acl',proacl,'owner',proowner,'security',prosecdef,'config',proconfig) from pg_proc where oid='private.audit_lease_transaction_update()'::regprocedure) as audit_function,
 (select jsonb_agg(jsonb_build_object('table',c.relname,'acl',c.relacl) order by c.relname) from pg_class c where c.oid in ('public.lease_transactions'::regclass,'public.user_roles'::regclass,'public.audit_logs'::regclass)) as grants`)).rows[0];

try {
  console.log(`Database: ${db.version}`);
  await db.repair();
  await db.setup.query(`create table auth.users(id uuid primary key,banned_until timestamptz,deleted_at timestamptz);
    alter table public.user_roles add column full_name text,add column email text;
    insert into public.user_roles values ('${THIRD}','editor','Synthetic third',null,null);
    insert into auth.users(id) select user_id from public.user_roles;
    update public.user_roles set full_name='Verified recipient',email='synthetic@example.invalid';`);
  seedRow=await snapshot();
  const beforeCatalog = await catalog();
  await db.setup.query(await readFile(migration,'utf8'));
  await test('additive migration preserves existing policies, grants, triggers and audit function', async () => assert.deepEqual(await catalog(),beforeCatalog));
  await reset();
  await test('browser roles cannot execute the service-only RPC or forge/read receipts', async () => {
    for (const role of ['anon','authenticated']) {
      await assert.rejects(call(input(),db.setup,role),(e)=>e.code==='42501');
    }
    await assert.rejects(db.asUser(OWNER,'select * from private.lease_transfer_requests'),(e)=>e.code==='42501');
    await assert.rejects(db.asUser(OWNER,"insert into private.lease_transfer_requests(actor_id,request_id,submission_id,target_user_id,result) values ($1,$2,$3,$4,'{}')",[OWNER,randomUUID(),recordId(),OTHER]),(e)=>e.code==='42501');
    assert.deepEqual(await stats(),{audits:0,receipts:0});
  });
  await test('owner transfers only attribution fields; legacy originals, values and other records remain exact', async () => {
    const before=await snapshot(); const untouched=await snapshot(2); const request=input();
    const result=await call(request); const after=await snapshot();
    assert.equal(result.targetUserName,'Verified recipient'); assert.equal(result.replayed,false);
    assert.equal(after.submitter_id,OTHER);assert.equal(after.submitter_name,'Verified recipient');
    const strip=({submitter_id,submitter_name,updated_at,...rest})=>rest;
    assert.deepEqual(strip(after),strip(before)); assert.deepEqual(await snapshot(2),untouched);
    const events=(await db.setup.query('select * from public.audit_logs order by id')).rows;
    assert.equal(events.length,2); assert.ok(events.every(e=>e.user_id===OWNER));
    assert.equal(events[0].action_type,'LEASE_TRANSACTION_UPDATE'); assert.equal(events[0].details.change_count,2);
    assert.deepEqual(Object.keys(events[0].details.changed_fields).sort(),['submitter_id','submitter_name']);
    assert.equal(events[1].action_type,'TRANSFER_SUBMISSION');assert.equal(events[1].details.request_id,request.requestId);
    assert.equal(events[1].details.original_submitter_id,OWNER);assert.equal(events[1].details.target_user_name,'Verified recipient');
    assert.deepEqual(await stats(),{audits:2,receipts:1});
    assert.notEqual(after.updated_at,before.updated_at);
  });
  await test('same request replays its receipt exactly without new writes or audit', async () => {
    const receipt=(await db.setup.query('select * from private.lease_transfer_requests')).rows[0];
    const p=input({requestId:receipt.request_id}); const before=await snapshot(); const totals=await stats();
    const replay=await call(p); assert.deepEqual({...replay,replayed:false},receipt.result);
    assert.deepEqual(await snapshot(),before);assert.deepEqual(await stats(),totals);
  });
  await test('same key with different target or old precondition is rejected', async () => {
    const r=(await db.setup.query('select * from private.lease_transfer_requests')).rows[0];
    await rejection(input({requestId:r.request_id,target:THIRD}),'REQUEST_PAYLOAD_MISMATCH');
    await rejection(input({requestId:r.request_id,expectedOwner:'legacy:another'}),'REQUEST_PAYLOAD_MISMATCH');
    assert.deepEqual(await stats(),{audits:2,receipts:1});
  });
  await test('an old receipt remains confirmable after the recipient is deleted', async () => {
    const r=(await db.setup.query('select * from private.lease_transfer_requests')).rows[0];
    const before=await snapshot();const totals=await stats();
    try {
      await db.setup.query('delete from public.user_roles where user_id=$1',[OTHER]);
      await db.setup.query('delete from auth.users where id=$1',[OTHER]);
      const result=await call(input({requestId:r.request_id}));
      assert.deepEqual({...result,replayed:false},r.result);
      assert.deepEqual(await snapshot(),before);assert.deepEqual(await stats(),totals);
    } finally {
      await db.setup.query('insert into auth.users(id) values($1)',[OTHER]);
      await db.setup.query("insert into public.user_roles(user_id,role,chinese_name,full_name,email) values ($1,'editor','Synthetic name','Verified recipient','synthetic@example.invalid')",[OTHER]);
    }
  });
  await reset();
  await test('recipient display name falls back safely for blank profile names', async () => {
    await db.setup.query("update public.user_roles set full_name='   ',chinese_name='中文姓名' where user_id=$1",[OTHER]);
    const result=await call(input());assert.equal(result.targetUserName,'中文姓名');
    assert.equal((await snapshot()).submitter_name,'中文姓名');
  });
  await reset();
  await test('unknown, banned, deleted, viewer/admin, test, null-name and null-email recipients reject without changes', async () => {
    const before=await snapshot();
    await rejection(input({target:MISSING}),'TRANSFER_TARGET_INVALID');
    for (const field of ['banned_until','deleted_at']) {
      await db.setup.query(`update auth.users set ${field}='2099-01-01' where id=$1`,[OTHER]);
      await rejection(input(),'TRANSFER_TARGET_INVALID');
      await db.setup.query(`update auth.users set ${field}=null where id=$1`,[OTHER]);
    }
    for (const role of ['viewer','admin']) {
      await db.setup.query('update public.user_roles set role=$1 where user_id=$2',[role,OTHER]);
      await rejection(input(),'TRANSFER_TARGET_INVALID');
    }
    await db.setup.query("update public.user_roles set role='editor' where user_id=$1",[OTHER]);
    for (const [column,value] of [['chinese_name','测试账号'],['chinese_name',null],['email',null]]) {
      await db.setup.query(`update public.user_roles set ${column}=$1 where user_id=$2`,[value,OTHER]);
      await rejection(input(),'TRANSFER_TARGET_INVALID');
      await db.setup.query("update public.user_roles set chinese_name='Synthetic name',email='synthetic@example.invalid' where user_id=$1",[OTHER]);
    }
    assert.deepEqual(await snapshot(),before);assert.deepEqual(await stats(),{audits:0,receipts:0});
  });
  await test('viewer, non-owner, missing, banned and deleted actors cannot transfer', async () => {
    const before=await snapshot();
    await rejection(input({actor:VIEWER}),'TRANSFER_ACTOR_FORBIDDEN');
    await rejection(input({actor:THIRD}),'TRANSFER_OWNER_FORBIDDEN');
    await rejection(input({actor:MISSING}),'TRANSFER_ACTOR_FORBIDDEN');
    for(const field of ['banned_until','deleted_at']) {
      await db.setup.query(`update auth.users set ${field}='2099-01-01' where id=$1`,[OWNER]);
      await rejection(input(),'TRANSFER_ACTOR_FORBIDDEN');
      await db.setup.query(`update auth.users set ${field}=null where id=$1`,[OWNER]);
    }
    assert.deepEqual(await snapshot(),before);assert.deepEqual(await stats(),{audits:0,receipts:0});
  });
  await test('stale owner or microsecond version rejects and creates no receipt', async () => {
    const before=await snapshot();
    await rejection(input({expectedOwner:'legacy:wrong'}),'STALE_RECORD');
    await rejection(input({expectedAt:'2026-10-26T01:02:03.123Z'}),'STALE_RECORD');
    assert.deepEqual(await snapshot(),before);assert.deepEqual(await stats(),{audits:0,receipts:0});
  });
  await test('admin can transfer historical imports without rewriting original attribution/source', async () => {
    const before=await snapshot(4);const result=await call(input({actor:ADMIN,id:recordId(4),expectedAt:before.updated_at,expectedOwner:before.submitter_id}));
    const after=await snapshot(4);assert.equal(after.data_source,'historical_import');assert.equal(after.submitter_id,OTHER);
    assert.deepEqual(after.original_submitter_id,before.original_submitter_id);assert.equal(result.targetUserName,'Verified recipient');
    assert.ok((await db.setup.query('select user_id from public.audit_logs where target_id=$1',[recordId(4)])).rows.every(r=>r.user_id===ADMIN));
  });
  await reset();
  await test('null and legacy textual owners/versions use explicit null-safe CAS for admin', async () => {
    for(const owner of [null,'legacy:owner']) {
      await replaceRow({ ...seedRow,submitter_id:owner,updated_at:null });
      const before=await snapshot();await call(input({actor:ADMIN,expectedOwner:owner,expectedAt:null}));
      const after=await snapshot();assert.equal(after.submitter_id,OTHER);assert.equal(after.original_submitter_id,before.original_submitter_id);
    }
  });
  await reset();
  await test('trigger or transfer audit failure atomically rolls back row, timestamp and receipt', async () => {
    const before=await snapshot();
    for (const action of ['LEASE_TRANSACTION_UPDATE','TRANSFER_SUBMISSION']) {
      await db.setup.query(`alter table public.audit_logs add constraint synthetic_transfer_audit_failure check(action_type <> '${action}')`);
      try { await assert.rejects(call(input()),e=>e.code==='23514'); }
      finally { await db.setup.query('alter table public.audit_logs drop constraint synthetic_transfer_audit_failure'); }
      assert.deepEqual(await snapshot(),before);assert.deepEqual(await stats(),{audits:0,receipts:0});
    }
    assert.deepEqual(await snapshot(),before);assert.deepEqual(await stats(),{audits:0,receipts:0});
  });
  await test('receipt insertion failure atomically rolls back both audits and business row', async () => {
    const before=await snapshot();
    await db.setup.query('alter table private.lease_transfer_requests add constraint synthetic_receipt_failure check(false)');
    try { await assert.rejects(call(input()),e=>e.code==='23514'); }
    finally { await db.setup.query('alter table private.lease_transfer_requests drop constraint synthetic_receipt_failure'); }
    assert.deepEqual(await snapshot(),before);assert.deepEqual(await stats(),{audits:0,receipts:0});
  });
  await test('RPC restores caller JWT subject after attributing the real update trigger', async () => {
    await db.setup.query('begin');
    try {
      await db.setup.query("select set_config('request.jwt.claim.sub',$1,true)",[THIRD]);
      await db.setup.query('set local role service_role');
      await db.setup.query(sql,values(input()));
      assert.equal((await db.setup.query("select current_setting('request.jwt.claim.sub') as sub")).rows[0].sub,THIRD);
      await db.setup.query('commit');
    } catch(e) { await db.setup.query('rollback');throw e; }
  });
  await reset();
  await test('two independent connections from one stale view produce exactly one transfer', async () => {
    const c1=await connection(),c2=await connection(),blocker=await connection();
    try {
      await blocker.query('begin');
      await blocker.query('select id from public.lease_transactions where id=$1 for update',[recordId()]);
      const a=input({actor:ADMIN}),b=input({actor:ADMIN,target:THIRD});
      const pending=Promise.allSettled([call(a,c1),call(b,c2)]);
      await waitBlocked(c1,blocker,'first stale-view call reaches lease lock');
      await waitBlocked(c2,blocker,'second stale-view call reaches lease lock');
      await blocker.query('commit');
      const results=await pending;
      assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
      const failure=results.find(r=>r.status==='rejected');assert.equal(failure.reason.message,'STALE_RECORD');
      assert.deepEqual(await stats(),{audits:2,receipts:1});
    } finally {await blocker.query('rollback').catch(()=>{});await blocker.end();await c1.end();await c2.end();}
  });
  await reset();
  await test('simultaneous duplicate request has one commit and one receipt replay', async () => {
    const c1=await connection(),c2=await connection(),blocker=await connection();
    try {
      await blocker.query('begin');
      await blocker.query('select id from public.lease_transactions where id=$1 for update',[recordId()]);
      const p=input(),first=observe(call(p,c1));
      await waitBlocked(c1,blocker,'first duplicate request reaches lease lock');
      const second=observe(call(p,c2));
      await waitBlocked(c2,c1,'second duplicate request reaches request lock');
      await blocker.query('commit');
      const results=await Promise.all([first.promise,second.promise]);
      assert.ok(results.every(r=>r.status==='fulfilled'));
      assert.deepEqual(results.map(r=>r.value.replayed).sort(),[false,true]);assert.deepEqual(await stats(),{audits:2,receipts:1});
    }
    finally{await blocker.query('rollback').catch(()=>{});await blocker.end();await c1.end();await c2.end();}
  });
  await reset();
  await test('committed result lost in transit is confirmed by the same key after reconnect', async () => {
    const c=await connection(),p=input();
    await call(p,c);await c.end(); // Deliberately discard the committed response.
    const before=await snapshot();const replay=await call(p);assert.equal(replay.replayed,true);
    assert.deepEqual(await snapshot(),before);assert.deepEqual(await stats(),{audits:2,receipts:1});
    // A later legitimate transfer does not make the old request run again.
    await call(input({actor:ADMIN,target:THIRD,expectedOwner:OTHER,expectedAt:before.updated_at}));
    const later=await snapshot();const oldReceipt=await call(p);
    assert.equal(oldReceipt.targetUserId,OTHER);assert.equal(oldReceipt.replayed,true);
    assert.equal((await snapshot()).submitter_id,THIRD);assert.deepEqual(await snapshot(),later);
  });
  await reset();
  await test('recipient status is revalidated after a concurrent ban commits', async () => {
    const blocker=await connection(),runner=await connection();
    try {
      await blocker.query('begin');await blocker.query("update auth.users set banned_until='2099-01-01' where id=$1",[OTHER]);
      const p=observe(call(input(),runner));
      await waitBlocked(runner,blocker,'recipient status update precedes qualification');
      await blocker.query('commit');
      const result=await p.promise;assert.equal(result.status,'rejected');assert.equal(result.reason.message,'TRANSFER_TARGET_INVALID');assert.deepEqual(await stats(),{audits:0,receipts:0});
    } finally {await blocker.query('rollback').catch(()=>{});await blocker.end();await runner.end();}
  });
  await test('recipient role is revalidated after a concurrent demotion commits', async () => {
    const blocker=await connection(),runner=await connection();
    try {
      await db.setup.query('update auth.users set banned_until=null where id=$1',[OTHER]);
      await blocker.query('begin');await blocker.query("update public.user_roles set role='viewer' where user_id=$1",[OTHER]);
      const p=observe(call(input(),runner));
      await waitBlocked(runner,blocker,'recipient role update precedes qualification');
      await blocker.query('commit');
      const result=await p.promise;assert.equal(result.status,'rejected');assert.equal(result.reason.message,'TRANSFER_TARGET_INVALID');assert.deepEqual(await stats(),{audits:0,receipts:0});
    } finally {await blocker.query('rollback').catch(()=>{});await blocker.end();await runner.end();}
  });
  await reset();
  await test('locked qualification prevents recipient role/status changes before transfer commits', async () => {
    for(const kind of ['role','status']) {
      await reset();
      const blocker=await connection(),runner=await connection(),writer=await connection();
      let pending,change;
      try {
        await blocker.query('begin');
        await blocker.query('select id from public.lease_transactions where id=$1 for update',[recordId()]);
        pending=observe(call(input(),runner));
        await waitBlocked(runner,blocker,'qualified transfer waits at lease row');
        const update=kind==='role'
          ? "update public.user_roles set role='viewer' where user_id=$1"
          : "update auth.users set banned_until='2099-01-01' where id=$1";
        change=observe(writer.query(update,[OTHER]));
        await waitBlocked(writer,runner,`recipient ${kind} is protected until transfer commit`);
        assert.equal(change.settled,false);
        await blocker.query('commit');
        const transferred=await pending.promise,changed=await change.promise;
        assert.equal(transferred.status,'fulfilled');assert.equal(changed.status,'fulfilled');
        assert.equal((await snapshot()).submitter_id,OTHER);assert.deepEqual(await stats(),{audits:2,receipts:1});
      } finally {
        await blocker.query('rollback').catch(()=>{});
        if(pending) await pending.promise;
        if(change) await change.promise;
        await blocker.end();await runner.end();await writer.end();
      }
    }
  });
  await reset();
  await test('a recipient profile inserted after the qualification snapshot cannot bypass its lock', async () => {
    const actorBlocker=await connection(),recordBlocker=await connection(),runner=await connection(),writer=await connection();
    const before=await snapshot();let pending;
    try {
      await db.setup.query('delete from public.user_roles where user_id=$1',[OTHER]);
      await actorBlocker.query('begin');
      await actorBlocker.query('select user_id from public.user_roles where user_id=$1 for update',[OWNER]);
      await recordBlocker.query('begin');
      await recordBlocker.query('select id from public.lease_transactions where id=$1 for update',[recordId()]);
      pending=observe(call(input(),runner));
      await waitBlocked(runner,actorBlocker,'qualification snapshot waits on actor profile');
      await writer.query("insert into public.user_roles(user_id,role,chinese_name,full_name,email) values ($1,'editor','Synthetic inserted','Inserted recipient','synthetic@example.invalid')",[OTHER]);
      await actorBlocker.query('commit');
      await waitSettledOrBlocked(pending,runner,recordBlocker,'qualification rejects initial absence or reaches lease lock');
      // In the faulty implementation the later unlocked SELECT saw the newly
      // inserted profile, yet this demotion can commit before lease transfer.
      await writer.query("set lock_timeout='500ms'");
      await writer.query("update public.user_roles set role='viewer' where user_id=$1",[OTHER]);
      await recordBlocker.query('commit');
      const result=await pending.promise;
      assert.equal(result.status,'rejected','a newly visible, unlocked recipient must not be used');
      assert.equal(result.reason.message,'TRANSFER_TARGET_INVALID');
      assert.deepEqual(await snapshot(),before);assert.deepEqual(await stats(),{audits:0,receipts:0});
    } finally {
      await actorBlocker.query('rollback').catch(()=>{});await recordBlocker.query('rollback').catch(()=>{});
      if(pending) await pending.promise;
      await actorBlocker.end();await recordBlocker.end();await runner.end();await writer.end();
      await db.setup.query("insert into public.user_roles(user_id,role,chinese_name,full_name,email) values ($1,'editor','Synthetic name','Verified recipient','synthetic@example.invalid') on conflict(user_id) do update set role=excluded.role,chinese_name=excluded.chinese_name,full_name=excluded.full_name,email=excluded.email",[OTHER]);
    }
  });
  await test('existing owner writes still obey RLS after the additive repair', async () => {
    await assert.rejects(db.asUser(OWNER,'update public.lease_transactions set submitter_id=$1 where id=$2',[OTHER,recordId()]),e=>e.code==='42501');
    assert.deepEqual(await catalog(),beforeCatalog);
  });
  console.log(`PASS ${count} lease transfer PostgreSQL regressions`);
} finally { await db.close(); }
