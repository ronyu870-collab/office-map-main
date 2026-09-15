begin;

-- Seed every historical building name that is not already linked by the canonical map.
insert into public.lease_building_alias_review (
  historical_name,
  historical_row_count,
  observed_submarkets,
  observed_districts
)
select
  trim(h.new_building) as historical_name,
  count(*)::integer as historical_row_count,
  array_agg(distinct nullif(trim(h.sub_market),'')) filter (where nullif(trim(h.sub_market),'') is not null) as observed_submarkets,
  array_agg(distinct nullif(trim(h.district),'')) filter (where nullif(trim(h.district),'') is not null) as observed_districts
from public.lease_transactions_history h
left join public.lease_building_name_map m
  on m.market_code='BJ' and m.alias_name=trim(h.new_building)
where m.building_id is null
  and nullif(trim(h.new_building),'') is not null
group by trim(h.new_building)
on conflict (historical_name) do update set
  historical_row_count=excluded.historical_row_count,
  observed_submarkets=excluded.observed_submarkets,
  observed_districts=excluded.observed_districts,
  updated_at=now();

-- Conservative candidate generation. No fuzzy edit-distance matching is used.
with building_base as (
  select
    b.id,b.name,b.submarket,
    lower(regexp_replace(translate(trim(b.name),'（）【】·‐‑–—－　','()[]--------- '),'[[:space:][:punct:]]','','g')) as n,
    lower(regexp_replace(translate(trim(regexp_replace(b.name,'^(北京|中国)','')),'（）【】·‐‑–—－　','()[]--------- '),'[[:space:][:punct:]]','','g')) as no_prefix_n,
    lower(regexp_replace(translate(trim(regexp_replace(b.name,'(大厦|中心)$','')),'（）【】·‐‑–—－　','()[]--------- '),'[[:space:][:punct:]]','','g')) as no_suffix_n,
    lower(regexp_replace(translate(trim(regexp_replace(b.name,'[（(][A-Za-z0-9+&/ .-]+[）)]','','g')),'（）【】·‐‑–—－　','()[]--------- '),'[[:space:][:punct:]]','','g')) as no_ascii_paren_n
  from public.buildings b
), review_norm as (
  select r.*,
         lower(regexp_replace(translate(trim(r.historical_name),'（）【】·‐‑–—－　','()[]--------- '),'[[:space:][:punct:]]','','g')) as n
  from public.lease_building_alias_review r
  where r.resolution_status='NEEDS_REVIEW'
), former_alias as (
  select b.id,b.name,b.submarket,
         lower(regexp_replace(translate(trim(f.value),'（）【】·‐‑–—－　','()[]--------- '),'[[:space:][:punct:]]','','g')) as n
  from public.buildings b
  cross join lateral jsonb_array_elements_text(case when jsonb_typeof(b.former_names)='array' then b.former_names else '[]'::jsonb end) f(value)
), parenthetical_alias as (
  select b.id,b.name,b.submarket,
         lower(regexp_replace(translate(trim(x[1]),'（）【】·‐‑–—－　','()[]--------- '),'[[:space:][:punct:]]','','g')) as n
  from public.buildings b,
  lateral regexp_matches(b.name,'[（(]([^（）()]+)[）)]','g') x
), raw_candidates as (
  select r.historical_name,r.historical_row_count,r.observed_submarkets,b.id,b.name,b.submarket,'NORMALIZED_EXACT'::text rule
  from review_norm r join building_base b on r.n=b.n
  union all
  select r.historical_name,r.historical_row_count,r.observed_submarkets,f.id,f.name,f.submarket,'FORMER_NAME_NORMALIZED'
  from review_norm r join former_alias f on r.n=f.n
  union all
  select r.historical_name,r.historical_row_count,r.observed_submarkets,p.id,p.name,p.submarket,'PARENTHETICAL_ALIAS_EXACT'
  from review_norm r join parenthetical_alias p on r.n=p.n
  union all
  select r.historical_name,r.historical_row_count,r.observed_submarkets,b.id,b.name,b.submarket,'LOCATION_PREFIX_ONLY'
  from review_norm r join building_base b on r.n=b.no_prefix_n and b.n<>b.no_prefix_n
  union all
  select r.historical_name,r.historical_row_count,r.observed_submarkets,b.id,b.name,b.submarket,'ASCII_PAREN_ANNOTATION_ONLY'
  from review_norm r join building_base b on r.n=b.no_ascii_paren_n and b.n<>b.no_ascii_paren_n
  union all
  select r.historical_name,r.historical_row_count,r.observed_submarkets,b.id,b.name,b.submarket,'GENERIC_SUFFIX_ONLY'
  from review_norm r join building_base b on r.n=b.no_suffix_n and b.n<>b.no_suffix_n
), per_building as (
  select historical_name,historical_row_count,observed_submarkets,id,name,submarket,
         array_agg(distinct rule order by rule) rules
  from raw_candidates
  group by historical_name,historical_row_count,observed_submarkets,id,name,submarket
), rolled as (
  select historical_name,count(*)::integer candidate_count,
         jsonb_agg(jsonb_build_object(
           'building_id',id,
           'building_name',name,
           'submarket',submarket,
           'rules',rules
         ) order by name) candidate_snapshot
  from per_building group by historical_name
)
update public.lease_building_alias_review r
set candidate_count=c.candidate_count,candidate_snapshot=c.candidate_snapshot,updated_at=now()
from rolled c where r.historical_name=c.historical_name;

-- First-pass exact auto verification: unique deterministic candidates only.
with building_base as (
  select
    b.id,b.name,b.submarket,
    lower(regexp_replace(translate(trim(b.name),'（）【】·‐‑–—－　','()[]--------- '),'[[:space:][:punct:]]','','g')) as n,
    lower(regexp_replace(translate(trim(regexp_replace(b.name,'^(北京|中国)','')),'（）【】·‐‑–—－　','()[]--------- '),'[[:space:][:punct:]]','','g')) as no_prefix_n,
    lower(regexp_replace(translate(trim(regexp_replace(b.name,'(大厦|中心)$','')),'（）【】·‐‑–—－　','()[]--------- '),'[[:space:][:punct:]]','','g')) as no_suffix_n,
    lower(regexp_replace(translate(trim(regexp_replace(b.name,'[（(][A-Za-z0-9+&/ .-]+[）)]','','g')),'（）【】·‐‑–—－　','()[]--------- '),'[[:space:][:punct:]]','','g')) as no_ascii_paren_n
  from public.buildings b
), review_norm as (
  select r.*,
         lower(regexp_replace(translate(trim(r.historical_name),'（）【】·‐‑–—－　','()[]--------- '),'[[:space:][:punct:]]','','g')) as n
  from public.lease_building_alias_review r
  where r.resolution_status='NEEDS_REVIEW'
), former_alias as (
  select b.id,b.name,b.submarket,
         lower(regexp_replace(translate(trim(f.value),'（）【】·‐‑–—－　','()[]--------- '),'[[:space:][:punct:]]','','g')) as n
  from public.buildings b
  cross join lateral jsonb_array_elements_text(case when jsonb_typeof(b.former_names)='array' then b.former_names else '[]'::jsonb end) f(value)
), parenthetical_alias as (
  select b.id,b.name,b.submarket,
         lower(regexp_replace(translate(trim(x[1]),'（）【】·‐‑–—－　','()[]--------- '),'[[:space:][:punct:]]','','g')) as n
  from public.buildings b,
  lateral regexp_matches(b.name,'[（(]([^（）()]+)[）)]','g') x
), raw_candidates as (
  select r.historical_name,r.historical_row_count,r.observed_submarkets,b.id,b.name,b.submarket,'NORMALIZED_EXACT'::text rule
  from review_norm r join building_base b on r.n=b.n
  union all select r.historical_name,r.historical_row_count,r.observed_submarkets,f.id,f.name,f.submarket,'FORMER_NAME_NORMALIZED' from review_norm r join former_alias f on r.n=f.n
  union all select r.historical_name,r.historical_row_count,r.observed_submarkets,p.id,p.name,p.submarket,'PARENTHETICAL_ALIAS_EXACT' from review_norm r join parenthetical_alias p on r.n=p.n
  union all select r.historical_name,r.historical_row_count,r.observed_submarkets,b.id,b.name,b.submarket,'LOCATION_PREFIX_ONLY' from review_norm r join building_base b on r.n=b.no_prefix_n and b.n<>b.no_prefix_n
  union all select r.historical_name,r.historical_row_count,r.observed_submarkets,b.id,b.name,b.submarket,'ASCII_PAREN_ANNOTATION_ONLY' from review_norm r join building_base b on r.n=b.no_ascii_paren_n and b.n<>b.no_ascii_paren_n
  union all select r.historical_name,r.historical_row_count,r.observed_submarkets,b.id,b.name,b.submarket,'GENERIC_SUFFIX_ONLY' from review_norm r join building_base b on r.n=b.no_suffix_n and b.n<>b.no_suffix_n
), per_building as (
  select historical_name,historical_row_count,observed_submarkets,id,name,submarket,array_agg(distinct rule order by rule) rules
  from raw_candidates group by historical_name,historical_row_count,observed_submarkets,id,name,submarket
), ranked as (
  select p.*,count(*) over(partition by historical_name) candidate_count from per_building p
), safe as (
  select *,case
    when candidate_count<>1 then false
    when rules && array['NORMALIZED_EXACT','FORMER_NAME_NORMALIZED','PARENTHETICAL_ALIAS_EXACT','ASCII_PAREN_ANNOTATION_ONLY']::text[] then true
    when rules @> array['LOCATION_PREFIX_ONLY']::text[]
      and (observed_submarkets is null or submarket=any(observed_submarkets)) then true
    when rules @> array['GENERIC_SUFFIX_ONLY']::text[]
      and char_length(regexp_replace(historical_name,'[^A-Za-z0-9一-龥]','','g'))>=4
      and observed_submarkets is not null
      and cardinality(observed_submarkets)=1
      and submarket=observed_submarkets[1] then true
    else false end is_safe
  from ranked
)
update public.lease_building_alias_review r
set resolution_status='AUTO_VERIFIED',matched_building_id=s.id,matched_building_name=s.name,
    resolution_basis=array_to_string(s.rules,' + '),confidence='ABSOLUTE',
    review_notes='Deterministic unique match under conservative building-identity rules; no fuzzy matching used.',
    resolved_at=now(),updated_at=now()
from safe s
where s.is_safe and r.historical_name=s.historical_name;

insert into public.lease_building_name_map(market_code,alias_name,building_id,match_method,verification_status)
select 'BJ',r.historical_name,r.matched_building_id,
       case when r.resolution_basis like '%NORMALIZED_EXACT%' then 'canonical_name' else 'former_name' end,
       'AUTO_VERIFIED'
from public.lease_building_alias_review r
where r.resolution_status='AUTO_VERIFIED' and r.matched_building_id is not null
on conflict (market_code,alias_name) do nothing;

-- Historical tower/phase -> the only current project-level entity.
with review_norm as (
  select r.historical_name,r.observed_submarkets,
         lower(regexp_replace(translate(trim(r.historical_name),'（）【】·‐‑–—－　','()[]--------- '),'[[:space:][:punct:]]','','g')) hn
  from public.lease_building_alias_review r where r.resolution_status='NEEDS_REVIEW'
), building_norm as (
  select b.id,b.name,b.submarket,
         lower(regexp_replace(translate(trim(b.name),'（）【】·‐‑–—－　','()[]--------- '),'[[:space:][:punct:]]','','g')) bn
  from public.buildings b
), candidate as (
  select r.historical_name,r.observed_submarkets,b.id,b.name,b.submarket,b.bn,
         substring(r.hn from char_length(b.bn)+1) suffix
  from review_norm r join building_norm b on r.hn like b.bn||'%' and r.hn<>b.bn
  where char_length(b.bn)>=3
), shaped as (
  select c.*,count(*) over(partition by c.historical_name) candidate_count,
         (select count(*) from building_norm b2 where b2.bn like c.bn||'%') sibling_count
  from candidate c
  where c.suffix ~ '^([a-z0-9]+座|[一二三四五六七八九十]+座|东塔|西塔|南塔|北塔|中塔|东楼|西楼|南楼|北楼|中楼|一期|二期|三期|四期)$'
), safe as (
  select * from shaped
  where candidate_count=1 and sibling_count=1
    and (observed_submarkets is null or submarket=any(observed_submarkets))
)
update public.lease_building_alias_review r
set resolution_status='AUTO_VERIFIED',matched_building_id=s.id,matched_building_name=s.name,
    resolution_basis='HISTORICAL_SUBUNIT_TO_CURRENT_PROJECT',confidence='ABSOLUTE',
    candidate_count=1,
    candidate_snapshot=jsonb_build_array(jsonb_build_object('building_id',s.id,'building_name',s.name,'submarket',s.submarket,'rules',jsonb_build_array('HISTORICAL_SUBUNIT_TO_CURRENT_PROJECT'),'historical_suffix',s.suffix)),
    review_notes='Historical name is a finer tower/phase label of the only current project-level entity; no competing current sibling entity exists.',
    resolved_at=now(),updated_at=now()
from safe s where r.historical_name=s.historical_name;

insert into public.lease_building_name_map(market_code,alias_name,building_id,match_method,verification_status)
select 'BJ',r.historical_name,r.matched_building_id,'former_name','AUTO_VERIFIED'
from public.lease_building_alias_review r
where r.resolution_status='AUTO_VERIFIED' and r.resolution_basis='HISTORICAL_SUBUNIT_TO_CURRENT_PROJECT'
on conflict (market_code,alias_name) do nothing;

-- Unique trailing parenthetical annotation.
with review_norm as (
  select r.historical_name,r.observed_submarkets,
         lower(regexp_replace(translate(trim(r.historical_name),'（）【】·‐‑–—－　','()[]--------- '),'[[:space:][:punct:]]','','g')) hn
  from public.lease_building_alias_review r where r.resolution_status='NEEDS_REVIEW'
), building_norm as (
  select b.id,b.name,b.submarket,
         lower(regexp_replace(translate(trim(b.name),'（）【】·‐‑–—－　','()[]--------- '),'[[:space:][:punct:]]','','g')) full_n,
         lower(regexp_replace(translate(trim(regexp_replace(b.name,'[（(][^（）()]+[）)]\s*$','','g')),'（）【】·‐‑–—－　','()[]--------- '),'[[:space:][:punct:]]','','g')) base_n,
         b.name ~ '[（(][^（）()]+[）)]\s*$' has_trailing_paren
  from public.buildings b
), candidate as (
  select r.*,b.id,b.name,b.submarket,
         (select count(*) from building_norm b2 where b2.full_n like r.hn||'%') sibling_count,
         count(*) over(partition by r.historical_name) candidate_count
  from review_norm r join building_norm b on b.has_trailing_paren and r.hn=b.base_n
), safe as (
  select * from candidate
  where candidate_count=1 and sibling_count=1
    and (observed_submarkets is null or submarket=any(observed_submarkets))
)
update public.lease_building_alias_review r
set resolution_status='AUTO_VERIFIED',matched_building_id=s.id,matched_building_name=s.name,
    resolution_basis='TRAILING_PAREN_ANNOTATION_ONLY',confidence='ABSOLUTE',candidate_count=1,
    candidate_snapshot=jsonb_build_array(jsonb_build_object('building_id',s.id,'building_name',s.name,'submarket',s.submarket,'rules',jsonb_build_array('TRAILING_PAREN_ANNOTATION_ONLY'))),
    review_notes='Current building name differs only by a unique trailing parenthetical annotation; no current sibling entity shares the historical base name.',
    resolved_at=now(),updated_at=now()
from safe s where r.historical_name=s.historical_name;

insert into public.lease_building_name_map(market_code,alias_name,building_id,match_method,verification_status)
select 'BJ',r.historical_name,r.matched_building_id,'former_name','AUTO_VERIFIED'
from public.lease_building_alias_review r
where r.resolution_status='AUTO_VERIFIED' and r.resolution_basis='TRAILING_PAREN_ANNOTATION_ONLY'
on conflict (market_code,alias_name) do nothing;

-- Persist semantic exact aliases into the people-facing former_names field.
update public.buildings b
set former_names=merged.aliases
from (
  select b0.id,coalesce(jsonb_agg(distinct vals.alias order by vals.alias),'[]'::jsonb) aliases
  from public.buildings b0
  cross join lateral (
    select e.value alias
    from jsonb_array_elements_text(case when jsonb_typeof(b0.former_names)='array' then b0.former_names else '[]'::jsonb end) e(value)
    union
    select r.historical_name
    from public.lease_building_alias_review r
    where r.matched_building_id=b0.id
      and r.resolution_status='AUTO_VERIFIED'
      and r.resolution_basis not like '%NORMALIZED_EXACT%'
      and r.resolution_basis not like '%FORMER_NAME_NORMALIZED%'
  ) vals
  where exists(select 1 from public.lease_building_alias_review r2 where r2.matched_building_id=b0.id and r2.resolution_status='AUTO_VERIFIED')
  group by b0.id
) merged
where b.id=merged.id;

-- Enrich unresolved rows with non-binding prefix candidate hints for later review.
with review_norm as (
  select r.historical_name,r.observed_submarkets,
         lower(regexp_replace(translate(trim(r.historical_name),'（）【】·‐‑–—－　','()[]--------- '),'[[:space:][:punct:]]','','g')) hn
  from public.lease_building_alias_review r
  where r.resolution_status='NEEDS_REVIEW' and r.candidate_count=0
), building_norm as (
  select b.id,b.name,b.submarket,b.district,
         lower(regexp_replace(translate(trim(b.name),'（）【】·‐‑–—－　','()[]--------- '),'[[:space:][:punct:]]','','g')) bn
  from public.buildings b
), candidates as (
  select r.historical_name,b.id,b.name,b.submarket,b.district,
         case when r.observed_submarkets is not null and b.submarket=any(r.observed_submarkets) then 1 else 0 end context_match,
         case when b.bn like r.hn||'%' then 'CURRENT_NAME_STARTS_WITH_HISTORY'
              when r.hn like b.bn||'%' then 'HISTORY_STARTS_WITH_CURRENT_NAME' else 'NONE' end relation,
         row_number() over(partition by r.historical_name order by
           case when r.observed_submarkets is not null and b.submarket=any(r.observed_submarkets) then 1 else 0 end desc,
           abs(char_length(b.bn)-char_length(r.hn)),b.name) rn
  from review_norm r join building_norm b
    on char_length(r.hn)>=3 and (b.bn like r.hn||'%' or r.hn like b.bn||'%')
), rollup as (
  select historical_name,count(*) filter(where rn<=10)::integer candidate_count,
         jsonb_agg(jsonb_build_object('building_id',id,'building_name',name,'submarket',submarket,'district',district,'relation',relation,'context_match',context_match=1) order by rn) filter(where rn<=10) candidate_snapshot
  from candidates group by historical_name
)
update public.lease_building_alias_review r
set candidate_count=x.candidate_count,candidate_snapshot=coalesce(x.candidate_snapshot,'[]'::jsonb),updated_at=now()
from rollup x
where r.historical_name=x.historical_name and r.resolution_status='NEEDS_REVIEW' and r.candidate_count=0;

commit;
