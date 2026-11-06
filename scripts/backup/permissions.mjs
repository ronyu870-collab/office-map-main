// Read-only catalogue preflight. A new callable definer or a changed helper
// blocks export until reviewed; default read-only is not an authorization ban.
const readHelpers = new Map([
  ['private.current_submission_quarter()', '2b719dc2c981e9974c80e95c5939ff42'],
  ['private.current_submission_year()', 'cd798f41e180f8774680068a89f9cbf2'],
  ['private.is_admin()', '974a6ac0745b56a9de907f416e6dcc97'],
  ['private.is_current_submission_period(integer,integer)', 'a87bc6f078bfcf9fde4632db21188849'],
]);
export async function verifyBackupIdentity(client) {
  const flags = (await client.query(`select r.rolsuper,r.rolcreaterole,r.rolcreatedb,r.rolreplication,r.rolbypassrls,
    current_user=session_user as direct_login,
    current_setting('default_transaction_read_only')='on' as default_readonly,
    has_database_privilege(current_user,current_database(),'CREATE') as db_create
    from pg_roles r where r.rolname=current_user`)).rows[0];
  if (!flags || flags.rolsuper || flags.rolcreaterole || flags.rolcreatedb || flags.rolreplication || !flags.rolbypassrls || !flags.direct_login || !flags.default_readonly || flags.db_create) throw new Error('BACKUP_ROLE_PRIVILEGES_REJECTED');
  const memberships = await client.query(`select 1 from pg_roles r where r.rolname=any($1::text[])
    and pg_has_role(current_user,r.oid,'MEMBER') limit 1`, [['anon','authenticated','service_role','postgres','supabase_admin','supabase_auth_admin','supabase_storage_admin','supabase_privileged_role']]);
  if (memberships.rowCount) throw new Error('BACKUP_ROLE_PRIVILEGES_REJECTED');
  const writes = await client.query(`select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace
    where n.nspname not like 'pg_%' and n.nspname<>'information_schema' and (
      c.relowner=(select oid from pg_roles where rolname=current_user)
      or (case when c.relkind in ('r','p','v','m','f') then (
        has_table_privilege(current_user,c.oid,'INSERT,UPDATE,DELETE,TRUNCATE,TRIGGER')
        or has_any_column_privilege(current_user,c.oid,'INSERT,UPDATE')) else false end)
      or (case when c.relkind='S' then has_sequence_privilege(current_user,c.oid,'USAGE,UPDATE') else false end)
    ) limit 1`);
  const schemaCreate = await client.query(`select 1 from pg_namespace n where n.nspname not like 'pg_%'
    and n.nspname<>'information_schema' and has_schema_privilege(current_user,n.oid,'CREATE') limit 1`);
  if (writes.rowCount || schemaCreate.rowCount) throw new Error('BACKUP_ROLE_PRIVILEGES_REJECTED');
  const functions = (await client.query(`select p.oid::regprocedure::text as signature,md5(p.prosrc) as body_md5,
    n.nspname as schema,p.proname,pg_get_function_identity_arguments(p.oid) as args,
    pg_get_userbyid(p.proowner) as owner,p.provolatile,p.prokind,p.proconfig,l.lanname
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace join pg_language l on l.oid=p.prolang
    where p.prosecdef and n.nspname not like 'pg_%' and n.nspname<>'information_schema'
      and has_function_privilege(current_user,p.oid,'EXECUTE')`)).rows;
  for (const fn of functions) {
    if (readHelpers.get(fn.signature) !== fn.body_md5 || fn.owner !== 'postgres' || fn.lanname !== 'sql' || fn.provolatile !== 's' || fn.prokind !== 'f' || JSON.stringify(fn.proconfig) !== JSON.stringify(['search_path=""'])) throw new Error('BACKUP_CALLABLE_DEFINER_REJECTED');
  }
}
