begin;
create temp table _refs(historical_name text primary key,canonical_name text not null,district text not null,official_address text not null,authority text not null) on commit drop;
insert into _refs values
('西格玛大厦','西格玛大厦','海淀区','北京市海淀区知春路49号','北京市海淀区消防救援支队'),
('宇飞大厦','宇飞大厦','东城区','北京市东城区东直门外大街42号','北京市东城区人民政府/北京市政府采购');
insert into public.buildings(name,city,district,former_names,project_type,is_active,is_entered_market,tracking_scope,notes)
select t.canonical_name,'北京',t.district,'[]'::jsonb,'reference',false,true,'reference_only',
concat('权威来源确认的历史参考实体，仅用于历史成交身份解析；不参与地图、季度填报、推荐和楼书运营。官方地址：',t.official_address,'；来源：',t.authority,'。')
from _refs t where not exists(select 1 from public.buildings b where trim(b.name)=trim(t.canonical_name));
insert into public.lease_building_name_map(market_code,alias_name,building_id,match_method,verification_status)
select 'BJ',t.historical_name,b.id,'canonical_name','AUTO_VERIFIED'
from _refs t join public.buildings b on b.name=t.canonical_name and b.tracking_scope='reference_only'
on conflict (market_code,alias_name) do nothing;
update public.lease_building_alias_review ar
set resolution_status='AUTO_VERIFIED',matched_building_id=b.id,matched_building_name=b.name,
resolution_basis='AUTHORITATIVE_GOVERNMENT_REFERENCE_ENTITY',confidence='ABSOLUTE',candidate_count=1,
candidate_snapshot=jsonb_build_array(jsonb_build_object('building_id',b.id,'building_name',b.name,'tracking_scope','reference_only','resolution','authoritative_reference_entity')),
review_notes=case when coalesce(ar.review_notes,'') like '%authoritative government reference-only entity%' then ar.review_notes else concat_ws(' | ',nullif(ar.review_notes,''),'authoritative government reference-only entity') end,
resolved_at=coalesce(ar.resolved_at,now()),updated_at=now()
from _refs t join public.buildings b on b.name=t.canonical_name and b.tracking_scope='reference_only'
where ar.historical_name=t.historical_name;
do $$ declare v_reference integer; v_unmapped integer; v_leak integer; begin
select count(*) into v_reference from public.lease_transactions_read_v1 where record_source='history' and trim(new_building) in(select historical_name from _refs) and building_match_scope='reference';
select count(*) into v_unmapped from public.lease_transactions_read_v1 where record_source='history' and trim(new_building) in(select historical_name from _refs) and building_match_scope='unmapped';
select count(*) into v_leak from public.buildings b join _refs t on b.name=t.canonical_name where b.is_active=true or b.tracking_scope<>'reference_only';
if v_reference<>4 or v_unmapped<>0 or v_leak<>0 then raise exception 'reference postcondition reference/unmapped/leak=%/%/% expected 4/0/0',v_reference,v_unmapped,v_leak; end if;
end $$;
commit;