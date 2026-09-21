begin;

insert into public.lease_building_project_map(
  market_code,alias_name,building_id,match_method,verification_status
)
values
('BJ','东升海开园','e858b59b-4db5-4160-a5cf-0c5e6cfc3deb','GOVERNMENT_CONFIRMED_PARENT_PROJECT','AUTO_VERIFIED_PROJECT'),
('BJ','东升海开园','3f264d39-4553-4ebe-96c2-c844343dcc55','GOVERNMENT_CONFIRMED_PARENT_PROJECT','AUTO_VERIFIED_PROJECT')
on conflict (market_code,alias_name,building_id) do update
set match_method=excluded.match_method,
    verification_status=excluded.verification_status;

update public.lease_building_alias_review ar
set
  resolution_status='AUTO_VERIFIED_PROJECT',
  matched_building_id=null,
  matched_building_name=null,
  resolution_basis='HAIDIAN_GOVERNMENT_DONGSHENG_HAIKAI_PARK_IDENTITY',
  confidence='ABSOLUTE',
  candidate_count=2,
  candidate_snapshot=jsonb_build_array(
    jsonb_build_object(
      'building_id','e858b59b-4db5-4160-a5cf-0c5e6cfc3deb',
      'building_name','东升科技园-海开园（1号楼）',
      'resolution','government_verified_project_member'
    ),
    jsonb_build_object(
      'building_id','3f264d39-4553-4ebe-96c2-c844343dcc55',
      'building_name','东升科技园-海开园（5号楼）',
      'resolution','government_verified_project_member'
    )
  ),
  review_notes=case
    when coalesce(ar.review_notes,'') like '%authoritative government project-scope resolution%' then ar.review_notes
    else concat_ws(' | ',nullif(ar.review_notes,''),'authoritative government project-scope resolution')
  end,
  resolved_at=coalesce(ar.resolved_at,now()),
  updated_at=now()
where ar.historical_name='东升海开园';

do $$
declare v_project integer; v_unmapped integer;
begin
  select count(*) into v_project
  from public.lease_transactions_read_v1
  where record_source='history'
    and trim(new_building)='东升海开园'
    and building_match_scope='project';

  select count(*) into v_unmapped
  from public.lease_transactions_read_v1
  where record_source='history'
    and trim(new_building)='东升海开园'
    and building_match_scope='unmapped';

  if v_project<>3 or v_unmapped<>0 then
    raise exception '东升海开园 postcondition failed project/unmapped=%/% expected 3/0',v_project,v_unmapped;
  end if;
end $$;

commit;
