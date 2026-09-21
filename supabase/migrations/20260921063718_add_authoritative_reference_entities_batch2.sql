begin;

create temp table _auth_refs(
  historical_name text primary key,
  canonical_name text not null,
  district text not null,
  official_address text not null,
  authority text not null
) on commit drop;

insert into _auth_refs values
('力宝广场','力宝广场','大兴区','北京市大兴区亦庄经济技术开发区荣华中路与北环中路交汇处东南角','北京市人民政府门户网站'),
('世宁大厦','世宁大厦','海淀区','北京市海淀区学院路35号','北京市政府采购电子交易平台/公共资源交易'),
('住邦2000','住邦2000商务中心','朝阳区','北京市朝阳区八里庄西里98号','北京市政府采购/公共资源交易');

insert into public.buildings(
  name,city,district,former_names,project_type,is_active,is_entered_market,tracking_scope,notes
)
select
  t.canonical_name,'北京',t.district,
  case when t.historical_name<>t.canonical_name then to_jsonb(array[t.historical_name]) else '[]'::jsonb end,
  'reference',false,true,'reference_only',
  concat('权威来源确认的历史参考实体，仅用于历史成交身份解析；不参与地图、季度填报、推荐和楼书运营。官方地址：',
         t.official_address,'；来源：',t.authority,'。')
from _auth_refs t
where not exists (
  select 1 from public.buildings b where trim(b.name)=trim(t.canonical_name)
);

insert into public.lease_building_name_map(
  market_code,alias_name,building_id,match_method,verification_status
)
select
  'BJ',t.historical_name,b.id,
  case when t.historical_name=t.canonical_name then 'canonical_name' else 'former_name' end,
  'AUTO_VERIFIED'
from _auth_refs t
join public.buildings b on b.name=t.canonical_name and b.tracking_scope='reference_only'
on conflict (market_code,alias_name) do nothing;

update public.lease_building_alias_review ar
set
  resolution_status='AUTO_VERIFIED',
  matched_building_id=b.id,
  matched_building_name=b.name,
  resolution_basis='AUTHORITATIVE_GOVERNMENT_REFERENCE_ENTITY',
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
from _auth_refs t
join public.buildings b on b.name=t.canonical_name and b.tracking_scope='reference_only'
where ar.historical_name=t.historical_name;

do $$
declare v_reference integer; v_unmapped integer; v_operational_leak integer;
begin
  select count(*) into v_reference
  from public.lease_transactions_read_v1 r
  where r.record_source='history'
    and trim(r.new_building) in (select historical_name from _auth_refs)
    and r.building_match_scope='reference';

  select count(*) into v_unmapped
  from public.lease_transactions_read_v1 r
  where r.record_source='history'
    and trim(r.new_building) in (select historical_name from _auth_refs)
    and r.building_match_scope='unmapped';

  select count(*) into v_operational_leak
  from public.buildings b
  join _auth_refs t on t.canonical_name=b.name
  where b.is_active=true or b.tracking_scope<>'reference_only';

  if v_reference<>6 or v_unmapped<>0 or v_operational_leak<>0 then
    raise exception 'reference postcondition reference/unmapped/leak=%/%/% expected 6/0/0',
      v_reference,v_unmapped,v_operational_leak;
  end if;
end $$;

commit;
