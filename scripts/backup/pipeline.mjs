import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { readFile, writeFile, rm } from 'node:fs/promises';
import { temporary, command, digest } from './common.mjs';
import { exportDatabase } from './database.mjs';
import { store, verifyPrivateTarget, writeCompletion } from './r2.mjs';
import { configuredSources, sameInventory } from './sources.mjs';
import { validateManifest, validDigest } from './manifest.mjs';
import { profileDefinition } from './profiles.mjs';
import { stageFailure } from './diagnostics.mjs';
import { checkAdmission, COMPLETE_MAX_BYTES, inventoryHash, slotAt, weeklyState } from './weekly.mjs';

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
export async function backup(c, { target, sources, exportDB = exportDatabase, weeklySlot, admissionCeiling } = {}) {
  // Preflight all required sources and target before opening the database.
  if (!c.synthetic && (!weeklySlot || admissionCeiling !== undefined || target)) throw new Error('WEEKLY_PRODUCTION_GUARD_REQUIRED');
  if (weeklySlot && (weeklySlot !== slotAt(Date.now()) || c.profile !== 'supabase')) throw new Error('WEEKLY_SLOT_INVALID');
  const adapters = sources ?? configuredSources(c);
  const profile = profileDefinition(c.profile);
  if (adapters.length !== profile.sources.length || !profile.sources.every((k) => adapters.some((s) => s.kind === k))) throw new Error('FULL_COVERAGE_REQUIRED');
  await verifyPrivateTarget(c);
  const remote = target ?? store(c);
  const started = new Date().toISOString();
  const run = `${c.prefix}${started.replaceAll(/[:.]/g, '-')}-${randomUUID()}/`;
  let stage = 'source-inventory';
  try {
    return await temporary('colliers-backup-', async (dir) => {
      const inventory = await Promise.all(adapters.map((a) => a.inventory()));
      stage = 'database-export';
      const db = await exportDB(c, dir);
      const entries = []; const staged = [];
      const stageFile = async (file, metadata) => {
        const id = randomUUID(); const encrypted = path.join(dir, `${id}.age`);
        stage = 'local-file'; const plain = await digest(file);
        stage = 'encrypt';
        await encrypt(c, file, encrypted);
        const key = `${run}${id}.age`; const cipher = await digest(encrypted);
        staged.push({ key, file: encrypted, cipher });
        stage = 'local-cleanup'; await rm(file);
        entries.push({ ...metadata, key, plain, cipher });
      };
      for (const item of db.files) await stageFile(item.file, { kind: item.kind });
      for (let i = 0; i < adapters.length; i++) {
        for (const object of inventory[i].filter((x) => x.kind === 'object')) {
          const file = path.join(dir, `${randomUUID()}.source`);
          stage = 'source-download';
          await adapters[i].download(object, file);
          stage = 'source-size';
          const expectedSize = object.size ?? object.metadata?.size;
          if (Number.isFinite(expectedSize) && (await digest(file)).bytes !== expectedSize) throw new Error('SOURCE_SIZE_MISMATCH');
          await stageFile(file, { kind: 'object', source: adapters[i].kind, object });
        }
        stage = 'source-inventory'; const after = await adapters[i].inventory();
        stage = 'source-consistency'; sameInventory(inventory[i], after);
      }
      const manifest = {
        format: 1, project: c.project, run, started, captured: new Date().toISOString(), profile: c.profile,
        coverage: profile.coverage,
        recoveryReady: false, restoreDrill: 'not-yet-performed',
        limitations: ['Database and object services are not an atomic application snapshot.', 'Object version history, platform secrets/settings and Vault root key are not included.'],
        prerequisites: db.prerequisites, bootstrapRole: db.bootstrapRole, evidence: db.evidence, schemas: db.schemas, serverVersion: db.version, extensions: db.extensions ?? [],
        inventories: adapters.map((a, i) => ({ source: a.kind, descriptor: a.descriptor, items: inventory[i] })), entries,
      };
      const manifestFile = path.join(dir, 'manifest.json'); const encryptedManifest = path.join(dir, 'manifest.age');
      stage = 'manifest'; validateManifest(manifest, c, run);
      await writeFile(manifestFile, JSON.stringify(manifest), { mode: 0o600 });
      stage = 'encrypt'; await encrypt(c, manifestFile, encryptedManifest);
      const manifestKey = `${run}manifest.age`; const cipher = await digest(encryptedManifest);
      const files = [...staged, { key: manifestKey, file: encryptedManifest, cipher }];
      const expected = files.map(f => ({ Key: f.key, Size: f.cipher.bytes }));
      if (weeklySlot) {
        stage = 'r2-budget';
        const state = await weeklyState(c, remote);
        if (state.slot !== weeklySlot) throw new Error('WEEKLY_SLOT_INVALID');
        if (state.weeks.has(weeklySlot)) return { alreadyComplete: true, ...state.weeks.get(weeklySlot).marker };
        const reservationKey = `${run}reservation.json`; const reservationFile = path.join(dir, 'reservation.json');
        const bytes = files.reduce((sum, f) => sum + f.cipher.bytes, COMPLETE_MAX_BYTES);
        await writeFile(reservationFile, JSON.stringify({ format: 1, run, bytes }), { mode: 0o600 });
        const reservation = await digest(reservationFile);
        checkAdmission(state, bytes + reservation.bytes, admissionCeiling);
        // Never start payload writes before the durable reservation is acknowledged and verified.
        await remote.put(reservationKey, reservationFile);
        await checkedDownload(remote, reservationKey, path.join(dir, 'reservation.readback'), reservation);
        expected.push({ Key: reservationKey, Size: reservation.bytes });
      }
      for (const [i, f] of files.entries()) {
        const isManifest = f.key === manifestKey;
        stage = isManifest ? 'manifest-upload' : 'r2-upload';
        await remote.put(f.key, f.file);
        stage = isManifest ? 'manifest-readback' : 'r2-readback';
        const verification = path.join(dir, `${i}.readback`);
        await checkedDownload(remote, f.key, verification, f.cipher);
        stage = 'local-cleanup'; await rm(verification); await rm(f.file);
      }
      // This marker certifies storage integrity only, never tested restorability.
      const completion = { format: 1, run, finished: new Date().toISOString(), profile: c.profile, recoveryReady: false, manifest: { key: manifestKey, ...cipher } };
      if (weeklySlot) {
        stage = 'completion-upload';
        if (slotAt(Date.parse(completion.finished)) !== weeklySlot) throw new Error('WEEKLY_SLOT_INVALID');
        Object.assign(completion, { weeklySlot, snapshotStarted: started, inventorySha256: inventoryHash(expected) });
        if (Buffer.byteLength(JSON.stringify(completion)) > COMPLETE_MAX_BYTES) throw new Error('WEEKLY_COMPLETION_INVALID');
      }
      stage = 'completion-upload'; await writeCompletion(remote, `${run}complete.json`, completion, path.join(dir, 'complete.json'));
      return completion;
    });
  } catch (error) { throw stageFailure(error, stage); }
  finally { if (!target) remote.close(); }
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
