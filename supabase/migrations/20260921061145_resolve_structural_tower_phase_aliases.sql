begin;

create temp table _structural_alias_targets(
  historical_name text primary key,
  target_name text not null,
  basis text not null
) on commit drop;

insert into _structural_alias_targets values
('融科A','融科资讯中心A座','EXPLICIT_TOWER_LETTER_ALIAS'),
('融科A座','融科资讯中心A座','EXPLICIT_TOWER_LETTER_ALIAS'),
('融科B','融科资讯中心B座','EXPLICIT_TOWER_LETTER_ALIAS'),
('融科咨询中心A座','融科资讯中心A座','PROJECT_NAME_TYPO_PLUS_EXPLICIT_TOWER'),
('国贸大厦2期','国贸写字楼2座','VERIFIED_PHASE_ALIAS_EQUIVALENCE'),
('国贸大厦一期','国贸写字楼1座','VERIFIED_PHASE_ALIAS_EQUIVALENCE'),
('国贸大厦二期','国贸写字楼2座','VERIFIED_PHASE_ALIAS_EQUIVALENCE'),
('电子城国际总部二期','电子城·国际电子总部二期','CANONICAL_PROJECT_PUNCTUATION_VARIANT'),
('电子城总部二期','电子城·国际电子总部二期','VERIFIED_PROJECT_NAME_ABBREVIATION');

insert into public.lease_building_name_map(
  market_code,alias_name,building_id,match_method,verification_status
)
select
  'BJ',t.historical_name,b.id,'former_name','AUTO_VERIFIED'
from _structural_alias_targets t
join public.buildings b
  on b.name=t.target_name and b.tracking_scope='tracked' and b.is_active=true
on conflict (market_code,alias_name) do nothing;

update public.lease_building_alias_review ar
set
  resolution_status='AUTO_VERIFIED',
  matched_building_id=b.id,
  matched_building_name=b.name,
  resolution_basis=t.basis,
  confidence='ABSOLUTE',
  candidate_count=1,
  candidate_snapshot=jsonb_build_array(
    jsonb_build_object('building_id',b.id,'building_name',b.name,'resolution','structural_alias_exact')
  ),
  review_notes=case
    when coalesce(ar.review_notes,'') like '%structural exact alias resolution%' then ar.review_notes
    else concat_ws(' | ',nullif(ar.review_notes,''),'structural exact alias resolution')
  end,
  resolved_at=coalesce(ar.resolved_at,now()),
  updated_at=now()
from _structural_alias_targets t
join public.buildings b
  on b.name=t.target_name and b.tracking_scope='tracked' and b.is_active=true
where ar.historical_name=t.historical_name;

do $$
declare v_exact integer; v_unmapped integer;
begin
  select count(*) into v_exact
  from public.lease_transactions_read_v1 r
  where r.record_source='history'
    and r.building_match_scope='exact'
    and trim(r.new_building) in (select historical_name from _structural_alias_targets);

  select count(*) into v_unmapped
  from public.lease_transactions_read_v1 r
  where r.record_source='history'
    and r.building_match_scope='unmapped'
    and trim(r.new_building) in (select historical_name from _structural_alias_targets);

  if v_exact<>12 or v_unmapped<>0 then
    raise exception 'structural alias postcondition exact/unmapped=%/% expected 12/0',v_exact,v_unmapped;
  end if;
end $$;

commit;
