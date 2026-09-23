begin;

-- Submit one quarterly category in a single database transaction. The client must
-- have synchronised the matching cloud draft first; the draft revision is locked
-- and re-checked here so another browser cannot race a stale submission through.
create or replace function public.submit_quarterly_data_atomic(
  p_user_id uuid,
  p_year integer,
  p_quarter integer,
  p_tab text,
  p_regular_rows jsonb default '[]'::jsonb,
  p_future_rows jsonb default '[]'::jsonb,
  p_expected_draft_revision bigint default 0
)
returns table (
  regular_count integer,
  future_count integer,
  submitted_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_draft public.update_drafts%rowtype;
  v_regular_count integer := 0;
  v_future_count integer := 0;
  v_submitted_at timestamptz := now();
begin
  if auth.uid() is null or p_user_id is distinct from auth.uid() then
    raise exception using message = 'submission_owner_mismatch', errcode = '42501';
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

  if jsonb_array_length(coalesce(p_regular_rows, '[]'::jsonb))
     + jsonb_array_length(coalesce(p_future_rows, '[]'::jsonb)) = 0 then
    raise exception using message = 'empty_submission_payload', errcode = '22023';
  end if;

  select * into v_draft
  from public.update_drafts d
  where d.user_id = p_user_id
    and d.record_year = p_year
    and d.record_quarter = p_quarter
    and d.tab = p_tab
  for update;

  if not found then
    raise exception using message = 'draft_not_found', errcode = '40001';
  end if;

  if coalesce(p_expected_draft_revision, 0) <= 0
     or p_expected_draft_revision <> v_draft.revision then
    raise exception using message = 'draft_revision_conflict', errcode = '40001';
  end if;

  -- Because this function is SECURITY DEFINER, assignment ownership is verified
  -- explicitly rather than relying on table RLS inside the function.
  if exists (
    select 1
    from jsonb_to_recordset(coalesce(p_regular_rows, '[]'::jsonb)) as x(building_id uuid)
    left join public.building_assignments a
      on a.building_id = x.building_id
     and a.user_id = p_user_id::text
    where x.building_id is null or a.building_id is null
  ) then
    raise exception using message = 'building_assignment_mismatch', errcode = '42501';
  end if;

  if exists (
    select 1
    from jsonb_to_recordset(coalesce(p_future_rows, '[]'::jsonb)) as x(future_supply_id uuid)
    left join public.future_supply_assignments a
      on a.future_supply_id = x.future_supply_id
     and a.user_id = p_user_id
     and a.record_year = p_year
     and a.record_quarter = p_quarter
    where x.future_supply_id is null or a.future_supply_id is null
  ) then
    raise exception using message = 'future_supply_assignment_mismatch', errcode = '42501';
  end if;

  insert into public.quarterly_submissions (
    building_id,
    user_id,
    user_name,
    record_year,
    record_quarter,
    total_area,
    vacant_area,
    vacancy_rate,
    asking_rent,
    management_fee,
    face_rent,
    rent_free_period,
    net_effective_rent,
    owner,
    property_management,
    notes,
    created_at,
    updated_at
  )
  select
    x.building_id,
    p_user_id,
    coalesce(nullif(trim(x.user_name), ''), p_user_id::text),
    p_year,
    p_quarter,
    x.total_area,
    x.vacant_area,
    x.vacancy_rate,
    x.asking_rent,
    x.management_fee,
    x.face_rent,
    x.rent_free_period,
    x.net_effective_rent,
    x.owner,
    x.property_management,
    x.notes,
    v_submitted_at,
    v_submitted_at
  from jsonb_to_recordset(coalesce(p_regular_rows, '[]'::jsonb)) as x(
    building_id uuid,
    user_name text,
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
    future_supply_id,
    user_id,
    user_name,
    record_year,
    record_quarter,
    total_area,
    vacant_area,
    vacancy_rate,
    asking_rent,
    management_fee,
    face_rent,
    rent_free_period,
    net_effective_rent,
    owner,
    property_management,
    notes,
    created_at,
    updated_at
  )
  select
    x.future_supply_id,
    p_user_id,
    coalesce(nullif(trim(x.user_name), ''), p_user_id::text),
    p_year,
    p_quarter,
    x.total_area,
    x.vacant_area,
    x.vacancy_rate,
    x.asking_rent,
    x.management_fee,
    x.face_rent,
    x.rent_free_period,
    x.net_effective_rent,
    x.owner,
    x.property_management,
    x.notes,
    v_submitted_at,
    v_submitted_at
  from jsonb_to_recordset(coalesce(p_future_rows, '[]'::jsonb)) as x(
    future_supply_id uuid,
    user_name text,
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
  submitted_at := v_submitted_at;
  return next;
end;
$$;

revoke all on function public.submit_quarterly_data_atomic(uuid, integer, integer, text, jsonb, jsonb, bigint) from public, anon;
grant execute on function public.submit_quarterly_data_atomic(uuid, integer, integer, text, jsonb, jsonb, bigint) to authenticated;

commit;