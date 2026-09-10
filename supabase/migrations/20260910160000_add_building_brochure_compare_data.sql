-- Building comparison parameter store.
-- This intentionally contains only the structured parameters consumed by the
-- comparison workspace. Brochure upload/extraction tables are out of scope.

create table if not exists public.building_brochure_data (
  id uuid primary key default gen_random_uuid(),
  building_id uuid not null references public.buildings(id) on delete cascade,

  -- Basic positioning
  name_cn text,
  name_en text,
  developer text,
  district text,
  submarket text,
  address text,
  grade text,
  completion_date date,

  -- Area and building scale
  gfa_total numeric,
  gfa_office numeric,
  gfa_retail numeric,
  building_height numeric,
  building_floors integer,
  floors_above integer,
  floors_below integer,
  standard_floor_area numeric,
  column_free boolean,
  depth numeric,
  column_spacing numeric,
  floor_height numeric,
  clear_height numeric,
  raised_floor_cm integer,
  efficiency_rate numeric,
  floor_load_office integer,
  floor_load_equipment integer,
  facade_type text,
  metro_access text,

  -- Sustainability and delivery
  leed_certification text,
  well_certification text,
  green_building_standard text,
  green_power boolean,
  restrooms_per_floor integer,
  delivery_standard text,
  removable_floor boolean,
  property_management text,

  -- Elevator and parking
  elevator_passenger integer,
  elevator_zones text,
  elevator_vip integer,
  elevator_freight integer,
  parking_total integer,
  parking_above integer,
  parking_underground_floor integer,
  parking_underground integer,
  parking_charging integer,

  -- Power, telecom and HVAC
  power_system text,
  power_source text,
  power_backup_generator text,
  telecom_provider text,
  hvac_system text,
  hvac_fresh_air_capacity numeric,
  hvac_pm25_purification boolean,
  hvac_hours text,
  hvac_cooling_water_24h boolean,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists building_brochure_data_building_created_idx
  on public.building_brochure_data (building_id, created_at desc);

create or replace function public.set_building_brochure_data_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists set_building_brochure_data_updated_at
  on public.building_brochure_data;
create trigger set_building_brochure_data_updated_at
before update on public.building_brochure_data
for each row
execute function public.set_building_brochure_data_updated_at();

alter table public.building_brochure_data enable row level security;

-- The comparison workspace is read-only for normal users.
drop policy if exists "authenticated users read building brochure data"
  on public.building_brochure_data;
create policy "authenticated users read building brochure data"
on public.building_brochure_data
for select
to authenticated
using (true);

-- Preserve the application's existing admin authorization boundary for writes.
drop policy if exists "admin manage building brochure data"
  on public.building_brochure_data;
create policy "admin manage building brochure data"
on public.building_brochure_data
for all
to authenticated
using (private.is_admin())
with check (private.is_admin());
