// Real PostgreSQL 17, separate connections, synthetic fixture only.
// Deliberately refuses arbitrary URLs, credentials, hosts and non-CI execution.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import pg from 'pg';

if (process.env.GITHUB_ACTIONS !== 'true') throw new Error('Run only in the disposable GitHub Actions PostgreSQL service');
const port = Number(process.env.QUARTERLY_TEST_PG_PORT);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Missing disposable service port');
const connection = { host: '127.0.0.1', port, user: 'postgres', password: 'synthetic_ci_only', connectionTimeoutMillis: 5_000 };
const UID = '11111111-1111-4111-8111-111111111111';
const BUILDING = '33333333-3333-4333-8333-333333333333';
const sqlFile = (path) => readFile(new URL(path, import.meta.url), 'utf8');
const fixture = await sqlFile('./fixture.sql');
const oldRPCs = await sqlFile('../../migrations/20260928015050_harden_quarterly_period_rollover_and_submission.sql');
const latestSource = await sqlFile('../../migrations/20260928020602_reconcile_entered_market_future_supplies.sql');
const setterStart = latestSource.indexOf('create or replace function public.set_current_submission_period(');
const setterEnd = latestSource.lastIndexOf('commit;');
assert.ok(setterStart >= 0 && setterEnd > setterStart);
const oldSetter = latestSource.slice(setterStart, setterEnd);
const expansion = await sqlFile('../../migrations/20261008075610_preserve_quarterly_drafts_and_idempotent_submission.sql');
const sequenceHardening = await sqlFile('../../migrations/20261009020453_restrict_quarterly_history_sequence_client_privileges.sql');
const sequencePrivileges = await sqlFile('./sequence-privileges.sql');
const freeze = await sqlFile('../../../docs/quarterly-rollout/02_freeze_quarter_configuration.sql');
const allClients = new Set();
const reports = [];

async function client(database, label, authenticated = false) {
  const c = new pg.Client({ ...connection, database, application_name: `quarterly-synthetic-${label}` });
  // Intentional transport-disconnect cases must not create an unhandled event.
  c.on('error', () => {});
  await c.connect(); allClients.add(c);
  await c.query("SET statement_timeout = '8s'");
  await c.query("SELECT set_config('test.user_id',$1,false), set_config('test.can_write','true',false), set_config('test.is_admin','true',false)", [UID]);
  if (authenticated) await c.query('SET ROLE authenticated');
  c.testPid = (await c.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
  return c;
}
async function close(c) { if (!allClients.delete(c)) return; await c.end().catch(() => {}); }
function outcome(promise) { return promise.then((value) => ({ value }), (error) => ({ error })); }
async function waitUntil(check, description, timeout = 5_000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) { if (await check()) return; await delay(20); }
  throw new Error(`Timed out observing ${description}`);
}
async function waiting(observer, pid, relation = null) {
  const result = await observer.query('SELECT EXISTS(SELECT 1 FROM pg_locks WHERE pid=$1 AND NOT granted AND ($2::text IS NULL OR relation=to_regclass($2))) AS waiting', [pid, relation]);
  return result.rows[0].waiting;
}
async function legacyHashes(c) {
  return (await c.query("SELECT proname, md5(pg_get_functiondef(oid)) AS hash FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname IN ('save_quarterly_draft','submit_quarterly_batch','set_current_submission_period') ORDER BY proname")).rows;
}
async function save(c, payload, revision, tab = 'GradeA', legacy = false) {
  const name = legacy ? 'save_quarterly_draft' : 'save_quarterly_draft_v2';
  return c.query(`SELECT * FROM public.${name}($1,$2,2026,3,$3,$4::jsonb,$5::bigint)`, [UID, 'Synthetic owner', tab, JSON.stringify(payload), revision]);
}
const batch = [{ building_id: BUILDING, total_area: 1000, vacant_area: 100, vacancy_rate: 10, asking_rent: 100, management_fee: 20, face_rent: 90, rent_free_period: 2 }];
function submit(c, id, rows = batch) {
  return c.query("SELECT * FROM public.submit_quarterly_batch_v2($1,$2,'Synthetic owner',2026,3,'GradeA',$3::jsonb,'[]'::jsonb)", [id, UID, JSON.stringify(rows)]);
}
async function counts(c) {
  return (await c.query('SELECT (SELECT count(*)::int FROM public.quarterly_submissions) AS submissions, (SELECT count(*)::int FROM public.quarterly_submission_provenance) AS provenance, (SELECT count(*)::int FROM private.quarterly_submission_requests) AS requests')).rows[0];
}

const admin = await client('postgres', 'admin');
const version = Number((await admin.query("SELECT current_setting('server_version_num') AS v")).rows[0].v);
assert.ok(version >= 170000 && version < 180000, 'The CI service must be PostgreSQL 17');
// The service is fresh and disposable. Roles are cluster-wide, databases are per case.
for (const role of ['anon', 'authenticated', 'service_role']) await admin.query(`CREATE ROLE ${role}`);
const fixtureWithoutRoles = fixture.replace(/^create role (anon|authenticated|service_role);\r?\n/gm, '');
assert.equal((fixture.match(/^create role /gm) ?? []).length, 3);

async function test(name, run) {
  const database = `quarterly_synthetic_${randomUUID().replaceAll('-', '')}`;
  await admin.query(`CREATE DATABASE ${database}`);
  const owned = [];
  const connect = async (label, auth = false) => { const c = await client(database, label, auth); owned.push(c); return c; };
  const setup = await connect('setup');
  try {
    await setup.query(fixtureWithoutRoles);
    await setup.query(oldRPCs);
    await setup.query(oldSetter);
    await run({ setup, connect });
    reports.push({ case: name, status: 'passed' });
    console.log(`PASS ${name}`);
  } finally {
    await Promise.all(owned.map(close));
    await waitUntil(async () => (await admin.query('SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname=$1', [database])).rows[0].n === 0, 'synthetic database connections to finish', 10_000);
    await admin.query(`DROP DATABASE ${database}`);
  }
}

try {
  await test('history sequence clients lose direct access while owner-definer legacy and v2 archives continue', async ({ setup, connect }) => {
    await setup.query(expansion);
    const beforeLegacy = await legacyHashes(setup);
    const beforeHistory = (await setup.query('SELECT * FROM public.quarterly_draft_history ORDER BY id')).rows;
    const beforeDrafts = (await setup.query('SELECT * FROM public.update_drafts ORDER BY id')).rows;
    // Negative control: broad defaults reproduce the production finding. The
    // exact privilege assertions must fail before the separate repair runs.
    await assert.rejects(setup.query(sequencePrivileges), (e) => e.code === 'P0004' && e.message.includes('history sequence'));
    await setup.query(sequenceHardening);
    await setup.query(sequencePrivileges);
    assert.deepEqual((await setup.query('SELECT * FROM public.quarterly_draft_history ORDER BY id')).rows, beforeHistory);
    assert.deepEqual((await setup.query('SELECT * FROM public.update_drafts ORDER BY id')).rows, beforeDrafts);
    assert.deepEqual(await legacyHashes(setup), beforeLegacy);
    await setup.query('REVOKE USAGE ON SCHEMA private FROM authenticated');
    assert.equal((await setup.query("SELECT has_schema_privilege('authenticated', 'private', 'USAGE') AS allowed")).rows[0].allowed, false);
    for (const role of ['anon', 'authenticated']) {
      const caller = await connect(`sequence-${role}`);
      await caller.query(`SET ROLE ${role}`);
      for (const sql of [
        'SELECT last_value FROM public.quarterly_draft_history_id_seq',
        "SELECT nextval('public.quarterly_draft_history_id_seq')",
        "SELECT setval('public.quarterly_draft_history_id_seq', 1)",
      ]) await assert.rejects(caller.query(sql), (e) => e.code === '42501');
    }
    const writer = await connect('sequence-protected-save', true);
    await save(writer, { phase: 'legacy-after-sequence-revoke' }, 1, 'GradeA', true);
    await save(writer, { phase: 'v2-after-sequence-revoke' }, 2);
    const rows = (await setup.query('SELECT id,event,snapshot FROM public.quarterly_draft_history ORDER BY id')).rows;
    assert.deepEqual(rows.map((r) => r.event), ['baseline', 'UPDATE', 'UPDATE']);
    assert.deepEqual(rows[1].snapshot.draft_data, { old: 42 });
    assert.deepEqual(rows[2].snapshot.draft_data, { phase: 'legacy-after-sequence-revoke' });
    assert.ok(BigInt(rows[0].id) < BigInt(rows[1].id) && BigInt(rows[1].id) < BigInt(rows[2].id));
    const current = (await setup.query('SELECT revision,draft_data FROM public.update_drafts')).rows[0];
    assert.equal(Number(current.revision), 3);
    assert.equal(current.draft_data.phase, 'v2-after-sequence-revoke');
    await setup.query(sequencePrivileges);
  });

  await test('A lock contention aborts all expansion objects without affecting the broker transaction', async ({ setup, connect }) => {
    const before = await legacyHashes(setup);
    const writer = await connect('held-legacy-save', true);
    const migrate = await connect('expansion-timeout');
    await writer.query('BEGIN');
    await save(writer, { phase: 'committed-before-boundary' }, 1, 'GradeA', true);
    const started = Date.now();
    const migration = outcome(migrate.query(expansion));
    await waitUntil(() => waiting(setup, migrate.testPid, 'public.update_drafts'), 'A waiting on live draft lock');
    const result = await migration;
    assert.equal(result.error?.code, '55P03');
    assert.ok(Date.now() - started < 5_000, '500ms lock timeout must not become an unbounded queue');
    await migrate.query('ROLLBACK');
    assert.equal((await setup.query("SELECT to_regclass('public.quarterly_draft_history') AS history")).rows[0].history, null);
    assert.equal((await setup.query("SELECT to_regprocedure('public.save_quarterly_draft_v2(uuid,text,integer,integer,text,jsonb,bigint)') AS rpc")).rows[0].rpc, null);
    assert.deepEqual(await legacyHashes(setup), before);
    await writer.query('COMMIT');
    assert.equal(Number((await setup.query('SELECT revision FROM public.update_drafts')).rows[0].revision), 2);
    assert.deepEqual((await setup.query('SELECT draft_data FROM public.update_drafts')).rows[0].draft_data, { phase: 'committed-before-boundary' });
  });

  await test('A baseline and triggers form one boundary around a queued legacy write while reads continue', async ({ setup, connect }) => {
    await save(setup, { phase: 'baseline' }, 1, 'GradeA', true);
    const before = await legacyHashes(setup);
    const migrate = await connect('expansion-boundary');
    const writer = await connect('queued-legacy-save', true);
    const boundary = 'lock table public.update_drafts in share row exclusive mode;';
    const index = expansion.indexOf(boundary);
    assert.ok(index > 0 && expansion.indexOf(boundary, index + 1) === -1);
    await migrate.query(expansion.slice(0, index + boundary.length));
    const queued = outcome(save(writer, { phase: 'after-boundary' }, 2, 'GradeA', true));
    await waitUntil(() => waiting(setup, writer.testPid, 'public.update_drafts'), 'legacy writer behind archive boundary');
    // AccessShare reads remain available under SHARE ROW EXCLUSIVE.
    assert.deepEqual((await setup.query('SELECT draft_data FROM public.update_drafts')).rows[0].draft_data, { phase: 'baseline' });
    await migrate.query(expansion.slice(index + boundary.length));
    const result = await queued; assert.ifError(result.error);
    assert.equal(Number(result.value.rows[0].revision), 3);
    const preserved = (await setup.query("SELECT event,snapshot FROM public.quarterly_draft_history WHERE event IN ('baseline','UPDATE') ORDER BY id")).rows;
    assert.equal(preserved.length, 2);
    for (const row of preserved) assert.deepEqual(row.snapshot.draft_data, { phase: 'baseline' });
    assert.deepEqual((await setup.query('SELECT draft_data FROM public.update_drafts')).rows[0].draft_data, { phase: 'after-boundary' });
    assert.deepEqual(await legacyHashes(setup), before);
    assert.equal((await migrate.query('SHOW lock_timeout')).rows[0].lock_timeout, '0');
    assert.equal((await migrate.query('SHOW statement_timeout')).rows[0].statement_timeout, '8s');
  });

  await test('A archive boundary also preserves a queued legitimate owner deletion', async ({ setup, connect }) => {
    await setup.query(`GRANT USAGE ON SCHEMA auth TO authenticated;
      GRANT SELECT, DELETE ON public.update_drafts TO authenticated;
      ALTER TABLE public.update_drafts ENABLE ROW LEVEL SECURITY;
      CREATE POLICY synthetic_owner_read ON public.update_drafts FOR SELECT TO authenticated USING(user_id=auth.uid());
      CREATE POLICY synthetic_owner_delete ON public.update_drafts FOR DELETE TO authenticated USING(user_id=auth.uid());`);
    const migrate = await connect('delete-boundary'); const writer = await connect('queued-owner-delete', true);
    const boundary = 'lock table public.update_drafts in share row exclusive mode;';
    const index = expansion.indexOf(boundary);
    await migrate.query(expansion.slice(0, index + boundary.length));
    const deletion = outcome(writer.query('DELETE FROM public.update_drafts WHERE user_id=$1', [UID]));
    await waitUntil(() => waiting(setup, writer.testPid, 'public.update_drafts'), 'owner deletion waiting on preservation boundary');
    await migrate.query(expansion.slice(index + boundary.length));
    assert.ifError((await deletion).error);
    assert.equal((await setup.query('SELECT count(*)::int AS n FROM public.update_drafts')).rows[0].n, 0);
    const evidence = (await setup.query('SELECT event,snapshot FROM public.quarterly_draft_history ORDER BY id')).rows;
    assert.deepEqual(evidence.map((row) => row.event), ['baseline', 'DELETE']);
    evidence.forEach((row) => assert.deepEqual(row.snapshot.draft_data, { old: 42 }));
  });

  await test('an archive insertion failure aborts the original update or deletion instead of losing evidence', async ({ setup, connect }) => {
    await setup.query(expansion);
    await setup.query(`CREATE FUNCTION private.synthetic_archive_failure() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN RAISE EXCEPTION 'synthetic archive failure' USING ERRCODE='23514'; END $$;
      CREATE TRIGGER synthetic_archive_failure BEFORE INSERT ON public.quarterly_draft_history
      FOR EACH ROW EXECUTE FUNCTION private.synthetic_archive_failure();`);
    const writer = await connect('archive-failure', true);
    for (const legacy of [true, false]) await assert.rejects(save(writer, { mustNotPersist: true }, 1, 'GradeA', legacy), (e) => e.code === '23514');
    await assert.rejects(setup.query('DELETE FROM public.update_drafts WHERE user_id=$1', [UID]), (e) => e.code === '23514');
    const row = (await setup.query('SELECT revision,draft_data FROM public.update_drafts')).rows[0];
    assert.equal(Number(row.revision), 1); assert.deepEqual(row.draft_data, { old: 42 });
    assert.equal((await setup.query('SELECT count(*)::int AS n FROM public.quarterly_draft_history')).rows[0].n, 1);
  });

  await test('same-owner legacy and v2 updates collide without silently overwriting the winning revision', async ({ setup, connect }) => {
    await setup.query(expansion);
    const old = await connect('legacy-save-race', true); const modern = await connect('v2-save-race', true);
    await setup.query('BEGIN'); await setup.query('SELECT id FROM public.update_drafts WHERE user_id=$1 FOR UPDATE', [UID]);
    const one = outcome(save(old, { client: 'legacy' }, 1, 'GradeA', true));
    const two = outcome(save(modern, { client: 'v2' }, 1));
    await waitUntil(async () => await waiting(setup, old.testPid) && await waiting(setup, modern.testPid), 'old and new clients waiting on one revision');
    await setup.query('COMMIT');
    const results = await Promise.all([one, two]);
    assert.equal(results.filter((r) => r.value).length, 1);
    assert.equal(results.find((r) => r.error)?.error.code, '40001');
    const row = (await setup.query('SELECT revision,draft_data FROM public.update_drafts')).rows[0];
    assert.equal(Number(row.revision), 2); assert.ok(['legacy', 'v2'].includes(row.draft_data.client));
    const oldVersion = (await setup.query("SELECT snapshot FROM public.quarterly_draft_history WHERE event='UPDATE'")).rows;
    assert.equal(oldVersion.length, 1); assert.deepEqual(oldVersion[0].snapshot.draft_data, { old: 42 });
    console.log('SAFETY: The losing old UI still needs its client/session safeguards; database conflict correctness does not recover unsaved browser memory.');
  });

  for (const [tab, revision] of [['GradeA', 1], ['GradeB', 0]]) {
    await test(`concurrent v2 saves ${revision ? 'update' : 'create'} exactly one revision and reject the loser`, async ({ setup, connect }) => {
      await setup.query(expansion);
      const left = await connect('save-left', true); const right = await connect('save-right', true);
      await setup.query('SELECT pg_advisory_lock(71403,hashtext($1))', [`${UID}:${tab}`]);
      const one = outcome(save(left, { contender: 'left' }, revision, tab));
      const two = outcome(save(right, { contender: 'right' }, revision, tab));
      await waitUntil(async () => await waiting(setup, left.testPid) && await waiting(setup, right.testPid), 'both save requests queued');
      await setup.query('SELECT pg_advisory_unlock(71403,hashtext($1))', [`${UID}:${tab}`]);
      const results = await Promise.all([one, two]);
      assert.equal(results.filter((r) => r.value).length, 1);
      assert.equal(results.find((r) => r.error)?.error.code, '40001');
      const row = (await setup.query('SELECT revision,draft_data FROM public.update_drafts WHERE user_id=$1 AND tab=$2', [UID, tab])).rows;
      assert.equal(row.length, 1); assert.equal(Number(row[0].revision), revision + 1);
      assert.ok(['left', 'right'].includes(row[0].draft_data.contender));
      assert.equal(row[0].draft_data.__quarterly_meta__.revision, revision + 1);
    });
  }

  await test('concurrent duplicate v2 submissions produce one ledger, provenance and formal row', async ({ setup, connect }) => {
    await setup.query(expansion);
    const left = await connect('submit-left', true); const right = await connect('submit-right', true);
    const id = randomUUID();
    await setup.query('SELECT pg_advisory_lock(71404,hashtext($1))', [`${UID}:${id}`]);
    const one = outcome(submit(left, id)); const two = outcome(submit(right, id));
    await waitUntil(async () => await waiting(setup, left.testPid) && await waiting(setup, right.testPid), 'duplicate requests waiting on idempotency lock');
    await setup.query('SELECT pg_advisory_unlock(71404,hashtext($1))', [`${UID}:${id}`]);
    const results = await Promise.all([one, two]); results.forEach((r) => assert.ifError(r.error));
    assert.deepEqual(results[0].value.rows, results[1].value.rows);
    assert.deepEqual(await counts(setup), { submissions: 1, provenance: 1, requests: 1 });
    await assert.rejects(submit(left, id, [{ ...batch[0], asking_rent: 999 }]), (e) => e.code === '22023' && e.message === 'submission_request_payload_mismatch');
    assert.deepEqual(await counts(setup), { submissions: 1, provenance: 1, requests: 1 });
  });

  await test('connection loss after commit replays the original receipt without a duplicate', async ({ setup, connect }) => {
    await setup.query(expansion);
    const transport = await connect('lost-response', true); const retry = await connect('retry', true);
    const id = randomUUID();
    // Test-only post-COMMIT wait withholds the query completion from the caller.
    // Observer sees committed data, then the caller disconnects before receiving
    // completion. No production RPC or trigger is modified for this injection.
    const escaped = JSON.stringify(batch).replaceAll("'", "''");
    const lost = outcome(transport.query(`BEGIN; SELECT * FROM public.submit_quarterly_batch_v2('${id}','${UID}','Synthetic owner',2026,3,'GradeA','${escaped}'::jsonb,'[]'::jsonb); COMMIT; SELECT pg_sleep(6);`));
    await waitUntil(async () => (await setup.query('SELECT count(*)::int AS n FROM private.quarterly_submission_requests WHERE request_id=$1', [id])).rows[0].n === 1, 'committed request before transport completion');
    const committedReceipt = (await setup.query('SELECT regular_count,future_count,submitted_at FROM private.quarterly_submission_requests WHERE request_id=$1', [id])).rows[0];
    await close(transport);
    assert.ok((await lost).error, 'The original caller must not receive a successful completion');
    await waitUntil(async () => (await setup.query('SELECT count(*)::int AS n FROM pg_stat_activity WHERE pid=$1', [transport.testPid])).rows[0].n === 0, 'disconnected synthetic backend to finish its post-commit wait', 8_000);
    const replay = await submit(retry, id);
    assert.deepEqual(replay.rows[0], committedReceipt);
    assert.deepEqual(await counts(setup), { submissions: 1, provenance: 1, requests: 1 });
  });

  await test('B aborts when v2 work holds the rollout lock, then freezes setters without applying C', async ({ setup, connect }) => {
    await setup.query(expansion);
    const hashes = await legacyHashes(setup);
    const writer = await connect('held-v2-write', true); const operator = await connect('freeze');
    await writer.query('BEGIN'); await save(writer, { phase: 'v2-open' }, 1);
    const attempt = outcome(operator.query(freeze));
    await waitUntil(() => waiting(setup, operator.testPid), 'B waiting on in-flight v2 work');
    assert.equal((await attempt).error?.code, '55P03'); await operator.query('ROLLBACK');
    assert.equal((await setup.query('SELECT quarter_configuration_frozen FROM private.quarterly_rollout_control')).rows[0].quarter_configuration_frozen, false);
    assert.deepEqual(await legacyHashes(setup), hashes);
    await writer.query('COMMIT'); await operator.query(freeze);
    for (const name of ['set_current_submission_period', 'set_current_submission_period_v2']) {
      await assert.rejects(writer.query(`SELECT * FROM public.${name}(2026,4)`), (e) => e.code === '55000' && e.message === 'quarter_configuration_frozen');
    }
    await save(writer, { phase: 'legacy-still-works' }, 2, 'GradeA', true);
    await writer.query("SELECT * FROM public.submit_quarterly_batch($1,'Synthetic owner',2026,3,'GradeA',$2::jsonb,'[]'::jsonb)", [UID, JSON.stringify([{ ...batch[0], asking_rent: -1 }])]);
    const after = await legacyHashes(setup);
    assert.equal(after.find((r) => r.proname === 'submit_quarterly_batch').hash, hashes.find((r) => r.proname === 'submit_quarterly_batch').hash);
    assert.equal((await setup.query('SELECT asking_rent FROM public.quarterly_submissions')).rows[0].asking_rent, '-1');
    console.log('SAFETY: Phase C was not applied; stricter legacy cutover remains a separate operator gate.');
  });

  await test('B cannot cancel a legacy setter already executing: pre-freeze drain remains mandatory', async ({ setup, connect }) => {
    await setup.query(expansion);
    const blocker = await connect('setter-blocker'); const old = await connect('already-running-legacy-setter', true); const operator = await connect('freeze-race');
    await blocker.query('BEGIN'); await blocker.query('LOCK TABLE public.future_supply_assignments IN SHARE ROW EXCLUSIVE MODE');
    const inFlight = outcome(old.query('SELECT * FROM public.set_current_submission_period(2026,4)'));
    await waitUntil(() => waiting(setup, old.testPid, 'public.future_supply_assignments'), 'legacy setter already inside its original body');
    await operator.query(freeze);
    assert.equal((await setup.query('SELECT quarter_configuration_frozen FROM private.quarterly_rollout_control')).rows[0].quarter_configuration_frozen, true);
    await blocker.query('COMMIT'); assert.ifError((await inFlight).error);
    assert.equal((await setup.query("SELECT value FROM public.app_settings WHERE key='current_submission_quarter'")).rows[0].value, '4');
    console.log('SAFETY: Demonstrated the documented in-flight legacy setter hazard; a green suite does not waive the drain prerequisite.');
  });

  console.log(JSON.stringify({ postgres_major: 17, cases: reports, scope: 'schema-reconciled synthetic fixture, real concurrent PostgreSQL connections; not full production migration-chain replay', remaining_gate: 'operator-confirmed old-client and pre-freeze setter drain; no production actions' }, null, 2));
} finally {
  await Promise.all([...allClients].map(close));
}
