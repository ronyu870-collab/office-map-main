import assert from 'node:assert/strict';
import { randomUUID, randomBytes } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import pg from 'pg';
import { createAiQueryTestDatabase, grantQuery, SESSION } from '../ai-query-authority/database.mjs';
import { OWNER, ADMIN, VIEWER } from '../lease-change-history/database.mjs';
import { loadAuditPrerequisites, applyAdminOnly } from './database.mjs';
const db = await createAiQueryTestDatabase(), results = [];
const config = { host: '127.0.0.1', port: Number(process.env.LEASE_TEST_PG_PORT), user: 'postgres', password: 'synthetic_ci_only', database: db.database };
const service = new pg.Client(config); await service.connect(); await service.query('set role service_role');
const check = async (scenario, fn) => { await fn(); results.push({ scenario, status: 'passed' }); console.log('PASS ' + scenario); };
const cipher = () => ({ version: 1, algorithm: 'aes-256-gcm', keyId: 'isolated-role-test', nonce: randomBytes(12).toString('hex'), tag: randomBytes(16).toString('hex'), ciphertext: 'ab' });
const authority = async (actor = OWNER, session = SESSION, effective = actor) => (await service.query('select public.ai_query_authority($1,$2,$3) r', [actor, effective, session])).rows[0].r;
const read = async (actor = OWNER, session = SESSION) => {
  const id = randomUUID(), filter = { action: 'list', from: new Date(Date.now() - 86400000).toISOString(), to: new Date().toISOString() };
  return { id, ...(await service.query('select public.ai_audit_console_read($1,$1,$2,$3,$4,$5,$6) r', [actor, session, id, filter, 'a'.repeat(64), cipher()])).rows[0].r };
};
try {
  await loadAuditPrerequisites(db);
  await db.setup.query('update private.ai_query_control set enabled=true'); await grantQuery(db, OWNER);
  await db.setup.query("insert into private.ai_audit_read_grants(user_id,valid_until,grant_reference) values($1,now()+interval '1 day','synthetic audit qualification')", [OWNER]);
  await check('pre-upgrade qualified editor can query/read audit, contradicting the new admin-only requirement', async () => {
    const oldQuery = await authority(), oldRead = await read();
    assert.equal(oldQuery.allowed, true); assert.equal(oldRead.allowed, true);
    assert.throws(() => assert.equal(oldQuery.allowed, false)); assert.throws(() => assert.equal(oldRead.allowed, false));
  });
  await applyAdminOnly(db);
  await check('existing qualifications cannot permit viewer or editor after upgrade; failed reads leave audit history', async () => {
    for (const role of ['viewer', 'editor']) {
      await db.setup.query('update public.user_roles set role=$1 where user_id=$2', [role, OWNER]);
      assert.equal((await authority()).allowed, false); const denied = await read(); assert.equal(denied.allowed, false);
      assert.equal((await db.setup.query('select outcome from private.ai_audit_console_access where access_id=$1', [denied.id])).rows[0].outcome, 'denied');
    }
  });
  await check('current admin still needs independent query and audit grants; policy marker is explicit', async () => {
    const adminSession = randomUUID(); await db.setup.query('insert into auth.sessions(id,user_id) values($1,$2)', [adminSession, ADMIN]);
    assert.equal((await authority(ADMIN, adminSession)).allowed, false); assert.equal((await read(ADMIN, adminSession)).allowed, false);
    await grantQuery(db, ADMIN); assert.equal((await authority(ADMIN, adminSession)).access_policy, 'admin-only/1');
    assert.equal((await read(ADMIN, adminSession)).allowed, false);
    await db.setup.query("update public.user_roles set role='admin' where user_id=$1", [OWNER]);
    assert.equal((await authority()).access_policy, 'admin-only/1'); assert.equal((await read()).access_policy, 'admin-only/1');
    assert.equal((await authority(OWNER, SESSION, ADMIN)).allowed, false);
    assert.equal((await authority(OWNER, SESSION, VIEWER)).allowed, false);
  });
  await check('demotion invalidates a current session and prevents preparing an already-read audit response', async () => {
    const prior = await read(); assert.equal(prior.allowed, true);
    await db.setup.query("update public.user_roles set role='viewer' where user_id=$1", [OWNER]);
    assert.equal((await authority()).allowed, false);
    const prepared = (await service.query('select public.ai_audit_console_prepare($1,$1,$2,$3,$4,$5,$6) r', [OWNER, SESSION, randomUUID(), prior.id, [], 'b'.repeat(64)])).rows[0].r;
    assert.equal(prepared.allowed, false); assert.equal(prepared.access_policy, 'admin-only/1');
    await db.setup.query("update public.user_roles set role='admin' where user_id=$1", [OWNER]);
  });
  await check('role revocation waits for an in-flight authorization lock then denies the next read', async () => {
    const writer = new pg.Client(config); await writer.connect(); let change;
    try {
      await service.query('begin'); assert.equal((await authority()).allowed, true);
      change = writer.query("update public.user_roles set role='viewer' where user_id=$1", [OWNER]);
      let waiting = false;
      for (let i = 0; i < 100; i++) { if ((await db.setup.query("select 1 from pg_stat_activity where pid=$1 and wait_event_type='Lock'", [writer.processID])).rowCount) { waiting = true; break; } await new Promise(resolve => setTimeout(resolve, 20)); }
      assert.equal(waiting, true); await service.query('commit'); await change;
      assert.equal((await authority()).allowed, false); assert.equal((await read()).allowed, false);
    } finally { await service.query('rollback'); await change?.catch(() => {}); await writer.end(); }
  });
  await check('raw authority and audit RPCs remain unavailable to authenticated clients', async () => {
    await assert.rejects(() => db.asUser(ADMIN, 'select public.ai_query_authority($1,$1,$2)', [ADMIN, SESSION]), /permission denied/);
    assert.equal((await service.query('select public.ai_query_audit_read($1,$1,$2) r', [OWNER, randomUUID()])).rows[0].r.allowed, false);
  });
  await mkdir('verification/ai-admin-only', { recursive: true });
  await writeFile('verification/ai-admin-only/results.json', JSON.stringify({ database: db.version, scenarios: results, production: false }, null, 2) + '\n');
  console.log(`PASS ${results.length} real PostgreSQL admin-only scenarios`);
} finally { await service.end(); await db.close(); }
