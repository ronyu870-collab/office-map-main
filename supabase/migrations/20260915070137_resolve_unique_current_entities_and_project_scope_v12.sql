begin;

create temp table _v12_exact(
  historical_name text primary key,
  current_name text not null,
  basis text not null,
  evidence jsonb not null
) on commit drop;

insert into _v12_exact values
('宝能','宝能中心','UNIQUE_SHORTHAND_PLUS_SUBMARKET',jsonb_build_array(jsonb_build_object('type','current_inventory','detail','当前望京-酒仙桥库存存在唯一宝能中心；历史宝能3条均为望京-酒仙桥'))),
('盘古大厦','钰珵大厦','VERIFIED_FORMER_PROJECT_NAME_VARIANT',jsonb_build_array(jsonb_build_object('type','current_former_names','detail','钰珵大厦former_names已包含盘古、盘古大观；历史盘古大厦3条均为亚奥'),jsonb_build_object('type','external_current_identity','detail','公开租赁资料明确盘古大观写字楼现称钰珵大厦'))),
('远洋国际中心一期A座','远洋国际中心A座','PHASE_TOKEN_TO_CURRENT_TOWER',jsonb_build_array(jsonb_build_object('type','current_identity','detail','当前库存唯一远洋国际中心A座位于东四环中路56号；一期A座为同一A座的历史阶段表述'))),
('金尚丽','诺金低区-金尚丽','CURRENT_CANONICAL_CONTAINS_HISTORY_UNIQUE',jsonb_build_array(jsonb_build_object('type','current_inventory','detail','当前库存唯一含“金尚丽”的实体为诺金低区-金尚丽；历史记录商圈均为望京-酒仙桥/酒仙桥'))),
('世东大厦','世东国际大厦','UNIQUE_ROOT_NAME_PLUS_SUBMARKET',jsonb_build_array(jsonb_build_object('type','current_identity','detail','当前CBD库存唯一世东实体为世东国际大厦；历史世东大厦3条均为CBD'),jsonb_build_object('type','external_current_entity','detail','当前公开地址持续使用世东国际大厦，广渠路18号院'))),
('远洋光华国际 C座','远洋光华国际ABC座-远洋自持','HISTORICAL_TOWER_TO_UNIQUE_CURRENT_AGGREGATE',jsonb_build_array(jsonb_build_object('type','current_inventory','detail','当前远洋光华国际库存中只有ABC座聚合实体包含C座；另一实体仅AB座，不存在C座竞争归属')));

create temp table _v12_exact_resolved on commit drop as
select e.historical_name,b.id building_id,b.name current_name,e.basis,e.evidence
from _v12_exact e
join public.buildings b on b.name=e.current_name
join public.lease_building_alias_review r on r.historical_name=e.historical_name and r.resolution_status='NEEDS_REVIEW'
where (select count(*) from public.buildings bx where bx.name=e.current_name)=1;

delete from public.lease_building_project_map p using _v12_exact_resolved e
where p.market_code='BJ' and p.alias_name=e.historical_name;

with grouped as (
 select building_id,jsonb_agg(historical_name order by historical_name) aliases from _v12_exact_resolved group by building_id
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
select 'BJ',historical_name,building_id,'former_name','AUTO_VERIFIED' from _v12_exact_resolved
on conflict (market_code,alias_name) do update
set building_id=excluded.building_id,match_method='former_name',verification_status='AUTO_VERIFIED';

update public.lease_building_alias_review r
set resolution_status='AUTO_VERIFIED',matched_building_id=e.building_id,matched_building_name=e.current_name,
    resolution_basis=e.basis,confidence='ABSOLUTE',evidence_snapshot=e.evidence,
    review_notes=coalesce(r.review_notes||' | ','')||'v12 unique current entity resolution',resolved_at=now(),updated_at=now()
from _v12_exact_resolved e where r.historical_name=e.historical_name;

create temp table _v12_project(alias_name text not null,current_name text not null,basis text not null,evidence jsonb not null,primary key(alias_name,current_name)) on commit drop;
insert into _v12_project values
('浦项中心B座','浦项中心','HISTORICAL_TOWER_TO_CURRENT_PROJECT_SCOPE',jsonb_build_array(jsonb_build_object('type','granularity','detail','当前库存仅有浦项中心聚合实体且已承接浦项/浦项中心A座；B座身份属于浦项项目，但不将其伪造为A座精确成交')));

create temp table _v12_project_resolved on commit drop as
select p.alias_name,b.id building_id,p.basis,p.evidence
from _v12_project p
join public.buildings b on b.name=p.current_name
join public.lease_building_alias_review r on r.historical_name=p.alias_name and r.resolution_status='NEEDS_REVIEW'
where not exists(select 1 from public.lease_building_name_map m where m.market_code='BJ' and m.alias_name=p.alias_name);

insert into public.lease_building_project_map(market_code,alias_name,building_id,match_method,verification_status)
select 'BJ',alias_name,building_id,basis,'AUTO_VERIFIED_PROJECT' from _v12_project_resolved
on conflict (market_code,alias_name,building_id) do update
set match_method=excluded.match_method,verification_status='AUTO_VERIFIED_PROJECT';

update public.lease_building_alias_review r
set resolution_status='AUTO_VERIFIED_PROJECT',matched_building_id=null,matched_building_name=null,
    resolution_basis=(select min(x.basis) from _v12_project_resolved x where x.alias_name=r.historical_name),
    confidence='ABSOLUTE',
    evidence_snapshot=(select jsonb_agg(distinct e) from _v12_project_resolved x cross join lateral jsonb_array_elements(x.evidence) e where x.alias_name=r.historical_name),
    review_notes=coalesce(r.review_notes||' | ','')||'v12 verified project scope; tower not inferred',resolved_at=now(),updated_at=now()
where r.resolution_status='NEEDS_REVIEW' and exists(select 1 from _v12_project_resolved x where x.alias_name=r.historical_name);

commit;
