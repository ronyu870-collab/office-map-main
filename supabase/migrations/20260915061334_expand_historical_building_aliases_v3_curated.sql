begin;

create temp table _v3_exact_aliases (
  historical_name text primary key,
  current_name text not null,
  basis text not null
) on commit drop;

insert into _v3_exact_aliases(historical_name,current_name,basis) values
('恒通商务园','恒通国际商务园','EXTERNAL_CORROBORATED_ALIAS'),
('UBP','恒通国际商务园','EXTERNAL_CORROBORATED_ALIAS'),
('WFC','环球金融中心','EXTERNAL_CORROBORATED_ALIAS'),
('WFC西塔','环球金融中心','EXTERNAL_PLUS_FORMER_NAME'),
('诚盈中心','望京诚盈中心','EXTERNAL_CORROBORATED_ALIAS'),
('21世纪大厦','二十一世纪大厦','NUMERAL_NORMALIZATION'),
('英蓝国际','英蓝国际金融中心','UNIQUE_PROJECT_SHORTHAND'),
('英蓝国际中心','英蓝国际金融中心','UNIQUE_PROJECT_SHORTHAND'),
('英蓝','英蓝国际金融中心','UNIQUE_PROJECT_SHORTHAND'),
('启皓中心','启皓北京','EXTERNAL_CORROBORATED_ALIAS'),
('启皓','启皓北京','UNIQUE_PROJECT_SHORTHAND'),
('LG双子座','汇京双子座大厦','EXTERNAL_FORMER_NAME'),
('LG大厦','汇京双子座大厦','EXTERNAL_FORMER_NAME'),
('北京IFC','国际财源中心（IFC）','EXTERNAL_CORROBORATED_ALIAS'),
('财源国际中心','国际财源中心（IFC）','EXTERNAL_CORROBORATED_ALIAS'),
('财源国际','国际财源中心（IFC）','UNIQUE_PROJECT_SHORTHAND'),
('平安IFC','平安国际金融中心','BRAND_ACRONYM_PLUS_CONTEXT'),
('银泰','银泰中心','UNIQUE_PROJECT_SHORTHAND'),
('浦项','浦项中心','UNIQUE_PROJECT_SHORTHAND'),
('汉威国际广场','汉威国际','UNIQUE_NAME_EQUIVALENCE'),
('望京SOHO T3','望京SOHO塔3','TOWER_TOKEN_NORMALIZATION'),
('望京soho T3','望京SOHO塔3','TOWER_TOKEN_NORMALIZATION'),
('望京SohoT3','望京SOHO塔3','TOWER_TOKEN_NORMALIZATION'),
('望京SOHOT3','望京SOHO塔3','TOWER_TOKEN_NORMALIZATION'),
('望京SOHO T 3','望京SOHO塔3','TOWER_TOKEN_NORMALIZATION'),
('望京sohoT3','望京SOHO塔3','TOWER_TOKEN_NORMALIZATION'),
('望京SOHO3号楼','望京SOHO塔3','TOWER_TOKEN_NORMALIZATION'),
('光华路SOHO二期','光华路SOHOII','PHASE_TOKEN_NORMALIZATION'),
('光华路SOHO2期','光华路SOHOII','PHASE_TOKEN_NORMALIZATION'),
('光华路soho2期','光华路SOHOII','PHASE_TOKEN_NORMALIZATION'),
('光华路SOHO2','光华路SOHOII','PHASE_TOKEN_NORMALIZATION'),
('光华路soho二期','光华路SOHOII','PHASE_TOKEN_NORMALIZATION'),
('光华路Soho 2期','光华路SOHOII','PHASE_TOKEN_NORMALIZATION'),
('光华路SOHO 二期','光华路SOHOII','PHASE_TOKEN_NORMALIZATION'),
('光华路SOHO２','光华路SOHOII','PHASE_TOKEN_NORMALIZATION'),
('华贸中心2座','华贸中心 (一座、二座)','TOWER_TOKEN_NORMALIZATION'),
('华贸中心2号楼','华贸中心 (一座、二座)','TOWER_TOKEN_NORMALIZATION'),
('华贸中心 2号楼','华贸中心 (一座、二座)','TOWER_TOKEN_NORMALIZATION'),
('华贸中心T2','华贸中心 (一座、二座)','TOWER_TOKEN_NORMALIZATION'),
('华贸中心1号楼','华贸中心 (一座、二座)','TOWER_TOKEN_NORMALIZATION'),
('华贸中心1座','华贸中心 (一座、二座)','TOWER_TOKEN_NORMALIZATION'),
('华贸中心塔1','华贸中心 (一座、二座)','TOWER_TOKEN_NORMALIZATION'),
('华贸中心 塔一','华贸中心 (一座、二座)','TOWER_TOKEN_NORMALIZATION'),
('华贸中心T1','华贸中心 (一座、二座)','TOWER_TOKEN_NORMALIZATION'),
('华贸中心3号楼','华贸中心三座','TOWER_TOKEN_NORMALIZATION'),
('华贸中心T3','华贸中心三座','TOWER_TOKEN_NORMALIZATION'),
('华贸中心3座','华贸中心三座','TOWER_TOKEN_NORMALIZATION'),
('国贸1座','国贸写字楼1座','TOWER_TOKEN_NORMALIZATION'),
('国贸1','国贸写字楼1座','TOWER_TOKEN_NORMALIZATION'),
('国贸一座','国贸写字楼1座','TOWER_TOKEN_NORMALIZATION'),
('国贸 1座','国贸写字楼1座','TOWER_TOKEN_NORMALIZATION'),
('国贸写字楼一座','国贸写字楼1座','TOWER_TOKEN_NORMALIZATION'),
('国贸2','国贸写字楼2座','TOWER_TOKEN_NORMALIZATION'),
('国贸2座','国贸写字楼2座','TOWER_TOKEN_NORMALIZATION'),
('国贸二','国贸写字楼2座','TOWER_TOKEN_NORMALIZATION'),
('国贸二座','国贸写字楼2座','TOWER_TOKEN_NORMALIZATION'),
('国贸中心II座','国贸写字楼2座','TOWER_TOKEN_NORMALIZATION'),
('国贸中心二座','国贸写字楼2座','TOWER_TOKEN_NORMALIZATION'),
('国贸写字楼２座','国贸写字楼2座','TOWER_TOKEN_NORMALIZATION'),
('国贸三期A座','国贸大厦A座(三期)','PHASE_TOWER_NORMALIZATION'),
('国贸3A','国贸大厦A座(三期)','PHASE_TOWER_NORMALIZATION'),
('国贸三期A','国贸大厦A座(三期)','PHASE_TOWER_NORMALIZATION'),
('国贸三期A座33F','国贸大厦A座(三期)','PHASE_TOWER_NORMALIZATION'),
('国贸写字楼三期 A座','国贸大厦A座(三期)','PHASE_TOWER_NORMALIZATION'),
('国贸三期B座','国贸大厦B座(三期)','PHASE_TOWER_NORMALIZATION'),
('国贸3B','国贸大厦B座(三期)','PHASE_TOWER_NORMALIZATION'),
('国贸三期B','国贸大厦B座(三期)','PHASE_TOWER_NORMALIZATION'),
('国贸3期B座','国贸大厦B座(三期)','PHASE_TOWER_NORMALIZATION'),
('国贸三B','国贸大厦B座(三期)','PHASE_TOWER_NORMALIZATION');

create temp table _v3_exact_resolved on commit drop as
select e.historical_name,b.id building_id,b.name current_name,e.basis
from _v3_exact_aliases e
join public.buildings b on b.name=e.current_name
join public.lease_building_alias_review r on r.historical_name=e.historical_name and r.resolution_status='NEEDS_REVIEW'
where (select count(*) from public.buildings bx where bx.name=e.current_name)=1;

delete from public.lease_building_project_map p
using _v3_exact_resolved e
where p.market_code='BJ' and p.alias_name=e.historical_name;

with grouped as (
  select building_id,jsonb_agg(historical_name order by historical_name) aliases
  from _v3_exact_resolved group by building_id
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
from _v3_exact_resolved
on conflict (market_code,alias_name) do update
set building_id=excluded.building_id,match_method='former_name',verification_status='AUTO_VERIFIED';

update public.lease_building_alias_review r
set resolution_status='AUTO_VERIFIED',
    matched_building_id=e.building_id,
    matched_building_name=e.current_name,
    resolution_basis=e.basis,
    confidence='ABSOLUTE',
    review_notes=coalesce(r.review_notes || ' | ','') || 'v3 curated multi-source identity',
    resolved_at=now(),updated_at=now()
from _v3_exact_resolved e
where r.historical_name=e.historical_name;

create temp table _v3_project_members (
  alias_name text not null,
  current_name text not null,
  basis text not null,
  primary key(alias_name,current_name)
) on commit drop;

insert into _v3_project_members(alias_name,current_name,basis) values
('望京SOHO','望京SOHO塔3','PROJECT_NAME_TO_AVAILABLE_MEMBER'),
('望京soho','望京SOHO塔3','PROJECT_NAME_TO_AVAILABLE_MEMBER'),
('望京Soho','望京SOHO塔3','PROJECT_NAME_TO_AVAILABLE_MEMBER'),
('保利国际广场','保利国际广场1座','PROJECT_NAME_TO_AVAILABLE_MEMBER'),
('盈科中心','盈科中心（AB座）','PROJECT_PREFIX_GROUP'),
('盈科中心','盈科中心C座','PROJECT_PREFIX_GROUP'),
('西环广场','西环广场 T1','PROJECT_PREFIX_GROUP'),
('西环广场','西环广场 T3','PROJECT_PREFIX_GROUP'),
('万通中心','万通中心D座','PROJECT_NAME_TO_AVAILABLE_MEMBER'),
('凤凰置地','凤凰置地广场A座','PROJECT_SHORTHAND_GROUP'),
('凤凰置地','凤凰置地广场F&H座','PROJECT_SHORTHAND_GROUP'),
('博瑞大厦','博瑞大厦二期','PROJECT_NAME_TO_AVAILABLE_MEMBER'),
('哈德门广场','哈德门广场东塔','PROJECT_PREFIX_GROUP'),
('哈德门广场','哈德门广场西塔','PROJECT_PREFIX_GROUP'),
('诺金中心','诺金低区-金尚丽','EXTERNAL_PROJECT_GROUP'),
('诺金中心','诺金写字楼','EXTERNAL_PROJECT_GROUP'),
('光华路SOHO','光华路SOHOII','PROJECT_NAME_TO_AVAILABLE_MEMBER'),
('光华路soho','光华路SOHOII','PROJECT_NAME_TO_AVAILABLE_MEMBER'),
('光华路Soho','光华路SOHOII','PROJECT_NAME_TO_AVAILABLE_MEMBER'),
('CCP','华贸中心 (一座、二座)','EXTERNAL_PROJECT_ABBREVIATION'),
('CCP','华贸中心三座','EXTERNAL_PROJECT_ABBREVIATION'),
('华贸','华贸中心 (一座、二座)','PROJECT_SHORTHAND_GROUP'),
('华贸','华贸中心三座','PROJECT_SHORTHAND_GROUP'),
('北京华贸中心','华贸中心 (一座、二座)','PROJECT_PREFIX_GROUP'),
('北京华贸中心','华贸中心三座','PROJECT_PREFIX_GROUP'),
('GTC','环球贸易中心A、B座','EXTERNAL_PROJECT_ABBREVIATION'),
('GTC','环球贸易中心C、D座','EXTERNAL_PROJECT_ABBREVIATION'),
('GTC','环球贸易中心E座','EXTERNAL_PROJECT_ABBREVIATION'),
('GTC','环球贸易中心F座','EXTERNAL_PROJECT_ABBREVIATION'),
('环球贸易','环球贸易中心A、B座','PROJECT_SHORTHAND_GROUP'),
('环球贸易','环球贸易中心C、D座','PROJECT_SHORTHAND_GROUP'),
('环球贸易','环球贸易中心E座','PROJECT_SHORTHAND_GROUP'),
('环球贸易','环球贸易中心F座','PROJECT_SHORTHAND_GROUP'),
('远洋光华','远洋光华国际AB座-纺织厂','PROJECT_SHORTHAND_GROUP'),
('远洋光华','远洋光华国际ABC座-远洋自持','PROJECT_SHORTHAND_GROUP'),
('国贸三期','国贸大厦A座(三期)','PHASE_PROJECT_GROUP'),
('国贸三期','国贸大厦B座(三期)','PHASE_PROJECT_GROUP'),
('国贸3期','国贸大厦A座(三期)','PHASE_PROJECT_GROUP'),
('国贸3期','国贸大厦B座(三期)','PHASE_PROJECT_GROUP'),
('国贸3','国贸大厦A座(三期)','PHASE_PROJECT_GROUP'),
('国贸3','国贸大厦B座(三期)','PHASE_PROJECT_GROUP'),
('国贸三','国贸大厦A座(三期)','PHASE_PROJECT_GROUP'),
('国贸三','国贸大厦B座(三期)','PHASE_PROJECT_GROUP'),
('佳兆业广场','佳兆业广场北塔','PROJECT_NAME_TO_AVAILABLE_MEMBER'),
('亚洲金融大厦','亚洲金融大厦CDE座','PROJECT_NAME_TO_AVAILABLE_MEMBER'),
('中环世贸','中环世贸中心D座','PROJECT_NAME_TO_AVAILABLE_MEMBER'),
('航宇大厦','航宇大厦B座','PROJECT_NAME_TO_AVAILABLE_MEMBER'),
('长安兴融中心','长安兴融中心-4号楼','PROJECT_NAME_TO_AVAILABLE_MEMBER'),
('世纪财富','世纪财富中心西塔','PROJECT_SHORTHAND_TO_AVAILABLE_MEMBER'),
('中关村软件园','中关村软件园-甲骨文大厦','CAMPUS_PROJECT_GROUP'),
('中关村软件园','中关村软件园互联网创新中心','CAMPUS_PROJECT_GROUP'),
('中关村软件园','中关村软件园信息中心','CAMPUS_PROJECT_GROUP'),
('中关村软件园','中关村软件园孵化加速器','CAMPUS_PROJECT_GROUP'),
('中关村软件园','中关村软件园孵化器','CAMPUS_PROJECT_GROUP'),
('清华科技园','清华科技园-火炬大厦','CAMPUS_PROJECT_GROUP'),
('清华科技园','清华科技园创新大厦','CAMPUS_PROJECT_GROUP'),
('东升科技园二期','东升科技园二期L20地块','PHASE_PROJECT_GROUP'),
('东升科技园二期','东升科技园二期L24地块','PHASE_PROJECT_GROUP'),
('东升2期','东升科技园二期L20地块','PHASE_PROJECT_GROUP'),
('东升2期','东升科技园二期L24地块','PHASE_PROJECT_GROUP');

create temp table _v3_project_resolved on commit drop as
select p.alias_name,b.id building_id,p.basis
from _v3_project_members p
join public.buildings b on b.name=p.current_name
join public.lease_building_alias_review r on r.historical_name=p.alias_name and r.resolution_status='NEEDS_REVIEW'
where not exists (
  select 1 from public.lease_building_name_map m where m.market_code='BJ' and m.alias_name=p.alias_name
);

insert into public.lease_building_project_map(market_code,alias_name,building_id,match_method,verification_status)
select 'BJ',alias_name,building_id,basis,'AUTO_VERIFIED_PROJECT'
from _v3_project_resolved
on conflict (market_code,alias_name,building_id) do update
set match_method=excluded.match_method,verification_status='AUTO_VERIFIED_PROJECT';

update public.lease_building_alias_review r
set resolution_status='AUTO_VERIFIED_PROJECT',
    matched_building_id=null,
    matched_building_name=null,
    resolution_basis=(select min(v.basis) from _v3_project_resolved v where v.alias_name=r.historical_name),
    confidence='ABSOLUTE',
    review_notes=coalesce(r.review_notes || ' | ','') || 'v3 verified project scope; tower not inferred',
    resolved_at=now(),updated_at=now()
where r.resolution_status='NEEDS_REVIEW'
  and exists(select 1 from _v3_project_resolved v where v.alias_name=r.historical_name);

commit;
