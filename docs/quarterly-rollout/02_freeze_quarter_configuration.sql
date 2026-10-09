-- OPERATOR ONLY. Not a migration; requires explicit phase-B approval.
-- Confirm no quarter-configuration call is already in flight before proceeding.
-- Broker draft saving/submission stays available through both old entrypoints.
begin;
set local lock_timeout = '500ms';
set local statement_timeout = '2s';
select pg_catalog.pg_advisory_xact_lock(71402, 1);
do $phase$ begin
  if (select quarter_configuration_frozen from private.quarterly_rollout_control where singleton) is not false then
    raise exception using message = 'quarter_configuration_already_frozen', errcode = '55000';
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
update private.quarterly_rollout_control set quarter_configuration_frozen = true where singleton;
commit;
