begin;

alter table public.lease_building_alias_review
  drop constraint if exists lease_building_alias_review_resolution_status_check;
alter table public.lease_building_alias_review
  add constraint lease_building_alias_review_resolution_status_check
  check (resolution_status = any (array[
    'AUTO_VERIFIED'::text,
    'MANUAL_VERIFIED'::text,
    'AUTO_VERIFIED_PROJECT'::text,
    'MANUAL_VERIFIED_PROJECT'::text,
    'NEEDS_REVIEW'::text,
    'NO_MATCH'::text
  ]));

create table if not exists public.lease_building_project_map (
  market_code text not null default 'BJ',
  alias_name text not null,
  building_id uuid not null references public.buildings(id) on delete restrict,
  match_method text not null default 'project_prefix_group',
  verification_status text not null default 'AUTO_VERIFIED_PROJECT'
    check (verification_status in ('AUTO_VERIFIED_PROJECT','MANUAL_VERIFIED_PROJECT')),
  created_at timestamptz not null default now(),
  primary key (market_code, alias_name, building_id)
);
create index if not exists lease_building_project_map_building_idx
  on public.lease_building_project_map(building_id);
create index if not exists lease_building_project_map_alias_idx
  on public.lease_building_project_map(market_code, alias_name);
alter table public.lease_building_project_map enable row level security;
revoke all on public.lease_building_project_map from public, anon, authenticated, service_role;
grant select on public.lease_building_project_map to service_role;

create temp table _safe_exact_aliases (
  historical_name text primary key,
  building_id uuid not null,
  basis text not null
) on commit drop;

with unresolved as (
  select r.historical_name
  from public.lease_building_alias_review r
  where r.resolution_status='NEEDS_REVIEW'
), brochure_matches as (
  select u.historical_name, bbd.building_id
  from unresolved u
  join public.building_brochure_data bbd
    on lower(regexp_replace(u.historical_name,'[^[:alnum:]]','','g')) =
       lower(regexp_replace(coalesce(bbd.name_cn,''),'[^[:alnum:]]','','g'))
    or lower(regexp_replace(u.historical_name,'[^[:alnum:]]','','g')) =
       lower(regexp_replace(coalesce(bbd.name_en,''),'[^[:alnum:]]','','g'))
  where length(regexp_replace(u.historical_name,'[^[:alnum:]]','','g')) >= 3
), unique_match as (
  select historical_name, min(building_id::text)::uuid building_id
  from brochure_matches
  group by historical_name
  having count(distinct building_id)=1
), no_sibling_conflict as (
  select m.*
  from unique_match m
  where (
    select count(*)
    from public.buildings bx
    where lower(regexp_replace(bx.name,'[[:space:]（）()·.，,\-_/]','','g')) like
          lower(regexp_replace(m.historical_name,'[[:space:]（）()·.，,\-_/]','','g')) || '%'
  ) <= 1
)
insert into _safe_exact_aliases(historical_name,building_id,basis)
select historical_name,building_id,'BROCHURE_DIRECT'
from no_sibling_conflict
on conflict (historical_name) do nothing;

with former as (
  select b.id building_id, b.submarket, trim(x.value) former_name,
         lower(regexp_replace(trim(x.value),'[[:space:]（）()·.，,\-_/]','','g')) fn,
         lower(regexp_replace(regexp_replace(trim(x.value),'(大厦|中心|广场)$','','i'),'[[:space:]（）()·.，,\-_/]','','g')) fcore
  from public.buildings b
  cross join lateral jsonb_array_elements_text(
    case when jsonb_typeof(b.former_names)='array' then b.former_names else '[]'::jsonb end
  ) x(value)
  where nullif(trim(x.value),'') is not null
), unresolved as (
  select r.historical_name,
         lower(regexp_replace(trim(r.historical_name),'[[:space:]（）()·.，,\-_/]','','g')) hn,
         lower(regexp_replace(regexp_replace(trim(r.historical_name),'(大厦|中心|广场)$','','i'),'[[:space:]（）()·.，,\-_/]','','g')) hcore
  from public.lease_building_alias_review r
  where r.resolution_status='NEEDS_REVIEW'
    and not exists (select 1 from _safe_exact_aliases s where s.historical_name=r.historical_name)
), pairs as (
  select u.historical_name,f.building_id,f.submarket
  from unresolved u join former f
    on (u.hn=f.fcore or u.hcore=f.fn or (u.hcore=f.fcore and length(u.hcore)>=3))
  where u.hn<>f.fn
), unique_pairs as (
  select historical_name,min(building_id::text)::uuid building_id,min(submarket) submarket
  from pairs group by historical_name having count(distinct building_id)=1
), context_scored as (
  select p.*,
    count(h.*) filter(where h.sub_market is not null and trim(h.sub_market)<>'') nonnull_ctx,
    count(h.*) filter(where h.sub_market is not null and trim(h.sub_market)<>'' and (
      h.sub_market=p.submarket
      or (p.submarket='东城商务区' and h.sub_market='东二环')
      or (p.submarket='望京-酒仙桥' and h.sub_market in ('望京酒仙桥','望京','酒仙桥'))
      or (p.submarket='CBD' and h.sub_market='国贸')
    )) matched_ctx
  from unique_pairs p join public.lease_transactions_history h on h.new_building=p.historical_name
  group by p.historical_name,p.building_id,p.submarket
)
insert into _safe_exact_aliases(historical_name,building_id,basis)
select historical_name,building_id,'FORMER_NAME_DERIVED'
from context_scored
where nonnull_ctx=0 or matched_ctx::numeric/nullif(nonnull_ctx,0)>=0.80
on conflict (historical_name) do nothing;

with geo(prefix, expected_submarket) as (values
  ('北京',null::text),('望京','望京-酒仙桥'),('丽泽','丽泽'),('中关村','中关村'),('通州','通州')
), unresolved0 as (
  select r.historical_name,
    (select g.prefix from geo g where r.historical_name like g.prefix||'%' order by length(g.prefix) desc limit 1) hgeo
  from public.lease_building_alias_review r
  where r.resolution_status='NEEDS_REVIEW'
    and not exists (select 1 from _safe_exact_aliases s where s.historical_name=r.historical_name)
), unresolved as (
  select u.*,
    lower(regexp_replace(regexp_replace(
      case when hgeo is null then historical_name else substr(historical_name,length(hgeo)+1) end,
      '(大厦|中心|广场)$','','i'),'[[:space:]（）()·.，,\-_/]','','g')) core
  from unresolved0 u
), buildings0 as (
  select b.id,b.name,b.submarket,
    (select g.prefix from geo g where b.name like g.prefix||'%' order by length(g.prefix) desc limit 1) bgeo
  from public.buildings b
), buildings as (
  select b.*,
    lower(regexp_replace(regexp_replace(
      case when bgeo is null then name else substr(name,length(bgeo)+1) end,
      '(大厦|中心|广场)$','','i'),'[[:space:]（）()·.，,\-_/]','','g')) core
  from buildings0 b
), pairs as (
  select u.historical_name,u.hgeo,b.id building_id,b.name,b.submarket,b.bgeo
  from unresolved u join buildings b using(core)
  where length(u.core)>=3
    and u.core not in ('soho','国际','金融','中心','大厦','广场')
    and not (u.hgeo is not null and b.bgeo is not null and u.hgeo<>b.bgeo)
), unique_pairs as (
  select historical_name,max(hgeo) hgeo,max(bgeo) bgeo,
         min(building_id::text)::uuid building_id,min(submarket) submarket
  from pairs group by historical_name having count(distinct building_id)=1
), scored as (
  select p.*,
    count(h.*) filter(where h.sub_market is not null and trim(h.sub_market)<>'') nonnull_ctx,
    count(h.*) filter(where h.sub_market is not null and trim(h.sub_market)<>'' and (
      h.sub_market=p.submarket
      or (p.submarket='东城商务区' and h.sub_market='东二环')
      or (p.submarket='望京-酒仙桥' and h.sub_market in ('望京酒仙桥','望京','酒仙桥'))
      or (p.submarket='CBD' and h.sub_market='国贸')
    )) matched_ctx
  from unique_pairs p join public.lease_transactions_history h on h.new_building=p.historical_name
  group by p.historical_name,p.hgeo,p.bgeo,p.building_id,p.submarket
)
insert into _safe_exact_aliases(historical_name,building_id,basis)
select s.historical_name,s.building_id,'STRICT_NAME_EQUIVALENCE'
from scored s
where
  (s.hgeo is null and s.bgeo is null and (s.nonnull_ctx=0 or s.matched_ctx=s.nonnull_ctx))
  or
  (s.hgeo is not null and s.bgeo is null and (
     (s.hgeo='望京' and s.submarket='望京-酒仙桥') or
     (s.hgeo='丽泽' and s.submarket='丽泽') or
     (s.hgeo='中关村' and s.submarket='中关村') or
     (s.hgeo='通州' and s.submarket='通州') or
     (s.hgeo='北京')
   ) and (s.nonnull_ctx=0 or s.matched_ctx=s.nonnull_ctx))
  or
  (s.hgeo is null and s.bgeo is not null and s.nonnull_ctx>0 and s.matched_ctx=s.nonnull_ctx)
on conflict (historical_name) do nothing;

with per_building as (
  select building_id, jsonb_agg(historical_name order by historical_name) aliases
  from _safe_exact_aliases group by building_id
), expanded as (
  select p.building_id,
         jsonb_agg(distinct v order by v) new_former_names
  from per_building p
  join public.buildings b on b.id=p.building_id
  cross join lateral (
    select x.value v
    from jsonb_array_elements_text(case when jsonb_typeof(b.former_names)='array' then b.former_names else '[]'::jsonb end) x(value)
    union all
    select y.value v from jsonb_array_elements_text(p.aliases) y(value)
  ) s
  where nullif(trim(v),'') is not null
  group by p.building_id
)
update public.buildings b
set former_names=e.new_former_names
from expanded e
where b.id=e.building_id;

insert into public.lease_building_name_map(market_code,alias_name,building_id,match_method,verification_status)
select 'BJ',s.historical_name,s.building_id,'former_name','AUTO_VERIFIED'
from _safe_exact_aliases s
on conflict (market_code,alias_name) do update
set building_id=excluded.building_id,
    match_method='former_name',
    verification_status='AUTO_VERIFIED';

update public.lease_building_alias_review r
set resolution_status='AUTO_VERIFIED',
    matched_building_id=s.building_id,
    matched_building_name=b.name,
    resolution_basis=s.basis,
    confidence='ABSOLUTE',
    review_notes=coalesce(r.review_notes || ' | ','') || 'v2 multi-evidence exact identity',
    resolved_at=now(),
    updated_at=now()
from _safe_exact_aliases s join public.buildings b on b.id=s.building_id
where r.historical_name=s.historical_name
  and r.resolution_status='NEEDS_REVIEW';

with unresolved as (
  select r.historical_name,r.historical_row_count
  from public.lease_building_alias_review r
  where r.resolution_status='NEEDS_REVIEW'
), cand as (
  select u.historical_name,u.historical_row_count,b.id,b.name,b.submarket,b.district
  from unresolved u join public.buildings b
    on lower(regexp_replace(b.name,'[[:space:]（）()·.，,\-_/]','','g')) like
       lower(regexp_replace(u.historical_name,'[[:space:]（）()·.，,\-_/]','','g')) || '%'
), grp as (
  select historical_name,max(historical_row_count) row_count,count(*) member_count,
         count(distinct submarket) submarket_count,count(distinct district) district_count,
         min(submarket) target_submarket
  from cand group by historical_name
  having count(*)>=2 and count(distinct submarket)=1 and count(distinct district)=1
), ctx as (
  select g.*,
    count(h.*) filter(where h.sub_market is not null and trim(h.sub_market)<>'') nonnull_ctx,
    count(h.*) filter(where h.sub_market is not null and trim(h.sub_market)<>'' and (
      h.sub_market=g.target_submarket
      or (g.target_submarket='东城商务区' and h.sub_market='东二环')
      or (g.target_submarket='望京-酒仙桥' and h.sub_market in ('望京酒仙桥','望京','酒仙桥'))
      or (g.target_submarket='CBD' and h.sub_market='国贸')
    )) matched_ctx
  from grp g join public.lease_transactions_history h on h.new_building=g.historical_name
  group by g.historical_name,g.row_count,g.member_count,g.submarket_count,g.district_count,g.target_submarket
), safe_groups as (
  select * from ctx
  where char_length(regexp_replace(historical_name,'[[:space:]（）()·.，,\-_/]','','g'))>=4
    and historical_name ~ '(中心|广场|大厦|总部|国际)$'
    and (nonnull_ctx=0 or matched_ctx::numeric/nullif(nonnull_ctx,0)>=0.75)
)
insert into public.lease_building_project_map(market_code,alias_name,building_id,match_method,verification_status)
select 'BJ',g.historical_name,c.id,'project_prefix_group','AUTO_VERIFIED_PROJECT'
from safe_groups g
join cand c on c.historical_name=g.historical_name
on conflict (market_code,alias_name,building_id) do nothing;

update public.lease_building_alias_review r
set resolution_status='AUTO_VERIFIED_PROJECT',
    matched_building_id=null,
    matched_building_name=null,
    resolution_basis='PROJECT_PREFIX_GROUP',
    confidence='ABSOLUTE',
    review_notes=coalesce(r.review_notes || ' | ','') || 'v2 project-level association; tower not inferred',
    resolved_at=now(),
    updated_at=now()
where r.resolution_status='NEEDS_REVIEW'
  and exists (
    select 1 from public.lease_building_project_map p
    where p.market_code='BJ' and p.alias_name=r.historical_name
      and p.verification_status='AUTO_VERIFIED_PROJECT'
  );

commit;
