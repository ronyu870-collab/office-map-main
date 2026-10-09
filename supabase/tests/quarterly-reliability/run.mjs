// No connection strings or remote connections: every run gets a fresh in-memory DB.
import { readFile } from 'node:fs/promises';
const { PGlite } = await import(process.env.PGLITE_MODULE || '@electric-sql/pglite');
const db = new PGlite();
const paths = [
  './fixture.sql',
  '../../migrations/20260928015050_harden_quarterly_period_rollover_and_submission.sql',
  '../../migrations/20260928020602_reconcile_entered_market_future_supplies.sql',
  './compatibility-before.sql',
  '../../migrations/20261008075610_preserve_quarterly_drafts_and_idempotent_submission.sql',
  '../../migrations/20261009020453_restrict_quarterly_history_sequence_client_privileges.sql',
  './sequence-privileges.sql',
  './compatibility-expansion.sql',
  './regression.sql',
  './validation.sql',
  '../../../docs/quarterly-rollout/02_freeze_quarter_configuration.sql',
  './phase-b.sql',
  '../../../docs/quarterly-rollout/03_enable_legacy_guards_after_drain.sql',
  './phase-c.sql',
  './reader-security.sql',
];
try {
  for (const path of paths) {
    let sql = await readFile(new URL(path, import.meta.url), 'utf8');
    let label = path;
    if (path.endsWith('20260928020602_reconcile_entered_market_future_supplies.sql')) {
      // Load only the latest legacy routine. Never execute historical row fixes
      // or copy real record identifiers from that source into the test fixture.
      const start = sql.indexOf('create or replace function public.set_current_submission_period(');
      const end = sql.lastIndexOf('commit;');
      if (start < 0 || end <= start) throw new Error('Latest legacy setter definition not found');
      sql = sql.slice(start, end);
      label = 'latest legacy setter definition only';
    }
    await db.exec(sql);
    console.log(`PASS ${label}`);
  }
} finally {
  await db.close();
}
