begin;

create temp table _exact_alias_targets(
  historical_name text primary key,
  target_name text not null,
  basis text not null
) on commit drop;

insert into _exact_alias_targets values
('中海大厦C座','中海大厦C、D座','EXPLICIT_COMPONENT_WITHIN_CANONICAL_AGGREGATE'),
('北京国际财源中心A座','国际财源中心（IFC）','VERIFIED_IFC_A_TOWER_ALIAS_FAMILY'),
('北京财源国际中心 A座','国际财源中心（IFC）','VERIFIED_IFC_A_TOWER_ALIAS_FAMILY'),
('望京利星行二期','利星行中心','VERIFIED_LSH_PHASE_ALIAS_WITH_LOCATION_PREFIX'),
('远洋一期A座','远洋国际中心A座','VERIFIED_PHASE_AND_TOWER_ALIAS_FAMILY');

create temp table _row_targets(
  source_uid text primary key,
  target_name text not null,
  evidence_detail text not null
) on commit drop;

insert into _row_targets values
('987bfaa43662378dd496d958a44e7d1e0601db049f2bc03e996216aca4b056a9','丽泽平安金融中心','历史名“平安金融B座”，2025Q4，sub_market=丽泽；当前丽泽平安金融中心former_names明确含B座。'),
('195587cf2beb137505cd8372db4f4ab33566cb7b7d3bbc5afc7ee1d5d39b2833','丽泽平安金融中心','历史名“平安金融中心B座”，2024Q1，sub_market=丽泽；当前丽泽平安金融中心former_names明确含B座。'),
('c1ba5f7a60057cbd39f02700747c00fa9a40e7e8217abcc2cf5a602dcdd474bd','丽泽平安金融中心','历史名“平安金融中心B座”，2025Q3，sub_market=丽泽；当前丽泽平安金融中心former_names明确含B座。'),
('06c2f8abbf305b6e4aea17eb98cb66001c26f0968758c0071787fd6cc66dd248','平安国际金融中心','历史名“平安金融中心A”，2025Q2，sub_market=燕莎；当前平安国际金融中心submarket=燕莎且former_names明确含A座。'),
('3e6aedd3f22107acf77cfc09d0d484794dc548202947891a9623b98edc546434','丽泽平安金融中心','历史名“平安金融中心A”，2025Q4，sub_market=丽泽；当前丽泽平安金融中心submarket=丽泽且former_names明确含A座。');

insert into public.lease_building_name_map(
  market_code,alias_name,building_id,match_method,verification_status
)
select 'BJ',t.historical_name,b.id,'former_name','AUTO_VERIFIED'
from _exact_alias_targets t
join public.buildings b on b.name=t.target_name
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
    jsonb_build_object('building_id',b.id,'building_name',b.name,'resolution','structural_exact')
  ),
  review_notes=case
    when coalesce(ar.review_notes,'') like '%safe structural exact resolution%' then ar.review_notes
    else concat_ws(' | ',nullif(ar.review_notes,''),'safe structural exact resolution')
  end,
  resolved_at=coalesce(ar.resolved_at,now()),
  updated_at=now()
from _exact_alias_targets t
join public.buildings b on b.name=t.target_name
where ar.historical_name=t.historical_name;

insert into public.lease_building_record_map(
  source_uid,building_id,market_code,match_method,verification_status,evidence_snapshot
)
select
  t.source_uid,b.id,'BJ','historical_name_plus_submarket_context','AUTO_VERIFIED_RECORD',
  jsonb_build_array(jsonb_build_object(
    'type','historical_name_plus_submarket_context',
    'verified_at','2026-09-21',
    'detail',t.evidence_detail
  ))
from _row_targets t
join public.buildings b on b.name=t.target_name
on conflict (source_uid) do update
set building_id=excluded.building_id,
    market_code=excluded.market_code,
    match_method=excluded.match_method,
    verification_status=excluded.verification_status,
    evidence_snapshot=excluded.evidence_snapshot,
    updated_at=now();

do $$
declare v_exact integer; v_unmapped integer;
begin
  select count(*) into v_exact
  from public.lease_transactions_read_v1 r
  where r.record_source='history'
    and r.building_match_scope='exact'
    and (
      trim(r.new_building) in (select historical_name from _exact_alias_targets)
      or r.source_uid in (select source_uid from _row_targets)
    );

  select count(*) into v_unmapped
  from public.lease_transactions_read_v1 r
  where r.record_source='history'
    and r.building_match_scope='unmapped'
    and (
      trim(r.new_building) in (select historical_name from _exact_alias_targets)
      or r.source_uid in (select source_uid from _row_targets)
    );

  if v_exact<>10 or v_unmapped<>0 then
    raise exception 'safe structural/context postcondition exact/unmapped=%/% expected 10/0',v_exact,v_unmapped;
  end if;
end $$;

commit;
