begin;

create unique index if not exists update_drafts_owner_tab_uidx
  on public.update_drafts (user_id, tab);

create unique index if not exists future_supply_assignments_period_owner_uidx
  on public.future_supply_assignments (future_supply_id, user_id, record_year, record_quarter);

create or replace function public.save_quarterly_draft(
  p_user_id uuid,
  p_user_name text,
  p_year integer,
  p_quarter integer,
  p_tab text,
  p_draft_data jsonb,
  p_expected_revision bigint default 0
)
returns table(revision bigint, updated_at timestamptz)
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_existing public.update_drafts%rowtype;
  v_now timestamptz := now();
begin
  if auth.uid() is null or p_user_id is distinct from auth.uid() then
    raise exception using message = 'draft_owner_mismatch', errcode = '42501';
  end if;
  if not private.can_write_business_data() then
    raise exception using message = 'business_write_forbidden', errcode = '42501';
  end if;
  if p_tab not in ('GradeA', 'GradeB', 'BP') then
    raise exception using message = 'invalid_draft_tab', errcode = '22023';
  end if;
  if not private.is_current_submission_period(p_year, p_quarter) then
    raise exception using message = 'submission_period_changed', errcode = '22023';
  end if;

  select * into v_existing
  from public.update_drafts d
  where d.user_id = p_user_id
    and d.tab = p_tab
  for update;

  if not found then
    if coalesce(p_expected_revision, 0) <> 0 then
      raise exception using message = 'draft_revision_conflict', errcode = '40001';
    end if;

    insert into public.update_drafts (
      user_id, user_name, record_year, record_quarter, tab,
      draft_data, revision, updated_at
    ) values (
      p_user_id,
      coalesce(nullif(trim(p_user_name), ''), p_user_id::text),
      p_year,
      p_quarter,
      p_tab,
      coalesce(p_draft_data, '{}'::jsonb),
      1,
      v_now
    )
    returning public.update_drafts.revision, public.update_drafts.updated_at
      into revision, updated_at;

    return next;
    return;
  end if;

  if coalesce(p_expected_revision, 0) <> v_existing.revision then
    raise exception using message = 'draft_revision_conflict', errcode = '40001';
  end if;

  update public.update_drafts d
  set user_name = coalesce(nullif(trim(p_user_name), ''), d.user_name),
      record_year = p_year,
      record_quarter = p_quarter,
      draft_data = coalesce(p_draft_data, '{}'::jsonb),
      revision = d.revision + 1,
      updated_at = v_now
  where d.id = v_existing.id
  returning d.revision, d.updated_at into revision, updated_at;

  return next;
end;
$function$;

revoke all on function public.save_quarterly_draft(uuid, text, integer, integer, text, jsonb, bigint)
  from public, anon;
grant execute on function public.save_quarterly_draft(uuid, text, integer, integer, text, jsonb, bigint)
  to authenticated, service_role;

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
  where a.record_year = v_previous_year
    and a.record_quarter = v_previous_quarter
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

create or replace function public.submit_quarterly_batch(
  p_user_id uuid,
  p_user_name text,
  p_year integer,
  p_quarter integer,
  p_tab text,
  p_regular_rows jsonb default '[]'::jsonb,
  p_future_rows jsonb default '[]'::jsonb
)
returns table(
  regular_count integer,
  future_count integer,
  submitted_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_regular_count integer := 0;
  v_future_count integer := 0;
  v_now timestamptz := now();
begin
  if auth.uid() is null or p_user_id is distinct from auth.uid() then
    raise exception using message = 'submission_owner_mismatch', errcode = '42501';
  end if;
  if not private.can_write_business_data() then
    raise exception using message = 'business_write_forbidden', errcode = '42501';
  end if;
  if p_tab not in ('GradeA', 'GradeB', 'BP') then
    raise exception using message = 'invalid_submission_tab', errcode = '22023';
  end if;
  if not private.is_current_submission_period(p_year, p_quarter) then
    raise exception using message = 'submission_period_changed', errcode = '22023';
  end if;
  if jsonb_typeof(coalesce(p_regular_rows, '[]'::jsonb)) <> 'array'
     or jsonb_typeof(coalesce(p_future_rows, '[]'::jsonb)) <> 'array' then
    raise exception using message = 'invalid_submission_payload', errcode = '22023';
  end if;

  insert into public.quarterly_submissions (
    building_id, user_id, user_name, record_year, record_quarter,
    total_area, vacant_area, vacancy_rate, asking_rent, management_fee,
    face_rent, rent_free_period, net_effective_rent, owner,
    property_management, notes, created_at, updated_at
  )
  select
    r.building_id,
    p_user_id,
    coalesce(nullif(trim(p_user_name), ''), p_user_id::text),
    p_year,
    p_quarter,
    r.total_area,
    r.vacant_area,
    r.vacancy_rate,
    r.asking_rent,
    r.management_fee,
    r.face_rent,
    r.rent_free_period,
    r.net_effective_rent,
    r.owner,
    r.property_management,
    r.notes,
    v_now,
    v_now
  from jsonb_to_recordset(coalesce(p_regular_rows, '[]'::jsonb)) as r(
    building_id uuid,
    total_area numeric,
    vacant_area numeric,
    vacancy_rate numeric,
    asking_rent numeric,
    management_fee numeric,
    face_rent numeric,
    rent_free_period numeric,
    net_effective_rent numeric,
    owner text,
    property_management text,
    notes text
  );

  get diagnostics v_regular_count = row_count;

  insert into public.future_supply_submissions (
    future_supply_id, user_id, user_name, record_year, record_quarter,
    total_area, vacant_area, vacancy_rate, asking_rent, management_fee,
    face_rent, rent_free_period, net_effective_rent, owner,
    property_management, notes, created_at, updated_at
  )
  select
    r.future_supply_id,
    p_user_id,
    coalesce(nullif(trim(p_user_name), ''), p_user_id::text),
    p_year,
    p_quarter,
    r.total_area,
    r.vacant_area,
    r.vacancy_rate,
    r.asking_rent,
    r.management_fee,
    r.face_rent,
    r.rent_free_period,
    r.net_effective_rent,
    r.owner,
    r.property_management,
    r.notes,
    v_now,
    v_now
  from jsonb_to_recordset(coalesce(p_future_rows, '[]'::jsonb)) as r(
    future_supply_id uuid,
    total_area numeric,
    vacant_area numeric,
    vacancy_rate numeric,
    asking_rent numeric,
    management_fee numeric,
    face_rent numeric,
    rent_free_period numeric,
    net_effective_rent numeric,
    owner text,
    property_management text,
    notes text
  );

  get diagnostics v_future_count = row_count;

  regular_count := v_regular_count;
  future_count := v_future_count;
  submitted_at := v_now;
  return next;
end;
$function$;

revoke all on function public.submit_quarterly_batch(uuid, text, integer, integer, text, jsonb, jsonb)
  from public, anon;
grant execute on function public.submit_quarterly_batch(uuid, text, integer, integer, text, jsonb, jsonb)
  to authenticated, service_role;

commit;
