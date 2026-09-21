begin;

create temp table _v31_reference_entities(
  canonical_name text primary key,
  district text not null,
  external_address text not null,
  evidence_basis text not null
) on commit drop;

insert into _v31_reference_entities values
('北京国际大厦','海淀区','北京市海淀区中关村南大街甲18号院','GOVERNMENT_PROCUREMENT_AND_OFFICIAL_TENANT_ADDRESS'),
('潮驿178','朝阳区','北京市朝阳区北苑路28号院1','BEIJING_CITY_MANAGEMENT_AND_LISTED_COMPANY_ADDRESS'),
('金融街公寓','西城区','北京市西城区金融街金城坊1号','XICHENG_GOVERNMENT_POI_ADDRESS');

do $$
declare v_bad integer;
begin
  select count(*) into v_bad
  from _v31_reference_entities e
  join public.buildings b
    on lower(trim(b.name))=lower(trim(e.canonical_name))
  where b.tracking_scope<>'reference_only';
  if v_bad<>0 then
    raise exception 'v31 reference collision with non-reference buildings=%',v_bad;
  end if;
end $$;

insert into public.buildings(
  name,city,district,former_names,project_type,
  is_active,is_entered_market,tracking_scope,notes
)
select
  e.canonical_name,'北京',e.district,'[]'::jsonb,'reference',
  false,true,'reference_only',
  concat(
    '历史参考实体，仅用于历史成交身份解析；不参与地图、季度填报、推荐和楼书运营。',
    '权威核验地址：',e.external_address,'。',
    '证据口径：',e.evidence_basis,'。'
  )
from _v31_reference_entities e
where not exists (
  select 1 from public.buildings b
  where lower(trim(b.name))=lower(trim(e.canonical_name))
);

update public.buildings b
set
  city='北京',
  district=coalesce(b.district,e.district),
  project_type='reference',
  is_active=false,
  is_entered_market=true,
  tracking_scope='reference_only'
from _v31_reference_entities e
where lower(trim(b.name))=lower(trim(e.canonical_name))
  and b.tracking_scope='reference_only';

create temp table _v31_global_aliases(
  historical_name text primary key,
  canonical_name text not null,
  basis text not null
) on commit drop;

insert into _v31_global_aliases values
('北京.国际','北京国际大厦','OFFICIAL_ADDRESS_PLUS_STYLIZED_PROJECT_NAME'),
('北京国际大厦','北京国际大厦','GOVERNMENT_PROCUREMENT_CANONICAL_NAME_ADDRESS'),
('潮驿178','潮驿178','BEIJING_CITY_MANAGEMENT_CANONICAL_NAME_ADDRESS'),
('金融街公寓','金融街公寓','XICHENG_GOVERNMENT_CANONICAL_NAME_ADDRESS');

do $$
declare v_bad integer;
begin
  select count(*) into v_bad
  from _v31_global_aliases a
  join public.lease_building_name_map m
    on m.market_code='BJ' and m.alias_name=a.historical_name
  join public.buildings b
    on b.name=a.canonical_name and b.tracking_scope='reference_only'
  where m.building_id<>b.id;
  if v_bad<>0 then
    raise exception 'v31 global alias conflict=%',v_bad;
  end if;
end $$;

insert into public.lease_building_name_map(
  market_code,alias_name,building_id,match_method,verification_status
)
select
  'BJ',a.historical_name,b.id,
  case when a.historical_name=a.canonical_name then 'canonical_name' else 'former_name' end,
  'AUTO_VERIFIED'
from _v31_global_aliases a
join public.buildings b
  on b.name=a.canonical_name and b.tracking_scope='reference_only'
on conflict (market_code,alias_name) do update
set building_id=excluded.building_id,
    match_method=excluded.match_method,
    verification_status=excluded.verification_status;

update public.lease_building_alias_review ar
set
  resolution_status='AUTO_VERIFIED',
  matched_building_id=b.id,
  matched_building_name=b.name,
  resolution_basis=a.basis,
  confidence='ABSOLUTE',
  candidate_count=1,
  candidate_snapshot=jsonb_build_array(jsonb_build_object(
    'building_id',b.id,'building_name',b.name,
    'tracking_scope','reference_only','resolution','strong_evidence_reference_entity'
  )),
  evidence_snapshot=case
    when ar.resolution_basis=a.basis and coalesce(ar.review_notes,'') like '%v31 authoritative reference-only identity%'
      then ar.evidence_snapshot
    else coalesce(ar.evidence_snapshot,'[]'::jsonb) ||
      jsonb_build_array(jsonb_build_object(
        'type','authoritative_reference_entity',
        'verified_at','2026-09-21',
        'basis',a.basis,
        'canonical_name',b.name
      ))
  end,
  review_notes=case
    when coalesce(ar.review_notes,'') like '%v31 authoritative reference-only identity%'
      then ar.review_notes
    else concat_ws(' | ',nullif(ar.review_notes,''),'v31 authoritative reference-only identity')
  end,
  resolved_at=coalesce(ar.resolved_at,now()),
  updated_at=now()
from _v31_global_aliases a
join public.buildings b
  on b.name=a.canonical_name and b.tracking_scope='reference_only'
where ar.historical_name=a.historical_name;

create temp table _v31_row_overrides(
  source_uid text primary key,
  historical_name text not null,
  canonical_name text not null,
  match_method text not null,
  evidence jsonb not null
) on commit drop;

insert into _v31_row_overrides values
(
  '85ca249ec0a486316835727790e4f567d2c097a811249756be03e4164b8c3b99',
  '北京国际','北京国际大厦','historical_tenant_plus_official_project_evidence',
  jsonb_build_array(jsonb_build_object(
    'type','row_level_tenant_and_project_evidence','tenant','柏涛建筑',
    'detail','历史记录商圈为中关村；公开楼宇入驻企业资料列示柏涛建筑设计（北京）有限公司位于北京国际大厦。泛称“北京国际”不建立全局 alias。'
  ))
),
(
  'b047bcc54895eb5eb0e97589a30e2af9c23e8c23dd01a601ea85354246c06c46',
  '北京国际中心','北京国际大厦','historical_tenant_official_address',
  jsonb_build_array(jsonb_build_object(
    'type','row_level_official_tenant_address','tenant','北大口腔',
    'detail','北京大学口腔医院官网明确国合门诊部/国际门诊位于海淀区北京国际大厦B座，历史记录为2023Q1北大口腔。泛称“北京国际中心”不建立全局 alias。'
  ))
);

do $$
declare v_bad integer;
begin
  select count(*) into v_bad
  from _v31_row_overrides o
  left join public.lease_transactions_history h on h.source_uid=o.source_uid
  left join public.buildings b
    on b.name=o.canonical_name and b.tracking_scope='reference_only'
  left join public.lease_building_record_map rm on rm.source_uid=o.source_uid
  where h.source_uid is null
     or trim(h.new_building)<>o.historical_name
     or b.id is null
     or (rm.building_id is not null and rm.building_id<>b.id);
  if v_bad<>0 then
    raise exception 'v31 row override conflict=%',v_bad;
  end if;
end $$;

insert into public.lease_building_record_map(
  source_uid,building_id,market_code,match_method,
  verification_status,evidence_snapshot,updated_at
)
select
  o.source_uid,b.id,'BJ',o.match_method,
  'AUTO_VERIFIED_RECORD',o.evidence,now()
from _v31_row_overrides o
join public.buildings b
  on b.name=o.canonical_name and b.tracking_scope='reference_only'
on conflict (source_uid) do update
set building_id=excluded.building_id,
    market_code=excluded.market_code,
    match_method=excluded.match_method,
    verification_status=excluded.verification_status,
    evidence_snapshot=excluded.evidence_snapshot,
    updated_at=excluded.updated_at;

update public.lease_building_alias_review ar
set
  evidence_snapshot=case
    when coalesce(ar.review_notes,'') like '%v31 partial source_uid resolution to 北京国际大厦%'
      then ar.evidence_snapshot
    else coalesce(ar.evidence_snapshot,'[]'::jsonb) ||
      jsonb_build_array(jsonb_build_object(
        'type','partial_source_uid_reference_resolution',
        'verified_at','2026-09-21'
      ))
  end,
  review_notes=case
    when coalesce(ar.review_notes,'') like '%v31 partial source_uid resolution to 北京国际大厦%'
      then ar.review_notes
    else concat_ws(
      ' | ',nullif(ar.review_notes,''),
      'v31 partial source_uid resolution to 北京国际大厦; global alias deliberately not created'
    )
  end,
  updated_at=now()
where ar.historical_name in ('北京国际','北京国际中心')
  and ar.resolution_status='NEEDS_REVIEW';

do $$
declare
  v_reference integer;
  v_unmapped integer;
  v_assignments integer;
begin
  select count(*) into v_reference
  from public.lease_transactions_read_v1 r
  where r.record_source='history'
    and r.building_match_scope='reference'
    and trim(r.new_building) in (
      '北京.国际','北京国际','北京国际中心','北京国际大厦',
      '潮驿178','金融街公寓'
    );

  select count(*) into v_unmapped
  from public.lease_transactions_read_v1 r
  where r.record_source='history'
    and r.building_match_scope='unmapped'
    and trim(r.new_building) in (
      '北京.国际','北京国际','北京国际中心','北京国际大厦',
      '潮驿178','金融街公寓'
    );

  select count(*) into v_assignments
  from public.building_assignments a
  join public.buildings b on b.id=a.building_id
  where b.name in ('北京国际大厦','潮驿178','金融街公寓')
    and b.tracking_scope='reference_only';

  if v_reference<>15 or v_unmapped<>0 or v_assignments<>0 then
    raise exception 'v31 postcondition failed reference/unmapped/assignments=%/%/% expected 15/0/0',
      v_reference,v_unmapped,v_assignments;
  end if;
end $$;

commit;
