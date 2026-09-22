begin;

insert into public.buildings(
  name,city,district,former_names,project_type,is_active,is_entered_market,tracking_scope,notes
)
select
  '京蒙高科大厦','北京','海淀区','[]'::jsonb,'reference',false,true,'reference_only',
  '互联网权威证据历史参考实体；仅用于历史成交身份解析，不参与地图、季度填报、推荐和楼书运营。核验日期：2026-09-22。北京市12345服务导图（市经济和信息化局数据）明确京蒙高科大厦为京蒙高科孵化器载体，地址北京市海淀区上地东路5号院；北京市工业年鉴记录企业地址“海淀区上地东路5号京蒙高科大厦B座4层”；内蒙古自治区党委机构编制委员会办公室记录内蒙古科创中心在北京京蒙高科大厦挂牌成立。来源：https://map.beijing.gov.cn/place?categoryId=zjtxfwz&placeId=67ecfd89f8f52a79c0ac2678'
where not exists (
  select 1 from public.buildings where trim(name)='京蒙高科大厦'
);

do $$
begin
  if (select count(*) from public.buildings where trim(name)='京蒙高科大厦')<>1 then
    raise exception '京蒙高科大厦 entity count is not exactly one';
  end if;

  if exists (
    select 1 from public.buildings
    where trim(name)='京蒙高科大厦'
      and (tracking_scope<>'reference_only' or is_active<>false or project_type<>'reference')
  ) then
    raise exception '京蒙高科大厦 reference invariant violated';
  end if;
end $$;

insert into public.lease_building_name_map(
  market_code,alias_name,building_id,match_method,verification_status
)
select 'BJ','京蒙高科大厦',id,'canonical_name','AUTO_VERIFIED'
from public.buildings
where name='京蒙高科大厦' and tracking_scope='reference_only'
on conflict (market_code,alias_name) do update
set building_id=excluded.building_id,
    match_method=excluded.match_method,
    verification_status=excluded.verification_status;

update public.lease_building_alias_review ar
set
  resolution_status='AUTO_VERIFIED',
  matched_building_id=b.id,
  matched_building_name=b.name,
  resolution_basis='BEIJING_GOVERNMENT_AND_OFFICIAL_YEARBOOK_REFERENCE',
  confidence='ABSOLUTE',
  candidate_count=1,
  candidate_snapshot=jsonb_build_array(jsonb_build_object(
    'building_id',b.id,'building_name',b.name,'resolution','authoritative_reference_entity'
  )),
  review_notes=case
    when coalesce(ar.review_notes,'') like '%2026-09-22 authoritative government reference entity%'
      then ar.review_notes
    else concat_ws(' | ',nullif(ar.review_notes,''),'2026-09-22 authoritative government reference entity')
  end,
  resolved_at=coalesce(ar.resolved_at,now()),
  updated_at=now()
from public.buildings b
where ar.historical_name='京蒙高科大厦'
  and b.name='京蒙高科大厦'
  and b.tracking_scope='reference_only';

do $$
declare v_ref integer; v_unmapped integer;
begin
  select count(*) into v_ref
  from public.lease_transactions_read_v1
  where record_source='history'
    and building_match_scope='reference'
    and trim(new_building)='京蒙高科大厦';

  select count(*) into v_unmapped
  from public.lease_transactions_read_v1
  where record_source='history'
    and building_match_scope='unmapped'
    and trim(new_building)='京蒙高科大厦';

  if v_ref<>2 or v_unmapped<>0 then
    raise exception '京蒙高科大厦 postcondition ref/unmapped=%/% expected 2/0',v_ref,v_unmapped;
  end if;
end $$;

commit;
