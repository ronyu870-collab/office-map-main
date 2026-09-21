begin;

insert into public.buildings(name,city,district,former_names,project_type,is_active,is_entered_market,tracking_scope,notes)
select '光华路SOHO','北京','朝阳区','["光华SOHO","光华路SOHO一期"]'::jsonb,
       'reference',false,true,'reference_only',
       '历史参考实体。SOHO中国第一方项目页确认光华路SOHO位于北京市朝阳区光华路22号；北京市城管官方记录使用“光华路SOHO一期”并确认同址。'
where not exists (select 1 from public.buildings where name='光华路SOHO');

insert into public.lease_building_name_map(market_code,alias_name,building_id,match_method,verification_status)
select 'BJ',x.alias_name,b.id,'former_name','AUTO_VERIFIED'
from public.buildings b
cross join lateral (values ('光华SOHO'),('光华路SOHO一期')) x(alias_name)
where b.name='光华路SOHO'
on conflict (market_code,alias_name) do nothing;

update public.lease_building_alias_review ar
set resolution_status='AUTO_VERIFIED',matched_building_id=b.id,matched_building_name=b.name,
    resolution_basis='SOHO_CHINA_FIRST_PARTY_PROJECT_PLUS_BEIJING_GOV_ADDRESS',
    confidence='ABSOLUTE',candidate_count=1,resolved_at=coalesce(ar.resolved_at,now()),updated_at=now()
from public.buildings b
where ar.historical_name='光华SOHO' and b.name='光华路SOHO';

insert into public.buildings(name,city,district,former_names,project_type,is_active,is_entered_market,tracking_scope,notes)
select 'SOHO嘉盛中心','北京','朝阳区','["嘉盛中心"]'::jsonb,
       'reference',false,true,'reference_only',
       '历史参考实体。SOHO中国官方历史确认北京嘉盛中心收购后更名为SOHO嘉盛中心；地址为北京市朝阳区东三环北路甲19号。'
where not exists (select 1 from public.buildings where name='SOHO嘉盛中心');

insert into public.lease_building_name_map(market_code,alias_name,building_id,match_method,verification_status)
select 'BJ','嘉盛中心',b.id,'former_name','AUTO_VERIFIED'
from public.buildings b where b.name='SOHO嘉盛中心'
on conflict (market_code,alias_name) do nothing;

update public.lease_building_alias_review ar
set resolution_status='AUTO_VERIFIED',matched_building_id=b.id,matched_building_name=b.name,
    resolution_basis='SOHO_CHINA_OFFICIAL_RENAME_PLUS_BEIJING_GOV_ADDRESS',
    confidence='ABSOLUTE',candidate_count=1,resolved_at=coalesce(ar.resolved_at,now()),updated_at=now()
from public.buildings b
where ar.historical_name='嘉盛中心' and b.name='SOHO嘉盛中心';

commit;
