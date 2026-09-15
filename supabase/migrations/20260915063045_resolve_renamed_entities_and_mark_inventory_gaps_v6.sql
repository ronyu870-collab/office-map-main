begin;

alter table public.lease_building_alias_review
  add column if not exists evidence_snapshot jsonb not null default '[]'::jsonb;

alter table public.lease_building_alias_review
  drop constraint if exists lease_building_alias_review_resolution_status_check;
alter table public.lease_building_alias_review
  add constraint lease_building_alias_review_resolution_status_check
  check (resolution_status = any (array[
    'AUTO_VERIFIED'::text,
    'MANUAL_VERIFIED'::text,
    'AUTO_VERIFIED_PROJECT'::text,
    'MANUAL_VERIFIED_PROJECT'::text,
    'INVENTORY_GAP'::text,
    'NEEDS_REVIEW'::text,
    'NO_MATCH'::text
  ]));

create temp table _v6_exact_aliases(
  historical_name text primary key,
  current_name text not null,
  basis text not null,
  evidence jsonb not null
) on commit drop;

insert into _v6_exact_aliases values
('君康人寿大厦','富泽人寿大厦','EXTERNAL_RENAME_PLUS_COORDINATE',jsonb_build_array(
  jsonb_build_object('type','rename','detail','富泽人寿大厦公开标注为原君康人寿大厦'),
  jsonb_build_object('type','coordinate','historical_lat',39.999753,'historical_lng',116.491835,'current_lat',39.999867,'current_lng',116.491812)
)),
('金泰大厦','能+中心金泰','SAME_ADDRESS_COORDINATE_REBRAND',jsonb_build_array(
  jsonb_build_object('type','address','detail','公开资料均指向北京市朝阳区西坝河南路1号'),
  jsonb_build_object('type','coordinate','historical_lat',39.960077,'historical_lng',116.433479,'current_lat',39.960077,'current_lng',116.433479)
)),
('东亿国际','东亿文化科技产业园','SAME_SITE_CURRENT_NAME',jsonb_build_array(
  jsonb_build_object('type','site_identity','detail','东亿国际传媒产业园与东亿文化科技产业园同址高井文化园路8号'),
  jsonb_build_object('type','coordinate','historical_lat',39.911778,'historical_lng',116.539379,'current_lat',39.911778,'current_lng',116.539379)
)),
('东亿','东亿文化科技产业园','SAME_SITE_CURRENT_NAME',jsonb_build_array(
  jsonb_build_object('type','site_identity','detail','历史简称东亿，对应东亿国际传媒产业园/现东亿文化科技产业园同一园区')
)),
('大望京商务中心','大望京中心','EXTERNAL_ALIAS_CURRENT_NAME',jsonb_build_array(
  jsonb_build_object('type','name_alias','detail','公开地图当前实体“大望京中心”的用户及招商资料仍使用“大望京商务中心”名称')
)),
('锦什坊街35号','锦什坊街叁拾伍号','ADDRESS_NUMERAL_CANONICALIZATION',jsonb_build_array(
  jsonb_build_object('type','official_address','detail','北京市公开信息将“锦什坊街叁拾伍号”建设地点写作锦什坊街35号')
)),
('远洋国际中心E座','远洋国际中心二期','FORMER_NAME_PLUS_COORDINATE',jsonb_build_array(
  jsonb_build_object('type','former_name','detail','当前实体 former_names 已含远洋国际中心二期E座'),
  jsonb_build_object('type','coordinate','historical_lat',39.916114,'historical_lng',116.491319,'current_lat',39.916186,'current_lng',116.492122)
));

create temp table _v6_exact_resolved on commit drop as
select e.historical_name,b.id building_id,b.name current_name,e.basis,e.evidence
from _v6_exact_aliases e
join public.buildings b on b.name=e.current_name
join public.lease_building_alias_review r
  on r.historical_name=e.historical_name and r.resolution_status='NEEDS_REVIEW'
where (select count(*) from public.buildings bx where bx.name=e.current_name)=1;

delete from public.lease_building_project_map p
using _v6_exact_resolved e
where p.market_code='BJ' and p.alias_name=e.historical_name;

with grouped as (
  select building_id,jsonb_agg(historical_name order by historical_name) aliases
  from _v6_exact_resolved group by building_id
), expanded as (
  select g.building_id,jsonb_agg(distinct value order by value) former_names
  from grouped g
  join public.buildings b on b.id=g.building_id
  cross join lateral (
    select x.value from jsonb_array_elements_text(case when jsonb_typeof(b.former_names)='array' then b.former_names else '[]'::jsonb end) x(value)
    union all
    select y.value from jsonb_array_elements_text(g.aliases) y(value)
  ) u
  where nullif(trim(value),'') is not null
  group by g.building_id
)
update public.buildings b set former_names=e.former_names
from expanded e where b.id=e.building_id;

insert into public.lease_building_name_map(market_code,alias_name,building_id,match_method,verification_status)
select 'BJ',historical_name,building_id,'former_name','AUTO_VERIFIED'
from _v6_exact_resolved
on conflict (market_code,alias_name) do update
set building_id=excluded.building_id,match_method='former_name',verification_status='AUTO_VERIFIED';

update public.lease_building_alias_review r
set resolution_status='AUTO_VERIFIED',
    matched_building_id=e.building_id,
    matched_building_name=e.current_name,
    resolution_basis=e.basis,
    confidence='ABSOLUTE',
    evidence_snapshot=e.evidence,
    review_notes=coalesce(r.review_notes||' | ','')||'v6 address/coordinate/rename entity resolution',
    resolved_at=now(),updated_at=now()
from _v6_exact_resolved e
where r.historical_name=e.historical_name;

create temp table _v6_project(alias_name text not null,current_name text not null,basis text not null,evidence jsonb not null,primary key(alias_name,current_name)) on commit drop;
insert into _v6_project values
('鼎好大厦','鼎好DH3-A座','RENOVATED_PROJECT_GROUP',jsonb_build_array(jsonb_build_object('type','official_rename','detail','鼎好大厦A/B座改造后整体焕新为鼎好DH3'))),
('鼎好大厦','鼎好DH3-B/C座','RENOVATED_PROJECT_GROUP',jsonb_build_array(jsonb_build_object('type','official_rename','detail','鼎好大厦A/B座改造后整体焕新为鼎好DH3'))),
('骏豪中央公园广场','骏豪中央公园A1','PROJECT_NAME_TO_CURRENT_MEMBER',jsonb_build_array(jsonb_build_object('type','coordinate','detail','公开骏豪中央公园广场与当前骏豪中央公园A1坐标完全一致','lat',39.932174,'lng',116.477131)));

create temp table _v6_project_resolved on commit drop as
select p.alias_name,b.id building_id,p.basis,p.evidence
from _v6_project p
join public.buildings b on b.name=p.current_name
join public.lease_building_alias_review r on r.historical_name=p.alias_name and r.resolution_status='NEEDS_REVIEW'
where not exists(select 1 from public.lease_building_name_map m where m.market_code='BJ' and m.alias_name=p.alias_name);

insert into public.lease_building_project_map(market_code,alias_name,building_id,match_method,verification_status)
select 'BJ',alias_name,building_id,basis,'AUTO_VERIFIED_PROJECT'
from _v6_project_resolved
on conflict (market_code,alias_name,building_id) do update
set match_method=excluded.match_method,verification_status='AUTO_VERIFIED_PROJECT';

update public.lease_building_alias_review r
set resolution_status='AUTO_VERIFIED_PROJECT',
    matched_building_id=null,matched_building_name=null,
    resolution_basis=(select min(x.basis) from _v6_project_resolved x where x.alias_name=r.historical_name),
    confidence='ABSOLUTE',
    evidence_snapshot=(select jsonb_agg(distinct e) from _v6_project_resolved x cross join lateral jsonb_array_elements(x.evidence) e where x.alias_name=r.historical_name),
    review_notes=coalesce(r.review_notes||' | ','')||'v6 verified project scope; tower not inferred',
    resolved_at=now(),updated_at=now()
where r.resolution_status='NEEDS_REVIEW'
  and exists(select 1 from _v6_project_resolved x where x.alias_name=r.historical_name);

create temp table _v6_gap_source(
  historical_name text primary key,
  external_address text not null,
  lat float8 not null,
  lng float8 not null,
  source_note text not null,
  min_safe_km float8 not null default 0.30
) on commit drop;

insert into _v6_gap_source values
('石榴中心','北京市丰台区榴乡路88号',39.841544,116.423225,'丰台区政府及公开地图持续确认石榴中心实体',0.30),
('福码大厦','北京市朝阳区广顺北大街33号',39.994876,116.467422,'公开地图持续确认福码大厦实体',0.30),
('时代财富天地','北京市丰台区航丰路1号',39.831545,116.287264,'公开地图持续确认时代财富天地实体',0.30),
('外企大厦','北京市朝阳区西大望路15号',39.893668,116.476101,'公开地图及华住门店地址持续确认外企大厦实体',0.30),
('天桥艺术大厦','北京市西城区天桥南大街1号',39.885493,116.397880,'西城区政府及公开地图持续确认天桥艺术大厦实体',0.30),
('柏彦大厦','北京市海淀区北四环中路238号',39.985986,116.348757,'北京市政务地图及公开地图持续确认柏彦大厦实体',0.30),
('泛利大厦','北京市朝阳区朝阳门外大街22号',39.922716,116.440385,'北京市发改委2025年仍将泛利大厦作为独立建筑列示',0.30);

create temp table _v6_gap_verified on commit drop as
select g.*,n.nearest_name,n.nearest_km
from _v6_gap_source g
join public.lease_building_alias_review r on r.historical_name=g.historical_name and r.resolution_status='NEEDS_REVIEW'
cross join lateral (
  select b.name nearest_name,
         111.32*sqrt(power(b.location_lat-g.lat,2)+power((b.location_lng-g.lng)*cos(radians(g.lat)),2)) nearest_km
  from public.buildings b
  where b.location_lat is not null and b.location_lng is not null
  order by 111.32*sqrt(power(b.location_lat-g.lat,2)+power((b.location_lng-g.lng)*cos(radians(g.lat)),2))
  limit 1
) n
where n.nearest_km >= g.min_safe_km
  and not exists(select 1 from public.lease_building_name_map m where m.market_code='BJ' and m.alias_name=g.historical_name)
  and not exists(select 1 from public.lease_building_project_map p where p.market_code='BJ' and p.alias_name=g.historical_name);

update public.lease_building_alias_review r
set resolution_status='INVENTORY_GAP',
    matched_building_id=null,matched_building_name=null,
    resolution_basis='EXTERNAL_ENTITY_VERIFIED_NO_CURRENT_INVENTORY_ENTITY',
    confidence='ABSOLUTE',
    evidence_snapshot=jsonb_build_array(
      jsonb_build_object('type','external_entity','address',g.external_address,'lat',g.lat,'lng',g.lng,'detail',g.source_note),
      jsonb_build_object('type','inventory_distance','nearest_current_name',g.nearest_name,'nearest_distance_km',round(g.nearest_km::numeric,3),'inventory_size',642)
    ),
    review_notes=coalesce(r.review_notes||' | ','')||'v6 current external entity verified; absent from 642-building inventory under conservative coordinate threshold',
    resolved_at=now(),updated_at=now()
from _v6_gap_verified g
where r.historical_name=g.historical_name;

commit;
