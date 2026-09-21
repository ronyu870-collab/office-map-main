begin;

insert into public.lease_building_name_map(
  market_code,alias_name,building_id,match_method,verification_status
)
select 'BJ','北京启皓',b.id,'former_name','AUTO_VERIFIED'
from public.buildings b
where b.name='启皓北京'
  and b.tracking_scope='tracked'
  and b.is_active=true
on conflict (market_code,alias_name) do nothing;

update public.lease_building_alias_review ar
set
  resolution_status='AUTO_VERIFIED',
  matched_building_id=b.id,
  matched_building_name=b.name,
  resolution_basis='OWNER_AND_BEIJING_GOVERNMENT_QIHAO_NAME_EQUIVALENCE',
  confidence='ABSOLUTE',
  candidate_count=1,
  candidate_snapshot=jsonb_build_array(
    jsonb_build_object(
      'building_id',b.id,
      'building_name',b.name,
      'submarket',b.submarket,
      'resolution','authoritative_exact'
    )
  ),
  review_notes=case
    when coalesce(ar.review_notes,'') like '%authoritative owner/government Qihao identity%'
      then ar.review_notes
    else concat_ws(' | ',nullif(ar.review_notes,''),'authoritative owner/government Qihao identity')
  end,
  resolved_at=coalesce(ar.resolved_at,now()),
  updated_at=now()
from public.buildings b
where ar.historical_name='北京启皓'
  and b.name='启皓北京';

insert into public.lease_building_project_map(
  market_code,alias_name,building_id,match_method,verification_status
)
select
  'BJ','环贸',b.id,'GOVERNMENT_CONFIRMED_PROJECT_SHORTHAND','AUTO_VERIFIED_PROJECT'
from public.buildings b
where b.name in (
  '环球贸易中心A、B座',
  '环球贸易中心C、D座',
  '环球贸易中心E座',
  '环球贸易中心F座'
)
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
  resolution_basis='BEIJING_GOVERNMENT_HUANMAO_GTC_EQUIVALENCE',
  confidence='ABSOLUTE',
  candidate_count=4,
  candidate_snapshot=(
    select jsonb_agg(
      jsonb_build_object(
        'building_id',b.id,
        'building_name',b.name,
        'submarket',b.submarket,
        'resolution','government_verified_project_member'
      )
      order by b.name
    )
    from public.buildings b
    where b.name in (
      '环球贸易中心A、B座',
      '环球贸易中心C、D座',
      '环球贸易中心E座',
      '环球贸易中心F座'
    )
  ),
  review_notes=case
    when coalesce(ar.review_notes,'') like '%authoritative government Huanmao/GTC project identity%'
      then ar.review_notes
    else concat_ws(' | ',nullif(ar.review_notes,''),'authoritative government Huanmao/GTC project identity')
  end,
  resolved_at=coalesce(ar.resolved_at,now()),
  updated_at=now()
where ar.historical_name='环贸';

do $$
declare
  v_qihao_exact integer;
  v_huanmao_project integer;
  v_remaining integer;
begin
  select count(*) into v_qihao_exact
  from public.lease_transactions_read_v1
  where record_source='history'
    and trim(new_building)='北京启皓'
    and building_match_scope='exact';

  select count(*) into v_huanmao_project
  from public.lease_transactions_read_v1
  where record_source='history'
    and trim(new_building)='环贸'
    and building_match_scope='project';

  select count(*) into v_remaining
  from public.lease_transactions_read_v1
  where record_source='history'
    and trim(new_building) in ('北京启皓','环贸')
    and building_match_scope='unmapped';

  if v_qihao_exact<>2 or v_huanmao_project<>2 or v_remaining<>0 then
    raise exception 'authoritative pair postcondition exact/project/unmapped=%/%/% expected 2/2/0',
      v_qihao_exact,v_huanmao_project,v_remaining;
  end if;
end $$;

commit;
