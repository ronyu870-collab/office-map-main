import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { readFile, writeFile, rm } from 'node:fs/promises';
import { temporary, command, digest } from './common.mjs';
import { exportDatabase } from './database.mjs';
import { store, verifyPrivateTarget, writeCompletion } from './r2.mjs';
import { configuredSources, sameInventory } from './sources.mjs';
import { validateManifest, validDigest } from './manifest.mjs';

export async function encrypt(c, input, output) {
  await command(c.ageBin, ['--encrypt', '--recipient', c.recipient, '--output', output, input]);
}
export async function decrypt(c, input, output, identity) {
  await command(c.ageBin, ['--decrypt', '--identity', identity, '--output', output, input]);
}
export async function checkedDownload(target, key, file, expected) {
  if (!validDigest(expected)) throw new Error('BACKUP_HASH_MISMATCH');
  const actual = await target.get(key, file, { maxBytes: expected.bytes });
  if (actual.sha256 !== expected.sha256 || actual.bytes !== expected.bytes) throw new Error('BACKUP_HASH_MISMATCH');
}
export async function backup(c, { target, sources, exportDB = exportDatabase } = {}) {
  // Preflight all required sources and target before opening the database.
  const adapters = sources ?? configuredSources(c);
  if (c.profile === 'full' && (adapters.length !== 2 || !['supabase-storage', 'ali-oss'].every((k) => adapters.some((s) => s.kind === k)))) throw new Error('FULL_COVERAGE_REQUIRED');
  await verifyPrivateTarget(c);
  const remote = target ?? store(c);
  const started = new Date().toISOString();
  const run = `${c.prefix}${started.replaceAll(/[:.]/g, '-')}-${randomUUID()}/`;
  try {
    return await temporary('colliers-backup-', async (dir) => {
      const inventory = await Promise.all(adapters.map((a) => a.inventory()));
      const db = await exportDB(c, dir);
      const entries = [];
      const upload = async (file, metadata) => {
        const id = randomUUID(); const encrypted = path.join(dir, `${id}.age`);
        const plain = await digest(file);
        await encrypt(c, file, encrypted);
        const key = `${run}${id}.age`; const cipher = await remote.put(key, encrypted);
        const verification = path.join(dir, `${id}.readback`);
        await checkedDownload(remote, key, verification, cipher);
        await rm(verification); await rm(encrypted); await rm(file);
        entries.push({ ...metadata, key, plain, cipher });
      };
      for (const item of db.files) await upload(item.file, { kind: item.kind });
      for (let i = 0; i < adapters.length; i++) {
        for (const object of inventory[i].filter((x) => x.kind === 'object')) {
          const file = path.join(dir, `${randomUUID()}.source`);
          await adapters[i].download(object, file);
          if (Number.isFinite(object.size) && (await digest(file)).bytes !== object.size) throw new Error('SOURCE_SIZE_MISMATCH');
          await upload(file, { kind: 'object', source: adapters[i].kind, object });
        }
        sameInventory(inventory[i], await adapters[i].inventory());
      }
      const manifest = {
        format: 1, project: c.project, run, started, captured: new Date().toISOString(), profile: c.profile,
        coverage: c.profile === 'full' ? 'database-and-current-objects' : 'database-only',
        recoveryReady: false, restoreDrill: 'not-yet-performed',
        limitations: ['Database and object services are not an atomic application snapshot.', 'Object version history, platform secrets/settings and Vault root key are not included.'],
        prerequisites: db.prerequisites, evidence: db.evidence, schemas: db.schemas, serverVersion: db.version, extensions: db.extensions ?? [],
        inventories: adapters.map((a, i) => ({ source: a.kind, descriptor: a.descriptor, items: inventory[i] })), entries,
      };
      const manifestFile = path.join(dir, 'manifest.json'); const encryptedManifest = path.join(dir, 'manifest.age');
      validateManifest(manifest, c, run);
      await writeFile(manifestFile, JSON.stringify(manifest), { mode: 0o600 });
      await encrypt(c, manifestFile, encryptedManifest);
      const manifestKey = `${run}manifest.age`; const cipher = await remote.put(manifestKey, encryptedManifest);
      await checkedDownload(remote, manifestKey, path.join(dir, 'manifest.readback'), cipher);
      // This marker certifies storage integrity only, never tested restorability.
      const completion = { format: 1, run, finished: new Date().toISOString(), profile: c.profile, recoveryReady: false, manifest: { key: manifestKey, ...cipher } };
      await writeCompletion(remote, `${run}complete.json`, completion, path.join(dir, 'complete.json'));
      return completion;
    });
  } finally { if (!target) remote.close(); }
}
export async function readBackup(c, remote, run, dir, identity) {
  if (!run.startsWith(c.prefix) || !/^backups\/[a-z0-9]{20}\/[0-9TZ-]+-[a-f0-9-]{36}\/$/.test(run)) throw new Error('BACKUP_RUN_REJECTED');
  const marker = path.join(dir, 'complete.json');
  await remote.get(`${run}complete.json`, marker);
  const completed = JSON.parse(await readFile(marker, 'utf8'));
  if (completed.format !== 1 || completed.run !== run || completed.manifest?.key !== `${run}manifest.age`) throw new Error('BACKUP_MARKER_INVALID');
  const encrypted = path.join(dir, 'manifest.age'); const file = path.join(dir, 'manifest.json');
  await checkedDownload(remote, completed.manifest.key, encrypted, completed.manifest);
  await decrypt(c, encrypted, file, identity);
  const manifest = JSON.parse(await readFile(file, 'utf8'));
  validateManifest(manifest, c, run);
  const seen = new Set(); const files = [];
  for (const entry of manifest.entries) {
    if (!entry.key.startsWith(run) || !/^[a-f0-9-]{36}\.age$/.test(entry.key.slice(run.length)) || seen.has(entry.key)) throw new Error('BACKUP_ENTRY_INVALID');
    seen.add(entry.key);
    const cipher = path.join(dir, `${randomUUID()}.age`); const plain = path.join(dir, `${randomUUID()}.plain`);
    await checkedDownload(remote, entry.key, cipher, entry.cipher);
    await decrypt(c, cipher, plain, identity);
    const actual = await digest(plain);
    if (actual.sha256 !== entry.plain.sha256 || actual.bytes !== entry.plain.bytes) throw new Error('BACKUP_PLAINTEXT_MISMATCH');
    files.push({ ...entry, file: plain });
  }
  if (files.filter((f) => f.kind === 'database').length !== 1 || files.filter((f) => f.kind === 'roles').length !== 1) throw new Error('BACKUP_DATABASE_REQUIRED');
  return { manifest, files };
}
