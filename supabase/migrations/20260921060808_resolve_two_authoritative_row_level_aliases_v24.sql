begin;

create temp table _v24_record_targets(
  source_uid text primary key,
  building_id uuid not null,
  match_method text not null,
  evidence jsonb not null
) on commit drop;

insert into _v24_record_targets values
(
'd08948435c4bcbd9c34763225111359cb71aafd4ece4bdcff109832bc128c6e2',
'dc660eef-bdad-4143-81a4-fd318a283c5b',
'historical_tenant_official_address',
jsonb_build_array(
  jsonb_build_object(
    'type','historical_tenant_address',
    'tenant','华信君融（北京）资产管理有限公司',
    'historical_building_label','中国人寿',
    'evidence','公开企业地址为北京市朝阳区朝外大街16号1幢；公开实地报道确认其办公地点为中国人寿大厦。',
    'verified_at','2026-09-21'
  )
)
),
(
'365ee31647834d0b9b6247fc97e96f4ae3a5f03cd00f4aa8c791da56916a3e3c',
'4b602aa7-80e1-4351-aac7-e5709fcb17b0',
'historical_tenant_government_location',
jsonb_build_array(
  jsonb_build_object(
    'type','historical_tenant_location',
    'tenant','中国平安人寿保险股份有限公司北京分公司',
    'historical_building_label','中海大厦',
    'evidence','2025年北京本地公开招聘信息载明联系地址为北京市石景山区中海大厦B座10层1001-1室，与历史成交年份、楼名及当前B座实体一致。',
    'verified_at','2026-09-21'
  )
)
);

insert into public.lease_building_record_map(
  source_uid,building_id,market_code,match_method,verification_status,evidence_snapshot
)
select source_uid,building_id,'BJ',match_method,'AUTO_VERIFIED_RECORD',evidence
from _v24_record_targets
on conflict (source_uid) do update
set building_id=excluded.building_id,
    market_code=excluded.market_code,
    match_method=excluded.match_method,
    verification_status=excluded.verification_status,
    evidence_snapshot=excluded.evidence_snapshot,
    updated_at=now();

do $$
declare v_exact integer; v_unmapped integer;
begin
  select count(*) into v_exact
  from public.lease_transactions_read_v1 r
  where r.record_source='history'
    and r.source_uid in (select source_uid from _v24_record_targets)
    and r.building_match_scope='exact';

  select count(*) into v_unmapped
  from public.lease_transactions_read_v1 r
  where r.record_source='history'
    and r.source_uid in (select source_uid from _v24_record_targets)
    and r.building_match_scope='unmapped';

  if v_exact<>2 or v_unmapped<>0 then
    raise exception 'v24 postcondition failed exact/unmapped=%/% expected 2/0',v_exact,v_unmapped;
  end if;
end $$;

commit;
