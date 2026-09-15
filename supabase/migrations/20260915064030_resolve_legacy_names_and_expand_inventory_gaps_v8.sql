begin;

create temp table _v8_exact_aliases(
  historical_name text primary key,
  current_name text not null,
  basis text not null,
  evidence jsonb not null
) on commit drop;

insert into _v8_exact_aliases values
('万豪中心','荷华明城大厦','EXTERNAL_FORMER_NAME_PLUS_SAME_ADDRESS',jsonb_build_array(
  jsonb_build_object('type','rename','detail','公开招商资料明确：荷华明城大厦位于建国门南大街7号，前身为北京万豪中心'),
  jsonb_build_object('type','current_inventory','detail','当前642栋库存存在荷华明城大厦')
)),
('万豪写字楼','荷华明城大厦','HISTORICAL_VARIANT_OF_VERIFIED_FORMER_NAME',jsonb_build_array(
  jsonb_build_object('type','rename','detail','荷华明城大厦前身为北京万豪中心；历史名称“万豪写字楼”为同项目写字楼口径'),
  jsonb_build_object('type','internal_history','detail','历史记录中万豪写字楼的old_address曾直接记为“万豪”')
)),
('万豪','荷华明城大厦','INTERNAL_CROSS_ALIAS_PLUS_VERIFIED_FORMER_NAME',jsonb_build_array(
  jsonb_build_object('type','rename','detail','荷华明城大厦前身为北京万豪中心'),
  jsonb_build_object('type','internal_history','detail','历史“万豪”与“万豪中心”2018年均出现开元联盟、600㎡成交，形成内部交叉验证')
)),
('用友软件园','用友产业园','SAME_ADDRESS_CURRENT_CANONICAL_NAME',jsonb_build_array(
  jsonb_build_object('type','address','detail','用友当前及历史资料均指向海淀区北清路68号；当前地图名称为用友产业园，旧称/业务表述长期使用用友软件园'),
  jsonb_build_object('type','coordinate','external_lat',40.068656,'external_lng',116.238643,'current_lat',40.068608,'current_lng',116.23862)
));

create temp table _v8_exact_resolved on commit drop as
select e.historical_name,b.id building_id,b.name current_name,e.basis,e.evidence
from _v8_exact_aliases e
join public.buildings b on b.name=e.current_name
join public.lease_building_alias_review r
  on r.historical_name=e.historical_name and r.resolution_status='NEEDS_REVIEW'
where (select count(*) from public.buildings bx where bx.name=e.current_name)=1;

delete from public.lease_building_project_map p
using _v8_exact_resolved e
where p.market_code='BJ' and p.alias_name=e.historical_name;

with grouped as (
  select building_id,jsonb_agg(historical_name order by historical_name) aliases
  from _v8_exact_resolved group by building_id
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
from _v8_exact_resolved
on conflict (market_code,alias_name) do update
set building_id=excluded.building_id,match_method='former_name',verification_status='AUTO_VERIFIED';

update public.lease_building_alias_review r
set resolution_status='AUTO_VERIFIED',matched_building_id=e.building_id,matched_building_name=e.current_name,
    resolution_basis=e.basis,confidence='ABSOLUTE',evidence_snapshot=e.evidence,
    review_notes=coalesce(r.review_notes||' | ','')||'v8 verified legacy/current identity',
    resolved_at=now(),updated_at=now()
from _v8_exact_resolved e where r.historical_name=e.historical_name;

create temp table _v8_project(
  alias_name text not null,
  current_name text not null,
  basis text not null,
  evidence jsonb not null,
  primary key(alias_name,current_name)
) on commit drop;

insert into _v8_project values
('骏豪中央广场','骏豪中央公园A1','PROJECT_SHORTHAND_TO_AVAILABLE_MEMBER',jsonb_build_array(
  jsonb_build_object('type','current_project','detail','地图对“骏豪中央广场”查询直接返回骏豪中央公园广场及A1/A2/A3等分座；当前库存仅有A1，不推断具体塔楼')
));

create temp table _v8_project_resolved on commit drop as
select p.alias_name,b.id building_id,p.basis,p.evidence
from _v8_project p
join public.buildings b on b.name=p.current_name
join public.lease_building_alias_review r on r.historical_name=p.alias_name and r.resolution_status='NEEDS_REVIEW'
where not exists(select 1 from public.lease_building_name_map m where m.market_code='BJ' and m.alias_name=p.alias_name);

insert into public.lease_building_project_map(market_code,alias_name,building_id,match_method,verification_status)
select 'BJ',alias_name,building_id,basis,'AUTO_VERIFIED_PROJECT'
from _v8_project_resolved
on conflict (market_code,alias_name,building_id) do update
set match_method=excluded.match_method,verification_status='AUTO_VERIFIED_PROJECT';

update public.lease_building_alias_review r
set resolution_status='AUTO_VERIFIED_PROJECT',matched_building_id=null,matched_building_name=null,
    resolution_basis=(select min(x.basis) from _v8_project_resolved x where x.alias_name=r.historical_name),
    confidence='ABSOLUTE',
    evidence_snapshot=(select jsonb_agg(distinct e) from _v8_project_resolved x cross join lateral jsonb_array_elements(x.evidence) e where x.alias_name=r.historical_name),
    review_notes=coalesce(r.review_notes||' | ','')||'v8 verified project identity; tower not inferred',
    resolved_at=now(),updated_at=now()
where r.resolution_status='NEEDS_REVIEW'
  and exists(select 1 from _v8_project_resolved x where x.alias_name=r.historical_name);

create temp table _v8_gap(
  historical_name text primary key,
  canonical_name text not null,
  address text not null,
  lat float8,
  lng float8,
  evidence jsonb not null
) on commit drop;

insert into _v8_gap values
('安联大厦','安联大厦','北京市朝阳区东三环北路38号院3号楼',39.921485,116.463126,jsonb_build_array(jsonb_build_object('type','current_entity','detail','2026-09仍有独立出租；当前机构办公地址亦为38号院3号楼安联大厦'),jsonb_build_object('type','disambiguation','detail','同组团1号楼为泰康金融大厦，3号楼为安联大厦；坐标接近不是改名关系'))),
('郦城工作区','郦城工作区','北京市海淀区四季青路8号',39.953619,116.271968,jsonb_build_array(jsonb_build_object('type','current_entity','detail','2025法院公告仍使用四季青路8号郦城工作区地址'),jsonb_build_object('type','inventory_distance','detail','当前库存最近实体约0.90km，无合理承接楼宇'))),
('百环大厦','百环大厦','北京市朝阳区广渠路66号院',39.88978,116.46144,jsonb_build_array(jsonb_build_object('type','current_entity','detail','当前写字楼招商与地图持续独立列示百环大厦，广渠路66号院'),jsonb_build_object('type','inventory_distance','detail','当前库存最近实体乐成中心约0.58km，且canonical/former names均无承接'))),
('新华科技大厦','新华科技大厦','北京市朝阳区驼房营南路8号',39.96179,116.49665,jsonb_build_array(jsonb_build_object('type','current_entity','detail','当前招商及地图仍独立列示新华科技大厦，驼房营南路8号'),jsonb_build_object('type','inventory_distance','detail','当前库存最近实体颐堤港二期约0.95km，无合理改名承接'))),
('金泰富地大厦','金泰富地大厦','北京市海淀区安宁庄西路9号',40.04149,116.30961,jsonb_build_array(jsonb_build_object('type','current_entity','detail','当前招商仍独立列示金泰富地大厦，安宁庄西路9号'),jsonb_build_object('type','address_disambiguation','detail','最近库存自主创新大厦约0.15km，但地址为上地信息产业基地创业路6号，为独立实体'))),
('外运大厦','外运大厦','北京市朝阳区安定路5号院8号楼',null,null,jsonb_build_array(jsonb_build_object('type','authoritative_current_entity','detail','中国城乡控股集团2024年度公司债券年报（2025披露）仍将办公地址列为安定路5号院8号楼外运大厦A座17-18层'),jsonb_build_object('type','inventory_check','detail','642栋canonical/former names无外运大厦承接实体'))),
('君天大厦','君天大厦','北京市朝阳区通惠河畔1131号',null,null,jsonb_build_array(jsonb_build_object('type','current_entity','detail','当前招商与在驻企业官网仍使用通惠河畔1131号君天大厦'),jsonb_build_object('type','inventory_check','detail','642栋canonical/former names无君天大厦承接实体')));

update public.lease_building_alias_review r
set resolution_status='INVENTORY_GAP',matched_building_id=null,matched_building_name=null,
    resolution_basis='EXTERNAL_CURRENT_ENTITY_CONFIRMED_NO_INVENTORY_CANONICAL_OR_ALIAS',
    confidence='ABSOLUTE',evidence_snapshot=g.evidence,
    external_canonical_name=g.canonical_name,external_address=g.address,external_lat=g.lat,external_lng=g.lng,
    review_notes=coalesce(r.review_notes||' | ','')||'v8 verified current external entity absent from 642-building inventory',
    resolved_at=now(),updated_at=now()
from _v8_gap g
where r.historical_name=g.historical_name
  and r.resolution_status='NEEDS_REVIEW'
  and not exists(select 1 from public.lease_building_name_map m where m.market_code='BJ' and m.alias_name=r.historical_name)
  and not exists(select 1 from public.lease_building_project_map p where p.market_code='BJ' and p.alias_name=r.historical_name);

commit;
