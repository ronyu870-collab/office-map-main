begin;

insert into public.lease_building_name_map(
  market_code,alias_name,building_id,match_method,verification_status
)
select 'BJ','颐提港',b.id,'former_name','AUTO_VERIFIED'
from public.buildings b
where b.name='颐堤港' and b.tracking_scope='tracked' and b.is_active=true
on conflict (market_code,alias_name) do nothing;

update public.lease_building_alias_review ar
set resolution_status='AUTO_VERIFIED',
    matched_building_id=b.id,
    matched_building_name=b.name,
    resolution_basis='FIRST_PARTY_CANONICAL_NAME_SINGLE_CHARACTER_TYPO',
    confidence='ABSOLUTE',
    candidate_count=1,
    candidate_snapshot=jsonb_build_array(jsonb_build_object('building_id',b.id,'building_name',b.name,'resolution','first_party_verified_exact')),
    review_notes=case
      when coalesce(ar.review_notes,'') like '%first-party canonical typo resolution: 颐提港→颐堤港%' then ar.review_notes
      else concat_ws(' | ',nullif(ar.review_notes,''),'first-party canonical typo resolution: 颐提港→颐堤港')
    end,
    resolved_at=coalesce(ar.resolved_at,now()),
    updated_at=now()
from public.buildings b
where ar.historical_name='颐提港' and b.name='颐堤港';

insert into public.buildings(
  name,city,district,former_names,project_type,is_active,is_entered_market,tracking_scope,notes
)
select '阿里中心·望京A座','北京','朝阳区',to_jsonb(array['阿里中心A座']),
       'reference',false,true,'reference_only',
       '权威来源确认的历史参考实体，仅用于历史成交身份解析；不参与地图、季度填报、推荐和楼书运营。阿里健康官方及北京市政府采购合同均使用“北京市朝阳区望京东园四区9号楼/9号阿里中心·望京A座”。'
where not exists (select 1 from public.buildings where name='阿里中心·望京A座');

insert into public.lease_building_name_map(
  market_code,alias_name,building_id,match_method,verification_status
)
select 'BJ','阿里中心A座',b.id,'former_name','AUTO_VERIFIED'
from public.buildings b
where b.name='阿里中心·望京A座' and b.tracking_scope='reference_only'
on conflict (market_code,alias_name) do nothing;

update public.lease_building_alias_review ar
set resolution_status='AUTO_VERIFIED',
    matched_building_id=b.id,
    matched_building_name=b.name,
    resolution_basis='ALIBABA_FIRST_PARTY_WANGJING_A_CANONICAL_IDENTITY',
    confidence='ABSOLUTE',
    candidate_count=1,
    candidate_snapshot=jsonb_build_array(jsonb_build_object('building_id',b.id,'building_name',b.name,'tracking_scope','reference_only','resolution','authoritative_reference_entity')),
    review_notes=case
      when coalesce(ar.review_notes,'') like '%authoritative Alibaba Wangjing A reference-only entity%' then ar.review_notes
      else concat_ws(' | ',nullif(ar.review_notes,''),'authoritative Alibaba Wangjing A reference-only entity')
    end,
    resolved_at=coalesce(ar.resolved_at,now()),
    updated_at=now()
from public.buildings b
where ar.historical_name='阿里中心A座' and b.name='阿里中心·望京A座';

do $$
declare v_exact integer; v_reference integer; v_unmapped integer; v_leak integer;
begin
  select count(*) into v_exact from public.lease_transactions_read_v1
   where record_source='history' and trim(new_building)='颐提港' and building_match_scope='exact';
  select count(*) into v_reference from public.lease_transactions_read_v1
   where record_source='history' and trim(new_building)='阿里中心A座' and building_match_scope='reference';
  select count(*) into v_unmapped from public.lease_transactions_read_v1
   where record_source='history' and trim(new_building) in ('颐提港','阿里中心A座') and building_match_scope='unmapped';
  select count(*) into v_leak from public.buildings
   where name='阿里中心·望京A座' and (is_active=true or tracking_scope<>'reference_only');
  if v_exact<>2 or v_reference<>2 or v_unmapped<>0 or v_leak<>0 then
    raise exception 'postcondition exact/reference/unmapped/leak=%/%/%/% expected 2/2/0/0',v_exact,v_reference,v_unmapped,v_leak;
  end if;
end $$;

commit;
