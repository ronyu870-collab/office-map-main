begin;

-- Map authorization must be enforced below the browser. These helpers deliberately
-- resolve the real authenticated database role; application impersonation is
-- additionally enforced by /api/map/data using the effective simulated role.

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
      and r.role in ('editor', 'admin')
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
      and (
        upper(trim(coalesce(b.grade, ''))) in ('A', 'P')
        or private.map_can_view_extended_inventory()
      )
  );
$$;

revoke all on function private.map_building_visible(uuid) from public, anon;
grant execute on function private.map_building_visible(uuid) to authenticated;

drop policy if exists "authenticated users read buildings" on public.buildings;
drop policy if exists "role scoped read buildings" on public.buildings;
create policy "role scoped read buildings"
on public.buildings
for select
to authenticated
using (
  upper(trim(coalesce(grade, ''))) in ('A', 'P')
  or (select private.map_can_view_extended_inventory())
);

drop policy if exists "authenticated users read building metrics" on public.building_metrics;
drop policy if exists "role scoped read building metrics" on public.building_metrics;
create policy "role scoped read building metrics"
on public.building_metrics
for select
to authenticated
using ((select private.map_building_visible(building_id)));

drop policy if exists "authenticated read building current data" on public.building_current_data;
drop policy if exists "role scoped read building current data" on public.building_current_data;
create policy "role scoped read building current data"
on public.building_current_data
for select
to authenticated
using ((select private.map_building_visible(building_id)));

drop policy if exists "authenticated read display overrides" on public.building_display_overrides;
drop policy if exists "role scoped read display overrides" on public.building_display_overrides;
create policy "role scoped read display overrides"
on public.building_display_overrides
for select
to authenticated
using ((select private.map_building_visible(building_id)));

drop policy if exists "authenticated users read building brochure data" on public.building_brochure_data;
drop policy if exists "role scoped read building brochure data" on public.building_brochure_data;
create policy "role scoped read building brochure data"
on public.building_brochure_data
for select
to authenticated
using ((select private.map_building_visible(building_id)));

drop policy if exists "authenticated read future supplies" on public.future_supplies;
drop policy if exists "role scoped read future supplies" on public.future_supplies;
create policy "role scoped read future supplies"
on public.future_supplies
for select
to authenticated
using (
  upper(trim(coalesce(grade, ''))) in ('A', 'P')
  or (select private.map_can_view_extended_inventory())
);

commit;
