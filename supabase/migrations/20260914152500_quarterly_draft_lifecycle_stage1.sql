begin;

-- Stage 1 is deliberately backward compatible with the currently deployed client.
-- It introduces stable ownership/period columns and the optimistic-save RPC while
-- retaining the legacy (user_name, tab) unique constraint until the new client is live.

alter table public.update_drafts
  add column if not exists user_id uuid references auth.users(id) on delete cascade,
  add column if not exists record_year integer,
  add column if not exists record_quarter integer,
  add column if not exists revision bigint not null default 0;

-- Historical draft rows in this project use the email prefix as user_name. Also
-- accept the older display-name forms so the migration remains safe if legacy rows
-- are restored later.
update public.update_drafts d
set user_id = r.user_id
from public.user_roles r
where d.user_id is null
  and (
    d.user_name = r.full_name
    or d.user_name = r.chinese_name
    or d.user_name = r.email
    or d.user_name = split_part(r.email, '@', 1)
  );

update public.update_drafts
set record_year = coalesce(
      record_year,
      (select value::integer from public.app_settings where key = 'current_submission_year')
    ),
    record_quarter = coalesce(
      record_quarter,
      (select value::integer from public.app_settings where key = 'current_submission_quarter')
    );

do $$
begin
  if exists (select 1 from public.update_drafts where user_id is null) then
    raise exception 'Cannot migrate update_drafts: one or more legacy rows have no unambiguous user owner';
  end if;
  if exists (select 1 from public.update_drafts where record_year is null or record_quarter is null) then
    raise exception 'Cannot migrate update_drafts: current submission period is not configured';
  end if;
end
$$;

alter table public.update_drafts
  alter column user_id set not null,
  alter column record_year set not null,
  alter column record_quarter set not null;

alter table public.update_drafts
  drop constraint if exists update_drafts_record_quarter_check;
alter table public.update_drafts
  add constraint update_drafts_record_quarter_check check (record_quarter between 1 and 4);

create unique index if not exists update_drafts_owner_period_tab_uidx
  on public.update_drafts (user_id, record_year, record_quarter, tab);
create index if not exists update_drafts_owner_period_idx
  on public.update_drafts (user_id, record_year desc, record_quarter desc);

create or replace function private.current_submission_year()
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select value::integer
  from public.app_settings
  where key = 'current_submission_year';
$$;

create or replace function private.current_submission_quarter()
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select value::integer
  from public.app_settings
  where key = 'current_submission_quarter';
$$;

create or replace function private.is_current_submission_period(p_year integer, p_quarter integer)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_year = private.current_submission_year()
     and p_quarter = private.current_submission_quarter();
$$;

create or replace function private.fill_update_draft_identity_period()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.user_id is null then
    new.user_id := auth.uid();
  end if;
  if new.record_year is null then
    new.record_year := private.current_submission_year();
  end if;
  if new.record_quarter is null then
    new.record_quarter := private.current_submission_quarter();
  end if;
  return new;
end;
$$;

drop trigger if exists update_drafts_fill_identity_period on public.update_drafts;
create trigger update_drafts_fill_identity_period
before insert or update on public.update_drafts
for each row execute function private.fill_update_draft_identity_period();

-- Stable ownership: authorization is based only on auth.uid(), never on mutable
-- names, Chinese names, email addresses, or email prefixes.
drop policy if exists "users read own update drafts" on public.update_drafts;
drop policy if exists "users create own update drafts" on public.update_drafts;
drop policy if exists "users update own update drafts" on public.update_drafts;
drop policy if exists "users delete own update drafts" on public.update_drafts;

create policy "users read own update drafts" on public.update_drafts
for select to authenticated
using (private.is_admin() or user_id = auth.uid());

create policy "users create own update drafts" on public.update_drafts
for insert to authenticated
with check (user_id = auth.uid() and private.is_current_submission_period(record_year, record_quarter));

create policy "users update own update drafts" on public.update_drafts
for update to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid() and private.is_current_submission_period(record_year, record_quarter));

create policy "users delete own update drafts" on public.update_drafts
for delete to authenticated
using (private.is_admin() or user_id = auth.uid());

-- Editors may only submit into the configured open period. Admin policies continue
-- to permit administrative repair/management operations.
drop policy if exists "users insert own quarterly submissions" on public.quarterly_submissions;
create policy "users insert own quarterly submissions" on public.quarterly_submissions
for insert to authenticated
with check (
  user_id = auth.uid()
  and private.is_current_submission_period(record_year, record_quarter)
);

drop policy if exists "users insert own future submissions" on public.future_supply_submissions;
create policy "users insert own future submissions" on public.future_supply_submissions
for insert to authenticated
with check (
  user_id = auth.uid()
  and private.is_current_submission_period(record_year, record_quarter)
);

-- New client save path. A server revision prevents an older browser snapshot from
-- overwriting a newer one. The function also re-checks the open period at write time.
create or replace function public.save_quarterly_draft(
  p_user_id uuid,
  p_user_name text,
  p_year integer,
  p_quarter integer,
  p_tab text,
  p_draft_data jsonb,
  p_expected_revision bigint default 0
)
returns table (revision bigint, updated_at timestamptz)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_existing public.update_drafts%rowtype;
  v_now timestamptz := now();
begin
  if auth.uid() is null or p_user_id is distinct from auth.uid() then
    raise exception using message = 'draft_owner_mismatch', errcode = '42501';
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
    and d.record_year = p_year
    and d.record_quarter = p_quarter
    and d.tab = p_tab
  for update;

  if not found then
    if coalesce(p_expected_revision, 0) <> 0 then
      raise exception using message = 'draft_revision_conflict', errcode = '40001';
    end if;

    insert into public.update_drafts (
      user_id, user_name, record_year, record_quarter, tab, draft_data, revision, updated_at
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
    returning update_drafts.revision, update_drafts.updated_at
      into revision, updated_at;
    return next;
    return;
  end if;

  if coalesce(p_expected_revision, 0) <> v_existing.revision then
    raise exception using message = 'draft_revision_conflict', errcode = '40001';
  end if;

  update public.update_drafts d
  set user_name = coalesce(nullif(trim(p_user_name), ''), d.user_name),
      draft_data = coalesce(p_draft_data, '{}'::jsonb),
      revision = d.revision + 1,
      updated_at = v_now
  where d.id = v_existing.id
  returning d.revision, d.updated_at into revision, updated_at;

  return next;
end;
$$;

revoke all on function public.save_quarterly_draft(uuid, text, integer, integer, text, jsonb, bigint) from public, anon;
grant execute on function public.save_quarterly_draft(uuid, text, integer, integer, text, jsonb, bigint) to authenticated;

commit;
