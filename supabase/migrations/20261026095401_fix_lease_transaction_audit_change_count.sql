begin;

-- Repair the committed UPDATE path without changing policies, grants or triggers.
-- PostgreSQL has jsonb_object_keys(), but no jsonb_object_length(jsonb).
create or replace function private.audit_lease_transaction_update()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_old jsonb;
  v_new jsonb;
  v_changed jsonb;
  v_user_id text;
begin
  v_old := to_jsonb(old) - 'updated_at';
  v_new := to_jsonb(new) - 'updated_at';

  if v_old = v_new then
    return new;
  end if;

  select coalesce((select auth.uid())::text, 'system')
    into v_user_id;

  select coalesce(
    jsonb_object_agg(
      field_key,
      jsonb_build_object('old', v_old -> field_key, 'new', v_new -> field_key)
    ),
    '{}'::jsonb
  )
  into v_changed
  from (
    select field_key
    from jsonb_object_keys(v_old) as old_keys(field_key)
    union
    select field_key
    from jsonb_object_keys(v_new) as new_keys(field_key)
  ) changed_keys
  where (v_old -> field_key) is distinct from (v_new -> field_key);

  insert into public.audit_logs (
    user_id,
    action_type,
    details,
    request_source,
    module,
    target_table,
    target_id,
    target_name,
    old_values,
    new_values,
    event_id,
    occurred_at
  )
  values (
    v_user_id,
    'LEASE_TRANSACTION_UPDATE',
    jsonb_build_object(
      'table', 'lease_transactions',
      'operation', 'UPDATE',
      'changed_fields', v_changed,
      'change_count', (select count(*) from pg_catalog.jsonb_object_keys(v_changed))
    ),
    'database_trigger',
    'lease-submission',
    'lease_transactions',
    new.id::text,
    concat_ws(' · ', nullif(new.company, ''), nullif(new.new_building, '')),
    v_old,
    v_new,
    gen_random_uuid()::text,
    now()
  );

  return new;
end;
$$;

commit;
