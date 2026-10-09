-- OPERATOR ONLY. Not a migration. Run only after explicit phase-C approval,
-- verified old-client session drain, and review of rejected-row recovery UX.
-- Never perform a workday cutover merely because expansion succeeded.
begin;
set local lock_timeout = '500ms';
set local statement_timeout = '2s';
select pg_catalog.pg_advisory_xact_lock(71402, 1);
do $phase$ begin
  if (select quarter_configuration_frozen from private.quarterly_rollout_control where singleton) is not true then
    raise exception using message = 'quarter_configuration_must_be_frozen_before_cutover', errcode = '55000';
  end if;
end $phase$;
create or replace function public.set_current_submission_period(p_year integer, p_quarter integer)
returns table(previous_year integer, previous_quarter integer, current_year integer,
  current_quarter integer, drafts_rolled integer, future_assignments_created integer)
language sql security invoker set search_path = '' as $function$
  select * from public.set_current_submission_period_v2(p_year, p_quarter);
$function$;
revoke all on function public.set_current_submission_period(integer, integer) from public, anon;
grant execute on function public.set_current_submission_period(integer, integer) to authenticated, service_role;

-- Keep the legacy signature, but close the public validation bypass. Old
-- clients cannot supply a replay key, so each call is a new intentional request.
-- New clients must keep using v2 with their stable caller-generated request ID.
create or replace function public.submit_quarterly_batch(
  p_user_id uuid,
  p_user_name text,
  p_year integer,
  p_quarter integer,
  p_tab text,
  p_regular_rows jsonb default '[]'::jsonb,
  p_future_rows jsonb default '[]'::jsonb
)
returns table(regular_count integer, future_count integer, submitted_at timestamptz)
language sql security invoker set search_path = ''
as $function$
  select * from public.submit_quarterly_batch_v2(
    pg_catalog.gen_random_uuid(), p_user_id, p_user_name, p_year, p_quarter,
    p_tab, p_regular_rows, p_future_rows
  );
$function$;
revoke all on function public.submit_quarterly_batch(uuid, text, integer, integer, text, jsonb, jsonb)
  from public, anon;
grant execute on function public.submit_quarterly_batch(uuid, text, integer, integer, text, jsonb, jsonb)
  to authenticated, service_role;
update private.quarterly_rollout_control set quarter_configuration_frozen = false where singleton;
commit;
