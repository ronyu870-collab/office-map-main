begin;

-- P0 authorization boundary tightening.
-- The browser is not an authorization boundary: map and deal visibility must be
-- enforced by Postgres RLS so direct Data API calls receive the same scope.

-- Stock building visibility:
-- viewer -> A/P only
-- editor/admin -> all grades
-- Unknown/missing roles do not gain the editor/admin branch.
drop policy if exists "authenticated users read buildings" on public.buildings;
create policy "role scoped read buildings"
on public.buildings for select
to authenticated
using (
  upper(trim(coalesce(grade, ''))) in ('A', 'P')
  or exists (
    select 1
    from public.user_roles r
    where r.user_id = (select auth.uid())
      and r.role in ('editor', 'admin')
  )
);

-- Historical metrics inherit the visibility of their parent building.
drop policy if exists "authenticated users read building metrics" on public.building_metrics;
create policy "role scoped read building metrics"
on public.building_metrics for select
to authenticated
using (
  exists (
    select 1
    from public.buildings b
    where b.id = building_metrics.building_id
  )
);

-- Current read-model rows must not reveal a building hidden by the buildings policy.
drop policy if exists "authenticated read building current data" on public.building_current_data;
create policy "role scoped read building current data"
on public.building_current_data for select
to authenticated
using (
  exists (
    select 1
    from public.buildings b
    where b.id = building_current_data.building_id
  )
);

-- Display overrides can carry building classification information, so inherit the
-- same parent-building visibility boundary.
drop policy if exists "authenticated read display overrides" on public.building_display_overrides;
create policy "role scoped read display overrides"
on public.building_display_overrides for select
to authenticated
using (
  exists (
    select 1
    from public.buildings b
    where b.id = building_display_overrides.building_id
  )
);

-- Lease transactions remain readable across brokers for the existing duplicate-
-- detection workflow, but viewer accounts no longer receive the transaction table.
drop policy if exists "authenticated users read lease transactions" on public.lease_transactions;
create policy "editors and admins read lease transactions"
on public.lease_transactions for select
to authenticated
using (
  exists (
    select 1
    from public.user_roles r
    where r.user_id = (select auth.uid())
      and r.role in ('editor', 'admin')
  )
);

commit;
