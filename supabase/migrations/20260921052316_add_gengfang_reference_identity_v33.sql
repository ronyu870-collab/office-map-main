begin;

do $$
declare v_bad integer;
begin
  select count(*) into v_bad
  from public.buildings
  where lower(trim(name))=lower(trim('庚坊国际大厦'))
    and tracking_scope<>'reference_only';

  if v_bad<>0 then
    raise exception 'v33 building collision count=%',v_bad;
  end if;

  select count(*) into v_bad
  from public.lease_building_name_map m
  join public.buildings b on b.id=m.building_id
  where m.market_code='BJ'
    and m.alias_name in ('庚坊','庚坊国际大厦')
    and b.name<>'庚坊国际大厦';

  if v_bad<>0 then
    raise exception 'v33 alias collision count=%',v_bad;
  end if;
end $$;

insert into public.buildings(
  name,city,district,former_names,project_type,
  is_active,is_entered_market,tracking_scope,notes
)
select
  '庚坊国际大厦','北京','海淀区','[]'::jsonb,'reference',
  false,true,'reference_only',
  '历史参考实体，仅用于历史成交身份解析；不参与地图、季度填报、推荐和楼书运营。权威核验地址：北京市海淀区花园路甲13号院7号楼。强证据：票通信息技术官网、锐服信科技官网均明确列示庚坊国际大厦办公地址；天翼云公开技术社区邮件亦使用“庚坊大厦5层”。'
where not exists (
  select 1 from public.buildings
  where lower(trim(name))=lower(trim('庚坊国际大厦'))
);

insert into public.lease_building_name_map(
  market_code,alias_name,building_id,match_method,verification_status
)
select 'BJ','庚坊',id,'former_name','AUTO_VERIFIED'
from public.buildings
where name='庚坊国际大厦' and tracking_scope='reference_only'
on conflict (market_code,alias_name) do update
set building_id=excluded.building_id,
    match_method=excluded.match_method,
    verification_status=excluded.verification_status;

insert into public.lease_building_name_map(
  market_code,alias_name,building_id,match_method,verification_status
)
select 'BJ','庚坊国际大厦',id,'canonical_name','AUTO_VERIFIED'
from public.buildings
where name='庚坊国际大厦' and tracking_scope='reference_only'
on conflict (market_code,alias_name) do update
set building_id=excluded.building_id,
    match_method=excluded.match_method,
    verification_status=excluded.verification_status;

update public.lease_building_alias_review ar
set
  resolution_status='AUTO_VERIFIED',
  matched_building_id=b.id,
  matched_building_name=b.name,
  resolution_basis='MULTI_TENANT_OFFICIAL_ADDRESS_REFERENCE_ENTITY',
  confidence='ABSOLUTE',
  candidate_count=1,
  candidate_snapshot=jsonb_build_array(jsonb_build_object(
    'building_id',b.id,'building_name',b.name,
    'tracking_scope','reference_only','resolution','multi_tenant_official_address'
  )),
  evidence_snapshot=case
    when ar.resolution_basis='MULTI_TENANT_OFFICIAL_ADDRESS_REFERENCE_ENTITY'
      and coalesce(ar.review_notes,'') like '%v33 multi-tenant official-address reference identity%'
      then ar.evidence_snapshot
    else coalesce(ar.evidence_snapshot,'[]'::jsonb) ||
      jsonb_build_array(jsonb_build_object(
        'type','multi_tenant_official_address',
        'verified_at','2026-09-21',
        'detail','票通信息技术官网地址为北京市海淀区花园路甲13号庚坊国际大厦；锐服信科技官网地址为花园路甲13号院7号楼庚坊国际大厦6层601；历史记录中两家公司均位于“庚坊”。天翼云公开技术邮件另写“庚坊大厦5层”。'
      ))
  end,
  review_notes=case
    when coalesce(ar.review_notes,'') like '%v33 multi-tenant official-address reference identity%'
      then ar.review_notes
    else concat_ws(' | ',nullif(ar.review_notes,''),'v33 multi-tenant official-address reference identity')
  end,
  resolved_at=coalesce(ar.resolved_at,now()),
  updated_at=now()
from public.buildings b
where ar.historical_name='庚坊'
  and b.name='庚坊国际大厦'
  and b.tracking_scope='reference_only';

do $$
declare v_reference integer; v_assignments integer;
begin
  select count(*) into v_reference
  from public.lease_transactions_read_v1
  where record_source='history'
    and building_match_scope='reference'
    and trim(new_building)='庚坊';

  select count(*) into v_assignments
  from public.building_assignments a
  join public.buildings b on b.id=a.building_id
  where b.name='庚坊国际大厦'
    and b.tracking_scope='reference_only';

  if v_reference<>3 or v_assignments<>0 then
    raise exception 'v33 postcondition reference/assignments=%/% expected 3/0',
      v_reference,v_assignments;
  end if;
end $$;

commit;
