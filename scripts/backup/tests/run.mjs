import assert from 'node:assert/strict';
import path from 'node:path';
import { readFile, writeFile } from 'node:fs/promises';
import { configuration } from '../config.mjs';
import { command, temporary, safeCode, digest } from '../common.mjs';
import { tableEvidence, exportDatabase } from '../database.mjs';
import { store, verifyPrivateTarget } from '../r2.mjs';
import { backup, readBackup, checkedDownload, encrypt } from '../pipeline.mjs';
import { freshCluster, syntheticDrill, restoreFiles } from '../restore.mjs';
import { configuredSources, checkName, sameInventory } from '../sources.mjs';
import { s3Fixture } from './s3-fixture.mjs';
import { roleBoundary } from './role-boundary.mjs';
import { slotAt, weeklyState } from '../weekly.mjs';

let passed = 0;
async function test(name, action) { await action(); console.log(`PASS ${++passed} ${name}`); }
const pgBin = process.env.BACKUP_TEST_PG_BIN || '/opt/homebrew/opt/postgresql@17/bin';
await temporary('colliers-test-', async (dir) => {
  const identity = path.join(dir, 'identity');
  await command('age-keygen', ['-o', identity]);
  const recipient = (await command('age-keygen', ['-y', identity])).trim();
  const fixture = await s3Fixture();
  const env = {
    BACKUP_PROFILE: 'full', BACKUP_PROJECT_REF: 'abcdefghijklmnopqrst', BACKUP_R2_ACCOUNT_ID: 'a'.repeat(32), BACKUP_R2_BUCKET: 'synthetic-backups',
    BACKUP_DATABASE_URL: 'postgres://fixture:synthetic@127.0.0.1:5432/postgres', BACKUP_AGE_RECIPIENT: recipient,
    BACKUP_R2_ACCESS_KEY_ID: 'synthetic-only', BACKUP_R2_SECRET_ACCESS_KEY: 'synthetic-secret',
    BACKUP_TEST_S3_ENDPOINT: fixture.endpoint, BACKUP_PG_BIN: pgBin,
  };
  const c = configuration(env, { synthetic: true }); const remote = store(c, { requestHandler: fixture.requestHandler });
  try {
    await test('production rejects local DB and missing TLS/target credentials', async () => {
      assert.throws(() => configuration(env), /DATABASE_HOST_NOT_APPROVED/);
      assert.throws(() => configuration({ ...env, BACKUP_DATABASE_URL: 'https://example.org' }), /INVALID_DATABASE_PROTOCOL/);
      assert.throws(() => configuration({ ...env, BACKUP_PROFILE: 'typo' }, { synthetic: true }), /INVALID_BACKUP_PROFILE/);
      assert.throws(() => configuration({ ...env, BACKUP_DATABASE_URL: 'postgres://x:p@real.example/db' }, { synthetic: true }), /SYNTHETIC_REQUIRES_LOCALHOST/);
      assert.throws(() => store({ ...c, synthetic: false }), /R2_ENDPOINT_REJECTED/);
    });
    await test('secret-bearing native errors are sanitized; partial coverage rejected', async () => {
      assert.equal(safeCode(new Error('postgres://user:password@host/db')), 'BACKUP_FAILED');
      assert.equal(safeCode(new Error('MISSING_CONFIGURATION:BACKUP_DATABASE_URL')), 'MISSING_CONFIGURATION:BACKUP_DATABASE_URL');
      assert.throws(() => configuredSources(c), /MISSING_STORAGE_CREDENTIALS/);
      assert.throws(() => checkName('../private'), /SOURCE_NAME_REJECTED/);
      assert.throws(() => sameInventory([{ name: 'old' }], [{ name: 'new' }]), /SOURCE_CHANGED/);
      await assert.rejects(backup(c, { target: remote, sources: [] }), /FULL_COVERAGE_REQUIRED/);
      await assert.rejects(freshCluster({ ...c, synthetic: false }, () => {}), /NATIVE_RESTORE_SYNTHETIC_ONLY/);
    });
    await test('real SDK signs requests, enforces create-only writes, and paginates', async () => {
      const file = path.join(dir, 'sample'); await writeFile(file, 'synthetic-only');
      for (let i = 0; i < 5; i++) await remote.put(`${c.prefix}fixture-${i}`, file);
      await assert.rejects(remote.put(`${c.prefix}fixture-0`, file));
      assert.equal((await remote.list(c.prefix)).length, 5);
      assert.ok(fixture.requests.every((r) => r.signed));
      await assert.rejects(remote.put('outside-prefix', file), /R2_PREFIX_REJECTED/);
      fixture.corruptGet();
      await assert.rejects(checkedDownload(remote, `${c.prefix}fixture-0`, path.join(dir, 'corrupt'), await digest(file)), /BACKUP_HASH_MISMATCH/);
    });
    await test('matching bootstrap role restores original ADMIN/INHERIT/SET grant provenance', async () => {
      const matched = { ...c, bootstrapRole: 'synthetic_bootstrap' };
      await freshCluster(matched, async (source) => {
        await source.client.query('create role synthetic_member; create role synthetic_reader; grant synthetic_reader to synthetic_member with inherit false, set true;');
        await temporary('colliers-bootstrap-', async (tmp) => {
          const sourceConfig = { ...matched, pg: { host: source.socket, port: 5432, user: source.user, password: source.password, database: 'postgres' } };
          const archive = await exportDatabase(sourceConfig, tmp);
          assert.equal(archive.bootstrapRole, 'synthetic_bootstrap');
          await freshCluster(matched, async (restored) => {
            await restoreFiles(matched, archive.files, restored);
            const result = (await restored.client.query("select g.rolname grantor,m.admin_option,m.inherit_option,m.set_option from pg_auth_members m join pg_roles g on g.oid=m.grantor join pg_roles r on r.oid=m.roleid join pg_roles member on member.oid=m.member where r.rolname='synthetic_reader' and member.rolname='synthetic_member'")).rows;
            assert.deepEqual(result, [{ grantor: 'synthetic_bootstrap', admin_option: false, inherit_option: false, set_option: true }]);
          });
        });
      });
    });
    await freshCluster(c, async (source) => {
      // The export client uses a private socket too; c.synthetic alone does not
      // allow a production host. No fixture or key is written to the repo.
      const sourceConfig = { ...c, pg: { host: source.socket, port: 5432, user: source.user, password: source.password, database: 'postgres' } };
      await source.client.query(`
        create role synthetic_reader;
        create schema auth; create schema private; create schema supabase_migrations;
        create table auth.users(id int primary key, email text);
        create table public.deals(id int primary key, owner_id int, rent numeric, extra jsonb);
        create table private.audit(id int generated always as identity, old_value jsonb, new_value jsonb);
        create table supabase_migrations.schema_migrations(version text);
        create function private.audit_deal() returns trigger language plpgsql as $$ begin insert into private.audit(old_value,new_value) values(to_jsonb(old),to_jsonb(new)); return new; end $$;
        create trigger audit_deal after update on public.deals for each row execute function private.audit_deal();
        alter table public.deals enable row level security;
        create policy owned on public.deals for select to synthetic_reader using(owner_id=1);
        grant usage on schema public to synthetic_reader; grant select on public.deals to synthetic_reader;
        insert into auth.users values(1,'synthetic@example.invalid');
        insert into public.deals values(1,1,220,'{"note":"合成成交"}'),(2,2,null,'{}');
        update public.deals set rent=230 where id=1;
        insert into supabase_migrations.schema_migrations values('synthetic-001');
      `);
      const sources = ['supabase-storage', 'ali-oss'].map((kind) => ({ kind,
        inventory: async () => [{ kind: 'object', bucket: 'synthetic', name: `${kind}/中文 空格.txt`, etag: 'synthetic', size: 14 }],
        download: async (_o, file) => writeFile(file, 'synthetic-file', { flag: 'wx', mode: 0o600 }),
      }));
      await test('Supabase-only PG17 export and restore covers Storage without OSS credentials', async () => {
        const scoped = { ...sourceConfig, profile: 'supabase' };
        const weeklySlot = slotAt(Date.now());
        const completed = await backup(scoped, { target: remote, sources: [sources[0]], weeklySlot });
        assert.equal((await weeklyState(scoped, remote)).weeks.get(weeklySlot).run, completed.run);
        const drill = await syntheticDrill(scoped, remote, completed.run, identity, async (client, files) => {
          assert.equal(files.filter(f => f.kind === 'object').length, 1);
          assert.equal(files.find(f => f.kind === 'object').source, 'supabase-storage');
          assert.equal((await client.query('select count(*)::int n from public.deals')).rows[0].n, 2);
        });
        assert.equal(drill.verifiedObjects, 1);
      });
      let completed;
      await test('PG17 snapshot → age → actual SDK upload/readback completes without changing source', async () => {
        await source.client.query('begin'); const before = await tableEvidence(source.client); await source.client.query('commit');
        completed = await backup(sourceConfig, { target: remote, sources });
        assert.equal(completed.recoveryReady, false);
        await source.client.query('begin'); const after = await tableEvidence(source.client); await source.client.query('commit');
        assert.deepEqual(after, before);
        assert.ok(fixture.objects.has(`${completed.run}complete.json`));
        for (const [key, bytes] of fixture.objects) if (key.startsWith(completed.run) && key.endsWith('.age')) {
          assert.ok(bytes.toString().startsWith('age-encryption.org/v1'));
          assert.ok(!bytes.includes(Buffer.from('合成成交')));
        }
      });
      await test('download → decrypt → fresh PG17 restores exact rows, roles, RLS, trigger, audit and files', async () => {
        await temporary('colliers-extension-check-', async (tmp) => {
          const { manifest } = await readBackup(c, remote, completed.run, tmp, identity);
          assert.ok(manifest.extensions.some((e) => e.name === 'plpgsql' && e.version === '1.0' && e.schema === 'pg_catalog'));
        });
        const result = await syntheticDrill(sourceConfig, remote, completed.run, identity, async (client, files) => {
          assert.equal((await client.query('select rent::text from public.deals where id=1')).rows[0].rent, '230');
          assert.equal((await client.query('select count(*)::int as n from private.audit')).rows[0].n, 1);
          await client.query('set role synthetic_reader');
          assert.deepEqual((await client.query('select id from public.deals order by id')).rows, [{ id: 1 }]);
          await assert.rejects(client.query("update public.deals set rent=999"), (e) => e.code === '42501');
          await client.query('reset role');
          await client.query('update public.deals set rent=240 where id=1');
          assert.equal((await client.query('select count(*)::int as n from private.audit')).rows[0].n, 2);
          assert.equal((await client.query('select version from supabase_migrations.schema_migrations')).rows[0].version, 'synthetic-001');
          for (const f of files.filter((x) => x.kind === 'object')) assert.equal(await readFile(f.file, 'utf8'), 'synthetic-file');
        });
        assert.equal(result.verifiedTables, 4); assert.equal(result.verifiedObjects, 2);
      });
      await test('wrong identity and ciphertext corruption cannot restore', async () => {
        const wrong = path.join(dir, 'wrong-key'); await command('age-keygen', ['-o', wrong]);
        await temporary('colliers-wrong-', async (tmp) => assert.rejects(readBackup(c, remote, completed.run, tmp, wrong)));
        const marker = JSON.parse(fixture.objects.get(`${completed.run}complete.json`));
        const original = fixture.objects.get(marker.manifest.key);
        fixture.objects.set(marker.manifest.key, Buffer.from('tampered'));
        await temporary('colliers-corrupt-', async (tmp) => assert.rejects(readBackup(c, remote, completed.run, tmp, identity), /BACKUP_HASH_MISMATCH/));
        fixture.objects.set(marker.manifest.key, original);
      });
      await test('restored extension-version mismatch blocks successful drill', async () => {
        const markerKey = `${completed.run}complete.json`;
        const originalMarker = fixture.objects.get(markerKey);
        const marker = JSON.parse(originalMarker);
        const originalManifest = fixture.objects.get(marker.manifest.key);
        try {
          await temporary('colliers-extension-mismatch-', async (tmp) => {
            const { manifest } = await readBackup(c, remote, completed.run, tmp, identity);
            manifest.extensions[0].version = '0.0.0-synthetic-mismatch';
            const plain = path.join(tmp, 'changed.json'); const cipher = path.join(tmp, 'changed.age');
            await writeFile(plain, JSON.stringify(manifest), { mode: 0o600 });
            await encrypt(c, plain, cipher);
            Object.assign(marker.manifest, await digest(cipher));
            // Fixture-only mutation creates a valid encrypted but incompatible
            // catalogue so the actual restored PG must detect the mismatch.
            fixture.objects.set(marker.manifest.key, await readFile(cipher));
            fixture.objects.set(markerKey, Buffer.from(JSON.stringify(marker)));
            await assert.rejects(syntheticDrill(sourceConfig, remote, completed.run, identity), /RESTORE_EXTENSION_MISMATCH/);
          });
        } finally { fixture.objects.set(markerKey, originalMarker); fixture.objects.set(marker.manifest.key, originalManifest); }
      });
      await test('dump failure, upload failure and source churn never publish completion', async () => {
        const before = [...fixture.objects.keys()].filter((k) => k.endsWith('complete.json'));
        await assert.rejects(backup(sourceConfig, { target: remote, sources, exportDB: async () => { throw new Error('SYNTHETIC_DUMP_FAILURE'); } }), /SYNTHETIC_DUMP_FAILURE/);
        fixture.failPut(2);
        await assert.rejects(backup(sourceConfig, { target: remote, sources })); fixture.failPut(Infinity);
        let calls = 0;
        const changing = { ...sources[0], inventory: async () => { calls++; return calls === 1 ? sources[0].inventory() : []; } };
        await assert.rejects(backup(sourceConfig, { target: remote, sources: [changing, sources[1]] }), /SOURCE_CHANGED/);
        assert.deepEqual([...fixture.objects.keys()].filter((k) => k.endsWith('complete.json')), before);
      });
      await test('readback corruption cannot publish completion', async () => {
        const before = [...fixture.objects.keys()].filter((k) => k.endsWith('complete.json')).length;
        const corrupt = { ...remote, put: async (...args) => { const r = await remote.put(...args); fixture.corruptGet(); return r; } };
        await assert.rejects(backup(sourceConfig, { target: corrupt, sources }), /BACKUP_HASH_MISMATCH/);
        assert.equal([...fixture.objects.keys()].filter((k) => k.endsWith('complete.json')).length, before);
      });
      await test('explicit database-only backup remains partial', async () => {
        const result = await backup({ ...sourceConfig, profile: 'database-only' }, { target: remote, sources: [] });
        assert.equal(result.profile, 'database-only'); assert.equal(result.recoveryReady, false);
      });
    });
    await test('target privacy, locked retention and ambiguous configuration fail closed', async () => {
      const original = globalThis.fetch;
      try {
        const prod = { ...c, synthetic: false, cloudflareToken: 'synthetic' };
        globalThis.fetch = async (url) => ({ ok: true, json: async () => ({ success: true, result: url.endsWith('/managed') ? { enabled: true } : { domains: [] } }) });
        await assert.rejects(verifyPrivateTarget(prod), /R2_PUBLIC_OR_UNKNOWN/);
        globalThis.fetch = async (url) => ({ ok: true, json: async () => ({ success: true, result: url.endsWith('/managed') ? { enabled: false } : url.endsWith('/custom') ? { domains: [] } : { rules: [] } }) });
        await assert.rejects(verifyPrivateTarget(prod), /R2_RETENTION_LOCK_REQUIRED/);
      } finally { globalThis.fetch = original; }
    });
    await roleBoundary(c, test);
  } finally { remote.close(); await fixture.close(); }
});
console.log(`Backup synthetic regressions: ${passed} passed; no production credentials used.`);
