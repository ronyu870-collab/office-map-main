-- Future supply identity and quarter tasks: independent scope, no activation/grants.
begin;
alter table private.ai_query_grants add column all_future_supplies boolean not null default false,
  add column future_supply_ids uuid[] not null default '{}',
  add constraint ai_query_grants_future_ids_nonnull check(array_position(future_supply_ids,null) is null);
alter table private.ai_query_grants drop constraint ai_query_grants_capabilities_check;
alter table private.ai_query_grants add constraint ai_query_grants_capabilities_check
  check(capabilities <@ array['query:catalog','query:brochure','query:quarter','export:internal','query:submission-progress','query:submission-quality',
    'query:future-catalog','query:future-progress','query:future-quality']);

-- Shared trusted principal; resource-specific wrappers retain separate scopes.
create or replace function private.ai_query_principal(p_actor uuid,p_effective uuid,p_session uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare c private.ai_query_control; a private.ai_query_grants; e private.ai_query_grants; ar text; er text;
  caps text[]; fs text[]; markets text[]; buildings uuid[]; all_markets boolean; all_entities boolean; revision text; all_future boolean; futures uuid[];
begin
  select * into c from private.ai_query_control where singleton for share;
  if not found or not c.enabled then return jsonb_build_object('allowed',false); end if;
  -- Serialize account/role/session/grant revocation with this transaction's reads.
  perform 1 from auth.users u join public.user_roles r on r.user_id=u.id
    where u.id in (p_actor,p_effective) order by u.id for share of u,r;
  select r.role into ar from public.user_roles r join auth.users u on u.id=r.user_id
    where u.id=p_actor and u.deleted_at is null and (u.banned_until is null or u.banned_until<=clock_timestamp());
  select r.role into er from public.user_roles r join auth.users u on u.id=r.user_id
    where u.id=p_effective and u.deleted_at is null and (u.banned_until is null or u.banned_until<=clock_timestamp());
  if ar is null or er is null or ar<>'admin' or er<>'admin' or p_actor is distinct from p_effective then return jsonb_build_object('allowed',false); end if;
  perform 1 from auth.sessions s where s.id=p_session and s.user_id=p_actor
    and (s.not_after is null or s.not_after>clock_timestamp()) for share;
  if not found then return jsonb_build_object('allowed',false); end if;
  perform 1 from private.ai_query_grants where user_id in (p_actor,p_effective) order by user_id for share;
  select * into a from private.ai_query_grants where user_id=p_actor and enabled and valid_until>clock_timestamp();
  select * into e from private.ai_query_grants where user_id=p_effective and enabled and valid_until>clock_timestamp();
  if a.user_id is null or e.user_id is null then return jsonb_build_object('allowed',false); end if;
  select coalesce(array_agg(v order by v),'{}') into caps from (select unnest(a.capabilities) v intersect select unnest(e.capabilities)) t;
  select coalesce(array_agg(v order by v),'{}') into fs from (select unnest(a.fields) v intersect select unnest(e.fields)) t;
  all_markets:=a.all_submarkets and e.all_submarkets;
  all_entities:=a.all_buildings and e.all_buildings;
  if a.all_submarkets then markets:=e.submarkets;
  elsif e.all_submarkets then markets:=a.submarkets;
  else select coalesce(array_agg(v order by v),'{}') into markets from (select unnest(a.submarkets) v intersect select unnest(e.submarkets)) t; end if;
  if a.all_buildings then buildings:=e.building_ids;
  elsif e.all_buildings then buildings:=a.building_ids;
  else select coalesce(array_agg(v order by v),'{}') into buildings from (select unnest(a.building_ids) v intersect select unnest(e.building_ids)) t; end if;
  all_future:=a.all_future_supplies and e.all_future_supplies;
  if a.all_future_supplies then futures:=e.future_supply_ids;
  elsif e.all_future_supplies then futures:=a.future_supply_ids;
  else select coalesce(array_agg(v order by v),'{}') into futures from (select unnest(a.future_supply_ids) v intersect select unnest(e.future_supply_ids)) t; end if;
  revision:=encode(sha256(convert_to(jsonb_build_array('admin-only/1',c.revision,a.revision,e.revision,ar,er)::text,'UTF8')),'hex');
  return jsonb_build_object('allowed',true,'access_policy','admin-only/1','actor_id',p_actor,'effective_user_id',p_effective,'session_id',p_session,
    'policy_version',c.policy_version,'permission_revision',revision,'capabilities',caps,'fields',fs,
    'all_submarkets',all_markets,'submarkets',markets,'all_buildings',all_entities,'building_ids',buildings,
    'all_future_supplies',all_future,'future_supply_ids',futures);
end $$;

revoke all on function private.ai_query_principal(uuid,uuid,uuid) from public,anon,authenticated,service_role;

create or replace function private.ai_query_authority(p_actor uuid,p_effective uuid,p_session uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare a jsonb;
begin
  a:=private.ai_query_principal(p_actor,p_effective,p_session);
  if a->>'allowed' is distinct from 'true' or not(a->'capabilities' ? 'query:catalog')
    or (not(a->>'all_submarkets')::boolean and jsonb_array_length(a->'submarkets')=0)
    or (not(a->>'all_buildings')::boolean and jsonb_array_length(a->'building_ids')=0) then return jsonb_build_object('allowed',false);end if;
  return a-'all_future_supplies'-'future_supply_ids';
end $$;
create or replace function private.ai_query_future_authority(p_actor uuid,p_effective uuid,p_session uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare a jsonb;
begin
  a:=private.ai_query_principal(p_actor,p_effective,p_session);
  if a->>'allowed' is distinct from 'true' or not(a->'capabilities' ? 'query:future-catalog')
    or (not(a->>'all_submarkets')::boolean and jsonb_array_length(a->'submarkets')=0)
    or (not(a->>'all_future_supplies')::boolean and jsonb_array_length(a->'future_supply_ids')=0) then return jsonb_build_object('allowed',false);end if;
  return (a-'all_buildings'-'building_ids')||jsonb_build_object('future_policy','future-observation/1');
end $$;
create or replace function public.ai_query_future_authority(p_actor uuid,p_effective uuid,p_session uuid)
returns jsonb language sql security invoker set search_path='' as $$ select private.ai_query_future_authority(p_actor,p_effective,p_session) $$;
revoke all on function private.ai_query_future_authority(uuid,uuid,uuid),public.ai_query_future_authority(uuid,uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function private.ai_query_future_authority(uuid,uuid,uuid),public.ai_query_future_authority(uuid,uuid,uuid) to service_role;

create or replace function private.ai_query_future_snapshot_read(
  p_actor uuid,p_effective uuid,p_session uuid,p_permission_revision text,p_request_id uuid,
  p_mode text,p_year integer,p_quarter integer,p_submarkets text[],p_future_ids uuid[]
) returns jsonb language plpgsql security definer set search_path='' set statement_timeout='20s' as $$
declare a jsonb; result jsonb; old_sub text; old_claims text; audit private.ai_query_audit_streams;
begin
  a:=private.ai_query_future_authority(p_actor,p_effective,p_session);
  if a->>'allowed' is distinct from 'true' or a->>'access_policy' is distinct from 'admin-only/1'
    or a->>'permission_revision' is distinct from p_permission_revision
    or (p_mode in ('progress','quality') and not(a->'capabilities' ? 'query:future-progress'))
    or (p_mode='quality' and not(a->'capabilities' ? 'query:future-quality')) then raise exception using errcode='42501',message='QUERY_DENIED';end if;
  select * into audit from private.ai_query_audit_streams where request_id=p_request_id and actor_id=p_actor and effective_user_id=p_effective and identity_valid and state='running' for share;
  if not found or not private.ai_query_audit_verify(audit.request_id,audit.head_hash,audit.head_sequence) then raise exception using errcode='42501',message='QUERY_AUDIT_REQUIRED';end if;
  if p_mode is null or p_mode not in ('catalog','progress','quality') or (p_year is null)<>(p_quarter is null)
    or (p_mode='catalog' and p_year is not null) or p_year is not null and (p_year not between 1900 and 2200 or p_quarter not between 1 and 4)
    or p_submarkets is not null and (cardinality(p_submarkets) not between 1 and 30 or array_position(p_submarkets,null) is not null)
    or p_future_ids is not null and (cardinality(p_future_ids) not between 1 and 500 or array_position(p_future_ids,null) is not null)
    or exists(select 1 from unnest(p_submarkets) v where length(btrim(v)) not between 1 and 80) then raise exception using errcode='22023',message='INVALID_FUTURE_QUERY';end if;
  if p_submarkets is not null and not(a->>'all_submarkets')::boolean and not(to_jsonb(p_submarkets)<@(a->'submarkets'))
    or p_future_ids is not null and not(a->>'all_future_supplies')::boolean and not(to_jsonb(p_future_ids)<@(a->'future_supply_ids')) then raise exception using errcode='42501',message='QUERY_DENIED';end if;
  old_sub:=current_setting('request.jwt.claim.sub',true);old_claims:=current_setting('request.jwt.claims',true);
  perform set_config('request.jwt.claim.sub',p_effective::text,true);
  perform set_config('request.jwt.claims',jsonb_build_object('sub',p_effective,'role','authenticated')::text,true);
  with settings as materialized (
    select key,value,updated_at from public.app_settings where p_mode<>'catalog' and key in ('current_submission_year','current_submission_quarter')
  ), configured as (
    select case when max(value) filter(where key='current_submission_year') ~ '^[0-9]{4}$' then (max(value) filter(where key='current_submission_year'))::integer end y,
      case when max(value) filter(where key='current_submission_quarter') ~ '^[1-4]$' then (max(value) filter(where key='current_submission_quarter'))::integer end q from settings
  ), period as (
    select coalesce(p_year,case when y between 1900 and 2200 then y end) y,coalesce(p_quarter,q) q,
      case when y between 1900 and 2200 and q between 1 and 4 then jsonb_build_object('year',y,'quarter',q) else null end configured from configured
  ), inventory as materialized (
    select f.id,f.building_id,f.name,f.submarket,f.grade,f.launch_year,f.launch_quarter,f.total_area::text,f.location_lng::text,f.location_lat::text,f.status,f.completion_year,f.is_entered_market,f.created_at
    from public.future_supplies f left join public.buildings b on b.id=f.building_id
    where f.is_entered_market=false and private.map_can_view_extended_inventory()
      and (f.building_id is null or b.id is not null and b.is_active and b.merged_into_id is null and b.project_type='future' and private.map_building_visible(b.id))
      and ((a->>'all_submarkets')::boolean or a->'submarkets' ? f.submarket)
      and ((a->>'all_future_supplies')::boolean or a->'future_supply_ids' ? f.id::text)
      and (p_submarkets is null or f.submarket=any(p_submarkets)) and (p_future_ids is null or f.id=any(p_future_ids))
  ), assignments as materialized (
    select t.id,t.future_supply_id,t.user_id,t.user_name,t.record_year,t.record_quarter,t.created_at from public.future_supply_assignments t
    join inventory f on f.id=t.future_supply_id cross join period p where p_mode<>'catalog' and t.record_year=p.y and t.record_quarter=p.q
  ), submissions as materialized (
    select t.id,t.future_supply_id,t.user_id,t.user_name,t.record_year,t.record_quarter,t.created_at,t.updated_at,
      case when p_mode='quality' then jsonb_build_object('total_area',t.total_area::text,'vacant_area',t.vacant_area::text,'vacancy_rate',t.vacancy_rate::text,
        'asking_rent',t.asking_rent::text,'management_fee',t.management_fee::text,'face_rent',t.face_rent::text,'rent_free_period',t.rent_free_period::text,'net_effective_rent',t.net_effective_rent::text) else '{}'::jsonb end vals
    from public.future_supply_submissions t join inventory f on f.id=t.future_supply_id cross join period p where p_mode<>'catalog' and t.record_year=p.y and t.record_quarter=p.q
  ), counts as (select (select count(*) from inventory) nf,(select count(*) from assignments) na,(select count(*) from submissions) ns)
  select jsonb_build_object('policy','future-observation/1','snapshotId',gen_random_uuid(),'databaseSnapshot',pg_current_snapshot()::text,'readAt',clock_timestamp(),'requestId',p_request_id,
    'mode',p_mode,'period',case when p_mode='catalog' then null else jsonb_build_object('year',p.y,'quarter',p.q) end,'configuredPeriod',p.configured,
    'periodBasis',case when p_mode='catalog' then 'none' when p_year is null then 'configured' else 'explicit' end,
    'inventory','current_not_entered_future_records','assignmentsTime','selected_quarter_current_records','complete',c.nf<=20000 and c.na<=100000 and c.ns<=100000,
    'expected',jsonb_build_object('supplies',c.nf,'assignments',c.na,'submissions',c.ns),
    'settings',coalesce((select jsonb_agg(jsonb_build_object('key',key,'value',value,'updatedAt',updated_at,'version',encode(sha256(convert_to(to_jsonb(t)::text,'UTF8')),'hex')) order by key) from settings t),'[]'),
    'supplies',case when c.nf<=20000 then coalesce((select jsonb_agg(to_jsonb(f)||jsonb_build_object('version',encode(sha256(convert_to(to_jsonb(f)::text,'UTF8')),'hex')) order by f.id) from inventory f),'[]') else '[]'::jsonb end,
    'assignments',case when c.na<=100000 then coalesce((select jsonb_agg(to_jsonb(t)||jsonb_build_object('version',encode(sha256(convert_to(to_jsonb(t)::text,'UTF8')),'hex')) order by t.id) from assignments t),'[]') else '[]'::jsonb end,
    'submissions',case when c.ns<=100000 then coalesce((select jsonb_agg((to_jsonb(t)-'vals')||jsonb_build_object('values',t.vals,'version',encode(sha256(convert_to(to_jsonb(t)::text,'UTF8')),'hex')) order by t.id) from submissions t),'[]') else '[]'::jsonb end
  ) into result from counts c cross join period p;
  perform set_config('request.jwt.claim.sub',coalesce(old_sub,''),true);perform set_config('request.jwt.claims',coalesce(old_claims,''),true);
  if p_mode<>'catalog' and (result->'period'->>'year' is null or result->'period'->>'quarter' is null) then raise exception using errcode='22023',message='SUBMISSION_PERIOD_UNAVAILABLE';end if;
  if (result->>'complete')::boolean is not true or octet_length(result::text)>16*1024*1024 then raise exception using errcode='54000',message='QUERY_SCOPE_REQUIRES_BACKGROUND_JOB';end if;
  return result;
end $$;
create or replace function public.ai_query_future_snapshot_read(p_actor uuid,p_effective uuid,p_session uuid,p_permission_revision text,p_request_id uuid,p_mode text,p_year integer,p_quarter integer,p_submarkets text[],p_future_ids uuid[])
returns jsonb language sql security invoker set search_path='' as $$ select private.ai_query_future_snapshot_read(p_actor,p_effective,p_session,p_permission_revision,p_request_id,p_mode,p_year,p_quarter,p_submarkets,p_future_ids) $$;
revoke all on function private.ai_query_future_snapshot_read(uuid,uuid,uuid,text,uuid,text,integer,integer,text[],uuid[]),public.ai_query_future_snapshot_read(uuid,uuid,uuid,text,uuid,text,integer,integer,text[],uuid[]) from public,anon,authenticated,service_role;
grant execute on function private.ai_query_future_snapshot_read(uuid,uuid,uuid,text,uuid,text,integer,integer,text[],uuid[]),public.ai_query_future_snapshot_read(uuid,uuid,uuid,text,uuid,text,integer,integer,text[],uuid[]) to service_role;
commit;
