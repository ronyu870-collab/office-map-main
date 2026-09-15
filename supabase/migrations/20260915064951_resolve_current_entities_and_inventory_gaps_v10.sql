begin;

create temp table _v10_exact(
  historical_name text primary key,
  current_name text not null,
  basis text not null,
  evidence jsonb not null
) on commit drop;

insert into _v10_exact values
('PVG','北京侨福芳草地','ENGLISH_ACRONYM_PLUS_BROCHURE_NAME_AND_CONTEXT',jsonb_build_array(jsonb_build_object('type','brochure','detail','当前北京侨福芳草地楼书英文名为 Parkview Green；PVG 为其通用英文缩写'),jsonb_build_object('type','history_context','detail','历史PVG记录中已标商圈的记录均为CBD'))),
('侨福','北京侨福芳草地','UNIQUE_PROJECT_SHORTHAND_PLUS_CONTEXT',jsonb_build_array(jsonb_build_object('type','current_identity','detail','当前实体为北京侨福芳草地，former_names已包含侨福芳草地'),jsonb_build_object('type','history_context','detail','历史侨福记录中已标商圈均为CBD'))),
('数字山谷','尚东数字山谷','CURRENT_MAP_ALIAS_PLUS_TENANT_CORROBORATION',jsonb_build_array(jsonb_build_object('type','current_map','detail','当前地图以“数字山谷”检索直接返回海淀尚东数字山谷，地址东北旺西路8号院'),jsonb_build_object('type','tenant_corroboration','detail','历史数字山谷记录含福建网龙7000㎡；其北京地址与尚东数字山谷一致')));

create temp table _v10_exact_resolved on commit drop as
select e.historical_name,b.id building_id,b.name current_name,e.basis,e.evidence
from _v10_exact e
join public.buildings b on b.name=e.current_name
join public.lease_building_alias_review r on r.historical_name=e.historical_name
where (select count(*) from public.buildings bx where bx.name=e.current_name)=1;

delete from public.lease_building_project_map p using _v10_exact_resolved e
where p.market_code='BJ' and p.alias_name=e.historical_name;

with grouped as (
 select building_id,jsonb_agg(historical_name order by historical_name) aliases from _v10_exact_resolved group by building_id
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
select 'BJ',historical_name,building_id,'former_name','AUTO_VERIFIED' from _v10_exact_resolved
on conflict (market_code,alias_name) do update
set building_id=excluded.building_id,match_method='former_name',verification_status='AUTO_VERIFIED';

update public.lease_building_alias_review r
set resolution_status='AUTO_VERIFIED',matched_building_id=e.building_id,matched_building_name=e.current_name,
    resolution_basis=e.basis,confidence='ABSOLUTE',evidence_snapshot=e.evidence,
    review_notes=coalesce(r.review_notes||' | ','')||'v10 external/internal identity resolution',resolved_at=coalesce(r.resolved_at,now()),updated_at=now()
from _v10_exact_resolved e where r.historical_name=e.historical_name;

create temp table _v10_gap(
  historical_name text primary key,
  external_canonical_name text not null,
  external_address text,
  external_lat numeric,
  external_lng numeric,
  evidence jsonb not null
) on commit drop;

insert into _v10_gap values
('东方科技园','东方科技园','北京市朝阳区酒仙桥路52号',null,null,jsonb_build_array(jsonb_build_object('type','current_entity','detail','当前招商资料仍独立列示东方科技园，酒仙桥路52号，由4个独栋组成'),jsonb_build_object('type','address_disambiguation','detail','当前库存最近瀚海国际为酒仙桥路13号，是不同项目'))),
('通泰大厦','通泰大厦','北京市西城区金融大街33号',39.910727,116.358550,jsonb_build_array(jsonb_build_object('type','government_current_entity','detail','西城区政府2025楼宇清单独立列示通泰大厦，金融大街33号'),jsonb_build_object('type','address_disambiguation','detail','当前库存最近国际企业大厦为金融大街35号，非33号通泰大厦'))),
('方正国际大厦','方正国际大厦','北京市海淀区北四环西路52号',39.984620,116.313142,jsonb_build_array(jsonb_build_object('type','current_entity','detail','当前地图仍独立列示方正国际大厦，北四环西路52号'),jsonb_build_object('type','address_disambiguation','detail','近邻鼎好DH3官方地址为海淀大街3号；鸿城拓展为海淀北一街2号，均非方正国际大厦'))),
('新街高和','长城人寿大厦','北京市西城区新街口北大街3号',null,null,jsonb_build_array(jsonb_build_object('type','official_rename','detail','西城区2025登记事项明确：同一住所由“新街高和”变更表述为“长城人寿大厦”'),jsonb_build_object('type','inventory_check','detail','当前642栋canonical/former names均无长城人寿大厦承接实体'))),
('三里屯soho','三里屯SOHO','北京市朝阳区工人体育场北路8号',39.932257,116.453502,jsonb_build_array(jsonb_build_object('type','current_entity','detail','SOHO中国当前公开租售平台仍独立运营三里屯SOHO，地址工体北路8号'),jsonb_build_object('type','inventory_check','detail','当前642栋canonical/former names无三里屯SOHO承接实体'))),
('中海财富中心','北京中海财富中心','北京市西城区太平桥大街96号',null,null,jsonb_build_array(jsonb_build_object('type','government_current_entity','detail','西城区政府楼宇清单独立列示北京中海财富中心，太平桥大街96号'),jsonb_build_object('type','disambiguation','detail','当前库存金安中海财富中心位于石景山区，是不同项目；历史商圈为金融街')));

update public.lease_building_alias_review r
set resolution_status='INVENTORY_GAP',matched_building_id=null,matched_building_name=null,
    resolution_basis='EXTERNAL_CURRENT_ENTITY_CONFIRMED_NO_INVENTORY_CANONICAL_OR_ALIAS',confidence='ABSOLUTE',
    evidence_snapshot=g.evidence,external_canonical_name=g.external_canonical_name,external_address=g.external_address,
    external_lat=g.external_lat,external_lng=g.external_lng,
    review_notes=coalesce(r.review_notes||' | ','')||'v10 externally verified current inventory gap',
    resolved_at=coalesce(r.resolved_at,now()),updated_at=now()
from _v10_gap g where r.historical_name=g.historical_name;

commit;
