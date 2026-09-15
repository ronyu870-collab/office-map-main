begin;

create temp table _v5_project_candidates on commit drop as
select r.historical_name,
       b.id building_id,
       b.name current_name,
       (r.candidate_snapshot->0->>'relation') basis
from public.lease_building_alias_review r
join public.buildings b on b.name=(r.candidate_snapshot->0->>'building_name')
where r.resolution_status='NEEDS_REVIEW'
  and r.candidate_count=1
  and coalesce((r.candidate_snapshot->0->>'context_match')::boolean,false)=true
  and (r.candidate_snapshot->0->>'relation') in ('CURRENT_NAME_STARTS_WITH_HISTORY','HISTORY_STARTS_WITH_CURRENT_NAME')
  and char_length(regexp_replace(r.historical_name,'[[:space:]（）()·.，,\-_/]','','g'))>=3;

insert into public.lease_building_project_map(market_code,alias_name,building_id,match_method,verification_status)
select 'BJ',historical_name,building_id,'UNIQUE_NAME_CONTAINMENT_CONTEXT','AUTO_VERIFIED_PROJECT'
from _v5_project_candidates
on conflict (market_code,alias_name,building_id) do update
set match_method=excluded.match_method,verification_status='AUTO_VERIFIED_PROJECT';

update public.lease_building_alias_review r
set resolution_status='AUTO_VERIFIED_PROJECT',
    matched_building_id=null,
    matched_building_name=null,
    resolution_basis='UNIQUE_NAME_CONTAINMENT_CONTEXT',
    confidence='ABSOLUTE',
    review_notes=coalesce(r.review_notes||' | ','')||'v5 unique candidate + name containment + matching market context; project scope only',
    resolved_at=now(),updated_at=now()
where r.resolution_status='NEEDS_REVIEW'
  and exists(select 1 from _v5_project_candidates c where c.historical_name=r.historical_name);

commit;
