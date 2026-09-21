
begin;

-- Strong-evidence historical identity resolutions, v24-v29.
-- This migration is idempotent: it can reproduce the verified state on a fresh environment
-- and safely re-assert the current production state without duplicating mappings/evidence.

create temp table _strong_reference_entities(
  canonical_name text primary key,
  district text,
  external_address text,
  former_names jsonb
) on commit drop;

insert into _strong_reference_entities values
('银河SOHO','东城区','北京市东城区南竹杆胡同2号','["银河soho"]'::jsonb),
('建外SOHO','朝阳区','北京市朝阳区东三环中路39号','[]'::jsonb),
('中关村SOHO','海淀区','北京市海淀区中关村高科技广场4号','["中关村soho"]'::jsonb),
('中国人寿金融中心','朝阳区','北京市朝阳区国贸桥东北侧','[]'::jsonb),
('博彦科技大厦','海淀区','北京市海淀区西北旺东路10号院东区7号楼','[]'::jsonb),
('金融街E9大厦','西城区','北京市西城区锦什坊街35号院1号楼','["金融街E9","金融街e9"]'::jsonb);

do $$
declare v_bad integer;
begin
  select count(*) into v_bad
  from _strong_reference_entities e
  join public.buildings b on lower(b.name)=lower(e.canonical_name)
  where b.tracking_scope<>'reference_only';

  if v_bad<>0 then
    raise exception 'strong-evidence migration: reference entity collides with non-reference building count=%',v_bad;
  end if;
end $$;

insert into public.buildings(
  name,city,district,former_names,project_type,is_active,is_entered_market,tracking_scope,notes
)
select
  e.canonical_name,'北京',e.district,e.former_names,
  'reference',false,true,'reference_only',
  concat(
    '历史参考实体，仅用于历史成交身份解析；不参与地图、季度填报、推荐和楼书运营。外部核验地址：',
    e.external_address,'。strong-evidence historical identity governance.'
  )
from _strong_reference_entities e
where not exists (
  select 1 from public.buildings b where lower(b.name)=lower(e.canonical_name)
);

update public.buildings b
set
  city='北京',
  district=coalesce(b.district,e.district),
  former_names=case
    when jsonb_typeof(b.former_names)='array'
      then b.former_names || e.former_names
    else e.former_names
  end,
  project_type='reference',
  is_active=false,
  is_entered_market=true,
  tracking_scope='reference_only'
from _strong_reference_entities e
where lower(b.name)=lower(e.canonical_name)
  and b.tracking_scope='reference_only';

create temp table _strong_reference_aliases(
  historical_name text primary key,
  canonical_name text not null
) on commit drop;

insert into _strong_reference_aliases values
('银河SOHO','银河SOHO'),
('银河soho','银河SOHO'),
('建外SOHO','建外SOHO'),
('中关村SOHO','中关村SOHO'),
('中关村soho','中关村SOHO'),
('中国人寿金融中心','中国人寿金融中心'),
('博彦科技大厦','博彦科技大厦'),
('金融街E9','金融街E9大厦'),
('金融街e9','金融街E9大厦');

do $$
declare v_bad integer;
begin
  select count(*) into v_bad
  from _strong_reference_aliases a
  join public.lease_building_name_map m
    on m.market_code='BJ' and m.alias_name=a.historical_name
  join public.buildings desired
    on desired.name=a.canonical_name and desired.tracking_scope='reference_only'
  where m.building_id<>desired.id;

  if v_bad<>0 then
    raise exception 'strong-evidence migration: reference alias conflict count=%',v_bad;
  end if;
end $$;

insert into public.lease_building_name_map(
  market_code,alias_name,building_id,match_method,verification_status
)
select
  'BJ',a.historical_name,b.id,
  case when a.historical_name=a.canonical_name then 'canonical_name' else 'former_name' end,
  'AUTO_VERIFIED'
from _strong_reference_aliases a
join public.buildings b on b.name=a.canonical_name and b.tracking_scope='reference_only'
on conflict (market_code,alias_name) do update
set building_id=excluded.building_id,
    match_method=excluded.match_method,
    verification_status=excluded.verification_status;

create temp table _strong_exact_targets(
  historical_name text primary key,
  target_name text not null,
  basis text not null
) on commit drop;

insert into _strong_exact_targets values
('DRC外交公寓办公大楼','亮马桥外交办公大楼','OFFICIAL_NAME_ADDRESS_EQUIVALENCE'),
('DRC外交办公大楼','亮马桥外交办公大楼','OFFICIAL_NAME_ADDRESS_EQUIVALENCE'),
('国贸一期','国贸写字楼1座','VERIFIED_NUMERAL_VARIANT_PROPAGATION'),
('中化大厦','西城金茂中心','OFFICIAL_ADDRESS_RENAME_EQUIVALENCE'),
('阳光保险金融中心','阳光金融中心','OFFICIAL_BRAND_NAME_EQUIVALENCE'),
('雷格斯五矿中心','五矿广场','COWORKING_OPERATOR_LOCATION_CORROBORATED'),
('远洋国际中心2期','远洋国际中心二期','VERIFIED_NUMERAL_VARIANT_PROPAGATION'),
('远洋国际中心2期E座','远洋国际中心二期','VERIFIED_NUMERAL_VARIANT_PROPAGATION'),
('清华科技园Ｄ座','清华科技园创新大厦','FULLWIDTH_ASCII_EQUIVALENCE');

do $$
declare v_bad integer;
begin
  select count(*) into v_bad
  from _strong_exact_targets t
  left join public.buildings b
    on b.name=t.target_name and b.tracking_scope='tracked' and b.is_active=true
  where b.id is null;

  if v_bad<>0 then
    raise exception 'strong-evidence migration: missing exact targets count=%',v_bad;
  end if;

  select count(*) into v_bad
  from _strong_exact_targets t
  join public.lease_building_name_map m
    on m.market_code='BJ' and m.alias_name=t.historical_name
  join public.buildings desired
    on desired.name=t.target_name and desired.tracking_scope='tracked'
  where m.building_id<>desired.id;

  if v_bad<>0 then
    raise exception 'strong-evidence migration: exact alias conflict count=%',v_bad;
  end if;
end $$;

insert into public.lease_building_name_map(
  market_code,alias_name,building_id,match_method,verification_status
)
select 'BJ',t.historical_name,b.id,'former_name','AUTO_VERIFIED'
from _strong_exact_targets t
join public.buildings b on b.name=t.target_name and b.tracking_scope='tracked'
on conflict (market_code,alias_name) do update
set building_id=excluded.building_id,
    match_method=excluded.match_method,
    verification_status=excluded.verification_status;

create temp table _strong_project_members(
  historical_name text not null,
  target_name text not null,
  primary key(historical_name,target_name)
) on commit drop;

insert into _strong_project_members values
('鼎好HD3','鼎好DH3-A座'),
('鼎好HD3','鼎好DH3-B/C座');

do $$
declare v_bad integer;
begin
  select count(*) into v_bad
  from _strong_project_members p
  left join public.buildings b
    on b.name=p.target_name and b.tracking_scope='tracked' and b.is_active=true
  where b.id is null;

  if v_bad<>0 then
    raise exception 'strong-evidence migration: missing project members count=%',v_bad;
  end if;
end $$;

insert into public.lease_building_project_map(
  market_code,alias_name,building_id,match_method,verification_status
)
select 'BJ',p.historical_name,b.id,'PARENT_PROJECT_SCOPE','AUTO_VERIFIED_PROJECT'
from _strong_project_members p
join public.buildings b on b.name=p.target_name and b.tracking_scope='tracked'
on conflict (market_code,alias_name,building_id) do update
set match_method=excluded.match_method,
    verification_status=excluded.verification_status;

-- Re-assert governance ledger state without duplicating evidence snapshots.
update public.lease_building_alias_review ar
set
  resolution_status='AUTO_VERIFIED',
  matched_building_id=b.id,
  matched_building_name=b.name,
  resolution_basis=case
    when a.canonical_name='金融街E9大厦' then 'GOVERNMENT_PERMIT_REFERENCE_ENTITY'
    when a.canonical_name='博彦科技大厦' then 'LISTED_COMPANY_OFFICIAL_ADDRESS_REFERENCE_ENTITY'
    else 'OFFICIAL_REFERENCE_ENTITY_CREATED'
  end,
  confidence='ABSOLUTE',
  candidate_count=1,
  candidate_snapshot=jsonb_build_array(jsonb_build_object(
    'building_id',b.id,'building_name',b.name,'tracking_scope','reference_only',
    'resolution','official_reference_entity'
  )),
  resolved_at=coalesce(ar.resolved_at,now()),
  updated_at=now()
from _strong_reference_aliases a
join public.buildings b on b.name=a.canonical_name and b.tracking_scope='reference_only'
where ar.historical_name=a.historical_name;

update public.lease_building_alias_review ar
set
  resolution_status='AUTO_VERIFIED',
  matched_building_id=b.id,
  matched_building_name=b.name,
  resolution_basis=t.basis,
  confidence='ABSOLUTE',
  candidate_count=1,
  candidate_snapshot=jsonb_build_array(jsonb_build_object(
    'building_id',b.id,'building_name',b.name,'resolution','strong_evidence_exact'
  )),
  resolved_at=coalesce(ar.resolved_at,now()),
  updated_at=now()
from _strong_exact_targets t
join public.buildings b on b.name=t.target_name and b.tracking_scope='tracked'
where ar.historical_name=t.historical_name;

update public.lease_building_alias_review ar
set
  resolution_status='AUTO_VERIFIED_PROJECT',
  matched_building_id=null,
  matched_building_name=null,
  resolution_basis='CORRECTED_DH3_PARENT_PROJECT_SCOPE',
  confidence='ABSOLUTE',
  candidate_count=2,
  candidate_snapshot=(
    select jsonb_agg(jsonb_build_object(
      'building_id',b.id,'building_name',b.name,'resolution','verified_parent_project_member'
    ) order by b.name)
    from _strong_project_members p
    join public.buildings b on b.name=p.target_name and b.tracking_scope='tracked'
    where p.historical_name='鼎好HD3'
  ),
  resolved_at=coalesce(ar.resolved_at,now()),
  updated_at=now()
where ar.historical_name='鼎好HD3';

do $$
declare
  v_exact integer;
  v_project integer;
  v_reference integer;
  v_unmapped integer;
  v_ref_entities integer;
begin
  select count(*) into v_exact
  from public.lease_transactions_read_v1
  where record_source='history'
    and building_match_scope='exact'
    and trim(new_building) in (select historical_name from _strong_exact_targets);

  select count(*) into v_project
  from public.lease_transactions_read_v1
  where record_source='history'
    and building_match_scope='project'
    and trim(new_building)='鼎好HD3';

  select count(*) into v_reference
  from public.lease_transactions_read_v1
  where record_source='history'
    and building_match_scope='reference'
    and trim(new_building) in (select historical_name from _strong_reference_aliases);

  select count(*) into v_unmapped
  from public.lease_transactions_read_v1
  where record_source='history'
    and building_match_scope='unmapped'
    and trim(new_building) in (
      select historical_name from _strong_exact_targets
      union
      select historical_name from _strong_reference_aliases
      union
      select '鼎好HD3'
    );

  select count(*) into v_ref_entities
  from public.buildings
  where tracking_scope='reference_only'
    and name in (select canonical_name from _strong_reference_entities);

  if v_exact<>22 or v_project<>3 or v_reference<>22 or v_unmapped<>0 or v_ref_entities<>6 then
    raise exception 'strong-evidence postcondition failed exact/project/reference/unmapped/ref_entities=%/%/%/%/% expected 22/3/22/0/6',
      v_exact,v_project,v_reference,v_unmapped,v_ref_entities;
  end if;
end $$;

commit;
