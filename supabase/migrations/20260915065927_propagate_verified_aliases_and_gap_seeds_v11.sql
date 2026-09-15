begin;

create temp table _v11_exact(
  historical_name text primary key,
  current_name text not null,
  basis text not null,
  evidence jsonb not null
) on commit drop;

insert into _v11_exact values
('六工汇','首钢园北区-六工汇','CURRENT_CANONICAL_NAME_CONTAINS_HISTORY_UNIQUE',jsonb_build_array(jsonb_build_object('type','current_inventory','detail','当前库存唯一实体首钢园北区-六工汇直接包含历史项目名“六工汇”；无竞争同名实体'))),
('竞园','竞园(北京)图片产业基地','CURRENT_CANONICAL_NAME_EXPANSION_UNIQUE',jsonb_build_array(jsonb_build_object('type','current_inventory','detail','当前库存唯一竞园实体为竞园(北京)图片产业基地；历史简称无其他竞争实体'))),
('英蓝国际大厦','英蓝国际金融中心','VERIFIED_SEED_GENERIC_SUFFIX_VARIANT',jsonb_build_array(jsonb_build_object('type','verified_seed','detail','已验证英蓝国际/英蓝国际中心均指向英蓝国际金融中心；“大厦”仅为通用楼宇尾缀变体'))),
('ubp','恒通国际商务园','VERIFIED_SEED_CASE_VARIANT',jsonb_build_array(jsonb_build_object('type','verified_seed','detail','已验证别名UBP指向恒通国际商务园；ubp仅大小写差异'))),
('双子座','汇京双子座大厦','VERIFIED_SEED_SUFFIX_REMOVAL',jsonb_build_array(jsonb_build_object('type','verified_seed','detail','已验证双子座大厦/LG双子座均指向汇京双子座大厦；历史双子座商圈为CBD'))),
('融新科技','融新科技中心','VERIFIED_SEED_SUFFIX_REMOVAL',jsonb_build_array(jsonb_build_object('type','verified_seed','detail','已验证融新科技大厦指向融新科技中心；历史融新科技商圈为亚奥'))),
('wfc','环球金融中心','VERIFIED_SEED_CASE_VARIANT',jsonb_build_array(jsonb_build_object('type','verified_seed','detail','已验证WFC指向环球金融中心；wfc仅大小写差异'))),
('Wfc','环球金融中心','VERIFIED_SEED_CASE_VARIANT',jsonb_build_array(jsonb_build_object('type','verified_seed','detail','已验证WFC指向环球金融中心；Wfc仅大小写差异'))),
('wfc西塔','环球金融中心','VERIFIED_SEED_CASE_VARIANT',jsonb_build_array(jsonb_build_object('type','verified_seed','detail','已验证WFC西塔指向环球金融中心；wfc西塔仅大小写差异'))),
('中航资本','中航产融大厦','VERIFIED_RENAME_SEED_SHORTENING',jsonb_build_array(jsonb_build_object('type','verified_seed','detail','中航资本大厦已通过正式更名链条验证指向中航产融大厦；本项仅省略“大厦”'))),
('凯德星贸中心','友邦金融中心','VERIFIED_FORMER_NAME_EXTENSION',jsonb_build_array(jsonb_build_object('type','verified_seed','detail','当前友邦金融中心former_names已验证包含凯德星贸；凯德星贸中心为同一旧项目名扩展'))),
('北京 IFC','国际财源中心（IFC）','VERIFIED_SEED_WHITESPACE_VARIANT',jsonb_build_array(jsonb_build_object('type','verified_seed','detail','已验证北京IFC指向国际财源中心（IFC）；北京 IFC仅空格差异'))),
('君康人寿','富泽人寿大厦','VERIFIED_RENAME_SEED_SHORTENING',jsonb_build_array(jsonb_build_object('type','verified_seed','detail','君康人寿大厦已通过更名+坐标证据验证为富泽人寿大厦；本项仅省略“大厦”'))),
('国航世纪','国航世纪大厦','VERIFIED_SEED_SUFFIX_REMOVAL',jsonb_build_array(jsonb_build_object('type','verified_seed','detail','当前国航世纪大厦former_names已验证包含国航世纪中心；历史简称仅省略通用尾缀'))),
('金长安中心','金长安大厦','VERIFIED_SEED_GENERIC_SUFFIX_VARIANT',jsonb_build_array(jsonb_build_object('type','verified_seed','detail','当前金长安大厦已验证别名金长安；金长安中心为通用楼宇尾缀变体且历史商圈一致')));

create temp table _v11_exact_resolved on commit drop as
select e.historical_name,b.id building_id,b.name current_name,e.basis,e.evidence
from _v11_exact e
join public.buildings b on b.name=e.current_name
join public.lease_building_alias_review r on r.historical_name=e.historical_name and r.resolution_status='NEEDS_REVIEW'
where (select count(*) from public.buildings bx where bx.name=e.current_name)=1;

delete from public.lease_building_project_map p using _v11_exact_resolved e
where p.market_code='BJ' and p.alias_name=e.historical_name;

with grouped as (
 select building_id,jsonb_agg(historical_name order by historical_name) aliases from _v11_exact_resolved group by building_id
), expanded as (
 select g.building_id,jsonb_agg(distinct value order by value) former_names
 from grouped g join public.buildings b on b.id=g.building_id
 cross join lateral (
   select x.value from jsonb_array_elements_text(case when jsonb_typeof(b.former_names)='array' then b.former_names else '[]'::jsonb end) x(value)
   union all select y.value from jsonb_array_elements_text(g.aliases) y(value)
 ) u
 where nullif(trim(value),'') is not null group by g.building_id
)
update public.buildings b set former_names=e.former_names from expanded e where b.id=e.building_id;

insert into public.lease_building_name_map(market_code,alias_name,building_id,match_method,verification_status)
select 'BJ',historical_name,building_id,'former_name','AUTO_VERIFIED' from _v11_exact_resolved
on conflict (market_code,alias_name) do update
set building_id=excluded.building_id,match_method='former_name',verification_status='AUTO_VERIFIED';

update public.lease_building_alias_review r
set resolution_status='AUTO_VERIFIED',matched_building_id=e.building_id,matched_building_name=e.current_name,
    resolution_basis=e.basis,confidence='ABSOLUTE',evidence_snapshot=e.evidence,
    review_notes=coalesce(r.review_notes||' | ','')||'v11 propagated verified identity seed',resolved_at=now(),updated_at=now()
from _v11_exact_resolved e where r.historical_name=e.historical_name;

with seed_map(alias_name,seed_name) as (
 values ('方正国际','方正国际大厦'),('天元港','天元港中心'),('新华科技','新华科技大厦')
), resolved as (
 select s.alias_name,seed.*
 from seed_map s
 join public.lease_building_alias_review seed on seed.historical_name=s.seed_name and seed.resolution_status='INVENTORY_GAP'
 join public.lease_building_alias_review target on target.historical_name=s.alias_name and target.resolution_status='NEEDS_REVIEW'
)
update public.lease_building_alias_review r
set resolution_status='INVENTORY_GAP',matched_building_id=null,matched_building_name=null,
    resolution_basis='INVENTORY_GAP_VERIFIED_SEED_SHORTENING',confidence='ABSOLUTE',
    evidence_snapshot=x.evidence_snapshot,
    external_canonical_name=x.external_canonical_name,external_address=x.external_address,
    external_lat=x.external_lat,external_lng=x.external_lng,
    review_notes=coalesce(r.review_notes||' | ','')||'v11 inherited verified inventory-gap identity through non-semantic shortening',
    resolved_at=now(),updated_at=now()
from resolved x where r.historical_name=x.alias_name;

commit;
