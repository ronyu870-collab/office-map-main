import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { targetConfiguration } from './config.mjs';
import { store, verifyPrivateTarget } from './r2.mjs';
import { temporary, safeCode } from './common.mjs';
import { pathToFileURL } from 'node:url';

// A missing/late full completion must fail independently of the backup job.
// This detects scheduling/storage failures; it does not certify restorability.
export async function health(c, target, { now = Date.now(), maxAgeMs = 30 * 3600_000 } = {}) {
  const keys = (await target.list(c.prefix)).filter((x) => x.Key?.endsWith('/complete.json'));
  let newest;
  await temporary('colliers-health-', async (dir) => {
    for (let i = 0; i < keys.length; i++) {
      const key = keys[i].Key; const file = path.join(dir, `${i}.json`);
      await target.get(key, file);
      const marker = JSON.parse(await readFile(file, 'utf8'));
      const timestamp = Date.parse(marker.finished);
      if (marker.format !== 1 || marker.profile !== 'full' || key !== `${marker.run}complete.json` || marker.manifest?.key !== `${marker.run}manifest.age` || !Number.isFinite(timestamp) || timestamp > now + 300_000) continue;
      if (!newest || timestamp > newest.timestamp) newest = { run: marker.run, timestamp };
    }
  });
  if (!newest || now - newest.timestamp > maxAgeMs) throw new Error('NO_RECENT_FULL_BACKUP');
  return { status: 'recent-upload-completion', run: newest.run, ageHours: (now - newest.timestamp) / 3600_000, recoveryReady: false };
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  let target;
  try {
    const c = targetConfiguration(); await verifyPrivateTarget(c); target = store(c);
    console.log(JSON.stringify(await health(c, target)));
  } catch (error) { console.error(JSON.stringify({ status: 'failed', code: safeCode(error) })); process.exitCode = 1; }
  finally { target?.close(); }
}
