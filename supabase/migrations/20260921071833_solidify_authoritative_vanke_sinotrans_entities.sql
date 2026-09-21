begin;

-- 万科时代中心·十里 reference-only
insert into public.buildings(name,city,district,former_names,project_type,is_active,is_entered_market,tracking_scope,notes)
select '万科时代中心·十里','北京','朝阳区','["万科十里堡","万科时代中心-十里"]'::jsonb,
       'reference',false,true,'reference_only',
       '历史参考实体，仅用于历史成交身份解析；不参与地图、季度填报、推荐和楼书运营。'
where not exists (select 1 from public.buildings where name='万科时代中心·十里');

insert into public.lease_building_name_map(market_code,alias_name,building_id,match_method,verification_status)
select 'BJ',x.alias_name,b.id,'former_name','AUTO_VERIFIED'
from public.buildings b
cross join lateral (values ('万科十里堡'),('万科时代中心-十里')) x(alias_name)
where b.name='万科时代中心·十里'
on conflict (market_code,alias_name) do nothing;

update public.lease_building_alias_review ar
set resolution_status='AUTO_VERIFIED', matched_building_id=b.id, matched_building_name=b.name,
    resolution_basis='BEIJING_OFFICIAL_PROJECT_NAME_PLUS_TENANT_FIRST_PARTY_ADDRESS',
    confidence='ABSOLUTE', candidate_count=1, resolved_at=coalesce(ar.resolved_at,now()), updated_at=now()
from public.buildings b
where ar.historical_name in ('万科十里堡','万科时代中心-十里') and b.name='万科时代中心·十里';

-- 万科奥林 exact
insert into public.lease_building_name_map(market_code,alias_name,building_id,match_method,verification_status)
select 'BJ','万科奥林',b.id,'former_name','AUTO_VERIFIED'
from public.buildings b
where b.name='万科时代中心奥林' and b.tracking_scope='tracked'
on conflict (market_code,alias_name) do nothing;

update public.lease_building_alias_review ar
set resolution_status='AUTO_VERIFIED', matched_building_id=b.id, matched_building_name=b.name,
    resolution_basis='DEVELOPER_FIRST_PARTY_PROJECT_NAME_PLUS_TENANT_OFFICIAL_ADDRESS',
    confidence='ABSOLUTE', candidate_count=1, resolved_at=coalesce(ar.resolved_at,now()), updated_at=now()
from public.buildings b
where ar.historical_name='万科奥林' and b.name='万科时代中心奥林';

-- 中外运大厦 -> 外运大厦 reference
insert into public.lease_building_name_map(market_code,alias_name,building_id,match_method,verification_status)
select 'BJ','中外运大厦',b.id,'former_name','AUTO_VERIFIED'
from public.buildings b
where b.name='外运大厦' and b.tracking_scope='reference_only'
on conflict (market_code,alias_name) do nothing;

update public.lease_building_alias_review ar
set resolution_status='AUTO_VERIFIED', matched_building_id=b.id, matched_building_name=b.name,
    resolution_basis='SINOTRANS_FIRST_PARTY_LEGACY_NAME_PLUS_OFFICIAL_ADDRESS',
    confidence='ABSOLUTE', candidate_count=1, resolved_at=coalesce(ar.resolved_at,now()), updated_at=now()
from public.buildings b
where ar.historical_name='中外运大厦' and b.name='外运大厦';

commit;
