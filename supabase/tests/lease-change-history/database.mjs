// Only a disposable localhost PostgreSQL 17 service is accepted. No remote URL,
// ambient PG* credentials or production records can enter this harness.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import pg from 'pg';

export const OWNER = '11111111-1111-4111-8111-111111111111';
export const OTHER = '22222222-2222-4222-8222-222222222222';
export const ADMIN = '33333333-3333-4333-8333-333333333333';
export const VIEWER = '44444444-4444-4444-8444-444444444444';
export const recordId = (n = 1) => `55555555-5555-4555-8555-${String(n).padStart(12, '0')}`;
const source = (p) => readFile(new URL(p, import.meta.url), 'utf8');
const repairPath = '../../migrations/20261026095401_fix_lease_transaction_audit_change_count.sql';

export async function createLeaseTestDatabase() {
  assert.ok(process.env.GITHUB_ACTIONS === 'true' || process.env.LEASE_TEST_ALLOW_LOCAL === 'disposable', 'Use a disposable CI service or explicitly acknowledge the disposable local service');
  const port = Number(process.env.LEASE_TEST_PG_PORT);
  assert.ok(Number.isInteger(port) && port > 0 && port <= 65535, 'Missing disposable PostgreSQL service port');
  const config = { host: '127.0.0.1', port, user: 'postgres', password: 'synthetic_ci_only', connectionTimeoutMillis: 5000 };
  const admin = new pg.Client({ ...config, database: 'postgres' });
  await admin.connect();
  const database = `lease_synthetic_${randomUUID().replaceAll('-', '')}`;
  let setup;
  let created = false;
  try {
    const version = (await admin.query("select current_setting('server_version_num')::int as n, version() as version")).rows[0];
    assert.ok(version.n >= 170000 && version.n < 180000, 'PostgreSQL 17 required');
    for (const role of ['anon', 'authenticated', 'service_role']) {
      if (!(await admin.query('select 1 from pg_roles where rolname=$1', [role])).rowCount) await admin.query(`create role ${role}`);
    }
    await admin.query(`create database ${database}`);
    created = true;
    setup = new pg.Client({ ...config, database });
    await setup.connect();
    await setup.query("set statement_timeout='8s'");
    await setup.query(await source('./fixture.sql'));
    const base = await source('../../migrations/20260730043721_create_colliers_lite_schema.sql');
    const timestampFunction = base.slice(base.indexOf('create or replace function private.set_updated_at()'), base.indexOf('create or replace function private.is_admin()'));
    assert.ok(timestampFunction.includes('return new;'));
    await setup.query(timestampFunction);
    await setup.query('create trigger lease_transactions_set_updated_at before update on public.lease_transactions for each row execute function private.set_updated_at()');
    // Execute the original historical migration unchanged, including its trigger.
    await setup.query(await source('../../migrations/20260918123000_add_lease_transaction_change_history.sql'));
    const parity = await source('../../migrations/20260927045505_viewer_readonly_editor_parity.sql');
    const writeHelper = parity.slice(parity.indexOf('create or replace function private.can_write_business_data()'), parity.indexOf('-- Map / building reads:'));
    const policies = parity.slice(parity.indexOf('-- Lease business writes:'), parity.indexOf('-- Lease cloud drafts'));
    assert.ok(writeHelper.includes('grant execute'));
    assert.ok(policies.includes('business writers and admins update lease transactions'));
    await setup.query(writeHelper);
    await setup.query(policies);
    await setup.query(await source('../../migrations/20260927074605_remove_lease_team_access_switch.sql'));
    return {
      setup, version: version.version, database,
      async asUser(uid, sql, args = []) {
        await setup.query('begin');
        try {
          await setup.query("select set_config('request.jwt.claim.sub',$1,true)", [uid]);
          await setup.query('set local role authenticated');
          const result = await setup.query(sql, args);
          await setup.query('commit');
          return result;
        } catch (error) {
          await setup.query('rollback');
          throw error;
        }
      },
      async repair() { await setup.query(await source(repairPath)); },
      async close() {
        await setup.end();
        await admin.query(`drop database ${database} with (force)`);
        await admin.end();
      },
    };
  } catch (error) {
    await setup?.end().catch(() => {});
    if (created) await admin.query(`drop database ${database} with (force)`).catch(() => {});
    await admin.end();
    throw error;
  }
}
