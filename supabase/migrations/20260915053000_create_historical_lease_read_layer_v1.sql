begin;

create table if not exists public.lease_building_name_map (
  market_code text not null default 'BJ',
  alias_name text not null,
  building_id uuid not null references public.buildings(id) on delete restrict,
  match_method text not null check (match_method in ('canonical_name', 'former_name', 'manual')),
  verification_status text not null default 'AUTO_VERIFIED' check (verification_status in ('AUTO_VERIFIED', 'MANUAL_VERIFIED')),
  created_at timestamptz not null default now(),
  primary key (market_code, alias_name)
);

create index if not exists lease_building_name_map_building_idx on public.lease_building_name_map (building_id);
alter table public.lease_building_name_map enable row level security;
revoke all on public.lease_building_name_map from public, anon, authenticated, service_role;
grant select on public.lease_building_name_map to service_role;

with candidate_aliases as (
  select b.id as building_id, trim(b.name) as alias_name, 'canonical_name'::text as match_method
  from public.buildings b
  where nullif(trim(b.name), '') is not null
  union all
  select b.id, trim(alias.value), 'former_name'::text
  from public.buildings b
  cross join lateral jsonb_array_elements_text(case when jsonb_typeof(b.former_names) = 'array' then b.former_names else '[]'::jsonb end) alias(value)
  where nullif(trim(alias.value), '') is not null
), safe_aliases as (
  select alias_name,
         (array_agg(distinct building_id))[1] as building_id,
         case when bool_or(match_method = 'canonical_name') then 'canonical_name' else 'former_name' end as match_method
  from candidate_aliases
  group by alias_name
  having count(distinct building_id) = 1
)
insert into public.lease_building_name_map (market_code, alias_name, building_id, match_method, verification_status)
select 'BJ', alias_name, building_id, match_method, 'AUTO_VERIFIED'
from safe_aliases
on conflict (market_code, alias_name) do nothing;

create or replace view public.lease_transactions_read_v1
with (security_invoker = true)
as
select
  'live:' || l.id::text as read_id,
  'live'::text as record_source,
  l.id as source_record_id,
  null::text as source_uid,
  'BJ'::text as market_code,
  m.building_id,
  l.company, l.suspected_company_fullname, l.enterprise_type, l.industry, l.sub_industry, l.demand_type,
  l.new_building, l.sub_market, l.district, l.building_grade, l.floor, l.floor_info,
  l.old_address, l.old_sub_market, l.old_district, l.old_building_grade,
  l.area_sqm, l.face_rent, l.lease_term_months, l.fit_out_months, l.rent_free_months, l.effective_rent,
  null::numeric as management_fee,
  l.transaction_date, l.transaction_year, l.transaction_quarter::text,
  concat(l.transaction_year::text, l.transaction_quarter::text) as transaction_period,
  case when l.transaction_date is not null then 'date'
       when l.transaction_year is not null and l.transaction_quarter is not null then 'quarter'
       when l.transaction_year is not null then 'year' else 'unknown' end::text as transaction_time_precision,
  case when l.transaction_date is not null then l.transaction_date
       when l.transaction_year is not null and l.transaction_quarter = 'Q1' then make_date(l.transaction_year,1,1)
       when l.transaction_year is not null and l.transaction_quarter = 'Q2' then make_date(l.transaction_year,4,1)
       when l.transaction_year is not null and l.transaction_quarter = 'Q3' then make_date(l.transaction_year,7,1)
       when l.transaction_year is not null and l.transaction_quarter = 'Q4' then make_date(l.transaction_year,10,1)
       when l.transaction_year is not null then make_date(l.transaction_year,1,1) else null end::date as transaction_period_start,
  case when l.transaction_date is not null then l.transaction_date
       when l.transaction_year is not null and l.transaction_quarter = 'Q1' then make_date(l.transaction_year,3,31)
       when l.transaction_year is not null and l.transaction_quarter = 'Q2' then make_date(l.transaction_year,6,30)
       when l.transaction_year is not null and l.transaction_quarter = 'Q3' then make_date(l.transaction_year,9,30)
       when l.transaction_year is not null and l.transaction_quarter = 'Q4' then make_date(l.transaction_year,12,31)
       when l.transaction_year is not null then make_date(l.transaction_year,12,31) else null end::date as transaction_period_end,
  l.remarks,
  null::text as agency_company, null::text as agency_person,
  l.submitter_id, l.submitter_name, l.data_source::text,
  'OPERATIONAL'::text as quality_status,
  'broker_submitted_period'::text as period_source,
  l.created_at, l.updated_at, null::timestamptz as imported_at
from public.lease_transactions l
left join public.lease_building_name_map m on m.market_code='BJ' and m.alias_name=trim(l.new_building)
union all
select
  'history:' || h.source_uid,
  'history'::text,
  h.id,
  h.source_uid,
  'BJ'::text,
  m.building_id,
  h.company, h.suspected_company_fullname, h.enterprise_type, h.industry, h.sub_industry, h.demand_type,
  h.new_building, h.sub_market, h.district, h.building_grade, h.floor, h.floor_info,
  h.old_address, h.old_sub_market, h.old_district, h.old_building_grade,
  h.area_sqm, h.face_rent, h.lease_term_months, h.fit_out_months, h.rent_free_months, h.effective_rent,
  h.management_fee,
  h.transaction_date, h.transaction_year, h.transaction_quarter::text,
  concat(h.transaction_year::text, h.transaction_quarter::text),
  case when h.transaction_date is not null then 'date'
       when h.transaction_year is not null and h.transaction_quarter is not null then 'quarter'
       when h.transaction_year is not null then 'year' else 'unknown' end::text,
  case when h.transaction_date is not null then h.transaction_date
       when h.transaction_year is not null and h.transaction_quarter = 'Q1' then make_date(h.transaction_year,1,1)
       when h.transaction_year is not null and h.transaction_quarter = 'Q2' then make_date(h.transaction_year,4,1)
       when h.transaction_year is not null and h.transaction_quarter = 'Q3' then make_date(h.transaction_year,7,1)
       when h.transaction_year is not null and h.transaction_quarter = 'Q4' then make_date(h.transaction_year,10,1)
       when h.transaction_year is not null then make_date(h.transaction_year,1,1) else null end::date,
  case when h.transaction_date is not null then h.transaction_date
       when h.transaction_year is not null and h.transaction_quarter = 'Q1' then make_date(h.transaction_year,3,31)
       when h.transaction_year is not null and h.transaction_quarter = 'Q2' then make_date(h.transaction_year,6,30)
       when h.transaction_year is not null and h.transaction_quarter = 'Q3' then make_date(h.transaction_year,9,30)
       when h.transaction_year is not null and h.transaction_quarter = 'Q4' then make_date(h.transaction_year,12,31)
       when h.transaction_year is not null then make_date(h.transaction_year,12,31) else null end::date,
  h.remarks, h.agency_company, h.agency_person,
  h.submitter_id, h.submitter_name, h.data_source::text,
  h.quality_status, h.period_source,
  h.created_at, h.updated_at, h.imported_at
from public.lease_transactions_history h
left join public.lease_building_name_map m on m.market_code='BJ' and m.alias_name=trim(h.new_building);

revoke all on public.lease_transactions_read_v1 from public, anon, authenticated, service_role;
grant select on public.lease_transactions_read_v1 to service_role;

commit;
