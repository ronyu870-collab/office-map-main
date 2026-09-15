begin;

alter table public.lease_building_alias_review
  add column if not exists external_canonical_name text,
  add column if not exists external_address text,
  add column if not exists external_lat double precision,
  add column if not exists external_lng double precision;

update public.lease_building_alias_review r
set external_canonical_name = x.canonical,
    external_address = x.address,
    external_lat = x.lat,
    external_lng = x.lng,
    updated_at = now()
from (values
  ('石榴中心','石榴中心','北京市丰台区榴乡路88号',39.841544::float8,116.423225::float8),
  ('福码大厦','福码大厦','北京市朝阳区广顺北大街33号',39.994876::float8,116.467422::float8),
  ('时代财富天地','时代财富天地','北京市丰台区航丰路1号',39.831545::float8,116.287264::float8),
  ('外企大厦','外企大厦','北京市朝阳区西大望路15号',39.893668::float8,116.476101::float8),
  ('天桥艺术大厦','天桥艺术大厦','北京市西城区天桥南大街1号',39.885493::float8,116.397880::float8),
  ('柏彦大厦','柏彦大厦','北京市海淀区北四环中路238号',39.985986::float8,116.348757::float8)
) x(alias,canonical,address,lat,lng)
where r.historical_name=x.alias and r.resolution_status='INVENTORY_GAP';

create temp table _v7_exact_aliases(
  historical_name text primary key,
  current_name text not null,
  basis text not null,
  evidence jsonb not null
) on commit drop;

insert into _v7_exact_aliases values
('中航资本大厦','中航产融大厦','OFFICIAL_COMPANY_AND_BUILDING_RENAME',jsonb_build_array(
  jsonb_build_object('type','official_address','detail','2018上市公司公告：望京东园四区2号楼中航资本大厦41层'),
  jsonb_build_object('type','rename','detail','2021中航资本正式更名中航产融；同址后续披露为中航产融大厦41层')
)),
('中关村一号','中关村壹号','CHINESE_NUMERAL_CANONICALIZATION_PLUS_COORDINATE',jsonb_build_array(
  jsonb_build_object('type','official_current_entity','detail','北京市2026开放园区信息：中关村壹号，海淀区北清路81号'),
  jsonb_build_object('type','coordinate','external_lat',40.075894,'external_lng',116.246734,'current_lat',40.076059,'current_lng',116.247314)
));

create temp table _v7_exact_resolved on commit drop as
select e.historical_name,b.id building_id,b.name current_name,e.basis,e.evidence
from _v7_exact_aliases e
join public.buildings b on b.name=e.current_name
join public.lease_building_alias_review r
  on r.historical_name=e.historical_name and r.resolution_status='NEEDS_REVIEW'
where (select count(*) from public.buildings bx where bx.name=e.current_name)=1;

delete from public.lease_building_project_map p
using _v7_exact_resolved e
where p.market_code='BJ' and p.alias_name=e.historical_name;

with grouped as (
  select building_id,jsonb_agg(historical_name order by historical_name) aliases
  from _v7_exact_resolved group by building_id
), expanded as (
  select g.building_id,jsonb_agg(distinct value order by value) former_names
  from grouped g join public.buildings b on b.id=g.building_id
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
from _v7_exact_resolved
on conflict (market_code,alias_name) do update
set building_id=excluded.building_id,match_method='former_name',verification_status='AUTO_VERIFIED';

update public.lease_building_alias_review r
set resolution_status='AUTO_VERIFIED',matched_building_id=e.building_id,matched_building_name=e.current_name,
    resolution_basis=e.basis,confidence='ABSOLUTE',evidence_snapshot=e.evidence,
    review_notes=coalesce(r.review_notes||' | ','')||'v7 external rename/address/coordinate resolution',
    resolved_at=now(),updated_at=now()
from _v7_exact_resolved e where r.historical_name=e.historical_name;

create temp table _v7_project(
  alias_name text not null,
  current_name text not null,
  basis text not null,
  evidence jsonb not null,
  primary key(alias_name,current_name)
) on commit drop;

insert into _v7_project values
('融科资讯','融科资讯中心A座','PROJECT_CANONICAL_NAME_GROUP',jsonb_build_array(jsonb_build_object('type','current_project','detail','融科资讯中心公开资料明确由A/B/C三栋分体楼宇组成，地址科学院南路2号'))),
('融科资讯','融科资讯中心B座','PROJECT_CANONICAL_NAME_GROUP',jsonb_build_array(jsonb_build_object('type','current_project','detail','融科资讯中心公开资料明确由A/B/C三栋分体楼宇组成，地址科学院南路2号'))),
('融科资讯','融科资讯中心C座','PROJECT_CANONICAL_NAME_GROUP',jsonb_build_array(jsonb_build_object('type','current_project','detail','融科资讯中心公开资料明确由A/B/C三栋分体楼宇组成，地址科学院南路2号'))),
('东方广场W1','东方广场西区','WEST_ZONE_TOWER_MEMBERSHIP',jsonb_build_array(
  jsonb_build_object('type','address','detail','公开地图：东方广场W1座=东长安街1号西区1号楼'),
  jsonb_build_object('type','coordinate','external_lat',39.909092,'external_lng',116.413134,'current_lat',39.909443,'current_lng',116.412649)
));

create temp table _v7_project_resolved on commit drop as
select p.alias_name,b.id building_id,p.basis,p.evidence
from _v7_project p
join public.buildings b on b.name=p.current_name
join public.lease_building_alias_review r on r.historical_name=p.alias_name and r.resolution_status='NEEDS_REVIEW'
where not exists(select 1 from public.lease_building_name_map m where m.market_code='BJ' and m.alias_name=p.alias_name);

insert into public.lease_building_project_map(market_code,alias_name,building_id,match_method,verification_status)
select 'BJ',alias_name,building_id,basis,'AUTO_VERIFIED_PROJECT'
from _v7_project_resolved
on conflict (market_code,alias_name,building_id) do update
set match_method=excluded.match_method,verification_status='AUTO_VERIFIED_PROJECT';

update public.lease_building_alias_review r
set resolution_status='AUTO_VERIFIED_PROJECT',matched_building_id=null,matched_building_name=null,
    resolution_basis=(select min(x.basis) from _v7_project_resolved x where x.alias_name=r.historical_name),
    confidence='ABSOLUTE',
    evidence_snapshot=(select jsonb_agg(distinct e) from _v7_project_resolved x cross join lateral jsonb_array_elements(x.evidence) e where x.alias_name=r.historical_name),
    review_notes=coalesce(r.review_notes||' | ','')||'v7 verified project/zone scope; finer tower identity not inferred',
    resolved_at=now(),updated_at=now()
where r.resolution_status='NEEDS_REVIEW'
  and exists(select 1 from _v7_project_resolved x where x.alias_name=r.historical_name);

create temp table _v7_gap(
  historical_name text primary key,
  canonical_name text not null,
  address text not null,
  lat float8,
  lng float8,
  evidence jsonb not null
) on commit drop;

insert into _v7_gap values
('东方梅地亚','东方梅地亚中心','北京市朝阳区光华路4号',39.912145,116.472917,jsonb_build_array(jsonb_build_object('type','current_entity','detail','当前地图及北京市公共资源交易资料仍使用光华路4号东方梅地亚中心'),jsonb_build_object('type','inventory_check','detail','642栋 canonical/former names 无东方梅地亚承接实体'))),
('东方梅地亚中心','东方梅地亚中心','北京市朝阳区光华路4号',39.912145,116.472917,jsonb_build_array(jsonb_build_object('type','current_entity','detail','当前地图及北京市公共资源交易资料仍使用光华路4号东方梅地亚中心'),jsonb_build_object('type','inventory_check','detail','642栋 canonical/former names 无东方梅地亚中心承接实体'))),
('泛利大厦','泛利大厦','北京市朝阳区朝阳门外大街22号',39.922432,116.439775,jsonb_build_array(jsonb_build_object('type','government_current_entity','detail','北京市2025朝外大街城市更新二期将泛利大厦作为独立点位列示'),jsonb_build_object('type','inventory_check','detail','附近现有库存楼宇均为独立实体，不能以距离代替身份'))),
('达美中心','达美中心','北京市朝阳区青年路7号',39.936834,116.516418,jsonb_build_array(jsonb_build_object('type','current_entity','detail','Colliers当前项目页仍独立列示北京达美中心，青年路7号'),jsonb_build_object('type','inventory_distance','detail','当前642栋最近楼宇约1.26km'))),
('天元港中心','天元港中心','北京市朝阳区东三环北路丙2号',39.955495,116.459732,jsonb_build_array(jsonb_build_object('type','current_entity','detail','当前地图及写字楼资料仍以天元港中心独立运营'),jsonb_build_object('type','inventory_check','detail','附近佳程/国航等为不同楼宇'))),
('首科大厦','首科大厦','北京市丰台区西三环南路14号院',null,null,jsonb_build_array(jsonb_build_object('type','government_current_entity','detail','丰台区政府2025商务楼宇页面持续独立列示首科大厦'),jsonb_build_object('type','inventory_check','detail','642栋 canonical/former names 无首科大厦承接实体'))),
('科实大厦','科实大厦','北京市海淀区上地信息路甲28号',null,null,jsonb_build_array(jsonb_build_object('type','current_entity','detail','当前地图持续列示科实大厦A/B/C/D座，地址信息路甲28号'),jsonb_build_object('type','inventory_check','detail','642栋 canonical/former names 无科实大厦承接实体'))),
('中国锦','绿地中国锦','北京市朝阳区望京东园四区11号楼',40.000177,116.487270,jsonb_build_array(jsonb_build_object('type','current_entity','detail','绿地中国锦当前仍以望京东园四区11号楼独立出租'),jsonb_build_object('type','address_disambiguation','detail','最近库存阿里中心望京A座为望京东园四区9号楼，非11号楼中国锦'))),
('绿地中心','北京绿地中心','北京市朝阳区望京东园四区11号楼（中国锦主楼）',40.000177,116.487270,jsonb_build_array(jsonb_build_object('type','current_entity','detail','北京绿地中心当前仍存在，主楼中国锦位于望京东园四区11号楼'),jsonb_build_object('type','address_disambiguation','detail','附近阿里项目不能作为绿地中心承接实体'))),
('绿地中心中国锦','绿地中国锦','北京市朝阳区望京东园四区11号楼',40.000177,116.487270,jsonb_build_array(jsonb_build_object('type','current_entity','detail','当前公开招商及企业地址持续使用绿地中心中国锦/中国锦'),jsonb_build_object('type','inventory_check','detail','642栋 canonical/former names 无承接实体')));

update public.lease_building_alias_review r
set resolution_status='INVENTORY_GAP',matched_building_id=null,matched_building_name=null,
    resolution_basis='EXTERNAL_CURRENT_ENTITY_CONFIRMED_NO_INVENTORY_CANONICAL_OR_ALIAS',
    confidence='ABSOLUTE',evidence_snapshot=g.evidence,
    external_canonical_name=g.canonical_name,external_address=g.address,external_lat=g.lat,external_lng=g.lng,
    review_notes=coalesce(r.review_notes||' | ','')||'v7 verified current external entity absent from 642-building inventory',
    resolved_at=now(),updated_at=now()
from _v7_gap g
where r.historical_name=g.historical_name
  and r.resolution_status='NEEDS_REVIEW'
  and not exists(select 1 from public.lease_building_name_map m where m.market_code='BJ' and m.alias_name=r.historical_name)
  and not exists(select 1 from public.lease_building_project_map p where p.market_code='BJ' and p.alias_name=r.historical_name);

commit;
