begin;

create temp table _v30_safe_project_aliases on commit drop as
with eligible as (
  select ar.historical_name
  from public.lease_building_alias_review ar
  where ar.resolution_status='NEEDS_REVIEW'
     or (
       ar.resolution_status='AUTO_VERIFIED_PROJECT'
       and ar.resolution_basis='VERIFIED_PROJECT_ALIAS_FAMILY_PROPAGATION'
     )
),
u as (
  select trim(h.new_building) historical_name,
         count(*) rows,
         array_agg(distinct h.sub_market) filter (where h.sub_market is not null) submarkets
  from public.lease_transactions_history h
  join eligible e on e.historical_name=trim(h.new_building)
  group by trim(h.new_building)
),
project_seeds as (
  select p.alias_name,
         array_agg(distinct p.building_id order by p.building_id) member_ids
  from public.lease_building_project_map p
  where p.market_code='BJ'
    and p.verification_status in ('AUTO_VERIFIED_PROJECT','MANUAL_VERIFIED_PROJECT')
    and coalesce(p.match_method,'')<>'PROJECT_ALIAS_FAMILY_PROPAGATION'
  group by p.alias_name
),
ps as (
  select alias_name,member_ids,
    lower(regexp_replace(alias_name,'[[:space:]·•._,，。()（）\-—/\\]+','','g')) n
  from project_seeds
),
un as (
  select historical_name,rows,submarkets,
    lower(regexp_replace(historical_name,'[[:space:]·•._,，。()（）\-—/\\]+','','g')) n
  from u
),
cand as (
  select un.*,ps.alias_name,ps.member_ids,length(ps.n) seed_len
  from un
  join ps
    on length(ps.n)>=2
   and un.n like ps.n||'%'
   and un.n<>ps.n
),
g as (
  select historical_name,max(rows) rows,max(submarkets) submarkets,
         count(distinct member_ids::text) project_sets,
         min(member_ids::text) member_set_text,
         min(seed_len) min_seed_len,
         array_agg(distinct alias_name order by alias_name) seeds
  from cand
  group by historical_name
),
member_context as (
  select g.historical_name,
         array_agg(
           distinct lower(
             regexp_replace(
               coalesce(b.submarket,''),
               '[[:space:]·•._,，。()（）\-—/\\]+',
               '',
               'g'
             )
           )
         ) filter (where b.submarket is not null) member_submarkets
  from g
  join lateral unnest((g.member_set_text::uuid[])) x(id) on true
  join public.buildings b on b.id=x.id
  where g.project_sets=1
  group by g.historical_name
)
select
  g.historical_name,
  g.rows,
  g.submarkets,
  g.member_set_text::uuid[] member_ids,
  g.seeds
from g
join member_context mc using(historical_name)
where g.project_sets=1
  and (
    g.submarkets is null
    or cardinality(g.submarkets)=0
    or exists (
      select 1
      from unnest(g.submarkets) hs(s)
      where lower(
        regexp_replace(
          hs.s,
          '[[:space:]·•._,，。()（）\-—/\\]+',
          '',
          'g'
        )
      ) = any(mc.member_submarkets)
    )
  )
  and (
    g.min_seed_len>=4
    or exists (
      select 1
      from unnest(g.seeds) s(seed)
      where s.seed in (
        'CCP','GTC','华贸','国贸','锦什坊',
        '佳兆业','诺金','鼎好','首钢园'
      )
    )
  );

do $$
declare
  v_aliases integer;
  v_relations integer;
  v_bad integer;
begin
  select count(*),coalesce(sum(cardinality(member_ids)),0)
    into v_aliases,v_relations
  from _v30_safe_project_aliases;

  if v_aliases<>107 or v_relations<>237 then
    raise exception
      'v30 population drift aliases/relations=%/% expected 107/237',
      v_aliases,v_relations;
  end if;

  select count(*) into v_bad
  from _v30_safe_project_aliases s
  cross join lateral unnest(s.member_ids) x(building_id)
  left join public.buildings b on b.id=x.building_id
  where b.id is null
     or b.tracking_scope<>'tracked'
     or b.is_active<>true;

  if v_bad<>0 then
    raise exception 'v30 invalid project member relations=%',v_bad;
  end if;

  select count(*) into v_bad
  from _v30_safe_project_aliases s
  join public.lease_building_alias_review ar
    on ar.historical_name=s.historical_name
  left join public.lease_building_name_map m
    on m.market_code='BJ'
   and m.alias_name=s.historical_name
  where m.building_id is not null
     or coalesce(ar.review_notes,'') ~* '(rejected|deferred|inconclusive)';

  if v_bad<>0 then
    raise exception 'v30 governance conflict aliases=%',v_bad;
  end if;
end $$;

insert into public.lease_building_project_map(
  market_code,alias_name,building_id,match_method,verification_status
)
select
  'BJ',
  s.historical_name,
  x.building_id,
  'PROJECT_ALIAS_FAMILY_PROPAGATION',
  'AUTO_VERIFIED_PROJECT'
from _v30_safe_project_aliases s
cross join lateral unnest(s.member_ids) x(building_id)
on conflict (market_code,alias_name,building_id) do update
set
  match_method=excluded.match_method,
  verification_status=excluded.verification_status;

update public.lease_building_alias_review ar
set
  resolution_status='AUTO_VERIFIED_PROJECT',
  matched_building_id=null,
  matched_building_name=null,
  resolution_basis='VERIFIED_PROJECT_ALIAS_FAMILY_PROPAGATION',
  confidence='ABSOLUTE',
  candidate_count=cardinality(s.member_ids),
  candidate_snapshot=(
    select jsonb_agg(
      jsonb_build_object(
        'building_id',b.id,
        'building_name',b.name,
        'submarket',b.submarket,
        'district',b.district,
        'resolution','verified_project_alias_family_member'
      )
      order by b.name,b.id
    )
    from unnest(s.member_ids) x(building_id)
    join public.buildings b on b.id=x.building_id
  ),
  evidence_snapshot=case
    when ar.resolution_basis='VERIFIED_PROJECT_ALIAS_FAMILY_PROPAGATION'
      and coalesce(ar.review_notes,'') like '%v30 verified project-alias family propagation%'
      then ar.evidence_snapshot
    else coalesce(ar.evidence_snapshot,'[]'::jsonb)
      || jsonb_build_array(
        jsonb_build_object(
          'type','verified_project_alias_family_propagation',
          'verified_at','2026-09-21',
          'seed_aliases',s.seeds,
          'detail',
          'Inherited only the already-verified project identity/member set from a verified project alias prefix; exact tower was not inferred. Historical submarket was required to agree with at least one current project member whenever source submarket existed.'
        )
      )
  end,
  review_notes=case
    when coalesce(ar.review_notes,'') like '%v30 verified project-alias family propagation%'
      then ar.review_notes
    else concat_ws(
      ' | ',
      nullif(ar.review_notes,''),
      'v30 verified project-alias family propagation'
    )
  end,
  resolved_at=coalesce(ar.resolved_at,now()),
  updated_at=now()
from _v30_safe_project_aliases s
where ar.historical_name=s.historical_name;

update public.lease_building_alias_review ar
set
  evidence_snapshot=case
    when coalesce(ar.review_notes,'') like '%v30 context conflict exclusion%'
      then ar.evidence_snapshot
    else coalesce(ar.evidence_snapshot,'[]'::jsonb)
      || jsonb_build_array(
        jsonb_build_object(
          'type','project_alias_family_context_exclusion',
          'verified_at','2026-09-21',
          'detail',
          case ar.historical_name
            when '中关村软件园15号楼'
              then 'Historical submarket is 中关村 while all verified 中关村软件园 project members are classified 上地; excluded from automatic propagation.'
            when '凤凰置地中心'
              then 'Historical submarket is CBD while verified 凤凰置地 project members are 燕莎; excluded from automatic propagation.'
            when '远洋国际E'
              then 'Historical submarket is 东城商务区 while verified 远洋国际 project members are CBD; excluded from automatic propagation.'
          end
        )
      )
  end,
  review_notes=case
    when coalesce(ar.review_notes,'') like '%v30 context conflict exclusion%'
      then ar.review_notes
    else concat_ws(
      ' | ',
      nullif(ar.review_notes,''),
      'v30 context conflict exclusion; kept NEEDS_REVIEW'
    )
  end,
  updated_at=now()
where ar.historical_name in (
  '中关村软件园15号楼',
  '凤凰置地中心',
  '远洋国际E'
)
and ar.resolution_status='NEEDS_REVIEW';

do $$
declare
  v_project integer;
  v_unmapped integer;
  v_excluded integer;
begin
  select count(*) into v_project
  from public.lease_transactions_read_v1 r
  where r.record_source='history'
    and r.building_match_scope='project'
    and trim(r.new_building) in (
      select historical_name
      from _v30_safe_project_aliases
    );

  select count(*) into v_unmapped
  from public.lease_transactions_read_v1 r
  where r.record_source='history'
    and r.building_match_scope='unmapped'
    and trim(r.new_building) in (
      select historical_name
      from _v30_safe_project_aliases
    );

  select count(*) into v_excluded
  from public.lease_transactions_read_v1 r
  where r.record_source='history'
    and r.building_match_scope='unmapped'
    and trim(r.new_building) in (
      '中关村软件园15号楼',
      '凤凰置地中心',
      '远洋国际E'
    );

  if v_project<>125 or v_unmapped<>0 or v_excluded<>4 then
    raise exception
      'v30 postcondition failed project/unmapped/excluded=%/%/% expected 125/0/4',
      v_project,v_unmapped,v_excluded;
  end if;
end $$;

commit;
