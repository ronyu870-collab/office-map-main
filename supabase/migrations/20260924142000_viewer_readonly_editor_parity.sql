begin;

-- Viewer is the read-only twin of Editor:
-- - same business read scope as editor
-- - no INSERT / UPDATE / DELETE on business data
-- Admin retains its existing elevated management paths.

create or replace function private.can_write_business_data()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.user_roles r
    where r.user_id = (select auth.uid())
      and r.role in ('editor', 'admin')
  );
$$;

revoke all on function private.can_write_business_data() from public, anon;
grant execute on function private.can_write_business_data() to authenticated;

-- Map / building reads: viewer and editor now have identical inventory visibility.
create or replace function private.map_can_view_extended_inventory()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.user_roles r
    where r.user_id = (select auth.uid())
      and r.role in ('viewer', 'editor', 'admin')
  );
$$;

revoke all on function private.map_can_view_extended_inventory() from public, anon;
grant execute on function private.map_can_view_extended_inventory() to authenticated;

create or replace function private.map_building_visible(p_building_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.buildings b
    where b.id = p_building_id
      and private.map_can_view_extended_inventory()
  );
$$;

revoke all on function private.map_building_visible(uuid) from public, anon;
grant execute on function private.map_building_visible(uuid) to authenticated;

drop policy if exists "role scoped read buildings" on public.buildings;
create policy "role scoped read buildings"
on public.buildings
for select
to authenticated
using ((select private.map_can_view_extended_inventory()));

drop policy if exists "role scoped read building metrics" on public.building_metrics;
create policy "role scoped read building metrics"
on public.building_metrics
for select
to authenticated
using ((select private.map_building_visible(building_id)));

drop policy if exists "role scoped read building current data" on public.building_current_data;
create policy "role scoped read building current data"
on public.building_current_data
for select
to authenticated
using ((select private.map_building_visible(building_id)));

drop policy if exists "role scoped read display overrides" on public.building_display_overrides;
create policy "role scoped read display overrides"
on public.building_display_overrides
for select
to authenticated
using ((select private.map_building_visible(building_id)));

drop policy if exists "role scoped read building brochure data" on public.building_brochure_data;
create policy "role scoped read building brochure data"
on public.building_brochure_data
for select
to authenticated
using ((select private.map_building_visible(building_id)));

drop policy if exists "role scoped read future supplies" on public.future_supplies;
create policy "role scoped read future supplies"
on public.future_supplies
for select
to authenticated
using ((select private.map_can_view_extended_inventory()));

-- Live lease reads: viewer follows the same team-read switch as editor.
drop policy if exists "role scoped read lease transactions" on public.lease_transactions;
create policy "role scoped read lease transactions"
on public.lease_transactions
for select
to authenticated
using (
  (submitter_id)::text = ((select auth.uid()))::text
  or (select private.is_admin())
  or (
    exists (
      select 1
      from public.user_roles r
      where r.user_id = (select auth.uid())
        and r.role in ('viewer', 'editor')
    )
    and exists (
      select 1
      from public.system_settings s
      where s.key = 'editor_can_view_lease_team_submissions'
        and s.boolean_value = true
    )
  )
);

-- Lease business writes: editor/admin only.
drop policy if exists "authenticated users insert own lease transactions" on public.lease_transactions;
create policy "business writers insert own lease transactions"
on public.lease_transactions
for insert
to authenticated
with check (
  (select private.can_write_business_data())
  and (select auth.uid()) is not null
  and (submitter_id)::text = ((select auth.uid()))::text
  and (data_source)::text = 'broker_submission'::text
);

drop policy if exists "owners and admins update lease transactions" on public.lease_transactions;
create policy "business writers and admins update lease transactions"
on public.lease_transactions
for update
to authenticated
using (
  (select private.is_admin())
  or (
    (select private.can_write_business_data())
    and (submitter_id)::text = ((select auth.uid()))::text
  )
)
with check (
  (data_source)::text = 'broker_submission'::text
  and (
    (select private.is_admin())
    or (
      (select private.can_write_business_data())
      and (submitter_id)::text = ((select auth.uid()))::text
    )
  )
);

drop policy if exists "authenticated users delete own lease transactions" on public.lease_transactions;
create policy "business writers delete own lease transactions"
on public.lease_transactions
for delete
to authenticated
using (
  (select private.can_write_business_data())
  and (submitter_id)::text = ((select auth.uid()))::text
);

-- Lease cloud drafts are business data as well.
drop policy if exists "users create own lease drafts" on public.lease_transaction_drafts;
create policy "business writers create own lease drafts"
on public.lease_transaction_drafts
for insert
to authenticated
with check (
  (select private.can_write_business_data())
  and (select auth.uid()) = user_id
);

drop policy if exists "users update own lease drafts" on public.lease_transaction_drafts;
create policy "business writers update own lease drafts"
on public.lease_transaction_drafts
for update
to authenticated
using (
  (select private.can_write_business_data())
  and (select auth.uid()) = user_id
)
with check (
  (select private.can_write_business_data())
  and (select auth.uid()) = user_id
);

drop policy if exists "users delete own lease drafts" on public.lease_transaction_drafts;
create policy "business writers delete own lease drafts"
on public.lease_transaction_drafts
for delete
to authenticated
using (
  (select private.can_write_business_data())
  and (select auth.uid()) = user_id
);

-- Quarterly submissions/drafts: viewer may read under the same row scope, never write.
drop policy if exists "users insert own quarterly submissions" on public.quarterly_submissions;
create policy "business writers insert own quarterly submissions"
on public.quarterly_submissions
for insert
to authenticated
with check (
  (select private.can_write_business_data())
  and user_id = (select auth.uid())
  and private.is_current_submission_period(record_year, record_quarter)
);

drop policy if exists "users create own update drafts" on public.update_drafts;
create policy "business writers create own update drafts"
on public.update_drafts
for insert
to authenticated
with check (
  (select private.can_write_business_data())
  and user_id = (select auth.uid())
  and private.is_current_submission_period(record_year, record_quarter)
);

drop policy if exists "users update own update drafts" on public.update_drafts;
create policy "business writers update own update drafts"
on public.update_drafts
for update
to authenticated
using (
  (select private.can_write_business_data())
  and user_id = (select auth.uid())
)
with check (
  (select private.can_write_business_data())
  and user_id = (select auth.uid())
  and private.is_current_submission_period(record_year, record_quarter)
);

drop policy if exists "users delete own update drafts" on public.update_drafts;
create policy "business writers delete own update drafts"
on public.update_drafts
for delete
to authenticated
using (
  (select private.is_admin())
  or (
    (select private.can_write_business_data())
    and user_id = (select auth.uid())
  )
);

drop policy if exists "users insert own future submissions" on public.future_supply_submissions;
create policy "business writers insert own future submissions"
on public.future_supply_submissions
for insert
to authenticated
with check (
  (select private.can_write_business_data())
  and user_id = (select auth.uid())
  and private.is_current_submission_period(record_year, record_quarter)
);

-- This RPC is SECURITY DEFINER and therefore bypasses update_drafts RLS.
-- Keep it callable for Editor/Admin clients, but enforce the application role
-- inside the function before any INSERT/UPDATE occurs.
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
      draft_data = coalesce(p_draft_data, '{}'::jsonb),
      revision = d.revision + 1,
      updated_at = v_now
  where d.id = v_existing.id
  returning d.revision, d.updated_at into revision, updated_at;

  return next;
end;
$function$;

revoke all on function public.save_quarterly_draft(uuid, text, integer, integer, text, jsonb, bigint) from public, anon;
grant execute on function public.save_quarterly_draft(uuid, text, integer, integer, text, jsonb, bigint) to authenticated, service_role;

commit;
