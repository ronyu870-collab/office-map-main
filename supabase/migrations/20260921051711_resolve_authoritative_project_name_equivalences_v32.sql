begin;

create temp table _v32_project_targets(
  historical_name text primary key,
  building_id uuid not null,
  basis text not null,
  evidence_detail text not null
) on commit drop;

insert into _v32_project_targets values
(
  '保利大都会',
  '532abb31-8b86-4be7-9f1e-a1850b1a366a',
  'BEIJING_GOVERNMENT_PROJECT_NAME_EQUIVALENCE',
  '北京市政府公开资料使用“通州保利大都会项目”；北京市投资促进公开材料及保利官方资料使用“保利大都汇”项目名，均指向北京通州城市副中心同一保利商办项目。历史名称只确认项目，不推断4#具体楼栋。'
),
(
  '国会一期',
  'd062e344-2f52-4c4b-b38e-d155cc4d3e6e',
  'BEIJING_GOVERNMENT_ABBREVIATION_EQUIVALENCE',
  '北京市政府会展信息正式名称为“国家会议中心一期”，公开报道同时直接使用“国会一期/二期”简称；当前国家会议中心实体former_names包含“国家会议中心一期”。历史名称只按项目级关联。'
);

do $$
declare v_bad integer;
begin
  select count(*) into v_bad
  from _v32_project_targets t
  left join public.buildings b on b.id=t.building_id
  left join public.lease_building_name_map m
    on m.market_code='BJ' and m.alias_name=t.historical_name
  left join public.lease_building_alias_review ar
    on ar.historical_name=t.historical_name
  where b.id is null
     or b.tracking_scope<>'tracked'
     or b.is_active<>true
     or m.building_id is not null
     or ar.historical_name is null;

  if v_bad<>0 then
    raise exception 'v32 safety precondition failed targets=%',v_bad;
  end if;
end $$;

insert into public.lease_building_project_map(
  market_code,alias_name,building_id,match_method,verification_status
)
select
  'BJ',t.historical_name,t.building_id,
  'AUTHORITATIVE_PROJECT_NAME_EQUIVALENCE','AUTO_VERIFIED_PROJECT'
from _v32_project_targets t
on conflict (market_code,alias_name,building_id) do update
set match_method=excluded.match_method,
    verification_status=excluded.verification_status;

update public.lease_building_alias_review ar
set
  resolution_status='AUTO_VERIFIED_PROJECT',
  matched_building_id=null,
  matched_building_name=null,
  resolution_basis=t.basis,
  confidence='ABSOLUTE',
  candidate_count=1,
  candidate_snapshot=jsonb_build_array(
    jsonb_build_object(
      'building_id',b.id,'building_name',b.name,
      'submarket',b.submarket,'district',b.district,
      'resolution','authoritative_project_scope'
    )
  ),
  evidence_snapshot=case
    when ar.resolution_basis=t.basis
      and coalesce(ar.review_notes,'') like '%v32 authoritative project-scope identity%'
      then ar.evidence_snapshot
    else coalesce(ar.evidence_snapshot,'[]'::jsonb) ||
      jsonb_build_array(jsonb_build_object(
        'type','authoritative_project_name_equivalence',
        'verified_at','2026-09-21',
        'basis',t.basis,
        'detail',t.evidence_detail
      ))
  end,
  review_notes=case
    when coalesce(ar.review_notes,'') like '%v32 authoritative project-scope identity%'
      then ar.review_notes
    else concat_ws(' | ',nullif(ar.review_notes,''),'v32 authoritative project-scope identity')
  end,
  resolved_at=coalesce(ar.resolved_at,now()),
  updated_at=now()
from _v32_project_targets t
join public.buildings b on b.id=t.building_id
where ar.historical_name=t.historical_name;

do $$
declare v_project integer; v_unmapped integer;
begin
  select count(*) into v_project
  from public.lease_transactions_read_v1
  where record_source='history'
    and building_match_scope='project'
    and trim(new_building) in ('保利大都会','国会一期');

  select count(*) into v_unmapped
  from public.lease_transactions_read_v1
  where record_source='history'
    and building_match_scope='unmapped'
    and trim(new_building) in ('保利大都会','国会一期');

  if v_project<>6 or v_unmapped<>0 then
    raise exception 'v32 postcondition project/unmapped=%/% expected 6/0',v_project,v_unmapped;
  end if;
end $$;

commit;
