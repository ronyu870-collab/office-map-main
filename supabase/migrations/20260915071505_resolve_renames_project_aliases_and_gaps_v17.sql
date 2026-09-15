begin;

with target as (
  select r.historical_name,b.id building_id,b.name current_name
  from public.lease_building_alias_review r
  join public.buildings b on b.name='横琴人寿大厦'
  where r.historical_name='海航实业大厦' and r.resolution_status='NEEDS_REVIEW'
)
insert into public.lease_building_name_map(market_code,alias_name,building_id,match_method,verification_status)
select 'BJ',historical_name,building_id,'former_name','AUTO_VERIFIED' from target
on conflict (market_code,alias_name) do update set building_id=excluded.building_id,match_method=excluded.match_method,verification_status=excluded.verification_status;

with target as (
  select r.historical_name,b.id building_id,b.name current_name
  from public.lease_building_alias_review r join public.buildings b on b.name='横琴人寿大厦'
  where r.historical_name='海航实业大厦' and r.resolution_status='NEEDS_REVIEW'
)
update public.lease_building_alias_review r
set resolution_status='AUTO_VERIFIED',matched_building_id=t.building_id,matched_building_name=t.current_name,
    resolution_basis='EXTERNAL_RENAME_SAME_ADDRESS_AND_TENANT_EVIDENCE',confidence='ABSOLUTE',
    evidence_snapshot=jsonb_build_array(
      jsonb_build_object('type','same_address','detail','历史海航实业大厦与现横琴人寿大厦均位于北京市朝阳区建国路108号'),
      jsonb_build_object('type','tenant_corroboration','detail','氪空间历史页面同时以“海航实业大厦社区”和“横琴人寿大厦社区”描述建国路108号同一办公点'),
      jsonb_build_object('type','current_inventory','detail','当前642栋库存存在唯一横琴人寿大厦，CBD商圈')
    ),
    review_notes=coalesce(r.review_notes||' | ','')||'v17 verified rename/same-address identity',resolved_at=now(),updated_at=now()
from target t where r.historical_name=t.historical_name;

update public.buildings b
set former_names=(select jsonb_agg(distinct v order by v) from (
  select x.value v from jsonb_array_elements_text(case when jsonb_typeof(b.former_names)='array' then b.former_names else '[]'::jsonb end) x
  union all select '海航实业大厦'
) s where nullif(trim(v),'') is not null)
where b.name='横琴人寿大厦';

insert into public.lease_building_project_map(market_code,alias_name,building_id,match_method,verification_status)
select 'BJ','环贸中心',p.building_id,'VERIFIED_PROJECT_ALIAS_OF_环球贸易中心','AUTO_VERIFIED_PROJECT'
from public.lease_building_project_map p
where p.market_code='BJ' and p.alias_name='环球贸易中心'
on conflict (market_code,alias_name,building_id) do update set match_method=excluded.match_method,verification_status=excluded.verification_status;

insert into public.lease_building_project_map(market_code,alias_name,building_id,match_method,verification_status)
select 'BJ','光华国际中心',p.building_id,'VERIFIED_PROJECT_ALIAS_OF_远洋光华国际','AUTO_VERIFIED_PROJECT'
from public.lease_building_project_map p
where p.market_code='BJ' and p.alias_name='远洋光华国际'
on conflict (market_code,alias_name,building_id) do update set match_method=excluded.match_method,verification_status=excluded.verification_status;

insert into public.lease_building_project_map(market_code,alias_name,building_id,match_method,verification_status)
select 'BJ',a.alias_name,b.id,'FINANCIAL_STREET_YUETAN_PROJECT_TO_AVAILABLE_MEMBER','AUTO_VERIFIED_PROJECT'
from (values ('月坛中心'),('金融街月坛中心')) a(alias_name)
join public.buildings b on b.name='月坛金融中心E座'
on conflict (market_code,alias_name,building_id) do update set match_method=excluded.match_method,verification_status=excluded.verification_status;

update public.lease_building_alias_review r
set resolution_status='AUTO_VERIFIED_PROJECT',matched_building_id=null,matched_building_name=null,
    resolution_basis=case
      when historical_name='环贸中心' then 'VERIFIED_PROJECT_ALIAS_OF_环球贸易中心'
      when historical_name='光华国际中心' then 'VERIFIED_PROJECT_ALIAS_OF_远洋光华国际'
      else 'FINANCIAL_STREET_YUETAN_PROJECT_TO_AVAILABLE_MEMBER'
    end,
    confidence='ABSOLUTE',
    evidence_snapshot=case
      when historical_name='环贸中心' then jsonb_build_array(jsonb_build_object('type','external_alias','detail','公开租赁资料直接使用“北京环球贸易中心（环贸中心）”；复用已验证环球贸易中心项目成员，不推断具体塔楼'))
      when historical_name='光华国际中心' then jsonb_build_array(jsonb_build_object('type','external_project_name','detail','公开租赁市场持续使用“远洋光华国际中心”；历史记录均为CBD/未标商圈，复用已验证远洋光华国际项目成员，不推断AB/C具体座'))
      else jsonb_build_array(jsonb_build_object('type','external_project_name','detail','金融街(月坛)中心当前地址为月坛南街1号；当前库存仅有项目成员月坛金融中心E座，因此仅建立project scope，不将历史成交伪造为E座精确成交'))
    end,
    review_notes=coalesce(r.review_notes||' | ','')||'v17 verified project alias; tower attribution intentionally withheld',resolved_at=now(),updated_at=now()
where r.historical_name in ('环贸中心','光华国际中心','月坛中心','金融街月坛中心') and r.resolution_status='NEEDS_REVIEW';

create temp table _v17_gap(historical_name text primary key,external_canonical_name text not null,external_address text,external_lat numeric,external_lng numeric,evidence jsonb not null) on commit drop;
insert into _v17_gap values
('国华投资大厦','国华投资大厦','北京市东城区东直门南大街3号',39.939081,116.432428,jsonb_build_array(
  jsonb_build_object('type','current_entity','detail','当前地图及2026租赁资料仍独立列示国华投资大厦，东直门南大街3号'),
  jsonb_build_object('type','current_company_address','detail','国华投资相关国企公开招聘/单位地址仍使用国华投资大厦'),
  jsonb_build_object('type','inventory_check','detail','当前642栋canonical/former names无国华投资大厦承接实体')
)),
('新兴产业联盟大厦','中关村新兴产业联盟大厦','北京市海淀区西北旺东路10号院10号楼',null,null,jsonb_build_array(
  jsonb_build_object('type','current_entity','detail','当前多家企业官网及租赁资料持续使用中关村新兴产业联盟大厦，西北旺东路10号院10号楼'),
  jsonb_build_object('type','inventory_check','detail','当前642栋canonical/former names无新兴产业联盟大厦承接实体')
)),
('新兴产业联盟发展大厦','中关村新兴产业联盟大厦','北京市海淀区西北旺东路10号院10号楼',null,null,jsonb_build_array(
  jsonb_build_object('type','historical_variant','detail','“新兴产业联盟发展大厦”与持续使用的“中关村新兴产业联盟大厦”共享同一历史项目主体；历史两种名称集中于2016-2017'),
  jsonb_build_object('type','inventory_check','detail','当前642栋canonical/former names无该项目承接实体')
)),
('世茂大厦','北京世茂大厦','北京市朝阳区建国路甲92号',null,null,jsonb_build_array(
  jsonb_build_object('type','developer_current_entity','detail','世茂集团当前项目页明确北京世茂大厦地址为建国路甲92号'),
  jsonb_build_object('type','tenant_corroboration','detail','爱美客当前官网及2026招聘仍使用建国路甲92号世茂大厦C座办公地址'),
  jsonb_build_object('type','inventory_check','detail','当前642栋canonical/former names无世茂大厦承接实体')
)),
('世贸大厦','北京世茂大厦','北京市朝阳区建国路甲92号',null,null,jsonb_build_array(
  jsonb_build_object('type','historical_typo_corroboration','detail','历史“世贸大厦”2019记录租户爱美客，爱美客正式披露办公地址实际为建国路甲92号世茂大厦；2022Q3华西证券在“世贸大厦”和“世茂大厦”历史记录中重复出现'),
  jsonb_build_object('type','inventory_check','detail','按已证实的“世茂大厦”实体处理为库存缺口，不误映射到世贸天阶或中环世贸中心')
)),
('国际财经中心','国际财经中心','北京市海淀区西三环北路87号',39.935505,116.309139,jsonb_build_array(
  jsonb_build_object('type','current_entity','detail','当前地图仍独立列示国际财经中心，西三环北路87号'),
  jsonb_build_object('type','tenant_corroboration','detail','历史租户千石创富的法律/通讯地址及国金基金当前办公地址均明确为国际财经中心，而非国际财源中心IFC'),
  jsonb_build_object('type','inventory_check','detail','当前642栋canonical/former names无国际财经中心承接实体')
));

update public.lease_building_alias_review r
set resolution_status='INVENTORY_GAP',matched_building_id=null,matched_building_name=null,
    resolution_basis='EXTERNAL_CURRENT_ENTITY_CONFIRMED_NO_INVENTORY_CANONICAL_OR_ALIAS',confidence='ABSOLUTE',
    evidence_snapshot=g.evidence,external_canonical_name=g.external_canonical_name,external_address=g.external_address,external_lat=g.external_lat,external_lng=g.external_lng,
    review_notes=coalesce(r.review_notes||' | ','')||'v17 verified external current entity/inventory gap',resolved_at=now(),updated_at=now()
from _v17_gap g where r.historical_name=g.historical_name and r.resolution_status='NEEDS_REVIEW';

commit;
