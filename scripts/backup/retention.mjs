import path from 'node:path';
import { lstat, open } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { required, safeCode } from './common.mjs';
import { targetConfiguration } from './config.mjs';
import { scopedDeleter, store, verifyPrivateTarget } from './r2.mjs';
import { hashJSON, rotationPlan, weeklyHealth, weeklyState } from './weekly.mjs';

const listDetails = (objects) => objects.map(o => ({
  key: o.Key, bytes: o.Size, modified: new Date(o.LastModified).toISOString(),
})).sort((a, b) => a.key.localeCompare(b.key));

// Local operator path only. A private, retained journal locks the week before
// mutation and preserves the approved keys if a delete is interrupted.
export async function applyRotation(c, target, deleter, { run, planSha256, journalDir, now = Date.now() }) {
  const state = await weeklyState(c, target, { now });
  weeklyHealth(state, now);
  const plan = rotationPlan(c, state, now);
  if (plan.status !== 'rotation-preview' || plan.run !== run || plan.planSha256 !== planSha256) throw new Error('ROTATION_PLAN_CHANGED');
  const dir = await lstat(journalDir);
  if (!path.isAbsolute(journalDir) || !dir.isDirectory() || (dir.mode & 0o077) !== 0 || dir.uid !== process.getuid()) throw new Error('ROTATION_JOURNAL_UNSAFE');
  const latestObjects = listDetails(await target.list(plan.run));
  if (hashJSON(latestObjects) !== hashJSON(plan.objects)) throw new Error('ROTATION_PLAN_CHANGED');
  const journal = await open(path.join(journalDir, `${plan.slot.slice(0, 10)}.jsonl`), 'wx', 0o600);
  try {
    await journal.writeFile(JSON.stringify({ status: 'approved-for-removal', plan }) + '\n');
    await journal.sync();
    const directory = await open(journalDir, 'r');
    try { await directory.sync(); } finally { await directory.close(); }
    const markerKey = `${plan.run}complete.json`;
    await deleter.remove(markerKey);
    if ((await target.list(plan.run)).some(o => o.Key === markerKey)) throw new Error('ROTATION_MARKER_STILL_PRESENT');
    for (const object of plan.objects) if (object.key !== markerKey) await deleter.remove(object.key);
    if ((await target.list(plan.run)).length !== 0) throw new Error('ROTATION_INCOMPLETE');
    const result = { status: 'rotation-complete', slot: plan.slot, run: plan.run, bytes: plan.bytes };
    await journal.writeFile(JSON.stringify(result) + '\n');
    await journal.sync();
    return result;
  } finally { await journal.close(); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  let target; let deleter;
  try {
    const [action, run, planSha256] = process.argv.slice(2);
    if (!((action === 'preview' && process.argv.length === 3) || (action === 'apply' && process.argv.length === 5 && /^[a-f0-9]{64}$/.test(planSha256)))) throw new Error('USAGE_ROTATION');
    const c = targetConfiguration(); const rules = await verifyPrivateTarget(c); target = store(c);
    if (action === 'preview') {
      const now = Date.now(); const state = await weeklyState(c, target, { now });
      weeklyHealth(state, now);
      console.log(JSON.stringify(rotationPlan(c, state, now)));
    } else {
      if (process.env.GITHUB_ACTIONS) throw new Error('ROTATION_REQUIRES_LOCAL_OPERATOR');
      const credentials = { accessKeyId: required(process.env, 'BACKUP_ROTATION_ACCESS_KEY_ID'), secretAccessKey: required(process.env, 'BACKUP_ROTATION_SECRET_ACCESS_KEY'), sessionToken: required(process.env, 'BACKUP_ROTATION_SESSION_TOKEN') };
      deleter = scopedDeleter(c, run, credentials);
      // A conflicting rule on only some objects could allow deleting the
      // marker while leaving the archive locked. Stop before any mutation.
      const overlapping = rules.filter(r => r.enabled && (run.startsWith(r.prefix || '') || r.prefix?.startsWith(run)));
      if (overlapping.length !== 1 || overlapping[0].prefix !== c.prefix || overlapping[0].condition?.type !== 'Age' || overlapping[0].condition.maxAgeSeconds !== 30 * 86400) throw new Error('ROTATION_LOCK_UNEXPECTED');
      console.log(JSON.stringify(await applyRotation(c, target, deleter, { run, planSha256, journalDir: required(process.env, 'BACKUP_ROTATION_JOURNAL_DIR') })));
    }
  } catch (error) { console.error(JSON.stringify({ status: 'failed', code: safeCode(error) })); process.exitCode = 1; }
  finally { deleter?.close(); target?.close(); }
}
