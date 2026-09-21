begin;

create temp table _v23_project_aliases(
  historical_name text primary key,
  expected_rows integer not null,
  basis text not null
) on commit drop;

insert into _v23_project_aliases values
('远洋乐堤港',2,'PARENT_PROJECT_NAME_MULTIPLE_TRACKED_TOWERS'),
('学清嘉创',1,'PARENT_PROJECT_NAME_MULTIPLE_TRACKED_TOWERS'),
('首钢园',2,'PARENT_PROJECT_NAME_MULTIPLE_TRACKED_SUBPROJECTS'),
('远洋国际中心一期',2,'PARENT_PROJECT_NAME_PHASE_SCOPE_ONLY'),
('融科中心',1,'PARENT_PROJECT_NAME_MULTIPLE_TRACKED_TOWERS'),
('融科咨讯中心',1,'PARENT_PROJECT_NAME_MULTIPLE_TRACKED_TOWERS');

create temp table _v23_members(
  historical_name text not null,
  building_id uuid not null,
  primary key(historical_name,building_id)
) on commit drop;

insert into _v23_members values
('远洋乐堤港','51aef6d7-4f57-4fcc-9b10-b32512524e99'),
('远洋乐堤港','8cc7d0d6-5bdc-4ef0-93be-50aec03c95b3'),
('学清嘉创','8049b19c-1b01-47ae-b5fd-7d93dd4e9668'),
('学清嘉创','a0dc5e4b-4abe-49f1-a239-940353d1ca41'),
('首钢园','5dfabd15-f6f6-4e1f-8879-8e8028656f94'),
('首钢园','077dcf50-1d0f-4e03-9955-b96834c1848e'),
('首钢园','a1ac6d3e-2ee8-4218-80ca-b4555a1e5642'),
('首钢园','0c5271cc-f935-4d94-b7ae-45adf648b514'),
('首钢园','d39d2b87-c02d-475a-893f-f7455ff0a86d'),
('远洋国际中心一期','620e729b-d8fe-4d10-9ca6-770f70c0f69e'),
('融科中心','9e03a3a5-473d-4c9d-b3dd-2ec8530ca3a6'),
('融科中心','cdebccad-fbc9-4ec1-9292-6353b642aba5'),
('融科中心','fb98e079-9c6b-46d3-8521-a28ab07ecf80'),
('融科咨讯中心','9e03a3a5-473d-4c9d-b3dd-2ec8530ca3a6'),
('融科咨讯中心','cdebccad-fbc9-4ec1-9292-6353b642aba5'),
('融科咨讯中心','fb98e079-9c6b-46d3-8521-a28ab07ecf80');

do $$
declare
  v_source_rows integer;
  v_bad integer;
begin
  select coalesce(sum(x.rows),0)
    into v_source_rows
  from _v23_project_aliases p
  join (
    select trim(new_building) historical_name,count(*) rows
    from public.lease_transactions_history
    group by trim(new_building)
  ) x using(historical_name);

  if v_source_rows<>9 then
    raise exception 'v23 source population drift: rows=% expected 9',v_source_rows;
  end if;

  select count(*) into v_bad
  from _v23_members pm
  left join public.buildings b on b.id=pm.building_id
  where b.id is null or b.tracking_scope<>'tracked' or b.is_active<>true;

  if v_bad<>0 then
    raise exception 'v23 invalid project members=%',v_bad;
  end if;

  select count(*) into v_bad
  from _v23_project_aliases p
  left join public.lease_building_name_map m
    on m.market_code='BJ' and m.alias_name=p.historical_name
  where m.building_id is not null;

  if v_bad<>0 then
    raise exception 'v23 aliases unexpectedly have exact mappings=%',v_bad;
  end if;
end $$;

insert into public.lease_building_project_map(
  market_code,alias_name,building_id,match_method,verification_status
)
select
  'BJ',
  pm.historical_name,
  pm.building_id,
  'PARENT_PROJECT_SCOPE',
  'AUTO_VERIFIED_PROJECT'
from _v23_members pm
on conflict (market_code,alias_name,building_id) do update
set match_method=excluded.match_method,
    verification_status=excluded.verification_status;

update public.lease_building_alias_review ar
set
  resolution_status='AUTO_VERIFIED_PROJECT',
  matched_building_id=null,
  matched_building_name=null,
  resolution_basis=p.basis,
  confidence='ABSOLUTE',
  candidate_count=(select count(*) from _v23_members m where m.historical_name=p.historical_name),
  candidate_snapshot=(
    select jsonb_agg(
      jsonb_build_object(
        'building_id',b.id,
        'building_name',b.name,
        'submarket',b.submarket,
        'district',b.district,
        'resolution','verified_parent_project_member'
      )
      order by b.name,b.id
    )
    from _v23_members m
    join public.buildings b on b.id=m.building_id
    where m.historical_name=p.historical_name
  ),
  evidence_snapshot=case
    when ar.resolution_basis=p.basis
      and coalesce(ar.review_notes,'') like '%v23 P1 parent-project scope resolution%'
      then ar.evidence_snapshot
    else coalesce(ar.evidence_snapshot,'[]'::jsonb) ||
      jsonb_build_array(
        jsonb_build_object(
          'type','parent_project_scope_resolution',
          'verified_at','2026-09-21',
          'detail','Historical source names the parent project/complex but does not identify one exact tower; related tracked members are retained without fake exact attribution.'
        )
      )
  end,
  review_notes=case
    when coalesce(ar.review_notes,'') like '%v23 P1 parent-project scope resolution%'
      then ar.review_notes
    else concat_ws(' | ',nullif(ar.review_notes,''),'v23 P1 parent-project scope resolution')
  end,
  resolved_at=coalesce(ar.resolved_at,now()),
  updated_at=now()
from _v23_project_aliases p
where ar.historical_name=p.historical_name;

update public.lease_building_alias_review ar
set
  evidence_snapshot=case
    when coalesce(ar.review_notes,'') like '%v23 P1 deferred: reused parent label%'
      then ar.evidence_snapshot
    else coalesce(ar.evidence_snapshot,'[]'::jsonb) ||
      jsonb_build_array(
        jsonb_build_object(
          'type','parent_project_scope_deferred',
          'verified_at','2026-09-21',
          'detail','“中海大厦” is reused across historical contexts. Five source rows span CBD/unknown/Other, while current tower candidates are the Shijingshan B and C/D buildings. A global project alias would incorrectly attach CBD-era rows, so the alias remains unresolved pending row-level evidence or a row-level project mapping mechanism.'
        )
      )
  end,
  review_notes=case
    when coalesce(ar.review_notes,'') like '%v23 P1 deferred: reused parent label%'
      then ar.review_notes
    else concat_ws(' | ',nullif(ar.review_notes,''),'v23 P1 deferred: reused parent label across CBD/Shijingshan contexts; no global project mapping')
  end,
  updated_at=now()
where ar.historical_name='中海大厦'
  and ar.resolution_status='NEEDS_REVIEW';

do $$
declare
  v_project integer;
  v_unmapped integer;
  v_zhonghai integer;
begin
  select count(*) into v_project
  from public.lease_transactions_read_v1 r
  where r.record_source='history'
    and r.building_match_scope='project'
    and trim(r.new_building) in (select historical_name from _v23_project_aliases);

  select count(*) into v_unmapped
  from public.lease_transactions_read_v1 r
  where r.record_source='history'
    and r.building_match_scope='unmapped'
    and trim(r.new_building) in (select historical_name from _v23_project_aliases);

  select count(*) into v_zhonghai
  from public.lease_transactions_read_v1 r
  where r.record_source='history'
    and r.building_match_scope='unmapped'
    and trim(r.new_building)='中海大厦';

  if v_project<>9 or v_unmapped<>0 or v_zhonghai<>5 then
    raise exception 'v23 postcondition failed project/unmapped/zhonghai=%/%/% expected 9/0/5',
      v_project,v_unmapped,v_zhonghai;
  end if;
end $$;

commit;
