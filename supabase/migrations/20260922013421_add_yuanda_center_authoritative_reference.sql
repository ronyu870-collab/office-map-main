begin;

insert into public.buildings(
  name,city,district,former_names,project_type,is_active,is_entered_market,tracking_scope,notes
)
select
  '远大中心','北京','朝阳区','[]'::jsonb,'reference',false,true,'reference_only',
  '互联网权威证据历史参考实体；仅用于历史成交身份解析，不参与地图、季度填报、推荐和楼书运营。核验日期：2026-09-22。中国政府采购网2026年多份中央单位采购公告明确使用“北京市朝阳区慧忠路5号远大中心B座20层”及“远大中心C座2层”作为正式办公/开标地址，确认该楼宇实体与地址。来源：https://www.ccgp.gov.cn/cggg/zygg/jzxcs/202605/t20260520_26597260.htm'
where not exists (
  select 1 from public.buildings where trim(name)='远大中心'
);

do $$
begin
  if (select count(*) from public.buildings where trim(name)='远大中心')<>1 then
    raise exception '远大中心 entity count is not exactly one';
  end if;
  if exists (
    select 1 from public.buildings
    where trim(name)='远大中心'
      and (tracking_scope<>'reference_only' or is_active<>false or project_type<>'reference')
  ) then
    raise exception '远大中心 reference invariant violated';
  end if;
end $$;

insert into public.lease_building_name_map(
  market_code,alias_name,building_id,match_method,verification_status
)
select 'BJ','远大中心',id,'canonical_name','AUTO_VERIFIED'
from public.buildings
where name='远大中心' and tracking_scope='reference_only'
on conflict (market_code,alias_name) do update
set building_id=excluded.building_id,
    match_method=excluded.match_method,
    verification_status=excluded.verification_status;

update public.lease_building_alias_review ar
set
  resolution_status='AUTO_VERIFIED',
  matched_building_id=b.id,
  matched_building_name=b.name,
  resolution_basis='CENTRAL_GOVERNMENT_PROCUREMENT_CANONICAL_NAME_ADDRESS',
  confidence='ABSOLUTE',
  candidate_count=1,
  candidate_snapshot=jsonb_build_array(jsonb_build_object(
    'building_id',b.id,'building_name',b.name,'resolution','authoritative_reference_entity'
  )),
  review_notes=case
    when coalesce(ar.review_notes,'') like '%2026-09-22 central-government authoritative reference entity%'
      then ar.review_notes
    else concat_ws(' | ',nullif(ar.review_notes,''),'2026-09-22 central-government authoritative reference entity')
  end,
  resolved_at=coalesce(ar.resolved_at,now()),
  updated_at=now()
from public.buildings b
where ar.historical_name='远大中心'
  and b.name='远大中心'
  and b.tracking_scope='reference_only';

do $$
declare v_ref integer; v_unmapped integer;
begin
  select count(*) into v_ref
  from public.lease_transactions_read_v1
  where record_source='history' and building_match_scope='reference' and trim(new_building)='远大中心';
  select count(*) into v_unmapped
  from public.lease_transactions_read_v1
  where record_source='history' and building_match_scope='unmapped' and trim(new_building)='远大中心';
  if v_ref<>2 or v_unmapped<>0 then
    raise exception '远大中心 postcondition ref/unmapped=%/% expected 2/0',v_ref,v_unmapped;
  end if;
end $$;

commit;
