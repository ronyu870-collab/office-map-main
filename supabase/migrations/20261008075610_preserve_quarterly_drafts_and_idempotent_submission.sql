begin;

-- Retained evidence must not become readable through a still-valid token after
-- account deletion or removal of the account's application role.
create function private.is_active_quarterly_reader()
returns boolean language sql stable security definer set search_path = ''
as $function$
  select exists (
    select 1 from auth.users u
    join public.user_roles r on r.user_id = u.id
    where u.id = (select auth.uid()) and r.role in ('viewer', 'editor', 'admin')
  );
$function$;
revoke all on function private.is_active_quarterly_reader() from public, anon, authenticated;
grant execute on function private.is_active_quarterly_reader() to authenticated;

-- Append-only snapshots deliberately have no cascading foreign keys: deleting a
-- draft/account must not silently erase recovery evidence. No pruning is added.
create table public.quarterly_draft_history (
  id bigint generated always as identity primary key,
  draft_id bigint not null,
  user_id uuid,
  event text not null check (event in ('baseline', 'INSERT', 'UPDATE', 'DELETE')),
  snapshot jsonb not null,
  archived_at timestamptz not null default now()
);
alter table public.quarterly_draft_history enable row level security;
revoke all on public.quarterly_draft_history from public, anon, authenticated;
grant select on public.quarterly_draft_history to authenticated;
create policy "owners read quarterly draft history"
  on public.quarterly_draft_history for select to authenticated
  using (user_id = (select auth.uid()) and (select private.is_active_quarterly_reader()));
create index quarterly_draft_history_owner_idx
  on public.quarterly_draft_history(user_id, draft_id, id desc);

create function private.archive_quarterly_draft()
returns trigger language plpgsql security definer set search_path = ''
as $function$
begin
  if TG_OP = 'INSERT' then
    insert into public.quarterly_draft_history(draft_id, user_id, event, snapshot)
    values (NEW.id, NEW.user_id, TG_OP, to_jsonb(NEW));
    return NEW;
  end if;
  insert into public.quarterly_draft_history(draft_id, user_id, event, snapshot)
  values (OLD.id, OLD.user_id, TG_OP, to_jsonb(OLD));
  if TG_OP = 'DELETE' then return OLD; end if;
  return NEW;
end;
$function$;
revoke all on function private.archive_quarterly_draft() from public, anon, authenticated;

create function private.reject_quarterly_history_mutation()
returns trigger language plpgsql set search_path = ''
as $function$
begin
  raise exception using message = 'quarterly_draft_history_is_append_only', errcode = '42501';
end;
$function$;
revoke all on function private.reject_quarterly_history_mutation() from public, anon, authenticated;
create trigger quarterly_draft_history_append_only
before update or delete or truncate on public.quarterly_draft_history
for each statement execute function private.reject_quarterly_history_mutation();

-- This ledger is not exposed through the Data API, and has no client policies.
create table private.quarterly_submission_requests (
  user_id uuid not null,
  request_id uuid not null,
  payload jsonb not null,
  regular_count integer not null,
  future_count integer not null,
  submitted_at timestamptz not null,
  primary key (user_id, request_id)
);
alter table private.quarterly_submission_requests enable row level security;
revoke all on private.quarterly_submission_requests from public, anon, authenticated;

-- Classify only rows accepted by v2; legacy/historical rows remain unclassified.
create table public.quarterly_submission_provenance (
  user_id uuid not null,
  request_id uuid not null,
  entity_kind text not null check (entity_kind in ('regular', 'future')),
  entity_id uuid not null,
  submission_id uuid not null,
  record_year integer not null,
  record_quarter integer not null,
  source text not null check (source = 'user_confirmed_submission'),
  submitted_payload jsonb not null,
  submitted_at timestamptz not null,
  primary key (user_id, request_id, entity_kind, entity_id),
  unique (entity_kind, submission_id)
);
alter table public.quarterly_submission_provenance enable row level security;
revoke all on public.quarterly_submission_provenance from public, anon, authenticated;
grant select on public.quarterly_submission_provenance to authenticated;
create policy "owners read quarterly submission provenance"
on public.quarterly_submission_provenance for select to authenticated
using (user_id = (select auth.uid()) and (select private.is_active_quarterly_reader()));

-- Match the client's categoryForGrade, including historical grade spellings.
create function private.quarterly_category_for_grade(p_grade text)
returns text language sql immutable set search_path = '' as $function$
  select case
    when upper(trim(coalesce(p_grade, ''))) like '%BP%'
      or upper(trim(coalesce(p_grade, ''))) = 'BUSINESS PARK' then 'BP'
    when upper(trim(coalesce(p_grade, ''))) like 'B%' then 'GradeB'
    else 'GradeA'
  end;
$function$;
revoke all on function private.quarterly_category_for_grade(text) from public, anon, authenticated;

-- Expansion does not alter any legacy RPC or freeze configuration by itself.
create table private.quarterly_rollout_control (
  singleton boolean primary key default true check (singleton),
  quarter_configuration_frozen boolean not null default false
);
insert into private.quarterly_rollout_control(singleton) values (true);
alter table private.quarterly_rollout_control enable row level security;
revoke all on private.quarterly_rollout_control from public, anon, authenticated;

create function public.get_quarterly_rollout_status()
returns table(quarter_configuration_frozen boolean)
language plpgsql security definer set search_path = '' as $function$
begin
  if auth.uid() is null then
    raise exception using message = 'authentication_required', errcode = '42501';
  end if;
  return query select c.quarter_configuration_frozen from private.quarterly_rollout_control c where c.singleton;
end;
$function$;
revoke all on function public.get_quarterly_rollout_status() from public, anon;
grant execute on function public.get_quarterly_rollout_status() to authenticated, service_role;

create function public.save_quarterly_draft_v2(
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
  if private.can_write_business_data() is not true then
    raise exception using message = 'business_write_forbidden', errcode = '42501';
  end if;
  if p_tab is null or p_tab not in ('GradeA', 'GradeB', 'BP') then
    raise exception using message = 'invalid_draft_tab', errcode = '22023';
  end if;
  perform pg_catalog.pg_advisory_xact_lock_shared(71402, 1);
  if private.is_current_submission_period(p_year, p_quarter) is not true then
    raise exception using message = 'submission_period_changed', errcode = '22023';
  end if;

  if jsonb_typeof(coalesce(p_draft_data, '{}'::jsonb)) <> 'object' then
    raise exception using message = 'invalid_draft_payload', errcode = '22023';
  end if;

  -- A row lock alone cannot serialize creation when no draft exists yet.
  perform pg_catalog.pg_advisory_xact_lock(71403, pg_catalog.hashtext(p_user_id::text || ':' || p_tab));

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
      coalesce(p_draft_data, '{}'::jsonb) || jsonb_build_object('__quarterly_meta__',
        jsonb_build_object('version', 2, 'year', p_year, 'quarter', p_quarter, 'revision', 1)),
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
      draft_data = coalesce(p_draft_data, '{}'::jsonb) || jsonb_build_object('__quarterly_meta__',
        jsonb_build_object('version', 2, 'year', p_year, 'quarter', p_quarter, 'revision', d.revision + 1)),
      revision = d.revision + 1,
      updated_at = v_now
  where d.id = v_existing.id
  returning d.revision, d.updated_at into revision, updated_at;

  return next;
end;
$function$;

revoke all on function public.save_quarterly_draft_v2(uuid, text, integer, integer, text, jsonb, bigint)
  from public, anon;
grant execute on function public.save_quarterly_draft_v2(uuid, text, integer, integer, text, jsonb, bigint)
  to authenticated, service_role;

create function public.set_current_submission_period_v2(
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
  if private.is_admin() is not true then
    raise exception using message = 'admin access required', errcode = '42501';
  end if;
  if p_year is null or p_quarter is null or p_year < 2020 or p_year > 2100 or p_quarter < 1 or p_quarter > 4 then
    raise exception using message = 'invalid_submission_period', errcode = '22023';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(71402, 1);
  if (select c.quarter_configuration_frozen from private.quarterly_rollout_control c where c.singleton) is not false then
    raise exception using message = 'quarter_configuration_frozen', errcode = '55000';
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

  -- Previous-quarter drafts retain their original period and payload.
  -- A later explicit save archives the old row before replacing it.

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

revoke all on function public.set_current_submission_period_v2(integer, integer)
  from public, anon;
grant execute on function public.set_current_submission_period_v2(integer, integer)
  to authenticated, service_role;

-- Existing submit_quarterly_batch stays available for old clients. New clients
-- MUST retain the same UUID and exact payload across ambiguous timeout retries.
create function public.submit_quarterly_batch_v2(
  p_request_id uuid,
  p_user_id uuid,
  p_user_name text,
  p_year integer,
  p_quarter integer,
  p_tab text,
  p_regular_rows jsonb default '[]'::jsonb,
  p_future_rows jsonb default '[]'::jsonb
)
returns table(regular_count integer, future_count integer, submitted_at timestamptz)
language plpgsql security definer set search_path = ''
as $function$
declare
  v_payload jsonb;
  v_request private.quarterly_submission_requests%rowtype;
  v_rows jsonb;
  v_row jsonb;
  v_field text;
  v_value text;
  v_number numeric;
  v_id_key text;
  v_kind integer;
  v_now timestamptz := now();
begin
  if auth.uid() is null or p_user_id is distinct from auth.uid() then
    raise exception using message = 'submission_owner_mismatch', errcode = '42501';
  end if;
  if private.can_write_business_data() is not true then
    raise exception using message = 'business_write_forbidden', errcode = '42501';
  end if;
  if p_request_id is null then
    raise exception using message = 'submission_request_id_required', errcode = '22023';
  end if;
  if p_tab is null or p_tab not in ('GradeA', 'GradeB', 'BP') then
    raise exception using message = 'invalid_submission_tab', errcode = '22023';
  end if;
  perform pg_catalog.pg_advisory_xact_lock_shared(71402, 1);
  v_payload := jsonb_build_object(
    'user_name', p_user_name, 'year', p_year, 'quarter', p_quarter,
    'tab', p_tab, 'regular_rows', coalesce(p_regular_rows, '[]'::jsonb),
    'future_rows', coalesce(p_future_rows, '[]'::jsonb)
  );
  -- Includes the empty-ledger case: concurrent identical requests wait, then
  -- reuse the committed result. Failure rolls back both inserts and ledger.
  perform pg_catalog.pg_advisory_xact_lock(71404, pg_catalog.hashtext(p_user_id::text || ':' || p_request_id::text));
  select * into v_request from private.quarterly_submission_requests r
  where r.user_id = p_user_id and r.request_id = p_request_id;
  if found then
    if v_request.payload is distinct from v_payload then
      raise exception using message = 'submission_request_payload_mismatch', errcode = '22023';
    end if;
    return query select v_request.regular_count, v_request.future_count, v_request.submitted_at;
    return;
  end if;

  -- A committed replay may be acknowledged after rollover without inserting
  -- anything. Only genuinely new requests must target the current period.
  if private.is_current_submission_period(p_year, p_quarter) is not true then
    raise exception using message = 'submission_period_changed', errcode = '22023';
  end if;

  if jsonb_typeof(coalesce(p_regular_rows, '[]'::jsonb)) <> 'array'
    or jsonb_typeof(coalesce(p_future_rows, '[]'::jsonb)) <> 'array' then
    raise exception using message = 'invalid_submission_payload', errcode = '22023';
  end if;
  for v_kind in 0..1 loop
    v_rows := case when v_kind = 0 then coalesce(p_regular_rows, '[]'::jsonb)
      else coalesce(p_future_rows, '[]'::jsonb) end;
    v_id_key := case when v_kind = 0 then 'building_id' else 'future_supply_id' end;
    for v_row in select value from jsonb_array_elements(v_rows) loop
      if jsonb_typeof(v_row) <> 'object' or v_row->>v_id_key is null then
        raise exception using message = 'invalid_submission_row', errcode = '22023';
      end if;
      begin
        perform (v_row->>v_id_key)::uuid;
      exception when invalid_text_representation then
        raise exception using message = 'invalid_submission_row_id', errcode = '22023';
      end;
      foreach v_field in array array['total_area', 'vacant_area', 'vacancy_rate',
        'asking_rent', 'management_fee', 'face_rent', 'rent_free_period', 'net_effective_rent'] loop
        -- Missing/null fields remain valid for explicit incomplete submission.
        if v_row->v_field is null or v_row->v_field = 'null'::jsonb then continue; end if;
        v_value := trim(v_row->>v_field);
        if jsonb_typeof(v_row->v_field) not in ('number', 'string')
          or v_value !~ '^[+-]?([0-9]+(\.[0-9]*)?|\.[0-9]+)([eE][+-]?[0-9]+)?$' then
          raise exception using message = 'invalid_submission_numeric:' || v_field, errcode = '22023';
        end if;
        begin
          v_number := v_value::numeric;
        exception when numeric_value_out_of_range or invalid_text_representation then
          raise exception using message = 'invalid_submission_numeric:' || v_field, errcode = '22023';
        end;
        if v_number < 0
          or (v_field = 'vacancy_rate' and v_number > 100)
          or (v_field = 'rent_free_period' and v_number > 36) then
          raise exception using message = 'invalid_submission_numeric_range:' || v_field, errcode = '22023';
        end if;
      end loop;
      if (v_row->>'vacant_area')::numeric > (v_row->>'total_area')::numeric then
        raise exception using message = 'vacant_area_exceeds_total', errcode = '22023';
      end if;
    end loop;
    if exists(select 1 from jsonb_array_elements(v_rows) r
      group by (r->>v_id_key)::uuid having count(*) > 1) then
      raise exception using message = 'duplicate_submission_row', errcode = '22023';
    end if;
  end loop;

  if exists(
    select 1 from jsonb_array_elements(coalesce(p_regular_rows, '[]'::jsonb)) r
    left join public.buildings b on b.id = (r->>'building_id')::uuid
    where b.id is null or private.quarterly_category_for_grade(b.grade) <> p_tab
      or not exists(select 1 from public.building_assignments a
        where a.building_id = b.id and a.user_id::text = p_user_id::text)
  ) then
    raise exception using message = 'regular_submission_assignment_or_category_mismatch', errcode = '42501';
  end if;
  if exists(
    select 1 from jsonb_array_elements(coalesce(p_future_rows, '[]'::jsonb)) r
    left join public.future_supplies fs on fs.id = (r->>'future_supply_id')::uuid
    where fs.id is null or coalesce(fs.is_entered_market, false)
      or private.quarterly_category_for_grade(fs.grade) <> p_tab
      or not exists(select 1 from public.future_supply_assignments a
        where a.future_supply_id = fs.id and a.user_id = p_user_id
          and a.record_year = p_year and a.record_quarter = p_quarter)
  ) then
    raise exception using message = 'future_submission_assignment_or_category_mismatch', errcode = '42501';
  end if;

  -- Capture exact generated submission IDs, without timestamp inference or
  -- session-context triggers. Submission, provenance and ledger commit together.
  with inserted as (
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
  )
    returning id, building_id
  )
  insert into public.quarterly_submission_provenance(
    user_id, request_id, entity_kind, entity_id, submission_id, record_year, record_quarter,
    source, submitted_payload, submitted_at
  )
  select p_user_id, p_request_id, 'regular', i.building_id, i.id, p_year, p_quarter,
    'user_confirmed_submission', r, v_now
  from inserted i
  join jsonb_array_elements(coalesce(p_regular_rows, '[]'::jsonb)) r
    on (r->>'building_id')::uuid = i.building_id;
  get diagnostics regular_count = row_count;

  with inserted as (
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
  )
    returning id, future_supply_id
  )
  insert into public.quarterly_submission_provenance(
    user_id, request_id, entity_kind, entity_id, submission_id, record_year, record_quarter,
    source, submitted_payload, submitted_at
  )
  select p_user_id, p_request_id, 'future', i.future_supply_id, i.id, p_year, p_quarter,
    'user_confirmed_submission', r, v_now
  from inserted i
  join jsonb_array_elements(coalesce(p_future_rows, '[]'::jsonb)) r
    on (r->>'future_supply_id')::uuid = i.future_supply_id;
  get diagnostics future_count = row_count;

  submitted_at := v_now;
  insert into private.quarterly_submission_requests(
    user_id, request_id, payload, regular_count, future_count, submitted_at
  ) values (p_user_id, p_request_id, v_payload, regular_count, future_count, submitted_at);
  return next;
end;
$function$;
revoke all on function public.submit_quarterly_batch_v2(uuid, uuid, text, integer, integer, text, jsonb, jsonb)
  from public, anon;
grant execute on function public.submit_quarterly_batch_v2(uuid, uuid, text, integer, integer, text, jsonb, jsonb)
  to authenticated, service_role;


-- Final live-table boundary only. Timeout aborts the whole transaction; do not
-- automatically retry. Review contention and obtain a new approved window.
set local lock_timeout = '500ms';
set local statement_timeout = '2s';
-- Lock against concurrent mutations while installing the archive boundary.
lock table public.update_drafts in share row exclusive mode;
insert into public.quarterly_draft_history(draft_id, user_id, event, snapshot)
select d.id, d.user_id, 'baseline', to_jsonb(d) from public.update_drafts d;
create trigger archive_quarterly_draft_before_replace
before update or delete on public.update_drafts
for each row execute function private.archive_quarterly_draft();
-- Observe the final owner/period after existing BEFORE identity-fill triggers.
create trigger archive_quarterly_draft_after_insert
  after insert on public.update_drafts
  for each row execute function private.archive_quarterly_draft();

commit;
