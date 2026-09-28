begin;

create table backup_q3_20260928.future_supplies_pre_entered_market_reconcile as
select * from public.future_supplies;

create index if not exists future_supplies_entered_market_idx
  on public.future_supplies (is_entered_market, id);

update public.future_supplies
set is_entered_market = true
where id in (
  '34ee4188-e60a-4882-90b2-13654b18edf0'::uuid,
  'cf6a63a1-0e4d-4910-bc7d-aa3aee5e9d75'::uuid,
  '33772dc1-5c6c-4108-9aee-f15e95ed5c7f'::uuid,
  '06b6c8d3-537c-4f8b-84f6-1a692a93fae6'::uuid,
  '6ffac82c-257b-44e9-8806-e8f25902c922'::uuid
);

create or replace function public.set_current_submission_period(
  p_year integer,
  p_quarter integer
)
returns table(
  previous_year integer,
  previous_quarter integer,
  current_year integer,
  current_quarter integer,
  drafts_rolled integer,
  future_assignments_created integer
)
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_previous_year integer;
  v_previous_quarter integer;
  v_drafts_rolled integer := 0;
  v_future_created integer := 0;
begin
  if not private.is_admin() then
    raise exception using message = 'admin access required', errcode = '42501';
  end if;
  if p_year < 2020 or p_year > 2100 or p_quarter < 1 or p_quarter > 4 then
    raise exception using message = 'invalid_submission_period', errcode = '22023';
  end if;

  v_previous_year := private.current_submission_year();
  v_previous_quarter := private.current_submission_quarter();

  if (p_year * 4 + p_quarter) < (v_previous_year * 4 + v_previous_quarter) then
    raise exception using message = 'submission_period_cannot_move_backward', errcode = '22023';
  end if;

  if p_year = v_previous_year and p_quarter = v_previous_quarter then
    return query
      select v_previous_year, v_previous_quarter, p_year, p_quarter, 0, 0;
    return;
  end if;

  insert into public.future_supply_assignments (
    future_supply_id, user_id, user_name, record_year, record_quarter
  )
  select
    a.future_supply_id,
    a.user_id,
    a.user_name,
    p_year,
    p_quarter
  from public.future_supply_assignments a
  join public.future_supplies fs on fs.id = a.future_supply_id
  where a.record_year = v_previous_year
    and a.record_quarter = v_previous_quarter
    and coalesce(fs.is_entered_market, false) = false
  on conflict (future_supply_id, user_id, record_year, record_quarter) do nothing;

  get diagnostics v_future_created = row_count;

  update public.update_drafts
  set record_year = p_year,
      record_quarter = p_quarter
  where record_year is distinct from p_year
     or record_quarter is distinct from p_quarter;

  get diagnostics v_drafts_rolled = row_count;

  insert into public.app_settings(key, value, updated_at)
  values ('current_submission_year', p_year::text, now())
  on conflict (key) do update
    set value = excluded.value,
        updated_at = excluded.updated_at;

  insert into public.app_settings(key, value, updated_at)
  values ('current_submission_quarter', p_quarter::text, now())
  on conflict (key) do update
    set value = excluded.value,
        updated_at = excluded.updated_at;

  return query
    select v_previous_year, v_previous_quarter, p_year, p_quarter,
           v_drafts_rolled, v_future_created;
end;
$function$;

revoke all on function public.set_current_submission_period(integer, integer)
  from public, anon;
grant execute on function public.set_current_submission_period(integer, integer)
  to authenticated, service_role;

commit;
