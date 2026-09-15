begin;

create table if not exists public.lease_building_record_map (
  source_uid text primary key references public.lease_transactions_history(source_uid),
  building_id uuid not null references public.buildings(id),
  market_code text not null default 'BJ',
  match_method text not null,
  verification_status text not null,
  evidence_snapshot jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint lease_building_record_map_market_check check (market_code='BJ')
);

alter table public.lease_building_record_map enable row level security;
revoke all on public.lease_building_record_map from anon, authenticated;
grant select,insert,update on public.lease_building_record_map to service_role;

insert into public.lease_building_record_map(source_uid,building_id,market_code,match_method,verification_status,evidence_snapshot)
select h.source_uid,b.id,'BJ','historical_name_plus_submarket_context','AUTO_VERIFIED_RECORD',
       jsonb_build_array(
         jsonb_build_object('type','historical_name','detail','历史名称为平安金融中心'),
         jsonb_build_object('type','submarket_context','detail','历史商圈为丽泽/丽泽商务区；当前库存存在丽泽平安金融中心'),
         jsonb_build_object('type','granularity','detail','source_uid级映射，避免将同名燕莎/CBD/未知商圈记录错误归入丽泽')
       )
from public.lease_transactions_history h
join public.buildings b on b.name='丽泽平安金融中心'
where h.new_building='平安金融中心' and h.sub_market in ('丽泽','丽泽商务区')
on conflict (source_uid) do update set building_id=excluded.building_id,match_method=excluded.match_method,verification_status=excluded.verification_status,evidence_snapshot=excluded.evidence_snapshot,updated_at=now();

insert into public.lease_building_record_map(source_uid,building_id,market_code,match_method,verification_status,evidence_snapshot)
select h.source_uid,b.id,'BJ','historical_name_plus_submarket_context','AUTO_VERIFIED_RECORD',
       jsonb_build_array(
         jsonb_build_object('type','historical_name','detail','历史名称为平安金融中心'),
         jsonb_build_object('type','submarket_context','detail','历史商圈为燕莎；当前库存存在平安国际金融中心'),
         jsonb_build_object('type','granularity','detail','source_uid级映射，避免将同名丽泽/CBD/未知商圈记录错误归入燕莎')
       )
from public.lease_transactions_history h
join public.buildings b on b.name='平安国际金融中心'
where h.new_building='平安金融中心' and h.sub_market='燕莎'
on conflict (source_uid) do update set building_id=excluded.building_id,match_method=excluded.match_method,verification_status=excluded.verification_status,evidence_snapshot=excluded.evidence_snapshot,updated_at=now();

update public.lease_building_alias_review
set review_notes=coalesce(review_notes||' | ','')||'v13 partial source_uid resolution: 丽泽/丽泽商务区→丽泽平安金融中心，燕莎→平安国际金融中心；CBD/NULL仍待审',updated_at=now()
where historical_name='平安金融中心' and resolution_status='NEEDS_REVIEW';

create or replace view public.lease_transactions_read_v1
with (security_invoker=true)
as
select
  'live:'::text || l.id::text as read_id,
  'live'::text as record_source,
  l.id as source_record_id,
  null::text as source_uid,
  'BJ'::text as market_code,
  m.building_id,
  l.company,l.suspected_company_fullname,l.enterprise_type,l.industry,l.sub_industry,l.demand_type,
  l.new_building,l.sub_market,l.district,l.building_grade,l.floor,l.floor_info,l.old_address,l.old_sub_market,l.old_district,l.old_building_grade,
  l.area_sqm,l.face_rent,l.lease_term_months,l.fit_out_months,l.rent_free_months,l.effective_rent,
  null::numeric as management_fee,
  l.transaction_date,l.transaction_year,l.transaction_quarter::text as transaction_quarter,
  concat(l.transaction_year::text,l.transaction_quarter::text) as transaction_period,
  case when l.transaction_date is not null then 'date' when l.transaction_year is not null and l.transaction_quarter is not null then 'quarter' when l.transaction_year is not null then 'year' else 'unknown' end as transaction_time_precision,
  case when l.transaction_date is not null then l.transaction_date when l.transaction_year is not null and l.transaction_quarter::text='Q1' then make_date(l.transaction_year,1,1) when l.transaction_year is not null and l.transaction_quarter::text='Q2' then make_date(l.transaction_year,4,1) when l.transaction_year is not null and l.transaction_quarter::text='Q3' then make_date(l.transaction_year,7,1) when l.transaction_year is not null and l.transaction_quarter::text='Q4' then make_date(l.transaction_year,10,1) when l.transaction_year is not null then make_date(l.transaction_year,1,1) else null::date end as transaction_period_start,
  case when l.transaction_date is not null then l.transaction_date when l.transaction_year is not null and l.transaction_quarter::text='Q1' then make_date(l.transaction_year,3,31) when l.transaction_year is not null and l.transaction_quarter::text='Q2' then make_date(l.transaction_year,6,30) when l.transaction_year is not null and l.transaction_quarter::text='Q3' then make_date(l.transaction_year,9,30) when l.transaction_year is not null and l.transaction_quarter::text='Q4' then make_date(l.transaction_year,12,31) when l.transaction_year is not null then make_date(l.transaction_year,12,31) else null::date end as transaction_period_end,
  l.remarks,null::text as agency_company,null::text as agency_person,l.submitter_id,l.submitter_name,l.data_source::text as data_source,
  'OPERATIONAL'::text as quality_status,'broker_submitted_period'::text as period_source,l.created_at,l.updated_at,null::timestamptz as imported_at,
  case when m.building_id is not null then 'exact' when coalesce(cardinality(pm.related_building_ids),0)>0 then 'project' else 'unmapped' end as building_match_scope,
  case when m.building_id is not null then array[m.building_id] else coalesce(pm.related_building_ids,'{}'::uuid[]) end as related_building_ids
from public.lease_transactions l
left join public.lease_building_name_map m on m.market_code='BJ' and m.alias_name=trim(l.new_building)
left join lateral (select array_agg(distinct p.building_id order by p.building_id) related_building_ids from public.lease_building_project_map p where p.market_code='BJ' and p.alias_name=trim(l.new_building)) pm on true
union all
select
  'history:'::text || h.source_uid as read_id,
  'history'::text as record_source,
  h.id as source_record_id,
  h.source_uid,
  'BJ'::text as market_code,
  coalesce(rm.building_id,m.building_id) as building_id,
  h.company,h.suspected_company_fullname,h.enterprise_type,h.industry,h.sub_industry,h.demand_type,
  h.new_building,h.sub_market,h.district,h.building_grade,h.floor,h.floor_info,h.old_address,h.old_sub_market,h.old_district,h.old_building_grade,
  h.area_sqm,h.face_rent,h.lease_term_months,h.fit_out_months,h.rent_free_months,h.effective_rent,h.management_fee,
  h.transaction_date,h.transaction_year,h.transaction_quarter::text as transaction_quarter,
  concat(h.transaction_year::text,h.transaction_quarter::text) as transaction_period,
  case when h.transaction_date is not null then 'date' when h.transaction_year is not null and h.transaction_quarter is not null then 'quarter' when h.transaction_year is not null then 'year' else 'unknown' end as transaction_time_precision,
  case when h.transaction_date is not null then h.transaction_date when h.transaction_year is not null and h.transaction_quarter::text='Q1' then make_date(h.transaction_year,1,1) when h.transaction_year is not null and h.transaction_quarter::text='Q2' then make_date(h.transaction_year,4,1) when h.transaction_year is not null and h.transaction_quarter::text='Q3' then make_date(h.transaction_year,7,1) when h.transaction_year is not null and h.transaction_quarter::text='Q4' then make_date(h.transaction_year,10,1) when h.transaction_year is not null then make_date(h.transaction_year,1,1) else null::date end as transaction_period_start,
  case when h.transaction_date is not null then h.transaction_date when h.transaction_year is not null and h.transaction_quarter::text='Q1' then make_date(h.transaction_year,3,31) when h.transaction_year is not null and h.transaction_quarter::text='Q2' then make_date(h.transaction_year,6,30) when h.transaction_year is not null and h.transaction_quarter::text='Q3' then make_date(h.transaction_year,9,30) when h.transaction_year is not null and h.transaction_quarter::text='Q4' then make_date(h.transaction_year,12,31) when h.transaction_year is not null then make_date(h.transaction_year,12,31) else null::date end as transaction_period_end,
  h.remarks,h.agency_company,h.agency_person,h.submitter_id,h.submitter_name,h.data_source::text as data_source,h.quality_status,h.period_source,h.created_at,h.updated_at,h.imported_at,
  case when rm.building_id is not null or m.building_id is not null then 'exact' when coalesce(cardinality(pm.related_building_ids),0)>0 then 'project' else 'unmapped' end as building_match_scope,
  case when rm.building_id is not null then array[rm.building_id] when m.building_id is not null then array[m.building_id] else coalesce(pm.related_building_ids,'{}'::uuid[]) end as related_building_ids
from public.lease_transactions_history h
left join public.lease_building_record_map rm on rm.source_uid=h.source_uid and rm.market_code='BJ'
left join public.lease_building_name_map m on m.market_code='BJ' and m.alias_name=trim(h.new_building)
left join lateral (select array_agg(distinct p.building_id order by p.building_id) related_building_ids from public.lease_building_project_map p where p.market_code='BJ' and p.alias_name=trim(h.new_building)) pm on true;

revoke all on public.lease_transactions_read_v1 from anon, authenticated;
grant select on public.lease_transactions_read_v1 to service_role;

commit;
