begin;

insert into public.lease_building_project_map(
  market_code,alias_name,building_id,match_method,verification_status
)
select
  'BJ','万豪酒店',b.id,'GOVERNMENT_ADDRESS_SAME_PROPERTY_PROJECT_SCOPE','AUTO_VERIFIED_PROJECT'
from public.buildings b
where b.name='荷华明城大厦'
  and b.tracking_scope='tracked'
  and b.is_active=true
on conflict (market_code,alias_name,building_id) do update
set match_method=excluded.match_method,
    verification_status=excluded.verification_status;

update public.lease_building_alias_review ar
set
  resolution_status='AUTO_VERIFIED_PROJECT',
  matched_building_id=null,
  matched_building_name=null,
  resolution_basis='BEIJING_GOVERNMENT_MARRIOTT_SAME_ADDRESS_HEHUA_PROPERTY',
  confidence='ABSOLUTE',
  candidate_count=1,
  candidate_snapshot=(
    select jsonb_build_array(
      jsonb_build_object(
        'building_id',b.id,
        'building_name',b.name,
        'resolution','same_property_project_scope'
      )
    )
    from public.buildings b
    where b.name='荷华明城大厦'
  ),
  review_notes=case
    when coalesce(ar.review_notes,'') like '%authoritative same-address property resolution; project scope only%'
      then ar.review_notes
    else concat_ws(' | ',nullif(ar.review_notes,''),'authoritative same-address property resolution; project scope only')
  end,
  resolved_at=coalesce(ar.resolved_at,now()),
  updated_at=now()
where ar.historical_name='万豪酒店';

do $$
declare v_project integer; v_unmapped integer;
begin
  select count(*) into v_project
  from public.lease_transactions_read_v1
  where record_source='history'
    and trim(new_building)='万豪酒店'
    and building_match_scope='project';

  select count(*) into v_unmapped
  from public.lease_transactions_read_v1
  where record_source='history'
    and trim(new_building)='万豪酒店'
    and building_match_scope='unmapped';

  if v_project<>3 or v_unmapped<>0 then
    raise exception '万豪酒店 postcondition failed project/unmapped=%/% expected 3/0',v_project,v_unmapped;
  end if;
end $$;

commit;
