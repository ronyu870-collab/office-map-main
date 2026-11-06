import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import pg from 'pg';
import { freshCluster } from '../restore.mjs';
import { exportDatabase } from '../database.mjs';
import { temporary } from '../common.mjs';
import { verifyBackupIdentity } from '../permissions.mjs';

// A candidate account is tested only in a new synthetic cluster. These tests
// deliberately prove why read-table grants are not an account-level write ban.
// No provisioning SQL from this fixture is sent to Supabase.
export async function roleBoundary(c, test) {
  await freshCluster(c, async (cluster) => {
    const password = randomBytes(32).toString('hex');
    await cluster.client.query(`
      create role candidate_backup login inherit bypassrls
        nosuperuser nocreatedb nocreaterole noreplication password '${password}';
      grant pg_read_all_data to candidate_backup;
      alter role candidate_backup set default_transaction_read_only=on;
      alter role candidate_backup set search_path=pg_catalog;
      create role synthetic_application;
      create schema private;
      create table private.synthetic_records(id int primary key, owner_id int, viewed boolean);
      insert into private.synthetic_records values(1,1,false),(2,2,false);
      alter table private.synthetic_records enable row level security;
      create policy synthetic_owner on private.synthetic_records using(owner_id=1);
      create function private.synthetic_mark_read() returns void language plpgsql
      security definer set search_path=pg_catalog as $$
      begin
        if (coalesce(current_setting('request.jwt.claims',true),'{}')::jsonb ->> 'sub') is distinct from 'synthetic-user' then
          raise exception 'forbidden' using errcode='42501';
        end if;
        update private.synthetic_records set viewed=true where id=1;
      end $$;
      grant usage on schema private to synthetic_application;
    `);
    const db = { host: cluster.socket, port: 5432, user: 'candidate_backup', password, database: 'postgres' };
    const client = new pg.Client(db);
    try {
      await client.connect();
      await test('candidate read account exports all RLS rows and denies direct business writes', async () => {
        assert.equal((await client.query('show default_transaction_read_only')).rows[0].default_transaction_read_only, 'on');
        assert.equal((await client.query('select count(*)::int as n from private.synthetic_records')).rows[0].n, 2);
        await client.query('begin read write');
        await assert.rejects(client.query('update private.synthetic_records set viewed=true'), (e) => e.code === '42501');
        await client.query('rollback');
        await temporary('colliers-role-export-', async (dir) => {
          const result = await exportDatabase({ ...c, pg: db }, dir);
          assert.equal(result.evidence.find((e) => e.table === 'synthetic_records').count, 2);
          assert.equal(result.files.length, 2);
        });
      });
      await test('PUBLIC definer execution can bypass read-table grants and default read-only', async () => {
        await assert.rejects(verifyBackupIdentity(client), /BACKUP_CALLABLE_DEFINER_REJECTED/);
        await temporary('colliers-role-rejected-', async (dir) => {
          await assert.rejects(exportDatabase({ ...c, pg: db, checkPermissions: true }, dir), /BACKUP_CALLABLE_DEFINER_REJECTED/);
        });
        await client.query("select set_config('request.jwt.claims','{\"sub\":\"synthetic-user\"}',false)");
        await assert.rejects(client.query('select private.synthetic_mark_read()'), (e) => e.code === '25006');
        // A role-specific REVOKE cannot cancel a grant inherited from PUBLIC.
        await cluster.client.query('revoke execute on function private.synthetic_mark_read() from candidate_backup');
        assert.equal((await client.query("select has_function_privilege(current_user,'private.synthetic_mark_read()','execute') as allowed")).rows[0].allowed, true);
        await client.query('begin read write');
        await client.query('select private.synthetic_mark_read()');
        await client.query('commit');
        assert.equal((await cluster.client.query('select viewed from private.synthetic_records where id=1')).rows[0].viewed, true);
      });
      await test('explicit application-only definer ACL denies backup account and preserves allowed caller', async () => {
        await cluster.client.query(`
          update private.synthetic_records set viewed=false;
          revoke execute on function private.synthetic_mark_read() from public;
          grant execute on function private.synthetic_mark_read() to synthetic_application;
        `);
        await client.query('begin read write');
        await assert.rejects(client.query('select private.synthetic_mark_read()'), (e) => e.code === '42501');
        await client.query('rollback');
        await verifyBackupIdentity(client);
        assert.equal((await cluster.client.query('select viewed from private.synthetic_records where id=1')).rows[0].viewed, false);
        await cluster.client.query("set role synthetic_application; select set_config('request.jwt.claims','{\"sub\":\"synthetic-user\"}',false)");
        await cluster.client.query('select private.synthetic_mark_read()');
        await cluster.client.query('reset role');
        assert.equal((await cluster.client.query('select viewed from private.synthetic_records where id=1')).rows[0].viewed, true);
      });
      await test('export preflight accepts reviewed read helper and refuses helper drift, column writes and privileged membership', async () => {
        await cluster.client.query("create role postgres; create sequence public.synthetic_counter; create table public.app_settings(key text,value text);insert into public.app_settings values('current_submission_quarter','3');grant select on public.app_settings to postgres");
        const helper = `create or replace function private.current_submission_quarter() returns integer language sql stable security definer set search_path='' as $$
  select value::integer
  from public.app_settings
  where key = 'current_submission_quarter';
$$;alter function private.current_submission_quarter() owner to postgres`;
        await cluster.client.query(helper);
        await temporary('colliers-role-accepted-', async (dir) => {
          const result=await exportDatabase({ ...c, pg: db, checkPermissions: true }, dir);
          assert.equal(result.files.length,2);
        });
        await cluster.client.query("create or replace function private.current_submission_quarter() returns integer language sql stable security definer as $$ select 1 $$");
        await assert.rejects(verifyBackupIdentity(client),/BACKUP_CALLABLE_DEFINER_REJECTED/);
        await cluster.client.query(helper);
        await cluster.client.query("alter function private.current_submission_quarter() set search_path=public");
        await assert.rejects(verifyBackupIdentity(client),/BACKUP_CALLABLE_DEFINER_REJECTED/);
        await cluster.client.query(helper);
        await cluster.client.query('grant update(viewed) on private.synthetic_records to candidate_backup');
        await assert.rejects(verifyBackupIdentity(client),/BACKUP_ROLE_PRIVILEGES_REJECTED/);
        await cluster.client.query('revoke update(viewed) on private.synthetic_records from candidate_backup;grant postgres to candidate_backup');
        await assert.rejects(verifyBackupIdentity(client),/BACKUP_ROLE_PRIVILEGES_REJECTED/);
        await cluster.client.query('revoke postgres from candidate_backup');
        await cluster.client.query('grant usage on sequence public.synthetic_counter to candidate_backup');
        await assert.rejects(verifyBackupIdentity(client),/BACKUP_ROLE_PRIVILEGES_REJECTED/);
        await cluster.client.query('revoke usage on sequence public.synthetic_counter from candidate_backup');
        await verifyBackupIdentity(client);
      });
    } finally { await client.end(); }
  });
}
