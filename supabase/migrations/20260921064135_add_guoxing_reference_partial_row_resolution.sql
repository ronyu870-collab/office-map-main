begin;

insert into public.buildings(
  name,city,district,former_names,project_type,is_active,is_entered_market,tracking_scope,notes
)
select
  '国兴大厦','北京','海淀区','[]'::jsonb,'reference',false,true,'reference_only',
  '权威来源确认的历史参考实体，仅用于历史成交身份解析；不参与地图、季度填报、推荐和楼书运营。中央政府采购长期使用“北京市海淀区首体南路20/22号国兴大厦”。因历史同名记录存在上下文冲突，不建立全局名称映射，仅对有租户地址证据的source_uid做行级关联。'
where not exists (
  select 1 from public.buildings where name='国兴大厦'
);

insert into public.lease_building_record_map(
  source_uid,building_id,market_code,match_method,verification_status,evidence_snapshot
)
select
  'e609bf9eceb1bd947915d981f39aaf563d5d2387937688524dc5f4f08be605fd',
  b.id,'BJ','historical_tenant_official_address','AUTO_VERIFIED_RECORD',
  jsonb_build_array(
    jsonb_build_object(
      'type','historical_tenant_address',
      'verified_at','2026-09-21',
      'tenant','北京怡孚和融科技有限公司',
      'historical_building_label','国兴大厦',
      'detail','2017Q3历史成交；该公司2016-2017同期公开产品资料明确公司地址为北京首体南路22号国兴大厦20F，与中央政府采购使用的国兴大厦地址一致。仅对本source_uid建立reference关联。'
    )
  )
from public.buildings b
where b.name='国兴大厦' and b.tracking_scope='reference_only'
on conflict (source_uid) do update
set building_id=excluded.building_id,
    market_code=excluded.market_code,
    match_method=excluded.match_method,
    verification_status=excluded.verification_status,
    evidence_snapshot=excluded.evidence_snapshot,
    updated_at=now();

update public.lease_building_alias_review ar
set
  review_notes=case
    when coalesce(ar.review_notes,'') like '%partial source_uid reference: 2017 怡孚和融→国兴大厦%' then ar.review_notes
    else concat_ws(' | ',nullif(ar.review_notes,''),'partial source_uid reference: 2017 怡孚和融→国兴大厦; 2025 彩和律师 remains unresolved')
  end,
  updated_at=now()
where ar.historical_name='国兴大厦'
  and ar.resolution_status='NEEDS_REVIEW';

do $$
declare v_reference integer; v_unmapped integer; v_alias integer;
begin
  select count(*) into v_reference
  from public.lease_transactions_read_v1
  where record_source='history'
    and trim(new_building)='国兴大厦'
    and building_match_scope='reference';

  select count(*) into v_unmapped
  from public.lease_transactions_read_v1
  where record_source='history'
    and trim(new_building)='国兴大厦'
    and building_match_scope='unmapped';

  select count(*) into v_alias
  from public.lease_building_name_map
  where market_code='BJ' and alias_name='国兴大厦';

  if v_reference<>1 or v_unmapped<>1 or v_alias<>0 then
    raise exception '国兴大厦 postcondition reference/unmapped/global_alias=%/%/% expected 1/1/0',
      v_reference,v_unmapped,v_alias;
  end if;
end $$;

commit;
