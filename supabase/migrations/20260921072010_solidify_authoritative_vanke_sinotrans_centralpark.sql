begin;

-- Reassert authoritative aliases idempotently.
insert into public.lease_building_name_map(market_code,alias_name,building_id,match_method,verification_status)
select 'BJ',x.alias_name,b.id,'former_name','AUTO_VERIFIED'
from public.buildings b
cross join lateral (values ('万科十里堡'),('万科时代中心-十里')) x(alias_name)
where b.name='万科时代中心·十里'
on conflict (market_code,alias_name) do nothing;

insert into public.lease_building_name_map(market_code,alias_name,building_id,match_method,verification_status)
select 'BJ','万科奥林',b.id,'former_name','AUTO_VERIFIED'
from public.buildings b where b.name='万科时代中心奥林'
on conflict (market_code,alias_name) do nothing;

insert into public.lease_building_name_map(market_code,alias_name,building_id,match_method,verification_status)
select 'BJ','中外运大厦',b.id,'former_name','AUTO_VERIFIED'
from public.buildings b where b.name='外运大厦'
on conflict (market_code,alias_name) do nothing;

-- 中央公园广场 / Kr Space: row-level project scope only.
insert into public.lease_building_record_project_map(
  source_uid,building_id,market_code,match_method,verification_status,evidence_snapshot
)
values(
  'b5cb6e8275e076c7ede5f07dfa0c7a19497578a3d65d64a95332b545f770ef1b',
  'f7d48781-17d2-4109-9dbb-7f854a79151f',
  'BJ','historical_tenant_official_project_location','AUTO_VERIFIED_RECORD_PROJECT',
  jsonb_build_array(jsonb_build_object(
    'type','row_level_project_evidence',
    'tenant','Kr Space氪空间',
    'historical_label','中央公园广场',
    'detail','氪空间官方资料确认其总部迁入骏豪·中央公园广场，仅确认项目范围。'))
)
on conflict (source_uid,building_id) do update
set match_method=excluded.match_method,
    verification_status=excluded.verification_status,
    evidence_snapshot=excluded.evidence_snapshot,
    updated_at=now();

commit;
