begin;

insert into public.lease_building_name_map(
  market_code,alias_name,building_id,match_method,verification_status
)
select 'BJ','航星园',b.id,'former_name','AUTO_VERIFIED'
from public.buildings b
where b.name='中关村雍和航星科技园'
  and b.tracking_scope='tracked'
  and b.is_active=true
on conflict (market_code,alias_name) do nothing;

update public.lease_building_alias_review ar
set
  resolution_status='AUTO_VERIFIED',
  matched_building_id=b.id,
  matched_building_name=b.name,
  resolution_basis='BEIJING_GOVERNMENT_HANGXINGYUAN_OFFICIAL_SHORTHAND',
  confidence='ABSOLUTE',
  candidate_count=1,
  candidate_snapshot=jsonb_build_array(
    jsonb_build_object('building_id',b.id,'building_name',b.name,'resolution','government_verified_exact')
  ),
  review_notes=case
    when coalesce(ar.review_notes,'') like '%authoritative Hangxingyuan shorthand -> tracked project%' then ar.review_notes
    else concat_ws(' | ',nullif(ar.review_notes,''),'authoritative Hangxingyuan shorthand -> tracked project')
  end,
  resolved_at=coalesce(ar.resolved_at,now()),
  updated_at=now()
from public.buildings b
where ar.historical_name='航星园'
  and b.name='中关村雍和航星科技园';

insert into public.buildings(
  name,city,district,former_names,project_type,is_active,is_entered_market,tracking_scope,notes
)
select
  '盈创动力大厦','北京','海淀区','[]'::jsonb,'reference',false,true,'reference_only',
  '权威来源确认的历史参考实体，仅用于历史成交身份解析；不参与地图、季度填报、推荐和楼书运营。北京市科委/公共资源交易连续多年使用“北京市海淀区上地东路1号院盈创动力大厦5号楼702室”。'
where not exists (select 1 from public.buildings where name='盈创动力大厦');

insert into public.lease_building_name_map(
  market_code,alias_name,building_id,match_method,verification_status
)
select 'BJ','盈创动力大厦',b.id,'canonical_name','AUTO_VERIFIED'
from public.buildings b
where b.name='盈创动力大厦'
  and b.tracking_scope='reference_only'
on conflict (market_code,alias_name) do nothing;

update public.lease_building_alias_review ar
set
  resolution_status='AUTO_VERIFIED',
  matched_building_id=b.id,
  matched_building_name=b.name,
  resolution_basis='BEIJING_SCIENCE_COMMISSION_YINGCHUANG_CANONICAL_ADDRESS',
  confidence='ABSOLUTE',
  candidate_count=1,
  candidate_snapshot=jsonb_build_array(
    jsonb_build_object('building_id',b.id,'building_name',b.name,'tracking_scope','reference_only','resolution','authoritative_reference_entity')
  ),
  review_notes=case
    when coalesce(ar.review_notes,'') like '%authoritative government reference-only entity%' then ar.review_notes
    else concat_ws(' | ',nullif(ar.review_notes,''),'authoritative government reference-only entity')
  end,
  resolved_at=coalesce(ar.resolved_at,now()),
  updated_at=now()
from public.buildings b
where ar.historical_name='盈创动力大厦'
  and b.name='盈创动力大厦';

do $$
declare v_exact integer; v_reference integer; v_unmapped integer; v_leak integer;
begin
  select count(*) into v_exact from public.lease_transactions_read_v1
   where record_source='history' and trim(new_building)='航星园' and building_match_scope='exact';
  select count(*) into v_reference from public.lease_transactions_read_v1
   where record_source='history' and trim(new_building)='盈创动力大厦' and building_match_scope='reference';
  select count(*) into v_unmapped from public.lease_transactions_read_v1
   where record_source='history' and trim(new_building) in ('航星园','盈创动力大厦') and building_match_scope='unmapped';
  select count(*) into v_leak from public.buildings
   where name='盈创动力大厦' and (is_active=true or tracking_scope<>'reference_only');
  if v_exact<>2 or v_reference<>2 or v_unmapped<>0 or v_leak<>0 then
    raise exception 'postcondition exact/reference/unmapped/leak=%/%/%/% expected 2/2/0/0',v_exact,v_reference,v_unmapped,v_leak;
  end if;
end $$;

commit;
