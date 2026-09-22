begin;

insert into public.lease_building_record_map(
  source_uid,building_id,market_code,match_method,verification_status,evidence_snapshot
)
values(
  '768b0ed7967a9093109068f24ef30ded6ef1705f6be4c657ec6470778d7e1f52',
  'e8f0bb18-2f8b-4e6b-889c-b174d6315c72',
  'BJ',
  'historical_tenant_government_registration',
  'AUTO_VERIFIED_RECORD',
  jsonb_build_array(jsonb_build_object(
    'type','historical_tenant_government_registration',
    'verified_at','2026-09-22',
    'tenant','北京科旭威尔科技股份有限公司',
    'historical_building_label','北方地产',
    'evidence','国家知识产权局专利文件载明科旭威尔地址为北京市海淀区紫竹院路81号院3号楼13层12A05；北京市12345服务导图（市交通委数据）确认北方地产大厦办公地址为海淀区紫竹院路81号。',
    'target_name','北方地产大厦'
  ))
)
on conflict (source_uid) do update
set building_id=excluded.building_id,
    market_code=excluded.market_code,
    match_method=excluded.match_method,
    verification_status=excluded.verification_status,
    evidence_snapshot=excluded.evidence_snapshot,
    updated_at=now();

do $$
declare v_scope text;
begin
  select building_match_scope into v_scope
  from public.lease_transactions_read_v1
  where record_source='history'
    and source_uid='768b0ed7967a9093109068f24ef30ded6ef1705f6be4c657ec6470778d7e1f52';

  if v_scope<>'reference' then
    raise exception 'KXWELL row postcondition expected reference got %',v_scope;
  end if;
end $$;

commit;
