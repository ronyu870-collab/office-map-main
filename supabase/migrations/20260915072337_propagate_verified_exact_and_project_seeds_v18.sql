begin;

create temp table _v18_exact(alias_name text primary key,seed_alias text not null,basis text not null) on commit drop;
insert into _v18_exact values
('海航实业','海航实业大厦','VERIFIED_RENAME_SEED_SHORTENING'),
('远洋光华国际C座','远洋光华国际 C座','VERIFIED_SEED_WHITESPACE_VARIANT'),
('远洋·光华国际C座','远洋光华国际 C座','VERIFIED_SEED_PUNCTUATION_VARIANT'),
('中关村资本','中关村资本大厦','VERIFIED_SEED_SUFFIX_REMOVAL'),
('中粮置地','中粮置地广场','VERIFIED_RENAME_SEED_SHORTENING'),
('金地中心 A','金地中心A','VERIFIED_SEED_WHITESPACE_VARIANT');

create temp table _v18_exact_resolved on commit drop as
select e.alias_name,e.seed_alias,e.basis,m.building_id,b.name building_name
from _v18_exact e
join public.lease_building_name_map m on m.market_code='BJ' and m.alias_name=e.seed_alias
join public.buildings b on b.id=m.building_id
join public.lease_building_alias_review r on r.historical_name=e.alias_name and r.resolution_status='NEEDS_REVIEW'
where (select count(*) from public.lease_building_name_map mx where mx.market_code='BJ' and mx.alias_name=e.seed_alias)=1;

insert into public.lease_building_name_map(market_code,alias_name,building_id,match_method,verification_status)
select 'BJ',alias_name,building_id,'former_name','AUTO_VERIFIED' from _v18_exact_resolved
on conflict (market_code,alias_name) do update set building_id=excluded.building_id,match_method=excluded.match_method,verification_status=excluded.verification_status;

with grouped as (select building_id,jsonb_agg(alias_name order by alias_name) aliases from _v18_exact_resolved group by building_id), expanded as (
 select g.building_id,jsonb_agg(distinct value order by value) former_names
 from grouped g join public.buildings b on b.id=g.building_id
 cross join lateral (
   select x.value from jsonb_array_elements_text(case when jsonb_typeof(b.former_names)='array' then b.former_names else '[]'::jsonb end) x(value)
   union all select y.value from jsonb_array_elements_text(g.aliases) y(value)
 ) u where nullif(trim(value),'') is not null group by g.building_id
)
update public.buildings b set former_names=e.former_names from expanded e where b.id=e.building_id;

update public.lease_building_alias_review r
set resolution_status='AUTO_VERIFIED',matched_building_id=e.building_id,matched_building_name=e.building_name,
    resolution_basis=e.basis,confidence='ABSOLUTE',
    evidence_snapshot=jsonb_build_array(jsonb_build_object('type','verified_seed','detail','Identity inherited from already verified alias seed: '||e.seed_alias||' -> '||e.building_name||'; only non-semantic formatting/suffix variation changed.')),
    review_notes=coalesce(r.review_notes||' | ','')||'v18 inherited exact identity from verified seed',resolved_at=now(),updated_at=now()
from _v18_exact_resolved e where r.historical_name=e.alias_name;

create temp table _v18_project(alias_name text primary key,seed_alias text not null,basis text not null) on commit drop;
insert into _v18_project values
('远洋光华国际中心','远洋光华国际','VERIFIED_PROJECT_SEED_SUFFIX_VARIANT'),
('金融街月坛','金融街月坛中心','VERIFIED_PROJECT_SEED_SUFFIX_REMOVAL'),
('中航技','中航技广场','VERIFIED_PROJECT_SEED_SUFFIX_REMOVAL'),
('中航技大厦','中航技广场','VERIFIED_PROJECT_SEED_GENERIC_SUFFIX_VARIANT'),
('保利国际大厦','保利国际','VERIFIED_PROJECT_SEED_GENERIC_SUFFIX_VARIANT'),
('兆泰国际','兆泰国际中心','VERIFIED_PROJECT_SEED_SUFFIX_REMOVAL'),
('光华国际','光华国际中心','VERIFIED_PROJECT_SEED_SUFFIX_REMOVAL'),
('骏豪·中央公园广场','骏豪中央公园广场','VERIFIED_PROJECT_SEED_PUNCTUATION_VARIANT'),
('世纪财富大厦','世纪财富','VERIFIED_PROJECT_SEED_GENERIC_SUFFIX_VARIANT');

insert into public.lease_building_project_map(market_code,alias_name,building_id,match_method,verification_status)
select 'BJ',v.alias_name,p.building_id,'verified_project_seed_variant','AUTO_VERIFIED_PROJECT'
from _v18_project v
join public.lease_building_alias_review r on r.historical_name=v.alias_name and r.resolution_status='NEEDS_REVIEW'
join public.lease_building_project_map p on p.market_code='BJ' and p.alias_name=v.seed_alias
where not exists(select 1 from public.lease_building_name_map m where m.market_code='BJ' and m.alias_name=v.alias_name)
on conflict (market_code,alias_name,building_id) do update set match_method=excluded.match_method,verification_status=excluded.verification_status;

update public.lease_building_alias_review r
set resolution_status='AUTO_VERIFIED_PROJECT',matched_building_id=null,matched_building_name=null,
    resolution_basis=v.basis,confidence='ABSOLUTE',
    evidence_snapshot=jsonb_build_array(jsonb_build_object('type','verified_project_seed','detail','Project membership inherited from already verified project alias seed: '||v.seed_alias||'; only non-semantic formatting/suffix variation changed.')),
    review_notes=coalesce(r.review_notes||' | ','')||'v18 inherited project identity from verified seed; no tower inference',resolved_at=now(),updated_at=now()
from _v18_project v
where r.historical_name=v.alias_name and r.resolution_status='NEEDS_REVIEW'
  and exists(select 1 from public.lease_building_project_map p where p.market_code='BJ' and p.alias_name=v.alias_name);

commit;
