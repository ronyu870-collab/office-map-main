begin;

create temp table _v9_exact(
  historical_name text primary key,
  current_name text not null,
  basis text not null,
  evidence jsonb not null
) on commit drop;

insert into _v9_exact values
('WFC东塔','环球金融中心','VERIFIED_ACRONYM_PLUS_FORMER_TOWER_NAME',jsonb_build_array(jsonb_build_object('type','current_former_names','detail','环球金融中心former_names已同时包含WFC与环球金融中心东塔；历史WFC东塔商圈为CBD'))),
('LG双子座大厦','汇京双子座大厦','VERIFIED_FORMER_NAME_VARIANT',jsonb_build_array(jsonb_build_object('type','current_former_names','detail','汇京双子座大厦former_names已包含LG双子座、LG大厦、双子座大厦；历史LG双子座大厦全部为CBD'))),
('东亿国际传媒产业园','东亿文化科技产业园','SAME_SITE_LEGACY_FULL_NAME',jsonb_build_array(jsonb_build_object('type','existing_verified_aliases','detail','同一当前实体已验证承接东亿、东亿国际；东亿国际传媒产业园为其完整历史园区名'))),
('华贸1座','华贸中心 (一座、二座)','TOWER_TOKEN_TO_CURRENT_AGGREGATE',jsonb_build_array(jsonb_build_object('type','current_former_names','detail','同一当前实体已验证华贸中心1座/1号楼/T1等别名；华贸1座为同义缩写'))),
('远洋国际二期','远洋国际中心二期','PROJECT_NAME_SHORTENING',jsonb_build_array(jsonb_build_object('type','canonical_name','detail','当前实体为远洋国际中心二期，历史仅省略“中心”；历史商圈CBD一致'))),
('远洋二期','远洋国际中心二期','PROJECT_SHORTHAND_PLUS_HISTORY_CONTEXT',jsonb_build_array(jsonb_build_object('type','history_context','detail','远洋二期历史记录集中CBD，2015-2021连续出现；与远洋国际二期同一历史项目语境'),jsonb_build_object('type','current_entity','detail','当前库存存在远洋国际中心二期'))),
('锐中心','远洋锐中心','UNIQUE_SHORTHAND_PLUS_SUBMARKET',jsonb_build_array(jsonb_build_object('type','history_context','detail','锐中心4条历史记录全部为丽泽；当前丽泽库存存在唯一远洋锐中心'))),
('互联网创新中心','中关村软件园互联网创新中心','UNIQUE_SUFFIX_PLUS_SUBMARKET',jsonb_build_array(jsonb_build_object('type','history_context','detail','历史明确上地商圈；当前上地库存存在中关村软件园互联网创新中心')));

create temp table _v9_exact_resolved on commit drop as
select e.historical_name,b.id building_id,b.name current_name,e.basis,e.evidence
from _v9_exact e
join public.buildings b on b.name=e.current_name
join public.lease_building_alias_review r on r.historical_name=e.historical_name and r.resolution_status='NEEDS_REVIEW'
where (select count(*) from public.buildings bx where bx.name=e.current_name)=1;

delete from public.lease_building_project_map p using _v9_exact_resolved e
where p.market_code='BJ' and p.alias_name=e.historical_name;

with grouped as (
 select building_id,jsonb_agg(historical_name order by historical_name) aliases from _v9_exact_resolved group by building_id
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
select 'BJ',historical_name,building_id,'former_name','AUTO_VERIFIED' from _v9_exact_resolved
on conflict (market_code,alias_name) do update
set building_id=excluded.building_id,match_method='former_name',verification_status='AUTO_VERIFIED';

update public.lease_building_alias_review r
set resolution_status='AUTO_VERIFIED',matched_building_id=e.building_id,matched_building_name=e.current_name,
    resolution_basis=e.basis,confidence='ABSOLUTE',evidence_snapshot=e.evidence,
    review_notes=coalesce(r.review_notes||' | ','')||'v9 controlled internal alias resolution',resolved_at=now(),updated_at=now()
from _v9_exact_resolved e where r.historical_name=e.historical_name;

create temp table _v9_project(alias_name text not null,current_name text not null,basis text not null,evidence jsonb not null,primary key(alias_name,current_name)) on commit drop;
insert into _v9_project values
('东方广场W2','东方广场西区','WEST_ZONE_TOWER_MEMBERSHIP',jsonb_build_array(jsonb_build_object('type','zone_identity','detail','W2与已验证W1同属东方广场西区；当前库存按东/中/西区聚合，不伪造具体塔楼'))),
('凯德汇新','凯德汇新-塔楼(B座高区)','PROJECT_CANONICAL_GROUP',jsonb_build_array(jsonb_build_object('type','current_inventory','detail','当前凯德汇新拆为B座高区及A座/B座低区/C座两个库存实体'))),
('凯德汇新','凯德汇新(A座/B座低区/C座)','PROJECT_CANONICAL_GROUP',jsonb_build_array(jsonb_build_object('type','current_inventory','detail','当前凯德汇新拆为B座高区及A座/B座低区/C座两个库存实体'))),
('鼎好','鼎好DH3-A座','PROJECT_SHORTHAND_GROUP',jsonb_build_array(jsonb_build_object('type','existing_project_evidence','detail','鼎好大厦已验证为鼎好DH3项目；历史“鼎好”仅为项目简称'))),
('鼎好','鼎好DH3-B/C座','PROJECT_SHORTHAND_GROUP',jsonb_build_array(jsonb_build_object('type','existing_project_evidence','detail','鼎好大厦已验证为鼎好DH3项目；历史“鼎好”仅为项目简称'))),
('诺金','诺金低区-金尚丽','PROJECT_SHORTHAND_GROUP',jsonb_build_array(jsonb_build_object('type','existing_project_evidence','detail','诺金中心已验证为诺金项目组；“诺金”不推断具体办公分区'))),
('诺金','诺金写字楼','PROJECT_SHORTHAND_GROUP',jsonb_build_array(jsonb_build_object('type','existing_project_evidence','detail','诺金中心已验证为诺金项目组；“诺金”不推断具体办公分区'))),
('中汇广场B座','北京中汇广场','HISTORICAL_TOWER_TO_CURRENT_AGGREGATE',jsonb_build_array(jsonb_build_object('type','current_inventory','detail','当前库存仅保留北京中汇广场聚合实体，former_names已包含中汇/中汇广场；历史B座只关联项目范围')));

create temp table _v9_project_resolved on commit drop as
select p.alias_name,b.id building_id,p.basis,p.evidence
from _v9_project p join public.buildings b on b.name=p.current_name
join public.lease_building_alias_review r on r.historical_name=p.alias_name and r.resolution_status='NEEDS_REVIEW'
where not exists(select 1 from public.lease_building_name_map m where m.market_code='BJ' and m.alias_name=p.alias_name);

insert into public.lease_building_project_map(market_code,alias_name,building_id,match_method,verification_status)
select 'BJ',alias_name,building_id,basis,'AUTO_VERIFIED_PROJECT' from _v9_project_resolved
on conflict (market_code,alias_name,building_id) do update
set match_method=excluded.match_method,verification_status='AUTO_VERIFIED_PROJECT';

update public.lease_building_alias_review r
set resolution_status='AUTO_VERIFIED_PROJECT',matched_building_id=null,matched_building_name=null,
    resolution_basis=(select min(x.basis) from _v9_project_resolved x where x.alias_name=r.historical_name),
    confidence='ABSOLUTE',
    evidence_snapshot=(select jsonb_agg(distinct e) from _v9_project_resolved x cross join lateral jsonb_array_elements(x.evidence) e where x.alias_name=r.historical_name),
    review_notes=coalesce(r.review_notes||' | ','')||'v9 verified project scope; tower not inferred',resolved_at=now(),updated_at=now()
where r.resolution_status='NEEDS_REVIEW' and exists(select 1 from _v9_project_resolved x where x.alias_name=r.historical_name);

update public.lease_building_alias_review r
set resolution_status='INVENTORY_GAP',matched_building_id=null,matched_building_name=null,
    resolution_basis='INVENTORY_GAP_SEED_PARENTHESES_VARIANT',confidence='ABSOLUTE',
    evidence_snapshot=seed.evidence_snapshot,
    external_canonical_name=seed.external_canonical_name,external_address=seed.external_address,
    external_lat=seed.external_lat,external_lng=seed.external_lng,
    review_notes=coalesce(r.review_notes||' | ','')||'v9 inherited verified inventory gap through non-semantic parenthetical location annotation',
    resolved_at=now(),updated_at=now()
from public.lease_building_alias_review seed
where r.resolution_status='NEEDS_REVIEW'
  and seed.resolution_status='INVENTORY_GAP'
  and r.historical_name<>seed.historical_name
  and lower(regexp_replace(regexp_replace(trim(r.historical_name),'[（(][^（）()]+[）)]','','g'),'[[:space:]（）()·.，,\\-_/]','','g'))
      = lower(regexp_replace(regexp_replace(trim(seed.historical_name),'[（(][^（）()]+[）)]','','g'),'[[:space:]（）()·.，,\\-_/]','','g'));

commit;
