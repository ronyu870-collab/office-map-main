import path from 'node:path';
import { lstat } from 'node:fs/promises';
import { targetConfiguration } from './config.mjs';
import { store, verifyPrivateTarget } from './r2.mjs';
import { readBackup } from './pipeline.mjs';
import { temporary, safeCode, required } from './common.mjs';

let target;
try {
  const run = process.argv[2];
  if (!run || process.argv.length !== 3) throw new Error('BACKUP_RUN_REJECTED');
  const identity = required(process.env, 'BACKUP_IDENTITY_FILE');
  const metadata = await lstat(identity);
  if (!metadata.isFile() || metadata.isSymbolicLink() || (metadata.mode & 0o077) !== 0 || metadata.uid !== process.getuid()) throw new Error('BACKUP_IDENTITY_PROTECTION_REQUIRED');
  const c = targetConfiguration(); await verifyPrivateTarget(c); target = store(c);
  await temporary('colliers-inspect-', async (dir) => {
    const { manifest, files } = await readBackup(c, target, run, dir, path.resolve(identity));
    console.log(JSON.stringify({ status: 'download-decrypt-and-hash-verified', run, profile: manifest.profile, tableCount: manifest.evidence.length, objectCount: files.filter((f) => f.kind === 'object').length, recoveryReady: false }));
  });
} catch (error) { console.error(JSON.stringify({ status: 'failed', code: safeCode(error) })); process.exitCode = 1; }
finally { target?.close(); }
