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

commit;
