begin;

create temp table _v15_exact(historical_name text primary key,current_name text not null,basis text not null,evidence jsonb not null) on commit drop;
insert into _v15_exact values
('新东安写字楼','新东安大厦','CURRENT_FORMER_NAME_PLUS_GENERIC_SUFFIX',jsonb_build_array(jsonb_build_object('type','current_former_names','detail','当前新东安大厦former_names已包含“新东安”；历史仅以“写字楼”描述同一项目'))),
('清华科技园D座','清华科技园创新大厦','UNIQUE_TOWER_ALIAS_EXPANSION',jsonb_build_array(jsonb_build_object('type','current_former_names','detail','清华科技园创新大厦former_names明确包含“清华科技园创新大厦D座”；历史清华科技园D座商圈为中关村'))),
('益园','益园文化创意产业基地','UNIQUE_PROJECT_SHORTHAND',jsonb_build_array(jsonb_build_object('type','current_inventory','detail','当前库存唯一“益园”实体为益园文化创意产业基地'))),
('蓟门壹号','保利蓟门壹号','UNIQUE_BRAND_PREFIX_EXPANSION',jsonb_build_array(jsonb_build_object('type','current_inventory','detail','当前库存唯一包含蓟门壹号的实体为保利蓟门壹号'))),
('IFC A座','国际财源中心（IFC）','HISTORICAL_TOWER_TO_SINGLE_CURRENT_AGGREGATE',jsonb_build_array(jsonb_build_object('type','verified_seed','detail','当前唯一IFC实体已承接IFC/北京IFC等历史别名；A座不存在竞争承接实体'))),
('万科时代中心','万科时代中心.望京','UNIQUE_SUBMARKET_DISAMBIGUATION',jsonb_build_array(jsonb_build_object('type','submarket_context','detail','历史万科时代中心2条均为望京-酒仙桥；当前同名系列中望京实体与该商圈唯一一致'))),
('东枫德必','东枫德必WE人工智能创新基地','UNIQUE_CANONICAL_EXPANSION',jsonb_build_array(jsonb_build_object('type','current_inventory','detail','当前库存唯一东枫德必实体为东枫德必WE人工智能创新基地'))),
('丽泽平安幸福中心 A座','平安幸福中心','VERIFIED_FORMER_NAME_COMPOSITION',jsonb_build_array(jsonb_build_object('type','current_former_names','detail','平安幸福中心former_names同时包含丽泽平安幸福中心与平安幸福中心A座；历史商圈为丽泽'))),
('丽金智地西塔','丽金智地中心西塔','UNIQUE_NAME_EXTENSION_PLUS_SUBMARKET',jsonb_build_array(jsonb_build_object('type','current_inventory','detail','当前中关村库存存在唯一丽金智地中心西塔；历史明确为西塔'))),
('中海广场主塔','中海广场','HISTORICAL_TOWER_TO_SINGLE_CURRENT_AGGREGATE',jsonb_build_array(jsonb_build_object('type','current_inventory','detail','当前CBD库存仅保留中海广场聚合实体，已承接中楼/南塔/西塔等历史别名；主塔不推断到其他项目'))),
('佳兆业北塔','佳兆业广场北塔','UNIQUE_NAME_EXTENSION',jsonb_build_array(jsonb_build_object('type','current_inventory','detail','当前库存唯一佳兆业北塔实体为佳兆业广场北塔'))),
('佳程','佳程广场','UNIQUE_PROJECT_SHORTHAND',jsonb_build_array(jsonb_build_object('type','current_inventory','detail','当前库存唯一佳程办公项目为佳程广场，且已承接A/B座别名'))),
('侨福芳草地A座','北京侨福芳草地','HISTORICAL_TOWER_TO_SINGLE_CURRENT_AGGREGATE',jsonb_build_array(jsonb_build_object('type','verified_seed','detail','北京侨福芳草地已验证承接侨福芳草地/PVG/侨福；当前无独立A座实体'))),
('保利国际广场T1','保利国际广场1座','TOWER_TOKEN_CANONICALIZATION',jsonb_build_array(jsonb_build_object('type','current_inventory','detail','当前库存保利国际广场1座与T1为同一塔楼编号表达'))),
('兆泰国际中心A座','兆泰国际中心（AB座）','HISTORICAL_TOWER_TO_UNIQUE_CURRENT_AGGREGATE',jsonb_build_array(jsonb_build_object('type','current_inventory','detail','当前兆泰国际中心拆为AB座与CDE座；历史A座只能落入AB座聚合实体'))),
('凯晨','凯晨世贸中心','UNIQUE_PROJECT_SHORTHAND_PLUS_SUBMARKET',jsonb_build_array(jsonb_build_object('type','current_inventory','detail','历史凯晨商圈为金融街；当前金融街唯一凯晨实体为凯晨世贸中心')));

create temp table _v15_exact_resolved on commit drop as
select e.historical_name,b.id building_id,b.name current_name,e.basis,e.evidence from _v15_exact e join public.buildings b on b.name=e.current_name join public.lease_building_alias_review r on r.historical_name=e.historical_name and r.resolution_status='NEEDS_REVIEW' where (select count(*) from public.buildings bx where bx.name=e.current_name)=1;

delete from public.lease_building_project_map p using _v15_exact_resolved e where p.market_code='BJ' and p.alias_name=e.historical_name;

with grouped as (select building_id,jsonb_agg(historical_name order by historical_name) aliases from _v15_exact_resolved group by building_id), expanded as (
 select g.building_id,jsonb_agg(distinct value order by value) former_names from grouped g join public.buildings b on b.id=g.building_id cross join lateral (
 select x.value from jsonb_array_elements_text(case when jsonb_typeof(b.former_names)='array' then b.former_names else '[]'::jsonb end) x(value)
 union all select y.value from jsonb_array_elements_text(g.aliases) y(value)) u where nullif(trim(value),'') is not null group by g.building_id)
update public.buildings b set former_names=e.former_names from expanded e where b.id=e.building_id;

insert into public.lease_building_name_map(market_code,alias_name,building_id,match_method,verification_status)
select 'BJ',historical_name,building_id,'former_name','AUTO_VERIFIED' from _v15_exact_resolved
on conflict (market_code,alias_name) do update set building_id=excluded.building_id,match_method='former_name',verification_status='AUTO_VERIFIED';

update public.lease_building_alias_review r set resolution_status='AUTO_VERIFIED',matched_building_id=e.building_id,matched_building_name=e.current_name,resolution_basis=e.basis,confidence='ABSOLUTE',evidence_snapshot=e.evidence,review_notes=coalesce(r.review_notes||' | ','')||'v15 deterministic long-tail alias resolution',resolved_at=now(),updated_at=now() from _v15_exact_resolved e where r.historical_name=e.historical_name;

create temp table _v15_project(alias_name text not null,current_name text not null,basis text not null,evidence jsonb not null,primary key(alias_name,current_name)) on commit drop;
insert into _v15_project values
('东方广场E3','东方广场东区','EAST_ZONE_TOWER_MEMBERSHIP',jsonb_build_array(jsonb_build_object('type','zone_identity','detail','东方广场E3属于东方广场东区；当前库存按东/中/西区聚合，不伪造具体E3塔楼'))),
('亚洲金融中心','亚洲金融大厦CDE座','PROJECT_NAME_TO_AVAILABLE_CURRENT_ENTITY',jsonb_build_array(jsonb_build_object('type','granularity','detail','历史亚洲金融中心为亚奥项目级名称；当前库存仅有亚洲金融大厦CDE座承接该项目，不将历史记录伪造到具体C/D/E座'))),
('保利国际','保利国际广场1座','PROJECT_SHORTHAND_TO_AVAILABLE_MEMBER',jsonb_build_array(jsonb_build_object('type','granularity','detail','历史保利国际为项目级简称；当前库存仅有保利国际广场1座，故仅建立项目范围关联')));

create temp table _v15_project_resolved on commit drop as
select p.alias_name,b.id building_id,p.basis,p.evidence from _v15_project p join public.buildings b on b.name=p.current_name join public.lease_building_alias_review r on r.historical_name=p.alias_name and r.resolution_status='NEEDS_REVIEW' where not exists(select 1 from public.lease_building_name_map m where m.market_code='BJ' and m.alias_name=p.alias_name);

insert into public.lease_building_project_map(market_code,alias_name,building_id,match_method,verification_status)
select 'BJ',alias_name,building_id,basis,'AUTO_VERIFIED_PROJECT' from _v15_project_resolved on conflict (market_code,alias_name,building_id) do update set match_method=excluded.match_method,verification_status='AUTO_VERIFIED_PROJECT';

update public.lease_building_alias_review r set resolution_status='AUTO_VERIFIED_PROJECT',matched_building_id=null,matched_building_name=null,resolution_basis=(select min(x.basis) from _v15_project_resolved x where x.alias_name=r.historical_name),confidence='ABSOLUTE',evidence_snapshot=(select jsonb_agg(distinct e) from _v15_project_resolved x cross join lateral jsonb_array_elements(x.evidence) e where x.alias_name=r.historical_name),review_notes=coalesce(r.review_notes||' | ','')||'v15 verified project scope; tower not inferred',resolved_at=now(),updated_at=now() where r.resolution_status='NEEDS_REVIEW' and exists(select 1 from _v15_project_resolved x where x.alias_name=r.historical_name);

commit;
