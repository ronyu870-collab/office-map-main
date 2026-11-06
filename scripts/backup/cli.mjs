import { configuration } from './config.mjs';
import { backup } from './pipeline.mjs';
import { safeFailure } from './diagnostics.mjs';
try {
  if (process.argv[2] !== 'create' || process.argv.length !== 3) throw new Error('USAGE_BACKUP_CREATE');
  // No user flag can enable the synthetic bypass in this production entry point.
  const result = await backup(configuration());
  console.log(JSON.stringify({ status: 'stored-and-readback-verified', run: result.run, profile: result.profile, recoveryReady: false }));
} catch (error) {
  console.error(JSON.stringify(safeFailure(error)));
  process.exitCode = 1;
}
