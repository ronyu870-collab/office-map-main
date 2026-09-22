begin;

insert into public.buildings(
  name,city,district,former_names,project_type,is_active,is_entered_market,tracking_scope,notes
)
select
  '太极大厦','北京','海淀区','[]'::jsonb,'reference',false,true,'reference_only',
  '互联网权威证据历史参考实体；仅用于历史成交身份解析，不参与地图、季度填报、推荐和楼书运营。核验日期：2026-09-22。北京市公共资源交易平台确认太极计算机股份有限公司地址为北京市海淀区北四环中路211号；华夏认证中心官网、东南大学国家发展与政策研究院及公开公司年报均直接使用“北京市海淀区北四环中路211号太极大厦”作为办公地址。来源：https://ggzyfw.beijing.gov.cn/xmcgzbjj/20260408/5487953.html'
where not exists (
  select 1 from public.buildings where trim(name)='太极大厦'
);

do $$
begin
  if (select count(*) from public.buildings where trim(name)='太极大厦')<>1 then
    raise exception '太极大厦 entity count is not exactly one';
  end if;
  if exists (
    select 1 from public.buildings
    where trim(name)='太极大厦'
      and (tracking_scope<>'reference_only' or is_active<>false or project_type<>'reference')
  ) then
    raise exception '太极大厦 reference invariant violated';
  end if;
end $$;

insert into public.lease_building_name_map(
  market_code,alias_name,building_id,match_method,verification_status
)
select 'BJ','太极大厦',id,'canonical_name','AUTO_VERIFIED'
from public.buildings
where name='太极大厦' and tracking_scope='reference_only'
on conflict (market_code,alias_name) do update
set building_id=excluded.building_id,
    match_method=excluded.match_method,
    verification_status=excluded.verification_status;

update public.lease_building_alias_review ar
set
  resolution_status='AUTO_VERIFIED',
  matched_building_id=b.id,
  matched_building_name=b.name,
  resolution_basis='BEIJING_GOVERNMENT_PLUS_FIRST_PARTY_CANONICAL_ADDRESS',
  confidence='ABSOLUTE',
  candidate_count=1,
  candidate_snapshot=jsonb_build_array(jsonb_build_object(
    'building_id',b.id,'building_name',b.name,'resolution','authoritative_reference_entity'
  )),
  review_notes=case
    when coalesce(ar.review_notes,'') like '%2026-09-22 authoritative government/first-party reference entity%'
      then ar.review_notes
    else concat_ws(' | ',nullif(ar.review_notes,''),'2026-09-22 authoritative government/first-party reference entity')
  end,
  resolved_at=coalesce(ar.resolved_at,now()),
  updated_at=now()
from public.buildings b
where ar.historical_name='太极大厦'
  and b.name='太极大厦'
  and b.tracking_scope='reference_only';

do $$
declare v_ref integer; v_unmapped integer;
begin
  select count(*) into v_ref
  from public.lease_transactions_read_v1
  where record_source='history' and building_match_scope='reference' and trim(new_building)='太极大厦';
  select count(*) into v_unmapped
  from public.lease_transactions_read_v1
  where record_source='history' and building_match_scope='unmapped' and trim(new_building)='太极大厦';
  if v_ref<>2 or v_unmapped<>0 then
    raise exception '太极大厦 postcondition ref/unmapped=%/% expected 2/0',v_ref,v_unmapped;
  end if;
end $$;

commit;
