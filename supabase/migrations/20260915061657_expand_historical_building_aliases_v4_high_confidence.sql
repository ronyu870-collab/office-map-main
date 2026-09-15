begin;

create temp table _v4_exact_aliases(historical_name text primary key,current_name text not null,basis text not null) on commit drop;
insert into _v4_exact_aliases values
('盘古大观','钰珵大厦','ADDRESS_AND_RENAME_CORROBORATED'),
('盘古','钰珵大厦','ADDRESS_AND_RENAME_CORROBORATED'),
('复星国际','复星国际中心','UNIQUE_NAME_EQUIVALENCE'),
('世东国际','世东国际大厦','UNIQUE_NAME_EQUIVALENCE'),
('昆泰国际','昆泰国际大厦','UNIQUE_NAME_EQUIVALENCE'),
('环球金融中心WFC','环球金融中心','ABBREVIATION_PLUS_CANONICAL_NAME'),
('英皇','英皇集团中心','UNIQUE_PROJECT_SHORTHAND'),
('京汇','京汇大厦','UNIQUE_PROJECT_SHORTHAND'),
('金地','金地中心','UNIQUE_NAME_PLUS_CBD_CONTEXT'),
('双子座大厦','汇京双子座大厦','FORMER_IDENTITY_PLUS_CBD_CONTEXT'),
('盈科中心A座','盈科中心（AB座）','CURRENT_AGGREGATE_TOWER_MEMBERSHIP'),
('盈科中心B座','盈科中心（AB座）','CURRENT_AGGREGATE_TOWER_MEMBERSHIP'),
('华贸T1','华贸中心 (一座、二座)','TOWER_TOKEN_NORMALIZATION'),
('华贸T3','华贸中心三座','TOWER_TOKEN_NORMALIZATION'),
('凤凰置地H座','凤凰置地广场F&H座','CURRENT_AGGREGATE_TOWER_MEMBERSHIP'),
('凤凰置地H','凤凰置地广场F&H座','CURRENT_AGGREGATE_TOWER_MEMBERSHIP'),
('凤凰置地广场H','凤凰置地广场F&H座','CURRENT_AGGREGATE_TOWER_MEMBERSHIP'),
('凤凰置地广场H座','凤凰置地广场F&H座','CURRENT_AGGREGATE_TOWER_MEMBERSHIP'),
('凤凰置地F座','凤凰置地广场F&H座','CURRENT_AGGREGATE_TOWER_MEMBERSHIP'),
('凤凰置地广场F','凤凰置地广场F&H座','CURRENT_AGGREGATE_TOWER_MEMBERSHIP'),
('凤凰置地广场F座','凤凰置地广场F&H座','CURRENT_AGGREGATE_TOWER_MEMBERSHIP'),
('凤凰置地A座','凤凰置地广场A座','TOWER_TOKEN_NORMALIZATION'),
('凤凰置地广场A','凤凰置地广场A座','TOWER_TOKEN_NORMALIZATION'),
('环球贸易中心A座','环球贸易中心A、B座','CURRENT_AGGREGATE_TOWER_MEMBERSHIP'),
('环球贸易中心B座','环球贸易中心A、B座','CURRENT_AGGREGATE_TOWER_MEMBERSHIP'),
('环球贸易中心 B座','环球贸易中心A、B座','CURRENT_AGGREGATE_TOWER_MEMBERSHIP'),
('环球贸易中心C座','环球贸易中心C、D座','CURRENT_AGGREGATE_TOWER_MEMBERSHIP'),
('环球贸易中心 C座','环球贸易中心C、D座','CURRENT_AGGREGATE_TOWER_MEMBERSHIP'),
('环球贸易中心二期C座','环球贸易中心C、D座','CURRENT_AGGREGATE_TOWER_MEMBERSHIP'),
('环球贸易中心（三期 E座）','环球贸易中心E座','PHASE_TOWER_NORMALIZATION'),
('融科C座','融科资讯中心C座','UNIQUE_TOWER_SHORTHAND'),
('融科中心C座','融科资讯中心C座','UNIQUE_TOWER_SHORTHAND'),
('融科咨讯中心C座','融科资讯中心C座','TYPO_NORMALIZATION'),
('融科资讯C座','融科资讯中心C座','UNIQUE_TOWER_SHORTHAND'),
('融科资讯中心C座20F','融科资讯中心C座','FLOOR_ANNOTATION_REMOVAL'),
('融科资讯中心C座6F','融科资讯中心C座','FLOOR_ANNOTATION_REMOVAL');

create temp table _v4_exact_resolved on commit drop as
select e.historical_name,b.id building_id,b.name current_name,e.basis
from _v4_exact_aliases e
join public.buildings b on b.name=e.current_name
join public.lease_building_alias_review r on r.historical_name=e.historical_name and r.resolution_status='NEEDS_REVIEW'
where (select count(*) from public.buildings bx where bx.name=e.current_name)=1;

delete from public.lease_building_project_map p using _v4_exact_resolved e
where p.market_code='BJ' and p.alias_name=e.historical_name;

with grouped as (
  select building_id,jsonb_agg(historical_name order by historical_name) aliases from _v4_exact_resolved group by building_id
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
update public.buildings b set former_names=e.former_names from expanded e where b.id=e.building_id;

insert into public.lease_building_name_map(market_code,alias_name,building_id,match_method,verification_status)
select 'BJ',historical_name,building_id,'former_name','AUTO_VERIFIED' from _v4_exact_resolved
on conflict (market_code,alias_name) do update set building_id=excluded.building_id,match_method='former_name',verification_status='AUTO_VERIFIED';

update public.lease_building_alias_review r
set resolution_status='AUTO_VERIFIED',matched_building_id=e.building_id,matched_building_name=e.current_name,
    resolution_basis=e.basis,confidence='ABSOLUTE',
    review_notes=coalesce(r.review_notes||' | ','')||'v4 high-confidence identity',resolved_at=now(),updated_at=now()
from _v4_exact_resolved e where r.historical_name=e.historical_name;

create temp table _v4_project(alias_name text not null,current_name text not null,basis text not null,primary key(alias_name,current_name)) on commit drop;
insert into _v4_project values
('远洋大厦','远洋大厦-远洋自持部分','PROJECT_TO_OWNERSHIP_SUBSET'),
('佳兆业','佳兆业广场北塔','PROJECT_SHORTHAND_TO_AVAILABLE_MEMBER'),
('鼎好DH3','鼎好DH3-A座','PROJECT_PREFIX_GROUP'),
('鼎好DH3','鼎好DH3-B/C座','PROJECT_PREFIX_GROUP'),
('中航广场','中航广场一期','PROJECT_NAME_TO_AVAILABLE_MEMBER'),
('华膳园','华膳园国际传媒文化产业园','PROJECT_SHORTHAND_TO_AVAILABLE_MEMBER'),
('国防科技园','北京理工大学国防科技园（TCL）','PROJECT_GROUP'),
('国防科技园','北京理工大学国防科技园（理工大学）','PROJECT_GROUP'),
('庄胜广场','庄胜广场北塔（8号楼）','PROJECT_NAME_TO_AVAILABLE_MEMBER'),
('恒奥中心','恒奥中心C座','PROJECT_NAME_TO_AVAILABLE_MEMBER'),
('China Central Place','华贸中心 (一座、二座)','EXTERNAL_ENGLISH_PROJECT_NAME'),
('China Central Place','华贸中心三座','EXTERNAL_ENGLISH_PROJECT_NAME'),
('国贸','国贸写字楼1座','PROJECT_SHORTHAND_GROUP'),
('国贸','国贸写字楼2座','PROJECT_SHORTHAND_GROUP'),
('国贸','国贸大厦A座(三期)','PROJECT_SHORTHAND_GROUP'),
('国贸','国贸大厦B座(三期)','PROJECT_SHORTHAND_GROUP'),
('国贸中心','国贸写字楼1座','PROJECT_SHORTHAND_GROUP'),
('国贸中心','国贸写字楼2座','PROJECT_SHORTHAND_GROUP'),
('国贸中心','国贸大厦A座(三期)','PROJECT_SHORTHAND_GROUP'),
('国贸中心','国贸大厦B座(三期)','PROJECT_SHORTHAND_GROUP');

create temp table _v4_project_resolved on commit drop as
select p.alias_name,b.id building_id,p.basis
from _v4_project p join public.buildings b on b.name=p.current_name
join public.lease_building_alias_review r on r.historical_name=p.alias_name and r.resolution_status='NEEDS_REVIEW'
where not exists(select 1 from public.lease_building_name_map m where m.market_code='BJ' and m.alias_name=p.alias_name);

insert into public.lease_building_project_map(market_code,alias_name,building_id,match_method,verification_status)
select 'BJ',alias_name,building_id,basis,'AUTO_VERIFIED_PROJECT' from _v4_project_resolved
on conflict (market_code,alias_name,building_id) do update set match_method=excluded.match_method,verification_status='AUTO_VERIFIED_PROJECT';

update public.lease_building_alias_review r
set resolution_status='AUTO_VERIFIED_PROJECT',matched_building_id=null,matched_building_name=null,
    resolution_basis=(select min(v.basis) from _v4_project_resolved v where v.alias_name=r.historical_name),confidence='ABSOLUTE',
    review_notes=coalesce(r.review_notes||' | ','')||'v4 verified project scope; tower not inferred',resolved_at=now(),updated_at=now()
where r.resolution_status='NEEDS_REVIEW' and exists(select 1 from _v4_project_resolved v where v.alias_name=r.historical_name);

commit;
