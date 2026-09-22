begin;

-- 2026-09-22 strong-evidence continuation.
-- This migration is intentionally idempotent and preserves row-level precision.

insert into public.lease_building_name_map(market_code,alias_name,building_id,match_method,verification_status)
values
('BJ','国寿中心','75cccccb-154b-4a9f-9ec7-385bd0c79126','former_name','AUTO_VERIFIED'),
('BJ','东升三期','93a3c5db-e991-440b-ba12-4305d4ebd572','former_name','AUTO_VERIFIED')
on conflict (market_code,alias_name) do nothing;

update public.lease_building_alias_review
set resolution_status='AUTO_VERIFIED',
    matched_building_id='75cccccb-154b-4a9f-9ec7-385bd0c79126',
    matched_building_name='中国人寿金融中心',
    resolution_basis='TENANT_FIRST_PARTY_ADDRESS_PLUS_PROJECT_NAME_EQUIVALENCE',
    confidence='ABSOLUTE',
    candidate_count=1,
    resolved_at=coalesce(resolved_at,now()),
    updated_at=now()
where historical_name='国寿中心';

update public.lease_building_alias_review
set resolution_status='AUTO_VERIFIED',
    matched_building_id='93a3c5db-e991-440b-ba12-4305d4ebd572',
    matched_building_name='中关村东升科技园·东畔科创中心',
    resolution_basis='FIRST_PARTY_AND_GOVERNMENT_PROJECT_NAME_EQUIVALENCE',
    confidence='ABSOLUTE',
    candidate_count=1,
    resolved_at=coalesce(resolved_at,now()),
    updated_at=now()
where historical_name='东升三期';

insert into public.lease_building_record_map(
  source_uid,building_id,market_code,match_method,verification_status,evidence_snapshot
)
values
(
'a8383509d0a87ae135b5c3d13061ba5e754b21fbe3eb34f1de821de53051d5d0',
'6a59f2eb-ff19-4b86-aa14-809ce0aa8a9a',
'BJ','historical_company_authoritative_address','AUTO_VERIFIED_RECORD',
jsonb_build_array(jsonb_build_object(
  'type','listed_company_disclosure_address',
  'verified_at','2026-09-22',
  'detail','北京金通港房地产注册地址为朝阳门外大街甲6号16层4座；与万通中心D座地址闭环。'
))
),
(
'42a0322299f08a6bd271f09d763dbc0ff35ed5cb98bea9fdd5d61b19817ea519',
'dbb0029c-12ef-475c-a4e0-80fc36f0443f',
'BJ','historical_tenant_official_address','AUTO_VERIFIED_RECORD',
jsonb_build_array(jsonb_build_object(
  'type','issuer_annual_report_address',
  'verified_at','2026-09-22',
  'detail','浙商证券北京分公司公开地址为朝阳区光华东里8号院2号楼；与CBD中海/中海广场地址闭环。'
))
),
(
'ef9848207b813fa131886dff6101e896d062e6ad967d4326bd401e5dcff1f194',
'f097e6a7-37d9-4a46-8094-557020a37f86',
'BJ','historical_tenant_official_address','AUTO_VERIFIED_RECORD',
jsonb_build_array(jsonb_build_object(
  'type','issuer_official_tower_address',
  'verified_at','2026-09-22',
  'detail','华创证券公开披露办公地址为西城区锦什坊街26号恒奥中心C座；历史标签为恒奥大厦C座。'
))
)
on conflict (source_uid) do update
set building_id=excluded.building_id,
    market_code=excluded.market_code,
    match_method=excluded.match_method,
    verification_status=excluded.verification_status,
    evidence_snapshot=excluded.evidence_snapshot,
    updated_at=now();

insert into public.lease_building_record_project_map(
  source_uid,building_id,market_code,match_method,verification_status,evidence_snapshot
)
values
(
'2b0965096a879c16512430924b32c6c8173293026a5929d4aec953ee6d69e169',
'4b602aa7-80e1-4351-aac7-e5709fcb17b0',
'BJ','historical_name_plus_authoritative_district_context','AUTO_VERIFIED_RECORD_PROJECT',
jsonb_build_array(jsonb_build_object(
  'type','government_enterprise_district_evidence',
  'verified_at','2026-09-22',
  'detail','北京华云互联科技有限公司由官方资料定位于石景山区/石景山园；历史标签中海大厦，因此仅确认到石景山中海大厦项目，不推断塔楼。'
))
),
(
'2b0965096a879c16512430924b32c6c8173293026a5929d4aec953ee6d69e169',
'5dfe3499-43e8-49a3-a8f0-9129188fffe2',
'BJ','historical_name_plus_authoritative_district_context','AUTO_VERIFIED_RECORD_PROJECT',
jsonb_build_array(jsonb_build_object(
  'type','government_enterprise_district_evidence',
  'verified_at','2026-09-22',
  'detail','北京华云互联科技有限公司由官方资料定位于石景山区/石景山园；历史标签中海大厦，因此仅确认到石景山中海大厦项目，不推断塔楼。'
))
)
on conflict (source_uid,building_id) do update
set match_method=excluded.match_method,
    verification_status=excluded.verification_status,
    evidence_snapshot=excluded.evidence_snapshot,
    updated_at=now();

do $$
declare v integer;
begin
  select count(*) into v from public.lease_transactions_read_v1
   where record_source='history' and trim(new_building)='国寿中心' and building_match_scope='reference';
  if v<>2 then raise exception '国寿中心 expected 2 reference rows, got %',v; end if;

  select count(*) into v from public.lease_transactions_read_v1
   where record_source='history' and trim(new_building)='东升三期' and building_match_scope='exact';
  if v<>4 then raise exception '东升三期 expected 4 exact rows, got %',v; end if;

  select count(*) into v from public.lease_transactions_read_v1
   where record_source='history'
     and source_uid in (
       'a8383509d0a87ae135b5c3d13061ba5e754b21fbe3eb34f1de821de53051d5d0',
       '42a0322299f08a6bd271f09d763dbc0ff35ed5cb98bea9fdd5d61b19817ea519',
       'ef9848207b813fa131886dff6101e896d062e6ad967d4326bd401e5dcff1f194'
     )
     and building_match_scope='exact';
  if v<>3 then raise exception 'row exact expected 3, got %',v; end if;

  select count(*) into v from public.lease_transactions_read_v1
   where record_source='history'
     and source_uid='2b0965096a879c16512430924b32c6c8173293026a5929d4aec953ee6d69e169'
     and building_match_scope='project'
     and cardinality(related_building_ids)=2;
  if v<>1 then raise exception '华云互联 row-project postcondition failed'; end if;
end $$;

commit;
