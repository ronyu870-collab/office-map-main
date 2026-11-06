import assert from 'node:assert/strict';
import path from 'node:path';
import { readFile, writeFile } from 'node:fs/promises';
import { configuration } from '../config.mjs';
import { temporary, command, safeCode } from '../common.mjs';
import { store, verifyPrivateTarget } from '../r2.mjs';
import { backup, readBackup } from '../pipeline.mjs';
import { sameInventory, checkName, configuredSources, supabaseSource } from '../sources.mjs';
import { s3Fixture } from './s3-fixture.mjs';
import { health } from '../health.mjs';
import { sourceRegressions } from './sources.mjs';
import { validateManifest } from '../manifest.mjs';
import { r2ReadRegressions } from './r2-reads.mjs';
import { safeFailure } from '../diagnostics.mjs';

let passed = 0;
const test = async (name, action) => { await action(); console.log(`PASS UNIT ${++passed} ${name}`); };
await temporary('colliers-backup-unit-', async (dir) => {
  const identity = path.join(dir, 'identity'); await command('age-keygen', ['-o', identity]);
  const recipient = (await command('age-keygen', ['-y', identity])).trim();
  const fixture = await s3Fixture();
  const env = { BACKUP_PROFILE: 'full', BACKUP_PROJECT_REF: 'abcdefghijklmnopqrst', BACKUP_R2_ACCOUNT_ID: 'a'.repeat(32), BACKUP_R2_BUCKET: 'synthetic-backups', BACKUP_DATABASE_URL: 'postgres://synthetic:synthetic@127.0.0.1/postgres', BACKUP_AGE_RECIPIENT: recipient, BACKUP_R2_ACCESS_KEY_ID: 'synthetic', BACKUP_R2_SECRET_ACCESS_KEY: 'synthetic', BACKUP_TEST_S3_ENDPOINT: fixture.endpoint };
  const c = configuration(env, { synthetic: true }); const target = store(c, { requestHandler: fixture.requestHandler });
  // Stub the database only in this transport/crypto suite. PG behavior is
  // mandatory in tests/run.mjs and CI; these assertions cannot replace it.
  const exportDB = async (_c, tmp) => {
    const files = [];
    for (const kind of ['database', 'roles']) {
      const file = path.join(tmp, kind); await writeFile(file, `synthetic ${kind}`, { mode: 0o600 }); files.push({ file, kind });
    }
    return { files, evidence: [], schemas: [], version: 170000, prerequisites: ['synthetic only'] };
  };
  const sources = ['supabase-storage', 'ali-oss'].map((kind) => ({ kind, inventory: async () => [{ kind: 'object', name: '合成文件.txt', bucket: 'synthetic', size: 14 }], download: async (_o, file) => writeFile(file, 'synthetic-file', { flag: 'wx', mode: 0o600 }) }));
  let completion;
  try {
    await sourceRegressions(test, dir);
    await r2ReadRegressions(test, dir, c, target, fixture);
    await test('exhausted R2 body resets retain the failed readback stage and never publish completion', async () => {
      const markers = () => [...fixture.objects.keys()].filter(key => key.endsWith('/complete.json'));
      const before = markers(); fixture.interruptGet(Infinity);
      try {
        await assert.rejects(backup(c, { target, sources, exportDB }), error => {
          assert.deepEqual(safeFailure(error), { status: 'failed', stage: 'r2-readback', code: 'BACKUP_FAILED', transportCode: 'ECONNRESET' });
          return true;
        });
        assert.deepEqual(markers(), before);
      } finally { fixture.interruptGet(0); }
    });
    await test('pipeline diagnostics allow only fixed stages, HTTP status and known codes without secrets', async () => {
      const secret = 'postgres://synthetic:NEVER_LOG_THIS@private.invalid/business.sql';
      const cause = Object.assign(new Error(secret), { code: 'ECONNRESET', $metadata: { httpStatusCode: 503 }, request: secret });
      cause.originalError = cause;
      const denied = { ...target, put: async () => { throw cause; } };
      await assert.rejects(backup(c, { target: denied, sources, exportDB }), error => {
        const report = safeFailure(error);
        assert.deepEqual(report, { status: 'failed', stage: 'r2-upload', code: 'BACKUP_FAILED', httpStatus: 503, transportCode: 'ECONNRESET' });
        assert.ok(!JSON.stringify(report).includes('NEVER_LOG_THIS')); return true;
      });
      assert.deepEqual(safeFailure(Object.assign(new Error(secret), { backupStage: secret, code: secret, status: secret })), { status: 'failed', stage: 'preflight', code: 'BACKUP_FAILED' });
      assert.equal(safeFailure(Object.assign(new Error(secret), { code: 'ENOSPC' })).ioCode, 'ENOSPC');
    });
    await test('configuration rejects unsafe host/profile/endpoint and missing coverage', async () => {
      assert.throws(() => configuration(env), /DATABASE_HOST_NOT_APPROVED/);
      assert.throws(() => configuration({ ...env, BACKUP_PROFILE: 'typo' }, { synthetic: true }), /INVALID_BACKUP_PROFILE/);
      assert.throws(() => configuredSources(c), /MISSING_STORAGE_CREDENTIALS/);
      assert.throws(() => store({ ...c, synthetic: false }), /R2_ENDPOINT_REJECTED/);
      assert.throws(() => store({ ...c, synthetic: false }, { requestHandler: fixture.requestHandler }), /PRODUCTION_TRANSPORT_OVERRIDE_REJECTED/);
      await assert.rejects(backup(c, { target, sources: [], exportDB }), /FULL_COVERAGE_REQUIRED/);
      const prod = { ...env, BACKUP_CF_CONFIG_READ_TOKEN: 'synthetic', BACKUP_PG_CA_FILE: '/unused-synthetic-ca', BACKUP_DATABASE_URL: `postgres://synthetic:synthetic@db.${c.project}.supabase.co/postgres?sslmode=verify-full`, BACKUP_DB_ALLOWED_HOSTS: ` db.${c.project}.supabase.co ` };
      const production = configuration(prod);
      assert.equal(production.pg.host, `db.${c.project}.supabase.co`);
      store(production).close(); // Real SDK default transport constructor probe.
      assert.throws(() => configuration({ ...prod, BACKUP_DATABASE_URL: 'postgres://postgres.wrongproject:synthetic@aws-1-ap-southeast-1.pooler.supabase.com/postgres', BACKUP_DB_ALLOWED_HOSTS: 'aws-1-ap-southeast-1.pooler.supabase.com' }), /DATABASE_PROJECT_MISMATCH/);
      assert.throws(() => configuration({ ...prod, BACKUP_DATABASE_URL: prod.BACKUP_DATABASE_URL.replace('verify-full', 'require') }), /DATABASE_TLS_CONFIGURATION_REJECTED/);
    });
    await test('actual age + AWS SDK upload/readback/decrypt preserves all synthetic bytes', async () => {
      completion = await backup(c, { target, sources, exportDB });
      assert.equal(completion.recoveryReady, false);
      await temporary('colliers-read-', async (tmp) => {
        const restored = await readBackup(c, target, completion.run, tmp, identity);
        assert.equal(restored.files.length, 4);
        for (const f of restored.files) assert.equal(await readFile(f.file, 'utf8'), f.kind === 'object' ? 'synthetic-file' : `synthetic ${f.kind}`);
        assert.throws(() => validateManifest({ ...restored.manifest, entries: restored.manifest.entries.filter((e) => e.kind !== 'object') }, c, completion.run), /BACKUP_MANIFEST_INVALID/);
        assert.throws(() => validateManifest({ ...restored.manifest, entries: [...restored.manifest.entries, restored.manifest.entries[0]] }, c, completion.run), /BACKUP_MANIFEST_INVALID/);
      });
      assert.ok(fixture.requests.every((r) => r.signed));
      assert.ok(fixture.requests.filter((r) => r.method === 'PUT').every((r) => r.condition === '*'));
      for (const [key, bytes] of fixture.objects) if (key.endsWith('.age')) {
        assert.ok(bytes.toString().startsWith('age-encryption.org/v1'));
        assert.ok(!bytes.includes(Buffer.from('synthetic-file')));
      }
    });
    await test('Supabase profile requires exactly Storage, round-trips its files, and isolates freshness coverage', async () => {
      const scoped = configuration({ ...env, BACKUP_PROFILE: undefined }, { synthetic: true });
      assert.equal(scoped.profile, 'supabase');
      const configured = configuredSources({ ...scoped, sources: { supabase: { url: 'https://synthetic.supabase.co', key: 'synthetic' } } });
      assert.equal(configured.length, 1); assert.equal(configured[0].kind, 'supabase-storage');
      await assert.rejects(backup(scoped, { target, sources: [], exportDB }), /FULL_COVERAGE_REQUIRED/);
      await assert.rejects(backup(scoped, { target, sources, exportDB }), /FULL_COVERAGE_REQUIRED/);
      const completed = await backup(scoped, { target, sources: [sources[0]], exportDB });
      await temporary('colliers-supabase-', async (tmp) => {
        const restored = await readBackup(scoped, target, completed.run, tmp, identity);
        assert.equal(restored.files.length, 3);
        assert.equal(restored.manifest.coverage, 'database-and-supabase-storage');
        assert.deepEqual(restored.manifest.inventories.map(i => i.source), ['supabase-storage']);
        assert.throws(() => validateManifest({ ...restored.manifest, inventories: [] }, scoped, completed.run), /BACKUP_MANIFEST_INVALID/);
        assert.throws(() => validateManifest({ ...restored.manifest, coverage: 'database-only' }, scoped, completed.run), /BACKUP_MANIFEST_INVALID/);
      });
      assert.equal((await health(scoped, target)).run, completed.run);
      assert.equal((await health(c, target)).run, completion.run);
      const empty = { ...sources[0], inventory: async () => [{ kind: 'bucket', bucket: 'empty', config: { id: 'empty' } }] };
      const emptyCompleted = await backup(scoped, { target, sources: [empty], exportDB });
      await temporary('colliers-empty-storage-', async (tmp) => {
        const restored = await readBackup(scoped, target, emptyCompleted.run, tmp, identity);
        assert.equal(restored.files.length, 2);
        assert.equal(restored.manifest.inventories[0].items[0].bucket, 'empty');
      });
      const later = Date.now() + 31 * 3600_000;
      const key = `${completion.run}complete.json`; const previous = fixture.objects.get(key);
      const legacy = JSON.parse(previous); legacy.finished = new Date(later).toISOString();
      fixture.objects.set(key, Buffer.from(JSON.stringify(legacy)));
      try { await assert.rejects(health(scoped, target, { now: later }), /NO_RECENT_FULL_BACKUP/); }
      finally { fixture.objects.set(key, previous); }
    });
    await test('conditions reject duplicate key and SDK pagination returns all objects', async () => {
      const file = path.join(dir, 'duplicate'); await writeFile(file, 'synthetic');
      await assert.rejects(target.put(`${completion.run}complete.json`, file));
      assert.equal((await target.list(c.prefix)).length, fixture.objects.size);
      await assert.rejects(target.put('outside-prefix', file), /R2_PREFIX_REJECTED/);
    });
    await test('wrong key and altered ciphertext are rejected', async () => {
      const wrong = path.join(dir, 'wrong'); await command('age-keygen', ['-o', wrong]);
      await temporary('colliers-wrong-', async (tmp) => assert.rejects(readBackup(c, target, completion.run, tmp, wrong)));
      const key = `${completion.run}manifest.age`; const original = fixture.objects.get(key); fixture.objects.set(key, Buffer.from('altered'));
      await temporary('colliers-corrupt-', async (tmp) => assert.rejects(readBackup(c, target, completion.run, tmp, identity), /BACKUP_HASH_MISMATCH/));
      fixture.objects.set(key, original);
    });
    await test('failed export/upload/readback/source churn never creates completion', async () => {
      const markers = () => [...fixture.objects.keys()].filter((k) => k.endsWith('complete.json'));
      const before = markers();
      await assert.rejects(backup(c, { target, sources, exportDB: async () => { throw new Error('SYNTHETIC_FAILURE'); } }), /SYNTHETIC_FAILURE/);
      fixture.failPut(2); await assert.rejects(backup(c, { target, sources, exportDB })); fixture.failPut(Infinity);
      const corrupt = { ...target, put: async (...args) => { const result = await target.put(...args); fixture.corruptGet(); return result; } };
      await assert.rejects(backup(c, { target: corrupt, sources, exportDB }), /BACKUP_HASH_MISMATCH/);
      let calls = 0;
      const changing = { ...sources[0], inventory: async () => ++calls === 1 ? sources[0].inventory() : [] };
      await assert.rejects(backup(c, { target, sources: [changing, sources[1]], exportDB }), /SOURCE_CHANGED/);
      assert.deepEqual(markers(), before);
    });
    await test('incomplete and path-injected manifests are rejected', async () => {
      await temporary('colliers-missing-', async (tmp) => assert.rejects(readBackup(c, target, `${c.prefix}2026-10-27T00-00-00-000Z-00000000-0000-0000-0000-000000000000/`, tmp, identity)));
      await temporary('colliers-invalid-', async (tmp) => assert.rejects(readBackup(c, target, `${c.prefix}../`, tmp, identity), /BACKUP_RUN_REJECTED/));
      assert.throws(() => checkName('../private'), /SOURCE_NAME_REJECTED/);
      assert.throws(() => sameInventory([{ name: 'a' }], [{ name: 'b' }]), /SOURCE_CHANGED/);
    });
    await test('exhausted Storage stream retries never publish a completion marker', async () => {
      const original = globalThis.fetch; let calls = 0;
      const markers = () => [...fixture.objects.keys()].filter(key => key.endsWith('/complete.json'));
      const before = markers();
      try {
        globalThis.fetch = async () => { calls++; return new Response(new ReadableStream({
          start(controller) { controller.enqueue(new TextEncoder().encode('partial')); },
          pull(controller) { controller.error(new TypeError('terminated', { cause: Object.assign(new Error('other side closed'), { code: 'UND_ERR_SOCKET' }) })); },
        })); };
        const adapter = supabaseSource({ url: 'https://abcdefghijklmnopqrst.supabase.co', key: 'synthetic-only' });
        const source = { ...adapter, inventory: sources[0].inventory };
        await assert.rejects(backup({ ...c, profile: 'supabase' }, { target, sources: [source], exportDB }));
        assert.equal(calls, 3); assert.deepEqual(markers(), before);
      } finally { globalThis.fetch = original; }
    });
    await test('Supabase metadata size rejects a short successful response before completion', async () => {
      const before = [...fixture.objects.keys()].filter(key => key.endsWith('/complete.json'));
      const source = { ...sources[0], inventory: async () => [{ kind: 'object', bucket: 'synthetic', name: 'file', metadata: { size: 15 } }] };
      await assert.rejects(backup({ ...c, profile: 'supabase' }, { target, sources: [source], exportDB }), /SOURCE_SIZE_MISMATCH/);
      assert.deepEqual([...fixture.objects.keys()].filter(key => key.endsWith('/complete.json')), before);
    });
    await test('database-only remains partial; errors do not expose credentials', async () => {
      const partial = await backup({ ...c, profile: 'database-only' }, { target, sources: [], exportDB });
      assert.equal(partial.profile, 'database-only'); assert.equal(partial.recoveryReady, false);
      assert.equal(safeCode(new Error('postgres://user:password@host/db')), 'BACKUP_FAILED');
      assert.equal(safeCode(new Error('ANY_UNTRUSTED_SECRET_TEXT')), 'BACKUP_FAILED');
    });
    await test('freshness rejects missing/stale full backups and ignores partial completion', async () => {
      assert.equal((await health(c, target)).run, completion.run);
      const later = Date.now() + 31 * 3600_000;
      for (const [key, value] of fixture.objects) if (key.endsWith('/complete.json')) {
        const marker = JSON.parse(value);
        if (marker.profile === 'database-only') { marker.finished = new Date(later).toISOString(); fixture.objects.set(key, Buffer.from(JSON.stringify(marker))); }
      }
      // A newly finished partial backup must not conceal an old full backup.
      await assert.rejects(health(c, target, { now: later }), /NO_RECENT_FULL_BACKUP/);
      await assert.rejects(health({ ...c, prefix: `${c.prefix}missing/` }, target), /NO_RECENT_FULL_BACKUP/);
    });
    await test('public/unknown target and missing retention lock fail closed', async () => {
      const original = globalThis.fetch;
      const prod = { ...c, synthetic: false, cloudflareToken: 'synthetic' };
      try {
        for (const managed of [{ enabled: true }, {}]) {
          globalThis.fetch = async (url) => ({ ok: true, json: async () => ({ success: true, result: url.endsWith('/managed') ? managed : { domains: [] } }) });
          await assert.rejects(verifyPrivateTarget(prod), /R2_PUBLIC_OR_UNKNOWN/);
        }
        globalThis.fetch = async (url) => ({ ok: true, json: async () => ({ success: true, result: url.endsWith('/managed') ? { enabled: false } : url.endsWith('/custom') ? { domains: [] } : { rules: [] } }) });
        await assert.rejects(verifyPrivateTarget(prod), /R2_RETENTION_LOCK_REQUIRED/);
      } finally { globalThis.fetch = original; }
    });
    await test('Cloudflare configuration shapes accept only a matching 30-day lock', async () => {
      const original = globalThis.fetch;
      const prod = { ...c, synthetic: false, cloudflareToken: 'synthetic' };
      let prefix = 'backups/another-project/';
      try {
        globalThis.fetch = async (url, options) => {
          assert.equal(options.redirect, 'error');
          assert.equal(options.headers['User-Agent'], 'colliers-backup/1.0');
          const result = url.endsWith('/managed') ? { enabled: false, bucketId: 'synthetic', domain: 'pub-synthetic.r2.dev' } : url.endsWith('/custom') ? { domains: [] } : { rules: [{ id: 'backup-retention', enabled: true, prefix, condition: { type: 'Age', maxAgeSeconds: 30 * 86400 } }] };
          return { ok: true, json: async () => ({ success: true, result }) };
        };
        await assert.rejects(verifyPrivateTarget(prod), /R2_RETENTION_LOCK_REQUIRED/);
        prefix = c.prefix; await verifyPrivateTarget(prod);
      } finally { globalThis.fetch = original; }
    });
  } finally { target.close(); await fixture.close(); }
});
console.log(`Backup unit regressions: ${passed} passed. PostgreSQL and real-cloud verification are separate gates.`);
