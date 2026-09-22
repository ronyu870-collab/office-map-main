begin;

create temp table _ref_alias_targets(
  historical_name text primary key,
  target_name text not null,
  basis text not null
) on commit drop;

insert into _ref_alias_targets values
('住总大厦（CBD）','住总大厦','VERIFIED_REFERENCE_LOCATION_ANNOTATION'),
('天宁1号文化科技创新园','天宁1号文化科技创新园','REFERENCE_CANONICAL_NAME_GAP_REPAIR'),
('盈创动力','盈创动力大厦','VERIFIED_REFERENCE_GENERIC_SUFFIX_OMISSION'),
('首科','首科大厦','VERIFIED_REFERENCE_GENERIC_SUFFIX_OMISSION'),
('力宝广场A座','力宝广场','VERIFIED_REFERENCE_TOWER_COMPONENT');

insert into public.lease_building_name_map(
  market_code,alias_name,building_id,match_method,verification_status
)
select 'BJ',t.historical_name,b.id,'former_name','AUTO_VERIFIED'
from _ref_alias_targets t
join public.buildings b on b.name=t.target_name
on conflict (market_code,alias_name) do nothing;

update public.buildings b
set former_names = case
  when jsonb_typeof(b.former_names)='array' and not b.former_names ? t.historical_name
    then b.former_names || to_jsonb(array[t.historical_name])
  else b.former_names
end
from _ref_alias_targets t
where b.name=t.target_name;

update public.lease_building_alias_review ar
set resolution_status='AUTO_VERIFIED',
    matched_building_id=b.id,
    matched_building_name=b.name,
    resolution_basis=t.basis,
    confidence='ABSOLUTE',
    candidate_count=1,
    candidate_snapshot=jsonb_build_array(jsonb_build_object(
      'building_id',b.id,'building_name',b.name,'resolution','verified_reference_alias'
    )),
    review_notes=case
      when coalesce(ar.review_notes,'') like '%2026-09-22 verified reference alias resolution%' then ar.review_notes
      else concat_ws(' | ',nullif(ar.review_notes,''),'2026-09-22 verified reference alias resolution')
    end,
    resolved_at=coalesce(ar.resolved_at,now()),
    updated_at=now()
from _ref_alias_targets t
join public.buildings b on b.name=t.target_name
where ar.historical_name=t.historical_name;

do $$
declare v_ref integer; v_unmapped integer;
begin
  select count(*) into v_ref
  from public.lease_transactions_read_v1
  where record_source='history' and building_match_scope='reference'
    and trim(new_building) in (select historical_name from _ref_alias_targets);

  select count(*) into v_unmapped
  from public.lease_transactions_read_v1
  where record_source='history' and building_match_scope='unmapped'
    and trim(new_building) in (select historical_name from _ref_alias_targets);

  if v_ref<>5 or v_unmapped<>0 then
    raise exception 'reference alias postcondition reference/unmapped=%/% expected 5/0',v_ref,v_unmapped;
  end if;
end $$;

commit;
