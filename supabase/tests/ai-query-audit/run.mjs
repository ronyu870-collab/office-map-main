import assert from 'node:assert/strict';
import { randomUUID, createCipheriv, randomBytes, createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import pg from 'pg';
import { createLeaseTestDatabase, OWNER, OTHER, ADMIN } from '../lease-change-history/database.mjs';

const db = await createLeaseTestDatabase();
let count = 0;
const check = async (name, action) => { await action(); count++; console.log(`PASS ${name}`); };
const cipher = () => {
  const nonce = randomBytes(12), key = randomBytes(32);
  const aes = createCipheriv('aes-256-gcm', key, nonce);
  const body = Buffer.concat([aes.update('synthetic question only', 'utf8'), aes.final()]);
  return { version: 1, algorithm: 'aes-256-gcm', keyId: 'synthetic', nonce: nonce.toString('hex'), tag: aes.getAuthTag().toString('hex'), ciphertext: body.toString('hex') };
};
const digest = createHash('sha256').update('synthetic body').digest('hex');
const asRole = async (role, sql, args = []) => {
  await db.setup.query('begin');
  try {
    await db.setup.query(`set local role ${role}`);
    const result = await db.setup.query(sql, args);
    await db.setup.query('commit');
    return result;
  } catch (error) { await db.setup.query('rollback'); throw error; }
};
const receive = (requestId, eventId, actor = OWNER, effective = actor, payloadDigest = digest, body = cipher()) => asRole('service_role', 'select public.ai_query_audit_receive($1,$2,$3,$4,$5,$6,$7) result', [requestId,eventId,actor,effective,'policy-v1',payloadDigest,body]);
const append = (requestId, kind, eventId = randomUUID(), payloadDigest = digest) => asRole('service_role', 'select public.ai_query_audit_append($1,$2,$3,$4,$5) result', [requestId,eventId,kind,payloadDigest,cipher()]);
const read = (actor, requestId, effective = actor) => asRole('service_role', 'select public.ai_query_audit_read($1,$2,$3) result', [actor,effective,requestId]);
try {
  for(const migration of ['20261113003933_ai_query_audit_foundation.sql','20261113032515_ai_query_http_security.sql','20261113080906_ai_query_execution_reconciliation.sql'])
    await db.setup.query(await readFile(new URL('../../migrations/'+migration,import.meta.url),'utf8'));
  const requestId = randomUUID(), firstEvent = randomUUID();
  await check('receive atomically stores ciphertext and protected identity snapshots', async () => {
    const receipt = (await receive(requestId,firstEvent)).rows[0].result;
    assert.equal(receipt.sequence,1); assert.equal(receipt.identity_valid,true);
    const stored = (await db.setup.query('select * from private.ai_query_audit_streams where request_id=$1',[requestId])).rows[0];
    assert.equal(stored.actor_id,OWNER); assert.equal(stored.effective_user_id,OWNER); assert.equal(stored.actor_role,'editor');
    assert.equal(stored.state,'received');
    assert.equal((await db.setup.query('select cipher from private.ai_query_audit_events where request_id=$1',[requestId])).rows[0].cipher.algorithm,'aes-256-gcm');
  });
  await check('same request/event is idempotent; body and identity mismatches fail', async () => {
    assert.equal((await receive(requestId,firstEvent)).rows[0].result.replayed,true);
    await assert.rejects(receive(requestId,firstEvent,OWNER,OWNER,'a'.repeat(64)), /idempotency conflict/);
    await assert.rejects(receive(requestId,firstEvent,OTHER), /idempotency conflict/);
    assert.equal((await db.setup.query('select count(*)::int n from private.ai_query_audit_events where request_id=$1',[requestId])).rows[0].n,1);
  });
  await check('anonymous and authenticated users cannot call RPC, including admin JWT context', async () => {
    for (const role of ['anon','authenticated']) {
      await assert.rejects(asRole(role,'select public.ai_query_audit_read($1,$1,$2)',[ADMIN,requestId]),error=>error.code==='42501');
      await assert.rejects(asRole(role,'select public.ai_query_audit_receive($1,$2,$3,$3,$4,$5,$6)',[randomUUID(),randomUUID(),ADMIN,'policy-v1',digest,cipher()]),error=>error.code==='42501');
    }
  });
  await check('service role has no raw table read/update/delete or self-grant permission', async () => {
    for (const sql of ['select * from private.ai_query_audit_events','delete from private.ai_query_audit_events',"update private.ai_query_audit_streams set state='succeeded'",'select * from private.ai_audit_read_grants',`insert into private.ai_audit_read_grants values ('${ADMIN}',now()+interval '1 day','self-grant')`]) {
      await assert.rejects(asRole('service_role',sql),error=>error.code==='42501');
    }
  });
  await check('malformed/plaintext payload rolls back request creation', async () => {
    const bad = randomUUID();
    await assert.rejects(receive(bad,randomUUID(),OWNER,OWNER,digest,{ question:'plaintext' }), /invalid audit ciphertext/);
    assert.equal((await db.setup.query('select count(*)::int n from private.ai_query_audit_streams where request_id=$1',[bad])).rows[0].n,0);
  });
  await check('forged impersonation is recorded but cannot enter running state', async () => {
    const invalid = randomUUID();
    assert.equal((await receive(invalid,randomUUID(),OWNER,ADMIN)).rows[0].result.identity_valid,false);
    await assert.rejects(append(invalid,'running'), /invalid audit transition/);
    await append(invalid,'denied');
  });
  await check('real admin simulation keeps effective target role', async () => {
    const simulated = randomUUID();
    await receive(simulated,randomUUID(),ADMIN,OTHER);
    const row=(await db.setup.query('select * from private.ai_query_audit_streams where request_id=$1',[simulated])).rows[0];
    assert.equal(row.actor_role,'admin'); assert.equal(row.effective_role,'editor'); assert.equal(row.effective_user_id,OTHER);
  });
  await check('sequences and transitions preserve terminal answers; correction appends', async () => {
    await assert.rejects(append(requestId,'succeeded'), /invalid audit transition/);
    await append(requestId,'running'); await append(requestId,'response_generated'); await append(requestId,'succeeded');
    await assert.rejects(append(requestId,'running'), /invalid audit transition/);
    await append(requestId,'accounting'); await append(requestId,'correction');
    const events=(await db.setup.query('select * from private.ai_query_audit_events where request_id=$1 order by sequence',[requestId])).rows;
    assert.deepEqual(events.map(event=>Number(event.sequence)),[1,2,3,4,5,6]);
    for(let i=1;i<events.length;i++)assert.equal(events[i].previous_hash,events[i-1].event_hash);
    assert.equal((await db.setup.query('select state from private.ai_query_audit_streams where request_id=$1',[requestId])).rows[0].state,'succeeded');
  });
  await check('ordinary admin cannot read others questions; denial itself is audited', async () => {
    assert.deepEqual((await read(ADMIN,requestId)).rows[0].result,{allowed:false});
    assert.deepEqual((await read(ADMIN,randomUUID())).rows[0].result,{allowed:false});
    assert.equal((await db.setup.query('select count(*)::int n from private.ai_audit_access_events where actor_id=$1 and not allowed',[ADMIN])).rows[0].n,2);
  });
  await check('explicit auditor can read encrypted history; simulation and expired grants cannot', async () => {
    await db.setup.query('insert into private.ai_audit_read_grants values($1,now()+interval \'1 day\',$2)',[ADMIN,'isolated-test-grant']);
    const result=(await read(ADMIN,requestId)).rows[0].result;
    assert.equal(result.allowed,true); assert.equal(result.record.events.length,6);
    assert.equal((await read(ADMIN,requestId,OTHER)).rows[0].result.allowed,false);
    await db.setup.query('update private.ai_audit_read_grants set valid_until=now()-interval \'1 second\'');
    assert.equal((await read(ADMIN,requestId)).rows[0].result.allowed,false);
  });
  await check('audit event failure rolls back both stream and event, allowing reliable retry', async () => {
    await db.setup.query("create function private.fail_audit_test() returns trigger language plpgsql as $$ begin raise exception 'injected audit storage failure'; end $$; create trigger fail_audit before insert on private.ai_query_audit_events for each row execute function private.fail_audit_test()");
    const failed = randomUUID(), eventId=randomUUID();
    await assert.rejects(receive(failed,eventId), /injected audit storage failure/);
    assert.equal((await db.setup.query('select count(*)::int n from private.ai_query_audit_streams where request_id=$1',[failed])).rows[0].n,0);
    await db.setup.query('drop trigger fail_audit on private.ai_query_audit_events');
    assert.equal((await receive(failed,eventId)).rows[0].result.sequence,1);
  });
  await check('concurrent workers serialize events without gaps or lost head updates', async () => {
    const concurrent=randomUUID(); await receive(concurrent,randomUUID()); await append(concurrent,'running');
    const clients=Array.from({length:8},()=>new pg.Client({host:'127.0.0.1',port:Number(process.env.LEASE_TEST_PG_PORT),user:'postgres',password:'synthetic_ci_only',database:db.database}));
    try {
      await Promise.all(clients.map(async client=>{await client.connect();await client.query('set role service_role');await client.query('select public.ai_query_audit_append($1,$2,$3,$4,$5)',[concurrent,randomUUID(),'tool_started',digest,cipher()]);}));
    } finally {await Promise.all(clients.map(client=>client.end()));}
    const events=(await db.setup.query('select * from private.ai_query_audit_events where request_id=$1 order by sequence',[concurrent])).rows;
    assert.deepEqual(events.map(event=>Number(event.sequence)),[1,2,3,4,5,6,7,8,9,10]);
    assert.equal((await db.setup.query('select head_hash from private.ai_query_audit_streams where request_id=$1',[concurrent])).rows[0].head_hash,events.at(-1).event_hash);
  });
  await check('independently captured head detects body edits, deleted middle and tail events', async () => {
    const anchor=(await db.setup.query('select head_hash,head_sequence from private.ai_query_audit_streams where request_id=$1',[requestId])).rows[0];
    const verify=()=>asRole('service_role','select public.ai_query_audit_verify($1,$2,$3) valid',[requestId,anchor.head_hash,anchor.head_sequence]);
    assert.equal((await verify()).rows[0].valid,true);
    for(const sql of [
      "update private.ai_query_audit_events set cipher=jsonb_set(cipher,'{ciphertext}','\"00\"') where request_id=$1 and sequence=2",
      'delete from private.ai_query_audit_events where request_id=$1 and sequence=2',
      'delete from private.ai_query_audit_events where request_id=$1 and sequence=6',
      "update private.ai_query_audit_streams set actor_role='forged' where request_id=$1",
    ]) {
      await db.setup.query('begin');
      try {
        await db.setup.query(sql,[requestId]);
        assert.equal((await db.setup.query('select private.ai_query_audit_verify($1,$2,$3) valid',[requestId,anchor.head_hash,anchor.head_sequence])).rows[0].valid,false);
      } finally {await db.setup.query('rollback');}
    }
    assert.equal((await verify()).rows[0].valid,true);
  });
  console.log(`PASS ${count} AI query audit PostgreSQL 17 scenarios; synthetic isolated database only`);
} finally { await db.close(); }
