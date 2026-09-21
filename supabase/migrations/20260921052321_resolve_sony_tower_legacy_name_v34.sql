begin;

do $$
declare v_bad integer;
begin
  select count(*) into v_bad
  from public.lease_building_name_map m
  where m.market_code='BJ' and m.alias_name='索尼大厦'
    and m.building_id<>'77b6d88b-9ea4-4bf7-a55a-f9ee551f58ea';

  if v_bad<>0 then
    raise exception 'v34 alias conflict count=%',v_bad;
  end if;

  select count(*) into v_bad
  from public.buildings
  where id='77b6d88b-9ea4-4bf7-a55a-f9ee551f58ea'
    and name='东煌大厦'
    and tracking_scope='tracked'
    and is_active=true;

  if v_bad<>1 then
    raise exception 'v34 target building invariant failed';
  end if;
end $$;

insert into public.lease_building_name_map(
  market_code,alias_name,building_id,match_method,verification_status
)
values(
  'BJ','索尼大厦',
  '77b6d88b-9ea4-4bf7-a55a-f9ee551f58ea',
  'former_name','AUTO_VERIFIED'
)
on conflict (market_code,alias_name) do update
set building_id=excluded.building_id,
    match_method=excluded.match_method,
    verification_status=excluded.verification_status;

update public.buildings
set former_names=coalesce(former_names,'[]'::jsonb) || to_jsonb(array['索尼大厦'])
where id='77b6d88b-9ea4-4bf7-a55a-f9ee551f58ea'
  and not coalesce(former_names,'[]'::jsonb) ? '索尼大厦';

update public.lease_building_alias_review ar
set
  resolution_status='AUTO_VERIFIED',
  matched_building_id=b.id,
  matched_building_name=b.name,
  resolution_basis='HISTORICAL_LEGAL_ADDRESS_PLUS_CURRENT_ADDRESS_RENAME',
  confidence='ABSOLUTE',
  candidate_count=1,
  candidate_snapshot=jsonb_build_array(jsonb_build_object(
    'building_id',b.id,'building_name',b.name,
    'submarket',b.submarket,'district',b.district,
    'resolution','verified_legacy_building_name'
  )),
  evidence_snapshot=case
    when ar.resolution_basis='HISTORICAL_LEGAL_ADDRESS_PLUS_CURRENT_ADDRESS_RENAME'
      and coalesce(ar.review_notes,'') like '%v34 verified legacy name 索尼大厦 -> 东煌大厦%'
      then ar.evidence_snapshot
    else coalesce(ar.evidence_snapshot,'[]'::jsonb) ||
      jsonb_build_array(jsonb_build_object(
        'type','legacy_name_same_physical_address',
        'verified_at','2026-09-21',
        'detail','北京知识产权法院相关裁判文书记录索尼移动通信产品（中国）有限公司地址为朝阳区广顺南大街16号院1号楼19-27层；现东煌大厦地址为同一广顺南大街16号院1号楼，多份楼宇资料明确标注“东煌大厦（原索尼大厦）”。'
      ))
  end,
  review_notes=case
    when coalesce(ar.review_notes,'') like '%v34 verified legacy name 索尼大厦 -> 东煌大厦%'
      then ar.review_notes
    else concat_ws(' | ',nullif(ar.review_notes,''),'v34 verified legacy name 索尼大厦 -> 东煌大厦')
  end,
  resolved_at=coalesce(ar.resolved_at,now()),
  updated_at=now()
from public.buildings b
where ar.historical_name='索尼大厦'
  and b.id='77b6d88b-9ea4-4bf7-a55a-f9ee551f58ea';

do $$
declare v_exact integer; v_unmapped integer;
begin
  select count(*) into v_exact
  from public.lease_transactions_read_v1
  where record_source='history'
    and building_match_scope='exact'
    and trim(new_building)='索尼大厦';

  select count(*) into v_unmapped
  from public.lease_transactions_read_v1
  where record_source='history'
    and building_match_scope='unmapped'
    and trim(new_building)='索尼大厦';

  if v_exact<>3 or v_unmapped<>0 then
    raise exception 'v34 postcondition exact/unmapped=%/% expected 3/0',v_exact,v_unmapped;
  end if;
end $$;

commit;
