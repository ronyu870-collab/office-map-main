begin;

alter table public.buildings
  add column if not exists tracking_scope text;

update public.buildings
set tracking_scope = 'tracked'
where tracking_scope is null;

alter table public.buildings
  alter column tracking_scope set default 'tracked',
  alter column tracking_scope set not null;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid='public.buildings'::regclass
      and conname='buildings_tracking_scope_check'
  ) then
    alter table public.buildings
      add constraint buildings_tracking_scope_check
      check (tracking_scope in ('tracked','reference_only'));
  end if;
end $$;

create index if not exists buildings_tracking_scope_idx
  on public.buildings (tracking_scope,is_active,project_type);

comment on column public.buildings.tracking_scope is
  'tracked = operational inventory used by map/quarterly/recommendation; reference_only = canonical entity retained only for historical identity resolution until explicitly onboarded.';

create or replace view public.operational_buildings_v1
with (security_invoker=true)
as
select *
from public.buildings
where tracking_scope='tracked'
  and is_active=true;

revoke all on public.operational_buildings_v1 from public,anon,authenticated,service_role;
grant select on public.operational_buildings_v1 to authenticated,service_role;

create temp table _reference_gap_aliases on commit drop as
select
  r.historical_name,
  coalesce(r.external_canonical_name,r.matched_building_name) as external_canonical_name,
  r.external_address,
  r.external_lat,
  r.external_lng,
  r.observed_submarkets,
  r.historical_row_count
from public.lease_building_alias_review r
where (
    r.resolution_status='INVENTORY_GAP'
    and r.confidence='ABSOLUTE'
    and r.external_canonical_name is not null
  )
  or (
    r.resolution_basis='REFERENCE_ENTITY_CREATED_FROM_VERIFIED_INVENTORY_GAP'
    and r.confidence='ABSOLUTE'
    and coalesce(r.external_canonical_name,r.matched_building_name) is not null
  );

do $$
declare
  v_aliases integer;
  v_entities integer;
  v_rows integer;
  v_unsafe_collisions integer;
begin
  select count(*),count(distinct external_canonical_name),coalesce(sum(historical_row_count),0)
    into v_aliases,v_entities,v_rows
  from _reference_gap_aliases;

  if v_aliases<>46 or v_entities<>38 or v_rows<>303 then
    raise exception
      'reference gap population drifted: aliases=%, entities=%, rows=% (expected 46/38/303)',
      v_aliases,v_entities,v_rows;
  end if;

  select count(*)
    into v_unsafe_collisions
  from (
    select distinct external_canonical_name from _reference_gap_aliases
  ) g
  join public.buildings b on trim(b.name)=trim(g.external_canonical_name)
  where coalesce(b.tracking_scope,'tracked')<>'reference_only';

  if v_unsafe_collisions<>0 then
    raise exception 'non-reference building name collision detected: %',v_unsafe_collisions;
  end if;
end $$;

create temp table _reference_gap_entities on commit drop as
select
  a.external_canonical_name,
  max(a.external_address) as external_address,
  max(a.external_lat) as external_lat,
  max(a.external_lng) as external_lng,
  coalesce(
    to_jsonb(
      array_agg(distinct a.historical_name order by a.historical_name)
      filter (where a.historical_name<>a.external_canonical_name)
    ),
    '[]'::jsonb
  ) as former_names,
  sum(a.historical_row_count) as historical_rows
from _reference_gap_aliases a
group by a.external_canonical_name;

insert into public.buildings (
  name,city,district,location_lng,location_lat,former_names,
  project_type,is_active,is_entered_market,tracking_scope,notes
)
select
  e.external_canonical_name,
  '北京',
  case
    when e.external_address like '%东城区%' then '东城区'
    when e.external_address like '%西城区%' then '西城区'
    when e.external_address like '%朝阳区%' then '朝阳区'
    when e.external_address like '%海淀区%' then '海淀区'
    when e.external_address like '%丰台区%' then '丰台区'
    when e.external_address like '%石景山区%' then '石景山区'
    when e.external_address like '%通州区%' then '通州区'
    when e.external_address like '%大兴区%' then '大兴区'
    when e.external_address like '%昌平区%' then '昌平区'
    when e.external_address like '%顺义区%' then '顺义区'
    else null
  end,
  e.external_lng,e.external_lat,e.former_names,
  'reference',false,true,'reference_only',
  concat(
    '历史参考实体，仅用于历史成交身份解析；不参与地图、季度填报、推荐和楼书运营。',
    case when e.external_address is not null then ' 外部验证地址：'||e.external_address||'。' else '' end,
    ' 迁移时关联历史成交：',e.historical_rows,' 条。'
  )
from _reference_gap_entities e
where not exists (
  select 1 from public.buildings b
  where trim(b.name)=trim(e.external_canonical_name)
);

update public.buildings b
set
  tracking_scope='reference_only',
  project_type='reference',
  is_active=false,
  is_entered_market=true
from _reference_gap_entities e
where trim(b.name)=trim(e.external_canonical_name)
  and b.tracking_scope='reference_only';

do $$
declare v_count integer;
begin
  select count(*) into v_count
  from public.buildings b
  join _reference_gap_entities e on trim(e.external_canonical_name)=trim(b.name)
  where b.tracking_scope='reference_only'
    and b.project_type='reference'
    and b.is_active=false;

  if v_count<>38 then
    raise exception 'reference entity verification failed: %/38',v_count;
  end if;
end $$;

do $$
declare v_conflicts integer;
begin
  select count(*) into v_conflicts
  from _reference_gap_aliases a
  join public.lease_building_name_map m
    on m.market_code='BJ' and m.alias_name=a.historical_name
  join public.buildings b
    on b.name=a.external_canonical_name and b.tracking_scope='reference_only'
  where m.building_id<>b.id;

  if v_conflicts<>0 then
    raise exception 'historical alias already mapped to a different building: %',v_conflicts;
  end if;
end $$;

insert into public.lease_building_name_map(
  market_code,alias_name,building_id,match_method,verification_status
)
select
  'BJ',
  a.historical_name,
  b.id,
  case when trim(a.historical_name)=trim(a.external_canonical_name)
       then 'canonical_name' else 'former_name' end,
  'AUTO_VERIFIED'
from _reference_gap_aliases a
join public.buildings b
  on b.name=a.external_canonical_name
 and b.tracking_scope='reference_only'
on conflict (market_code,alias_name) do nothing;

update public.lease_building_alias_review r
set
  resolution_status='AUTO_VERIFIED',
  matched_building_id=b.id,
  matched_building_name=b.name,
  resolution_basis='REFERENCE_ENTITY_CREATED_FROM_VERIFIED_INVENTORY_GAP',
  confidence='ABSOLUTE',
  review_notes=concat_ws(
    ' | ',
    nullif(r.review_notes,''),
    'v19 reference-only canonical entity created; excluded from operational map/quarterly/recommendation surfaces'
  ),
  resolved_at=coalesce(r.resolved_at,now()),
  updated_at=now()
from _reference_gap_aliases a
join public.buildings b
  on b.name=a.external_canonical_name
 and b.tracking_scope='reference_only'
where r.historical_name=a.historical_name
  and (
    r.resolution_status='INVENTORY_GAP'
    or r.resolution_basis='REFERENCE_ENTITY_CREATED_FROM_VERIFIED_INVENTORY_GAP'
  );

create or replace view public.lease_transactions_read_v1
with (security_invoker=true)
as
select
  'live:'::text||l.id::text as read_id,
  'live'::text as record_source,
  l.id as source_record_id,
  null::text as source_uid,
  'BJ'::text as market_code,
  m.building_id,
  l.company,l.suspected_company_fullname,l.enterprise_type,l.industry,l.sub_industry,l.demand_type,
  l.new_building,l.sub_market,l.district,l.building_grade,l.floor,l.floor_info,
  l.old_address,l.old_sub_market,l.old_district,l.old_building_grade,
  l.area_sqm,l.face_rent,l.lease_term_months,l.fit_out_months,l.rent_free_months,l.effective_rent,
  null::numeric as management_fee,
  l.transaction_date,l.transaction_year,l.transaction_quarter::text as transaction_quarter,
  concat(l.transaction_year::text,l.transaction_quarter::text) as transaction_period,
  case when l.transaction_date is not null then 'date'
       when l.transaction_year is not null and l.transaction_quarter is not null then 'quarter'
       when l.transaction_year is not null then 'year'
       else 'unknown' end as transaction_time_precision,
  case when l.transaction_date is not null then l.transaction_date
       when l.transaction_year is not null and l.transaction_quarter::text='Q1' then make_date(l.transaction_year,1,1)
       when l.transaction_year is not null and l.transaction_quarter::text='Q2' then make_date(l.transaction_year,4,1)
       when l.transaction_year is not null and l.transaction_quarter::text='Q3' then make_date(l.transaction_year,7,1)
       when l.transaction_year is not null and l.transaction_quarter::text='Q4' then make_date(l.transaction_year,10,1)
       when l.transaction_year is not null then make_date(l.transaction_year,1,1)
       else null::date end as transaction_period_start,
  case when l.transaction_date is not null then l.transaction_date
       when l.transaction_year is not null and l.transaction_quarter::text='Q1' then make_date(l.transaction_year,3,31)
       when l.transaction_year is not null and l.transaction_quarter::text='Q2' then make_date(l.transaction_year,6,30)
       when l.transaction_year is not null and l.transaction_quarter::text='Q3' then make_date(l.transaction_year,9,30)
       when l.transaction_year is not null and l.transaction_quarter::text='Q4' then make_date(l.transaction_year,12,31)
       when l.transaction_year is not null then make_date(l.transaction_year,12,31)
       else null::date end as transaction_period_end,
  l.remarks,
  null::text as agency_company,
  null::text as agency_person,
  l.submitter_id,l.submitter_name,l.data_source::text as data_source,
  'OPERATIONAL'::text as quality_status,
  'broker_submitted_period'::text as period_source,
  l.created_at,l.updated_at,null::timestamptz as imported_at,
  case
    when m.building_id is not null and mb.tracking_scope='reference_only' then 'reference'
    when m.building_id is not null then 'exact'
    when coalesce(cardinality(pm.related_building_ids),0)>0 then 'project'
    else 'unmapped'
  end as building_match_scope,
  case when m.building_id is not null then array[m.building_id]
       else coalesce(pm.related_building_ids,'{}'::uuid[]) end as related_building_ids
from public.lease_transactions l
left join public.lease_building_name_map m
  on m.market_code='BJ' and m.alias_name=trim(l.new_building)
left join public.buildings mb on mb.id=m.building_id
left join lateral (
  select array_agg(distinct p.building_id order by p.building_id) related_building_ids
  from public.lease_building_project_map p
  where p.market_code='BJ' and p.alias_name=trim(l.new_building)
) pm on true

union all

select
  'history:'::text||h.source_uid as read_id,
  'history'::text as record_source,
  h.id as source_record_id,
  h.source_uid,
  'BJ'::text as market_code,
  coalesce(rm.building_id,m.building_id) as building_id,
  h.company,h.suspected_company_fullname,h.enterprise_type,h.industry,h.sub_industry,h.demand_type,
  h.new_building,h.sub_market,h.district,h.building_grade,h.floor,h.floor_info,
  h.old_address,h.old_sub_market,h.old_district,h.old_building_grade,
  h.area_sqm,h.face_rent,h.lease_term_months,h.fit_out_months,h.rent_free_months,h.effective_rent,h.management_fee,
  h.transaction_date,h.transaction_year,h.transaction_quarter::text as transaction_quarter,
  concat(h.transaction_year::text,h.transaction_quarter::text) as transaction_period,
  case when h.transaction_date is not null then 'date'
       when h.transaction_year is not null and h.transaction_quarter is not null then 'quarter'
       when h.transaction_year is not null then 'year'
       else 'unknown' end as transaction_time_precision,
  case when h.transaction_date is not null then h.transaction_date
       when h.transaction_year is not null and h.transaction_quarter::text='Q1' then make_date(h.transaction_year,1,1)
       when h.transaction_year is not null and h.transaction_quarter::text='Q2' then make_date(h.transaction_year,4,1)
       when h.transaction_year is not null and h.transaction_quarter::text='Q3' then make_date(h.transaction_year,7,1)
       when h.transaction_year is not null and h.transaction_quarter::text='Q4' then make_date(h.transaction_year,10,1)
       when h.transaction_year is not null then make_date(h.transaction_year,1,1)
       else null::date end as transaction_period_start,
  case when h.transaction_date is not null then h.transaction_date
       when h.transaction_year is not null and h.transaction_quarter::text='Q1' then make_date(h.transaction_year,3,31)
       when h.transaction_year is not null and h.transaction_quarter::text='Q2' then make_date(h.transaction_year,6,30)
       when h.transaction_year is not null and h.transaction_quarter::text='Q3' then make_date(h.transaction_year,9,30)
       when h.transaction_year is not null and h.transaction_quarter::text='Q4' then make_date(h.transaction_year,12,31)
       when h.transaction_year is not null then make_date(h.transaction_year,12,31)
       else null::date end as transaction_period_end,
  h.remarks,h.agency_company,h.agency_person,
  h.submitter_id,h.submitter_name,h.data_source::text as data_source,
  h.quality_status,h.period_source,h.created_at,h.updated_at,h.imported_at,
  case
    when coalesce(rm.building_id,m.building_id) is not null
         and rb.tracking_scope='reference_only' then 'reference'
    when rm.building_id is not null or m.building_id is not null then 'exact'
    when coalesce(cardinality(pm.related_building_ids),0)>0 then 'project'
    else 'unmapped'
  end as building_match_scope,
  case when rm.building_id is not null then array[rm.building_id]
       when m.building_id is not null then array[m.building_id]
       else coalesce(pm.related_building_ids,'{}'::uuid[]) end as related_building_ids
from public.lease_transactions_history h
left join public.lease_building_record_map rm
  on rm.source_uid=h.source_uid and rm.market_code='BJ'
left join public.lease_building_name_map m
  on m.market_code='BJ' and m.alias_name=trim(h.new_building)
left join public.buildings rb
  on rb.id=coalesce(rm.building_id,m.building_id)
left join lateral (
  select array_agg(distinct p.building_id order by p.building_id) related_building_ids
  from public.lease_building_project_map p
  where p.market_code='BJ' and p.alias_name=trim(h.new_building)
) pm on true;

revoke all on public.lease_transactions_read_v1 from public,anon,authenticated,service_role;
grant select on public.lease_transactions_read_v1 to service_role;

do $$
declare
  v_reference integer;
  v_needs_review_reference integer;
begin
  select count(*) into v_reference
  from public.lease_transactions_read_v1
  where record_source='history' and building_match_scope='reference';

  if v_reference<>303 then
    raise exception 'reference read coverage verification failed: %/303',v_reference;
  end if;

  select count(*) into v_needs_review_reference
  from public.lease_transactions_read_v1 rr
  join public.lease_building_alias_review ar
    on ar.historical_name=trim(rr.new_building)
  where rr.record_source='history'
    and rr.building_match_scope='reference'
    and ar.resolution_status='NEEDS_REVIEW';

  if v_needs_review_reference<>0 then
    raise exception 'unsafe NEEDS_REVIEW rows entered reference scope: %',v_needs_review_reference;
  end if;
end $$;

commit;
