import pg from 'pg';
import path from 'node:path';
import { readFile, chmod } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { command, quote } from './common.mjs';
import { verifyBackupIdentity } from './permissions.mjs';

export const binary = (c, name) => c.pgBin ? path.join(c.pgBin, name) : name;
export async function connection(c) {
  const ssl = c.synthetic ? false : { rejectUnauthorized: true, ca: await readFile(c.caFile, 'utf8') };
  const client = new pg.Client({ ...c.pg, ssl, connectionTimeoutMillis: 10_000, application_name: 'colliers_backup' });
  await client.connect(); return client;
}
export function pgEnvironment(c) {
  return {
    PATH: process.env.PATH, HOME: process.env.HOME,
    PGHOST: c.pg.host, PGPORT: String(c.pg.port), PGDATABASE: c.pg.database,
    PGUSER: c.pg.user, PGPASSWORD: c.pg.password,
    PGSSLMODE: c.synthetic ? 'disable' : 'verify-full', ...(c.caFile ? { PGSSLROOTCERT: c.caFile } : {}),
    PGAPPNAME: 'colliers_backup', PGCONNECT_TIMEOUT: '10', TZ: 'UTC',
  };
}
export async function extensionEvidence(client) {
  return (await client.query('select e.extname as name,e.extversion as version,n.nspname as schema from pg_extension e join pg_namespace n on n.oid=e.extnamespace order by e.extname')).rows;
}
export async function tableEvidence(client) {
  const tables = (await client.query("select schemaname,tablename from pg_tables where schemaname not like 'pg_%' and schemaname<>'information_schema' order by 1,2")).rows;
  const result = [];
  for (const t of tables) {
    const hash = createHash('sha256'); let count = 0;
    // A bounded cursor avoids loading an entire production table into Node.
    await client.query(`declare backup_rows no scroll cursor for select to_jsonb(t)::text as j from ${quote(t.schemaname)}.${quote(t.tablename)} t order by to_jsonb(t)::text collate "C"`);
    while (true) {
      const { rows } = await client.query('fetch 500 from backup_rows');
      for (const row of rows) { hash.update(row.j); hash.update('\n'); count++; }
      if (rows.length < 500) break;
    }
    await client.query('close backup_rows');
    result.push({ schema: t.schemaname, table: t.tablename, count, sha256: hash.digest('hex') });
  }
  return result;
}
export async function exportDatabase(c, dir) {
  const client = await connection(c);
  try {
    const version = (await client.query("select current_setting('server_version_num')::integer as n")).rows[0].n;
    if (version < 170000 || version >= 180000 || !(await command(binary(c, 'pg_dump'), ['--version'])).includes(' 17.')) throw new Error('POSTGRES_17_REQUIRED');
    await client.query("begin isolation level repeatable read read only; set local row_security=off; set local timezone='UTC'; set local statement_timeout='120s'");
    if (!c.synthetic || c.checkPermissions === true) await verifyBackupIdentity(client);
    const snapshot = (await client.query('select pg_export_snapshot() as id')).rows[0].id;
    const evidence = await tableEvidence(client);
    const extensions = await extensionEvidence(client);
    const bootstrapRole = (await client.query('select rolname from pg_roles where oid=10')).rows[0].rolname;
    const archive = path.join(dir, 'database.dump'); const roles = path.join(dir, 'roles.sql');
    await command(binary(c, 'pg_dump'), ['--format=custom', '--no-password', '--lock-wait-timeout=5s', `--snapshot=${snapshot}`, `--file=${archive}`], { env: pgEnvironment(c) });
    await client.query('commit');
    await command(binary(c, 'pg_dumpall'), ['--roles-only', '--no-role-passwords', '--no-password', `--file=${roles}`], { env: pgEnvironment(c) });
    await Promise.all([chmod(archive, 0o600), chmod(roles, 0o600)]);
    const schemas = [...new Set(evidence.map((x) => x.schema))];
    return { files: [{ file: archive, kind: 'database' }, { file: roles, kind: 'roles' }], evidence, bootstrapRole,
      prerequisites: [
        'Restore into a separately isolated PostgreSQL17/Supabase environment with matching extensions.',
        'Role passwords, platform Auth settings/API keys and external configuration require separate protected recovery.',
        ...(schemas.includes('vault') ? ['Vault/encrypted-column root-key recovery is not verified.'] : []),
      ], schemas, version, extensions };
  } catch (error) { await client.query('rollback').catch(() => {}); throw error; }
  finally { await client.end(); }
}
