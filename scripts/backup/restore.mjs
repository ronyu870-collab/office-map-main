import path from 'node:path';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import pg from 'pg';
import { temporary, command } from './common.mjs';
import { binary, tableEvidence, extensionEvidence } from './database.mjs';
import { readBackup } from './pipeline.mjs';
import { rolesForBootstrap } from './roles.mjs';

// Own a fresh cluster, not just a database: globals.sql modifies cluster roles.
// Native execution is restricted to trusted, synthetic fixtures. Production
// archive drills need an isolated container (see operator runbook).
export async function freshCluster(c, action) {
  if (!c.synthetic) throw new Error('NATIVE_RESTORE_SYNTHETIC_ONLY');
  return temporary('colliers-restore-', async (dir) => {
    const data = path.join(dir, 'pg'); const socket = path.join(dir, 's');
    await mkdir(socket, { mode: 0o700 });
    const user = c.bootstrapRole || `drill_${randomBytes(8).toString('hex')}`;
    if (!/^[a-z_][a-z0-9_]{0,62}$/.test(user)) throw new Error('RESTORE_BOOTSTRAP_ROLE_INVALID');
    const password = randomBytes(32).toString('hex'); const pwfile = path.join(dir, 'pw');
    await writeFile(pwfile, password, { mode: 0o600 });
    await command(binary(c, 'initdb'), ['-D', data, '-U', user, '--pwfile', pwfile, '--auth-local=scram-sha-256', '--auth-host=reject', '--encoding=UTF8', '--locale=C']);
    await command(binary(c, 'pg_ctl'), ['-D', data, '-l', path.join(dir, 'pg.log'), '-o', `-k ${socket} -c listen_addresses=''`, '-w', 'start']);
    const env = { PATH: process.env.PATH, PGHOST: socket, PGUSER: user, PGPASSWORD: password, PGDATABASE: 'postgres', PGPORT: '5432', PGSSLMODE: 'disable', TZ: 'UTC' };
    const client = new pg.Client({ host: socket, port: 5432, user, password, database: 'postgres' });
    try { await client.connect(); return await action({ client, env, socket, user, password }); }
    finally { await client.end().catch(() => {}); await command(binary(c, 'pg_ctl'), ['-D', data, '-m', 'immediate', '-w', 'stop']); }
  });
}
export async function restoreFiles(c, files, cluster) {
  const roles = files.find((f) => f.kind === 'roles'); const database = files.find((f) => f.kind === 'database');
  if (!roles || !database) throw new Error('BACKUP_DATABASE_REQUIRED');
  const bootstrap = (await cluster.client.query('select rolname from pg_roles where oid=10')).rows[0].rolname;
  const prepared = `${roles.file}.bootstrap.sql`;
  await writeFile(prepared, rolesForBootstrap(await readFile(roles.file, 'utf8'), bootstrap), { mode: 0o600 });
  try { await command(binary(c, 'psql'), ['-X', '--no-password', '--set=ON_ERROR_STOP=1', '--file', prepared], { env: cluster.env }); }
  finally { await rm(prepared, { force: true }); }
  await command(binary(c, 'pg_restore'), ['--no-password', '--exit-on-error', '--single-transaction', '--dbname=postgres', database.file], { env: cluster.env });
}
export async function syntheticDrill(c, target, run, identity, assertions = async () => {}) {
  if (!c.synthetic) throw new Error('NATIVE_RESTORE_SYNTHETIC_ONLY');
  return temporary('colliers-drill-', async (dir) => {
    const { manifest, files } = await readBackup(c, target, run, dir, identity);
    return freshCluster(c, async (cluster) => {
      await restoreFiles(c, files, cluster);
      if (JSON.stringify(await extensionEvidence(cluster.client)) !== JSON.stringify(manifest.extensions)) throw new Error('RESTORE_EXTENSION_MISMATCH');
      await cluster.client.query("begin isolation level repeatable read read only; set local row_security=off; set local timezone='UTC'");
      const evidence = await tableEvidence(cluster.client);
      await cluster.client.query('commit');
      if (JSON.stringify(evidence) !== JSON.stringify(manifest.evidence)) throw new Error('RESTORE_DATA_MISMATCH');
      await assertions(cluster.client, files);
      return { format: 1, drill: randomUUID(), run, verifiedTables: evidence.length, verifiedObjects: files.filter((f) => f.kind === 'object').length, environment: 'synthetic-private-socket', productionRestoreVerified: false };
    });
  });
}
