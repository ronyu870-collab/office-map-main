begin;

insert into public.buildings(name,city,district,former_names,project_type,is_active,is_entered_market,tracking_scope,notes)
select '住总大厦','北京','朝阳区','[]'::jsonb,
       'reference',false,true,'reference_only',
       '历史参考实体。北京市发展和改革委员会节能技改项目材料明确：住总大厦项目地点位于光华路25号。'
where not exists (select 1 from public.buildings where name='住总大厦');

insert into public.lease_building_name_map(market_code,alias_name,building_id,match_method,verification_status)
select 'BJ','住总大厦',b.id,'canonical_name','AUTO_VERIFIED'
from public.buildings b where b.name='住总大厦'
on conflict (market_code,alias_name) do nothing;

update public.lease_building_alias_review ar
set resolution_status='AUTO_VERIFIED',matched_building_id=b.id,matched_building_name=b.name,
    resolution_basis='BEIJING_FGOV_CANONICAL_BUILDING_NAME_ADDRESS',
    confidence='ABSOLUTE',candidate_count=1,resolved_at=coalesce(ar.resolved_at,now()),updated_at=now()
from public.buildings b
where ar.historical_name='住总大厦' and b.name='住总大厦';

commit;
