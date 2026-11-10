import { configuration } from './config.mjs';
import { backup } from './pipeline.mjs';
import { safeFailure } from './diagnostics.mjs';
import { store, verifyPrivateTarget } from './r2.mjs';
import { runIfMissing, slotAt } from './weekly.mjs';
let target;
try {
  if (process.argv[2] !== 'create' || process.argv.length !== 3) throw new Error('USAGE_BACKUP_CREATE');
  if (process.env.GITHUB_ACTIONS !== 'true' || process.env.GITHUB_REF !== 'refs/heads/main' || !process.env.GITHUB_WORKFLOW_REF?.endsWith('/.github/workflows/backup.yml@refs/heads/main')) throw new Error('WEEKLY_PRODUCTION_GUARD_REQUIRED');
  // No user flag can enable the synthetic bypass in this production entry point.
  const c = configuration();
  if (c.profile !== 'supabase') throw new Error('WEEKLY_SLOT_INVALID');
  await verifyPrivateTarget(c);
  target = store(c);
  const result = await runIfMissing(c, target, weeklySlot => backup(c, { weeklySlot }));
  console.log(JSON.stringify({ status: result.alreadyComplete ? 'weekly-already-complete' : 'stored-and-readback-verified', slot: slotAt(Date.parse(result.finished)), run: result.run, profile: result.profile, recoveryReady: false }));
} catch (error) {
  console.error(JSON.stringify(safeFailure(error)));
  process.exitCode = 1;
} finally { target?.close(); }
